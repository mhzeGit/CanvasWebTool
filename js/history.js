import { createHistoryManager, createResizeNodeCmd, createPropertyChangeCmd, createResizeShapeCmd, createShapePropertyChangeCmd, createTextBoxPropertyChangeCmd, createArrowPropertyChangeCmd, createConnectionPropertyChangeCmd, createResizeTextBoxCmd } from './undo.js';
import { state } from './state.js';

export const history = createHistoryManager();

let _refreshSidePanel = null;

export function initHistory(refreshSidePanel) {
  _refreshSidePanel = refreshSidePanel;
}

export function flushPanelEdit() {
  if (!state.panelPendingEdit) return;
  const { type, nodeId, shapeId, tbId, arrowId, connId, property, oldValue, oldBounds } = state.panelPendingEdit;
  state.panelPendingEdit = null;

  if (type === 'shape') {
    const shape = state.shapes.find(s => s.id === shapeId);
    if (!shape) return;
    const newValue = shape[property];
    if (oldValue !== newValue) {
      if ((property === 'w' || property === 'h') && oldBounds) {
        history.push(createResizeShapeCmd(state.shapes, state.selectedShapes, _refreshSidePanel, shapeId,
          { x: oldBounds.x, y: oldBounds.y, w: oldBounds.w, h: oldBounds.h },
          { x: shape.x, y: shape.y, w: shape.w, h: shape.h }));
      } else {
        history.push(createShapePropertyChangeCmd(state.shapes, state.selectedShapes, _refreshSidePanel, shapeId, property, oldValue, newValue));
      }
    }
    return;
  }

  if (type === 'textBox') {
    const tb = state.textBoxes.find(t => t.id === tbId);
    if (!tb) return;
    const newValue = tb[property];
    if (oldValue !== newValue) {
      if ((property === 'w' || property === 'h') && oldBounds) {
        history.push(createResizeTextBoxCmd(state.textBoxes, state.selectedTextBoxes, _refreshSidePanel, tbId,
          { x: oldBounds.x, y: oldBounds.y, w: oldBounds.w, h: oldBounds.h },
          { x: tb.x, y: tb.y, w: tb.w, h: tb.h }));
      } else {
        history.push(createTextBoxPropertyChangeCmd(state.textBoxes, state.selectedTextBoxes, _refreshSidePanel, tbId, property, oldValue, newValue));
      }
    }
    return;
  }

  if (type === 'arrow') {
    const arrow = state.arrows.find(a => a.id === arrowId);
    if (!arrow) return;
    const newValue = arrow[property];
    if (oldValue !== newValue) {
      history.push(createArrowPropertyChangeCmd(state.arrows, state.selectedArrows, _refreshSidePanel, arrowId, property, oldValue, newValue));
    }
    return;
  }

  if (type === 'connection') {
    const conn = state.connections.find(c => c.id === connId);
    if (!conn) return;
    const newValue = conn[property];
    if (oldValue !== newValue) {
      history.push(createConnectionPropertyChangeCmd(state.connections, state.selectedConnection, _refreshSidePanel, connId, property, oldValue, newValue));
    }
    return;
  }

  const found = state.findNodeById(state.nodes, nodeId);
  if (!found) return;
  const newValue = found.node[property];
  if (oldValue !== newValue) {
    if ((property === 'w' || property === 'h') && oldBounds) {
      history.push(createResizeNodeCmd(state.nodes, state.selected, _refreshSidePanel, nodeId,
        { x: oldBounds.x, y: oldBounds.y, w: oldBounds.w, h: oldBounds.h },
        { x: found.node.x, y: found.node.y, w: found.node.w, h: found.node.h }));
    } else {
      history.push(createPropertyChangeCmd(state.nodes, state.selected, _refreshSidePanel, nodeId, property, oldValue, newValue));
    }
  }
}

export function startPanelEdit(nodeId, property, oldValue, oldBounds) {
  flushPanelEdit();
  state.panelPendingEdit = { nodeId, property, oldValue, oldBounds: oldBounds || null };
}

export function startShapePanelEdit(shapeId, property, oldValue, oldBounds) {
  flushPanelEdit();
  state.panelPendingEdit = { type: 'shape', shapeId, property, oldValue, oldBounds: oldBounds || null };
}

export function startTextBoxPanelEdit(tbId, property, oldValue, oldBounds) {
  flushPanelEdit();
  state.panelPendingEdit = { type: 'textBox', tbId, property, oldValue, oldBounds: oldBounds || null };
}

export function startArrowPanelEdit(arrowId, property, oldValue) {
  flushPanelEdit();
  state.panelPendingEdit = { type: 'arrow', arrowId, property, oldValue };
}

export function startConnectionPanelEdit(connId, property, oldValue) {
  flushPanelEdit();
  state.panelPendingEdit = { type: 'connection', connId, property, oldValue };
}

export function performUndo() {
  flushPanelEdit();
  history.undo();
  state.markDrawOrderDirty();
  state.reparentAll();
}

export function performRedo() {
  flushPanelEdit();
  history.redo();
  state.markDrawOrderDirty();
  state.reparentAll();
}
