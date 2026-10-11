/**
 * Reading and writing documents.
 *
 * Two backends sit behind one interface:
 *
 *  - **native** (desktop build) writes straight to the chosen path and keeps
 *    image assets in a sibling `<name>_assets/` folder. Because it knows the
 *    real path, the `canvas` CLI can open the very same document later.
 *  - **web** (browser) uses the File System Access API with OPFS for assets,
 *    falling back to Web Share and finally to a plain download.
 *
 * The rest of the app calls the exported functions and never needs to know
 * which backend is active.
 */
import { FILE_EXTENSION, extractImageAssets, embedImageAssets } from './format.js';
import { showAlertDialog, isMobile } from './dialog.js';
import { native, isDesktop } from './native.js';

const MIME_TYPE = 'application/json';
const FILE_DESCRIPTION = 'Canvas Web Document';
const ACCEPT_MIME = { [MIME_TYPE]: [FILE_EXTENSION] };
const ASSET_DIR_SUFFIX = '_assets';

/** Where the current document lives, in whichever form the backend understands. */
const current = {
  /** @type {FileSystemFileHandle | null} web backend */
  handle: null,
  /** @type {string | null} native backend */
  path: null,
  /** @type {FileSystemDirectoryHandle | null} */
  assetDir: null,
  assetDirName: '',
  lastModified: null,
};

export function hasCachedFileHandle() {
  return current.handle !== null || current.path !== null;
}

/** Absolute path of the open document, or null in the browser. */
export function getCurrentFilePath() {
  return current.path;
}

export function clearCachedFileHandle() {
  current.handle = null;
  current.path = null;
  current.assetDir = null;
  current.assetDirName = '';
  current.lastModified = null;
}

function baseNameOf(fileName) {
  return fileName.replace(/\.[^.]+$/, '');
}

// ---------------------------------------------------------------------------
// Native backend
// ---------------------------------------------------------------------------

const nativeBackend = {
  async save(jsonData, suggestedName) {
    let path = current.path;
    if (!path) {
      const chosen = await native.showSaveDialog(suggestedName || `document${FILE_EXTENSION}`);
      if (!chosen) return null;
      path = chosen.path;
    }

    // Assets move out of the JSON and into <name>_assets/ beside the document.
    const assets = extractImageAssets(jsonData);
    const assetDir = await native.assetDirFor(path);
    await native.writeAssets(assetDir, assets);

    const written = await native.writeDocument(path, jsonData);
    current.path = written.path;
    current.assetDirName = assetDir;
    current.lastModified = written.mtimeMs;
    return { name: written.name, path: written.path, handle: null };
  },

  async load(path) {
    let target = path;
    if (!target) {
      const chosen = await native.showOpenDialog();
      if (!chosen) return null;
      target = chosen.path;
    }

    const result = await native.readDocument(target);
    const assetDir = await native.assetDirFor(result.path);
    const assets = await native.readAssets(assetDir);
    if (Object.keys(assets).length > 0) embedImageAssets(result.data, assets);

    current.path = result.path;
    current.assetDirName = assetDir;
    current.lastModified = result.mtimeMs;
    return { data: result.data, name: result.name, path: result.path, handle: null };
  },

  async isModified() {
    if (!current.path || current.lastModified === null) return false;
    const info = await native.statDocument(current.path);
    return info !== null && info.mtimeMs !== current.lastModified;
  },

  async reload() {
    if (!current.path) return null;
    try {
      return await this.load(current.path);
    } catch {
      return null;
    }
  },

  async syncTimestamp() {
    if (!current.path) return;
    const info = await native.statDocument(current.path);
    if (info) current.lastModified = info.mtimeMs;
  },
};

// ---------------------------------------------------------------------------
// Web backend
// ---------------------------------------------------------------------------

const webBackend = {
  async save(jsonData, suggestedName) {
    if (typeof window !== 'undefined' && window.showSaveFilePicker) {
      const saved = await this._saveWithPicker(jsonData, suggestedName);
      if (saved !== undefined) return saved;
    }

    const fileName = suggestedName || `document${FILE_EXTENSION}`;
    const jsonString = JSON.stringify(jsonData, null, 2);

    // Mobile: hand the file to the OS share sheet so it can be filed away.
    if (typeof navigator !== 'undefined' && navigator.canShare && navigator.share) {
      const file = new File([jsonString], fileName, { type: MIME_TYPE });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: fileName });
          return { name: fileName, handle: null, path: null };
        } catch (err) {
          if (err.name === 'AbortError') return null;
        }
      }
    }

    return saveViaDownload(jsonString, fileName);
  },

  /** @returns {object|null|undefined} undefined means "fall through to the next strategy". */
  async _saveWithPicker(jsonData, suggestedName) {
    if (current.handle && current.assetDir) {
      try {
        await writeOpfsAssets(current.assetDir, extractImageAssets(jsonData));
        await writeHandle(current.handle, jsonData);
        await this.syncTimestamp();
        return { name: current.handle.name, handle: current.handle, path: null };
      } catch {
        // The handle went stale (file moved or permission revoked) — ask again.
        current.handle = null;
        current.assetDir = null;
      }
    }

    let handle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: suggestedName || `document${FILE_EXTENSION}`,
        types: [{ description: FILE_DESCRIPTION, accept: ACCEPT_MIME }],
      });
    } catch (err) {
      if (err.name === 'AbortError') return null;
      current.handle = null;
      current.assetDir = null;
      throw err;
    }

    current.handle = handle;
    current.assetDirName = baseNameOf(handle.name) + ASSET_DIR_SUFFIX;
    current.assetDir = await openOpfsDir(current.assetDirName, { create: true });

    const assets = extractImageAssets(jsonData);
    if (current.assetDir && assets.length > 0) await writeOpfsAssets(current.assetDir, assets);

    await writeHandle(handle, jsonData);
    await this.syncTimestamp();
    return { name: handle.name, handle, path: null };
  },

  async load() {
    if (typeof window !== 'undefined' && window.showOpenFilePicker) {
      let handle;
      try {
        [handle] = await window.showOpenFilePicker({
          types: [{ description: FILE_DESCRIPTION, accept: ACCEPT_MIME }],
        });
      } catch (err) {
        if (err.name === 'AbortError' || err.name === 'NotFoundError') return null;
        throw err;
      }

      const file = await handle.getFile();
      const data = JSON.parse(await file.text());

      current.handle = handle;
      current.lastModified = file.lastModified;
      current.assetDirName = baseNameOf(file.name) + ASSET_DIR_SUFFIX;
      current.assetDir = await openOpfsDir(current.assetDirName);

      if (current.assetDir) {
        const assets = await readOpfsAssets(current.assetDir);
        if (Object.keys(assets).length > 0) embedImageAssets(data, assets);
      }
      return { data, name: file.name, handle, path: null };
    }

    return loadViaFileInput();
  },

  async isModified() {
    if (!current.handle || current.lastModified === null) return false;
    try {
      const file = await current.handle.getFile();
      return file.lastModified !== current.lastModified;
    } catch {
      return false;
    }
  },

  async reload() {
    if (!current.handle) return null;
    try {
      const file = await current.handle.getFile();
      const data = JSON.parse(await file.text());

      const dir = current.assetDir || (current.assetDirName ? await openOpfsDir(current.assetDirName) : null);
      if (dir) {
        const assets = await readOpfsAssets(dir);
        if (Object.keys(assets).length > 0) embedImageAssets(data, assets);
      }

      current.lastModified = file.lastModified;
      return { data, name: file.name, handle: current.handle, path: null };
    } catch {
      return null;
    }
  },

  async syncTimestamp() {
    if (!current.handle) return;
    try {
      current.lastModified = (await current.handle.getFile()).lastModified;
    } catch { /* timestamp tracking is best-effort */ }
  },
};

async function writeHandle(handle, jsonData) {
  const writable = await handle.createWritable();
  await writable.write(new Blob([JSON.stringify(jsonData, null, 2)], { type: MIME_TYPE }));
  await writable.close();
}

// ---------------------------------------------------------------------------
// OPFS asset storage (web backend only)
// ---------------------------------------------------------------------------

async function openOpfsDir(name, options) {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(name, options);
  } catch {
    return null; // OPFS unavailable, or the directory does not exist yet
  }
}

async function writeOpfsAssets(dirHandle, assets) {
  for (const asset of assets) {
    try {
      const fileHandle = await dirHandle.getFileHandle(asset.fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(dataUrlToBlob(asset.dataUrl));
      await writable.close();
    } catch (err) {
      console.warn('Failed to write asset:', asset.fileName, err);
    }
  }
}

async function readOpfsAssets(dirHandle) {
  const assets = {};
  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind !== 'file') continue;
      const file = await (await dirHandle.getFileHandle(entry.name)).getFile();
      assets[entry.name] = await fileToDataUrl(file);
    }
  } catch (err) {
    console.warn('Failed to read assets:', err);
  }
  return assets;
}

function dataUrlToBlob(dataUrl) {
  const [header, body] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const raw = atob(body);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function saveViaDownload(jsonString, fileName) {
  const url = URL.createObjectURL(new Blob([jsonString], { type: MIME_TYPE }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { name: fileName, handle: null, path: null };
}

function loadViaFileInput() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = isMobile() ? '*/*' : `${FILE_EXTENSION},.json,application/json,text/*`;
    input.style.position = 'fixed';
    input.style.top = '-100px';
    input.style.left = '-100px';

    let settled = false;
    const cleanup = () => {
      window.removeEventListener('focus', onFocus);
      input.remove();
    };

    input.addEventListener('change', async () => {
      settled = true;
      cleanup();
      const file = input.files[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        const data = JSON.parse(await file.text());
        resolve({ data, name: file.name, handle: null, path: null });
      } catch (err) {
        if (!isMobile()) {
          reject(err);
          return;
        }
        await showAlertDialog(`Invalid file format.\n\n"${file.name}" is not a valid Canvas Web document.`);
        resolve(null);
      }
    });

    // The picker was dismissed if focus returns without a change event.
    const onFocus = () => setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    }, 200);
    window.addEventListener('focus', onFocus);

    document.body.appendChild(input);
    input.click();
  });
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

const backend = isDesktop ? nativeBackend : webBackend;

export function saveToFile(jsonData, suggestedName) {
  return backend.save(jsonData, suggestedName);
}

/** Save under a new name, restoring the previous target if the user cancels. */
export async function saveToFileAs(jsonData, suggestedName) {
  const previous = { ...current };
  current.handle = null;
  current.path = null;
  current.assetDir = null;

  const result = await backend.save(jsonData, suggestedName);
  if (!result) Object.assign(current, previous);
  return result;
}

/** @param {string} [path] desktop only: open this file instead of prompting. */
export function loadFromFile(path) {
  return backend.load(path);
}

export function checkFileModified() {
  return backend.isModified();
}

export function reloadFromCachedHandle() {
  return backend.reload();
}

export function syncFileTimestamp() {
  return backend.syncTimestamp();
}
