/**
 * Discovery of the running app's control socket.
 *
 * The desktop app writes an "endpoint file" while it is running; the CLI reads
 * it to decide whether to talk to a live app or fall back to editing files
 * directly on disk. The file is per-user, so two accounts on one machine do not
 * collide, and it is removed on a clean exit. A stale file (app killed) is
 * detected by checking whether the recorded pid is still alive.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';

const APP_DIR_NAME = '.canvaswebtool';

/** Directory holding the endpoint file. Honours an override for tests. */
export function stateDir() {
  return process.env.CANVASWEBTOOL_STATE_DIR || join(homedir(), APP_DIR_NAME);
}

export function endpointPath() {
  return join(stateDir(), 'endpoint.json');
}

/**
 * Path of the control socket. Windows has no unix sockets, so a named pipe is
 * used there; everywhere else a socket file in the temp directory.
 */
export function socketPath() {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\canvaswebtool-${safeUserName()}`;
  }
  return join(tmpdir(), `canvaswebtool-${safeUserName()}.sock`);
}

function safeUserName() {
  let name = 'user';
  try {
    name = userInfo().username || name;
  } catch { /* falls back to the default */ }
  return name.replace(/[^A-Za-z0-9_-]/g, '_');
}

export async function writeEndpoint(info) {
  const path = endpointPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ ...info, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
}

export async function clearEndpoint() {
  await rm(endpointPath(), { force: true });
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // Signal 0 performs the permission/existence check without delivering it.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to someone else.
    return err.code === 'EPERM';
  }
}

/**
 * The live endpoint, or null when no app is running. Stale files left behind by
 * a crashed app are treated as "not running".
 */
export async function readEndpoint() {
  let info;
  try {
    info = JSON.parse(await readFile(endpointPath(), 'utf8'));
  } catch {
    return null;
  }
  if (!info || !isProcessAlive(info.pid)) return null;
  return info;
}
