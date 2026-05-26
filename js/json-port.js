import { state } from './state.js';
import { refreshSidePanel } from './side-panel.js';
import { destroyAllEntities } from './dom-entities.js';
import { history, flushPanelEdit } from './history.js';
import { showAlertDialog, showConfirmDialog } from './dialog.js';

const FORMAT = 'canvaswebtool-portable';
const VERSION = 1;

function resolveConnectedRef(index, type) {
  if (index === null || index === undefined || type === null) return null;
  if (type === 'textBox') {
    const tb = state.textBoxes[index];
    return tb ? { entityId: `tb-${tb.id}`, type: 'textBox' } : null;
  }
  if (type === 'shape') {
    const s = state.shapes[index];
    return s ? { entityId: `shp-${s.id}`, type: 'shape' } : null;
  }
  return null;
}

export function exportAsPortableJSON() {
  const textBoxes = [];
  const shapes = [];
  const arrows = [];
  const connectors = [];
  const connections = [];

  for (let i = 0; i < state.textBoxes.length; i++) {
    const tb = state.textBoxes[i];
    textBoxes.push({
      id: `tb-${tb.id}`,
      title: tb.title || '',
      position: { x: tb.x, y: tb.y },
      size: { w: tb.w, h: tb.h },
      style: {
        backgroundColor: tb.color,
        borderColor: tb.borderColor,
        textColor: tb.textColor,
        titleColor: tb.titleColor,
        fontSize: tb.fontSize
      },
      content: tb.text || '',
      blocks: tb.blocks ? JSON.parse(JSON.stringify(tb.blocks)) : null,
      parent: tb.parentId ? { entityId: `tb-${tb.parentId}`, type: tb.parentType } : null
    });
  }

  for (let i = 0; i < state.shapes.length; i++) {
    const s = state.shapes[i];
    shapes.push({
      id: `shp-${s.id}`,
      type: s.shapeType,
      position: { x: s.x, y: s.y },
      size: { w: s.w, h: s.h },
      style: {
        backgroundColor: s.color,
        borderColor: s.borderColor,
        borderWidth: s.borderWidth,
        cornerRadius: s.cornerRadius
      },
      image: s.image ? { src: s.image.src || null, fileName: s.image.fileName || '' } : null,
      parent: s.parentId ? { entityId: `shp-${s.parentId}`, type: s.parentType } : null
    });
  }

  for (let i = 0; i < state.arrows.length; i++) {
    const a = state.arrows[i];
    arrows.push({
      id: `arr-${a.id}`,
      startPoint: { x: a.x1, y: a.y1 },
      endPoint: { x: a.x2, y: a.y2 },
      connectedFrom: resolveConnectedRef(a.connectedFrom, a.connectedFromType),
      connectedTo: resolveConnectedRef(a.connectedTo, a.connectedToType),
      style: {
        color: a.color,
        lineWidth: a.lineWidth,
        headSize: a.headSize
      }
    });
  }

  for (let i = 0; i < state.connectors.length; i++) {
    const c = state.connectors[i];
    connectors.push({
      id: `cnr-${c.id}`,
      startPoint: { x: c.x1, y: c.y1 },
      endPoint: { x: c.x2, y: c.y2 },
      connectedFrom: resolveConnectedRef(c.connectedFrom, c.connectedFromType),
      connectedTo: resolveConnectedRef(c.connectedTo, c.connectedToType),
      style: { color: c.color }
    });
  }

  for (let i = 0; i < state.connections.length; i++) {
    const cn = state.connections[i];
    const fromTb = state.textBoxes[cn.from];
    const toTb = state.textBoxes[cn.to];
    connections.push({
      id: `cnn-${cn.id}`,
      from: fromTb ? `tb-${fromTb.id}` : null,
      to: toTb ? `tb-${toTb.id}` : null,
      style: { color: cn.color },
      label: cn.text || ''
    });
  }

  return {
    meta: {
      format: FORMAT,
      version: VERSION,
      exportedAt: new Date().toISOString()
    },
    viewport: {
      offsetX: state.targetOffsetX,
      offsetY: state.targetOffsetY,
      scale: state.targetScale
    },
    entities: {
      textBoxes,
      shapes,
      arrows,
      connectors,
      connections
    }
  };
}

function parseEntityId(portableId) {
  const dashIdx = portableId.indexOf('-');
  if (dashIdx < 0) return { prefix: portableId, numericId: 0 };
  const prefix = portableId.substring(0, dashIdx);
  const numericId = parseInt(portableId.substring(dashIdx + 1), 10);
  return { prefix, numericId: isNaN(numericId) ? 0 : numericId };
}

function clearAllEntities() {
  flushPanelEdit();
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
}

export function importFromPortableJSON(json) {
  if (!json || json.meta?.format !== FORMAT) {
    throw new Error('Invalid portable document format');
  }

  const doc = json.meta?.version !== undefined ? json : json.document || json;

  clearAllEntities();

  const entities = doc.entities || { textBoxes: [], shapes: [], arrows: [], connectors: [], connections: [] };
  const idToIndex = { textBox: {}, shape: {} };
  const textBoxList = entities.textBoxes || [];
  const shapeList = entities.shapes || [];
  const arrowList = entities.arrows || [];
  const connectorList = entities.connectors || [];
  const connectionList = entities.connections || [];

  let maxTextBoxId = 0;
  for (let i = 0; i < textBoxList.length; i++) {
    const e = textBoxList[i];
    const { numericId } = parseEntityId(e.id);
    const id = numericId > 0 ? numericId : state.nextTextBoxId++;
    if (id > maxTextBoxId) maxTextBoxId = id;
    const titleColor = (e.style && e.style.titleColor !== undefined) ? e.style.titleColor : '#e7e7e7';
    const textBox = {
      id,
      x: (e.position && e.position.x) || 0,
      y: (e.position && e.position.y) || 0,
      w: (e.size && e.size.w) || 240,
      h: (e.size && e.size.h) || 160,
      title: e.title || '',
      titleColor,
      text: e.content || '',
      blocks: e.blocks || null,
      color: (e.style && e.style.backgroundColor) || '#1a1a1a',
      borderColor: (e.style && e.style.borderColor) || '#444',
      textColor: (e.style && e.style.textColor) || '#ddd',
      fontSize: (e.style && e.style.fontSize) || 14,
      parentId: null,
      parentType: null,
      locked: false,
    };
    idToIndex.textBox[e.id] = i;
    state.textBoxes.push(textBox);
    state.parentTree.register('textBox', textBox.id, textBox);
  }

  let maxShapeId = 0;
  for (let i = 0; i < shapeList.length; i++) {
    const e = shapeList[i];
    const { numericId } = parseEntityId(e.id);
    const id = numericId > 0 ? numericId : state.nextShapeId++;
    if (id > maxShapeId) maxShapeId = id;
    const shape = {
      id,
      shapeType: e.type || 'rectangle',
      x: (e.position && e.position.x) || 0,
      y: (e.position && e.position.y) || 0,
      w: (e.size && e.size.w) || 120,
      h: (e.size && e.size.h) || 80,
      color: (e.style && e.style.backgroundColor) || '#2b2b2b',
      borderColor: (e.style && e.style.borderColor) || '#6bb5ff',
      borderWidth: (e.style && e.style.borderWidth) != null ? e.style.borderWidth : 2,
      cornerRadius: (e.style && e.style.cornerRadius) != null ? e.style.cornerRadius : (e.type === 'rectangle' ? 4 : 0),
      image: e.image ? { id: 0, src: e.image.src || null, fileName: e.image.fileName || '' } : null,
      parentId: null,
      parentType: null,
      locked: false,
    };
    idToIndex.shape[e.id] = i;
    state.shapes.push(shape);
    state.parentTree.register('shape', shape.id, shape);
  }

  for (let i = 0; i < textBoxList.length; i++) {
    const e = textBoxList[i];
    if (e.parent) {
      const parentEntry = idToIndex.textBox[e.parent.entityId];
      const parentShape = idToIndex.shape[e.parent.entityId];
      let pIdx = null;
      if (parentEntry !== undefined) { pIdx = parentEntry; state.textBoxes[i].parentType = 'textBox'; }
      else if (parentShape !== undefined) { pIdx = parentShape; state.textBoxes[i].parentType = 'shape'; }
      if (pIdx !== null) state.textBoxes[i].parentId = (e.parent.type === 'textBox' ? state.textBoxes[pIdx] : state.shapes[pIdx]).id;
    }
  }

  for (let i = 0; i < shapeList.length; i++) {
    const e = shapeList[i];
    if (e.parent) {
      const parentEntry = idToIndex.textBox[e.parent.entityId];
      const parentShape = idToIndex.shape[e.parent.entityId];
      let pIdx = null;
      if (parentEntry !== undefined) { pIdx = parentEntry; state.shapes[i].parentType = 'textBox'; }
      else if (parentShape !== undefined) { pIdx = parentShape; state.shapes[i].parentType = 'shape'; }
      if (pIdx !== null) state.shapes[i].parentId = (e.parent.type === 'textBox' ? state.textBoxes[pIdx] : state.shapes[pIdx]).id;
    }
  }

  let maxArrowId = 0;
  for (const a of arrowList) {
    const { numericId } = parseEntityId(a.id);
    const id = numericId > 0 ? numericId : state.nextArrowId++;
    if (id > maxArrowId) maxArrowId = id;

    let connectedFrom = null, connectedFromType = null;
    if (a.connectedFrom && a.connectedFrom.entityId) {
      const fromIdx = idToIndex.textBox[a.connectedFrom.entityId];
      if (fromIdx !== undefined) { connectedFrom = fromIdx; connectedFromType = 'textBox'; }
      else {
        const fromShpIdx = idToIndex.shape[a.connectedFrom.entityId];
        if (fromShpIdx !== undefined) { connectedFrom = fromShpIdx; connectedFromType = 'shape'; }
      }
    }

    let connectedTo = null, connectedToType = null;
    if (a.connectedTo && a.connectedTo.entityId) {
      const toIdx = idToIndex.textBox[a.connectedTo.entityId];
      if (toIdx !== undefined) { connectedTo = toIdx; connectedToType = 'textBox'; }
      else {
        const toShpIdx = idToIndex.shape[a.connectedTo.entityId];
        if (toShpIdx !== undefined) { connectedTo = toShpIdx; connectedToType = 'shape'; }
      }
    }

    state.arrows.push({
      id,
      x1: (a.startPoint && a.startPoint.x) || 0,
      y1: (a.startPoint && a.startPoint.y) || 0,
      x2: (a.endPoint && a.endPoint.x) || 120,
      y2: (a.endPoint && a.endPoint.y) || 0,
      connectedFrom, connectedTo, connectedFromType, connectedToType,
      color: (a.style && a.style.color) || '#6bb5ff',
      lineWidth: (a.style && a.style.lineWidth) || 2,
      headSize: (a.style && a.style.headSize) || 14,
      locked: false,
    });
  }

  let maxConnectorId = 0;
  for (const c of connectorList) {
    const { numericId } = parseEntityId(c.id);
    const id = numericId > 0 ? numericId : state.nextConnectorId++;
    if (id > maxConnectorId) maxConnectorId = id;

    let connectedFrom = null, connectedFromType = null;
    if (c.connectedFrom && c.connectedFrom.entityId) {
      const fromIdx = idToIndex.textBox[c.connectedFrom.entityId];
      if (fromIdx !== undefined) { connectedFrom = fromIdx; connectedFromType = 'textBox'; }
      else {
        const fromShpIdx = idToIndex.shape[c.connectedFrom.entityId];
        if (fromShpIdx !== undefined) { connectedFrom = fromShpIdx; connectedFromType = 'shape'; }
      }
    }

    let connectedTo = null, connectedToType = null;
    if (c.connectedTo && c.connectedTo.entityId) {
      const toIdx = idToIndex.textBox[c.connectedTo.entityId];
      if (toIdx !== undefined) { connectedTo = toIdx; connectedToType = 'textBox'; }
      else {
        const toShpIdx = idToIndex.shape[c.connectedTo.entityId];
        if (toShpIdx !== undefined) { connectedTo = toShpIdx; connectedToType = 'shape'; }
      }
    }

    state.connectors.push({
      id,
      x1: (c.startPoint && c.startPoint.x) || 0,
      y1: (c.startPoint && c.startPoint.y) || 0,
      x2: (c.endPoint && c.endPoint.x) || 120,
      y2: (c.endPoint && c.endPoint.y) || 0,
      connectedFrom, connectedTo, connectedFromType, connectedToType,
      color: (c.style && c.style.color) || '#6bb5ff',
      locked: false,
    });
  }

  let maxConnectionId = 0;
  for (const cn of connectionList) {
    const { numericId } = parseEntityId(cn.id);
    const id = numericId > 0 ? numericId : state.nextConnectionId++;
    if (id > maxConnectionId) maxConnectionId = id;

    const fromIdx = idToIndex.textBox[cn.from];
    const toIdx = idToIndex.textBox[cn.to];
    const from = fromIdx !== undefined ? fromIdx : null;
    const to = toIdx !== undefined ? toIdx : null;

    if (from !== null && to !== null) {
      state.connections.push({
        id,
        from,
        to,
        color: (cn.style && cn.style.color) || '#6bb5ff',
        text: cn.label || '',
        locked: false,
      });
    }
  }

  state.nextTextBoxId = Math.max(state.nextTextBoxId, maxTextBoxId + 1);
  state.nextShapeId = Math.max(state.nextShapeId, maxShapeId + 1);
  state.nextArrowId = Math.max(state.nextArrowId, maxArrowId + 1);
  state.nextConnectorId = Math.max(state.nextConnectorId, maxConnectorId + 1);
  state.nextConnectionId = Math.max(state.nextConnectionId, maxConnectionId + 1);

  const vp = json.viewport || {};
  state.offsetX = state.targetOffsetX = vp.offsetX ?? 0;
  state.offsetY = state.targetOffsetY = vp.offsetY ?? 0;
  state.scale = state.targetScale = vp.scale ?? 1;

  state.markDrawOrderDirty();
  state.reparentAll();
  state.isDirty = false;
  refreshSidePanel();
}

export function downloadPortableJSON() {
  const data = exportAsPortableJSON();
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  a.download = `canvas-export-${timestamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function openPortableJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (state.isDirty) {
      const confirmed = await showConfirmDialog('This project has unsaved changes. Importing will replace the current document. Continue?');
      if (!confirmed) return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target.result);
        importFromPortableJSON(json);
      } catch (err) {
        console.error('Failed to import portable JSON:', err);
        showAlertDialog('Failed to import JSON file.\n\n' + (err.message || 'Unknown error'));
      }
    };
    reader.readAsText(file);
  };
  input.click();
}
