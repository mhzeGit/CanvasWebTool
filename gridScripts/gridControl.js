// gridScripts/gridControl.js
import { drawGrid } from './gridDraw.js';
import { gridSettings } from './gridSettings.js';

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

let isSelectingBox = false;
let boxStartX = 0, boxStartY = 0, boxEndX = 0, boxEndY = 0;
let boxMode = 'replace'; // 'replace' | 'add' | 'remove'
let boxBaseSelection = new Set();
let lastPanelKey = '';

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
let resizeHandle = '';
let resizeStartWorldX = 0;
let resizeStartWorldY = 0;
let resizeStartNode = null;
const EDGE_MARGIN = 12;
const NODE_MIN_W = 100;
const NODE_MIN_H = 60;

// Inline editing
let editingState = null;

// Hovered resize handle (for visual feedback only)
let hoveredHandleInfo = null;

function screenToWorld(sx, sy) {
  return { x: (sx - offsetX) / scale, y: (sy - offsetY) / scale };
}

function worldToScreen(wx, wy) {
  return { x: wx * scale + offsetX, y: wy * scale + offsetY };
}

function hitTestNode(wx, wy) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) return i;
  }
  return -1;
}

function findNodeAtEdge(wx, wy) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const onLeft = Math.abs(wx - n.x) <= EDGE_MARGIN;
    const onRight = Math.abs(wx - (n.x + n.w)) <= EDGE_MARGIN;
    const onTop = Math.abs(wy - n.y) <= EDGE_MARGIN;
    const onBottom = Math.abs(wy - (n.y + n.h)) <= EDGE_MARGIN;
    const inX = wx >= n.x - EDGE_MARGIN && wx <= n.x + n.w + EDGE_MARGIN;
    const inY = wy >= n.y - EDGE_MARGIN && wy <= n.y + n.h + EDGE_MARGIN;
    if (!inX || !inY) continue;
    if (onLeft && onTop) return { idx: i, handle: 'tl', cursor: 'nw-resize' };
    if (onRight && onTop) return { idx: i, handle: 'tr', cursor: 'ne-resize' };
    if (onLeft && onBottom) return { idx: i, handle: 'bl', cursor: 'sw-resize' };
    if (onRight && onBottom) return { idx: i, handle: 'br', cursor: 'se-resize' };
    if (onLeft) return { idx: i, handle: 'left', cursor: 'ew-resize' };
    if (onRight) return { idx: i, handle: 'right', cursor: 'ew-resize' };
    if (onTop) return { idx: i, handle: 'top', cursor: 'ns-resize' };
    if (onBottom) return { idx: i, handle: 'bottom', cursor: 'ns-resize' };
  }
  return null;
}

function getEdgeAt(wx, wy) {
  for (const i of selected) {
    const n = nodes[i];
    const onLeft = Math.abs(wx - n.x) <= EDGE_MARGIN;
    const onRight = Math.abs(wx - (n.x + n.w)) <= EDGE_MARGIN;
    const onTop = Math.abs(wy - n.y) <= EDGE_MARGIN;
    const onBottom = Math.abs(wy - (n.y + n.h)) <= EDGE_MARGIN;

    const inX = wx >= n.x - EDGE_MARGIN && wx <= n.x + n.w + EDGE_MARGIN;
    const inY = wy >= n.y - EDGE_MARGIN && wy <= n.y + n.h + EDGE_MARGIN;
    if (!inX || !inY) continue;

    if (onLeft && onTop) return { idx: i, handle: 'tl', cursor: 'nw-resize' };
    if (onRight && onTop) return { idx: i, handle: 'tr', cursor: 'ne-resize' };
    if (onLeft && onBottom) return { idx: i, handle: 'bl', cursor: 'sw-resize' };
    if (onRight && onBottom) return { idx: i, handle: 'br', cursor: 'se-resize' };
    if (onLeft) return { idx: i, handle: 'left', cursor: 'ew-resize' };
    if (onRight) return { idx: i, handle: 'right', cursor: 'ew-resize' };
    if (onTop) return { idx: i, handle: 'top', cursor: 'ns-resize' };
    if (onBottom) return { idx: i, handle: 'bottom', cursor: 'ns-resize' };
  }
  return null;
}

function addNodeAtCenter() {
  const rect = canvas.getBoundingClientRect();
  const centerCssX = rect.width / 2;
  const centerCssY = rect.height / 2;
  const world = screenToWorld(centerCssX, centerCssY);
  addNodeAt(world.x, world.y);
}

function addNodeAt(worldX, worldY) {
  const w = 240; const h = 160;
  const idx = nodes.length;
  nodes.push({ x: worldX - w / 2, y: worldY - h / 2, w, h, color: '#2b2b2b', title: '', titleColor: '#e7e7e7', text: '' });
  selected.clear();
  selected.add(idx);
  refreshSidePanel();
}

// Hook up Add Node action
const addNodeBtn = document.getElementById('actionAddNode');
if (addNodeBtn) {
  addNodeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    addNodeAtCenter();
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
  if (selected.size > 0) {
    selected.clear();
    refreshSidePanel();
  }
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
    const paste = document.createElement('button');
    paste.className = 'context-item';
    paste.textContent = 'Paste';
    paste.disabled = clipboard.length === 0;
    paste.addEventListener('click', () => {
      pasteNodesAt(world.x, world.y);
      closeContextMenu();
    });
    items.push(paste);

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
    addWrap.appendChild(addBtn);
    addWrap.appendChild(sub);
    items.push(addWrap);

    const paste = document.createElement('button');
    paste.className = 'context-item';
    paste.textContent = 'Paste';
    paste.disabled = clipboard.length === 0;
    paste.addEventListener('click', () => {
      pasteNodesAt(world.x, world.y);
      closeContextMenu();
    });
    items.push(paste);
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

function deleteSelectedNodes() {
  if (selected.size === 0) return;
  const remain = [];
  for (let i = 0; i < nodes.length; i++) {
    if (!selected.has(i)) remain.push(nodes[i]);
  }
  nodes.length = 0;
  for (const n of remain) nodes.push(n);
  selected.clear();
  refreshSidePanel();
}

function duplicateSelectedNodes() {
  if (selected.size === 0) return;
  const dupes = [];
  for (const i of selected) {
    const n = nodes[i];
    dupes.push({ 
      x: n.x + 20, 
      y: n.y + 20, 
      w: n.w, 
      h: n.h, 
      color: n.color, 
      title: n.title, 
      titleColor: n.titleColor, 
      text: n.text 
    });
  }
  const startIdx = nodes.length;
  for (const d of dupes) nodes.push(d);
  selected.clear();
  for (let i = 0; i < dupes.length; i++) selected.add(startIdx + i);
  refreshSidePanel();
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
  const startIdx = nodes.length;
  for (const c of clipboard) {
    nodes.push({ 
      x: worldX + c.dx, 
      y: worldY + c.dy, 
      w: c.w, 
      h: c.h, 
      color: c.color, 
      title: c.title, 
      titleColor: c.titleColor, 
      text: c.text 
    });
  }
  selected.clear();
  for (let i = 0; i < clipboard.length; i++) selected.add(startIdx + i);
  refreshSidePanel();
}

// --- Pointer interactions: RMB pans, LMB selects/drags nodes; Shift=add, Ctrl=remove; LMB on bg = marquee ---
canvas.addEventListener('pointerdown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const world = screenToWorld(sx, sy);

  // Close inline editor on any canvas click
  if (editingState) {
    commitEditing();
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
      if (!selected.has(edgeHit.idx)) {
        selected.clear();
        selected.add(edgeHit.idx);
      }
      isResizing = true;
      resizeNodeIdx = edgeHit.idx;
      resizeHandle = edgeHit.handle;
      resizeStartWorldX = world.x;
      resizeStartWorldY = world.y;
      resizeStartNode = { x: nodes[edgeHit.idx].x, y: nodes[edgeHit.idx].y, w: nodes[edgeHit.idx].w, h: nodes[edgeHit.idx].h };
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    if (hit !== -1) {
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

    // Background: start selection box
    isSelectingBox = true;
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
      if (resizeHandle.includes('t')) newY = start.y + start.h - NODE_MIN_H;
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
  if (pendingClickIndex !== -1 && (e.buttons & 1) === 1) {
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
      dragGroupStarts = Array.from(selected).map(i => ({ i, x: nodes[i].x, y: nodes[i].y }));
    }
  }

  // Hover feedback: cursor for resize handles, move, or grab
  let cursorSet = false;
  hoveredHandleInfo = null;
  if (!isDraggingNode && !isResizing && !isPanning && !isSelectingBox && selected.size > 0) {
    const handleHit = getEdgeAt(world.x, world.y);
    if (handleHit) {
      canvas.style.cursor = handleHit.cursor;
      hoveredHandleInfo = handleHit;
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
    const x1 = Math.min(boxStartX, boxEndX);
    const y1 = Math.min(boxStartY, boxEndY);
    const x2 = Math.max(boxStartX, boxEndX);
    const y2 = Math.max(boxStartY, boxEndY);
    const hits = [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const ix1 = Math.max(x1, n.x);
      const iy1 = Math.max(y1, n.y);
      const ix2 = Math.min(x2, n.x + n.w);
      const iy2 = Math.min(y2, n.y + n.h);
      if (ix2 >= ix1 && iy2 >= iy1) hits.push(i);
    }

    let newSelected;
    if (boxMode === 'replace') {
      newSelected = new Set(hits);
    } else if (boxMode === 'add') {
      newSelected = new Set(boxBaseSelection);
      for (const i of hits) newSelected.add(i);
    } else {
      // remove
      newSelected = new Set(boxBaseSelection);
      for (const i of hits) newSelected.delete(i);
    }
    selected.clear();
    for (const i of newSelected) selected.add(i);
    refreshSidePanel();
  }

  // No live paste mode; paste happens instantly at cursor on click/shortcut
});

canvas.addEventListener('pointerup', (e) => {
  if (isResizing) {
    isResizing = false;
  }
  if (isPanning) {
    isPanning = false;
  }
  if (isDraggingNode) {
    isDraggingNode = false;
  }
  if (isSelectingBox) {
    // finalize box selection
    const x1 = Math.min(boxStartX, boxEndX);
    const y1 = Math.min(boxStartY, boxEndY);
    const x2 = Math.max(boxStartX, boxEndX);
    const y2 = Math.max(boxStartY, boxEndY);

    const hits = [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const ix1 = Math.max(x1, n.x);
      const iy1 = Math.max(y1, n.y);
      const ix2 = Math.min(x2, n.x + n.w);
      const iy2 = Math.min(y2, n.y + n.h);
      if (ix2 >= ix1 && iy2 >= iy1) hits.push(i);
    }

    if (boxMode === 'replace') {
      selected.clear();
      hits.forEach(i => selected.add(i));
    } else if (boxMode === 'add') {
      hits.forEach(i => selected.add(i));
    } else if (boxMode === 'remove') {
      hits.forEach(i => selected.delete(i));
    }

    isSelectingBox = false;
    refreshSidePanel();
  }
  // Apply deferred click selection (no drag happened)
  if (pendingClickIndex !== -1 && !didDragSincePointerDown) {
    if (selected.has(pendingClickIndex) && selected.size > 1) {
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
  if (hit === -1) return;

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
  if (!isInput && (e.key === 'Delete' || e.key === 'Backspace')) {
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
    closeContextMenu();
  }
});

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

  // Draw nodes (world space; drawGrid already set the world transform)
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    // Base style
    const baseColor = n.color || 'rgb(43, 43, 43)';
    
    // Draw shadow first
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 4;
    
    // Rounded rect path with shadow
    const nodeRadius = Math.min(12, Math.min(n.w, n.h) * 0.2);
    drawRoundedRect(ctx, n.x, n.y, n.w, n.h, nodeRadius);
    ctx.fillStyle = baseColor;
    ctx.fill();
    ctx.restore();

    // Exterior outline: slightly darker than base (world-space width)
    ctx.strokeStyle = getDarkerColor(baseColor, 0.7);
    ctx.lineWidth = 2; // world units; scales with zoom
    // Draw outline with offset to make it exterior
    const outlineOffset = ctx.lineWidth / 2;
    drawRoundedRect(ctx, n.x - outlineOffset, n.y - outlineOffset, n.w + outlineOffset * 2, n.h + outlineOffset * 2, nodeRadius + outlineOffset);
    ctx.stroke();

    // Selection outline around the whole node (exterior)
    if (selected.has(i)) {
      ctx.save();
      ctx.strokeStyle = '#5aa0ff';
      ctx.lineWidth = 2;
      const selectionOffset = ctx.lineWidth / 2;
      drawRoundedRect(ctx, n.x - selectionOffset, n.y - selectionOffset, n.w + selectionOffset * 2, n.h + selectionOffset * 2, nodeRadius + selectionOffset);
      ctx.stroke();
      ctx.restore();
    }

         // Title bar background (auto height up to 1/3 of node)
     const padding = 8;
     const titleFont = `bold ${15}px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif`;
     const titleLineHeight = 18;
     const maxTitleHeight = n.h / 3;
     const maxTitleWidth = Math.max(0, n.w - padding * 2);
     const titleLines = wrapTextLines(ctx, titleFont, n.title || '', maxTitleWidth);
     const requiredTitleHeight = Math.max(0, titleLines.length * titleLineHeight + padding * 2);
     const minTitleHeight = Math.min(maxTitleHeight, Math.max(24, padding * 2 + titleLineHeight));
     const titleH = Math.min(maxTitleHeight, Math.max(minTitleHeight, requiredTitleHeight));
     ctx.save();
     ctx.fillStyle = getDarkerColor(baseColor, 0.6);
     drawRoundedRectTopOnly(ctx, n.x, n.y, n.w, titleH, nodeRadius);
     ctx.fill();
     ctx.restore();

    // Title text (bold, larger)
    if (n.title && n.title.length > 0) {
      ctx.save();
      ctx.fillStyle = n.titleColor || '#e7e7e7';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      drawWrappedTextWithEllipsisAligned(
        ctx,
        titleFont,
        n.title,
        n.x + n.w / 2,
        n.y + padding,
        maxTitleWidth,
        Math.max(0, titleH - padding * 2),
        titleLineHeight,
        'center'
      );
      ctx.restore();
    }

    // Body text with wrapping and ellipsis (below title area)
    if (n.text && n.text.length > 0) {
      ctx.fillStyle = '#ddd';
      ctx.font = `${12}px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const padding = 8;
      const maxTextWidth = Math.max(0, n.w - padding * 2);
      const contentY = n.y + titleH + padding;
      const maxTextHeight = Math.max(0, n.h - titleH - padding * 2);
      drawWrappedTextWithEllipsis(ctx, n.text, n.x + padding, contentY, maxTextWidth, maxTextHeight, 14);
    }

    // Draw edge highlight on hover — thin elegant line
    if (hoveredHandleInfo && hoveredHandleInfo.idx === i) {
      const h = hoveredHandleInfo.handle;
      const edgeInset = 2;
      ctx.save();
      ctx.strokeStyle = '#64b5f6';
      ctx.lineWidth = 2;
      if (h === 'left') {
        ctx.beginPath();
        ctx.moveTo(n.x + edgeInset, n.y + nodeRadius - 1);
        ctx.lineTo(n.x + edgeInset, n.y + n.h - nodeRadius + 1);
        ctx.stroke();
      } else if (h === 'right') {
        ctx.beginPath();
        ctx.moveTo(n.x + n.w - edgeInset, n.y + nodeRadius - 1);
        ctx.lineTo(n.x + n.w - edgeInset, n.y + n.h - nodeRadius + 1);
        ctx.stroke();
      } else if (h === 'top') {
        ctx.beginPath();
        ctx.moveTo(n.x + nodeRadius - 1, n.y + edgeInset);
        ctx.lineTo(n.x + n.w - nodeRadius + 1, n.y + edgeInset);
        ctx.stroke();
      } else if (h === 'bottom') {
        ctx.beginPath();
        ctx.moveTo(n.x + nodeRadius - 1, n.y + n.h - edgeInset);
        ctx.lineTo(n.x + n.w - nodeRadius + 1, n.y + n.h - edgeInset);
        ctx.stroke();
      } else {
        const cx = h.includes('l') ? n.x : n.x + n.w;
        const cy = h.includes('t') ? n.y : n.y + n.h;
        const signX = h.includes('l') ? -1 : 1;
        const signY = h.includes('t') ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(cx + signX * 3, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy + signY * 3);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + signX * 6, cy);
        ctx.lineTo(cx + signX * 3, cy);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx, cy + signY * 6);
        ctx.lineTo(cx, cy + signY * 3);
        ctx.stroke();
      }
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
  if (selected.size === 0) {
    sidePanelContent.innerHTML = '<div class="panel-empty">Nothing selected</div>';
    return;
  }
  if (selected.size > 1) {
    sidePanelContent.innerHTML = `<div class=\"panel-section-title\">${selected.size} items selected</div>`;
    return;
  }
  const idx = Array.from(selected)[0];
  const n = nodes[idx];
  const html = `
    <div class=\"panel-section-title\">Node</div>
    <div class=\"panel-row\"><label>Title</label><input id=\"panelTitle\" class=\"panel-input\" type=\"text\" value=\"${n.title ?? ''}\" /></div>
    <div class=\"panel-row\"><label>Title Color</label><input id=\"panelTitleColor\" class=\"panel-input\" type=\"color\" value=\"${n.titleColor ?? '#e7e7e7'}\" /></div>
    <div class=\"panel-row\"><label>Color</label><input id=\"panelColor\" class=\"panel-input\" type=\"color\" value=\"${n.color ?? '#2b2b2b'}\" /></div>
    <div class=\"panel-row\"><label>Width</label><input id=\"panelW\" class=\"panel-input\" type=\"number\" min=\"10\" value=\"${n.w}\" /></div>
    <div class=\"panel-row\"><label>Height</label><input id=\"panelH\" class=\"panel-input\" type=\"number\" min=\"10\" value=\"${n.h}\" /></div>
    <div class=\"panel-row\"><label>Text</label><input id=\"panelText\" class=\"panel-input\" type=\"text\" value=\"${n.text ?? ''}\" /></div>
  `;
  sidePanelContent.innerHTML = html;

  const titleInput = document.getElementById('panelTitle');
  const titleColorInput = document.getElementById('panelTitleColor');
  const colorInput = document.getElementById('panelColor');
  const wInput = document.getElementById('panelW');
  const hInput = document.getElementById('panelH');
  const textInput = document.getElementById('panelText');

  if (titleInput) titleInput.addEventListener('input', (ev) => { n.title = ev.target.value; });
  if (titleColorInput) titleColorInput.addEventListener('input', (ev) => { n.titleColor = ev.target.value; });
  if (colorInput) colorInput.addEventListener('input', (ev) => { n.color = ev.target.value; });
  if (wInput) {
    wInput.setAttribute('data-drag-number', 'true');
    wInput.addEventListener('input', (ev) => {
      const v = parseFloat(ev.target.value);
      if (!Number.isNaN(v)) updateNodeWidth(n, v);
    });
    attachDragNumber(wInput, (delta) => {
      updateNodeWidth(n, n.w + delta);
      wInput.value = String(Math.round(n.w));
    });
  }
  if (hInput) {
    hInput.setAttribute('data-drag-number', 'true');
    hInput.addEventListener('input', (ev) => {
      const v = parseFloat(ev.target.value);
      if (!Number.isNaN(v)) updateNodeHeight(n, v);
    });
    attachDragNumber(hInput, (delta) => {
      updateNodeHeight(n, n.h + delta);
      hInput.value = String(Math.round(n.h));
    });
  }
  if (textInput) textInput.addEventListener('input', (ev) => { n.text = ev.target.value; });
}

function attachDragNumber(inputEl, onDelta) {
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
    if (!isDragging) {
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
}

function updateNodeHeight(n, newHeight) {
  const minH = 60;
  const targetH = Math.max(minH, newHeight);
  const delta = targetH - n.h;
  if (delta === 0) return;
  // Keep center fixed
  n.y -= delta / 2;
  n.h = targetH;
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

function commitEditing() {
  if (!editingState) return;
  const { idx, field, el } = editingState;
  nodes[idx][field] = el.value;
  editingState = null;
  try { document.body.removeChild(el); } catch {}
  refreshSidePanel();
}

function cancelEditing() {
  if (!editingState) return;
  const { idx, field, el, originalValue } = editingState;
  nodes[idx][field] = originalValue;
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
  el.style.zIndex = '1000';
  const baseColor = n.color || '#2b2b2b';
  el.style.color = isTitle ? (n.titleColor || '#e7e7e7') : '#ddd';
  if (isTitle) {
    const nodeRadiusEditing = Math.min(12, Math.min(n.w, n.h) * 0.2);
    el.style.background = getDarkerColor(baseColor, 0.6);
    el.style.borderRadius = `${nodeRadiusEditing}px ${nodeRadiusEditing}px 0 0`;
    el.style.border = 'none';
  } else {
    el.style.background = baseColor;
  }

  document.body.appendChild(el);
  el.focus();
  el.select();

  const originalValue = n[field];
  editingState = { idx, field, el, originalValue };

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

function computeSelectionKey() {
  if (selected.size === 0) return 'none';
  if (selected.size > 1) return `multi:${selected.size}`;
  const idx = Array.from(selected)[0];
  return `single:${idx}`;
}
