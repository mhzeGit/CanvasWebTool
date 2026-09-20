/**
 * Client for the running app's control socket.
 *
 * Speaks the NDJSON protocol in `shared/wire.mjs`: one connection carries many
 * request/response pairs keyed by id, plus unsolicited event pushes for
 * `canvas watch`.
 */
import { connect } from 'node:net';
import { createDecoder, encode } from '../shared/wire.mjs';
import { socketPath } from '../shared/endpoint.mjs';

const CONNECT_TIMEOUT_MS = 5000;
const REQUEST_TIMEOUT_MS = 35_000;

/**
 * Open a connection to the app described by an endpoint record.
 * @param {object} [endpoint] as returned by readEndpoint()
 */
export function connectToApp(endpoint) {
  const path = endpoint?.socket || socketPath();

  return new Promise((resolvePromise, rejectPromise) => {
    const socket = connect(path);
    socket.setEncoding('utf8');

    const timer = setTimeout(() => {
      socket.destroy();
      rejectPromise(withCode(new Error(`Timed out connecting to the Canvas app at ${path}`), 'ETIMEDOUT'));
    }, CONNECT_TIMEOUT_MS);

    socket.once('error', (err) => {
      clearTimeout(timer);
      rejectPromise(withCode(
        new Error(`Could not reach the Canvas app (${err.code || err.message}). Is it still running?`),
        err.code,
      ));
    });

    socket.once('connect', () => {
      clearTimeout(timer);
      socket.removeAllListeners('error');
      resolvePromise(createClient(socket, path));
    });
  });
}

function withCode(error, code) {
  error.code = code;
  return error;
}

function createClient(socket, path) {
  const pending = new Map();
  const eventHandlers = new Set();
  let nextId = 1;
  let closeError = null;

  const closedPromise = new Promise((resolvePromise) => {
    socket.once('close', () => {
      for (const { reject, timer } of pending.values()) {
        clearTimeout(timer);
        reject(closeError || new Error('The Canvas app closed the connection'));
      }
      pending.clear();
      resolvePromise();
    });
  });

  socket.on('error', (err) => {
    closeError = withCode(new Error(`Connection to the Canvas app failed: ${err.message}`), err.code);
  });

  socket.on('data', createDecoder(
    (message) => {
      if (message.event) {
        for (const handler of eventHandlers) handler(message);
        return;
      }
      const entry = pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(message.id);

      if (message.ok) entry.resolve(message.result);
      else entry.reject(withCode(new Error(message.error?.message || 'The app reported an error'), message.error?.code));
    },
    (err) => process.stderr.write(`Ignoring malformed message from the app: ${err.message}\n`),
  ));

  return {
    path,

    request(cmd, args = {}) {
      const id = nextId++;
      return new Promise((resolvePromise, rejectPromise) => {
        if (socket.destroyed) {
          rejectPromise(new Error('The connection to the Canvas app is already closed'));
          return;
        }
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectPromise(withCode(new Error(`The app did not answer "${cmd}" in time`), 'ETIMEDOUT'));
        }, REQUEST_TIMEOUT_MS);

        pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
        socket.write(encode({ id, cmd, args }));
      });
    },

    onEvent(handler) {
      eventHandlers.add(handler);
    },

    closed() {
      return closedPromise;
    },

    close() {
      socket.end();
    },
  };
}
