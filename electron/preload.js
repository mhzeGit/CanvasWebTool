/**
 * The only channel between the page and the operating system.
 *
 * Runs sandboxed with context isolation on, so it has no Node access itself:
 * every call below is forwarded to the main process, which validates the
 * arguments before touching the disk. The page sees a small, explicit API and
 * nothing else — no `require`, no `process`, no ipcRenderer.
 *
 * `window.canvasNative` being present is also how the app's own modules detect
 * that they are running in the desktop build rather than a browser.
 */
const { contextBridge, ipcRenderer } = require('electron');

/** Renderer-side handler for commands arriving from the `canvas` CLI. */
let agentHandler = null;

/**
 * A file to open can arrive before the page has finished booting — the app is
 * launched with a path on the command line, or a second launch hands one over.
 * The listener is therefore attached now, at preload time, and anything that
 * arrives early waits here until the page is ready for it.
 */
let openFileHandler = null;
const pendingOpenFiles = [];

ipcRenderer.on('native:openFile', (_event, path) => {
  if (openFileHandler) openFileHandler(path);
  else pendingOpenFiles.push(path);
});

ipcRenderer.on('agent:request', async (_event, request) => {
  const { id, cmd, args } = request || {};
  if (!agentHandler) {
    ipcRenderer.send('agent:response', {
      id,
      ok: false,
      error: { code: 'ENOTREADY', message: 'The app is still starting up' },
    });
    return;
  }
  try {
    ipcRenderer.send('agent:response', { id, ok: true, result: await agentHandler(cmd, args || {}) });
  } catch (err) {
    ipcRenderer.send('agent:response', {
      id,
      ok: false,
      error: { code: err?.code || 'EFAIL', message: err?.message || String(err) },
    });
  }
});

contextBridge.exposeInMainWorld('canvasNative', {
  platform: process.platform,

  // --- file dialogs -------------------------------------------------------
  showOpenDialog: () => ipcRenderer.invoke('native:showOpenDialog'),
  showSaveDialog: (suggestedName) => ipcRenderer.invoke('native:showSaveDialog', suggestedName),

  // --- documents ----------------------------------------------------------
  readDocument: (path) => ipcRenderer.invoke('native:readDocument', path),
  writeDocument: (path, data) => ipcRenderer.invoke('native:writeDocument', path, data),
  statDocument: (path) => ipcRenderer.invoke('native:statDocument', path),

  // --- image assets stored beside the document ----------------------------
  assetDirFor: (path) => ipcRenderer.invoke('native:assetDirFor', path),
  readAssets: (dir) => ipcRenderer.invoke('native:readAssets', dir),
  writeAssets: (dir, assets) => ipcRenderer.invoke('native:writeAssets', dir, assets),

  // --- window -------------------------------------------------------------
  setBackgroundColor: (color) => ipcRenderer.invoke('native:setBackgroundColor', color),

  // --- notifications to the main process ----------------------------------
  reportDocumentState: (state) => ipcRenderer.send('native:documentState', state),
  reportChange: (payload) => ipcRenderer.send('native:changed', payload),

  // --- requests from the main process -------------------------------------
  onOpenFile: (handler) => {
    openFileHandler = handler;
    while (pendingOpenFiles.length > 0) handler(pendingOpenFiles.shift());
  },
  setAgentHandler: (handler) => {
    agentHandler = typeof handler === 'function' ? handler : null;
  },
});
