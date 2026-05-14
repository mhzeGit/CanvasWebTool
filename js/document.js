import { state } from './state.js';
import { history, flushPanelEdit } from './history.js';
import {
  createAddNodeCmd, createDeleteNodesCmd, createMoveNodesCmd,
  createResizeNodeCmd, createPropertyChangeCmd, createPasteNodesCmd,
  createDuplicateNodesCmd,
  nextNodeId, initNodeId,
  createAddShapeCmd, createDeleteShapesCmd, createMoveShapesCmd,
  createResizeShapeCmd, createAddTextBoxCmd, createDeleteTextBoxesCmd,
  createMoveTextBoxesCmd, createAddConnectorCmd, createDeleteConnectorsCmd,
  createMoveConnectorsCmd,
} from './undo.js';
import { serializeDocument, deserializeDocument, FILE_EXTENSION } from './format.js';
import { saveToFile, loadFromFile } from './file-io.js';
import { screenToWorld, getNodeEdgePoint } from './utils.js';
import { refreshSidePanel } from './side-panel.js';
import { DEFAULT_NODE_COLOR } from './config.js';

export function addNodeAtCenter() {
  flushPanelEdit();
  const canvas = state.canvas;
  const rect = canvas.getBoundingClientRect();
  const centerCssX = rect.width / 2;
  const centerCssY = rect.height / 2;
  const world = screenToWorld(centerCssX, centerCssY, state.offsetX, state.offsetY, state.scale);
  addNodeAt(world.x, world.y);
}

export function addNodeAt(worldX, worldY) {
  flushPanelEdit();
  const w = 240; const h = 160;
  const node = { id: nextNodeId(), x: worldX - w / 2, y: worldY - h / 2, w, h, color: DEFAULT_NODE_COLOR, title: '', titleColor: '#e7e7e7', text: '', parentId: null, parentType: null };
  const idx = state.nodes.length;
  state.nodes.push(node);
  state.selected.clear();
  state.selected.add(idx);
  state.markDrawOrderDirty();
  state.reparentAll();
  refreshSidePanel();
  history.push(createAddNodeCmd(state.nodes, state.selected, refreshSidePanel, node, idx));
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

export function addArrowAt(worldX, worldY, connectNodeIdx) {
  flushPanelEdit();
  const offset = 60;
  let x1 = worldX - offset;
  let y1 = worldY;
  let x2 = worldX + offset;
  let y2 = worldY;
  let connectedFrom = null;
  let connectedTo = null;

  if (connectNodeIdx !== undefined && connectNodeIdx !== null && state.nodes[connectNodeIdx]) {
    const edge = getNodeEdgePoint(state.nodes[connectNodeIdx], worldX, worldY);
    x1 = edge.x;
    y1 = edge.y;
    connectedFrom = connectNodeIdx;
    x2 = worldX;
    y2 = worldY;
  }

  const arrow = {
    id: state.nextArrowId++,
    x1, y1, x2, y2,
    connectedFrom,
    connectedTo,
    color: '#6bb5ff'
  };

  const idx = state.arrows.length;
  state.arrows.push(arrow);
  state.selected.clear();
  state.selectedConnection = null;
  state.selectedArrows.clear();
  state.arrowDragTarget = { arrowIdx: idx, end: 'end' };
  state.selectedArrows.add(idx);
  refreshSidePanel();
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
    color: '#2b2b2b',
    borderColor: '#6bb5ff',
    borderWidth: 2,
    cornerRadius: type === 'rectangle' ? 4 : 0,
    parentId: null,
    parentType: null,
  };
  const idx = state.shapes.length;
  state.shapes.push(shape);
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
  const w = isDrag ? optW : 200;
  const h = isDrag ? optH : 80;
  const textBox = {
    id: state.nextTextBoxId++,
    x: isDrag ? worldX : worldX - w / 2,
    y: isDrag ? worldY : worldY - h / 2,
    w,
    h,
    text: '',
    color: '#1a1a1a',
    borderColor: '#444',
    textColor: '#ddd',
    fontSize: 14,
    parentId: null,
    parentType: null,
  };
  const idx = state.textBoxes.length;
  state.textBoxes.push(textBox);
  state.selectedShapes.clear();
  state.selectedTextBoxes.clear();
  state.selectedConnectors.clear();
  state.selectedTextBoxes.add(idx);
  refreshSidePanel();
  history.push(createAddTextBoxCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, textBox, idx));
}

export function addConnector(x1, y1, x2, y2) {
  flushPanelEdit();
  const connector = {
    id: state.nextConnectorId++,
    x1, y1, x2, y2,
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

export function addArrowFromPoints(x1, y1, x2, y2) {
  flushPanelEdit();
  const arrow = {
    id: state.nextArrowId++,
    x1, y1, x2, y2,
    connectedFrom: null,
    connectedTo: null,
    color: '#6bb5ff',
  };
  const idx = state.arrows.length;
  state.arrows.push(arrow);
  state.selected.clear();
  state.selectedConnection = null;
  state.selectedArrows.clear();
  state.selectedShapes.clear();
  state.selectedTextBoxes.clear();
  state.selectedConnectors.clear();
  state.selectedArrows.add(idx);
  refreshSidePanel();
}

export function deleteSelectedShapes() {
  if (state.selectedShapes.size === 0) return;
  flushPanelEdit();
  const sortedIndices = Array.from(state.selectedShapes).sort((a, b) => a - b);
  const deletedEntries = sortedIndices.map(i => ({ shape: state.shapes[i], index: i }));
  for (let i = sortedIndices.length - 1; i >= 0; i--) {
    state.shapes.splice(sortedIndices[i], 1);
  }
  state.selectedShapes.clear();
  state.reparentAll();
  refreshSidePanel();
  history.push(createDeleteShapesCmd(state.shapes, state.selectedShapes, refreshSidePanel, deletedEntries));
}

export function deleteSelectedTextBoxes() {
  if (state.selectedTextBoxes.size === 0) return;
  flushPanelEdit();
  const sortedIndices = Array.from(state.selectedTextBoxes).sort((a, b) => a - b);
  const deletedEntries = sortedIndices.map(i => ({ textBox: state.textBoxes[i], index: i }));
  for (let i = sortedIndices.length - 1; i >= 0; i--) {
    state.textBoxes.splice(sortedIndices[i], 1);
  }
  state.selectedTextBoxes.clear();
  state.reparentAll();
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
  state.reparentAll();
  refreshSidePanel();
  history.push(createDeleteConnectorsCmd(state.connectors, state.selectedConnectors, refreshSidePanel, deletedEntries));
}

export function deleteSelectedNodes() {
  if (state.selected.size === 0) return;
  flushPanelEdit();
  const sortedIndices = Array.from(state.selected).sort((a, b) => a - b);
  const deletedEntries = sortedIndices.map(i => ({ node: state.nodes[i], index: i }));

  const toDelete = new Set(state.selected);
  const deletedIds = new Set(deletedEntries.map(e => e.node.id));

  const remain = [];
  const indexMap = [];
  for (let i = 0; i < state.nodes.length; i++) {
    if (!toDelete.has(i)) {
      if (state.nodes[i].parentId !== null && state.nodes[i].parentId !== undefined && deletedIds.has(state.nodes[i].parentId)) {
        state.nodes[i].parentId = null;
      }
      indexMap[i] = remain.length;
      remain.push(state.nodes[i]);
    }
  }
  state.nodes.length = 0;
  for (const n of remain) state.nodes.push(n);

  const newConnections = [];
  for (let ci = 0; ci < state.connections.length; ci++) {
    const conn = state.connections[ci];
    const newFrom = indexMap[conn.from];
    const newTo = indexMap[conn.to];
    if (newFrom !== undefined && newTo !== undefined) {
      conn.from = newFrom;
      conn.to = newTo;
      newConnections.push(conn);
    } else {
      if (ci === state.selectedConnection) state.selectedConnection = null;
    }
  }
  state.connections.length = 0;
  for (const c of newConnections) state.connections.push(c);

  for (const arrow of state.arrows) {
    if (arrow.connectedFrom !== null) {
      const newIdx = indexMap[arrow.connectedFrom];
      arrow.connectedFrom = newIdx !== undefined ? newIdx : null;
    }
    if (arrow.connectedTo !== null) {
      const newIdx = indexMap[arrow.connectedTo];
      arrow.connectedTo = newIdx !== undefined ? newIdx : null;
    }
  }

  if (state.connectingFrom !== null && toDelete.has(state.connectingFrom)) {
    state.connectingFrom = null;
  }

  state.selected.clear();
  state.markDrawOrderDirty();
  state.reparentAll();
  refreshSidePanel();
  history.push(createDeleteNodesCmd(state.nodes, state.selected, refreshSidePanel, deletedEntries));
}

export function duplicateSelectedNodes() {
  if (state.selected.size === 0) return;
  flushPanelEdit();
  const dupes = [];
  for (const i of state.selected) {
    const n = state.nodes[i];
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
      parentId: null,
      parentType: null
    });
  }
  const startIdx = state.nodes.length;
  const entries = [];
  for (let i = 0; i < dupes.length; i++) {
    state.nodes.push(dupes[i]);
    entries.push({ node: dupes[i], index: startIdx + i });
  }
  state.selected.clear();
  for (let i = 0; i < dupes.length; i++) state.selected.add(startIdx + i);
  state.markDrawOrderDirty();
  state.reparentAll();
  refreshSidePanel();
  history.push(createDuplicateNodesCmd(state.nodes, state.selected, refreshSidePanel, entries));
}

export function copySelectedNodes() {
  state.clipboard = [];
  if (state.selected.size === 0) return;
  const rect = state.canvas.getBoundingClientRect();
  const mx = window._lastMouseX ?? rect.width / 2;
  const my = window._lastMouseY ?? rect.height / 2;
  const mouseWorld = screenToWorld(mx, my, state.offsetX, state.offsetY, state.scale);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const selectedArray = Array.from(state.selected);
  for (const i of selectedArray) {
    const n = state.nodes[i];
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }

  for (const i of selectedArray) {
    const n = state.nodes[i];
    state.clipboard.push({
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

export function pasteNodesAt(worldX, worldY) {
  if (state.clipboard.length === 0) return;
  flushPanelEdit();
  const pastedEntries = [];
  for (const c of state.clipboard) {
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
      parentId: null,
      parentType: null
    };
    const idx = state.nodes.length;
    state.nodes.push(node);
    pastedEntries.push({ node, index: idx });
  }
  state.selected.clear();
  for (let i = 0; i < pastedEntries.length; i++) state.selected.add(pastedEntries[i].index);
  state.markDrawOrderDirty();
  state.reparentAll();
  refreshSidePanel();
  history.push(createPasteNodesCmd(state.nodes, state.selected, refreshSidePanel, pastedEntries));
}

export function getDocumentState() {
  return {
    nodes: state.nodes,
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
  state.nodes.length = 0;
  state.connections.length = 0;
  state.arrows.length = 0;
  state.shapes.length = 0;
  state.textBoxes.length = 0;
  state.connectors.length = 0;
  state.selected.clear();
  state.selectedConnection = null;
  state.selectedArrows.clear();
  state.selectedShapes.clear();
  state.selectedTextBoxes.clear();
  state.selectedConnectors.clear();
  state.arrowDragTarget = null;
  state.clipboard = [];
  state.connectingFrom = null;
  history.clear();
  state.panelPendingEdit = null;

  for (const n of (docState.nodes || [])) {
    state.nodes.push(n);
  }
  for (const c of (docState.connections || [])) {
    state.connections.push(c);
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

  let maxNodeId = 0;
  for (const n of state.nodes) {
    if (typeof n.id === 'number' && n.id > maxNodeId) maxNodeId = n.id;
  }
  initNodeId(maxNodeId + 1);

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

  let maxTextBoxId = 0;
  for (const tb of state.textBoxes) {
    if (tb.id > maxTextBoxId) maxTextBoxId = tb.id;
  }
  state.nextTextBoxId = maxTextBoxId + 1;

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
  refreshSidePanel();
}

export function newDocument() {
  restoreDocumentState({ nodes: [], connections: [], arrows: [], shapes: [], textBoxes: [], connectors: [], viewport: { offsetX: 0, offsetY: 0, scale: 1 } });
  state.currentFileName = null;
  state.markDrawOrderDirty();
}

export async function saveDocument() {
  const docState = getDocumentState();
  const doc = serializeDocument(docState);
  const suggestedName = state.currentFileName || `document${FILE_EXTENSION}`;
  const result = await saveToFile(doc, suggestedName);
  if (result) {
    state.currentFileName = result.name;
  }
}

export async function openDocument() {
  const result = await loadFromFile();
  if (!result) return;
  const docState = deserializeDocument(result.data);
  restoreDocumentState(docState);
  state.currentFileName = result.name;
}
