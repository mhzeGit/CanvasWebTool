/**
 * Documents on disk: the one place that knows the on-disk layout.
 *
 * In the browser the app saves through the File System Access API and keeps
 * image assets in OPFS, because a web page never learns where a file really
 * lives. On disk we do know, so a document is written to its chosen path and
 * its images land in a sibling `<name>_assets/` folder.
 *
 * Both the desktop app (via the main process, on behalf of the sandboxed
 * renderer) and the `canvas` CLI go through this module, so the app and the CLI
 * can never disagree about where a document's pieces live. Every path is
 * validated before it is touched.
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';

export const DOCUMENT_EXTENSION = '.cvdoc';
const ALLOWED_DOCUMENT_EXTENSIONS = new Set([DOCUMENT_EXTENSION, '.json']);
const ALLOWED_ASSET_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif']);
const ASSET_DIR_SUFFIX = '_assets';

class BridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BridgeError('EINVAL', `${label} must be a non-empty string`);
  }
  if (value.includes('\0')) throw new BridgeError('EINVAL', `${label} contains a null byte`);
  return value;
}

/** A document path we are willing to read or write. */
export function validateDocumentPath(path) {
  const full = resolve(requireString(path, 'path'));
  if (!ALLOWED_DOCUMENT_EXTENSIONS.has(extname(full).toLowerCase())) {
    throw new BridgeError('EINVAL', `Not a document file: ${basename(full)}`);
  }
  return full;
}

/** The assets folder that belongs to a document, e.g. `plan_assets/`. */
export function assetDirFor(documentPath) {
  const full = resolve(documentPath);
  const base = basename(full).replace(/\.[^.]+$/, '');
  return join(dirname(full), base + ASSET_DIR_SUFFIX);
}

function validateAssetDir(path) {
  const full = resolve(requireString(path, 'dir'));
  if (!basename(full).endsWith(ASSET_DIR_SUFFIX)) {
    throw new BridgeError('EINVAL', `Not an assets folder: ${basename(full)}`);
  }
  return full;
}

function validateAssetName(name) {
  requireString(name, 'asset name');
  if (name !== basename(name) || name === '.' || name === '..') {
    throw new BridgeError('EINVAL', `Asset name must not contain a path: ${name}`);
  }
  if (!ALLOWED_ASSET_EXTENSIONS.has(extname(name).toLowerCase())) {
    throw new BridgeError('EINVAL', `Unsupported asset type: ${name}`);
  }
  return name;
}

export async function readDocument(path) {
  const full = validateDocumentPath(path);
  const [text, info] = await Promise.all([readFile(full, 'utf8'), stat(full)]);
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new BridgeError('EPARSE', `${basename(full)} is not a valid document: ${err.message}`);
  }
  return { data, path: full, name: basename(full), mtimeMs: info.mtimeMs };
}

export async function writeDocument(path, data) {
  const full = validateDocumentPath(path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, JSON.stringify(data, null, 2), 'utf8');
  const info = await stat(full);
  return { path: full, name: basename(full), mtimeMs: info.mtimeMs };
}

export async function statDocument(path) {
  try {
    const info = await stat(validateDocumentPath(path));
    return { mtimeMs: info.mtimeMs, size: info.size };
  } catch {
    return null;
  }
}

/** Read `<doc>_assets/` as a `{ fileName: dataUrl }` map, or `{}` if absent. */
export async function readAssets(dir) {
  const full = validateAssetDir(dir);
  let entries;
  try {
    entries = await readdir(full, { withFileTypes: true });
  } catch {
    return {};
  }

  const assets = {};
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile()) return;
    let name;
    try {
      name = validateAssetName(entry.name);
    } catch {
      return; // ignore unrelated files rather than failing the whole load
    }
    const bytes = await readFile(join(full, name));
    assets[name] = `data:${mimeForAsset(name)};base64,${bytes.toString('base64')}`;
  }));
  return assets;
}

/** Write assets, removing any that the document no longer references. */
export async function writeAssets(dir, assets) {
  const full = validateAssetDir(dir);
  if (!Array.isArray(assets)) throw new BridgeError('EINVAL', 'assets must be an array');

  if (assets.length === 0) {
    await rm(full, { recursive: true, force: true });
    return { written: 0, removed: 0 };
  }

  await mkdir(full, { recursive: true });
  const keep = new Set();
  for (const asset of assets) {
    const name = validateAssetName(asset?.fileName);
    keep.add(name);
    await writeFile(join(full, name), decodeDataUrl(asset.dataUrl));
  }

  let removed = 0;
  for (const entry of await readdir(full, { withFileTypes: true })) {
    if (entry.isFile() && !keep.has(entry.name) && ALLOWED_ASSET_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      await rm(join(full, entry.name), { force: true });
      removed++;
    }
  }
  return { written: keep.size, removed };
}

const ASSET_MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

function mimeForAsset(name) {
  return ASSET_MIME_TYPES[extname(name).toLowerCase()] || 'application/octet-stream';
}

function decodeDataUrl(dataUrl) {
  requireString(dataUrl, 'dataUrl');
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma < 0) {
    throw new BridgeError('EINVAL', 'Asset payload must be a data URL');
  }
  const header = dataUrl.slice(5, comma);
  const body = dataUrl.slice(comma + 1);
  return header.endsWith(';base64')
    ? Buffer.from(body, 'base64')
    : Buffer.from(decodeURIComponent(body), 'utf8');
}
