import { EDGE_MARGIN, NODE_MIN_W, NODE_MIN_H } from './config.js';

const canvas = document.getElementById('gridCanvas');
const ctx = canvas.getContext('2d');
const sidePanel = document.getElementById('sidePanel');
const sidePanelContent = document.getElementById('sidePanelContent');

let drawOrderCache = [];
let drawOrderCacheDirty = true;

function getDrawOrder() {
  if (drawOrderCacheDirty) {
    drawOrderCache = Array.from({ length: state.nodes.length }, (_, i) => i);
    drawOrderCache.sort((a, b) => {
      const areaA = state.nodes[a].w * state.nodes[a].h;
      const areaB = state.nodes[b].w * state.nodes[b].h;
      if (areaB !== areaA) return areaB - areaA;
      return a - b;
    });
    drawOrderCacheDirty = false;
  }
  return drawOrderCache;
}

function markDrawOrderDirty() {
  drawOrderCacheDirty = true;
}

function isFullyContained(container, child) {
  return child.x >= container.x &&
         child.y >= container.y &&
         child.x + child.w <= container.x + container.w &&
         child.y + child.h <= container.y + container.h;
}

function findSmallestContainer(nodeIndex) {
  const node = state.nodes[nodeIndex];
  let bestContainerIndex = -1;
  let bestArea = Infinity;
  for (let i = 0; i < state.nodes.length; i++) {
    if (i === nodeIndex) continue;
    if (isFullyContained(state.nodes[i], node)) {
      const area = state.nodes[i].w * state.nodes[i].h;
      if (area < bestArea) {
        bestArea = area;
        bestContainerIndex = i;
      }
    }
  }
  return bestContainerIndex;
}

function checkAndUpdateParenting(nodeIndex) {
  const node = state.nodes[nodeIndex];
  const containerIdx = findSmallestContainer(nodeIndex);
  if (containerIdx !== -1) {
    node.parentId = state.nodes[containerIdx].id;
  } else {
    node.parentId = null;
  }
}

function getDragGroup(selectedIndices) {
  const group = new Set(selectedIndices);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < state.nodes.length; i++) {
      if (group.has(i)) continue;
      const n = state.nodes[i];
      if (n.parentId !== null && n.parentId !== undefined) {
        const parentEntry = findNodeById(state.nodes, n.parentId);
        if (parentEntry && group.has(parentEntry.index)) {
          group.add(i);
          changed = true;
        }
      }
    }
  }
  return Array.from(group).map(i => ({ i, x: state.nodes[i].x, y: state.nodes[i].y }));
}

function findNodeById(nodesArr, id) {
  for (let i = 0; i < nodesArr.length; i++) {
    if (nodesArr[i].id === id) return { node: nodesArr[i], index: i };
  }
  return null;
}

function computeSelectionKey() {
  if (state.arrowDragTarget) return `arrowEnd:${state.arrowDragTarget.arrowIdx}:${state.arrowDragTarget.end}`;
  if (state.selectedArrows.size === 1) return `arrow:${Array.from(state.selectedArrows)[0]}`;
  if (state.selectedArrows.size > 1) return `arrows:${state.selectedArrows.size}`;
  if (state.selectedConnection !== null) return `conn:${state.selectedConnection}`;
  if (state.selected.size === 0) return 'none';
  if (state.selected.size > 1) return `multi:${state.selected.size}`;
  const idx = Array.from(state.selected)[0];
  return `single:${idx}`;
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const state = {
  canvas,
  ctx,
  sidePanel,
  sidePanelContent,

  offsetX: 0,
  offsetY: 0,
  scale: 1,

  targetOffsetX: 0,
  targetOffsetY: 0,
  targetScale: 1,

  isPanning: false,
  lastPanX: 0,
  lastPanY: 0,

  nodes: [],
  selected: new Set(),
  isDraggingNode: false,
  dragStartWorldX: 0,
  dragStartWorldY: 0,
  dragGroupStarts: [],
  clipboard: [],

  panelPendingEdit: null,
  currentFileName: null,

  isSelectingBox: false,
  boxStartX: 0,
  boxStartY: 0,
  boxEndX: 0,
  boxEndY: 0,
  boxMode: 'replace',
  boxBaseSelection: new Set(),
  lastPanelKey: '',

  connections: [],
  nextConnectionId: 1,
  selectedConnection: null,
  connectingFrom: null,
  connectingMouseWorld: { x: 0, y: 0 },

  arrows: [],
  nextArrowId: 1,
  selectedArrows: new Set(),
  arrowDragTarget: null,
  isDraggingArrowEnd: false,
  dragArrowEndSnapshot: null,
  dragArrowEndWhich: null,

  isDraggingArrowBody: false,
  dragArrowBodyStartWorld: null,
  dragArrowBodySnapshots: [],

  lastWorldMouse: { x: 0, y: 0 },

  shapes: [],
  nextShapeId: 1,
  selectedShapes: new Set(),
  isDraggingShape: false,
  dragShapeStarts: [],
  isResizingShape: false,
  resizeShapeIdx: -1,
  resizeShapeId: -1,
  resizeShapeHandle: '',
  resizeShapeStartWorldX: 0,
  resizeShapeStartWorldY: 0,
  resizeShapeStartBounds: null,

  textBoxes: [],
  nextTextBoxId: 1,
  selectedTextBoxes: new Set(),
  isDraggingTextBox: false,
  dragTextBoxStarts: [],

  connectors: [],
  nextConnectorId: 1,
  selectedConnectors: new Set(),
  isDraggingConnectorBody: false,
  dragConnectorBodySnapshots: [],

  drawingTool: null,
  drawingShapeType: null,
  drawingStartX: 0,
  drawingStartY: 0,

  pendingClickIndex: -1,
  pointerDownScreenX: 0,
  pointerDownScreenY: 0,
  didDragSincePointerDown: false,
  pendingShiftKey: false,
  pendingCtrlKey: false,

  rmbDownTime: 0,
  rmbMoved: false,
  rmbPending: false,

  isResizing: false,
  resizeNodeIdx: -1,
  resizeNodeId: -1,
  resizeHandle: '',
  resizeStartWorldX: 0,
  resizeStartWorldY: 0,
  resizeStartNode: null,

  editingState: null,
  hoveredHandleInfo: null,

  getDrawOrder,
  markDrawOrderDirty,
  isFullyContained,
  findSmallestContainer,
  checkAndUpdateParenting,
  getDragGroup,
  findNodeById,
  computeSelectionKey,
  escAttr,
};
