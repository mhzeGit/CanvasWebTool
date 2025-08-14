// gridScripts/gridControl.js
import { drawGrid } from './gridDraw.js';
import { gridSettings } from './gridSettings.js';

const canvas = document.getElementById('gridCanvas');
const ctx = canvas.getContext('2d');

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

function screenToWorld(sx, sy) {
  return { x: (sx - offsetX) / scale, y: (sy - offsetY) / scale };
}

function hitTestNode(wx, wy) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) return i;
  }
  return -1;
}

function addNodeAtCenter() {
  const rect = canvas.getBoundingClientRect();
  const centerCssX = rect.width / 2;
  const centerCssY = rect.height / 2;
  const world = screenToWorld(centerCssX, centerCssY);
  addNodeAt(world.x, world.y);
}

function addNodeAt(worldX, worldY) {
  const w = 140; const h = 80;
  const idx = nodes.length;
  nodes.push({ x: worldX - w / 2, y: worldY - h / 2, w, h });
  selected.clear();
  selected.add(idx);
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
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

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
}

function duplicateSelectedNodes() {
  if (selected.size === 0) return;
  const dupes = [];
  for (const i of selected) {
    const n = nodes[i];
    dupes.push({ x: n.x + 20, y: n.y + 20, w: n.w, h: n.h });
  }
  const startIdx = nodes.length;
  for (const d of dupes) nodes.push(d);
  selected.clear();
  for (let i = 0; i < dupes.length; i++) selected.add(startIdx + i);
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
    clipboard.push({ dx: n.x - mouseWorld.x, dy: n.y - mouseWorld.y, w: n.w, h: n.h });
  }
}

function pasteNodesAt(worldX, worldY) {
  if (clipboard.length === 0) return;
  const startIdx = nodes.length;
  for (const c of clipboard) {
    nodes.push({ x: worldX + c.dx, y: worldY + c.dy, w: c.w, h: c.h });
  }
  selected.clear();
  for (let i = 0; i < clipboard.length; i++) selected.add(startIdx + i);
}

// --- Pointer interactions: RMB pans, LMB selects/drags nodes; Shift=add, Ctrl=remove; LMB on bg = marquee ---
canvas.addEventListener('pointerdown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const world = screenToWorld(sx, sy);

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
    const hit = hitTestNode(world.x, world.y);
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
  // Hover feedback: move cursor if hovering any selected node
  let overSelected = false;
  for (const i of selected) {
    const n = nodes[i];
    if (world.x >= n.x && world.x <= n.x + n.w && world.y >= n.y && world.y <= n.y + n.h) {
      overSelected = true; break;
    }
  }
  canvas.style.cursor = overSelected ? 'move' : 'grab';

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
  }

  // No live paste mode; paste happens instantly at cursor on click/shortcut
});

canvas.addEventListener('pointerup', (e) => {
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
});

// --- Zoom handling ---
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
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
  if (e.key === 'Delete' || e.key === 'Backspace') {
    deleteSelectedNodes();
    e.preventDefault();
  }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'c')) {
    copySelectedNodes();
    e.preventDefault();
  }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'v')) {
    // Paste immediately at current mouse position if possible; fallback to center
    const rect = canvas.getBoundingClientRect();
    const mx = window._lastMouseX ?? rect.width / 2;
    const my = window._lastMouseY ?? rect.height / 2;
    const world = screenToWorld(mx, my);
    pasteNodesAt(world.x, world.y);
    e.preventDefault();
  }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'd')) {
    duplicateSelectedNodes();
    e.preventDefault();
  }
  if (e.key === 'Escape') {
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
    ctx.fillStyle = 'rgb(43, 43, 43)';
    ctx.strokeStyle = 'rgb(100, 100, 100)';
    ctx.lineWidth = 1 / (scale * dpr);
    ctx.beginPath();
    ctx.rect(n.x, n.y, n.w, n.h);
    ctx.fill();
    ctx.stroke();

    // Selection outline
    if (selected.has(i)) {
      ctx.strokeStyle = '#5aa0ff';
      ctx.lineWidth = 2 / (scale * dpr);
      ctx.stroke();
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

  requestAnimationFrame(animate);
}
animate();
