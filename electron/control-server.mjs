/**
 * Control socket the `canvas` CLI talks to while the app is running.
 *
 * A named pipe on Windows, a unix socket elsewhere. Requests arrive as NDJSON
 * and are either answered in the main process or forwarded to the renderer,
 * which owns the live document. Clients may also subscribe to change events.
 *
 * The socket is local-only and carries no authentication beyond the filesystem
 * permissions of the socket itself, which is why it is created per user.
 */
import { createServer } from 'node:net';
import { rm } from 'node:fs/promises';
import { createDecoder, encode } from '../shared/wire.mjs';
import { clearEndpoint, socketPath, writeEndpoint } from '../shared/endpoint.mjs';

export class ControlServer {
  /**
   * @param {object} handlers
   * @param {(cmd: string, args: object) => Promise<any>} handlers.dispatch
   * @param {() => object} handlers.describe  snapshot returned by `status`
   */
  constructor({ dispatch, describe }) {
    this._dispatch = dispatch;
    this._describe = describe;
    this._server = null;
    this._clients = new Set();
    this._watchers = new Set();
    this._path = socketPath();
  }

  async start(appInfo) {
    // A socket file left by a crashed run would make listen() fail with EADDRINUSE.
    if (process.platform !== 'win32') {
      await rm(this._path, { force: true });
    }

    this._server = createServer((socket) => this._onConnection(socket));
    this._server.on('error', (err) => {
      console.error('[control] server error:', err.message);
    });

    await new Promise((resolve, reject) => {
      this._server.once('error', reject);
      this._server.listen(this._path, () => {
        this._server.off('error', reject);
        resolve();
      });
    });

    await writeEndpoint({ ...appInfo, pid: process.pid, socket: this._path });
    return this._path;
  }

  async stop() {
    for (const socket of this._clients) socket.destroy();
    this._clients.clear();
    this._watchers.clear();

    if (this._server) {
      await new Promise((resolve) => this._server.close(resolve));
      this._server = null;
    }
    if (process.platform !== 'win32') {
      await rm(this._path, { force: true });
    }
    await clearEndpoint();
  }

  /** Push a change event to every client that asked to watch. */
  broadcast(event, payload) {
    if (this._watchers.size === 0) return;
    const line = encode({ event, payload });
    for (const socket of this._watchers) {
      if (socket.writable) socket.write(line);
    }
  }

  /** Refresh the endpoint file so `canvas status` can report the open file. */
  async publish(appInfo) {
    await writeEndpoint({ ...appInfo, pid: process.pid, socket: this._path });
  }

  _onConnection(socket) {
    this._clients.add(socket);
    socket.setEncoding('utf8');

    const cleanup = () => {
      this._clients.delete(socket);
      this._watchers.delete(socket);
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);

    const decode = createDecoder(
      (message) => this._onRequest(socket, message),
      (err) => this._reply(socket, null, { code: 'EPROTO', message: err.message }),
    );
    socket.on('data', decode);
  }

  async _onRequest(socket, message) {
    const id = message?.id ?? null;
    const cmd = message?.cmd;
    const args = message?.args || {};

    if (typeof cmd !== 'string') {
      this._reply(socket, id, { code: 'EINVAL', message: 'Request is missing a command' });
      return;
    }

    try {
      if (cmd === 'watch') {
        this._watchers.add(socket);
        this._replyOk(socket, id, { watching: true, ...this._describe() });
        return;
      }
      if (cmd === 'unwatch') {
        this._watchers.delete(socket);
        this._replyOk(socket, id, { watching: false });
        return;
      }
      this._replyOk(socket, id, await this._dispatch(cmd, args));
    } catch (err) {
      this._reply(socket, id, { code: err.code || 'EFAIL', message: err.message || String(err) });
    }
  }

  _replyOk(socket, id, result) {
    if (socket.writable) socket.write(encode({ id, ok: true, result: result ?? null }));
  }

  _reply(socket, id, error) {
    if (socket.writable) socket.write(encode({ id, ok: false, error }));
  }
}
