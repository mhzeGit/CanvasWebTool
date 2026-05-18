import { state } from './state.js';
import { GRID } from './config.js';
import { drawGrid } from './grid.js';
import { initSettings } from './settings.js';
import { openSettings } from './settings-dialog.js';
import { drawSelectionMarquee } from './nodes.js';
import { drawArrows, updateArrowPositionsFromConnections } from './arrows.js';
import { drawShapePreview } from './shapes.js';
import { drawTextBoxPreview } from './textboxes.js';
import { drawConnectors, drawConnectorPreview, drawArrowPreview, updateConnectorPositionsFromConnections } from './connectors.js';
import { drawConnectionPreview, drawConnection } from './connections.js';
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
import { hasCachedFileHandle, checkFileModified } from './file-io.js';

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const sideEl = document.getElementById('sidePanel');
  const toolbarEl = document.getElementById('leftToolbar');
  const isMobile = window.innerWidth <= 768;
  const sideVisible = sideEl && sideEl.classList.contains('mobile-visible');
  const sideWidthPx = sideVisible ? sideEl.getBoundingClientRect().width : (isMobile ? 0 : (sideEl ? sideEl.getBoundingClientRect().width : Math.floor(window.innerWidth * 0.30)));
  const toolbarWidthPx = isMobile ? 0 : (toolbarEl ? toolbarEl.getBoundingClientRect().width : 0);
  const toolbarBottomPx = isMobile ? 52 : 0;
  const topBarPx = 40;
  const cssWidth = window.innerWidth - sideWidthPx - toolbarWidthPx;
  const cssHeight = window.innerHeight - topBarPx - toolbarBottomPx;
  state.canvas.style.width = cssWidth + 'px';
  state.canvas.style.height = cssHeight + 'px';
  state.canvas.width = cssWidth * dpr;
  state.canvas.height = cssHeight * dpr;
  state.arrowCanvas.style.width = cssWidth + 'px';
  state.arrowCanvas.style.height = cssHeight + 'px';
  state.arrowCanvas.width = cssWidth * dpr;
  state.arrowCanvas.height = cssHeight * dpr;
}

function animate() {
  const ctx = state.ctx;
  const canvas = state.canvas;

  state.offsetX += (state.targetOffsetX - state.offsetX) * GRID.panLerp;
  state.offsetY += (state.targetOffsetY - state.offsetY) * GRID.panLerp;
  state.scale += (state.targetScale - state.scale) * GRID.zoomLerp;

  const dpr = window.devicePixelRatio || 1;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  drawGrid(ctx, canvas, state.offsetX, state.offsetY, state.scale, dpr);

  // Clean up orphaned connections (referencing deleted textboxes)
  for (let ci = state.connections.length - 1; ci >= 0; ci--) {
    const conn = state.connections[ci];
    const fromNode = state.textBoxes[conn.from];
    const toNode = state.textBoxes[conn.to];
    if (!fromNode || !toNode) {
      state.connections.splice(ci, 1);
      if (state.selectedConnection === ci) state.selectedConnection = null;
      else if (state.selectedConnection > ci) state.selectedConnection--;
    }
  }

  // Draw bezier connection lines on the grid canvas
  for (let ci = 0; ci < state.connections.length; ci++) {
    const conn = state.connections[ci];
    const fromNode = state.textBoxes[conn.from];
    const toNode = state.textBoxes[conn.to];
    if (fromNode && toNode) {
      drawConnection(fromNode, toNode, conn);
    }
  }

  // Draw connection preview while connecting
  if (state.connectingFrom !== null && state.textBoxes[state.connectingFrom]) {
    drawConnectionPreview(
      state.textBoxes[state.connectingFrom],
      state.connectingMouseWorld.x,
      state.connectingMouseWorld.y
    );
  }

  const actx = state.arrowCtx;
  const acvs = state.arrowCanvas;
  actx.save();
  actx.setTransform(1, 0, 0, 1, 0, 0);
  actx.clearRect(0, 0, acvs.width, acvs.height);
  actx.restore();
  actx.setTransform(dpr, 0, 0, dpr, 0, 0);
  actx.translate(state.offsetX, state.offsetY);
  actx.scale(state.scale, state.scale);

  if (state.entityPositionsDirty) {
    updateArrowPositionsFromConnections();
    updateConnectorPositionsFromConnections();
    state.entityPositionsDirty = false;
  }
  drawArrows();
  drawConnectors();

  syncAllEntities();

  drawSelectionMarquee();

  drawConnectorPreview();
  drawArrowPreview();
  drawShapePreview();
  drawTextBoxPreview();
  drawImageContainerPreview();

  const key = state.computeSelectionKey();
  if (key !== state.lastPanelKey) {
    refreshSidePanel();
    state.lastPanelKey = key;
  }

  requestAnimationFrame(animate);
}

function drawImageContainerPreview() {
  if (!state.drawingTool || state.drawingTool !== 'imageContainer') return;
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

function setupAutoSave() {
  let timer = null;
  const AUTO_SAVE_DELAY = 10000;

  setInterval(() => {
    if (state.isDirty && state.currentFileName && hasCachedFileHandle()) {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        timer = null;
        if (state.isDirty) {
          await saveDocument();
        }
      }, AUTO_SAVE_DELAY);
    } else {
      clearTimeout(timer);
      timer = null;
    }
  }, 2000);
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

  animate();
}

window.addEventListener('beforeunload', (e) => {
  if (state.isDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

init();
