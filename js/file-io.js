import { FILE_EXTENSION, extractImageAssets, embedImageAssets } from './format.js';
import { showAlertDialog, isMobile } from './dialog.js';

const MIME_TYPE = 'application/json';
const FILE_DESCRIPTION = 'Canvas Web Document';
const ACCEPT_MIME = { [MIME_TYPE]: [FILE_EXTENSION] };

let cachedFileHandle = null;
let cachedAssetDirHandle = null;
let currentAssetDirName = '';
let cachedFileLastModified = null;

export function hasCachedFileHandle() {
  return cachedFileHandle !== null;
}

export function clearCachedFileHandle() {
  cachedFileHandle = null;
  cachedAssetDirHandle = null;
  currentAssetDirName = '';
  cachedFileLastModified = null;
}

export async function saveToFile(jsonData, suggestedName) {
  let assets = [];

  // Only extract assets when using File System API (not download fallback)
  const hasFileApi = typeof window !== 'undefined' && window.showSaveFilePicker;

  if (hasFileApi) {
    if (cachedFileHandle && cachedAssetDirHandle) {
      assets = extractImageAssets(jsonData);
      await writeAssets(cachedAssetDirHandle, assets);
      const jsonString = JSON.stringify(jsonData, null, 2);
      const blob = new Blob([jsonString], { type: MIME_TYPE });
      try {
        const writable = await cachedFileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        await updateCachedFileTimestamp();
        return { name: cachedFileHandle.name, handle: cachedFileHandle };
      } catch (e) {
        cachedFileHandle = null;
        cachedAssetDirHandle = null;
      }
    }

    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: suggestedName || `document${FILE_EXTENSION}`,
        types: [{ description: FILE_DESCRIPTION, accept: ACCEPT_MIME }]
      });
      cachedFileHandle = handle;
      const baseName = handle.name.replace(/\.[^.]+$/, '');
      currentAssetDirName = baseName + '_assets';

      assets = extractImageAssets(jsonData);

      let assetDirHandle = null;
      try {
        assetDirHandle = await navigator.storage.getDirectory();
        assetDirHandle = await assetDirHandle.getDirectoryHandle(currentAssetDirName, { create: true });
      } catch (_) {
        try {
          assetDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        } catch (_2) {}
      }
      cachedAssetDirHandle = assetDirHandle;

      if (assetDirHandle && assets.length > 0) {
        await writeAssets(assetDirHandle, assets);
      }

      const jsonString = JSON.stringify(jsonData, null, 2);
      const blob = new Blob([jsonString], { type: MIME_TYPE });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      await updateCachedFileTimestamp();
      return { name: handle.name, handle };
    } catch (e) {
      if (e.name === 'AbortError') return null;
      cachedFileHandle = null;
      cachedAssetDirHandle = null;
      throw e;
    }
  }

  // Download fallback: embed data URIs as-is (no external assets)
  return saveViaDownload(JSON.stringify(jsonData, null, 2), suggestedName);
}

export async function saveToFileAs(jsonData, suggestedName) {
  const oldHandle = cachedFileHandle;
  const oldAssetDir = cachedAssetDirHandle;
  cachedFileHandle = null;
  cachedAssetDirHandle = null;
  const result = await saveToFile(jsonData, suggestedName);
  if (!result) {
    cachedFileHandle = oldHandle;
    cachedAssetDirHandle = oldAssetDir;
  }
  return result;
}

async function writeAssets(dirHandle, assets) {
  for (const asset of assets) {
    try {
      const fileHandle = await dirHandle.getFileHandle(asset.fileName, { create: true });
      const writable = await fileHandle.createWritable();
      const blob = dataUrlToBlob(asset.dataUrl);
      await writable.write(blob);
      await writable.close();
    } catch (e) {
      console.warn('Failed to write asset:', asset.fileName, e);
    }
  }
}

function dataUrlToBlob(dataUrl) {
  const parts = dataUrl.split(',');
  const mime = parts[0].match(/:(.*?);/)[1];
  const raw = atob(parts[1]);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function saveViaDownload(jsonString, suggestedName) {
  const blob = new Blob([jsonString], { type: MIME_TYPE });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName || `document${FILE_EXTENSION}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { name: a.download, handle: null };
}

export async function loadFromFile() {
  if (typeof window !== 'undefined' && window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: FILE_DESCRIPTION, accept: ACCEPT_MIME }]
      });
      cachedFileHandle = handle;
      const file = await handle.getFile();
      cachedFileLastModified = file.lastModified;
      const text = await file.text();
      const docState = JSON.parse(text);
      const baseName = file.name.replace(/\.[^.]+$/, '');
      currentAssetDirName = baseName + '_assets';

      cachedAssetDirHandle = null;
      try {
        const opfsRoot = await navigator.storage.getDirectory();
        cachedAssetDirHandle = await opfsRoot.getDirectoryHandle(currentAssetDirName);
      } catch (_) {
        try {
          cachedAssetDirHandle = await window.showDirectoryPicker({ mode: 'read' });
        } catch (_2) {}
      }

      if (cachedAssetDirHandle) {
        const assetsMap = await readAssets(cachedAssetDirHandle);
        if (Object.keys(assetsMap).length > 0) {
          embedImageAssets(docState, assetsMap);
        }
      }

      return { data: docState, name: file.name, handle };
    } catch (e) {
      if (e.name === 'AbortError' || e.name === 'NotFoundError') return null;
      throw e;
    }
  }

  return loadViaFileInput();
}

async function readAssets(dirHandle) {
  const assetsMap = {};
  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file') {
        const fileHandle = await dirHandle.getFileHandle(entry.name);
        const file = await fileHandle.getFile();
        const dataUrl = await fileToDataUrl(file);
        assetsMap[entry.name] = dataUrl;
      }
    }
  } catch (e) {
    console.warn('Failed to read assets:', e);
  }
  return assetsMap;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadViaFileInput() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = isMobile() ? '*/*' : `${FILE_EXTENSION},.json,application/json,text/*`;
    input.style.position = 'fixed';
    input.style.top = '-100px';
    input.style.left = '-100px';

    let resolved = false;

    input.addEventListener('change', () => {
      resolved = true;
      cleanup();
      const file = input.files[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          resolve({ data: JSON.parse(reader.result), name: file.name, handle: null });
        } catch (e) {
          if (isMobile()) {
            await showAlertDialog(`Invalid file format.\n\n"${file.name}" is not a valid Canvas Web document.`);
            resolve(null);
          } else {
            reject(e);
          }
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });

    const cleanup = () => {
      window.removeEventListener('focus', onFocus);
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    const onFocus = () => {
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(null);
        }
      }, 200);
    };
    window.addEventListener('focus', onFocus);

    document.body.appendChild(input);
    input.click();
  });
}

async function updateCachedFileTimestamp() {
  if (!cachedFileHandle) return;
  try {
    const file = await cachedFileHandle.getFile();
    cachedFileLastModified = file.lastModified;
  } catch (_) {}
}

export async function checkFileModified() {
  if (!cachedFileHandle || cachedFileLastModified === null) return false;
  try {
    const file = await cachedFileHandle.getFile();
    return file.lastModified !== cachedFileLastModified;
  } catch (_) {
    return false;
  }
}

export async function reloadFromCachedHandle() {
  if (!cachedFileHandle) return null;
  try {
    const file = await cachedFileHandle.getFile();
    const text = await file.text();
    const docState = JSON.parse(text);

    if (cachedAssetDirHandle) {
      try {
        const assetsMap = await readAssets(cachedAssetDirHandle);
        if (Object.keys(assetsMap).length > 0) {
          embedImageAssets(docState, assetsMap);
        }
      } catch (_) {}
    } else if (currentAssetDirName) {
      try {
        const opfsRoot = await navigator.storage.getDirectory();
        const dirHandle = await opfsRoot.getDirectoryHandle(currentAssetDirName);
        const assetsMap = await readAssets(dirHandle);
        if (Object.keys(assetsMap).length > 0) {
          embedImageAssets(docState, assetsMap);
        }
      } catch (_) {}
    }

    cachedFileLastModified = file.lastModified;
    return { data: docState, name: file.name, handle: cachedFileHandle };
  } catch (_) {
    return null;
  }
}

export async function syncFileTimestamp() {
  await updateCachedFileTimestamp();
}
