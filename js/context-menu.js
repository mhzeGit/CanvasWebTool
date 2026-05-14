import { state } from './state.js';
import { screenToWorld } from './utils.js';
import { hitTestNode } from './nodes.js';
import { hitTestConnection } from './connections.js';
import { hitTestArrowEnd, hitTestArrowBody } from './arrows.js';
import { commitEditing } from './inline-editing.js';
import { deleteSelectedArrows, deleteConnection } from './document.js';

export function openContextMenu(e) {
  const canvas = state.canvas;
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const world = screenToWorld(sx, sy, state.offsetX, state.offsetY, state.scale);
  const hit = hitTestNode(world.x, world.y);
  const connHit = hit === -1 ? hitTestConnection(world.x, world.y) : null;
  const arrowEndHit = hit === -1 ? hitTestArrowEnd(world.x, world.y) : null;
  const arrowBodyHit = (hit === -1 && connHit === null && arrowEndHit === null) ? hitTestArrowBody(world.x, world.y) : -1;

  const menu = document.getElementById('contextMenu');
  if (!menu) return;
  menu.innerHTML = '';

  const items = [];
  if (hit !== -1) {
    if (!state.selected.has(hit)) {
      state.selected.clear();
      state.selected.add(hit);
    }
    const addWrap = document.createElement('div');
    addWrap.className = 'context-submenu-trigger';
    const addBtn = document.createElement('button');
    addBtn.className = 'context-item has-submenu';
    addBtn.innerHTML = '<span>Add</span><span class="submenu-arrow">\u25b8</span>';
    const sub = document.createElement('div');
    sub.className = 'context-submenu';
    const addNode = document.createElement('button');
    addNode.className = 'context-item';
    addNode.textContent = 'Add Node';
    addNode.addEventListener('click', () => {
      _addNodeAt(world.x, world.y);
      closeContextMenu();
    });
    sub.appendChild(addNode);
    const addArrow = document.createElement('button');
    addArrow.className = 'context-item';
    addArrow.textContent = 'Add Arrow';
    addArrow.addEventListener('click', () => {
      _addArrowAt(world.x, world.y, hit);
      closeContextMenu();
    });
    sub.appendChild(addArrow);
    addWrap.appendChild(addBtn);
    addWrap.appendChild(sub);
    items.push(addWrap);
    const del = document.createElement('button');
    del.className = 'context-item';
    del.textContent = 'Delete';
    del.addEventListener('click', () => {
      _deleteSelectedNodes();
      closeContextMenu();
    });
    items.push(del);

    const dup = document.createElement('button');
    dup.className = 'context-item';
    dup.textContent = 'Duplicate';
    dup.addEventListener('click', () => {
      _duplicateSelectedNodes();
      closeContextMenu();
    });
    items.push(dup);

    const connectBtn = document.createElement('button');
    connectBtn.className = 'context-item';
    connectBtn.textContent = 'Connect to...';
    connectBtn.addEventListener('click', () => {
      state.connectingFrom = hit;
      closeContextMenu();
    });
    items.push(connectBtn);

    const copy = document.createElement('button');
    copy.className = 'context-item';
    copy.textContent = 'Copy';
    copy.addEventListener('click', () => {
      _copySelectedNodes();
      closeContextMenu();
    });
    items.push(copy);

    if (state.clipboard.length > 0) {
      const paste = document.createElement('button');
      paste.className = 'context-item';
      paste.textContent = 'Paste';
      paste.addEventListener('click', () => {
        _pasteNodesAt(world.x, world.y);
        closeContextMenu();
      });
      items.push(paste);
    }

  } else if (arrowBodyHit !== -1) {
    state.selected.clear();
    state.selectedConnection = null;
    state.selectedArrows.clear();
    state.arrowDragTarget = null;
    state.selectedArrows.add(arrowBodyHit);
    const delArrow = document.createElement('button');
    delArrow.className = 'context-item';
    delArrow.textContent = 'Delete Arrow';
    delArrow.addEventListener('click', () => {
      deleteSelectedArrows();
      closeContextMenu();
    });
    items.push(delArrow);

  } else if (connHit !== null) {
    state.selectedConnection = connHit;
    state.selected.clear();
    const delConn = document.createElement('button');
    delConn.className = 'context-item';
    delConn.textContent = 'Delete Connection';
    delConn.addEventListener('click', () => {
      if (state.selectedConnection !== null) {
        deleteConnection(state.selectedConnection);
      }
      closeContextMenu();
    });
    items.push(delConn);

  } else {
    const addWrap = document.createElement('div');
    addWrap.className = 'context-submenu-trigger';
    const addBtn = document.createElement('button');
    addBtn.className = 'context-item has-submenu';
    addBtn.innerHTML = '<span>Add</span><span class="submenu-arrow">\u25b8</span>';
    const sub = document.createElement('div');
    sub.className = 'context-submenu';
    const addNode = document.createElement('button');
    addNode.className = 'context-item';
    addNode.textContent = 'Add Node';
    addNode.addEventListener('click', () => {
      _addNodeAt(world.x, world.y);
      closeContextMenu();
    });
    sub.appendChild(addNode);
    const addArrow = document.createElement('button');
    addArrow.className = 'context-item';
    addArrow.textContent = 'Add Arrow';
    addArrow.addEventListener('click', () => {
      _addArrowAt(world.x, world.y);
      closeContextMenu();
    });
    sub.appendChild(addArrow);
    addWrap.appendChild(addBtn);
    addWrap.appendChild(sub);
    items.push(addWrap);

    if (state.clipboard.length > 0) {
      const paste = document.createElement('button');
      paste.className = 'context-item';
      paste.textContent = 'Paste';
      paste.addEventListener('click', () => {
        _pasteNodesAt(world.x, world.y);
        closeContextMenu();
      });
      items.push(paste);
    }
  }

  if (items.length === 0) {
    closeContextMenu();
    return;
  }

  for (const it of items) menu.appendChild(it);
  const px = e.clientX;
  const py = e.clientY;
  menu.style.left = px + 'px';
  menu.style.top = py + 'px';
  menu.style.display = 'block';

  const offClick = (ev) => {
    if (!menu.contains(ev.target)) closeContextMenu();
  };
  const onEsc = (ev) => { if (ev.key === 'Escape') closeContextMenu(); };
  setTimeout(() => {
    document.addEventListener('pointerdown', offClick, { once: true });
    document.addEventListener('keydown', onEsc, { once: true });
  }, 0);
}

export function closeContextMenu() {
  const menu = document.getElementById('contextMenu');
  if (menu) menu.style.display = 'none';
}

// These functions are set by main.js during initialization to avoid circular deps
let _addNodeAt, _addArrowAt, _deleteSelectedNodes, _duplicateSelectedNodes;
let _copySelectedNodes, _pasteNodesAt, _refreshSidePanel;

export function initContextMenu(deps) {
  _addNodeAt = deps.addNodeAt;
  _addArrowAt = deps.addArrowAt;
  _deleteSelectedNodes = deps.deleteSelectedNodes;
  _duplicateSelectedNodes = deps.duplicateSelectedNodes;
  _copySelectedNodes = deps.copySelectedNodes;
  _pasteNodesAt = deps.pasteNodesAt;
  _refreshSidePanel = deps.refreshSidePanel;
}

export function setupContextMenu() {
  state.canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!state.rmbPending) return;
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const withinTime = (now - state.rmbDownTime) <= 250;
    if (withinTime && !state.rmbMoved && !state.isPanning) {
      openContextMenu(e);
    }
    state.rmbPending = false;
  });
}
