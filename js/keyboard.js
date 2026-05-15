import { state } from './state.js';
import { screenToWorld } from './utils.js';
import { history, performUndo, performRedo, flushPanelEdit } from './history.js';
import { refreshSidePanel } from './side-panel.js';
import { cancelEditing } from './inline-editing.js';
import { closeContextMenu } from './context-menu.js';
import {
  deleteSelectedNodes, deleteSelectedShapes, deleteSelectedTextBoxes, deleteSelectedConnectors,
  deleteSelectedArrows, deleteConnection,
  duplicateSelectedNodes, copySelectedNodes, pasteNodesAt,
  saveDocument,
} from './document.js';

export function setupKeyboard() {
  window.addEventListener('keydown', onKeyDown);
}

function handleMarkdownShortcut(e) {
  const el = document.activeElement;
  if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return false;
  if (el.isContentEditable) return false;

  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) return false;

  let wrapper = null;
  if (e.key.toLowerCase() === 'b') {
    wrapper = '**';
  } else if (e.key.toLowerCase() === 'i') {
    wrapper = '*';
  } else if (e.shiftKey && e.key.toLowerCase() === 'x') {
    wrapper = '~~';
  } else if (e.key.toLowerCase() === 'e') {
    wrapper = '`';
  } else {
    return false;
  }

  e.preventDefault();
  wrapSelection(el, wrapper);
  return true;
}

function wrapSelection(el, wrapper) {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const text = el.value;
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  const after = text.slice(end);

  const replacement = selected.length > 0 ? wrapper + selected + wrapper : wrapper + wrapper;
  el.value = before + replacement + after;

  const cursorPos = selected.length > 0
    ? start + replacement.length
    : start + wrapper.length;
  el.setSelectionRange(cursorPos, cursorPos);

  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function onKeyDown(e) {
  const active = document.activeElement;
  const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);

  if (isInput && handleMarkdownShortcut(e)) {
    return;
  }

  if (state.editingState) {
    if (e.key === 'Escape') {
      cancelEditing();
      e.preventDefault();
    }
    return;
  }

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
    if (state.selectedShapes.size > 0) {
      deleteSelectedShapes();
      e.preventDefault();
      return;
    }
    if (state.selectedTextBoxes.size > 0) {
      deleteSelectedTextBoxes();
      e.preventDefault();
      return;
    }
    if (state.selectedConnectors.size > 0) {
      deleteSelectedConnectors();
      e.preventDefault();
      return;
    }
    if (state.selectedArrows.size > 0) {
      deleteSelectedArrows();
      e.preventDefault();
      return;
    }
    if (state.selectedConnection !== null) {
      deleteConnection(state.selectedConnection);
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
    if (state.drawingTool) {
      state.drawingTool = null;
      state.drawingStartX = 0;
      state.drawingStartY = 0;
      return;
    }
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

window.addEventListener('keydown', (e) => {
  if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
    const active = document.activeElement;
    const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
    if (isInput) return;
    e.preventDefault();
    saveDocument();
  }
});
