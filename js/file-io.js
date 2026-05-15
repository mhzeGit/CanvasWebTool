import { FILE_EXTENSION } from './format.js';

const MIME_TYPE = 'application/json';
const FILE_DESCRIPTION = 'Canvas Web Document';
const ACCEPT_MIME = { [MIME_TYPE]: [FILE_EXTENSION] };

let cachedFileHandle = null;

export function hasCachedFileHandle() {
  return cachedFileHandle !== null;
}

export function clearCachedFileHandle() {
  cachedFileHandle = null;
}

export async function saveToFile(jsonData, suggestedName) {
  const jsonString = JSON.stringify(jsonData, null, 2);
  const blob = new Blob([jsonString], { type: MIME_TYPE });

  if (cachedFileHandle && typeof window !== 'undefined' && window.showSaveFilePicker) {
    try {
      const writable = await cachedFileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { name: cachedFileHandle.name, handle: cachedFileHandle };
    } catch (e) {
      cachedFileHandle = null;
    }
  }

  if (typeof window !== 'undefined' && window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: suggestedName || `document${FILE_EXTENSION}`,
        types: [{ description: FILE_DESCRIPTION, accept: ACCEPT_MIME }]
      });
      cachedFileHandle = handle;
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { name: handle.name, handle };
    } catch (e) {
      if (e.name === 'AbortError') return null;
      throw e;
    }
  }

  return saveViaDownload(blob, suggestedName);
}

export async function saveToFileAs(jsonData, suggestedName) {
  const oldHandle = cachedFileHandle;
  cachedFileHandle = null;
  const result = await saveToFile(jsonData, suggestedName);
  if (!result) {
    cachedFileHandle = oldHandle;
  }
  return result;
}

function saveViaDownload(blob, suggestedName) {
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
      const text = await file.text();
      return { data: JSON.parse(text), name: file.name, handle };
    } catch (e) {
      if (e.name === 'AbortError') return null;
      throw e;
    }
  }

  return loadViaFileInput();
}

function loadViaFileInput() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${FILE_EXTENSION},.json`;
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
      reader.onload = () => {
        try {
          resolve({ data: JSON.parse(reader.result), name: file.name, handle: null });
        } catch (e) {
          reject(e);
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
