import { createHistoryManager, createResizeNodeCmd, createPropertyChangeCmd, createResizeShapeCmd, createShapePropertyChangeCmd } from './undo.js';
import { state } from './state.js';

export const history = createHistoryManager();

let _refreshSidePanel = null;

export function initHistory(refreshSidePanel) {
  _refreshSidePanel = refreshSidePanel;
}

export function flushPanelEdit() {
  if (!state.panelPendingEdit) return;
  const { type, nodeId, shapeId, property, oldValue, oldBounds } = state.panelPendingEdit;
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
