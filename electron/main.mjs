/**
 * Desktop entry point.
 *
 * The window renders the exact same `index.html`, CSS and modules the web build
 * uses — nothing about the interface is re-implemented here. What this process
 * adds is the things a web page cannot do: real filesystem access, a window
 * that remembers its size, and the control socket the `canvas` CLI drives.
 */
import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ControlServer } from './control-server.mjs';
import { registerHandler, registerScheme, START_URL, ORIGIN } from './protocol.mjs';
import {
  assetDirFor, readAssets, readDocument, statDocument, writeAssets, writeDocument,
  DOCUMENT_EXTENSION,
} from '../lib/document-store.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(DIR, '..');
const WINDOW_STATE_FILE = () => join(app.getPath('userData'), 'window-state.json');

const DEFAULT_WINDOW = { width: 1440, height: 900, maximized: false };
/** Matches `--bg-body` in css/style.css so the first paint has no flash. */
const FALLBACK_BACKGROUND = '#111111';
const DOCUMENT_FILTERS = [
  { name: 'Canvas Document', extensions: ['cvdoc'] },
  { name: 'JSON', extensions: ['json'] },
];

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {ControlServer | null} */
let controlServer = null;

/** Mirror of the renderer's document state, for `canvas status`. */
let documentState = { filePath: null, fileName: null, dirty: false };

// ---------------------------------------------------------------------------
// Window state
// ---------------------------------------------------------------------------

async function loadWindowState() {
  try {
    const saved = JSON.parse(await readFile(WINDOW_STATE_FILE(), 'utf8'));
    return {
      width: Number.isFinite(saved.width) ? saved.width : DEFAULT_WINDOW.width,
      height: Number.isFinite(saved.height) ? saved.height : DEFAULT_WINDOW.height,
      x: Number.isFinite(saved.x) ? saved.x : undefined,
      y: Number.isFinite(saved.y) ? saved.y : undefined,
      maximized: saved.maximized === true,
      backgroundColor: typeof saved.backgroundColor === 'string' ? saved.backgroundColor : FALLBACK_BACKGROUND,
    };
  } catch {
    return { ...DEFAULT_WINDOW, backgroundColor: FALLBACK_BACKGROUND };
  }
}

async function saveWindowState(extra = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.isMaximized() ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  const file = WINDOW_STATE_FILE();
  try {
    let previous = {};
    try {
      previous = JSON.parse(await readFile(file, 'utf8'));
    } catch { /* first save */ }
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ ...previous, ...bounds, maximized: mainWindow.isMaximized(), ...extra }, null, 2), 'utf8');
  } catch { /* window state is a convenience, never fatal */ }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

async function createWindow() {
  const saved = await loadWindowState();

  mainWindow = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    x: saved.x,
    y: saved.y,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: saved.backgroundColor,
    // Paint only once the page is ready, so the window never flashes empty.
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // The app never loads remote content, so there is no third-party frame
      // to isolate, but keeping the defaults strict costs nothing.
      webSecurity: true,
    },
  });

  if (saved.maximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => mainWindow.show());

  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(), 300);
  };
  mainWindow.on('resize', scheduleSave);
  mainWindow.on('move', scheduleSave);
  mainWindow.on('maximize', scheduleSave);
  mainWindow.on('unmaximize', scheduleSave);

  mainWindow.on('closed', () => {
    clearTimeout(saveTimer);
    mainWindow = null;
  });

  // Anything that would navigate away from the app, or open a new window, goes
  // to the user's browser instead — the window must always host the canvas.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN)) {
      event.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });

  await mainWindow.loadURL(START_URL);
  return mainWindow;
}

function focusWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return true;
}

// ---------------------------------------------------------------------------
// Renderer requests (preload -> main)
// ---------------------------------------------------------------------------

function registerRendererHandlers() {
  ipcMain.handle('native:showOpenDialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open',
      properties: ['openFile'],
      filters: DOCUMENT_FILTERS,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return { path: result.filePaths[0] };
  });

  ipcMain.handle('native:showSaveDialog', async (_event, suggestedName) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save',
      defaultPath: typeof suggestedName === 'string' && suggestedName
        ? suggestedName
        : `document${DOCUMENT_EXTENSION}`,
      filters: DOCUMENT_FILTERS,
    });
    if (result.canceled || !result.filePath) return null;
    return { path: result.filePath };
  });

  ipcMain.handle('native:readDocument', (_event, path) => readDocument(path));
  ipcMain.handle('native:writeDocument', (_event, path, data) => writeDocument(path, data));
  ipcMain.handle('native:statDocument', (_event, path) => statDocument(path));
  ipcMain.handle('native:assetDirFor', (_event, path) => assetDirFor(path));
  ipcMain.handle('native:readAssets', (_event, dir) => readAssets(dir));
  ipcMain.handle('native:writeAssets', (_event, dir, assets) => writeAssets(dir, assets));

  // The renderer owns the theme, so it tells us which colour to paint new
  // windows with; without it a light-theme user gets a dark flash on launch.
  ipcMain.handle('native:setBackgroundColor', (_event, color) => {
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return false;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(color);
    saveWindowState({ backgroundColor: color });
    return true;
  });

  ipcMain.on('native:documentState', (_event, next) => {
    documentState = {
      filePath: typeof next?.filePath === 'string' ? next.filePath : null,
      fileName: typeof next?.fileName === 'string' ? next.fileName : null,
      dirty: next?.dirty === true,
    };
    updateWindowTitle();
    controlServer?.publish(describeApp());
    controlServer?.broadcast('document-state', documentState);
  });

  ipcMain.on('native:changed', (_event, payload) => {
    controlServer?.broadcast('changed', payload ?? null);
  });
}

function updateWindowTitle() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const name = documentState.fileName || 'Untitled';
  mainWindow.setTitle(`${documentState.dirty ? '• ' : ''}${name} — Canvas`);
}

// ---------------------------------------------------------------------------
// Agent requests (control socket -> renderer)
// ---------------------------------------------------------------------------

/** Commands handled by the renderer, which owns the live document. */
const RENDERER_COMMANDS = new Set([
  'read', 'list', 'get', 'add', 'update', 'delete', 'connect',
  'save', 'save-as', 'open', 'new', 'import', 'undo', 'redo',
]);

const AGENT_TIMEOUT_MS = 30_000;
let nextAgentRequestId = 1;
const pendingAgentRequests = new Map();

function callRenderer(cmd, args) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    const err = new Error('The app window is not available');
    err.code = 'ENOWINDOW';
    return Promise.reject(err);
  }

  const id = nextAgentRequestId++;
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      pendingAgentRequests.delete(id);
      const err = new Error(`The app did not answer "${cmd}" within ${AGENT_TIMEOUT_MS / 1000}s`);
      err.code = 'ETIMEDOUT';
      rejectPromise(err);
    }, AGENT_TIMEOUT_MS);

    pendingAgentRequests.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
    mainWindow.webContents.send('agent:request', { id, cmd, args });
  });
}

function registerAgentBridge() {
  ipcMain.on('agent:response', (_event, message) => {
    const pending = pendingAgentRequests.get(message?.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingAgentRequests.delete(message.id);

    if (message.ok) {
      pending.resolve(message.result);
    } else {
      const err = new Error(message.error?.message || 'The app reported an error');
      err.code = message.error?.code || 'EFAIL';
      pending.reject(err);
    }
  });
}

function describeApp() {
  return {
    running: true,
    version: app.getVersion(),
    filePath: documentState.filePath,
    fileName: documentState.fileName,
    dirty: documentState.dirty,
  };
}

async function dispatchControlCommand(cmd, args) {
  switch (cmd) {
    case 'ping':
      return { pong: true };
    case 'status':
      return describeApp();
    case 'focus':
      return { focused: focusWindow() };
    case 'quit':
      app.quit();
      return { quitting: true };
    default:
      if (RENDERER_COMMANDS.has(cmd)) {
        if (cmd === 'open') focusWindow();
        return callRenderer(cmd, args);
      }
      {
        const err = new Error(`Unknown command: ${cmd}`);
        err.code = 'ENOCMD';
        throw err;
      }
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** A document path passed on the command line, if any. */
function documentFromArgv(argv) {
  const candidates = argv.slice(1).filter((arg) => !arg.startsWith('-'));
  const match = candidates.find((arg) => /\.(cvdoc|json)$/i.test(arg));
  return match ? resolve(match) : null;
}

/**
 * Hand a path to the renderer. Sent unconditionally: the preload script
 * attaches its listener before any page script runs and queues anything that
 * arrives before the app has booted, so there is no window to miss. Waiting on
 * `did-finish-load` here would in fact be the bug — that event has already
 * fired by the time `loadURL` resolves.
 */
function openPathInRenderer(path) {
  if (!path || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('native:openFile', path);
}

if (!app.requestSingleInstanceLock()) {
  // Another copy owns the window (and the control socket); hand off and exit.
  app.quit();
} else {
  registerScheme();

  app.on('second-instance', (_event, argv) => {
    focusWindow();
    openPathInRenderer(documentFromArgv(argv));
  });

  // macOS "Open With" delivers files this way rather than through argv.
  app.on('open-file', (event, path) => {
    event.preventDefault();
    focusWindow();
    openPathInRenderer(path);
  });

  app.whenReady().then(async () => {
    // The app supplies its own top bar; a native menu would sit above it and
    // change the layout the user already has.
    Menu.setApplicationMenu(null);

    registerHandler(APP_ROOT);
    registerRendererHandlers();
    registerAgentBridge();

    await createWindow();
    openPathInRenderer(documentFromArgv(process.argv));

    controlServer = new ControlServer({
      dispatch: dispatchControlCommand,
      describe: describeApp,
    });
    try {
      await controlServer.start(describeApp());
    } catch (err) {
      console.error('[control] could not start the CLI control socket:', err.message);
      controlServer = null;
    }

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) await createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', async (event) => {
    if (!controlServer) return;
    event.preventDefault();
    const server = controlServer;
    controlServer = null;
    await server.stop().catch(() => {});
    app.quit();
  });
}
