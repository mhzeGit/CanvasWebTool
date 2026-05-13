import { state } from './state.js';
import { screenToWorld } from './utils.js';
import { history, performUndo, performRedo, flushPanelEdit } from './history.js';
import { refreshSidePanel } from './side-panel.js';
import { cancelEditing } from './inline-editing.js';
import { closeContextMenu } from './context-menu.js';
import { deleteArrowFn } from './pointer.js';
import {
  deleteSelectedNodes, duplicateSelectedNodes, copySelectedNodes, pasteNodesAt,
  saveDocument,
} from './document.js';

export function setupKeyboard() {
  window.addEventListener('keydown', onKeyDown);
}

function onKeyDown(e) {
  if (state.editingState) {
    if (e.key === 'Escape') {
      cancelEditing();
      e.preventDefault();
    }
    return;
  }

  const active = document.activeElement;
  const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');

  if (!isInput && (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key.toLowerCase() === 'z')) {
    performUndo();
    e.preventDefault();
    return;
  }
  if (!isInput && (e.ctrlKey || e.metaKey) && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y')) {
    performRedo();
    e.preventDefault();
    return;
  }
  if (!isInput && (e.key === 'Delete' || e.key === 'Backspace')) {
    if (state.selectedArrows.size > 0) {
      for (const ai of state.selectedArrows) deleteArrowFn(ai);
      state.selectedArrows.clear();
      state.arrowDragTarget = null;
      refreshSidePanel();
      e.preventDefault();
      return;
    }
    if (state.selectedConnection !== null) {
      state.connections.splice(state.selectedConnection, 1);
      state.selectedConnection = null;
      refreshSidePanel();
      e.preventDefault();
      return;
    }
    deleteSelectedNodes();
    e.preventDefault();
  }
  if (!isInput && (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'c')) {
    copySelectedNodes();
    e.preventDefault();
  }
  if (!isInput && (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'v')) {
    const rect = state.canvas.getBoundingClientRect();
    const mx = window._lastMouseX ?? rect.width / 2;
    const my = window._lastMouseY ?? rect.height / 2;
    const world = screenToWorld(mx, my, state.offsetX, state.offsetY, state.scale);
    pasteNodesAt(world.x, world.y);
    e.preventDefault();
  }
  if (!isInput && (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'd')) {
    duplicateSelectedNodes();
    e.preventDefault();
  }
  if (!isInput && e.key === 'Escape') {
    if (state.connectingFrom !== null) {
      state.connectingFrom = null;
      return;
    }
    closeContextMenu();
    if (state.isDraggingArrowBody) {
      state.isDraggingArrowBody = false;
      state.dragArrowBodySnapshots = [];
      state.dragArrowBodyStartWorld = null;
    }
    if (state.selectedArrows.size > 0 || state.arrowDragTarget !== null) {
      state.selectedArrows.clear();
      state.arrowDragTarget = null;
      refreshSidePanel();
      return;
    }
    if (state.selectedConnection !== null) {
      state.selectedConnection = null;
      refreshSidePanel();
    }
  }
}

// Ctrl+S shortcut
window.addEventListener('keydown', (e) => {
  if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
    const active = document.activeElement;
    const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
    if (isInput) return;
    e.preventDefault();
    saveDocument();
  }
});
