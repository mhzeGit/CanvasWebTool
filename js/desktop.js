/**
 * Wiring that only applies when the app runs inside the desktop shell.
 *
 * In a browser `native` is null and every function here returns immediately, so
 * the web build is unaffected — no extra listeners, no extra work per frame.
 */
import { state, onDocumentStatusChange } from './state.js';
import { native, isDesktop } from './native.js';
import { handleAgentCommand } from './agent-api.js';
import { openDocumentPath } from './document.js';
import { getEffectiveBackground, onChange as onSettingsChange } from './settings.js';
import { showAlertDialog } from './dialog.js';
import { requestRender } from './render-scheduler.js';

/** Coalesce the bursts of state changes an edit produces into one message. */
function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function initDesktopIntegration() {
  if (!isDesktop) return;

  reportDocumentState();
  onDocumentStatusChange(reportDocumentState);

  // The window's background colour has to match the theme, or the user sees a
  // flash of the wrong colour while the page loads on the next launch.
  const syncBackground = () => native.setBackgroundColor(normaliseHex(getEffectiveBackground()));
  syncBackground();
  onSettingsChange(syncBackground);

  native.onOpenFile(async (path) => {
    try {
      await openDocumentPath(path);
      requestRender(3);
    } catch (err) {
      await showAlertDialog(`Could not open the file.\n\n${err.message || err}`);
    }
  });

  native.setAgentHandler(async (cmd, args) => {
    const result = await handleAgentCommand(cmd, args);
    reportDocumentState();
    notifyChanged(cmd);
    return result;
  });
}

function reportDocumentState() {
  if (!isDesktop) return;
  native.reportDocumentState({
    filePath: state.currentFilePath,
    fileName: state.currentFileName,
    dirty: state.isDirty,
  });
}

/** Tell watchers (`canvas watch`) that the document changed. */
const notifyChanged = debounce((cmd) => {
  native.reportChange({ command: cmd, at: Date.now() });
}, 50);

/** The window background must be `#rrggbb`; expand the shorthand form. */
function normaliseHex(color) {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color || '');
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '#111111';
}
