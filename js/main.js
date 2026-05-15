import { state } from './state.js';
import { GRID } from './config.js';
import { drawGrid } from './grid.js';
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
import {
  addNodeAt, addArrowAt, addNodeAtCenter, addArrowAtCenter, addShapeAtCenter, addConnectorAtCenter,
  deleteSelectedNodes, deleteSelectedShapes, deleteSelectedTextBoxes, deleteSelectedConnectors,
  deleteSelectedArrows, deleteConnection,
  duplicateSelectedNodes, copySelectedNodes, pasteNodesAt,
  addShapeAt, addConnector,
  newDocument, saveDocument, openDocument,
} from './document.js';
import { performUndo, performRedo } from './history.js';
import { initToolbar } from './toolbar.js';
import { initEntityLayer, syncAllEntities } from './dom-entities.js';

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const sideEl = document.getElementById('sidePanel');
  const toolbarEl = document.getElementById('leftToolbar');
  const sideWidthPx = sideEl ? sideEl.getBoundingClientRect().width : Math.floor(window.innerWidth * 0.30);
  const toolbarWidthPx = toolbarEl ? toolbarEl.getBoundingClientRect().width : 0;
  const topBarPx = 40;
  const cssWidth = window.innerWidth - sideWidthPx - toolbarWidthPx;
  const cssHeight = window.innerHeight - topBarPx;
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

  // Clear arrow canvas and set world transform
  const actx = state.arrowCtx;
  const acvs = state.arrowCanvas;
  actx.save();
  actx.setTransform(1, 0, 0, 1, 0, 0);
  actx.clearRect(0, 0, acvs.width, acvs.height);
  actx.restore();
  actx.setTransform(dpr, 0, 0, dpr, 0, 0);
  actx.translate(state.offsetX, state.offsetY);
  actx.scale(state.scale, state.scale);

  // Clean up stale connections (where textBox was deleted)
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

  updateArrowPositionsFromConnections();
  updateConnectorPositionsFromConnections();
  drawArrows();
  drawConnectors();

  syncAllEntities();

  drawSelectionMarquee();

  drawConnectorPreview();
  drawArrowPreview();
  drawShapePreview();
  drawNodePreview();
  drawTextBoxPreview();

  const key = state.computeSelectionKey();
  if (key !== state.lastPanelKey) {
    refreshSidePanel();
    state.lastPanelKey = key;
  }

  requestAnimationFrame(animate);
}

function initTopBar() {
  const addNodeBtn = document.getElementById('actionAddNode');
  const addArrowBtn = document.getElementById('actionAddArrow');
  const addRectBtn = document.getElementById('actionAddRectangle');
  const addCircleBtn = document.getElementById('actionAddCircle');
  const addTriangleBtn = document.getElementById('actionAddTriangle');
  const addDiamondBtn = document.getElementById('actionAddDiamond');
  const addConnectorBtn = document.getElementById('actionAddConnector');
  const undoBtn = document.getElementById('actionUndo');
  const redoBtn = document.getElementById('actionRedo');
  const newBtn = document.getElementById('actionNew');
  const openBtn = document.getElementById('actionOpen');
  const saveBtn = document.getElementById('actionSave');
  const settingsBtn = document.getElementById('actionSettings');

  if (addNodeBtn) addNodeBtn.addEventListener('click', (e) => { e.preventDefault(); addNodeAtCenter(); });
  if (addArrowBtn) addArrowBtn.addEventListener('click', (e) => { e.preventDefault(); addArrowAtCenter(); });
  if (addRectBtn) addRectBtn.addEventListener('click', (e) => { e.preventDefault(); addShapeAtCenter('rectangle'); });
  if (addCircleBtn) addCircleBtn.addEventListener('click', (e) => { e.preventDefault(); addShapeAtCenter('circle'); });
  if (addTriangleBtn) addTriangleBtn.addEventListener('click', (e) => { e.preventDefault(); addShapeAtCenter('triangle'); });
  if (addDiamondBtn) addDiamondBtn.addEventListener('click', (e) => { e.preventDefault(); addShapeAtCenter('diamond'); });
  if (addConnectorBtn) addConnectorBtn.addEventListener('click', (e) => { e.preventDefault(); addConnectorAtCenter(); });
  if (undoBtn) undoBtn.addEventListener('click', (e) => { e.preventDefault(); performUndo(); });
  if (redoBtn) redoBtn.addEventListener('click', (e) => { e.preventDefault(); performRedo(); });
  if (newBtn) newBtn.addEventListener('click', (e) => { e.preventDefault(); newDocument(); });
  if (openBtn) openBtn.addEventListener('click', (e) => { e.preventDefault(); openDocument(); });
  if (saveBtn) saveBtn.addEventListener('click', (e) => { e.preventDefault(); saveDocument(); });
  if (settingsBtn) settingsBtn.addEventListener('click', (e) => { e.preventDefault(); openSettings(); });
}

function init() {
  initSettings();
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  initHistory(refreshSidePanel);

  initEntityLayer();
  initPointer(history);
  initToolbar();
  setupKeyboard();
  setupContextMenu();
  setupZoomPan();
  setupInlineEditing();
  initTopBar();

  initPanelResize();

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
