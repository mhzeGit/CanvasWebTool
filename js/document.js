import { state } from './state.js';
import { history, flushPanelEdit } from './history.js';
import {
  createAddShapeCmd, createDeleteShapesCmd, createMoveShapesCmd,
  createResizeShapeCmd, createAddTextBoxCmd, createDeleteTextBoxesCmd,
  createMoveTextBoxesCmd, createAddConnectorCmd, createDeleteConnectorsCmd,
  createMoveConnectorsCmd,
  createAddArrowCmd, createDeleteArrowsCmd,
  createAddConnectionCmd, createDeleteConnectionCmd,
  createResizeTextBoxCmd, createTextBoxPropertyChangeCmd,
  createBatchTextBoxPropertyChangeCmd, createBatchResizeTextBoxCmd,
  createDuplicateTextBoxesCmd, createPasteTextBoxesCmd,
  createDuplicateShapesCmd, createPasteShapesCmd,
  createBatchCmd, createBatchResizeShapeCmd,
  createBatchShapePropertyChangeCmd,
} from './undo.js';
import { serializeDocument, deserializeDocument, FILE_EXTENSION } from './format.js';
import { saveToFile, loadFromFile, clearCachedFileHandle, saveToFileAs, reloadFromCachedHandle, syncFileTimestamp } from './file-io.js';
import { screenToWorld, getObjectEdgePoint } from './utils.js';
import { refreshSidePanel } from './side-panel.js';
import { DEFAULT_TEXTBOX_COLOR } from './config.js';
import { destroyAllEntities } from './dom-entities.js';
import { showConfirmDialog } from './dialog.js';

let _nextImageId = 1;

export function addImageContainerAt(worldX, worldY, optW, optH) {
  flushPanelEdit();
  const isDrag = optW !== undefined && optH !== undefined;
  const w = isDrag ? optW : 280;
  const h = isDrag ? optH : 220;
  const shape = {
    id: state.nextShapeId++,
    shapeType: 'rectangle',
    x: isDrag ? worldX : worldX - w / 2,
    y: isDrag ? worldY : worldY - h / 2,
    w, h,
    color: '#1e1e1e',
    borderColor: '#3a3a3a',
    borderWidth: 1,
    cornerRadius: 8,
    image: null,
    parentId: null,
    parentType: null,
  };
  const idx = state.shapes.length;
  state.shapes.push(shape);
  state.parentTree.register('shape', shape.id, shape);
  state.selectedShapes.clear();
  state.selectedTextBoxes.clear();
  state.selectedConnectors.clear();
  state.selectedShapes.add(idx);
  refreshSidePanel();
  history.push(createAddShapeCmd(state.shapes, state.selectedShapes, refreshSidePanel, shape, idx));
}

export function addImageContainerAtCenter() {
  flushPanelEdit();
  const canvas = state.canvas;
  const rect = canvas.getBoundingClientRect();
  const centerCssX = rect.width / 2;
  const centerCssY = rect.height / 2;
  const world = screenToWorld(centerCssX, centerCssY, state.offsetX, state.offsetY, state.scale);
  addImageContainerAt(world.x, world.y);
}

export function addImageToShape(shapeIdx, src) {
  flushPanelEdit();
  const s = state.shapes[shapeIdx];
  if (!s) return;
  const img = {
    id: _nextImageId++,
    src: src || '',
    fileName: '',
  };
  s.image = img;
  state.markDrawOrderDirty();
  refreshSidePanel();
  return img;
}

export function removeImageFromShape(shapeIdx) {
  flushPanelEdit();
  const s = state.shapes[shapeIdx];
  if (!s || !s.image) return;
  s.image = null;
  state.markDrawOrderDirty();
  refreshSidePanel();
}

export function openImageInShape(shapeIdx) {
  const s = state.shapes[shapeIdx];
  if (!s) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      addImageToShape(shapeIdx, ev.target.result);
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

export function addTextBoxAtCenter() {
  flushPanelEdit();
  const canvas = state.canvas;
  const rect = canvas.getBoundingClientRect();
  const centerCssX = rect.width / 2;
  const centerCssY = rect.height / 2;
  const world = screenToWorld(centerCssX, centerCssY, state.offsetX, state.offsetY, state.scale);
  addTextBoxAt(world.x, world.y);
}

export function addArrowAtCenter() {
  flushPanelEdit();
  const canvas = state.canvas;
  const rect = canvas.getBoundingClientRect();
  const centerCssX = rect.width / 2;
  const centerCssY = rect.height / 2;
  const world = screenToWorld(centerCssX, centerCssY, state.offsetX, state.offsetY, state.scale);
  addArrowAt(world.x, world.y);
}

export function addShapeAtCenter(shapeType) {
  flushPanelEdit();
  const rect = state.canvas.getBoundingClientRect();
  const centerCssX = rect.width / 2;
  const centerCssY = rect.height / 2;
  const world = screenToWorld(centerCssX, centerCssY, state.offsetX, state.offsetY, state.scale);
  addShapeAt(world.x, world.y, shapeType);
}

export function addConnectorAtCenter() {
  flushPanelEdit();
  const rect = state.canvas.getBoundingClientRect();
  const centerCssX = rect.width / 2;
  const centerCssY = rect.height / 2;
  const world = screenToWorld(centerCssX, centerCssY, state.offsetX, state.offsetY, state.scale);
  const offset = 60;
  addConnector(world.x - offset, world.y, world.x + offset, world.y);
}

export function addArrowAt(worldX, worldY, connectTextBoxIdx) {
  flushPanelEdit();
  const offset = 60;
  let x1 = worldX - offset;
  let y1 = worldY;
  let x2 = worldX + offset;
  let y2 = worldY;
  let connectedFrom = null;
  let connectedTo = null;

  if (connectTextBoxIdx !== undefined && connectTextBoxIdx !== null && state.textBoxes[connectTextBoxIdx]) {
    const edge = getObjectEdgePoint(state.textBoxes[connectTextBoxIdx], worldX, worldY);
    x1 = edge.x;
    y1 = edge.y;
    connectedFrom = connectTextBoxIdx;
    x2 = worldX;
    y2 = worldY;
  }

  const arrow = {
    id: state.nextArrowId++,
    x1, y1, x2, y2,
    connectedFrom,
    connectedTo,
    connectedFromType: connectedFrom !== null ? 'textBox' : null,
    connectedToType: null,
    color: '#6bb5ff',
    lineWidth: 2,
    headSize: 14,
  };

  const idx = state.arrows.length;
  state.arrows.push(arrow);
  state.selectedTextBoxes.clear();
  state.selectedConnection = null;
  state.selectedArrows.clear();
  state.arrowDragTarget = { arrowIdx: idx, end: 'end' };
  state.selectedArrows.add(idx);
  refreshSidePanel();
  history.push(createAddArrowCmd(state.arrows, state.selectedArrows, refreshSidePanel, arrow, idx));
}

export function addShapeAt(worldX, worldY, shapeType, optW, optH) {
  flushPanelEdit();
  const type = shapeType || 'rectangle';
  const isDrag = optW !== undefined && optH !== undefined;
  const w = isDrag ? optW : 120;
  const h = isDrag ? optH : 80;
  const shape = {
    id: state.nextShapeId++,
    shapeType: type,
    x: isDrag ? worldX : worldX - w / 2,
    y: isDrag ? worldY : worldY - h / 2,
    w,
    h,
    color: state.lastShapeColor || '#2b2b2b',
    borderColor: state.lastShapeBorderColor || '#6bb5ff',
    borderWidth: 2,
    cornerRadius: type === 'rectangle' ? 4 : 0,
    image: null,
    parentId: null,
    parentType: null,
  };
  const idx = state.shapes.length;
  state.shapes.push(shape);
  state.parentTree.register('shape', shape.id, shape);
  state.selectedShapes.clear();
  state.selectedTextBoxes.clear();
  state.selectedConnectors.clear();
  state.selectedShapes.add(idx);
  refreshSidePanel();
  history.push(createAddShapeCmd(state.shapes, state.selectedShapes, refreshSidePanel, shape, idx));
}

export function addTextBoxAt(worldX, worldY, optW, optH) {
  flushPanelEdit();
  const isDrag = optW !== undefined && optH !== undefined;
  const w = isDrag ? optW : 240;
  const h = isDrag ? optH : 160;
  const textBox = {
    id: state.nextTextBoxId++,
    x: isDrag ? worldX : worldX - w / 2,
    y: isDrag ? worldY : worldY - h / 2,
    w,
    h,
    text: '',
    blocks: null,
    color: DEFAULT_TEXTBOX_COLOR,
    borderColor: '#444',
    textColor: '#ddd',
    fontSize: 14,
    title: '',
    titleColor: '#e7e7e7',
    parentId: null,
    parentType: null,
  };
  const idx = state.textBoxes.length;
  state.textBoxes.push(textBox);
  state.parentTree.register('textBox', textBox.id, textBox);
  state.selectedShapes.clear();
  state.selectedTextBoxes.clear();
  state.selectedConnectors.clear();
  state.selectedTextBoxes.add(idx);
  refreshSidePanel();
  history.push(createAddTextBoxCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, textBox, idx));
}

export function addConnector(x1, y1, x2, y2, connectedFrom, connectedTo, connectedFromType, connectedToType) {
  flushPanelEdit();
  const connector = {
    id: state.nextConnectorId++,
    x1, y1, x2, y2,
    connectedFrom: connectedFrom ?? null,
    connectedTo: connectedTo ?? null,
    connectedFromType: connectedFromType ?? null,
    connectedToType: connectedToType ?? null,
    color: '#6bb5ff',
  };
  const idx = state.connectors.length;
  state.connectors.push(connector);
  state.selectedShapes.clear();
  state.selectedTextBoxes.clear();
  state.selectedConnectors.clear();
  state.selectedConnectors.add(idx);
  refreshSidePanel();
  history.push(createAddConnectorCmd(state.connectors, state.selectedConnectors, refreshSidePanel, connector, idx));
}

export function addArrowFromPoints(x1, y1, x2, y2, connectedFrom, connectedTo, connectedFromType, connectedToType) {
  flushPanelEdit();
  const arrow = {
    id: state.nextArrowId++,
    x1, y1, x2, y2,
    connectedFrom: connectedFrom ?? null,
    connectedTo: connectedTo ?? null,
    connectedFromType: connectedFromType ?? null,
    connectedToType: connectedToType ?? null,
    color: '#6bb5ff',
    lineWidth: 2,
    headSize: 14,
  };
  const idx = state.arrows.length;
  state.arrows.push(arrow);
  state.selectedTextBoxes.clear();
  state.selectedConnection = null;
  state.selectedArrows.clear();
  state.selectedShapes.clear();
  state.selectedConnectors.clear();
  state.selectedArrows.add(idx);
  refreshSidePanel();
  history.push(createAddArrowCmd(state.arrows, state.selectedArrows, refreshSidePanel, arrow, idx));
}

export function deleteSelectedShapes() {
  if (state.selectedShapes.size === 0) return;
  flushPanelEdit();
  const sortedIndices = Array.from(state.selectedShapes).sort((a, b) => a - b);
  const deletedSet = new Set(sortedIndices);
  const deletedEntries = sortedIndices.map(i => ({ shape: state.shapes[i], index: i }));

  for (const arrow of state.arrows) {
    if (arrow.connectedFrom !== null && arrow.connectedFromType === 'shape' && deletedSet.has(arrow.connectedFrom)) {
      arrow.connectedFrom = null; arrow.connectedFromType = null;
    }
    if (arrow.connectedTo !== null && arrow.connectedToType === 'shape' && deletedSet.has(arrow.connectedTo)) {
      arrow.connectedTo = null; arrow.connectedToType = null;
    }
  }
  for (const conn of state.connectors) {
    if (conn.connectedFrom !== null && conn.connectedFromType === 'shape' && deletedSet.has(conn.connectedFrom)) {
      conn.connectedFrom = null; conn.connectedFromType = null;
    }
    if (conn.connectedTo !== null && conn.connectedToType === 'shape' && deletedSet.has(conn.connectedTo)) {
      conn.connectedTo = null; conn.connectedToType = null;
    }
  }

  for (const idx of sortedIndices) {
    state.parentTree.unregister('shape', state.shapes[idx].id);
  }
  for (let i = sortedIndices.length - 1; i >= 0; i--) {
    state.shapes.splice(sortedIndices[i], 1);
  }
  state.selectedShapes.clear();
  refreshSidePanel();
  history.push(createDeleteShapesCmd(state.shapes, state.selectedShapes, refreshSidePanel, deletedEntries));
}

export function deleteSelectedTextBoxes() {
  if (state.selectedTextBoxes.size === 0) return;
  flushPanelEdit();
  const sortedIndices = Array.from(state.selectedTextBoxes).sort((a, b) => a - b);
  const deletedSet = new Set(sortedIndices);
  const deletedEntries = sortedIndices.map(i => ({ textBox: state.textBoxes[i], index: i }));
  const deletedIds = new Set(deletedEntries.map(e => e.textBox.id));

  for (const arrow of state.arrows) {
    if (arrow.connectedFrom !== null && arrow.connectedFromType === 'textBox' && deletedSet.has(arrow.connectedFrom)) {
      arrow.connectedFrom = null; arrow.connectedFromType = null;
    }
    if (arrow.connectedTo !== null && arrow.connectedToType === 'textBox' && deletedSet.has(arrow.connectedTo)) {
      arrow.connectedTo = null; arrow.connectedToType = null;
    }
  }
  for (const conn of state.connectors) {
    if (conn.connectedFrom !== null && conn.connectedFromType === 'textBox' && deletedSet.has(conn.connectedFrom)) {
      conn.connectedFrom = null; conn.connectedFromType = null;
    }
    if (conn.connectedTo !== null && conn.connectedToType === 'textBox' && deletedSet.has(conn.connectedTo)) {
      conn.connectedTo = null; conn.connectedToType = null;
    }
  }

  for (const idx of sortedIndices) {
    state.parentTree.unregister('textBox', state.textBoxes[idx].id);
  }
  for (let i = sortedIndices.length - 1; i >= 0; i--) {
    state.textBoxes.splice(sortedIndices[i], 1);
  }
  state.selectedTextBoxes.clear();
  refreshSidePanel();
  history.push(createDeleteTextBoxesCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, deletedEntries));
}

export function deleteSelectedConnectors() {
  if (state.selectedConnectors.size === 0) return;
  flushPanelEdit();
  const sortedIndices = Array.from(state.selectedConnectors).sort((a, b) => a - b);
  const deletedEntries = sortedIndices.map(i => ({ connector: state.connectors[i], index: i }));
  for (let i = sortedIndices.length - 1; i >= 0; i--) {
    state.connectors.splice(sortedIndices[i], 1);
  }
  state.selectedConnectors.clear();
  refreshSidePanel();
  history.push(createDeleteConnectorsCmd(state.connectors, state.selectedConnectors, refreshSidePanel, deletedEntries));
}

export function deleteSelectedArrows() {
  if (state.selectedArrows.size === 0) return;
  flushPanelEdit();
  const sortedIndices = Array.from(state.selectedArrows).sort((a, b) => a - b);
  const deletedEntries = sortedIndices.map(i => ({ arrow: { ...state.arrows[i] }, index: i }));
  for (let i = sortedIndices.length - 1; i >= 0; i--) {
    state.arrows.splice(sortedIndices[i], 1);
  }
  state.selectedArrows.clear();
  state.arrowDragTarget = null;
  refreshSidePanel();
  history.push(createDeleteArrowsCmd(state.arrows, state.selectedArrows, refreshSidePanel, deletedEntries));
}

export function addConnection(fromIdx, toIdx) {
  flushPanelEdit();
  let maxId = 0;
  for (const c of state.connections) { if (c.id > maxId) maxId = c.id; }
  const connection = { id: maxId + 1, from: fromIdx, to: toIdx, color: '#6bb5ff', text: '' };
  state.connections.push(connection);
  history.push(createAddConnectionCmd(state.connections, state.selectedConnection, refreshSidePanel, connection));
}

export function deleteConnection(idx) {
  flushPanelEdit();
  if (idx < 0 || idx >= state.connections.length) return;
  const deleted = { ...state.connections[idx] };
  state.connections.splice(idx, 1);
  state.selectedConnection = null;
  refreshSidePanel();
  history.push(createDeleteConnectionCmd(state.connections, state.selectedConnection, refreshSidePanel, deleted, idx));
}

export function deleteSelectedTextBoxesWithConnections() {
  if (state.selectedTextBoxes.size === 0) return;
  flushPanelEdit();
  const sortedIndices = Array.from(state.selectedTextBoxes).sort((a, b) => a - b);
  const deletedEntries = sortedIndices.map(i => ({ textBox: state.textBoxes[i], index: i }));

  const toDelete = new Set(state.selectedTextBoxes);
  const deletedIds = new Set(deletedEntries.map(e => e.textBox.id));

  for (const arrow of state.arrows) {
    if (arrow.connectedFrom !== null) {
      const fromType = arrow.connectedFromType || 'textBox';
      if (fromType === 'textBox' && toDelete.has(arrow.connectedFrom)) {
        arrow.connectedFrom = null; arrow.connectedFromType = null;
      }
    }
    if (arrow.connectedTo !== null) {
      const toType = arrow.connectedToType || 'textBox';
      if (toType === 'textBox' && toDelete.has(arrow.connectedTo)) {
        arrow.connectedTo = null; arrow.connectedToType = null;
      }
    }
  }

  for (const conn of state.connectors) {
    if (conn.connectedFrom !== null) {
      const fromType = conn.connectedFromType || 'textBox';
      if (fromType === 'textBox' && toDelete.has(conn.connectedFrom)) {
        conn.connectedFrom = null; conn.connectedFromType = null;
      }
    }
    if (conn.connectedTo !== null) {
      const toType = conn.connectedToType || 'textBox';
      if (toType === 'textBox' && toDelete.has(conn.connectedTo)) {
        conn.connectedTo = null; conn.connectedToType = null;
      }
    }
  }

  const newConnections = [];
  for (let ci = 0; ci < state.connections.length; ci++) {
    const conn = state.connections[ci];
    const newFrom = toDelete.has(conn.from) ? -1 : conn.from;
    const newTo = toDelete.has(conn.to) ? -1 : conn.to;
    if (newFrom === -1 || newTo === -1) {
      if (ci === state.selectedConnection) state.selectedConnection = null;
    } else {
      newConnections.push(conn);
    }
  }
  state.connections.length = 0;
  for (const c of newConnections) state.connections.push(c);

  for (const idx of sortedIndices) {
    state.parentTree.unregister('textBox', state.textBoxes[idx].id);
  }
  for (let i = sortedIndices.length - 1; i >= 0; i--) {
    state.textBoxes.splice(sortedIndices[i], 1);
  }
  state.selectedTextBoxes.clear();
  refreshSidePanel();
  history.push(createDeleteTextBoxesCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, deletedEntries));
}

export function duplicateSelectedTextBoxes() {
  if (state.selectedTextBoxes.size === 0) return;
  flushPanelEdit();
  const dupes = [];
  for (const i of state.selectedTextBoxes) {
    const tb = state.textBoxes[i];
    dupes.push({
      id: state.nextTextBoxId++,
      x: tb.x + 20,
      y: tb.y + 20,
      w: tb.w,
      h: tb.h,
      color: tb.color,
      textColor: tb.textColor,
      fontSize: tb.fontSize,
      borderColor: tb.borderColor,
      title: tb.title,
      titleColor: tb.titleColor,
      text: tb.text,
      blocks: tb.blocks ? JSON.parse(JSON.stringify(tb.blocks)) : null,
      parentId: null,
      parentType: null
    });
  }
  const startIdx = state.textBoxes.length;
  const entries = [];
  for (let i = 0; i < dupes.length; i++) {
    state.textBoxes.push(dupes[i]);
    state.parentTree.register('textBox', dupes[i].id, dupes[i]);
    entries.push({ textBox: dupes[i], index: startIdx + i });
  }
  state.selectedTextBoxes.clear();
  for (let i = 0; i < dupes.length; i++) state.selectedTextBoxes.add(startIdx + i);
  refreshSidePanel();
  history.push(createDuplicateTextBoxesCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, entries));
}

export function copySelectedTextBoxes() {
  state.clipboard = [];
  if (state.selectedTextBoxes.size === 0) return;
  const rect = state.canvas.getBoundingClientRect();
  const mx = window._lastMouseX ?? rect.width / 2;
  const my = window._lastMouseY ?? rect.height / 2;
  const mouseWorld = screenToWorld(mx, my, state.offsetX, state.offsetY, state.scale);

  const selectedArray = Array.from(state.selectedTextBoxes);
  for (const i of selectedArray) {
    const tb = state.textBoxes[i];
    state.clipboard.push({
      dx: tb.x - mouseWorld.x,
      dy: tb.y - mouseWorld.y,
      w: tb.w,
      h: tb.h,
      color: tb.color,
      textColor: tb.textColor,
      fontSize: tb.fontSize,
      borderColor: tb.borderColor,
      title: tb.title,
      titleColor: tb.titleColor,
      text: tb.text,
      blocks: tb.blocks ? JSON.parse(JSON.stringify(tb.blocks)) : null
    });
  }
}

export function pasteTextBoxesAt(worldX, worldY) {
  if (state.clipboard.length === 0) return;
  flushPanelEdit();
  const pastedEntries = [];
  for (const c of state.clipboard) {
    const textBox = {
      id: state.nextTextBoxId++,
      x: worldX + c.dx,
      y: worldY + c.dy,
      w: c.w,
      h: c.h,
      color: c.color,
      textColor: c.textColor,
      fontSize: c.fontSize,
      borderColor: c.borderColor,
      title: c.title,
      titleColor: c.titleColor,
      text: c.text,
      blocks: c.blocks ? JSON.parse(JSON.stringify(c.blocks)) : null,
      parentId: null,
      parentType: null
    };
    const idx = state.textBoxes.length;
    state.textBoxes.push(textBox);
    state.parentTree.register('textBox', textBox.id, textBox);
    pastedEntries.push({ textBox, index: idx });
  }
  state.selectedTextBoxes.clear();
  for (let i = 0; i < pastedEntries.length; i++) state.selectedTextBoxes.add(pastedEntries[i].index);
  refreshSidePanel();
  history.push(createPasteTextBoxesCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, pastedEntries));
}

export function copySelectedShapes() {
  state.clipboard = [];
  if (state.selectedShapes.size === 0) return;
  const rect = state.canvas.getBoundingClientRect();
  const mx = window._lastMouseX ?? rect.width / 2;
  const my = window._lastMouseY ?? rect.height / 2;
  const mouseWorld = screenToWorld(mx, my, state.offsetX, state.offsetY, state.scale);

  for (const i of state.selectedShapes) {
    const s = state.shapes[i];
    const imgCopy = s.image ? { id: s.image.id, src: s.image.src, fileName: s.image.fileName } : null;
    state.clipboard.push({
      _type: 'shape',
      dx: s.x - mouseWorld.x,
      dy: s.y - mouseWorld.y,
      w: s.w, h: s.h,
      shapeType: s.shapeType,
      color: s.color,
      borderColor: s.borderColor,
      borderWidth: s.borderWidth,
      cornerRadius: s.cornerRadius,
      image: imgCopy,
    });
  }
}

export function pasteShapesAt(worldX, worldY) {
  const entries = state.clipboard.filter(c => (c._type || 'textBox') !== 'textBox');
  if (entries.length === 0) return;
  flushPanelEdit();
  const pastedShapes = [];
  for (const c of entries) {
    const imgCopy = c.image ? { id: c.image.id, src: c.image.src, fileName: c.image.fileName } : null;
    const shape = {
      id: state.nextShapeId++,
      x: worldX + c.dx,
      y: worldY + c.dy,
      w: c.w, h: c.h,
      shapeType: c.shapeType || 'rectangle',
      color: c.color || '#2b2b2b',
      borderColor: c.borderColor || '#6bb5ff',
      borderWidth: c.borderWidth ?? 2,
      cornerRadius: c.cornerRadius ?? (c.shapeType === 'rectangle' ? 4 : 0),
      image: imgCopy,
      parentId: null,
      parentType: null,
    };
    const idx = state.shapes.length;
    state.shapes.push(shape);
    state.parentTree.register('shape', shape.id, shape);
    pastedShapes.push({ shape, index: idx });
  }
  state.selectedShapes.clear();
  state.selectedTextBoxes.clear();
  state.selectedConnectors.clear();
  for (let i = 0; i < pastedShapes.length; i++) state.selectedShapes.add(pastedShapes[i].index);
  refreshSidePanel();
  history.push(createPasteShapesCmd(state.shapes, state.selectedShapes, refreshSidePanel, pastedShapes));
}

export function duplicateSelectedShapes() {
  if (state.selectedShapes.size === 0) return;
  flushPanelEdit();
  const dupes = [];
  for (const i of state.selectedShapes) {
    const s = state.shapes[i];
    const imgCopy = s.image ? { id: s.image.id, src: s.image.src, fileName: s.image.fileName } : null;
    dupes.push({
      id: state.nextShapeId++,
      x: s.x + 20,
      y: s.y + 20,
      w: s.w, h: s.h,
      shapeType: s.shapeType,
      color: s.color,
      borderColor: s.borderColor,
      borderWidth: s.borderWidth,
      cornerRadius: s.cornerRadius,
      image: imgCopy,
      parentId: null,
      parentType: null,
    });
  }
  const startIdx = state.shapes.length;
  const entries = [];
  for (let i = 0; i < dupes.length; i++) {
    state.shapes.push(dupes[i]);
    state.parentTree.register('shape', dupes[i].id, dupes[i]);
    entries.push({ shape: dupes[i], index: startIdx + i });
  }
  state.selectedTextBoxes.clear();
  state.selectedShapes.clear();
  state.selectedConnectors.clear();
  for (let i = 0; i < dupes.length; i++) state.selectedShapes.add(startIdx + i);
  refreshSidePanel();
  history.push(createDuplicateShapesCmd(state.shapes, state.selectedShapes, refreshSidePanel, entries));
}

export function copySelection() {
  state.clipboard = [];
  const rect = state.canvas.getBoundingClientRect();
  const mx = window._lastMouseX ?? rect.width / 2;
  const my = window._lastMouseY ?? rect.height / 2;
  const mouseWorld = screenToWorld(mx, my, state.offsetX, state.offsetY, state.scale);

  for (const i of state.selectedTextBoxes) {
    const tb = state.textBoxes[i];
    state.clipboard.push({
      _type: 'textBox',
      dx: tb.x - mouseWorld.x,
      dy: tb.y - mouseWorld.y,
      w: tb.w, h: tb.h,
      color: tb.color,
      textColor: tb.textColor,
      fontSize: tb.fontSize,
      borderColor: tb.borderColor,
      title: tb.title,
      titleColor: tb.titleColor,
      text: tb.text,
      blocks: tb.blocks ? JSON.parse(JSON.stringify(tb.blocks)) : null,
    });
  }
  for (const i of state.selectedShapes) {
    const s = state.shapes[i];
    const imgCopy = s.image ? { id: s.image.id, src: s.image.src, fileName: s.image.fileName } : null;
    state.clipboard.push({
      _type: 'shape',
      dx: s.x - mouseWorld.x,
      dy: s.y - mouseWorld.y,
      w: s.w, h: s.h,
      shapeType: s.shapeType,
      color: s.color,
      borderColor: s.borderColor,
      borderWidth: s.borderWidth,
      cornerRadius: s.cornerRadius,
      image: imgCopy,
    });
  }
}

export function pasteAt(worldX, worldY) {
  if (state.clipboard.length === 0) return;
  flushPanelEdit();
  const pastedTextBoxes = [];
  const pastedShapes = [];
  for (const c of state.clipboard) {
    const type = c._type || 'textBox';
    if (type === 'textBox') {
      const tb = {
        id: state.nextTextBoxId++,
        x: worldX + c.dx, y: worldY + c.dy,
        w: c.w, h: c.h,
        color: c.color,
        textColor: c.textColor,
        fontSize: c.fontSize,
        borderColor: c.borderColor,
        title: c.title || '',
        titleColor: c.titleColor || '#e7e7e7',
        text: c.text || '',
        blocks: c.blocks ? JSON.parse(JSON.stringify(c.blocks)) : null,
        parentId: null, parentType: null,
      };
      const idx = state.textBoxes.length;
      state.textBoxes.push(tb);
      state.parentTree.register('textBox', tb.id, tb);
      pastedTextBoxes.push({ textBox: tb, index: idx });
    } else if (type === 'shape') {
      const imgCopy = c.image ? { id: c.image.id, src: c.image.src, fileName: c.image.fileName } : null;
      const shape = {
        id: state.nextShapeId++,
        x: worldX + c.dx, y: worldY + c.dy,
        w: c.w, h: c.h,
        shapeType: c.shapeType || 'rectangle',
        color: c.color || '#2b2b2b',
        borderColor: c.borderColor || '#6bb5ff',
        borderWidth: c.borderWidth ?? 2,
        cornerRadius: c.cornerRadius ?? (c.shapeType === 'rectangle' ? 4 : 0),
        image: imgCopy,
        parentId: null, parentType: null,
      };
      const idx = state.shapes.length;
      state.shapes.push(shape);
      state.parentTree.register('shape', shape.id, shape);
      pastedShapes.push({ shape, index: idx });
    }
  }
  state.selectedTextBoxes.clear();
  state.selectedShapes.clear();
  state.selectedConnectors.clear();
  for (const entry of pastedTextBoxes) state.selectedTextBoxes.add(entry.index);
  for (const entry of pastedShapes) state.selectedShapes.add(entry.index);
  refreshSidePanel();
  const commands = [];
  if (pastedTextBoxes.length > 0) {
    commands.push(createPasteTextBoxesCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, pastedTextBoxes));
  }
  if (pastedShapes.length > 0) {
    commands.push(createPasteShapesCmd(state.shapes, state.selectedShapes, refreshSidePanel, pastedShapes));
  }
  if (commands.length > 0) {
    history.push(commands.length === 1 ? commands[0] : createBatchCmd(commands, 'Paste'));
  }
}

export function duplicateSelection() {
  const hasTextBoxes = state.selectedTextBoxes.size > 0;
  const hasShapes = state.selectedShapes.size > 0;
  if (!hasTextBoxes && !hasShapes) return;
  if (hasTextBoxes) duplicateSelectedTextBoxes();
  if (hasShapes) duplicateSelectedShapes();
}

export function getDocumentState() {
  return {
    connections: state.connections,
    arrows: state.arrows,
    shapes: state.shapes,
    textBoxes: state.textBoxes,
    connectors: state.connectors,
    viewport: {
      offsetX: state.targetOffsetX,
      offsetY: state.targetOffsetY,
      scale: state.targetScale
    },
    settings: {}
  };
}

export function restoreDocumentState(docState) {
  state.connections.length = 0;
  state.arrows.length = 0;
  state.shapes.length = 0;
  state.textBoxes.length = 0;
  state.connectors.length = 0;
  state.selectedTextBoxes.clear();
  state.selectedConnection = null;
  state.selectedArrows.clear();
  state.selectedShapes.clear();
  state.selectedConnectors.clear();
  state.arrowDragTarget = null;
  state.clipboard = [];
  state.connectingFrom = null;
  history.clear();
  state.panelPendingEdit = null;

  destroyAllEntities();

  if (docState.nodes && docState.nodes.length > 0) {
    for (const n of docState.nodes) {
      state.textBoxes.push({
        id: state.nextTextBoxId++,
        x: n.x,
        y: n.y,
        w: n.w,
        h: n.h,
        color: n.color || '#1a1a1a',
        borderColor: '#444',
        textColor: n.textColor || '#ddd',
        fontSize: n.fontSize || 14,
        title: n.title || '',
        titleColor: n.titleColor || '#e7e7e7',
        text: n.text || '',
        blocks: n.blocks || null,
        parentId: n.parentId || null,
        parentType: n.parentType || null,
      });
    }
  }

  const connOffset = docState.nodes ? docState.nodes.length : 0;
  for (const c of (docState.connections || [])) {
    const newFrom = c.from;
    const newTo = c.to;
    if (newFrom < state.textBoxes.length && newTo < state.textBoxes.length) {
      state.connections.push({ id: c.id, from: newFrom, to: newTo, color: c.color || '#6bb5ff', text: c.text || '' });
    }
  }

  for (const a of (docState.arrows || [])) {
    state.arrows.push(a);
  }
  for (const s of (docState.shapes || [])) {
    state.shapes.push(s);
  }
  for (const tb of (docState.textBoxes || [])) {
    state.textBoxes.push(tb);
  }
  for (const cn of (docState.connectors || [])) {
    state.connectors.push(cn);
  }

  let maxTextBoxId = 0;
  for (const tb of state.textBoxes) {
    if (typeof tb.id === 'number' && tb.id > maxTextBoxId) maxTextBoxId = tb.id;
  }
  state.nextTextBoxId = maxTextBoxId + 1;

  let maxConnId = 0;
  for (const c of state.connections) {
    if (c.id > maxConnId) maxConnId = c.id;
  }
  state.nextConnectionId = maxConnId + 1;

  let maxArrowId = 0;
  for (const a of state.arrows) {
    if (a.id > maxArrowId) maxArrowId = a.id;
  }
  state.nextArrowId = Math.max(state.nextArrowId, maxArrowId + 1);

  let maxShapeId = 0;
  for (const s of state.shapes) {
    if (s.id > maxShapeId) maxShapeId = s.id;
  }
  state.nextShapeId = maxShapeId + 1;

  let maxConnectorId = 0;
  for (const cn of state.connectors) {
    if (cn.id > maxConnectorId) maxConnectorId = cn.id;
  }
  state.nextConnectorId = maxConnectorId + 1;

  const vp = docState.viewport || {};
  state.offsetX = state.targetOffsetX = vp.offsetX ?? 0;
  state.offsetY = state.targetOffsetY = vp.offsetY ?? 0;
  state.scale = state.targetScale = vp.scale ?? 1;

  state.markDrawOrderDirty();
  state.reparentAll();
  state.isDirty = false;
  refreshSidePanel();
}

export async function newDocument() {
  flushPanelEdit();
  if (state.isDirty) {
    const confirmed = await showConfirmDialog('This project has unsaved changes. Are you sure you want to create a new file? Everything unsaved will be discarded!');
    if (!confirmed) return;
  }
  restoreDocumentState({ nodes: [], connections: [], arrows: [], shapes: [], textBoxes: [], connectors: [], viewport: { offsetX: 0, offsetY: 0, scale: 1 } });
  state.currentFileName = null;
  clearCachedFileHandle();
  state.markDrawOrderDirty();
}

function showSaving() {
  const el = document.getElementById('saveIndicator');
  if (!el) return;
  el.textContent = 'Saving...';
  el.className = 'save-indicator saving';
}

function showSaved() {
  const el = document.getElementById('saveIndicator');
  if (!el) return;
  el.textContent = 'Saved!';
  el.className = 'save-indicator saved';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.textContent = '';
    el.className = 'save-indicator';
  }, 2000);
}

export async function saveDocument() {
  showSaving();
  const docState = getDocumentState();
  const doc = serializeDocument(docState);
  const suggestedName = state.currentFileName || `document${FILE_EXTENSION}`;
  const result = await saveToFile(doc, suggestedName);
  if (result) {
    state.currentFileName = result.name;
    state.isDirty = false;
    showSaved();
  } else {
    clearIndicator();
  }
}

export async function saveDocumentAs() {
  showSaving();
  const docState = getDocumentState();
  const doc = serializeDocument(docState);
  const suggestedName = state.currentFileName || `document${FILE_EXTENSION}`;
  const result = await saveToFileAs(doc, suggestedName);
  if (result) {
    state.currentFileName = result.name;
    state.isDirty = false;
    showSaved();
  } else {
    clearIndicator();
  }
}

function clearIndicator() {
  const el = document.getElementById('saveIndicator');
  if (!el) return;
  el.textContent = '';
  el.className = 'save-indicator';
  clearTimeout(el._timer);
}

function showReloaded() {
  const el = document.getElementById('saveIndicator');
  if (!el) return;
  el.textContent = 'Reloaded!';
  el.className = 'save-indicator saved';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.textContent = '';
    el.className = 'save-indicator';
  }, 2000);
}

export async function reloadDocument() {
  flushPanelEdit();
  if (state.isDirty) {
    const confirmed = await showConfirmDialog('The file has changed on disk. Reloading will discard your unsaved changes. Continue?');
    if (!confirmed) {
      await syncFileTimestamp();
      return false;
    }
  }
  const result = await reloadFromCachedHandle();
  if (!result) return false;
  const docState = deserializeDocument(result.data);
  restoreDocumentState(docState);
  state.currentFileName = result.name;
  showReloaded();
  return true;
}

export async function openDocument() {
  flushPanelEdit();
  if (state.isDirty) {
    const confirmed = await showConfirmDialog('This project has unsaved changes. Are you sure you want to open a different file? Everything unsaved will be discarded!');
    if (!confirmed) return;
  }
  const result = await loadFromFile();
  if (!result) return;
  const docState = deserializeDocument(result.data);
  restoreDocumentState(docState);
  state.currentFileName = result.name;
}

export function addNodeAt(worldX, worldY, optW, optH) {
  return addTextBoxAt(worldX, worldY, optW, optH);
}
export function deleteSelectedNodes() {
  return deleteSelectedTextBoxesWithConnections();
}
export function duplicateSelectedNodes() {
  return duplicateSelection();
}
export function copySelectedNodes() {
  return copySelection();
}
export function pasteNodesAt(worldX, worldY) {
  return pasteAt(worldX, worldY);
}
export function addNodeAtCenter() {
  return addTextBoxAtCenter();
}
