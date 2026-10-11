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

/**
 * Observers of "which document, and does it have unsaved changes".
 *
 * These three fields are written from a couple of dozen places, so rather than
 * making every one of them remember to notify, they are accessors that fire
 * these listeners whenever a value actually changes. Auto-save and the desktop
 * window title and CLI status both hang off this.
 */
const documentStatusListeners = new Set();

export function onDocumentStatusChange(listener) {
  documentStatusListeners.add(listener);
  return () => documentStatusListeners.delete(listener);
}

function notifyDocumentStatus() {
  for (const listener of documentStatusListeners) {
    try {
      listener();
    } catch (err) {
      console.error('Document status listener failed:', err);
    }
  }
}

/** Define a state field that notifies when it changes. */
function observableField(name, normalise) {
  const backing = '_' + name;
  return {
    get() {
      return this[backing];
    },
    set(value) {
      const next = normalise(value);
      if (next === this[backing]) return;
      this[backing] = next;
      notifyDocumentStatus();
    },
  };
}

const asBoolean = (value) => !!value;
const asStringOrNull = (value) => (typeof value === 'string' && value.length > 0 ? value : null);

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

  // Document status: see observableField above. The backing fields are
  // declared here so the object has a stable shape.
  _currentFileName: null,
  _currentFilePath: null,
  _isDirty: false,

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
      if (e && !e.locked && wx >= e.x && wx <= e.x + e.w && wy >= e.y && wy <= e.y + e.h) return item;
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

Object.defineProperties(state, {
  /** Whether the document has changes that are not on disk. */
  isDirty: observableField('isDirty', asBoolean),
  /** File name of the open document, or null when it has never been saved. */
  currentFileName: observableField('currentFileName', asStringOrNull),
  /** Absolute path on disk, when the desktop build knows it; null in a browser. */
  currentFilePath: observableField('currentFilePath', asStringOrNull),
});
