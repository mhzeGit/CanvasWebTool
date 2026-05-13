import { createHistoryManager, createResizeNodeCmd, createPropertyChangeCmd } from './undo.js';
import { state } from './state.js';

export const history = createHistoryManager();

let _refreshSidePanel = null;

export function initHistory(refreshSidePanel) {
  _refreshSidePanel = refreshSidePanel;
}

export function flushPanelEdit() {
  if (!state.panelPendingEdit) return;
  const { nodeId, property, oldValue, oldBounds } = state.panelPendingEdit;
  state.panelPendingEdit = null;
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

export function performUndo() {
  flushPanelEdit();
  history.undo();
  state.markDrawOrderDirty();
  for (let i = 0; i < state.nodes.length; i++) {
    state.checkAndUpdateParenting(i);
  }
}

export function performRedo() {
  flushPanelEdit();
  history.redo();
  state.markDrawOrderDirty();
  for (let i = 0; i < state.nodes.length; i++) {
    state.checkAndUpdateParenting(i);
  }
}
