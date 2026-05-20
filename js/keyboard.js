import { state } from './state.js';
import { screenToWorld } from './utils.js';
import { history, performUndo, performRedo, flushPanelEdit, startShapePanelEdit, startTextBoxPanelEdit, startArrowPanelEdit, startConnectionPanelEdit } from './history.js';
import { refreshSidePanel } from './side-panel.js';
import { cancelEditing } from './inline-editing.js';
import { closeContextMenu } from './context-menu.js';
import {
  deleteSelectedNodes, deleteSelectedShapes, deleteSelectedTextBoxes, deleteSelectedConnectors,
  deleteSelectedArrows, deleteConnection,
  duplicateSelectedNodes, copySelectedNodes, pasteNodesAt,
  removeImageFromShape, saveDocument, saveDocumentAs,
} from './document.js';
import {
  createMoveShapesCmd, createMoveTextBoxesCmd, createMoveConnectorsCmd, createMoveArrowEndCmd, createBatchCmd,
} from './undo.js';
import { getSnapIncrement } from './snap.js';
import { focusOnSelected, focusOnAll } from './focus.js';

let fKeyTimer = null;

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
  if (!isInput && (e.key.startsWith('Arrow'))) {
    if (state.drawingTool || state.connectingFrom !== null) return;
    if (state.selectedShapes.size === 0 && state.selectedTextBoxes.size === 0 &&
        state.selectedConnectors.size === 0 && state.selectedArrows.size === 0) return;
    e.preventDefault();
    const inc = e.shiftKey ? 1 : getSnapIncrement(state.scale);
    switch (e.key) {
      case 'ArrowUp': nudgeSelected(0, -inc); break;
      case 'ArrowDown': nudgeSelected(0, inc); break;
      case 'ArrowLeft': nudgeSelected(-inc, 0); break;
      case 'ArrowRight': nudgeSelected(inc, 0); break;
    }
    return;
  }
  if (!isInput && (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'c')) {
    if (state.hoveredPropField) {
      copyHoveredProp();
      e.preventDefault();
      return;
    }
    copySelectedNodes();
    e.preventDefault();
  }
  if (!isInput && (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'v')) {
    if (state.hoveredPropField && state.propertyClipboard) {
      pasteHoveredProp();
      e.preventDefault();
      return;
    }
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
  if (!isInput && e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    if (fKeyTimer) {
      clearTimeout(fKeyTimer);
      fKeyTimer = null;
      focusOnAll();
    } else {
      fKeyTimer = setTimeout(() => {
        fKeyTimer = null;
        focusOnSelected();
      }, 300);
    }
    return;
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

function nudgeSelected(dx, dy) {
  const movedIds = new Set();
  const shapeMoves = [];
  const tbMoves = [];
  const connectorMoves = [];
  const arrowMoves = [];

  function addChildren(parentId, parentType) {
    for (let i = 0; i < state.shapes.length; i++) {
      const s = state.shapes[i];
      if (s.parentId === parentId && s.parentType === parentType && !movedIds.has(`s:${s.id}`)) {
        movedIds.add(`s:${s.id}`);
        shapeMoves.push({ id: s.id, fromX: s.x, fromY: s.y, toX: s.x + dx, toY: s.y + dy });
        addChildren(s.id, 'shape');
      }
    }
    for (let i = 0; i < state.textBoxes.length; i++) {
      const tb = state.textBoxes[i];
      if (tb.parentId === parentId && tb.parentType === parentType && !movedIds.has(`tb:${tb.id}`)) {
        movedIds.add(`tb:${tb.id}`);
        tbMoves.push({ id: tb.id, fromX: tb.x, fromY: tb.y, toX: tb.x + dx, toY: tb.y + dy });
        addChildren(tb.id, 'textBox');
      }
    }
  }

  for (const idx of state.selectedShapes) {
    const s = state.shapes[idx];
    if (!s || movedIds.has(`s:${s.id}`)) continue;
    movedIds.add(`s:${s.id}`);
    shapeMoves.push({ id: s.id, fromX: s.x, fromY: s.y, toX: s.x + dx, toY: s.y + dy });
    addChildren(s.id, 'shape');
  }

  for (const idx of state.selectedTextBoxes) {
    const tb = state.textBoxes[idx];
    if (!tb || movedIds.has(`tb:${tb.id}`)) continue;
    movedIds.add(`tb:${tb.id}`);
    tbMoves.push({ id: tb.id, fromX: tb.x, fromY: tb.y, toX: tb.x + dx, toY: tb.y + dy });
    addChildren(tb.id, 'textBox');
  }

  for (const idx of state.selectedConnectors) {
    const c = state.connectors[idx];
    if (!c || movedIds.has(`c:${c.id}`)) continue;
    movedIds.add(`c:${c.id}`);
    connectorMoves.push({
      id: c.id,
      fromX1: c.x1, fromY1: c.y1, fromX2: c.x2, fromY2: c.y2,
      toX1: c.x1 + dx, toY1: c.y1 + dy, toX2: c.x2 + dx, toY2: c.y2 + dy,
    });
  }

  for (const idx of state.selectedArrows) {
    const a = state.arrows[idx];
    if (!a || a.connectedFrom !== null || a.connectedTo !== null) continue;
    if (movedIds.has(`a:${a.id}`)) continue;
    movedIds.add(`a:${a.id}`);
    arrowMoves.push({
      idx,
      fromState: {
        x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2,
        connectedFrom: a.connectedFrom, connectedTo: a.connectedTo,
        connectedFromType: a.connectedFromType, connectedToType: a.connectedToType,
      },
      toState: {
        x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy,
        connectedFrom: a.connectedFrom, connectedTo: a.connectedTo,
        connectedFromType: a.connectedFromType, connectedToType: a.connectedToType,
      },
    });
  }

  const cmds = [];
  if (shapeMoves.length > 0) {
    for (const m of shapeMoves) {
      const s = state.shapes.find(sh => sh.id === m.id);
      if (s) { s.x = m.toX; s.y = m.toY; }
    }
    cmds.push(createMoveShapesCmd(state.shapes, state.selectedShapes, refreshSidePanel, shapeMoves));
  }
  if (tbMoves.length > 0) {
    for (const m of tbMoves) {
      const tb = state.textBoxes.find(t => t.id === m.id);
      if (tb) { tb.x = m.toX; tb.y = m.toY; }
    }
    cmds.push(createMoveTextBoxesCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, tbMoves));
  }
  if (connectorMoves.length > 0) {
    for (const m of connectorMoves) {
      const c = state.connectors.find(co => co.id === m.id);
      if (c) { c.x1 = m.toX1; c.y1 = m.toY1; c.x2 = m.toX2; c.y2 = m.toY2; }
    }
    cmds.push(createMoveConnectorsCmd(state.connectors, state.selectedConnectors, connectorMoves));
  }
  for (const m of arrowMoves) {
    const a = state.arrows[m.idx];
    if (a) { a.x1 = m.toState.x1; a.y1 = m.toState.y1; a.x2 = m.toState.x2; a.y2 = m.toState.y2; }
    cmds.push(createMoveArrowEndCmd(state.arrows, m.idx, m.fromState, m.toState));
  }

  if (cmds.length === 1) {
    history.push(cmds[0]);
  } else if (cmds.length > 1) {
    history.push(createBatchCmd(cmds, 'Nudge Items'));
  }

  state.markDrawOrderDirty();
  state.reparentAll();
  refreshSidePanel();
}

function copyHoveredProp() {
  const f = state.hoveredPropField;
  if (!f) return;
  const entities = f.entityType === 'shape' ? state.shapes
    : f.entityType === 'textBox' ? state.textBoxes
    : f.entityType === 'arrow' ? state.arrows
    : f.entityType === 'connection' ? state.connections
    : null;
  const indices = f.entityType === 'shape' ? Array.from(state.selectedShapes)
    : f.entityType === 'textBox' ? Array.from(state.selectedTextBoxes)
    : f.entityType === 'arrow' ? Array.from(state.selectedArrows)
    : f.entityType === 'connection' ? (state.selectedConnection !== null ? [state.selectedConnection] : [])
    : [];
  if (!entities || indices.length === 0) return;
  state.propertyClipboard = { value: entities[indices[0]][f.propKey], entityType: f.entityType, propKey: f.propKey };
}

function pasteHoveredProp() {
  const f = state.hoveredPropField;
  if (!f || !state.propertyClipboard) return;
  const entities = f.entityType === 'shape' ? state.shapes
    : f.entityType === 'textBox' ? state.textBoxes
    : f.entityType === 'arrow' ? state.arrows
    : f.entityType === 'connection' ? state.connections
    : null;
  const indices = f.entityType === 'shape' ? Array.from(state.selectedShapes)
    : f.entityType === 'textBox' ? Array.from(state.selectedTextBoxes)
    : f.entityType === 'arrow' ? Array.from(state.selectedArrows)
    : f.entityType === 'connection' ? (state.selectedConnection !== null ? [state.selectedConnection] : [])
    : [];
  if (!entities || indices.length === 0) return;
  const oldVal = entities[indices[0]][f.propKey];
  const newVal = state.propertyClipboard.value;
  if (oldVal === newVal) return;
  const firstId = entities[indices[0]].id;
  if (f.entityType === 'shape') startShapePanelEdit(firstId, f.propKey, oldVal);
  else if (f.entityType === 'textBox') startTextBoxPanelEdit(firstId, f.propKey, oldVal);
  else if (f.entityType === 'arrow') startArrowPanelEdit(firstId, f.propKey, oldVal);
  else if (f.entityType === 'connection') startConnectionPanelEdit(firstId, f.propKey, oldVal);
  for (const idx of indices) entities[idx][f.propKey] = newVal;
  flushPanelEdit();
  refreshSidePanel();
}

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    const active = document.activeElement;
    const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
    if (isInput) return;
    e.preventDefault();
    if (e.shiftKey) {
      saveDocumentAs();
    } else {
      saveDocument();
    }
  }
});
