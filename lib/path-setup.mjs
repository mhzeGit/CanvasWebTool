/**
 * Putting the `canvas` launcher on the user's PATH.
 *
 * On Windows the per-user PATH lives in `HKCU\Environment`. It is edited with
 * `reg`, preserving the existing value's type: rewriting a REG_EXPAND_SZ PATH
 * as REG_SZ would freeze `%USERPROFILE%`-style entries at their current values
 * and quietly break other programs.
 *
 * On macOS and Linux shells source their own startup files, so the line to add
 * is printed rather than written — editing someone's shell config behind their
 * back is not this tool's business.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, delimiter, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);

/** The directory holding the `canvas` launcher for this installation. */
export function launcherDir() {
  const here = dirname(fileURLToPath(import.meta.url));
  // Installed layout: <resources>/app.asar/lib -> <resources>/cli
  const asar = here.split(/[\\/]app\.asar[\\/]/)[0];
  return asar !== here ? resolve(asar, 'cli') : resolve(here, '..', 'electron', 'resources', 'cli');
}

const REG_KEY = 'HKCU\\Environment';

async function readWindowsPath() {
  const { stdout } = await run('reg', ['query', REG_KEY, '/v', 'Path']);
  // "    Path    REG_EXPAND_SZ    C:\\a;C:\\b"
  const match = /^\s*Path\s+(REG_[A-Z_]+)\s+(.*)$/m.exec(stdout);
  if (!match) throw new Error('Could not read the current PATH from the registry');
  return { type: match[1], value: match[2].trimEnd() };
}

function pathEntries(value) {
  return value.split(delimiter).filter(Boolean);
}

function alreadyListed(entries, dir) {
  const target = resolve(dir).toLowerCase().replace(/\\+$/, '');
  return entries.some((entry) => resolve(entry).toLowerCase().replace(/\\+$/, '') === target);
}

export async function installOnPath(dir = launcherDir()) {
  if (process.platform !== 'win32') {
    return {
      changed: false,
      directory: dir,
      instructions: `Add this line to your shell startup file, then open a new terminal:\n\n  export PATH="${dir}:$PATH"`,
    };
  }

  const { type, value } = await readWindowsPath();
  const entries = pathEntries(value);
  if (alreadyListed(entries, dir)) {
    return { changed: false, directory: dir, message: 'Already on your PATH.' };
  }

  entries.push(dir);
  await run('reg', ['add', REG_KEY, '/v', 'Path', '/t', type, '/d', entries.join(delimiter), '/f']);
  return {
    changed: true,
    directory: dir,
    message: 'Added to your PATH. Open a new terminal for it to take effect.',
  };
}

export async function uninstallFromPath(dir = launcherDir()) {
  if (process.platform !== 'win32') {
    return {
      changed: false,
      directory: dir,
      instructions: `Remove the line that adds "${dir}" from your shell startup file.`,
    };
  }

  const { type, value } = await readWindowsPath();
  const entries = pathEntries(value);
  const kept = entries.filter((entry) => !alreadyListed([entry], dir));
  if (kept.length === entries.length) {
    return { changed: false, directory: dir, message: 'Not on your PATH.' };
  }

  await run('reg', ['add', REG_KEY, '/v', 'Path', '/t', type, '/d', kept.join(delimiter), '/f']);
  return { changed: true, directory: dir, message: 'Removed from your PATH.' };
}

export function describePath(dir = launcherDir()) {
  const entries = pathEntries(process.env.PATH || '');
  return { directory: dir, onPath: alreadyListed(entries, dir) };
}
