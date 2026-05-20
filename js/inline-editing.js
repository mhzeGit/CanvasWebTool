import { state } from './state.js';
import { screenToWorld } from './utils.js';
import { hitTestConnection } from './connections.js';
import { createPropertyChangeCmd } from './undo.js';
import { refreshSidePanel } from './side-panel.js';
import { history, performUndo, performRedo } from './history.js';
import { getEntityElement } from './dom-entities.js';
import { createEditor, emptyDoc } from './editor/editor-core.js';
import { tiptapToMarkdown } from './editor/editor-serialization.js';
import { migrateEntityToTiptap } from './editor/editor-content-bridge.js';

export function setupInlineEditing() {
  state.canvas.addEventListener('dblclick', onDblClick);
}

export function commitEditing() {
  if (!state.editingState) return;
  const es = state.editingState;
  removeHandlers(es);

  const { type, idx, field, originalValue, isRichText } = es;

  if (type === 'connection') {
    state.connections[idx].text = es.el.value;
    try { document.body.removeChild(es.el); } catch (_) {}
    state.editingState = null;
    refreshSidePanel();
    return;
  }

  if (isRichText) {
    const tb = state.textBoxes[idx];

    if (es.editor && !es.editor.isDestroyed) {
      const content = es.editor.getJSON();
      tb.content = content;
      tb.text = tiptapToMarkdown(content);
      tb.blocks = null;

      if (es.lastCommittedValue !== tb.text && originalValue !== tb.text && tb.id !== undefined) {
        history.push(createPropertyChangeCmd(
          state.textBoxes, state.selectedTextBoxes, refreshSidePanel,
          tb.id, field, es.lastCommittedValue, tb.text
        ));
      }

      es.editor.setEditable(false);
    }

    es.el.contentEditable = 'false';
    state.editingState = null;
    refreshSidePanel();
    return;
  }

  if (type === 'textBox') {
    const tb = state.textBoxes[idx];
    const newValue = es.el.textContent || '';
    tb[field] = newValue;
    if (originalValue !== newValue && tb.id !== undefined) {
      history.push(createPropertyChangeCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, tb.id, field, originalValue, newValue));
    }
  }

  es.el.contentEditable = 'false';
  state.editingState = null;
  refreshSidePanel();
}

export function cancelEditing() {
  if (!state.editingState) return;
  const es = state.editingState;
  removeHandlers(es);

  const { type, idx, field, originalValue, isRichText } = es;

  if (type === 'connection') {
    state.connections[idx].text = originalValue;
    try { document.body.removeChild(es.el); } catch (_) {}
    state.editingState = null;
    refreshSidePanel();
    return;
  }

  if (isRichText) {
    const tb = state.textBoxes[idx];
    tb.text = originalValue;
    tb.blocks = null;
    tb.content = null;
    if (es.editor && !es.editor.isDestroyed) {
      migrateEntityToTiptap(tb);
      es.editor.commands.setContent(tb.content || { ...emptyDoc }, { emitUpdate: false });
      es.editor.setEditable(false);
    }
  } else {
    if (type === 'textBox') {
      state.textBoxes[idx][field] = originalValue;
    }
  }

  es.el.contentEditable = 'false';
  state.editingState = null;
  refreshSidePanel();
}

function onDblClick(e) {
  const rect = state.canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const world = screenToWorld(sx, sy, state.offsetX, state.offsetY, state.scale);

  const topHit = state.getTopHitAt(world.x, world.y);
  if (topHit && topHit.type === 'textBox') {
    const tbHit = topHit.i;
    state.selected.clear();
    state.selectedConnection = null;
    state.selectedArrows.clear();
    state.selectedShapes.clear();
    state.selectedConnectors.clear();
    state.selectedTextBoxes.clear();
    state.selectedTextBoxes.add(tbHit);

    const tb = state.textBoxes[tbHit];
    if (tb.title && tb.title.length > 0) {
      const padding = 8;
      const titleFont = `bold ${15}px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif`;
      const titleLineHeight = 18;
      const maxTitleWidth = Math.max(0, tb.w - padding * 2);
      const titleLines = wrapTextLines(state.ctx, titleFont, tb.title, maxTitleWidth);
      const titleH = Math.min(tb.h / 3, Math.max(24, titleLines.length * titleLineHeight + padding * 2));
      if (world.y >= tb.y && world.y <= tb.y + titleH) {
        startTitleEditing(tbHit, e.clientX, e.clientY);
        return;
      }
    }
    startBodyEditing(tbHit, e.clientX, e.clientY);
    return;
  }

  const connHit = hitTestConnection(world.x, world.y);
  if (connHit !== null) {
    state.selected.clear();
    state.selectedTextBoxes.clear();
    state.selectedArrows.clear();
    state.selectedShapes.clear();
    state.selectedConnectors.clear();
    state.selectedConnection = connHit;
    startConnectionEditing(connHit);
  }
}

function wrapTextLines(ctx, font, text, maxWidth) {
  ctx.save();
  ctx.font = font;
  const words = (text || '').split(/\s+/);
  const lines = [];
  let current = '';
  for (let i = 0; i < words.length; i++) {
    const candidate = current ? current + ' ' + words[i] : words[i];
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current); else lines.push(words[i]);
      current = '';
    }
  }
  if (current) lines.push(current);
  ctx.restore();
  return lines;
}

function startTitleEditing(tbIdx, clickX, clickY) {
  cancelEditing();

  const tb = state.textBoxes[tbIdx];
  const el = getEntityElement('textBox', tbIdx);
  if (!el) return;

  const titlebar = el.querySelector('.entity-textbox-titlebar');
  if (!titlebar) return;

  titlebar.contentEditable = 'true';
  titlebar.spellcheck = true;
  titlebar.textContent = tb.title || '';
  titlebar.focus();
  if (clickX !== undefined && clickY !== undefined) {
    const range = document.caretRangeFromPoint(clickX, clickY);
    if (range) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      placeCursorAtEnd(titlebar);
    }
  } else {
    placeCursorAtEnd(titlebar);
  }

  const originalValue = tb.title;

  const onInput = () => {
    tb.title = titlebar.textContent || '';
  };

  const onKeyDown = (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      commitEditing();
    } else if (ev.key === 'Escape') {
      cancelEditing();
    }
  };

  const onBlur = () => {
    setTimeout(() => {
      const entity = getEntityElement('textBox', tbIdx);
      if (entity && entity.contains(document.activeElement)) return;
      commitEditing();
    }, 0);
  };

  titlebar.addEventListener('input', onInput);
  titlebar.addEventListener('keydown', onKeyDown);
  titlebar.addEventListener('blur', onBlur);

  state.editingState = {
    type: 'textBox', idx: tbIdx, field: 'title',
    el: titlebar, originalValue, isRichText: false,
    _handlers: { onInput, onKeyDown, onBlur }
  };
}

function startBodyEditing(tbIdx, clickX, clickY) {
  cancelEditing();

  const tb = state.textBoxes[tbIdx];
  const el = getEntityElement('textBox', tbIdx);
  if (!el) return;

  const content = el.querySelector('.entity-textbox-content');
  if (!content) return;

  const originalValue = tb.text;
  let lastCommittedValue = originalValue;
  let initializing = true;

  const onUpdate = ({ editor: ed }) => {
    if (initializing) return;
    const doc = ed.getJSON();
    tb.content = doc;
    tb.text = tiptapToMarkdown(doc);
    tb.blocks = null;

    if (lastCommittedValue !== tb.text) {
      const oldVal = lastCommittedValue;
      lastCommittedValue = tb.text;
      if (state.editingState) {
        state.editingState.lastCommittedValue = tb.text;
      }
      history.push(createPropertyChangeCmd(
        state.textBoxes, state.selectedTextBoxes, refreshSidePanel,
        tb.id, 'text', oldVal, tb.text
      ));
    }
  };

  const onBlur = ({ editor: ed }) => {
    setTimeout(() => {
      if (!state.editingState || state.editingState.editor !== ed) return;
      const tbIdx = state.editingState.idx;
      const entity = getEntityElement('textBox', tbIdx);
      if (entity && entity.contains(document.activeElement)) return;
      commitEditing();
    }, 0);
  };

  let editor;

  if (content._tiptapEditor && !content._tiptapEditor.isDestroyed) {
    editor = content._tiptapEditor;
    editor.setEditable(true);
    editor.on('update', onUpdate);
    editor.on('blur', onBlur);
  } else {
    migrateEntityToTiptap(tb);
    content.innerHTML = '';

    editor = createEditor({
      element: content,
      content: tb.content || { ...emptyDoc },
      editable: true,
      excludeHistory: true,
      onUpdate,
      onBlur,
    });

    content._tiptapEditor = editor;
  }

  const onKeyDown = (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      cancelEditing();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.shiftKey) {
        performRedo();
      } else {
        performUndo();
      }
      const tb = state.textBoxes[tbIdx];
      if (tb.content && tb.content.type === 'doc') {
        editor.commands.setContent(tb.content);
      }
    }
  };

  content.addEventListener('keydown', onKeyDown);

  if (clickX !== undefined && clickY !== undefined) {
    requestAnimationFrame(() => {
      if (editor && editor.view) {
        const pos = editor.view.posAtCoords({ left: clickX, top: clickY });
        if (pos && pos.pos !== null) {
          editor.commands.focus(pos.pos);
        } else {
          editor.commands.focus('end');
        }
      }
    });
  } else {
    editor.commands.focus('end');
  }

  initializing = false;

  state.editingState = {
    type: 'textBox', idx: tbIdx, field: 'text',
    el: content, originalValue, lastCommittedValue, isRichText: true,
    editor,
    _handlers: { onKeyDown, _onUpdate: onUpdate, _onBlur: onBlur }
  };
}

function startConnectionEditing(connIdx) {
  cancelEditing();

  const conn = state.connections[connIdx];
  const fromTb = state.textBoxes[conn.from];
  const toTb = state.textBoxes[conn.to];
  if (!fromTb || !toTb) return;

  const toCenterX = toTb.x + toTb.w / 2;
  const toCenterY = toTb.y + toTb.h / 2;
  const fromPt = getNodeEdgePoint(fromTb, toCenterX, toCenterY);
  const fromCenterX = fromTb.x + fromTb.w / 2;
  const fromCenterY = fromTb.y + fromTb.h / 2;
  const toPt = getNodeEdgePoint(toTb, fromCenterX, fromCenterY);
  const dx = toPt.x - fromPt.x;
  const dy = toPt.y - fromPt.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const cpDist = Math.min(dist * 0.5, 80);

  let cp1x = fromPt.x, cp1y = fromPt.y;
  let cp2x = toPt.x, cp2y = toPt.y;
  switch (fromPt.side) {
    case 'right': cp1x += cpDist; break;
    case 'left': cp1x -= cpDist; break;
    case 'bottom': cp1y += cpDist; break;
    case 'top': cp1y -= cpDist; break;
  }
  switch (toPt.side) {
    case 'right': cp2x += cpDist; break;
    case 'left': cp2x -= cpDist; break;
    case 'bottom': cp2y += cpDist; break;
    case 'top': cp2y -= cpDist; break;
  }

  const mid = getPointOnBezier(fromPt.x, fromPt.y, cp1x, cp1y, cp2x, cp2y, toPt.x, toPt.y, 0.5);

  const canvasRect = state.canvas.getBoundingClientRect();
  const screen = worldToScreen(mid.x, mid.y, state.offsetX, state.offsetY, state.scale);

  const el = document.createElement('input');
  el.className = 'inline-editor inline-editor-conn-text';
  el.value = conn.text || '';
  el.style.position = 'fixed';
  el.style.left = (screen.x + canvasRect.left) + 'px';
  el.style.top = (screen.y + canvasRect.top) + 'px';
  el.style.minWidth = '80px';
  el.style.transform = 'translate(-50%, -50%)';
  el.style.zIndex = '9999';
  el.style.background = 'rgba(0,0,0,0.85)';
  el.style.color = '#fff';
  el.style.fontSize = (13 * state.scale) + 'px';
  el.style.fontWeight = 'bold';
  el.style.textAlign = 'center';
  el.style.border = '1px solid #f0c800';
  el.style.borderRadius = (4 * state.scale) + 'px';
  el.style.padding = (2 * state.scale) + 'px ' + (6 * state.scale) + 'px';
  el.style.outline = 'none';

  document.body.appendChild(el);
  el.focus();
  el.select();

  const originalValue = conn.text;

  const onBlur = () => { commitEditing(); };
  const onKeyDown = (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); }
    else if (ev.key === 'Escape') { cancelEditing(); }
  };

  el.addEventListener('blur', onBlur);
  el.addEventListener('keydown', onKeyDown);

  state.editingState = {
    type: 'connection', idx: connIdx, el, originalValue,
    _handlers: { onBlur, onKeyDown }
  };
}

function getNodeEdgePoint(node, targetX, targetY) {
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  const dx = targetX - cx;
  const dy = targetY - cy;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return { x: cx, y: cy };
  const hw = node.w / 2;
  const hh = node.h / 2;
  if (dx !== 0) {
    const t = dx > 0 ? hw / dx : -hw / dx;
    const yAtEdge = cy + dy * t;
    if (yAtEdge >= node.y && yAtEdge <= node.y + node.h) {
      const side = dx > 0 ? 'right' : 'left';
      return { x: cx + (dx > 0 ? hw : -hw), y: yAtEdge, side };
    }
  }
  const t = dy > 0 ? hh / dy : -hh / dy;
  const xAtEdge = cx + dx * t;
  const side = dy > 0 ? 'bottom' : 'top';
  return { x: xAtEdge, y: cy + (dy > 0 ? hh : -hh), side };
}

function getPointOnBezier(x1, y1, cx1, cy1, cx2, cy2, x2, y2, t) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * x1 + 3 * mt2 * t * cx1 + 3 * mt * t2 * cx2 + t2 * t * x2,
    y: mt2 * mt * y1 + 3 * mt2 * t * cy1 + 3 * mt * t2 * cy2 + t2 * t * y2,
  };
}

function worldToScreen(wx, wy, offsetX, offsetY, scale) {
  return { x: wx * scale + offsetX, y: wy * scale + offsetY };
}

function placeCursorAtEnd(el) {
  const range = document.createRange();
  if (el.lastChild) {
    range.setStartAfter(el.lastChild);
  } else {
    range.setStart(el, 0);
  }
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function removeHandlers(es) {
  if (!es._handlers) return;
  const el = es.el;
  if (es._handlers.onInput) el.removeEventListener('input', es._handlers.onInput);
  if (es._handlers.onKeyDown) el.removeEventListener('keydown', es._handlers.onKeyDown);
  if (es._handlers.onPaste) el.removeEventListener('paste', es._handlers.onPaste);
  if (es._handlers.onBlur) el.removeEventListener('blur', es._handlers.onBlur);
  if (es._handlers.onClick) el.removeEventListener('click', es._handlers.onClick);
  if (es.editor && es.editor.off) {
    es.editor.off('update');
    es.editor.off('blur');
  }
}
