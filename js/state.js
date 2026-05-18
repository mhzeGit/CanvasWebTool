import { EDGE_MARGIN } from './config.js';

const canvas = document.getElementById('gridCanvas');
const ctx = canvas.getContext('2d');
const arrowCanvas = document.getElementById('arrowCanvas');
const arrowCtx = arrowCanvas.getContext('2d');
const sidePanel = document.getElementById('sidePanel');
const sidePanelContent = document.getElementById('sidePanelContent');
const entityLayer = document.getElementById('entityLayer');

let drawOrderCache = [];
let drawOrderCacheDirty = true;

function markDrawOrderDirty() {
  drawOrderCacheDirty = true;
}

function containerArea(entity) {
  return entity.w * entity.h;
}

function rectInRect(ax, ay, aw, ah, bx, by, bw, bh) {
  return bx >= ax && by >= ay && bx + bw <= ax + aw && by + bh <= ay + ah;
}

function findParentForRect(rx, ry, rw, rh, excludeId, excludeType) {
  let bestId = null;
  let bestType = null;
  let bestArea = Infinity;
  for (let i = 0; i < state.shapes.length; i++) {
    const s = state.shapes[i];
    if (s.id === excludeId && excludeType === 'shape') continue;
    const area = containerArea(s);
    if (area < bestArea && rectInRect(s.x, s.y, s.w, s.h, rx, ry, rw, rh)) {
      bestId = s.id; bestType = 'shape'; bestArea = area;
    }
  }
  for (let i = 0; i < state.textBoxes.length; i++) {
    const t = state.textBoxes[i];
    if (t.id === excludeId && excludeType === 'textBox') continue;
    const area = containerArea(t);
    if (area < bestArea && rectInRect(t.x, t.y, t.w, t.h, rx, ry, rw, rh)) {
      bestId = t.id; bestType = 'textBox'; bestArea = area;
    }
  }
  return bestId ? { parentId: bestId, parentType: bestType } : null;
}

function reparentAll() {
  for (let i = 0; i < state.shapes.length; i++) {
    const s = state.shapes[i];
    const p = findParentForRect(s.x, s.y, s.w, s.h, s.id, 'shape');
    if (p) { s.parentId = p.parentId; s.parentType = p.parentType; }
    else { s.parentId = null; s.parentType = null; }
  }
  for (let i = 0; i < state.textBoxes.length; i++) {
    const t = state.textBoxes[i];
    const p = findParentForRect(t.x, t.y, t.w, t.h, t.id, 'textBox');
    if (p) { t.parentId = p.parentId; t.parentType = p.parentType; }
    else { t.parentId = null; t.parentType = null; }
  }
}

function getChildrenByParentId(parentId, parentType) {
  const children = [];
  for (let i = 0; i < state.shapes.length; i++) {
    const s = state.shapes[i];
    if (s.parentId === parentId && s.parentType === parentType) children.push({ type: 'shape', index: i });
  }
  for (let i = 0; i < state.textBoxes.length; i++) {
    const t = state.textBoxes[i];
    if (t.parentId === parentId && t.parentType === parentType) children.push({ type: 'textBox', index: i });
  }
  return children;
}

function computeSelectionKey() {
  if (state.arrowDragTarget) return `arrowEnd:${state.arrowDragTarget.arrowIdx}:${state.arrowDragTarget.end}`;
  const ms = state.selectedShapes.size > 0 ? 1 : 0;
  const mt = state.selectedTextBoxes.size > 0 ? 1 : 0;
  const ma = state.selectedArrows.size > 0 ? 1 : 0;
  const mc = state.selectedConnection !== null ? 1 : 0;
  const mx = state.selectedConnectors.size > 0 ? 1 : 0;
  if (ms + mt + ma + mc + mx > 1) {
    return `mixed:${state.selectedShapes.size}|${state.selectedTextBoxes.size}|${state.selectedArrows.size}|${state.selectedConnection !== null ? 1 : 0}|${state.selectedConnectors.size}`;
  }
  if (state.selectedArrows.size === 1) return `arrow:${Array.from(state.selectedArrows)[0]}`;
  if (state.selectedArrows.size > 1) return `arrows:${state.selectedArrows.size}`;
  if (state.selectedConnection !== null) return `conn:${state.selectedConnection}`;
  if (state.selectedShapes.size === 1) return `shape:${Array.from(state.selectedShapes)[0]}`;
  if (state.selectedShapes.size > 1) return `shapes:${state.selectedShapes.size}`;
  if (state.selectedTextBoxes.size === 1) return `tb:${Array.from(state.selectedTextBoxes)[0]}`;
  if (state.selectedTextBoxes.size > 1) return `tbs:${state.selectedTextBoxes.size}`;
  if (state.selectedConnectors.size === 1) return `connector:${Array.from(state.selectedConnectors)[0]}`;
  if (state.selectedConnectors.size > 1) return `connectors:${state.selectedConnectors.size}`;
  return 'none';
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const state = {
  canvas,
  ctx,
  arrowCanvas,
  arrowCtx,
  sidePanel,
  sidePanelContent,
  entityLayer,

  offsetX: 0,
  offsetY: 0,
  scale: 1,

  targetOffsetX: 0,
  targetOffsetY: 0,
  targetScale: 1,

  isPanning: false,
  lastPanX: 0,
  lastPanY: 0,

  clipboard: [],
  propertyClipboard: null,
  hoveredPropField: null,

  panelPendingEdit: null,
  currentFileName: null,
  isDirty: false,

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
  lastShapeColor: '#2b2b2b',
  lastShapeBorderColor: '#6bb5ff',
  isDraggingShape: false,
  dragShapeStarts: [],
  dragChildShapeStarts: [],
  dragChildTextBoxStarts: [],
  isResizingShape: false,
  resizeShapeIdx: -1,
  resizeShapeId: -1,
  resizeShapeHandle: '',
  resizeShapeStartWorldX: 0,
  resizeShapeStartWorldY: 0,
  resizeShapeStartBounds: null,

  nodes: [],
  nextNodeId: 1,
  selected: new Set(),

  textBoxes: [],
  nextTextBoxId: 1,
  selectedTextBoxes: new Set(),
  isDraggingTextBox: false,
  dragTextBoxStarts: [],
  isResizingTextBox: false,
  resizeTextBoxIdx: -1,
  resizeTextBoxId: -1,
  resizeTextBoxHandle: '',
  resizeTextBoxStartWorldX: 0,
  resizeTextBoxStartWorldY: 0,
  resizeTextBoxStartBounds: null,

  connectors: [],
  nextConnectorId: 1,
  selectedConnectors: new Set(),
  isDraggingConnectorBody: false,
  dragConnectorBodySnapshots: [],

  drawingTool: null,
  drawingShapeType: null,
  drawingStartX: 0,
  drawingStartY: 0,
  drawingStartConnected: null,

  touchPointers: new Map(),
  touchTapData: null,
  isTwoFingerGesture: false,
  twoFingerMidX: 0,
  twoFingerMidY: 0,
  twoFingerStartDist: 0,
  twoFingerStartScale: 1,
  twoFingerStartOffsetX: 0,
  twoFingerStartOffsetY: 0,

  pendingClickIndex: -1,
  pendingClickItemIdx: -1,
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
  panelTextMode: 'rich',

  getTopHitAt(wx, wy) {
    const order = state.getAllDrawOrder();
    for (let i = order.length - 1; i >= 0; i--) {
      const item = order[i];
      let e;
      if (item.type === 'shape') e = state.shapes[item.i];
      else if (item.type === 'textBox') e = state.textBoxes[item.i];
      if (e && wx >= e.x && wx <= e.x + e.w && wy >= e.y && wy <= e.y + e.h) return item;
    }
    return null;
  },
  getAllDrawOrder() {
    const items = [];
    for (let i = 0; i < state.shapes.length; i++) {
      items.push({ type: 'shape', i, area: state.shapes[i].w * state.shapes[i].h });
    }
    for (let i = 0; i < state.textBoxes.length; i++) {
      items.push({ type: 'textBox', i, area: state.textBoxes[i].w * state.textBoxes[i].h });
    }
    const depthMap = new Map();
    function computeDepth(item, visited) {
      const key = item.type + ':' + item.i;
      if (depthMap.has(key)) return depthMap.get(key);
      if (visited.has(key)) return 0;
      visited.add(key);
      const entity = item.type === 'shape' ? state.shapes[item.i] : state.textBoxes[item.i];
      if (!entity || entity.parentId == null) {
        depthMap.set(key, 0);
        return 0;
      }
      const parentItem = items.find(p => {
        const pe = p.type === 'shape' ? state.shapes[p.i] : state.textBoxes[p.i];
        return pe && pe.id === entity.parentId && p.type === entity.parentType;
      });
      if (!parentItem) {
        depthMap.set(key, 0);
        return 0;
      }
      const depth = 1 + computeDepth(parentItem, visited);
      depthMap.set(key, depth);
      return depth;
    }
    for (const item of items) {
      computeDepth(item, new Set());
    }
    items.sort((a, b) => {
      const depthA = depthMap.get(a.type + ':' + a.i) || 0;
      const depthB = depthMap.get(b.type + ':' + b.i) || 0;
      if (depthA !== depthB) return depthA - depthB;
      return b.area - a.area;
    });
    return items;
  },
  markDrawOrderDirty,
  reparentAll,
  getChildrenByParentId,
  computeSelectionKey,
  escAttr,
};
