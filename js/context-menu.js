import { state } from './state.js';
import { screenToWorld } from './utils.js';
import { hitTestConnection } from './connections.js';
import { hitTestArrowEnd, hitTestArrowBody } from './arrows.js';
import { hitTestConnector } from './connectors.js';
import { commitEditing } from './inline-editing.js';
import { history } from './history.js';
import { createSetLockCmd } from './undo.js';

const ADD_ITEM_TYPES = [];

export function registerAddItem(entry) {
  ADD_ITEM_TYPES.push(entry);
}

export function registerAddGroup(label, children) {
  ADD_ITEM_TYPES.push({ label, children });
}

let _addNodeAt, _addArrowAt, _deleteSelectedNodes, _duplicateSelectedNodes;
let _addImageContainerAt;
let _copySelectedNodes, _pasteNodesAt, _refreshSidePanel;
let _addShapeAt, _addConnectorAt;
let _deleteSelectedShapes, _deleteSelectedConnectors;
let _deleteSelectedArrows, _deleteConnection;

function renderAddItem(sub, item, worldX, worldY, hitType, hitIndex) {
  if (item.children) {
    const groupWrap = document.createElement('div');
    groupWrap.className = 'context-submenu-trigger';
    const groupBtn = document.createElement('button');
    groupBtn.className = 'context-item has-submenu';
    groupBtn.innerHTML = `<span>${item.label}</span><span class="submenu-arrow">\u25b8</span>`;
    const groupSub = document.createElement('div');
    groupSub.className = 'context-submenu';
    for (const child of item.children) {
      renderAddItem(groupSub, child, worldX, worldY, hitType, hitIndex);
    }
    groupWrap.appendChild(groupBtn);
    groupWrap.appendChild(groupSub);
    sub.appendChild(groupWrap);
  } else {
    const el = document.createElement('button');
    el.className = 'context-item';
    el.textContent = item.label;
    el.addEventListener('click', () => {
      item.create(worldX, worldY, hitType, hitIndex);
      closeContextMenu();
    });
    sub.appendChild(el);
  }
}

function buildAddSubmenu(worldX, worldY, hitType, hitIndex) {
  const wrap = document.createElement('div');
  wrap.className = 'context-submenu-trigger';
  const btn = document.createElement('button');
  btn.className = 'context-item has-submenu';
  btn.innerHTML = '<span>Add</span><span class="submenu-arrow">\u25b8</span>';
  const sub = document.createElement('div');
  sub.className = 'context-submenu';

  for (const item of ADD_ITEM_TYPES) {
    renderAddItem(sub, item, worldX, worldY, hitType, hitIndex);
  }

  wrap.appendChild(btn);
  wrap.appendChild(sub);
  return wrap;
}

function makeMenuItem(label, onClick) {
  const el = document.createElement('button');
  el.className = 'context-item';
  el.textContent = label;
  el.addEventListener('click', () => {
    onClick();
    closeContextMenu();
  });
  return el;
}

function detectHit(worldX, worldY) {
  const topHit = state.getTopHitAt(worldX, worldY);
  if (topHit) return topHit;

  const connIdx = hitTestConnector(worldX, worldY);
  if (connIdx !== -1 && !state.connectors[connIdx]?.locked) return { type: 'connector', i: connIdx };

  const connLineHit = hitTestConnection(worldX, worldY);
  if (connLineHit !== null && !state.connections[connLineHit]?.locked) return { type: 'connection', i: connLineHit };

  const arrowEndHit = hitTestArrowEnd(worldX, worldY);
  if (arrowEndHit && !state.arrows[arrowEndHit.arrowIdx]?.locked) return { type: 'arrow', i: arrowEndHit.arrowIdx };

  const arrowBodyHit = hitTestArrowBody(worldX, worldY);
  if (arrowBodyHit !== -1 && !state.arrows[arrowBodyHit]?.locked) return { type: 'arrow', i: arrowBodyHit };

  return null;
}

function isInSelection(type, index) {
  switch (type) {
    case 'textBox': return state.selectedTextBoxes.has(index);
    case 'shape': return state.selectedShapes.has(index);
    case 'arrow': return state.selectedArrows.has(index);
    case 'connector': return state.selectedConnectors.has(index);
    case 'connection': return state.selectedConnection === index;
  }
  return false;
}

function getEntityByType(type, index) {
  switch (type) {
    case 'textBox': return state.textBoxes[index];
    case 'shape': return state.shapes[index];
    case 'arrow': return state.arrows[index];
    case 'connector': return state.connectors[index];
    case 'connection': return state.connections[index];
  }
  return null;
}

function getEntityArrayByType(type) {
  switch (type) {
    case 'textBox': return state.textBoxes;
    case 'shape': return state.shapes;
    case 'arrow': return state.arrows;
    case 'connector': return state.connectors;
    case 'connection': return state.connections;
  }
  return null;
}

function makeLockMenuItem(type, index) {
  const entity = getEntityByType(type, index);
  if (!entity || entity.locked) return null;
  return makeMenuItem('Lock', () => {
    const entities = getEntityArrayByType(type);
    entity.locked = true;
    history.push(createSetLockCmd(entities, entity.id, false, true, _refreshSidePanel));
    _refreshSidePanel();
  });
}

function selectSingle(type, index) {
  state.selectedTextBoxes.clear();
  state.selectedConnection = null;
  state.selectedArrows.clear();
  state.selectedShapes.clear();
  state.selectedConnectors.clear();
  state.arrowDragTarget = null;

  switch (type) {
    case 'textBox': state.selectedTextBoxes.add(index); break;
    case 'shape': state.selectedShapes.add(index); break;
    case 'arrow': state.selectedArrows.add(index); break;
    case 'connector': state.selectedConnectors.add(index); break;
    case 'connection': state.selectedConnection = index; break;
  }
}

export function openContextMenu(e) {
  const canvas = state.canvas;
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const world = screenToWorld(sx, sy, state.offsetX, state.offsetY, state.scale);

  commitEditing();

  const hit = detectHit(world.x, world.y);
  const hitType = hit ? hit.type : null;
  const hitIndex = hit !== null ? hit.i : -1;

  if (hit && !isInSelection(hitType, hitIndex)) {
    selectSingle(hitType, hitIndex);
  }

  const menu = document.getElementById('contextMenu');
  if (!menu) return;
  menu.innerHTML = '';

  const items = [];

  if (hitType === 'textBox' || hitType === 'shape' || hitType === 'connector' || hitType === null) {
    items.push(buildAddSubmenu(world.x, world.y, hitType, hitIndex));
  }

  if (hitType === 'textBox') {
    const lockItem = makeLockMenuItem(hitType, hitIndex);
    if (lockItem) items.push(lockItem);
    items.push(makeMenuItem('Delete', _deleteSelectedNodes));
    items.push(makeMenuItem('Duplicate', _duplicateSelectedNodes));
    items.push(makeMenuItem('Connect to...', () => {
      state.connectingFrom = hitIndex;
    }));
    items.push(makeMenuItem('Copy', _copySelectedNodes));
    if (state.clipboard.length > 0) {
      items.push(makeMenuItem('Paste', () => _pasteNodesAt(world.x, world.y)));
    }
  } else if (hitType === 'shape') {
    const lockItem = makeLockMenuItem(hitType, hitIndex);
    if (lockItem) items.push(lockItem);
    items.push(makeMenuItem('Delete', _deleteSelectedShapes));
    if (state.selectedShapes.size > 0) {
      items.push(makeMenuItem('Duplicate', _duplicateSelectedNodes));
      items.push(makeMenuItem('Copy', _copySelectedNodes));
    }
    if (state.clipboard.length > 0) {
      items.push(makeMenuItem('Paste', () => _pasteNodesAt(world.x, world.y)));
    }
  } else if (hitType === 'arrow') {
    const lockItem = makeLockMenuItem(hitType, hitIndex);
    if (lockItem) items.push(lockItem);
    items.push(makeMenuItem('Delete Arrow', _deleteSelectedArrows));
  } else if (hitType === 'connector') {
    const lockItem = makeLockMenuItem(hitType, hitIndex);
    if (lockItem) items.push(lockItem);
    items.push(makeMenuItem('Delete Connector', _deleteSelectedConnectors));
  } else if (hitType === 'connection') {
    const lockItem = makeLockMenuItem(hitType, hitIndex);
    if (lockItem) items.push(lockItem);
    items.push(makeMenuItem('Delete Connection', () => _deleteConnection(hitIndex)));
  } else {
    if (state.clipboard.length > 0) {
      items.push(makeMenuItem('Paste', () => _pasteNodesAt(world.x, world.y)));
    }
  }

  if (items.length === 0) {
    closeContextMenu();
    return;
  }

  for (const it of items) menu.appendChild(it);
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
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

function registerDefaultAddItems() {
  registerAddItem({ label: 'Image Container', create: (wx, wy) => _addImageContainerAt(wx, wy) });
  registerAddItem({ label: 'Text Box', create: (wx, wy) => _addNodeAt(wx, wy) });
  registerAddItem({ label: 'Arrow', create: (wx, wy, hitType, hitIndex) => {
    if (hitType === 'textBox') {
      _addArrowAt(wx, wy, hitIndex);
    } else {
      _addArrowAt(wx, wy);
    }
  }});
  registerAddGroup('Shapes', [
    { label: 'Rectangle', create: (wx, wy) => _addShapeAt(wx, wy, 'rectangle') },
    { label: 'Circle', create: (wx, wy) => _addShapeAt(wx, wy, 'circle') },
    { label: 'Triangle', create: (wx, wy) => _addShapeAt(wx, wy, 'triangle') },
    { label: 'Diamond', create: (wx, wy) => _addShapeAt(wx, wy, 'diamond') },
  ]);
  registerAddItem({ label: 'Connector', create: (wx, wy) => _addConnectorAt(wx, wy) });
}

export function initContextMenu(deps) {
  _addNodeAt = deps.addNodeAt;
  _addArrowAt = deps.addArrowAt;
  _addImageContainerAt = deps.addImageContainerAt;
  _deleteSelectedNodes = deps.deleteSelectedNodes;
  _duplicateSelectedNodes = deps.duplicateSelectedNodes;
  _copySelectedNodes = deps.copySelectedNodes;
  _pasteNodesAt = deps.pasteNodesAt;
  _refreshSidePanel = deps.refreshSidePanel;
  _addShapeAt = deps.addShapeAt;
  _addConnectorAt = deps.addConnectorAt;
  _deleteSelectedShapes = deps.deleteSelectedShapes;
  _deleteSelectedConnectors = deps.deleteSelectedConnectors;
  _deleteSelectedArrows = deps.deleteSelectedArrows;
  _deleteConnection = deps.deleteConnection;

  registerDefaultAddItems();
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
