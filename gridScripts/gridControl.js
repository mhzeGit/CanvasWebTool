// gridScripts/gridControl.js
import { drawGrid } from './gridDraw.js';
import { gridSettings } from './gridSettings.js';
import { nextNodeId, initNodeId, findNodeById, createHistoryManager, createAddNodeCmd, createDeleteNodesCmd, createMoveNodesCmd, createResizeNodeCmd, createPropertyChangeCmd, createPasteNodesCmd, createDuplicateNodesCmd, createMoveArrowEndCmd } from './undoManager.js';
import { serializeDocument, deserializeDocument, FILE_EXTENSION } from './documentFormat.js';
import { saveToFile, loadFromFile } from './fileIO.js';

const canvas = document.getElementById('gridCanvas');
const ctx = canvas.getContext('2d');
const sidePanel = document.getElementById('sidePanel');
const sidePanelContent = document.getElementById('sidePanelContent');

// --- State ---
let offsetX = 0;
let offsetY = 0;
let scale = 1;

let targetOffsetX = 0;
let targetOffsetY = 0;
let targetScale = 1;

let isPanning = false;
let lastPanX = 0;
let lastPanY = 0;

// --- Nodes & selection ---
const nodes = [];
const selected = new Set();
let isDraggingNode = false;
let dragStartWorldX = 0;
let dragStartWorldY = 0;
let dragGroupStarts = [];
let clipboard = [];

// --- Undo/redo ---
const history = createHistoryManager();
let panelPendingEdit = null; // { nodeId, property, oldValue }

function flushPanelEdit() {
  if (!panelPendingEdit) return;
  const { nodeId, property, oldValue, oldBounds } = panelPendingEdit;
  panelPendingEdit = null;
  const found = findNodeById(nodes, nodeId);
  if (!found) return;
  const newValue = found.node[property];
  if (oldValue !== newValue) {
    if ((property === 'w' || property === 'h') && oldBounds) {
      history.push(createResizeNodeCmd(nodes, selected, refreshSidePanel, nodeId,
        { x: oldBounds.x, y: oldBounds.y, w: oldBounds.w, h: oldBounds.h },
        { x: found.node.x, y: found.node.y, w: found.node.w, h: found.node.h }));
    } else {
      history.push(createPropertyChangeCmd(nodes, selected, refreshSidePanel, nodeId, property, oldValue, newValue));
    }
  }
}

function startPanelEdit(nodeId, property, oldValue, oldBounds) {
  flushPanelEdit();
  panelPendingEdit = { nodeId, property, oldValue, oldBounds: oldBounds || null };
}

function performUndo() {
  flushPanelEdit();
  history.undo();
  markDrawOrderDirty();
  for (let i = 0; i < nodes.length; i++) {
    checkAndUpdateParenting(i);
  }
}

function performRedo() {
  flushPanelEdit();
  history.redo();
  markDrawOrderDirty();
  for (let i = 0; i < nodes.length; i++) {
    checkAndUpdateParenting(i);
  }
}
let currentFileName = null;

let isSelectingBox = false;
let boxStartX = 0, boxStartY = 0, boxEndX = 0, boxEndY = 0;
let boxMode = 'replace'; // 'replace' | 'add' | 'remove'
let boxBaseSelection = new Set();
let lastPanelKey = '';

// --- Connection state ---
const connections = [];
let nextConnectionId = 1;
let selectedConnection = null;
let connectingFrom = null;
let connectingMouseWorld = { x: 0, y: 0 };

// --- Arrow state ---
const arrows = [];
let nextArrowId = 1;
const selectedArrows = new Set();
let arrowDragTarget = null; // { arrowIdx, end: 'start'|'end' } — which endpoint is being interacted with
let isDraggingArrowEnd = false;
let dragArrowEndSnapshot = null;
let dragArrowEndWhich = null;

let isDraggingArrowBody = false;
let dragArrowBodyStartWorld = null;
let dragArrowBodySnapshots = []; // [{ idx, x1, y1, x2, y2, connectedFrom, connectedTo }]

const ARROW_END_RADIUS = 8;
const ARROW_END_HIT_RADIUS = 14;
const ARROW_BODY_HIT_THRESHOLD = 6;
const ARROW_HEAD_LENGTH = 14;
const ARROW_HEAD_ANGLE = Math.PI / 6;

let lastWorldMouse = { x: 0, y: 0 };

// Drag/selection thresholds and pending click state
const DRAG_THRESHOLD_PX = 3;
let pendingClickIndex = -1;
let pointerDownScreenX = 0, pointerDownScreenY = 0;
let didDragSincePointerDown = false;
let pendingShiftKey = false;
let pendingCtrlKey = false;

// Right-click context vs pan handling
const RMB_MENU_THRESHOLD_MS = 250;
let rmbDownTime = 0;
let rmbMoved = false;
let rmbPending = false;

// Resize state
let isResizing = false;
let resizeNodeIdx = -1;
let resizeNodeId = -1;
let resizeHandle = '';
let resizeStartWorldX = 0;
let resizeStartWorldY = 0;
let resizeStartNode = null;
const EDGE_MARGIN = 12;
const NODE_MIN_W = 100;
const NODE_MIN_H = 70;

// Inline editing
let editingState = null;

// Hovered resize handle (for visual feedback only)
let hoveredHandleInfo = null;

// Draw order cache (sorted by node size — bigger nodes rendered first / underneath)
let drawOrderCache = [];
let drawOrderCacheDirty = true;

function getDrawOrder() {
  if (drawOrderCacheDirty) {
    drawOrderCache = Array.from({ length: nodes.length }, (_, i) => i);
    drawOrderCache.sort((a, b) => {
      const areaA = nodes[a].w * nodes[a].h;
      const areaB = nodes[b].w * nodes[b].h;
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
  const node = nodes[nodeIndex];
  let bestContainerIndex = -1;
  let bestArea = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    if (i === nodeIndex) continue;
    if (isFullyContained(nodes[i], node)) {
      const area = nodes[i].w * nodes[i].h;
      if (area < bestArea) {
        bestArea = area;
        bestContainerIndex = i;
      }
    }
  }
  return bestContainerIndex;
}

function checkAndUpdateParenting(nodeIndex) {
  const node = nodes[nodeIndex];
  const containerIdx = findSmallestContainer(nodeIndex);
  if (containerIdx !== -1) {
    node.parentId = nodes[containerIdx].id;
  } else {
    node.parentId = null;
  }
}

function getDragGroup(selectedIndices) {
  const group = new Set(selectedIndices);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < nodes.length; i++) {
      if (group.has(i)) continue;
      const n = nodes[i];
      if (n.parentId !== null && n.parentId !== undefined) {
        const parentEntry = findNodeById(nodes, n.parentId);
        if (parentEntry && group.has(parentEntry.index)) {
          group.add(i);
          changed = true;
        }
      }
    }
  }
  return Array.from(group).map(i => ({ i, x: nodes[i].x, y: nodes[i].y }));
}

function screenToWorld(sx, sy) {
  return { x: (sx - offsetX) / scale, y: (sy - offsetY) / scale };
}

function worldToScreen(wx, wy) {
  return { x: wx * scale + offsetX, y: wy * scale + offsetY };
}

function hitTestNode(wx, wy) {
  const drawOrder = getDrawOrder();
  for (let i = drawOrder.length - 1; i >= 0; i--) {
    const idx = drawOrder[i];
    const n = nodes[idx];
    if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) return idx;
  }
  return -1;
}

function findNodeAtEdge(wx, wy) {
  const drawOrder = getDrawOrder();
  for (let i = drawOrder.length - 1; i >= 0; i--) {
    const idx = drawOrder[i];
    const n = nodes[idx];
    const onLeft = Math.abs(wx - n.x) <= EDGE_MARGIN;
    const onRight = Math.abs(wx - (n.x + n.w)) <= EDGE_MARGIN;
    const onTop = Math.abs(wy - n.y) <= EDGE_MARGIN;
    const onBottom = Math.abs(wy - (n.y + n.h)) <= EDGE_MARGIN;
    const inX = wx >= n.x - EDGE_MARGIN && wx <= n.x + n.w + EDGE_MARGIN;
    const inY = wy >= n.y - EDGE_MARGIN && wy <= n.y + n.h + EDGE_MARGIN;
    if (!inX || !inY) continue;
    if (onLeft && onTop) return { idx, handle: 'tl', cursor: 'nw-resize' };
    if (onRight && onTop) return { idx, handle: 'tr', cursor: 'ne-resize' };
    if (onLeft && onBottom) return { idx, handle: 'bl', cursor: 'sw-resize' };
    if (onRight && onBottom) return { idx, handle: 'br', cursor: 'se-resize' };
    if (onLeft) return { idx, handle: 'left', cursor: 'ew-resize' };
    if (onRight) return { idx, handle: 'right', cursor: 'ew-resize' };
    if (onTop) return { idx, handle: 'top', cursor: 'ns-resize' };
    if (onBottom) return { idx, handle: 'bottom', cursor: 'ns-resize' };
  }
  return null;
}

function getEdgeAt(wx, wy) {
  const drawOrder = getDrawOrder();
  for (let i = drawOrder.length - 1; i >= 0; i--) {
    const idx = drawOrder[i];
    const n = nodes[idx];
    const onLeft = Math.abs(wx - n.x) <= EDGE_MARGIN;
    const onRight = Math.abs(wx - (n.x + n.w)) <= EDGE_MARGIN;
    const onTop = Math.abs(wy - n.y) <= EDGE_MARGIN;
    const onBottom = Math.abs(wy - (n.y + n.h)) <= EDGE_MARGIN;

    const inX = wx >= n.x - EDGE_MARGIN && wx <= n.x + n.w + EDGE_MARGIN;
    const inY = wy >= n.y - EDGE_MARGIN && wy <= n.y + n.h + EDGE_MARGIN;
    if (!inX || !inY) continue;

    if (onLeft && onTop) return { idx, handle: 'tl', cursor: 'nw-resize' };
    if (onRight && onTop) return { idx, handle: 'tr', cursor: 'ne-resize' };
    if (onLeft && onBottom) return { idx, handle: 'bl', cursor: 'sw-resize' };
    if (onRight && onBottom) return { idx, handle: 'br', cursor: 'se-resize' };
    if (onLeft) return { idx, handle: 'left', cursor: 'ew-resize' };
    if (onRight) return { idx, handle: 'right', cursor: 'ew-resize' };
    if (onTop) return { idx, handle: 'top', cursor: 'ns-resize' };
    if (onBottom) return { idx, handle: 'bottom', cursor: 'ns-resize' };
  }
  return null;
}

function addNodeAtCenter() {
  flushPanelEdit();
  const rect = canvas.getBoundingClientRect();
  const centerCssX = rect.width / 2;
  const centerCssY = rect.height / 2;
  const world = screenToWorld(centerCssX, centerCssY);
  addNodeAt(world.x, world.y);
}

function addNodeAt(worldX, worldY) {
  flushPanelEdit();
  const w = 240; const h = 160;
  const node = { id: nextNodeId(), x: worldX - w / 2, y: worldY - h / 2, w, h, color: '#2b2b2b', title: '', titleColor: '#e7e7e7', text: '', parentId: null };
  const idx = nodes.length;
  nodes.push(node);
  selected.clear();
  selected.add(idx);
  markDrawOrderDirty();
  for (let i = 0; i < nodes.length; i++) {
    checkAndUpdateParenting(i);
  }
  refreshSidePanel();
  history.push(createAddNodeCmd(nodes, selected, refreshSidePanel, node, idx));
}

// Hook up Add Node action
const addNodeBtn = document.getElementById('actionAddNode');
if (addNodeBtn) {
  addNodeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    addNodeAtCenter();
  });
}

// --- Arrow creation ---
function addArrowAtCenter() {
  flushPanelEdit();
  const rect = canvas.getBoundingClientRect();
  const centerCssX = rect.width / 2;
  const centerCssY = rect.height / 2;
  const world = screenToWorld(centerCssX, centerCssY);
  addArrowAt(world.x, world.y);
}

function addArrowAt(worldX, worldY, connectNodeIdx) {
  flushPanelEdit();
  const offset = 60;
  let x1 = worldX - offset;
  let y1 = worldY;
  let x2 = worldX + offset;
  let y2 = worldY;
  let connectedFrom = null;
  let connectedTo = null;

  if (connectNodeIdx !== undefined && connectNodeIdx !== null && nodes[connectNodeIdx]) {
    const edge = getNodeEdgePoint(nodes[connectNodeIdx], worldX, worldY);
    x1 = edge.x;
    y1 = edge.y;
    connectedFrom = connectNodeIdx;
    x2 = worldX;
    y2 = worldY;
  }

  const arrow = {
    id: nextArrowId++,
    x1, y1, x2, y2,
    connectedFrom,
    connectedTo,
    color: '#6bb5ff'
  };

  const idx = arrows.length;
  arrows.push(arrow);
  selected.clear();
  selectedConnection = null;
  selectedArrows.clear();
  arrowDragTarget = { arrowIdx: idx, end: 'end' };
  selectedArrows.add(idx);
  refreshSidePanel();
}

const addArrowBtn = document.getElementById('actionAddArrow');
if (addArrowBtn) {
  addArrowBtn.addEventListener('click', (e) => {
    e.preventDefault();
    addArrowAtCenter();
  });
}

// --- Resize handling ---
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const sideEl = document.getElementById('sidePanel');
  const sideWidthPx = sideEl ? sideEl.getBoundingClientRect().width : Math.floor(window.innerWidth * 0.30);
  const topBarPx = 40;
  const cssWidth = window.innerWidth - sideWidthPx;
  const cssHeight = window.innerHeight - topBarPx;
  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();
// Initialize side panel on load
refreshSidePanel();

// Deselect when clicking outside canvas/panel/menus
document.addEventListener('pointerdown', (e) => {
  const target = e.target;
  if (target === canvas) return;
  if (target && (target.closest && (target.closest('#sidePanel') || target.closest('#contextMenu') || target.closest('.top-bar')))) return;
  let didClear = false;
  if (selected.size > 0) {
    selected.clear();
    selectedConnection = null;
    didClear = true;
  }
  if (selectedConnection !== null) {
    selectedConnection = null;
    didClear = true;
  }
  if (selectedArrows.size > 0 || arrowDragTarget !== null) {
    selectedArrows.clear();
    arrowDragTarget = null;
    didClear = true;
  }
  if (didClear) refreshSidePanel();
});

// Disable native context menu on the canvas
canvas.addEventListener('contextmenu', (e) => {
  // Allow the browser to fire contextmenu, but we decide whether to show ours
  e.preventDefault();
  if (!rmbPending) return; // only if a recent RMB down happened
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const withinTime = (now - rmbDownTime) <= RMB_MENU_THRESHOLD_MS;
  if (withinTime && !rmbMoved && !isPanning) {
    openContextMenu(e);
  }
  rmbPending = false; // consume
});

function openContextMenu(e) {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const world = screenToWorld(sx, sy);
  const hit = hitTestNode(world.x, world.y);
  const connHit = hit === -1 ? hitTestConnection(world.x, world.y) : null;
  const arrowEndHit = hit === -1 ? hitTestArrowEnd(world.x, world.y) : null;
  const arrowBodyHit = (hit === -1 && connHit === null && arrowEndHit === null) ? hitTestArrowBody(world.x, world.y) : -1;

  const menu = document.getElementById('contextMenu');
  if (!menu) return;
  menu.innerHTML = '';

  const items = [];
  if (hit !== -1) {
    // Ensure the right-clicked node is selected
    if (!selected.has(hit)) {
      selected.clear();
      selected.add(hit);
    }
    // Add submenu (place at top)
    const addWrap = document.createElement('div');
    addWrap.className = 'context-submenu-trigger';
    const addBtn = document.createElement('button');
    addBtn.className = 'context-item has-submenu';
    addBtn.innerHTML = '<span>Add</span><span class="submenu-arrow">▸</span>';
    const sub = document.createElement('div');
    sub.className = 'context-submenu';
    const addNode = document.createElement('button');
    addNode.className = 'context-item';
    addNode.textContent = 'Add Node';
    addNode.addEventListener('click', () => {
      addNodeAt(world.x, world.y);
      closeContextMenu();
    });
    sub.appendChild(addNode);
    const addArrow = document.createElement('button');
    addArrow.className = 'context-item';
    addArrow.textContent = 'Add Arrow';
    addArrow.addEventListener('click', () => {
      addArrowAt(world.x, world.y, hit);
      closeContextMenu();
    });
    sub.appendChild(addArrow);
    addWrap.appendChild(addBtn);
    addWrap.appendChild(sub);
    items.push(addWrap);
    // Delete item
    const del = document.createElement('button');
    del.className = 'context-item';
    del.textContent = 'Delete';
    del.addEventListener('click', () => {
      deleteSelectedNodes();
      closeContextMenu();
    });
    items.push(del);

    // Duplicate item
    const dup = document.createElement('button');
    dup.className = 'context-item';
    dup.textContent = 'Duplicate';
    dup.addEventListener('click', () => {
      duplicateSelectedNodes();
      closeContextMenu();
    });
    items.push(dup);

    // Connect to... item
    const connectBtn = document.createElement('button');
    connectBtn.className = 'context-item';
    connectBtn.textContent = 'Connect to...';
    connectBtn.addEventListener('click', () => {
      connectingFrom = hit;
      closeContextMenu();
    });
    items.push(connectBtn);

    // Copy item
    const copy = document.createElement('button');
    copy.className = 'context-item';
    copy.textContent = 'Copy';
    copy.addEventListener('click', () => {
      copySelectedNodes();
      closeContextMenu();
    });
    items.push(copy);

    // Paste item
    if (clipboard.length > 0) {
      const paste = document.createElement('button');
      paste.className = 'context-item';
      paste.textContent = 'Paste';
      paste.addEventListener('click', () => {
        pasteNodesAt(world.x, world.y);
        closeContextMenu();
      });
      items.push(paste);
    }

  } else if (arrowBodyHit !== -1) {
    // Arrow body hit
    selected.clear();
    selectedConnection = null;
    selectedArrows.clear();
    arrowDragTarget = null;
    selectedArrows.add(arrowBodyHit);
    const delArrow = document.createElement('button');
    delArrow.className = 'context-item';
    delArrow.textContent = 'Delete Arrow';
    delArrow.addEventListener('click', () => {
      for (const ai of selectedArrows) deleteArrowFn(ai);
      selectedArrows.clear();
      arrowDragTarget = null;
      refreshSidePanel();
      closeContextMenu();
    });
    items.push(delArrow);

  } else if (connHit !== null) {
    // Connection hit: show Delete Connection
    selectedConnection = connHit;
    selected.clear();
    const delConn = document.createElement('button');
    delConn.className = 'context-item';
    delConn.textContent = 'Delete Connection';
    delConn.addEventListener('click', () => {
      deleteSelectedConnection();
      closeContextMenu();
    });
    items.push(delConn);

  } else {
    // Background: Add submenu and Paste (Add at top)
    const addWrap = document.createElement('div');
    addWrap.className = 'context-submenu-trigger';
    const addBtn = document.createElement('button');
    addBtn.className = 'context-item has-submenu';
    addBtn.innerHTML = '<span>Add</span><span class="submenu-arrow">▸</span>';
    const sub = document.createElement('div');
    sub.className = 'context-submenu';
    const addNode = document.createElement('button');
    addNode.className = 'context-item';
    addNode.textContent = 'Add Node';
    addNode.addEventListener('click', () => {
      addNodeAt(world.x, world.y);
      closeContextMenu();
    });
    sub.appendChild(addNode);
    const addArrow = document.createElement('button');
    addArrow.className = 'context-item';
    addArrow.textContent = 'Add Arrow';
    addArrow.addEventListener('click', () => {
      addArrowAt(world.x, world.y);
      closeContextMenu();
    });
    sub.appendChild(addArrow);
    addWrap.appendChild(addBtn);
    addWrap.appendChild(sub);
    items.push(addWrap);

    if (clipboard.length > 0) {
      const paste = document.createElement('button');
      paste.className = 'context-item';
      paste.textContent = 'Paste';
      paste.addEventListener('click', () => {
        pasteNodesAt(world.x, world.y);
        closeContextMenu();
      });
      items.push(paste);
    }
  }

  if (items.length === 0) {
    // No items -> do not show
    closeContextMenu();
    return;
  }

  for (const it of items) menu.appendChild(it);
  const px = e.clientX;
  const py = e.clientY;
  menu.style.left = px + 'px';
  menu.style.top = py + 'px';
  menu.style.display = 'block';

  // Close on any outside click or Escape
  const offClick = (ev) => {
    if (!menu.contains(ev.target)) closeContextMenu();
  };
  const onEsc = (ev) => { if (ev.key === 'Escape') closeContextMenu(); };
  setTimeout(() => {
    document.addEventListener('pointerdown', offClick, { once: true });
    document.addEventListener('keydown', onEsc, { once: true });
  }, 0);
}

function closeContextMenu() {
  const menu = document.getElementById('contextMenu');
  if (menu) menu.style.display = 'none';
}

function deleteSelectedConnection() {
  if (selectedConnection === null) return;
  connections.splice(selectedConnection, 1);
  selectedConnection = null;
  refreshSidePanel();
}

function deleteSelectedNodes() {
  if (selected.size === 0) return;
  flushPanelEdit();
  const sortedIndices = Array.from(selected).sort((a, b) => a - b);
  const deletedEntries = sortedIndices.map(i => ({ node: nodes[i], index: i }));

  const toDelete = new Set(selected);
  const deletedIds = new Set(deletedEntries.map(e => e.node.id));

  const remain = [];
  const indexMap = [];
  for (let i = 0; i < nodes.length; i++) {
    if (!toDelete.has(i)) {
      if (nodes[i].parentId !== null && nodes[i].parentId !== undefined && deletedIds.has(nodes[i].parentId)) {
        nodes[i].parentId = null;
      }
      indexMap[i] = remain.length;
      remain.push(nodes[i]);
    }
  }
  nodes.length = 0;
  for (const n of remain) nodes.push(n);

  // Remove connections referencing deleted nodes and re-index
  const newConnections = [];
  const removedConnIds = [];
  for (let ci = 0; ci < connections.length; ci++) {
    const conn = connections[ci];
    const newFrom = indexMap[conn.from];
    const newTo = indexMap[conn.to];
    if (newFrom !== undefined && newTo !== undefined) {
      conn.from = newFrom;
      conn.to = newTo;
      newConnections.push(conn);
    } else {
      if (ci === selectedConnection) selectedConnection = null;
    }
  }
  connections.length = 0;
  for (const c of newConnections) connections.push(c);

  // Re-index arrow connections after node deletion
  for (const arrow of arrows) {
    if (arrow.connectedFrom !== null) {
      const newIdx = indexMap[arrow.connectedFrom];
      arrow.connectedFrom = newIdx !== undefined ? newIdx : null;
    }
    if (arrow.connectedTo !== null) {
      const newIdx = indexMap[arrow.connectedTo];
      arrow.connectedTo = newIdx !== undefined ? newIdx : null;
    }
  }

  if (connectingFrom !== null && toDelete.has(connectingFrom)) {
    connectingFrom = null;
  }

  selected.clear();
  markDrawOrderDirty();
  for (let i = 0; i < nodes.length; i++) {
    checkAndUpdateParenting(i);
  }
  refreshSidePanel();
  history.push(createDeleteNodesCmd(nodes, selected, refreshSidePanel, deletedEntries));
}

function duplicateSelectedNodes() {
  if (selected.size === 0) return;
  flushPanelEdit();
  const dupes = [];
  for (const i of selected) {
    const n = nodes[i];
    dupes.push({ 
      id: nextNodeId(),
      x: n.x + 20, 
      y: n.y + 20, 
      w: n.w, 
      h: n.h, 
      color: n.color, 
      title: n.title, 
      titleColor: n.titleColor, 
      text: n.text,
      parentId: null
    });
  }
  const startIdx = nodes.length;
  const entries = [];
  for (let i = 0; i < dupes.length; i++) {
    nodes.push(dupes[i]);
    entries.push({ node: dupes[i], index: startIdx + i });
  }
  selected.clear();
  for (let i = 0; i < dupes.length; i++) selected.add(startIdx + i);
  markDrawOrderDirty();
  for (let i = 0; i < nodes.length; i++) {
    checkAndUpdateParenting(i);
  }
  refreshSidePanel();
  history.push(createDuplicateNodesCmd(nodes, selected, refreshSidePanel, entries));
}

function copySelectedNodes() {
  clipboard = [];
  if (selected.size === 0) return;
  // Record selection bounding box and offsets to the last mouse position
  const rect = canvas.getBoundingClientRect();
  const mx = window._lastMouseX ?? rect.width / 2;
  const my = window._lastMouseY ?? rect.height / 2;
  const mouseWorld = screenToWorld(mx, my);

  // compute selection bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const selectedArray = Array.from(selected);
  for (const i of selectedArray) {
    const n = nodes[i];
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  // offsets from mouse to each node
  for (const i of selectedArray) {
    const n = nodes[i];
    clipboard.push({ 
      dx: n.x - mouseWorld.x, 
      dy: n.y - mouseWorld.y, 
      w: n.w, 
      h: n.h, 
      color: n.color, 
      title: n.title, 
      titleColor: n.titleColor, 
      text: n.text 
    });
  }
}

function pasteNodesAt(worldX, worldY) {
  if (clipboard.length === 0) return;
  flushPanelEdit();
  const startIdx = nodes.length;
  const pastedEntries = [];
  for (const c of clipboard) {
    const node = { 
      id: nextNodeId(),
      x: worldX + c.dx, 
      y: worldY + c.dy, 
      w: c.w, 
      h: c.h, 
      color: c.color, 
      title: c.title, 
      titleColor: c.titleColor, 
      text: c.text,
      parentId: null
    };
    const idx = nodes.length;
    nodes.push(node);
    pastedEntries.push({ node, index: idx });
  }
  selected.clear();
  for (let i = 0; i < pastedEntries.length; i++) selected.add(pastedEntries[i].index);
  markDrawOrderDirty();
  for (let i = 0; i < nodes.length; i++) {
    checkAndUpdateParenting(i);
  }
  refreshSidePanel();
  history.push(createPasteNodesCmd(nodes, selected, refreshSidePanel, pastedEntries));
}

// --- Pointer interactions: RMB pans, LMB selects/drags nodes; Shift=add, Ctrl=remove; LMB on bg = marquee ---
canvas.addEventListener('pointerdown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const world = screenToWorld(sx, sy);

  // Flush any pending panel edit before canvas interaction
  flushPanelEdit();

  // Close inline editor on any canvas click
  if (editingState) {
    commitEditing();
  }

  // Handle connecting mode: LMB on node = complete, LMB/RMB elsewhere = cancel
  if (connectingFrom !== null) {
    if (e.button === 0) {
      const hit = hitTestNode(world.x, world.y);
      if (hit !== -1 && hit !== connectingFrom) {
        const exists = connections.some(c =>
          (c.from === connectingFrom && c.to === hit) || (c.from === hit && c.to === connectingFrom)
        );
        if (!exists) {
          const conn = {
            id: nextConnectionId++,
            from: connectingFrom,
            to: hit,
            color: '#6bb5ff',
            text: ''
          };
          connections.push(conn);
        }
      }
      connectingFrom = null;
      e.preventDefault();
      return;
    }
    if (e.button === 2) {
      connectingFrom = null;
      return;
    }
  }

  if (e.button === 2) {
    // Right button: prepare for possible panning or context menu
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    rmbDownTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    rmbMoved = false;
    rmbPending = true;
    return;
  }

  if (e.button === 0) {
    // Check for arrow endpoint hit first (highest priority)
    const arrowEndHit = hitTestArrowEnd(world.x, world.y);
    if (arrowEndHit) {
      selected.clear();
      selectedConnection = null;
      selectedArrows.clear();
      selectedArrows.add(arrowEndHit.arrowIdx);
      arrowDragTarget = arrowEndHit;
      isDraggingArrowEnd = true;
      dragArrowEndWhich = arrowEndHit.end;
      const arrow = arrows[arrowEndHit.arrowIdx];
      dragArrowEndSnapshot = {
        x1: arrow.x1, y1: arrow.y1,
        x2: arrow.x2, y2: arrow.y2,
        connectedFrom: arrow.connectedFrom,
        connectedTo: arrow.connectedTo
      };
      refreshSidePanel();
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    let hit = hitTestNode(world.x, world.y);

    // Check for edge resize — also catches clicks just outside node bounds (within EDGE_MARGIN)
    let edgeHit = null;
    if (hit !== -1) {
      edgeHit = getEdgeAt(world.x, world.y);
    } else {
      const nearHit = findNodeAtEdge(world.x, world.y);
      if (nearHit) {
        edgeHit = nearHit;
        hit = nearHit.idx;
      }
    }
    if (edgeHit) {
      flushPanelEdit();
      if (!selected.has(edgeHit.idx)) {
        selected.clear();
        selected.add(edgeHit.idx);
      }
      isResizing = true;
      resizeNodeIdx = edgeHit.idx;
      resizeNodeId = nodes[edgeHit.idx].id;
      resizeHandle = edgeHit.handle;
      resizeStartWorldX = world.x;
      resizeStartWorldY = world.y;
      resizeStartNode = { x: nodes[edgeHit.idx].x, y: nodes[edgeHit.idx].y, w: nodes[edgeHit.idx].w, h: nodes[edgeHit.idx].h };
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    if (hit !== -1) {
      selectedConnection = null;
      arrowDragTarget = null;
      selectedArrows.clear();
      // Defer selection change until we know it's not a drag
      pointerDownScreenX = sx;
      pointerDownScreenY = sy;
      pendingClickIndex = hit;
      pendingShiftKey = e.shiftKey;
      pendingCtrlKey = e.ctrlKey;
      didDragSincePointerDown = false;

      // If Ctrl, apply immediate removal
      if (e.ctrlKey) {
        if (selected.has(hit)) selected.delete(hit);
        pendingClickIndex = -1;
        e.preventDefault();
        return;
      }
      // If Shift, apply immediate addition; drag will keep group
      if (e.shiftKey) {
        selected.add(hit);
      }

      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // Check for arrow body hit
    if (!e.ctrlKey) {
      const bodyHit = hitTestArrowBody(world.x, world.y);
      if (bodyHit !== -1) {
        selected.clear();
        selectedConnection = null;
        if (!e.shiftKey) {
          selectedArrows.clear();
          arrowDragTarget = null;
          selectedArrows.add(bodyHit);
        } else {
          if (selectedArrows.has(bodyHit)) selectedArrows.delete(bodyHit);
          else selectedArrows.add(bodyHit);
        }
        // If no arrows left in selection, clear drag target
        if (selectedArrows.size === 0) arrowDragTarget = null;
        // Prepare for possible body drag
        pointerDownScreenX = sx;
        pointerDownScreenY = sy;
        pendingClickIndex = -2; // sentinel: body drag pending
        didDragSincePointerDown = false;
        refreshSidePanel();
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
    }

    // Background: check for connection hit
    if (hit === -1 && !e.shiftKey && !e.ctrlKey) {
      const connHit = hitTestConnection(world.x, world.y);
      if (connHit !== null) {
        selected.clear();
        selectedArrows.clear();
        arrowDragTarget = null;
        selectedConnection = connHit;
        refreshSidePanel();
        e.preventDefault();
        return;
      }
    }

    // Background: start selection box
    isSelectingBox = true;
    selectedConnection = null;
    selectedArrows.clear();
    arrowDragTarget = null;
    boxStartX = world.x;
    boxStartY = world.y;
    boxEndX = world.x;
    boxEndY = world.y;
    boxMode = e.shiftKey ? 'add' : (e.ctrlKey ? 'remove' : 'replace');
    boxBaseSelection = new Set(selected);
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }
});

canvas.addEventListener('pointermove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  // Track last mouse for keyboard paste
  window._lastMouseX = sx;
  window._lastMouseY = sy;
  const world = screenToWorld(sx, sy);
  lastWorldMouse = { x: world.x, y: world.y };

  // Track mouse for connection preview
  if (connectingFrom !== null) {
    connectingMouseWorld = { x: world.x, y: world.y };
  }

  // Handle arrow endpoint drag
  if (isDraggingArrowEnd && arrowDragTarget) {
    const arrow = arrows[arrowDragTarget.arrowIdx];
    if (arrow) {
      if (arrowDragTarget.end === 'start') {
        arrow.x1 = world.x;
        arrow.y1 = world.y;
        const snapNode = findNodeAtPoint(world.x, world.y);
        if (snapNode !== -1 && snapNode !== arrow.connectedTo) {
          arrow.connectedFrom = snapNode;
          const edge = getNodeEdgePoint(nodes[snapNode], arrow.x2, arrow.y2);
          arrow.x1 = edge.x;
          arrow.y1 = edge.y;
        } else if (snapNode === -1) {
          arrow.connectedFrom = null;
        }
      } else {
        arrow.x2 = world.x;
        arrow.y2 = world.y;
        const snapNode = findNodeAtPoint(world.x, world.y);
        if (snapNode !== -1 && snapNode !== arrow.connectedFrom) {
          arrow.connectedTo = snapNode;
          const edge = getNodeEdgePoint(nodes[snapNode], arrow.x1, arrow.y1);
          arrow.x2 = edge.x;
          arrow.y2 = edge.y;
        } else if (snapNode === -1) {
          arrow.connectedTo = null;
        }
      }
    }
    e.preventDefault();
    return;
  }

  // Handle arrow body drag (both endpoints move together)
  if (isDraggingArrowBody && dragArrowBodyIdx !== -1) {
    const arrow = arrows[dragArrowBodyIdx];
    if (arrow && dragArrowBodyStartWorld) {
      const dx = world.x - dragArrowBodyStartWorld.x;
      const dy = world.y - dragArrowBodyStartWorld.y;
      arrow.x1 = dragArrowBodySnapshot.x1 + dx;
      arrow.y1 = dragArrowBodySnapshot.y1 + dy;
      arrow.x2 = dragArrowBodySnapshot.x2 + dx;
      arrow.y2 = dragArrowBodySnapshot.y2 + dy;
      // Disconnect from nodes when dragging body
      arrow.connectedFrom = null;
      arrow.connectedTo = null;
    }
    e.preventDefault();
    return;
  }

  // Handle resize
  if (isResizing) {
    const dx = world.x - resizeStartWorldX;
    const dy = world.y - resizeStartWorldY;
    const start = resizeStartNode;
    const n = nodes[resizeNodeIdx];
    let newX = start.x, newY = start.y, newW = start.w, newH = start.h;

    switch (resizeHandle) {
      case 'left':   newX = start.x + dx; newW = start.w - dx; break;
      case 'right':  newW = start.w + dx; break;
      case 'top':    newY = start.y + dy; newH = start.h - dy; break;
      case 'bottom': newH = start.h + dy; break;
      case 'tl':     newX = start.x + dx; newY = start.y + dy; newW = start.w - dx; newH = start.h - dy; break;
      case 'tr':     newY = start.y + dy; newW = start.w + dx; newH = start.h - dy; break;
      case 'bl':     newX = start.x + dx; newW = start.w - dx; newH = start.h + dy; break;
      case 'br':     newW = start.w + dx; newH = start.h + dy; break;
    }

    if (newW < NODE_MIN_W) {
      if (resizeHandle.includes('l')) newX = start.x + start.w - NODE_MIN_W;
      newW = NODE_MIN_W;
    }
    if (newH < NODE_MIN_H) {
      if (resizeHandle[0] === 't') newY = start.y + start.h - NODE_MIN_H;
      newH = NODE_MIN_H;
    }

    n.x = newX; n.y = newY; n.w = newW; n.h = newH;
    e.preventDefault();
    return;
  }

  if (isDraggingNode) {
    const dx = world.x - dragStartWorldX;
    const dy = world.y - dragStartWorldY;
    for (const item of dragGroupStarts) {
      const n = nodes[item.i];
      n.x = item.x + dx;
      n.y = item.y + dy;
    }
    e.preventDefault();
    return;
  }

  if ((e.buttons & 2) === 2 || isPanning) {
    const dx = e.clientX - lastPanX;
    const dy = e.clientY - lastPanY;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    targetOffsetX += dx;
    targetOffsetY += dy;
    if (Math.abs(dx) + Math.abs(dy) > 0) rmbMoved = true;
    isPanning = true; // begin panning on movement
    e.preventDefault();
    return;
  }

  // If we have a pending click on a node and moved past threshold, start dragging
  if (pendingClickIndex >= 0 && (e.buttons & 1) === 1) {
    const moveDx = Math.abs(sx - pointerDownScreenX);
    const moveDy = Math.abs(sy - pointerDownScreenY);
    if (moveDx >= DRAG_THRESHOLD_PX || moveDy >= DRAG_THRESHOLD_PX) {
      // Ensure the drag group is the current selection, or the clicked node if it wasn't selected
      if (!selected.has(pendingClickIndex)) {
        selected.clear();
        selected.add(pendingClickIndex);
      } else if (selected.size === 1 && !pendingShiftKey && !pendingCtrlKey) {
        // already one item, okay
      }
      isDraggingNode = true;
      didDragSincePointerDown = true;
      dragStartWorldX = world.x;
      dragStartWorldY = world.y;
      dragGroupStarts = getDragGroup(selected).map(it => ({ ...it, id: nodes[it.i].id }));
    }
  }
  // Arrow body drag initiation — moves all selected arrows
  if (pendingClickIndex === -2 && selectedArrows.size > 0 && (e.buttons & 1) === 1) {
    const moveDx = Math.abs(sx - pointerDownScreenX);
    const moveDy = Math.abs(sy - pointerDownScreenY);
    if (moveDx >= DRAG_THRESHOLD_PX || moveDy >= DRAG_THRESHOLD_PX) {
      isDraggingArrowBody = true;
      dragArrowBodyStartWorld = { x: world.x, y: world.y };
      dragArrowBodySnapshots = [];
      for (const ai of selectedArrows) {
        const a = arrows[ai];
        if (a) {
          dragArrowBodySnapshots.push({
            idx: ai,
            x1: a.x1, y1: a.y1,
            x2: a.x2, y2: a.y2,
            connectedFrom: a.connectedFrom,
            connectedTo: a.connectedTo
          });
        }
      }
      didDragSincePointerDown = true;
    }
  }

  // Hover feedback: cursor for resize handles, move, or grab
  let cursorSet = false;
  hoveredHandleInfo = null;

  if (connectingFrom !== null) {
    canvas.style.cursor = 'crosshair';
    cursorSet = true;
  }
  if (!isDraggingNode && !isResizing && !isPanning && !isSelectingBox && !isDraggingArrowEnd) {
    const handleHit = getEdgeAt(world.x, world.y);
    if (handleHit) {
      canvas.style.cursor = handleHit.cursor;
      hoveredHandleInfo = handleHit;
      cursorSet = true;
    }
  }
  if (!cursorSet && !isDraggingNode && !isResizing && !isPanning && !isSelectingBox && connectingFrom === null && !isDraggingArrowEnd) {
    const connHit = hitTestConnection(world.x, world.y);
    if (connHit !== null) {
      canvas.style.cursor = 'pointer';
      cursorSet = true;
    }
  }
  if (isDraggingArrowBody) {
    canvas.style.cursor = 'move';
    cursorSet = true;
  }
  if (!cursorSet && !isDraggingNode && !isResizing && !isPanning && !isSelectingBox && !isDraggingArrowEnd && !isDraggingArrowBody) {
    const bodyHit = hitTestArrowBody(world.x, world.y);
    if (bodyHit !== -1) {
      canvas.style.cursor = 'pointer';
      cursorSet = true;
    }
  }
  if (!cursorSet && !isDraggingNode && !isResizing && !isPanning && !isSelectingBox && !isDraggingArrowEnd) {
    const bodyHit = hitTestArrowBody(world.x, world.y);
    if (bodyHit !== -1) {
      canvas.style.cursor = 'pointer';
      cursorSet = true;
    }
  }
  if (!cursorSet) {
    let overSelected = false;
    for (const i of selected) {
      const n = nodes[i];
      if (world.x >= n.x && world.x <= n.x + n.w && world.y >= n.y && world.y <= n.y + n.h) {
        overSelected = true; break;
      }
    }
    canvas.style.cursor = overSelected ? 'move' : 'grab';
  }

  if (isSelectingBox) {
    boxEndX = world.x;
    boxEndY = world.y;

    // Live update selection while dragging the marquee
    const bx1 = Math.min(boxStartX, boxEndX);
    const by1 = Math.min(boxStartY, boxEndY);
    const bx2 = Math.max(boxStartX, boxEndX);
    const by2 = Math.max(boxStartY, boxEndY);
    const hits = [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const ix1 = Math.max(bx1, n.x);
      const iy1 = Math.max(by1, n.y);
      const ix2 = Math.min(bx2, n.x + n.w);
      const iy2 = Math.min(by2, n.y + n.h);
      if (ix2 >= ix1 && iy2 >= iy1) hits.push(i);
    }

    // Check arrow endpoints and body inside the box
    let boxArrowHit = -1;
    for (let ai = 0; ai < arrows.length; ai++) {
      if (isArrowInBox(arrows[ai], bx1, by1, bx2, by2)) {
        boxArrowHit = ai;
        break;
      }
    }

    let newSelected;
    if (boxMode === 'replace') {
      newSelected = new Set(hits);
      if (boxArrowHit !== -1) { selectedArrow = boxArrowHit; selectedArrowEnd = null; }
      else { selectedArrow = null; selectedArrowEnd = null; }
    } else if (boxMode === 'add') {
      newSelected = new Set(boxBaseSelection);
      for (const i of hits) newSelected.add(i);
      if (boxArrowHit !== -1) selectedArrow = boxArrowHit;
    } else {
      // remove
      newSelected = new Set(boxBaseSelection);
      for (const i of hits) newSelected.delete(i);
      if (boxArrowHit !== -1) { selectedArrow = null; selectedArrowEnd = null; }
    }
    selected.clear();
    for (const i of newSelected) selected.add(i);
    refreshSidePanel();
  }

  // No live paste mode; paste happens instantly at cursor on click/shortcut
});

canvas.addEventListener('pointerup', (e) => {
  if (isResizing) {
    const n = nodes[resizeNodeIdx];
    if (n && (n.x !== resizeStartNode.x || n.y !== resizeStartNode.y || n.w !== resizeStartNode.w || n.h !== resizeStartNode.h)) {
      history.push(createResizeNodeCmd(nodes, selected, refreshSidePanel, resizeNodeId,
        { x: resizeStartNode.x, y: resizeStartNode.y, w: resizeStartNode.w, h: resizeStartNode.h },
        { x: n.x, y: n.y, w: n.w, h: n.h }));
      markDrawOrderDirty();
      for (let i = 0; i < nodes.length; i++) {
        checkAndUpdateParenting(i);
      }
    }
    isResizing = false;
    resizeNodeId = -1;
  }
  if (isPanning) {
    isPanning = false;
  }
  if (isDraggingNode) {
    const moves = [];
    const movedIndices = new Set();
    for (const item of dragGroupStarts) {
      const n = nodes[item.i];
      if (n && (n.x !== item.x || n.y !== item.y)) {
        moves.push({ id: item.id, fromX: item.x, fromY: item.y, toX: n.x, toY: n.y });
        movedIndices.add(item.i);
      }
    }
    if (moves.length > 0) {
      history.push(createMoveNodesCmd(nodes, selected, refreshSidePanel, moves));
      for (let i = 0; i < nodes.length; i++) {
        checkAndUpdateParenting(i);
      }
    }
    isDraggingNode = false;
  }
  if (isDraggingArrowEnd && selectedArrowEnd) {
    const arrow = arrows[selectedArrowEnd.arrowIdx];
    if (arrow && dragArrowEndSnapshot) {
      const moved = arrow.x1 !== dragArrowEndSnapshot.x1 || arrow.y1 !== dragArrowEndSnapshot.y1 ||
                    arrow.x2 !== dragArrowEndSnapshot.x2 || arrow.y2 !== dragArrowEndSnapshot.y2 ||
                    arrow.connectedFrom !== dragArrowEndSnapshot.connectedFrom ||
                    arrow.connectedTo !== dragArrowEndSnapshot.connectedTo;
      if (moved) {
        history.push(createMoveArrowEndCmd(arrows, selectedArrowEnd.arrowIdx,
          { x1: dragArrowEndSnapshot.x1, y1: dragArrowEndSnapshot.y1,
            x2: dragArrowEndSnapshot.x2, y2: dragArrowEndSnapshot.y2,
            connectedFrom: dragArrowEndSnapshot.connectedFrom,
            connectedTo: dragArrowEndSnapshot.connectedTo },
          { x1: arrow.x1, y1: arrow.y1,
            x2: arrow.x2, y2: arrow.y2,
            connectedFrom: arrow.connectedFrom,
            connectedTo: arrow.connectedTo }
        ));
      }
    }
    isDraggingArrowEnd = false;
    dragArrowEndSnapshot = null;
    refreshSidePanel();
  }

  if (isDraggingArrowBody && dragArrowBodyIdx !== -1) {
    const arrow = arrows[dragArrowBodyIdx];
    if (arrow && dragArrowBodySnapshot) {
      const moved = arrow.x1 !== dragArrowBodySnapshot.x1 || arrow.y1 !== dragArrowBodySnapshot.y1 ||
                    arrow.x2 !== dragArrowBodySnapshot.x2 || arrow.y2 !== dragArrowBodySnapshot.y2;
      if (moved) {
        history.push(createMoveArrowEndCmd(arrows, dragArrowBodyIdx,
          { x1: dragArrowBodySnapshot.x1, y1: dragArrowBodySnapshot.y1,
            x2: dragArrowBodySnapshot.x2, y2: dragArrowBodySnapshot.y2,
            connectedFrom: dragArrowBodySnapshot.connectedFrom,
            connectedTo: dragArrowBodySnapshot.connectedTo },
          { x1: arrow.x1, y1: arrow.y1,
            x2: arrow.x2, y2: arrow.y2,
            connectedFrom: null, connectedTo: null }
        ));
      }
    }
    isDraggingArrowBody = false;
    dragArrowBodyIdx = -1;
    dragArrowBodySnapshot = null;
    dragArrowBodyStartWorld = null;
    refreshSidePanel();
  }

  if (isSelectingBox) {
    // finalize box selection
    const bx1 = Math.min(boxStartX, boxEndX);
    const by1 = Math.min(boxStartY, boxEndY);
    const bx2 = Math.max(boxStartX, boxEndX);
    const by2 = Math.max(boxStartY, boxEndY);

    const hits = [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const ix1 = Math.max(bx1, n.x);
      const iy1 = Math.max(by1, n.y);
      const ix2 = Math.min(bx2, n.x + n.w);
      const iy2 = Math.min(by2, n.y + n.h);
      if (ix2 >= ix1 && iy2 >= iy1) hits.push(i);
    }

    // Check arrow endpoints and body inside the box
    let boxArrowHit = -1;
    for (let ai = 0; ai < arrows.length; ai++) {
      if (isArrowInBox(arrows[ai], bx1, by1, bx2, by2)) {
        boxArrowHit = ai;
        break;
      }
    }

    if (boxMode === 'replace') {
      selected.clear();
      hits.forEach(i => selected.add(i));
      if (boxArrowHit !== -1) { selectedArrow = boxArrowHit; selectedArrowEnd = null; }
      else { selectedArrow = null; selectedArrowEnd = null; }
    } else if (boxMode === 'add') {
      hits.forEach(i => selected.add(i));
      if (boxArrowHit !== -1) selectedArrow = boxArrowHit;
    } else if (boxMode === 'remove') {
      hits.forEach(i => selected.delete(i));
      if (boxArrowHit !== -1) { selectedArrow = null; selectedArrowEnd = null; }
    }

    isSelectingBox = false;
    refreshSidePanel();
  }
  // Apply deferred click selection (no drag happened)
  if (pendingClickIndex !== -1 && pendingClickIndex !== -2 && !didDragSincePointerDown) {
    if (selected.has(pendingClickIndex) && selected.size > 1 && !pendingShiftKey) {
      selected.clear();
      selected.add(pendingClickIndex);
    } else if (!selected.has(pendingClickIndex) && !pendingShiftKey && !pendingCtrlKey) {
      selected.clear();
      selected.add(pendingClickIndex);
    }
  }
  pendingClickIndex = -1;
  didDragSincePointerDown = false;
  pendingShiftKey = false;
  pendingCtrlKey = false;
  // If RMB was held and released without movement, allow contextmenu to show.
  // Otherwise, clear the pending so contextmenu won't appear.
  if (e.button === 2) {
    if (rmbMoved) {
      rmbPending = false;
    }
  }
  // Nothing extra when releasing in paste mode
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
  // Do not force close here; allow contextmenu to open if appropriate
  refreshSidePanel();
});

// --- Double-click inline editing ---
canvas.addEventListener('dblclick', (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const world = screenToWorld(sx, sy);

  const hit = hitTestNode(world.x, world.y);

  // Double-click on connection → inline text editor
  if (hit === -1) {
    const connHit = hitTestConnection(world.x, world.y);
    if (connHit !== null) {
      selected.clear();
      selectedConnection = connHit;
      startConnectionEditing(connHit);
      return;
    }
    return;
  }

  const n = nodes[hit];
  const padding = 8;
  const titleFont = `bold ${15}px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif`;
  const titleLineHeight = 18;
  const maxTitleHeight = n.h / 3;
  const maxTitleWidth = Math.max(0, n.w - padding * 2);
  const titleLines = wrapTextLines(ctx, titleFont, n.title || '', maxTitleWidth);
  const requiredTitleHeight = Math.max(0, titleLines.length * titleLineHeight + padding * 2);
  const minTitleHeight = Math.min(maxTitleHeight, Math.max(24, padding * 2 + titleLineHeight));
  const titleH = Math.min(maxTitleHeight, Math.max(minTitleHeight, requiredTitleHeight));

  // Ensure node is selected
  if (!selected.has(hit)) {
    selected.clear();
    selected.add(hit);
  }

  if (world.y >= n.y && world.y <= n.y + titleH) {
    startEditing(hit, 'title', n.x, n.y, n.w, titleH);
  } else {
    const contentY = n.y + titleH + padding;
    const maxTextHeight = Math.max(0, n.h - titleH - padding * 2);
    startEditing(hit, 'text', n.x + padding - 4, contentY - 4, maxTitleWidth + 8, maxTextHeight + 8);
  }
});

// --- Zoom handling ---
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  // Close inline editor on zoom
  if (editingState) {
    commitEditing();
  }
  const zoomDir = e.deltaY < 0 ? 1 : -1;
  const zoomFactor = Math.pow(gridSettings.zoomFactor, zoomDir);
  const newScale = targetScale * zoomFactor;

  if (newScale < gridSettings.minScale || newScale > gridSettings.maxScale) return;

  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  targetOffsetX -= (mouseX - targetOffsetX) * (zoomFactor - 1);
  targetOffsetY -= (mouseY - targetOffsetY) * (zoomFactor - 1);

  targetScale = newScale;
}, { passive: false });

// --- Keyboard handling ---
window.addEventListener('keydown', (e) => {
  // If inline editor is open, only handle Escape to cancel
  if (editingState) {
    if (e.key === 'Escape') {
      cancelEditing();
      e.preventDefault();
    }
    return;
  }

  // Avoid interfering with typing in inputs
  const active = document.activeElement;
  const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
  if (!isInput && (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key.toLowerCase() === 'z')) {
    performUndo();
    e.preventDefault();
    return;
  }
  if (!isInput && (e.ctrlKey || e.metaKey) && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y')) {
    performRedo();
    e.preventDefault();
    return;
  }
  if (!isInput && (e.key === 'Delete' || e.key === 'Backspace')) {
    if (selectedArrows.size > 0) {
      for (const ai of selectedArrows) deleteArrowFn(ai);
      selectedArrows.clear();
      arrowDragTarget = null;
      refreshSidePanel();
      e.preventDefault();
      return;
    }
    if (selectedConnection !== null) {
      deleteSelectedConnection();
      e.preventDefault();
      return;
    }
    deleteSelectedNodes();
    e.preventDefault();
  }
  if (!isInput && (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'c')) {
    copySelectedNodes();
    e.preventDefault();
  }
  if (!isInput && (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'v')) {
    // Paste immediately at current mouse position if possible; fallback to center
    const rect = canvas.getBoundingClientRect();
    const mx = window._lastMouseX ?? rect.width / 2;
    const my = window._lastMouseY ?? rect.height / 2;
    const world = screenToWorld(mx, my);
    pasteNodesAt(world.x, world.y);
    e.preventDefault();
  }
  if (!isInput && (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'd')) {
    duplicateSelectedNodes();
    e.preventDefault();
  }
  if (!isInput && e.key === 'Escape') {
    if (connectingFrom !== null) {
      connectingFrom = null;
      return;
    }
    closeContextMenu();
    if (isDraggingArrowBody) {
      isDraggingArrowBody = false;
      dragArrowBodySnapshots = [];
      dragArrowBodyStartWorld = null;
    }
    if (selectedArrows.size > 0 || arrowDragTarget !== null) {
      selectedArrows.clear();
      arrowDragTarget = null;
      refreshSidePanel();
      return;
    }
    if (selectedConnection !== null) {
      selectedConnection = null;
      refreshSidePanel();
    }
  }
});

// --- Document management ---
function getDocumentState() {
  return {
    nodes,
    connections,
    arrows,
    viewport: {
      offsetX: targetOffsetX,
      offsetY: targetOffsetY,
      scale: targetScale
    },
    settings: {}
  };
}

function restoreDocumentState(state) {
  nodes.length = 0;
  connections.length = 0;
  arrows.length = 0;
  selected.clear();
  selectedConnection = null;
  selectedArrows.clear();
  arrowDragTarget = null;
  clipboard = [];
  connectingFrom = null;
  history.clear();
  panelPendingEdit = null;

  for (const n of (state.nodes || [])) {
    nodes.push(n);
  }
  for (const c of (state.connections || [])) {
    connections.push(c);
  }
  for (const a of (state.arrows || [])) {
    arrows.push(a);
  }

  let maxNodeId = 0;
  for (const n of nodes) {
    if (typeof n.id === 'number' && n.id > maxNodeId) maxNodeId = n.id;
  }
  initNodeId(maxNodeId + 1);

  let maxConnId = 0;
  for (const c of connections) {
    if (c.id > maxConnId) maxConnId = c.id;
  }
  nextConnectionId = maxConnId + 1;

  let maxArrowId = 0;
  for (const a of arrows) {
    if (a.id > maxArrowId) maxArrowId = a.id;
  }
  nextArrowId = Math.max(nextArrowId, maxArrowId + 1);

  const vp = state.viewport || {};
  offsetX = targetOffsetX = vp.offsetX ?? 0;
  offsetY = targetOffsetY = vp.offsetY ?? 0;
  scale = targetScale = vp.scale ?? 1;

  markDrawOrderDirty();
  for (let i = 0; i < nodes.length; i++) {
    checkAndUpdateParenting(i);
  }
  refreshSidePanel();
}

function newDocument() {
  restoreDocumentState({ nodes: [], connections: [], viewport: { offsetX: 0, offsetY: 0, scale: 1 } });
  currentFileName = null;
  markDrawOrderDirty();
}

async function saveDocument() {
  const state = getDocumentState();
  const doc = serializeDocument(state);
  const suggestedName = currentFileName || `document${FILE_EXTENSION}`;
  const result = await saveToFile(doc, suggestedName);
  if (result) {
    currentFileName = result.name;
  }
}

async function openDocument() {
  const result = await loadFromFile();
  if (!result) return;
  const state = deserializeDocument(result.data);
  restoreDocumentState(state);
  currentFileName = result.name;
}

// --- Animation loop ---
function animate() {
  // Smooth lerp for pan & zoom
  offsetX += (targetOffsetX - offsetX) * gridSettings.panLerp;
  offsetY += (targetOffsetY - offsetY) * gridSettings.panLerp;
  scale += (targetScale - scale) * gridSettings.zoomLerp;

  const dpr = window.devicePixelRatio || 1;

  // Clear canvas
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  // Draw grid
  drawGrid(ctx, canvas, offsetX, offsetY, scale, dpr);

  // Draw connections (underneath nodes), drop orphan connections
  for (let ci = connections.length - 1; ci >= 0; ci--) {
    const conn = connections[ci];
    const fromNode = nodes[conn.from];
    const toNode = nodes[conn.to];
    if (!fromNode || !toNode) {
      connections.splice(ci, 1);
      if (selectedConnection === ci) selectedConnection = null;
      else if (selectedConnection > ci) selectedConnection--;
      continue;
    }
    drawConnection(ctx, fromNode, toNode, conn);
  }

  // Draw connecting preview
  if (connectingFrom !== null) {
    const srcNode = nodes[connectingFrom];
    if (srcNode) {
      drawConnectionPreview(ctx, srcNode, connectingMouseWorld.x, connectingMouseWorld.y);
    }
  }

  // Update arrow endpoint positions from connections, then draw arrows
  updateArrowPositionsFromConnections();
  drawArrows(ctx);

  // Draw nodes (world space; drawGrid already set the world transform)
  const drawOrder = getDrawOrder();
  for (const idx of drawOrder) {
    const n = nodes[idx];
    // Base style
    const baseColor = n.color || 'rgb(43, 43, 43)';
    
    // Shadow (layered fills — simulates gaussian blur in world space, consistent at any zoom)
    const nodeRadius = Math.min(12, Math.min(n.w, n.h) * 0.2);
    ctx.save();
    // Draw outer layers first so inner layers build on top — creates a smooth falloff
    [
      { dx: 10, dy: 10, ex: 10, ey: 10, rr: 3, a: 0.03 },
      { dx: 7, dy: 7, ex: 6, ey: 6, rr: 2, a: 0.06 },
      { dx: 5, dy: 5, ex: 3, ey: 3, rr: 1, a: 0.12 },
      { dx: 4, dy: 4, ex: 0, ey: 0, rr: 0, a: 0.22 },
    ].forEach(l => {
      ctx.fillStyle = `rgba(0, 0, 0, ${l.a})`;
      drawRoundedRect(ctx, n.x + l.dx, n.y + l.dy, n.w + l.ex, n.h + l.ey, nodeRadius + l.rr);
      ctx.fill();
    });
    ctx.restore();

    ctx.save();
    ctx.fillStyle = baseColor;
    drawRoundedRect(ctx, n.x, n.y, n.w, n.h, nodeRadius);
    ctx.fill();
    ctx.restore();

    // Exterior outline: slightly darker than base (world-space width)
    ctx.strokeStyle = getDarkerColor(baseColor, 0.7);
    ctx.lineWidth = 2; // world units; scales with zoom
    // Draw outline with offset to make it exterior
    const outlineOffset = ctx.lineWidth / 2;
    drawRoundedRect(ctx, n.x - outlineOffset, n.y - outlineOffset, n.w + outlineOffset * 2, n.h + outlineOffset * 2, nodeRadius + outlineOffset);
    ctx.stroke();

    // Selection outline around the whole node (screen-space thickness)
    if (selected.has(idx)) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const screenX = (n.x * scale + offsetX) * dpr;
      const screenY = (n.y * scale + offsetY) * dpr;
      const screenW = n.w * scale * dpr;
      const screenH = n.h * scale * dpr;
      const screenRadius = nodeRadius * scale * dpr;
      ctx.strokeStyle = '#f0c800';
      ctx.lineWidth = 1.5;
      const selectionOffset = ctx.lineWidth / 2;
      drawRoundedRect(ctx, screenX - selectionOffset, screenY - selectionOffset, screenW + selectionOffset * 2, screenH + selectionOffset * 2, screenRadius + selectionOffset);
      ctx.stroke();
      ctx.restore();
    }

         // Title bar background (fixed height, consistent with or without title)
     const padding = 8;
     const titleLineHeight = 18;
     const maxTitleWidth = Math.max(0, n.w - padding * 2);
     const titleH = padding * 2 + titleLineHeight;
     ctx.save();
     ctx.fillStyle = getDarkerColor(baseColor, 0.6);
     drawRoundedRectTopOnly(ctx, n.x, n.y, n.w, titleH, nodeRadius);
     ctx.fill();
     ctx.restore();

    // Title text (bold, larger) with markdown support
    if (n.title && n.title.length > 0) {
      ctx.save();
      const titleBaseFontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
      renderMarkdownTitle(
        ctx,
        n.title,
        n.x + n.w / 2,
        n.y + padding,
        maxTitleWidth,
        titleBaseFontFamily,
        15,
        n.titleColor || '#e7e7e7'
      );
      ctx.restore();
    }

    // Body text with markdown support (below title area)
    if (n.text && n.text.length > 0) {
      ctx.save();
      const bodyBaseFontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
      renderMarkdownBody(
        ctx,
        n.text,
        n.x + padding,
        n.y + titleH + padding,
        Math.max(0, n.w - padding * 2),
        Math.max(0, n.h - titleH - padding * 2),
        bodyBaseFontFamily,
        12,
        '#ddd',
        14
      );
      ctx.restore();
    }

  }

  // Draw selection marquee if active
  if (isSelectingBox) {
    const x1 = Math.min(boxStartX, boxEndX);
    const y1 = Math.min(boxStartY, boxEndY);
    const w = Math.abs(boxEndX - boxStartX);
    const h = Math.abs(boxEndY - boxStartY);
    ctx.lineWidth = 1 / (scale * dpr);
    ctx.strokeStyle = 'rgba(90,160,255,0.9)';
    ctx.fillStyle = 'rgba(90,160,255,0.15)';
    ctx.beginPath();
    ctx.rect(x1, y1, w, h);
    ctx.fill();
    ctx.stroke();
  }

  // (no live paste preview)

  // Keep side panel in sync even if an event was missed
  const key = computeSelectionKey();
  if (key !== lastPanelKey) {
    refreshSidePanel();
    lastPanelKey = key;
  }

  requestAnimationFrame(animate);
}
animate();

function refreshSidePanel() {
  if (!sidePanelContent) return;

  // Arrow end selected
  if (selectedArrowEnd !== null && arrows[selectedArrowEnd.arrowIdx]) {
    flushPanelEdit();
    const arrow = arrows[selectedArrowEnd.arrowIdx];
    const endLabel = selectedArrowEnd.end === 'start' ? 'Start (Tail)' : 'End (Tip)';
    const connNodeIdx = selectedArrowEnd.end === 'start' ? arrow.connectedFrom : arrow.connectedTo;
    const connLabel = connNodeIdx !== null && nodes[connNodeIdx]
      ? (nodes[connNodeIdx].title || `Node ${connNodeIdx}`) : 'None';
    const pt = getArrowEndpoint(arrow, selectedArrowEnd.end);
    const html = `
      <div class=\"panel-section-title\">Arrow Point (${endLabel})</div>
      <div class=\"panel-row\"><label>Connected to</label><span class=\"panel-static\">${connLabel}</span></div>
      <div class=\"panel-row\"><label>X</label><span class=\"panel-static\">${Math.round(pt.x)}</span></div>
      <div class=\"panel-row\"><label>Y</label><span class=\"panel-static\">${Math.round(pt.y)}</span></div>
    `;
    sidePanelContent.innerHTML = html;
    return;
  }

  // Whole arrow selected
  if (selectedArrow !== null && arrows[selectedArrow]) {
    flushPanelEdit();
    const arrow = arrows[selectedArrow];
    const fromLabel = arrow.connectedFrom !== null && nodes[arrow.connectedFrom]
      ? (nodes[arrow.connectedFrom].title || `Node ${arrow.connectedFrom}`) : 'Free';
    const toLabel = arrow.connectedTo !== null && nodes[arrow.connectedTo]
      ? (nodes[arrow.connectedTo].title || `Node ${arrow.connectedTo}`) : 'Free';
    const html = `
      <div class=\"panel-section-title\">Arrow</div>
      <div class=\"panel-row\"><label>From</label><span class=\"panel-static\">${fromLabel}</span></div>
      <div class=\"panel-row\"><label>To</label><span class=\"panel-static\">${toLabel}</span></div>
      <div class=\"panel-row\"><label>Color</label><input id=\"panelArrowColor\" class=\"panel-input\" type=\"color\" value=\"${arrow.color || '#6bb5ff'}\" /></div>
    `;
    sidePanelContent.innerHTML = html;

    const colorInput = document.getElementById('panelArrowColor');
    if (colorInput) colorInput.addEventListener('input', (ev) => { arrow.color = ev.target.value; });
    return;
  }

  // Connection selected
  if (selectedConnection !== null && connections[selectedConnection]) {
    flushPanelEdit();
    const conn = connections[selectedConnection];
    const fromNode = nodes[conn.from];
    const toNode = nodes[conn.to];
    const fromLabel = fromNode ? (fromNode.title || `Node ${conn.from}`) : '?';
    const toLabel = toNode ? (toNode.title || `Node ${conn.to}`) : '?';
    const html = `
      <div class=\"panel-section-title\">Connection</div>
      <div class=\"panel-row\"><label>From</label><span class=\"panel-static\">${fromLabel}</span></div>
      <div class=\"panel-row\"><label>To</label><span class=\"panel-static\">${toLabel}</span></div>
      <div class=\"panel-row\"><label>Color</label><input id=\"panelConnColor\" class=\"panel-input\" type=\"color\" value=\"${conn.color || '#6bb5ff'}\" /></div>
      <div class=\"panel-row\"><label>Text</label><input id=\"panelConnText\" class=\"panel-input\" type=\"text\" value=\"${escAttr(conn.text ?? '')}\" /></div>
    `;
    sidePanelContent.innerHTML = html;

    const colorInput = document.getElementById('panelConnColor');
    const textInput = document.getElementById('panelConnText');
    if (colorInput) colorInput.addEventListener('input', (ev) => { conn.color = ev.target.value; });
    if (textInput) textInput.addEventListener('input', (ev) => { conn.text = ev.target.value; });
    return;
  }

  if (selected.size === 0) {
    flushPanelEdit();
    sidePanelContent.innerHTML = '<div class="panel-empty">Nothing selected</div>';
    return;
  }
  if (selected.size > 1) {
    flushPanelEdit();
    sidePanelContent.innerHTML = `<div class=\"panel-section-title\">${selected.size} items selected</div>`;
    return;
  }

  flushPanelEdit();
  const idx = Array.from(selected)[0];
  const n = nodes[idx];
  const nodeId = n.id;
  const parentInfo = n.parentId !== null && n.parentId !== undefined
    ? (() => { const p = findNodeById(nodes, n.parentId); return p ? (p.node.title || `Node ${p.index}`) : '?'; })()
    : null;
  const parentHtml = parentInfo ? `<div class=\"panel-row\"><label>Parent</label><span class=\"panel-static\">${parentInfo}</span></div>` : '';
  const html = `
    <div class=\"panel-section-title\">Node</div>
    <div class=\"panel-row\"><label>Title</label><input id=\"panelTitle\" class=\"panel-input\" type=\"text\" value=\"${escAttr(n.title ?? '')}\" /></div>
    <div class=\"panel-row\"><label>Title Color</label><input id=\"panelTitleColor\" class=\"panel-input panel-input-color\" type=\"color\" value=\"${n.titleColor ?? '#e7e7e7'}\" /></div>
    <div class=\"panel-row\"><label>Color</label><input id=\"panelColor\" class=\"panel-input panel-input-color\" type=\"color\" value=\"${n.color ?? '#2b2b2b'}\" /></div>
    <div class=\"panel-row\"><label>Width</label><input id=\"panelW\" class=\"panel-input\" type=\"number\" min=\"10\" value=\"${n.w}\" /></div>
    <div class=\"panel-row\"><label>Height</label><input id=\"panelH\" class=\"panel-input\" type=\"number\" min=\"10\" value=\"${n.h}\" /></div>
    ${parentHtml}
    <div class=\"panel-row\"><label>Text</label><input id=\"panelText\" class=\"panel-input\" type=\"text\" value=\"${escAttr(n.text ?? '')}\" /></div>
  `;
  sidePanelContent.innerHTML = html;

  const titleInput = document.getElementById('panelTitle');
  const titleColorInput = document.getElementById('panelTitleColor');
  const colorInput = document.getElementById('panelColor');
  const wInput = document.getElementById('panelW');
  const hInput = document.getElementById('panelH');
  const textInput = document.getElementById('panelText');

  if (titleInput) {
    titleInput.addEventListener('input', (ev) => { n.title = ev.target.value; });
    titleInput.addEventListener('focus', () => { startPanelEdit(nodeId, 'title', n.title); });
    titleInput.addEventListener('blur', () => { flushPanelEdit(); });
  }
  if (titleColorInput) {
    titleColorInput.addEventListener('input', (ev) => { n.titleColor = ev.target.value; });
    titleColorInput.addEventListener('pointerdown', () => { startPanelEdit(nodeId, 'titleColor', n.titleColor); });
    titleColorInput.addEventListener('change', () => { flushPanelEdit(); });
  }
  if (colorInput) {
    colorInput.addEventListener('input', (ev) => { n.color = ev.target.value; });
    colorInput.addEventListener('pointerdown', () => { startPanelEdit(nodeId, 'color', n.color); });
    colorInput.addEventListener('change', () => { flushPanelEdit(); });
  }
  if (wInput) {
    wInput.setAttribute('data-drag-number', 'true');
    wInput.addEventListener('input', (ev) => {
      const v = parseFloat(ev.target.value);
      if (!Number.isNaN(v)) updateNodeWidth(n, v);
    });
    wInput.addEventListener('focus', () => { startPanelEdit(nodeId, 'w', n.w, { x: n.x, y: n.y, w: n.w, h: n.h }); });
    wInput.addEventListener('blur', () => { flushPanelEdit(); });
    let wDragStartBounds = { x: n.x, y: n.y, w: n.w, h: n.h };
    attachDragNumber(wInput,
      (delta) => { updateNodeWidth(n, n.w + delta); wInput.value = String(Math.round(n.w)); },
      () => {
        flushPanelEdit();
        const found = findNodeById(nodes, nodeId);
        if (found) wDragStartBounds = { x: found.node.x, y: found.node.y, w: found.node.w, h: found.node.h };
      },
      () => {
        const found = findNodeById(nodes, nodeId);
        if (found && (found.node.w !== wDragStartBounds.w || found.node.x !== wDragStartBounds.x)) {
          history.push(createResizeNodeCmd(nodes, selected, refreshSidePanel, nodeId,
            { x: wDragStartBounds.x, y: wDragStartBounds.y, w: wDragStartBounds.w, h: wDragStartBounds.h },
            { x: found.node.x, y: found.node.y, w: found.node.w, h: found.node.h }));
        }
      });
  }
  if (hInput) {
    hInput.setAttribute('data-drag-number', 'true');
    hInput.addEventListener('input', (ev) => {
      const v = parseFloat(ev.target.value);
      if (!Number.isNaN(v)) updateNodeHeight(n, v);
    });
    hInput.addEventListener('focus', () => { startPanelEdit(nodeId, 'h', n.h, { x: n.x, y: n.y, w: n.w, h: n.h }); });
    hInput.addEventListener('blur', () => { flushPanelEdit(); });
    let hDragStartBounds = { x: n.x, y: n.y, w: n.w, h: n.h };
    attachDragNumber(hInput,
      (delta) => { updateNodeHeight(n, n.h + delta); hInput.value = String(Math.round(n.h)); },
      () => {
        flushPanelEdit();
        const found = findNodeById(nodes, nodeId);
        if (found) hDragStartBounds = { x: found.node.x, y: found.node.y, w: found.node.w, h: found.node.h };
      },
      () => {
        const found = findNodeById(nodes, nodeId);
        if (found && (found.node.h !== hDragStartBounds.h || found.node.y !== hDragStartBounds.y)) {
          history.push(createResizeNodeCmd(nodes, selected, refreshSidePanel, nodeId,
            { x: hDragStartBounds.x, y: hDragStartBounds.y, w: hDragStartBounds.w, h: hDragStartBounds.h },
            { x: found.node.x, y: found.node.y, w: found.node.w, h: found.node.h }));
        }
      });
  }
  if (textInput) {
    textInput.addEventListener('input', (ev) => { n.text = ev.target.value; });
    textInput.addEventListener('focus', () => { startPanelEdit(nodeId, 'text', n.text); });
    textInput.addEventListener('blur', () => { flushPanelEdit(); });
  }
}

function attachDragNumber(inputEl, onDelta, onDragStart, onDragEnd) {
  let isDragging = false;
  let startX = 0;
  let accum = 0;
  let dragDistance = 0;
  const step = 1; // world units per pixel moved
  const DRAG_THRESHOLD = 5; // pixels to move before starting drag
  
  const down = (e) => {
    if (e.button !== 0) return;
    isDragging = false;
    dragDistance = 0;
    startX = e.clientX;
    accum = 0;
    inputEl.setPointerCapture(e.pointerId);
  };
  
  const move = (e) => {
    if (!inputEl.hasPointerCapture(e.pointerId)) return;
    
    const dx = e.clientX - startX;
    dragDistance += Math.abs(dx);
    startX = e.clientX;
    
    // Only start dragging after threshold
    if (dragDistance > DRAG_THRESHOLD) {
      if (!isDragging) {
        isDragging = true;
        if (onDragStart) onDragStart();
        // Prevent text selection during drag
        inputEl.blur();
      }
      
      accum += dx * step;
      if (Math.abs(accum) >= 1) {
        const delta = Math.trunc(accum);
        accum -= delta;
        onDelta(delta);
      }
      e.preventDefault();
    }
  };
  
  const up = (e) => {
    if (!inputEl.hasPointerCapture(e.pointerId)) return;
    
    try { 
      inputEl.releasePointerCapture(e.pointerId); 
    } catch {}
    
    // If we didn't drag much, allow normal input behavior
    if (isDragging) {
      if (onDragEnd) onDragEnd();
    } else {
      inputEl.focus();
      inputEl.select();
    }
    
    isDragging = false;
  };
  
  inputEl.addEventListener('pointerdown', down);
  inputEl.addEventListener('pointermove', move);
  inputEl.addEventListener('pointerup', up);
}

function updateNodeWidth(n, newWidth) {
  const minW = 100;
  const targetW = Math.max(minW, newWidth);
  const delta = targetW - n.w;
  if (delta === 0) return;
  // Keep center fixed
  n.x -= delta / 2;
  n.w = targetW;
  markDrawOrderDirty();
}

function updateNodeHeight(n, newHeight) {
  const minH = 60;
  const targetH = Math.max(minH, newHeight);
  const delta = targetH - n.h;
  if (delta === 0) return;
  // Keep center fixed
  n.y -= delta / 2;
  n.h = targetH;
  markDrawOrderDirty();
}

function getDarkerColor(color, factor = 0.7) {
  // Accepts #rrggbb or rgb(r,g,b)
  let r, g, b;
  if (typeof color === 'string' && color.startsWith('#') && color.length === 7) {
    r = parseInt(color.slice(1,3), 16);
    g = parseInt(color.slice(3,5), 16);
    b = parseInt(color.slice(5,7), 16);
  } else if (typeof color === 'string' && color.startsWith('rgb')) {
    const m = color.match(/\d+/g);
    if (m && m.length >= 3) {
      r = parseInt(m[0], 10); g = parseInt(m[1], 10); b = parseInt(m[2], 10);
    }
  }
  if (r === undefined) return 'rgb(100, 100, 100)';
  r = Math.max(0, Math.min(255, Math.round(r * factor)));
  g = Math.max(0, Math.min(255, Math.round(g * factor)));
  b = Math.max(0, Math.min(255, Math.round(b * factor)));
  return `rgb(${r}, ${g}, ${b})`;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawRoundedRectTopOnly(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawWrappedTextWithEllipsis(ctx, text, x, y, maxWidth, maxHeight, lineHeight) {
  if (maxWidth <= 0 || maxHeight <= 0) return;
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';
  const maxLines = Math.max(1, Math.floor(maxHeight / lineHeight));
  for (let i = 0; i < words.length; i++) {
    const candidate = current ? current + ' ' + words[i] : words[i];
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current); else lines.push(words[i]);
      current = '';
      if (lines.length === maxLines) break;
      if (!current && ctx.measureText(words[i]).width <= maxWidth) {
        current = words[i];
      }
    }
  }
  if (current && lines.length < maxLines) lines.push(current);

  // If overflow, add ellipsis to last line
  if (lines.length > maxLines) lines.length = maxLines;
  let totalHeight = lines.length * lineHeight;
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li];
    if (li === lines.length - 1) {
      // Determine if we consumed all words; if not, append ellipsis
      const usedText = lines.slice(0, li).join(' ') + (lines.length > 1 ? ' ' : '') + line;
      if (usedText.length < text.length) {
        while (ctx.measureText(line + '…').width > maxWidth && line.length > 0) {
          line = line.slice(0, -1);
        }
        line = line + '…';
      }
    }
    ctx.fillText(line, x, y + li * lineHeight);
  }
}

function drawSingleLineEllipsis(ctx, text, cx, cy, maxWidth) {
  let str = text;
  if (ctx.measureText(str).width <= maxWidth) {
    ctx.fillText(str, cx, cy);
    return;
  }
  while (str.length > 0 && ctx.measureText(str + '…').width > maxWidth) {
    str = str.slice(0, -1);
  }
  ctx.fillText(str + '…', cx, cy);
}

function wrapTextLines(ctx, font, text, maxWidth) {
  ctx.save();
  ctx.font = font;
  const words = (text || '').split(/\s+/);
  const lines = [];
  let current = '';
  for (let i = 0; i < words.length; i++) {
    const candidate = current ? current + ' ' + words[i] : words[i];
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current); else lines.push(words[i]);
      current = '';
    }
  }
  if (current) lines.push(current);
  ctx.restore();
  return lines;
}

function drawWrappedTextWithEllipsisAligned(ctx, font, text, cx, y, maxWidth, maxHeight, lineHeight, align) {
  ctx.save();
  ctx.font = font;
  ctx.textAlign = align === 'center' ? 'center' : 'left';
  const words = (text || '').split(/\s+/);
  const lines = [];
  let current = '';
  const maxLines = Math.max(1, Math.floor(maxHeight / lineHeight));
  for (let i = 0; i < words.length; i++) {
    const candidate = current ? current + ' ' + words[i] : words[i];
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current); else lines.push(words[i]);
      current = '';
      if (lines.length === maxLines) break;
      if (!current && ctx.measureText(words[i]).width <= maxWidth) {
        current = words[i];
      }
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length > maxLines) lines.length = maxLines;
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li];
    if (li === lines.length - 1) {
      const all = lines.join(' ');
      if (all.length < (text || '').length) {
        while (ctx.measureText(line + '…').width > maxWidth && line.length > 0) line = line.slice(0, -1);
        line = line + '…';
      }
    }
    const x = align === 'center' ? cx : (cx - maxWidth / 2);
    ctx.fillText(line, x, y + li * lineHeight);
  }
  ctx.restore();
}

// --- Markdown Parser ---

function parseInlineSpans(text) {
  const spans = [];
  let pos = 0;
  let buf = '';

  function flush() {
    if (buf) { spans.push({ text: buf, bold: false, italic: false, code: false, strike: false }); buf = ''; }
  }

  while (pos < text.length) {
    if (text.slice(pos, pos + 2) === '**') {
      flush();
      const end = text.indexOf('**', pos + 2);
      if (end !== -1) {
        const inner = text.slice(pos + 2, end);
        if (inner) spans.push({ text: inner, bold: true, italic: false, code: false, strike: false });
        pos = end + 2;
        continue;
      }
      buf += '**';
      pos += 2;
    } else if (text.slice(pos, pos + 2) === '~~') {
      flush();
      const end = text.indexOf('~~', pos + 2);
      if (end !== -1) {
        const inner = text.slice(pos + 2, end);
        if (inner) spans.push({ text: inner, bold: false, italic: false, code: false, strike: true });
        pos = end + 2;
        continue;
      }
      buf += '~~';
      pos += 2;
    } else if (text[pos] === '`') {
      flush();
      const end = text.indexOf('`', pos + 1);
      if (end !== -1) {
        const inner = text.slice(pos + 1, end);
        if (inner) spans.push({ text: inner, bold: false, italic: false, code: true, strike: false });
        pos = end + 1;
        continue;
      }
      buf += '`';
      pos += 1;
    } else if (text[pos] === '*' && text[pos + 1] !== '*') {
      flush();
      const end = text.indexOf('*', pos + 1);
      if (end !== -1 && text[end + 1] !== '*') {
        const inner = text.slice(pos + 1, end);
        if (inner) spans.push({ text: inner, bold: false, italic: true, code: false, strike: false });
        pos = end + 1;
        continue;
      }
      buf += '*';
      pos += 1;
    } else {
      buf += text[pos];
      pos += 1;
    }
  }
  flush();
  return spans;
}

function parseMarkdownLines(text) {
  if (!text) return [];
  const rawLines = text.split('\n');
  const result = [];
  for (const line of rawLines) {
    const trimmed = line.trimStart();
    if (!trimmed) continue;

    let type = 'paragraph';
    let checked = false;
    let prefix = '';
    let content = trimmed;

    const checkboxMatch = trimmed.match(/^-\s*\[(\s|x|X)\]\s+(.+)/);
    if (checkboxMatch) {
      type = 'checkbox';
      checked = checkboxMatch[1].toLowerCase() === 'x';
      prefix = `- [${checkboxMatch[1]}] `;
      content = checkboxMatch[2];
    } else {
      const numberedMatch = trimmed.match(/^(\d+\.\s+)(.+)/);
      if (numberedMatch) {
        type = 'numbered';
        prefix = numberedMatch[1];
        content = numberedMatch[2];
      } else {
        const bulletMatch = trimmed.match(/^(-\s+)(.+)/);
        if (bulletMatch) {
          type = 'bullet';
          prefix = '- ';
          content = bulletMatch[2];
        } else {
          const starBulletMatch = trimmed.match(/^(\*\s+)(.+)/);
          if (starBulletMatch) {
            type = 'bullet';
            prefix = '* ';
            content = starBulletMatch[2];
          }
        }
      }
    }

    const spans = parseInlineSpans(content);
    if (spans.length > 0) {
      result.push({ type, checked, prefix, spans });
    }
  }
  return result;
}

// --- Markdown Span Utilities ---

function getSpanFont(span, baseFontSize, baseFontFamily) {
  const weight = span.bold ? 'bold ' : '';
  const style = span.italic ? 'italic ' : '';
  const family = span.code ? 'Consolas, "Cascadia Code", "Fira Code", monospace' : baseFontFamily;
  return `${style}${weight}${baseFontSize}px ${family}`;
}

function getSpanWidth(ctx, span, baseFontSize, baseFontFamily) {
  ctx.save();
  ctx.font = getSpanFont(span, baseFontSize, baseFontFamily);
  const w = ctx.measureText(span.text).width;
  ctx.restore();
  return w;
}

function drawSpan(ctx, span, x, y, fillStyle, baseFontFamily, baseFontSize) {
  ctx.save();
  ctx.font = getSpanFont(span, baseFontSize, baseFontFamily);
  ctx.fillStyle = fillStyle;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(span.text, x, y);
  if (span.strike) {
    const w = ctx.measureText(span.text).width;
    const strikeY = y + baseFontSize * 0.45;
    ctx.beginPath();
    ctx.moveTo(x, strikeY);
    ctx.lineTo(x + w, strikeY);
    ctx.strokeStyle = fillStyle;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function buildDisplayLines(ctx, spans, maxWidth, baseFontSize, baseFontFamily) {
  const words = [];
  for (const span of spans) {
    const parts = span.text.split(/\s+/);
    for (const part of parts) {
      if (part.length === 0) continue;
      words.push({ text: part, bold: span.bold, italic: span.italic, code: span.code, strike: span.strike });
    }
  }

  if (words.length === 0) return [[]];

  const lines = [];
  let currentLine = [];
  let currentWidth = 0;
  const spaceWidth = getSpanWidth(ctx, { text: ' ', bold: false, italic: false, code: false, strike: false }, baseFontSize, baseFontFamily);

  for (const word of words) {
    const w = getSpanWidth(ctx, word, baseFontSize, baseFontFamily);
    const needSpace = currentLine.length > 0;
    if (needSpace && currentWidth + spaceWidth + w > maxWidth) {
      lines.push(currentLine);
      currentLine = [word];
      currentWidth = w;
    } else {
      currentWidth += (needSpace ? spaceWidth : 0) + w;
      currentLine.push(word);
    }
  }
  if (currentLine.length > 0) lines.push(currentLine);
  return lines;
}

// --- Markdown Body Renderer ---

function renderMarkdownBody(ctx, text, x, y, maxWidth, maxHeight, baseFontFamily, baseFontSize, color, lineHeight) {
  if (!text || maxWidth <= 0 || maxHeight <= 0) return;

  const ml = parseMarkdownLines(text);
  if (ml.length === 0) return;

  let currentY = y;
  const prefixPad = 4;

  for (let li = 0; li < ml.length; li++) {
    const line = ml[li];
    if (currentY + lineHeight > y + maxHeight) return;

    let prefixW = 0;
    if (line.type === 'checkbox') {
      const ps = { text: line.checked ? '[x]' : '[ ]', bold: false, italic: false, code: false, strike: false };
      drawSpan(ctx, ps, x, currentY, color, baseFontFamily, baseFontSize);
      prefixW = getSpanWidth(ctx, ps, baseFontSize, baseFontFamily) + prefixPad;
    } else if (line.type === 'bullet') {
      const ps = { text: '\u2022', bold: true, italic: false, code: false, strike: false };
      drawSpan(ctx, ps, x, currentY, color, baseFontFamily, baseFontSize);
      prefixW = getSpanWidth(ctx, ps, baseFontSize, baseFontFamily) + prefixPad;
    } else if (line.type === 'numbered') {
      const ps = { text: line.prefix, bold: false, italic: false, code: false, strike: false };
      drawSpan(ctx, ps, x, currentY, color, baseFontFamily, baseFontSize);
      prefixW = getSpanWidth(ctx, ps, baseFontSize, baseFontFamily) + prefixPad;
    }

    const contentMaxW = maxWidth - prefixW;
    if (contentMaxW <= 0) break;

    const displayLines = buildDisplayLines(ctx, line.spans, contentMaxW, baseFontSize, baseFontFamily);

    for (let dl = 0; dl < displayLines.length; dl++) {
      if (currentY + lineHeight > y + maxHeight) return;

      let cx = x + prefixW;
      const words = displayLines[dl];
      for (let wi = 0; wi < words.length; wi++) {
        drawSpan(ctx, words[wi], cx, currentY, color, baseFontFamily, baseFontSize);
        cx += getSpanWidth(ctx, words[wi], baseFontSize, baseFontFamily);
        if (wi < words.length - 1) {
          cx += getSpanWidth(ctx, { text: ' ', bold: false, italic: false, code: false, strike: false }, baseFontSize, baseFontFamily);
        }
      }
      currentY += lineHeight;
    }
  }
}

// --- Markdown Title Renderer (single-line, centered) ---

function renderMarkdownTitle(ctx, text, cx, y, maxWidth, baseFontFamily, baseFontSize, color) {
  if (!text || maxWidth <= 0) return;

  const spans = parseInlineSpans(text);
  if (spans.length === 0) return;

  for (const s of spans) s.bold = true;

  let totalWidth = 0;
  for (const span of spans) {
    totalWidth += getSpanWidth(ctx, span, baseFontSize, baseFontFamily);
  }

  if (totalWidth > maxWidth) {
    const ellipsis = { text: '\u2026', bold: true, italic: false, code: false, strike: false };
    const ellipsisW = getSpanWidth(ctx, ellipsis, baseFontSize, baseFontFamily);
    const targetW = maxWidth - ellipsisW;
    const truncated = [];
    let running = 0;

    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      let t = span.text;
      let w = getSpanWidth(ctx, { text: t, bold: span.bold, italic: span.italic, code: span.code, strike: span.strike }, baseFontSize, baseFontFamily);

      if (running + w <= targetW) {
        truncated.push(span);
        running += w;
      } else {
        while (t.length > 0) {
          t = t.slice(0, -1);
          w = getSpanWidth(ctx, { text: t, bold: span.bold, italic: span.italic, code: span.code, strike: span.strike }, baseFontSize, baseFontFamily);
          if (running + w <= targetW) {
            if (t.length > 0) truncated.push({ text: t, bold: span.bold, italic: span.italic, code: span.code, strike: span.strike });
            break;
          }
        }
        break;
      }
    }

    if (truncated.length === 0 && ellipsisW <= maxWidth) {
      truncated.push(ellipsis);
    } else if (truncated.length > 0) {
      truncated.push(ellipsis);
    }

    let trTotal = 0;
    for (const s of truncated) trTotal += getSpanWidth(ctx, s, baseFontSize, baseFontFamily);

    let curX = cx - trTotal / 2;
    for (const s of truncated) {
      drawSpan(ctx, s, curX, y, color, baseFontFamily, baseFontSize);
      curX += getSpanWidth(ctx, s, baseFontSize, baseFontFamily);
    }
    return;
  }

  let curX = cx - totalWidth / 2;
  for (const s of spans) {
    drawSpan(ctx, s, curX, y, color, baseFontFamily, baseFontSize);
    curX += getSpanWidth(ctx, s, baseFontSize, baseFontFamily);
  }
}

function commitEditing() {
  if (!editingState) return;
  const { type, idx, field, el, originalValue } = editingState;
  const newValue = el.value;
  if (type === 'connection') {
    connections[idx].text = newValue;
  } else {
    nodes[idx][field] = newValue;
    if (originalValue !== newValue && nodes[idx].id !== undefined) {
      history.push(createPropertyChangeCmd(nodes, selected, refreshSidePanel, nodes[idx].id, field, originalValue, newValue));
    }
  }
  editingState = null;
  try { document.body.removeChild(el); } catch {}
  refreshSidePanel();
}

function cancelEditing() {
  if (!editingState) return;
  const { type, idx, field, el, originalValue } = editingState;
  if (type === 'connection') {
    connections[idx].text = originalValue;
  } else {
    nodes[idx][field] = originalValue;
  }
  editingState = null;
  try { document.body.removeChild(el); } catch {}
}

function startEditing(idx, field, worldX, worldY, worldW, worldH) {
  cancelEditing();

  const n = nodes[idx];
  const canvasRect = canvas.getBoundingClientRect();
  const screen = worldToScreen(worldX, worldY);
  const screenW = worldW * scale;
  const screenH = worldH * scale;

  const isTitle = field === 'title';
  const el = document.createElement(isTitle ? 'input' : 'textarea');
  el.className = isTitle ? 'inline-editor inline-editor-title' : 'inline-editor inline-editor-text';
  el.value = n[field] || '';
  el.style.position = 'fixed';
  el.style.left = (screen.x + canvasRect.left) + 'px';
  el.style.top = (screen.y + canvasRect.top) + 'px';
  el.style.width = screenW + 'px';
  el.style.height = screenH + 'px';
  el.style.zIndex = '8';
  const baseColor = n.color || '#2b2b2b';
  el.style.color = isTitle ? (n.titleColor || '#e7e7e7') : '#ddd';
  el.style.fontSize = (isTitle ? 15 : 12) * scale + 'px';
  el.style.lineHeight = (isTitle ? 18 : 14) * scale + 'px';
  el.style.padding = (8 * scale) + 'px';

  if (isTitle) {
    const nodeRadiusEditing = Math.min(12, Math.min(n.w, n.h) * 0.2) * scale;
    el.style.background = getDarkerColor(baseColor, 0.6);
    el.style.borderRadius = `${nodeRadiusEditing}px ${nodeRadiusEditing}px 0 0`;
    el.style.border = 'none';
    el.style.overflow = 'hidden';
  } else {
    el.style.background = baseColor;
  }

  document.body.appendChild(el);
  el.focus();
  el.select();

  const originalValue = n[field];
  editingState = { type: 'node', idx, field, el, originalValue };

  const commit = () => { commitEditing(); };
  el.addEventListener('blur', commit);
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && isTitle) {
      ev.preventDefault();
      el.blur();
    } else if (ev.key === 'Escape') {
      cancelEditing();
    }
  });
}

function startConnectionEditing(connIdx) {
  cancelEditing();

  const conn = connections[connIdx];
  const fromNode = nodes[conn.from];
  const toNode = nodes[conn.to];
  if (!fromNode || !toNode) return;

  const toCenterX = toNode.x + toNode.w / 2;
  const toCenterY = toNode.y + toNode.h / 2;
  const fromPt = getNodeEdgePoint(fromNode, toCenterX, toCenterY);
  const fromCenterX = fromNode.x + fromNode.w / 2;
  const fromCenterY = fromNode.y + fromNode.h / 2;
  const toPt = getNodeEdgePoint(toNode, fromCenterX, fromCenterY);
  const dx = toPt.x - fromPt.x;
  const dy = toPt.y - fromPt.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const cpDist = Math.min(dist * 0.5, 80);

  let cp1x = fromPt.x, cp1y = fromPt.y;
  let cp2x = toPt.x, cp2y = toPt.y;
  switch (fromPt.side) {
    case 'right': cp1x += cpDist; break;
    case 'left': cp1x -= cpDist; break;
    case 'bottom': cp1y += cpDist; break;
    case 'top': cp1y -= cpDist; break;
  }
  switch (toPt.side) {
    case 'right': cp2x += cpDist; break;
    case 'left': cp2x -= cpDist; break;
    case 'bottom': cp2y += cpDist; break;
    case 'top': cp2y -= cpDist; break;
  }

  const mid = getPointOnBezier(fromPt.x, fromPt.y, cp1x, cp1y, cp2x, cp2y, toPt.x, toPt.y, 0.5);

  const canvasRect = canvas.getBoundingClientRect();
  const screen = worldToScreen(mid.x, mid.y);

  const el = document.createElement('input');
  el.className = 'inline-editor inline-editor-conn-text';
  el.value = conn.text || '';
  el.style.position = 'fixed';
  el.style.left = (screen.x + canvasRect.left) + 'px';
  el.style.top = (screen.y + canvasRect.top) + 'px';
  el.style.width = 'auto';
  el.style.minWidth = '80px';
  el.style.transform = 'translate(-50%, -50%)';
  el.style.zIndex = '8';
  el.style.background = 'rgba(0,0,0,0.85)';
  el.style.color = '#fff';
  el.style.fontSize = (13 * scale) + 'px';
  el.style.fontWeight = 'bold';
  el.style.textAlign = 'center';
  el.style.border = '1px solid #f0c800';
  el.style.borderRadius = (4 * scale) + 'px';
  el.style.padding = (2 * scale) + 'px ' + (6 * scale) + 'px';
  el.style.outline = 'none';

  document.body.appendChild(el);
  el.focus();
  el.select();

  const originalValue = conn.text;
  editingState = { type: 'connection', idx: connIdx, el, originalValue };

  const commit = () => { commitEditing(); };
  el.addEventListener('blur', commit);
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      el.blur();
    } else if (ev.key === 'Escape') {
      cancelEditing();
    }
  });
}

function getNodeEdgePoint(node, targetX, targetY) {
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  const dx = targetX - cx;
  const dy = targetY - cy;

  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return { x: cx, y: cy, side: 'right' };

  const hw = node.w / 2;
  const hh = node.h / 2;

  if (dx !== 0) {
    const t = dx > 0 ? hw / dx : -hw / dx;
    const yAtEdge = cy + dy * t;
    if (yAtEdge >= node.y && yAtEdge <= node.y + node.h) {
      return { x: cx + (dx > 0 ? hw : -hw), y: yAtEdge, side: dx > 0 ? 'right' : 'left' };
    }
  }

  const t = dy > 0 ? hh / dy : -hh / dy;
  const xAtEdge = cx + dx * t;
  return { x: xAtEdge, y: cy + (dy > 0 ? hh : -hh), side: dy > 0 ? 'bottom' : 'top' };
}

function getPointOnBezier(x1, y1, cx1, cy1, cx2, cy2, x2, y2, t) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * x1 + 3 * mt2 * t * cx1 + 3 * mt * t2 * cx2 + t2 * t * x2,
    y: mt2 * mt * y1 + 3 * mt2 * t * cy1 + 3 * mt * t2 * cy2 + t2 * t * y2,
  };
}

function getTangentOnBezier(x1, y1, cx1, cy1, cx2, cy2, x2, y2, t) {
  const mt = 1 - t;
  return {
    dx: -3 * mt * mt * x1 + 3 * mt * (mt - 2 * t) * cx1 + 3 * t * (2 * mt - t) * cx2 + 3 * t * t * x2,
    dy: -3 * mt * mt * y1 + 3 * mt * (mt - 2 * t) * cy1 + 3 * t * (2 * mt - t) * cy2 + 3 * t * t * y2,
  };
}

const CONN_HIT_THRESHOLD = 8;

function hitTestConnection(wx, wy) {
  let bestIdx = -1;
  let bestDist = CONN_HIT_THRESHOLD;
  for (let ci = 0; ci < connections.length; ci++) {
    const conn = connections[ci];
    const fromNode = nodes[conn.from];
    const toNode = nodes[conn.to];
    if (!fromNode || !toNode) continue;

    const toCenterX = toNode.x + toNode.w / 2;
    const toCenterY = toNode.y + toNode.h / 2;
    const fromPt = getNodeEdgePoint(fromNode, toCenterX, toCenterY);
    const fromCenterX = fromNode.x + fromNode.w / 2;
    const fromCenterY = fromNode.y + fromNode.h / 2;
    const toPt = getNodeEdgePoint(toNode, fromCenterX, fromCenterY);
    const dx = toPt.x - fromPt.x;
    const dy = toPt.y - fromPt.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const cpDist = Math.min(dist * 0.5, 80);

    let cp1x = fromPt.x, cp1y = fromPt.y;
    let cp2x = toPt.x, cp2y = toPt.y;
    switch (fromPt.side) {
      case 'right': cp1x += cpDist; break;
      case 'left': cp1x -= cpDist; break;
      case 'bottom': cp1y += cpDist; break;
      case 'top': cp1y -= cpDist; break;
    }
    switch (toPt.side) {
      case 'right': cp2x += cpDist; break;
      case 'left': cp2x -= cpDist; break;
      case 'bottom': cp2y += cpDist; break;
      case 'top': cp2y -= cpDist; break;
    }

    for (let s = 0; s <= 20; s++) {
      const t = s / 20;
      const pt = getPointOnBezier(fromPt.x, fromPt.y, cp1x, cp1y, cp2x, cp2y, toPt.x, toPt.y, t);
      const dd = Math.sqrt((wx - pt.x) ** 2 + (wy - pt.y) ** 2);
      if (dd < bestDist) {
        bestDist = dd;
        bestIdx = ci;
      }
    }
  }
  return bestIdx === -1 ? null : bestIdx;
}

function drawConnection(ctx, fromNode, toNode, conn) {
  const toCenterX = toNode.x + toNode.w / 2;
  const toCenterY = toNode.y + toNode.h / 2;
  const fromPt = getNodeEdgePoint(fromNode, toCenterX, toCenterY);
  const fromCenterX = fromNode.x + fromNode.w / 2;
  const fromCenterY = fromNode.y + fromNode.h / 2;
  const toPt = getNodeEdgePoint(toNode, fromCenterX, fromCenterY);

  const dx = toPt.x - fromPt.x;
  const dy = toPt.y - fromPt.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const cpDist = Math.min(dist * 0.5, 80);

  let cp1x = fromPt.x, cp1y = fromPt.y;
  let cp2x = toPt.x, cp2y = toPt.y;

  switch (fromPt.side) {
    case 'right': cp1x += cpDist; break;
    case 'left': cp1x -= cpDist; break;
    case 'bottom': cp1y += cpDist; break;
    case 'top': cp1y -= cpDist; break;
  }

  switch (toPt.side) {
    case 'right': cp2x += cpDist; break;
    case 'left': cp2x -= cpDist; break;
    case 'bottom': cp2y += cpDist; break;
    case 'top': cp2y -= cpDist; break;
  }

  const connColor = conn.color || '#6bb5ff';
  const selectedConn = selectedConnection !== null && connections[selectedConnection] === conn;
  const lineWidth = selectedConn ? 3 : 2;

  // Text on curve midpoint (always horizontal)
  if (conn.text && conn.text.length > 0) {
    const mid = getPointOnBezier(fromPt.x, fromPt.y, cp1x, cp1y, cp2x, cp2y, toPt.x, toPt.y, 0.5);

    // Measure text to get pill dimensions
    ctx.save();
    ctx.translate(mid.x, mid.y);
    const fontSize = 13;
    ctx.font = `bold ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif`;
    const metrics = ctx.measureText(conn.text);
    const textW = metrics.width;
    const textH = fontSize + 4;
    const pad = 6;
    const rx = -textW / 2 - pad;
    const ry = -textH / 2;
    const bw = textW + pad * 2;
    const bh = textH;
    ctx.restore();

    // Save the background (grid) in the pill area before drawing the curve
    const dpr = window.devicePixelRatio || 1;
    const pillSX = Math.floor(((mid.x + rx) * scale + offsetX) * dpr);
    const pillSY = Math.floor(((mid.y + ry) * scale + offsetY) * dpr);
    const pillSW = Math.ceil(bw * scale * dpr);
    const pillSH = Math.ceil(bh * scale * dpr);
    let saved = null;
    if (pillSW > 0 && pillSH > 0) {
      saved = ctx.getImageData(pillSX, pillSY, pillSW, pillSH);
    }

    // Draw the curve
    ctx.beginPath();
    ctx.moveTo(fromPt.x, fromPt.y);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, toPt.x, toPt.y);
    ctx.strokeStyle = connColor;
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    // Erase everything in the pill area (curve + grid)
    ctx.save();
    ctx.translate(mid.x, mid.y);
    drawRoundedRect(ctx, rx, ry, bw, bh, 6);
    ctx.clip();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    // Restore the saved background (brings back grid, but NOT the curve)
    if (saved) ctx.putImageData(saved, pillSX, pillSY);

    // Draw text
    ctx.save();
    ctx.translate(mid.x, mid.y);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 3;
    ctx.fillText(conn.text, 0, 0);
    ctx.restore();
    return;
  }

  // No text — draw curve directly
  ctx.beginPath();
  ctx.moveTo(fromPt.x, fromPt.y);
  ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, toPt.x, toPt.y);
  ctx.strokeStyle = connColor;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function drawConnectionPreview(ctx, fromNode, mouseWorldX, mouseWorldY) {
  const fromPt = getNodeEdgePoint(fromNode, mouseWorldX, mouseWorldY);

  const dx = mouseWorldX - fromPt.x;
  const dy = mouseWorldY - fromPt.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const cpDist = Math.min(dist * 0.5, 80);

  let cp1x = fromPt.x, cp1y = fromPt.y;
  switch (fromPt.side) {
    case 'right': cp1x += cpDist; break;
    case 'left': cp1x -= cpDist; break;
    case 'bottom': cp1y += cpDist; break;
    case 'top': cp1y -= cpDist; break;
  }

  ctx.beginPath();
  ctx.moveTo(fromPt.x, fromPt.y);
  ctx.quadraticCurveTo(cp1x, cp1y, mouseWorldX, mouseWorldY);
  ctx.strokeStyle = 'rgba(107, 181, 255, 0.5)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
}

// --- Arrow drawing & hit-testing ---

function getArrowEndpoint(arrow, which) {
  if (which === 'start') {
    if (arrow.connectedFrom !== null && nodes[arrow.connectedFrom]) {
      return getNodeEdgePoint(nodes[arrow.connectedFrom], arrow.x2, arrow.y2);
    }
    return { x: arrow.x1, y: arrow.y1 };
  } else {
    if (arrow.connectedTo !== null && nodes[arrow.connectedTo]) {
      return getNodeEdgePoint(nodes[arrow.connectedTo], arrow.x1, arrow.y1);
    }
    return { x: arrow.x2, y: arrow.y2 };
  }
}

function updateArrowPositionsFromConnections() {
  for (const arrow of arrows) {
    if (arrow.connectedFrom !== null && nodes[arrow.connectedFrom]) {
      const edge = getNodeEdgePoint(nodes[arrow.connectedFrom], arrow.x2, arrow.y2);
      arrow.x1 = edge.x;
      arrow.y1 = edge.y;
    }
    if (arrow.connectedTo !== null && nodes[arrow.connectedTo]) {
      const edge = getNodeEdgePoint(nodes[arrow.connectedTo], arrow.x1, arrow.y1);
      arrow.x2 = edge.x;
      arrow.y2 = edge.y;
    }
  }
}

function drawArrows(ctx) {
  for (let ai = 0; ai < arrows.length; ai++) {
    const arrow = arrows[ai];
    const startPt = getArrowEndpoint(arrow, 'start');
    const endPt = getArrowEndpoint(arrow, 'end');

    const x1 = startPt.x;
    const y1 = startPt.y;
    const x2 = endPt.x;
    const y2 = endPt.y;

    const isWholeSelected = selectedArrows.has(ai);
    const isEndSelected = arrowDragTarget && arrowDragTarget.arrowIdx === ai;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) continue;

    const ux = dx / len;
    const uy = dy / len;

    // Draw line
    ctx.strokeStyle = arrow.color || '#6bb5ff';
    ctx.lineWidth = isWholeSelected ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Draw arrow head at the tip
    const headLen = ARROW_HEAD_LENGTH;
    const headAngle = ARROW_HEAD_ANGLE;
    ctx.fillStyle = arrow.color || '#6bb5ff';
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - headLen * Math.cos(Math.atan2(dy, dx) - headAngle),
      y2 - headLen * Math.sin(Math.atan2(dy, dx) - headAngle)
    );
    ctx.lineTo(
      x2 - headLen * Math.cos(Math.atan2(dy, dx) + headAngle),
      y2 - headLen * Math.sin(Math.atan2(dy, dx) + headAngle)
    );
    ctx.closePath();
    ctx.fill();

    // Draw endpoint handle circles (only on hover or while actively dragging)
    const isStartDrag = isDraggingArrowEnd && arrowDragTarget && arrowDragTarget.arrowIdx === ai && arrowDragTarget.end === 'start';
    const isEndDrag = isDraggingArrowEnd && arrowDragTarget && arrowDragTarget.arrowIdx === ai && arrowDragTarget.end === 'end';
    const dstStart = Math.sqrt((lastWorldMouse.x - x1) ** 2 + (lastWorldMouse.y - y1) ** 2);
    const dstEnd = Math.sqrt((lastWorldMouse.x - x2) ** 2 + (lastWorldMouse.y - y2) ** 2);
    const isStartHover = !isDraggingArrowEnd && !isDraggingArrowBody && dstStart <= ARROW_END_HIT_RADIUS;
    const isEndHover = !isDraggingArrowEnd && !isDraggingArrowBody && dstEnd <= ARROW_END_HIT_RADIUS;

    if (isStartDrag || isStartHover) {
      drawArrowHandle(ctx, x1, y1, isStartDrag);
    }
    if (isEndDrag || isEndHover) {
      drawArrowHandle(ctx, x2, y2, isEndDrag);
    }
  }
}

function drawArrowHandle(ctx, x, y, _isSelected) {
  const r = ARROW_END_RADIUS;
  ctx.save();

  ctx.fillStyle = '#6bb5ff';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function hitTestArrowEnd(wx, wy) {
  let best = null;
  let bestDist = ARROW_END_HIT_RADIUS;
  for (let ai = 0; ai < arrows.length; ai++) {
    const arrow = arrows[ai];
    for (const which of ['start', 'end']) {
      const pt = getArrowEndpoint(arrow, which);
      const d = Math.sqrt((wx - pt.x) ** 2 + (wy - pt.y) ** 2);
      if (d < bestDist) {
        bestDist = d;
        best = { arrowIdx: ai, end: which };
      }
    }
  }
  return best;
}

function hitTestArrowBody(wx, wy) {
  for (let ai = 0; ai < arrows.length; ai++) {
    const arrow = arrows[ai];
    const startPt = getArrowEndpoint(arrow, 'start');
    const endPt = getArrowEndpoint(arrow, 'end');
    const x1 = startPt.x;
    const y1 = startPt.y;
    const x2 = endPt.x;
    const y2 = endPt.y;

    // Distance from point to line segment
    const abx = x2 - x1;
    const aby = y2 - y1;
    const len2 = abx * abx + aby * aby;
    if (len2 < 0.001) continue;
    let t = ((wx - x1) * abx + (wy - y1) * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = x1 + t * abx;
    const py = y1 + t * aby;
    const d = Math.sqrt((wx - px) ** 2 + (wy - py) ** 2);
    if (d < ARROW_BODY_HIT_THRESHOLD) return ai;
  }
  return -1;
}

function findNodeAtPoint(wx, wy) {
  const drawOrder = getDrawOrder();
  for (let i = drawOrder.length - 1; i >= 0; i--) {
    const idx = drawOrder[i];
    const n = nodes[idx];
    if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) return idx;
  }
  return -1;
}

function isArrowInBox(arrow, bx1, by1, bx2, by2) {
  const startPt = getArrowEndpoint(arrow, 'start');
  const endPt = getArrowEndpoint(arrow, 'end');
  const x1 = startPt.x, y1 = startPt.y;
  const x2 = endPt.x, y2 = endPt.y;

  // Check if either endpoint is inside the box
  if (x1 >= bx1 && x1 <= bx2 && y1 >= by1 && y1 <= by2) return true;
  if (x2 >= bx1 && x2 <= bx2 && y2 >= by1 && y2 <= by2) return true;

  // Check if the arrow body line segment intersects the box
  // Use Cohen-Sutherland style rejection: if both points are on the same side of any edge, no intersection
  const x1l = x1 < bx1, x1r = x1 > bx2, y1t = y1 < by1, y1b = y1 > by2;
  const x2l = x2 < bx1, x2r = x2 > bx2, y2t = y2 < by1, y2b = y2 > by2;
  if ((x1l && x2l) || (x1r && x2r) || (y1t && y2t) || (y1b && y2b)) return false;

  return true;
}

function deleteArrowFn(ai) {
  if (ai < 0 || ai >= arrows.length) return;
  arrows.splice(ai, 1);
  // Shift selectedArrows set
  const toReAdd = [];
  for (const sa of selectedArrows) {
    if (sa === ai) continue;
    toReAdd.push(sa > ai ? sa - 1 : sa);
  }
  selectedArrows.clear();
  for (const v of toReAdd) selectedArrows.add(v);
  // Shift arrowDragTarget
  if (arrowDragTarget) {
    if (arrowDragTarget.arrowIdx === ai) arrowDragTarget = null;
    else if (arrowDragTarget.arrowIdx > ai) arrowDragTarget.arrowIdx--;
  }
}

function computeSelectionKey() {
  if (arrowDragTarget) return `arrowEnd:${arrowDragTarget.arrowIdx}:${arrowDragTarget.end}`;
  if (selectedArrows.size === 1) return `arrow:${Array.from(selectedArrows)[0]}`;
  if (selectedArrows.size > 1) return `arrows:${selectedArrows.size}`;
  if (selectedConnection !== null) return `conn:${selectedConnection}`;
  if (selected.size === 0) return 'none';
  if (selected.size > 1) return `multi:${selected.size}`;
  const idx = Array.from(selected)[0];
  return `single:${idx}`;
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- Undo/Redo menu button bindings ---
const actionUndoBtn = document.getElementById('actionUndo');
const actionRedoBtn = document.getElementById('actionRedo');

if (actionUndoBtn) {
  actionUndoBtn.addEventListener('click', (e) => {
    e.preventDefault();
    performUndo();
  });
}
if (actionRedoBtn) {
  actionRedoBtn.addEventListener('click', (e) => {
    e.preventDefault();
    performRedo();
  });
}

// --- File menu button bindings ---
const actionNewBtn = document.getElementById('actionNew');
const actionOpenBtn = document.getElementById('actionOpen');
const actionSaveBtn = document.getElementById('actionSave');

if (actionNewBtn) {
  actionNewBtn.addEventListener('click', (e) => {
    e.preventDefault();
    newDocument();
  });
}
if (actionOpenBtn) {
  actionOpenBtn.addEventListener('click', (e) => {
    e.preventDefault();
    openDocument();
  });
}
if (actionSaveBtn) {
  actionSaveBtn.addEventListener('click', (e) => {
    e.preventDefault();
    saveDocument();
  });
}

// Ctrl+S keyboard shortcut
window.addEventListener('keydown', (e) => {
  if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
    const active = document.activeElement;
    const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
    if (isInput) return;
    e.preventDefault();
    saveDocument();
  }
});
