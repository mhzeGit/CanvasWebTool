import { state, onDocumentStatusChange } from './state.js';
import { drawGrid } from './grid.js';
import { requestRender, startRenderLoop } from './render-scheduler.js';
import { initSettings } from './settings.js';
import { openSettings } from './settings-dialog.js';
import { drawSelectionMarquee, drawNodePreview } from './nodes.js';
import { drawArrows, updateArrowPositionsFromConnections } from './arrows.js';
import { drawShapePreview } from './shapes.js';
import { drawTextBoxPreview } from './textboxes.js';
import { drawConnectors, drawConnectorPreview, drawArrowPreview, updateConnectorPositionsFromConnections } from './connectors.js';
import { initPointer } from './pointer.js';
import { setupKeyboard } from './keyboard.js';
import { setupContextMenu, initContextMenu } from './context-menu.js';
import { setupZoomPan } from './zoom-pan.js';
import { setupInlineEditing } from './inline-editing.js';
import { refreshSidePanel } from './side-panel.js';
import { initPanelResize } from './panel-resize.js';
import { history, initHistory } from './history.js';
import { initTouch } from './touch.js';
import {
  addNodeAt, addArrowAt, addNodeAtCenter, addArrowAtCenter, addShapeAtCenter, addConnectorAtCenter,
  deleteSelectedNodes, deleteSelectedShapes, deleteSelectedTextBoxes, deleteSelectedConnectors,
  deleteSelectedArrows, deleteConnection,
  duplicateSelectedNodes, copySelectedNodes, pasteNodesAt,
  addShapeAt, addConnector,
  addImageContainerAt, addImageContainerAtCenter,
  newDocument, saveDocument, openDocument, reloadDocument,
} from './document.js';
import { performUndo, performRedo } from './history.js';
import { initToolbar } from './toolbar.js';
import { initEntityLayer, syncAllEntities } from './dom-entities.js';
import { imageLOD } from './image-lod.js';
import { hasCachedFileHandle, checkFileModified } from './file-io.js';
import { downloadPortableJSON, openPortableJSON } from './json-port.js';
import { initDesktopIntegration } from './desktop.js';

const MOBILE_BREAKPOINT_PX = 768;
const TOP_BAR_PX = 40;
const MOBILE_TOOLBAR_PX = 52;

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const sideEl = document.getElementById('sidePanel');
  const toolbarEl = document.getElementById('leftToolbar');
  const isMobile = window.innerWidth <= MOBILE_BREAKPOINT_PX;
  const sideVisible = sideEl && sideEl.classList.contains('mobile-visible');

  let sideWidthPx;
  if (sideVisible) sideWidthPx = sideEl.getBoundingClientRect().width;
  else if (isMobile) sideWidthPx = 0;
  else if (sideEl) sideWidthPx = sideEl.getBoundingClientRect().width;
  else sideWidthPx = Math.floor(window.innerWidth * 0.30);

  const toolbarWidthPx = isMobile || !toolbarEl ? 0 : toolbarEl.getBoundingClientRect().width;
  const cssWidth = window.innerWidth - sideWidthPx - toolbarWidthPx;
  const cssHeight = window.innerHeight - TOP_BAR_PX - (isMobile ? MOBILE_TOOLBAR_PX : 0);

  for (const canvas of [state.canvas, state.arrowCanvas]) {
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
  }

  // Resizing a canvas clears it, so the next frame must redraw.
  requestRender(2);
}

/** Drop connections whose endpoints no longer exist, keeping the selection valid. */
function pruneDanglingConnections() {
  for (let i = state.connections.length - 1; i >= 0; i--) {
    const conn = state.connections[i];
    if (state.textBoxes[conn.from] && state.textBoxes[conn.to]) continue;

    state.connections.splice(i, 1);
    if (state.selectedConnection === i) state.selectedConnection = null;
    else if (state.selectedConnection > i) state.selectedConnection--;
  }
}

function clearCanvas(ctx, canvas) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function drawFrame() {
  const dpr = window.devicePixelRatio || 1;

  clearCanvas(state.ctx, state.canvas);
  drawGrid(state.ctx, state.canvas, state.offsetX, state.offsetY, state.scale, dpr);

  const actx = state.arrowCtx;
  clearCanvas(actx, state.arrowCanvas);
  actx.setTransform(dpr, 0, 0, dpr, 0, 0);
  actx.translate(state.offsetX, state.offsetY);
  actx.scale(state.scale, state.scale);

  pruneDanglingConnections();

  updateArrowPositionsFromConnections();
  updateConnectorPositionsFromConnections();
  drawArrows();
  drawConnectors();

  syncAllEntities();

  imageLOD.update();

  drawSelectionMarquee();

  drawConnectorPreview();
  drawArrowPreview();
  drawShapePreview();
  drawNodePreview();
  drawTextBoxPreview();
  drawImageContainerPreview();

  const key = state.computeSelectionKey();
  if (key !== state.lastPanelKey) {
    refreshSidePanel();
    state.lastPanelKey = key;
  }
}

function drawImageContainerPreview() {
  if (state.drawingTool !== 'imageContainer') return;
  drawShapePreview();
}

function initTopBar() {
  const addNodeBtn = document.getElementById('actionAddNode');
  const addArrowBtn = document.getElementById('actionAddArrow');
  const addRectBtn = document.getElementById('actionAddRectangle');
  const addCircleBtn = document.getElementById('actionAddCircle');
  const addTriangleBtn = document.getElementById('actionAddTriangle');
  const addDiamondBtn = document.getElementById('actionAddDiamond');
  const addConnectorBtn = document.getElementById('actionAddConnector');
  const addImageContainerBtn = document.getElementById('actionAddImageContainer');
  const undoBtn = document.getElementById('actionUndo');
  const redoBtn = document.getElementById('actionRedo');
  const newBtn = document.getElementById('actionNew');
  const openBtn = document.getElementById('actionOpen');
  const saveBtn = document.getElementById('actionSave');
  const exportJSONBtn = document.getElementById('actionExportJSON');
  const importJSONBtn = document.getElementById('actionImportJSON');
  const settingsBtn = document.getElementById('actionSettings');
  const mobileUndoBtn = document.getElementById('mobileUndoBtn');
  const mobileRedoBtn = document.getElementById('mobileRedoBtn');
  const mobileOpenBtn = document.getElementById('mobileOpenBtn');
  const mobileSaveBtn = document.getElementById('mobileSaveBtn');

  if (addNodeBtn) addNodeBtn.addEventListener('click', (e) => { e.preventDefault(); addNodeAtCenter(); });
  if (addArrowBtn) addArrowBtn.addEventListener('click', (e) => { e.preventDefault(); addArrowAtCenter(); });
  if (addRectBtn) addRectBtn.addEventListener('click', (e) => { e.preventDefault(); addShapeAtCenter('rectangle'); });
  if (addCircleBtn) addCircleBtn.addEventListener('click', (e) => { e.preventDefault(); addShapeAtCenter('circle'); });
  if (addTriangleBtn) addTriangleBtn.addEventListener('click', (e) => { e.preventDefault(); addShapeAtCenter('triangle'); });
  if (addDiamondBtn) addDiamondBtn.addEventListener('click', (e) => { e.preventDefault(); addShapeAtCenter('diamond'); });
  if (addConnectorBtn) addConnectorBtn.addEventListener('click', (e) => { e.preventDefault(); addConnectorAtCenter(); });
  if (addImageContainerBtn) addImageContainerBtn.addEventListener('click', (e) => { e.preventDefault(); addImageContainerAtCenter(); });
  if (undoBtn) undoBtn.addEventListener('click', (e) => { e.preventDefault(); performUndo(); });
  if (redoBtn) redoBtn.addEventListener('click', (e) => { e.preventDefault(); performRedo(); });
  if (newBtn) newBtn.addEventListener('click', (e) => { e.preventDefault(); newDocument(); });
  if (openBtn) openBtn.addEventListener('click', (e) => { e.preventDefault(); openDocument(); });
  if (saveBtn) saveBtn.addEventListener('click', (e) => { e.preventDefault(); saveDocument(); });
  if (exportJSONBtn) exportJSONBtn.addEventListener('click', (e) => { e.preventDefault(); downloadPortableJSON(); });
  if (importJSONBtn) importJSONBtn.addEventListener('click', (e) => { e.preventDefault(); openPortableJSON(); });
  if (settingsBtn) settingsBtn.addEventListener('click', (e) => { e.preventDefault(); openSettings(); });
  function addTouchGuard(btn, handler) {
    if (!btn) return;
    btn.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        e.preventDefault();
        handler();
      }
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      handler();
    });
  }
  addTouchGuard(mobileUndoBtn, performUndo);
  addTouchGuard(mobileRedoBtn, performRedo);
  addTouchGuard(mobileOpenBtn, openDocument);
  addTouchGuard(mobileSaveBtn, saveDocument);
}

/**
 * Save an already-saved document ten seconds after it last went dirty.
 *
 * The original implementation polled every two seconds and re-armed a timeout
 * on each tick, so the timer was pushed back before it could ever fire while
 * edits kept arriving, and it kept a poll running for the life of the app. A
 * single debounce, re-armed only when the document actually becomes dirty,
 * does the same job with no idle work.
 */
function setupAutoSave() {
  const AUTO_SAVE_DELAY = 10000;
  let timer = null;

  const canAutoSave = () => state.isDirty && state.currentFileName && hasCachedFileHandle();

  onDocumentStatusChange(() => {
    if (!canAutoSave()) {
      clearTimeout(timer);
      timer = null;
      return;
    }
    if (timer !== null) return; // already counting down

    timer = setTimeout(async () => {
      timer = null;
      if (canAutoSave()) await saveDocument();
    }, AUTO_SAVE_DELAY);
  });
}

function setupExternalChangeDetection() {
  let lastCheck = 0;
  const MIN_CHECK_INTERVAL = 30000;

  async function handleCheck() {
    const now = Date.now();
    if (now - lastCheck < MIN_CHECK_INTERVAL) return;
    lastCheck = now;
    if (!hasCachedFileHandle()) return;
    const modified = await checkFileModified();
    if (modified) {
      await reloadDocument();
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) handleCheck();
  });
  window.addEventListener('focus', handleCheck);
  setTimeout(handleCheck, 1500);
}

function setupMobileUI() {
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const topBarMenus = document.getElementById('topBarMenus');
  const mobilePanelToggle = document.getElementById('toolPanelToggle');
  const sidePanel = document.getElementById('sidePanel');

  if (hamburgerBtn && topBarMenus) {
    hamburgerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      topBarMenus.classList.toggle('mobile-open');
    });

    document.addEventListener('pointerdown', (e) => {
      if (topBarMenus.classList.contains('mobile-open') &&
        !topBarMenus.contains(e.target) &&
        e.target !== hamburgerBtn) {
        topBarMenus.classList.remove('mobile-open');
      }
    });
  }

  if (topBarMenus) {
    topBarMenus.querySelectorAll('.menu-button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const menu = btn.closest('.menu');
        if (!menu) return;
        const wasOpen = menu.classList.contains('mobile-open');
        topBarMenus.querySelectorAll('.menu.mobile-open').forEach(m => m.classList.remove('mobile-open'));
        if (!wasOpen) {
          menu.classList.add('mobile-open');
          e.preventDefault();
          e.stopPropagation();
        }
      });
    });
  }

  if (mobilePanelToggle && sidePanel) {
    mobilePanelToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      sidePanel.classList.toggle('mobile-visible');
      resizeCanvas();
    });

    document.addEventListener('pointerdown', (e) => {
      if (sidePanel.classList.contains('mobile-visible') &&
        !sidePanel.contains(e.target) &&
        e.target !== mobilePanelToggle) {
        sidePanel.classList.remove('mobile-visible');
        resizeCanvas();
      }
    });
  }
}

function init() {
  initSettings();
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  initHistory(refreshSidePanel);

  initEntityLayer();
  imageLOD.init();
  initPointer(history);
  initTouch();
  initToolbar();
  setupKeyboard();
  setupContextMenu();
  setupZoomPan();
  setupInlineEditing();
  initTopBar();

  initPanelResize();

  setupAutoSave();
  setupExternalChangeDetection();

  setupMobileUI();

  function addConnectorAt(worldX, worldY) {
    const offset = 60;
    addConnector(worldX - offset, worldY, worldX + offset, worldY);
  }

  initContextMenu({
    addNodeAt,
    addArrowAt,
    deleteSelectedNodes,
    duplicateSelectedNodes,
    copySelectedNodes,
    pasteNodesAt,
    refreshSidePanel,
    addShapeAt,
    addConnectorAt,
    addImageContainerAt,
    deleteSelectedShapes,
    deleteSelectedConnectors,
    deleteSelectedArrows,
    deleteConnection,
  });

  document.addEventListener('pointerdown', (e) => {
    const target = e.target;
    if (target === state.canvas) return;
    if (target && (target.closest && (target.closest('#sidePanel') || target.closest('#contextMenu') || target.closest('.top-bar') || target.closest('#leftToolbar') || target.closest('.entity')))) return;
    let didClear = false;
    if (state.selectedTextBoxes.size > 0) {
      state.selectedTextBoxes.clear();
      state.selectedConnection = null;
      didClear = true;
    }
    if (state.selectedConnection !== null) {
      state.selectedConnection = null;
      didClear = true;
    }
    if (state.selectedArrows.size > 0 || state.arrowDragTarget !== null) {
      state.selectedArrows.clear();
      state.arrowDragTarget = null;
      didClear = true;
    }
    if (state.selectedShapes.size > 0) {
      state.selectedShapes.clear();
      didClear = true;
    }
    if (state.selectedConnectors.size > 0) {
      state.selectedConnectors.clear();
      didClear = true;
    }
    if (didClear) refreshSidePanel();
  });

  initDesktopIntegration();

  startRenderLoop(state, drawFrame);
}

window.addEventListener('beforeunload', (e) => {
  if (state.isDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

init();
