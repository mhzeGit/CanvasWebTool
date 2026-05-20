import { ParentTree } from './parent-tree.js';

const canvas = document.getElementById('gridCanvas');
const ctx = canvas.getContext('2d');
const arrowCanvas = document.getElementById('arrowCanvas');
const arrowCtx = arrowCanvas.getContext('2d');
const sidePanel = document.getElementById('sidePanel');
const sidePanelContent = document.getElementById('sidePanelContent');
const entityLayer = document.getElementById('entityLayer');

function markDrawOrderDirty() {
  state.parentTree.markDepthDirty();
}

function reparentAll() {
  state.parentTree.rebuildAll(state.shapes, state.textBoxes);
}

function getChildrenByParentId(parentId, parentType) {
  const children = state.parentTree.getChildren(parentType, parentId);
  return children.map(c => {
    const arr = c.type === 'shape' ? state.shapes : state.textBoxes;
    const idx = arr.findIndex(e => e.id === c.id);
    return { type: c.type, index: idx };
  }).filter(c => c.index !== -1);
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
  parentTree: new ParentTree(),

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
  isTouchPanning: false,
  touchPanLastX: 0,
  touchPanLastY: 0,
  twoFingerMidX: 0,
  twoFingerMidY: 0,
  twoFingerStartDist: 0,
  twoFingerStartScale: 1,
  twoFingerStartOffsetX: 0,
  twoFingerStartOffsetY: 0,
  twoFingerInitMidX: 0,
  twoFingerInitMidY: 0,
  twoFingerInitDist: 0,
  twoFingerInitScale: 1,
  twoFingerInitOffsetX: 0,
  twoFingerInitOffsetY: 0,

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
    return state.parentTree.getDrawOrder(state.shapes, state.textBoxes);
  },
  markDrawOrderDirty,
  reparentAll,
  getChildrenByParentId,
  computeSelectionKey,
  escAttr,
};
