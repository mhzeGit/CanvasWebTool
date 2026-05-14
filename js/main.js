import { state } from './state.js';
import { GRID } from './config.js';
import { drawGrid } from './grid.js';
import { drawSelectionMarquee } from './nodes.js';
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
import { history, initHistory } from './history.js';
import {
  addNodeAtCenter, addNodeAt, addArrowAtCenter, addArrowAt,
  deleteSelectedNodes, deleteSelectedShapes, deleteSelectedTextBoxes, deleteSelectedConnectors,
  duplicateSelectedNodes, copySelectedNodes, pasteNodesAt,
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

  for (let ci = state.connections.length - 1; ci >= 0; ci--) {
    const conn = state.connections[ci];
    const fromNode = state.nodes[conn.from];
    const toNode = state.nodes[conn.to];
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
  const undoBtn = document.getElementById('actionUndo');
  const redoBtn = document.getElementById('actionRedo');
  const newBtn = document.getElementById('actionNew');
  const openBtn = document.getElementById('actionOpen');
  const saveBtn = document.getElementById('actionSave');

  if (addNodeBtn) addNodeBtn.addEventListener('click', (e) => { e.preventDefault(); addNodeAtCenter(); });
  if (addArrowBtn) addArrowBtn.addEventListener('click', (e) => { e.preventDefault(); addArrowAtCenter(); });
  if (undoBtn) undoBtn.addEventListener('click', (e) => { e.preventDefault(); performUndo(); });
  if (redoBtn) redoBtn.addEventListener('click', (e) => { e.preventDefault(); performRedo(); });
  if (newBtn) newBtn.addEventListener('click', (e) => { e.preventDefault(); newDocument(); });
  if (openBtn) openBtn.addEventListener('click', (e) => { e.preventDefault(); openDocument(); });
  if (saveBtn) saveBtn.addEventListener('click', (e) => { e.preventDefault(); saveDocument(); });
}

function init() {
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

  initContextMenu({
    addNodeAt,
    addArrowAt,
    deleteSelectedNodes,
    duplicateSelectedNodes,
    copySelectedNodes,
    pasteNodesAt,
    refreshSidePanel,
  });

  document.addEventListener('pointerdown', (e) => {
    const target = e.target;
    if (target === state.canvas) return;
    if (target && (target.closest && (target.closest('#sidePanel') || target.closest('#contextMenu') || target.closest('.top-bar') || target.closest('#leftToolbar')))) return;
    let didClear = false;
    if (state.selected.size > 0) {
      state.selected.clear();
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
    if (state.selectedTextBoxes.size > 0) {
      state.selectedTextBoxes.clear();
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

init();
