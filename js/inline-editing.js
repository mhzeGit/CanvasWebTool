import { state } from './state.js';
import { screenToWorld, worldToScreen, getNodeEdgePoint, getPointOnBezier, wrapTextLines } from './utils.js';
import { hitTestTextBox } from './textboxes.js';
import { hitTestConnection } from './connections.js';
import { createPropertyChangeCmd } from './undo.js';
import { refreshSidePanel } from './side-panel.js';
import { history, performUndo, performRedo } from './history.js';
import { blocksToHtml, htmlToBlocks, blocksToMarkdown, getOrCreateBlocks } from './rich-text.js';
import { getEntityElement } from './dom-entities.js';

// ── Public API ──

export function setupInlineEditing() {
  state.canvas.addEventListener('dblclick', onDblClick);
}

export function commitEditing() {
  if (!state.editingState) return;
  const es = state.editingState;

  removeHandlers(es);
  const { type, idx, field, el, originalValue, isRichText } = es;

  if (type === 'connection') {
    state.connections[idx].text = el.value;
    try { document.body.removeChild(el); } catch (_) {}
    state.editingState = null;
    refreshSidePanel();
    return;
  }

  if (isRichText) {
    const newBlocks = htmlToBlocks(el);
    const newText = blocksToMarkdown(newBlocks);
    const tb = state.textBoxes[idx];
    tb.text = newText;
    tb.blocks = newBlocks;

    if (es.lastCommittedValue !== newText && originalValue !== newText && tb.id !== undefined) {
      history.push(createPropertyChangeCmd(
        state.textBoxes, state.selectedTextBoxes, refreshSidePanel,
        tb.id, field, es.lastCommittedValue, newText
      ));
    }
  } else {
    if (type === 'textBox') {
      const tb = state.textBoxes[idx];
      const newValue = el.textContent || '';
      tb[field] = newValue;
      if (originalValue !== newValue && tb.id !== undefined) {
        history.push(createPropertyChangeCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, tb.id, field, originalValue, newValue));
      }
    }
  }

  el.contentEditable = 'false';
  state.editingState = null;
  refreshSidePanel();
}

export function cancelEditing() {
  if (!state.editingState) return;
  const es = state.editingState;
  removeHandlers(es);
  const { type, idx, field, el, originalValue, isRichText } = es;

  if (type === 'connection') {
    state.connections[idx].text = originalValue;
    try { document.body.removeChild(el); } catch (_) {}
    state.editingState = null;
    refreshSidePanel();
    return;
  }

  if (isRichText) {
    const tb = state.textBoxes[idx];
    tb.text = originalValue;
    tb.blocks = null;
  } else {
    if (type === 'textBox') {
      state.textBoxes[idx][field] = originalValue;
    }
  }

  el.contentEditable = 'false';
  state.editingState = null;
  refreshSidePanel();
}

// ── Double-click entry point ──

function onDblClick(e) {
  const rect = state.canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const world = screenToWorld(sx, sy, state.offsetX, state.offsetY, state.scale);

  const tbHit = hitTestTextBox(world.x, world.y);
  if (tbHit !== -1) {
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
        startTitleEditing(tbHit);
        return;
      }
    }
    startBodyEditing(tbHit);
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

// ── Title editing ──

function startTitleEditing(tbIdx) {
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
  placeCursorAtEnd(titlebar);

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
      if (!titlebar.contains(document.activeElement)) commitEditing();
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

// ── Body editing ──

function startBodyEditing(tbIdx) {
  cancelEditing();

  const tb = state.textBoxes[tbIdx];
  const el = getEntityElement('textBox', tbIdx);
  if (!el) return;

  const content = el.querySelector('.entity-textbox-content');
  if (!content) return;

  getOrCreateBlocks(tb);

  content.contentEditable = 'true';
  content.spellcheck = true;
  content.innerHTML = blocksToHtml(tb.blocks) || '<div class="rt-block rt-paragraph"><br></div>';
  patchEmptyBlocks(content);
  content.focus();

  const lastBlock = content.querySelector('.rt-block:last-of-type');
  placeCursorAtEndSafe(lastBlock || content);

  const originalValue = tb.text;
  let lastCommittedValue = originalValue;

  state.editingState = {
    type: 'textBox', idx: tbIdx, field: 'text',
    el: content, originalValue, lastCommittedValue, isRichText: true
  };

  const syncAndPushUndo = () => {
    const newBlocks = htmlToBlocks(content);
    tb.blocks = newBlocks;
    tb.text = blocksToMarkdown(newBlocks);
    if (lastCommittedValue !== tb.text) {
      const oldVal = lastCommittedValue;
      lastCommittedValue = tb.text;
      state.editingState.lastCommittedValue = tb.text;
      history.push(createPropertyChangeCmd(
        state.textBoxes, state.selectedTextBoxes, refreshSidePanel,
        tb.id, 'text', oldVal, tb.text
      ));
    }
  };

  const onInput = () => {
    syncAndPushUndo();
    patchEmptyBlocks(content);
  };

  const onKeyDown = (ev) => {
    if (ev.key === 'Escape') {
      cancelEditing();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      handleEnter(content, ev);
      syncAndPushUndo();
    } else if (ev.key === 'Backspace') {
      handleBackspace(content, ev);
    } else if (ev.ctrlKey || ev.metaKey) {
      const k = ev.key.toLowerCase();
      if (k === 'z') {
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.shiftKey) performRedo(); else performUndo();
        getOrCreateBlocks(tb);
        content.innerHTML = blocksToHtml(tb.blocks) || '<div class="rt-block rt-paragraph"><br></div>';
        patchEmptyBlocks(content);
        const lb = content.querySelector('.rt-block:last-of-type');
        placeCursorAtEndSafe(lb || content);
        lastCommittedValue = tb.text;
        state.editingState.lastCommittedValue = tb.text;
      } else if (k === 'b') {
        ev.preventDefault(); document.execCommand('bold', false, null);
        content.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (k === 'i') {
        ev.preventDefault(); document.execCommand('italic', false, null);
        content.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (k === 'u') {
        ev.preventDefault(); document.execCommand('underline', false, null);
        content.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (k === 'x' && ev.shiftKey) {
        ev.preventDefault(); document.execCommand('strikeThrough', false, null);
        content.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  };

  const onPaste = (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (!text) return;
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    let block = range.startContainer;
    while (block && block !== content && !(block.classList && block.classList.contains('rt-block'))) {
      block = block.parentNode;
    }
    if (!block || block === content) {
      block = document.createElement('div');
      block.className = 'rt-block rt-paragraph';
      range.insertNode(block);
      range.setStart(block, 0);
      range.collapse(true);
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        range.insertNode(document.createElement('br'));
        range.collapse(false);
      }
      range.insertNode(document.createTextNode(lines[i]));
      range.collapse(false);
    }
    sel.removeAllRanges();
    sel.addRange(range);
    content.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const onBlur = () => {
    setTimeout(() => {
      if (!content.contains(document.activeElement)) commitEditing();
    }, 0);
  };

  const onClick = () => {
    requestAnimationFrame(() => {
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      const r = sel.getRangeAt(0);
      if (!r.collapsed) return;
      let node = r.startContainer;
      let block = null;
      while (node && node !== content) {
        if (node.nodeType === Node.ELEMENT_NODE && node.classList && node.classList.contains('rt-block')) {
          block = node;
          break;
        }
        node = node.parentNode;
      }
      if (!block) return;
      const marker = block.querySelector('.rt-marker');
      if (marker && marker.contains(r.startContainer)) {
        const contentEl = block.querySelector('.rt-content');
        if (contentEl) {
          placeCursorAtEndSafe(contentEl);
        }
      }
    });
  };

  content.addEventListener('input', onInput);
  content.addEventListener('keydown', onKeyDown);
  content.addEventListener('paste', onPaste);
  content.addEventListener('blur', onBlur);
  content.addEventListener('click', onClick);

  state.editingState._handlers = { onInput, onKeyDown, onPaste, onBlur, onClick };
}

// ── Connection editing ──

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

// ── Shared helpers ──

export function handleEnter(editor, ev) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let block = sel.anchorNode;
  while (block && block !== editor && !(block.classList && block.classList.contains('rt-block'))) {
    block = block.parentNode;
  }
  if (!block || block === editor) return;

  const typeClasses = ['rt-h1', 'rt-h2', 'rt-h3', 'rt-quote', 'rt-bullet', 'rt-numbered', 'rt-checkbox'];
  const isSpecial = typeClasses.some(c => block.classList.contains(c));
  const isEmpty = !block.textContent.replace(/[\u2022\u200B\[\]xX\d.\s]/g, '').trim();

  if (isSpecial && isEmpty) {
    block.className = 'rt-block rt-paragraph';
    const marker = block.querySelector('.rt-marker');
    if (marker) marker.remove();
    block.removeAttribute('data-l');
    block.innerHTML = '<br>';
    placeCursorAtEndSafe(block);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  const range = sel.getRangeAt(0);
  if (!range.collapsed) range.deleteContents();

  const contentContainer = block.querySelector('.rt-content') || block;
  const toEnd = document.createRange();
  toEnd.selectNodeContents(contentContainer);
  toEnd.setStart(range.startContainer, range.startOffset);
  const afterCursor = toEnd.extractContents();

  const newBlock = document.createElement('div');
  if (isSpecial) {
    newBlock.className = block.className;
    if (block.dataset.l) newBlock.dataset.l = block.dataset.l;

    if (block.classList.contains('rt-bullet')) {
      newBlock.innerHTML = '<span class="rt-marker" contenteditable="false">\u2022</span><span class="rt-content"><br></span>';
    } else if (block.classList.contains('rt-numbered')) {
      newBlock.innerHTML = '<span class="rt-marker" contenteditable="false">' + getNextNumber(block) + '.</span><span class="rt-content"><br></span>';
    } else if (block.classList.contains('rt-checkbox')) {
      newBlock.innerHTML = '<span class="rt-marker" data-checked="0" contenteditable="false"></span><span class="rt-content"><br></span>';
    } else {
      newBlock.innerHTML = '<br>';
    }
  } else {
    newBlock.className = 'rt-block rt-paragraph';
    newBlock.innerHTML = '<br>';
  }

  if (afterCursor.childNodes.length > 0) {
    const newContent = newBlock.querySelector('.rt-content') || newBlock;
    const br = newContent.querySelector('br');
    if (br) br.remove();
    newContent.appendChild(afterCursor);
  }

  if (!contentContainer.querySelector('br')) {
    contentContainer.appendChild(document.createElement('br'));
  }

  block.insertAdjacentElement('afterend', newBlock);

  const hadContent = afterCursor.childNodes.length > 0;
  patchEmptyBlocks(newBlock);

  const placeTarget = newBlock.querySelector('.rt-content') || newBlock;
  if (hadContent) {
    const cursorRange = document.createRange();
    cursorRange.setStart(placeTarget.firstChild || placeTarget, 0);
    cursorRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(cursorRange);
  } else {
    placeCursorAtEndSafe(placeTarget);
  }

  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

export function getNextNumber(block) {
  const marker = block.querySelector('.rt-marker');
  if (marker) {
    const num = parseInt(marker.textContent, 10);
    if (!isNaN(num)) return num + 1;
  }
  return 1;
}

function handleBackspace(editor, ev) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return;

  const node = range.startContainer;
  const offset = range.startOffset;
  if (offset > 0 || (node.nodeType === Node.ELEMENT_NODE && node.textContent.length > 0)) return;

  let block = node;
  while (block && block !== editor && !(block.classList && block.classList.contains('rt-block'))) {
    block = block.parentNode;
  }
  if (!block || block === editor) return;

  const prev = block.previousElementSibling;
  if (!prev || !prev.classList || !prev.classList.contains('rt-block')) return;

  ev.preventDefault();

  const typeClasses = ['rt-h1', 'rt-h2', 'rt-h3', 'rt-bullet', 'rt-numbered', 'rt-checkbox', 'rt-quote'];
  const isSpecial = typeClasses.some(c => block.classList.contains(c));
  const trimmed = block.textContent.replace(/[\u2022\u200B\[\]xX\d.\s]/g, '').trim();

  if (trimmed === '' && isSpecial) {
    block.className = 'rt-block rt-paragraph';
    const marker = block.querySelector('.rt-marker');
    if (marker) marker.remove();
    block.innerHTML = '<br>';
    placeCursorAtEndSafe(block);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  if (trimmed === '') {
    block.remove();
    const r = document.createRange();
    const prevContent = prev.querySelector('.rt-content') || prev;
    if (prevContent.lastChild) {
      r.setStartAfter(prevContent.lastChild);
    } else {
      r.setStart(prevContent, 0);
    }
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  while (block.firstChild) {
    prev.appendChild(block.firstChild);
  }
  block.remove();
  prev.normalize();
  const r = document.createRange();
  const prevContent = prev.querySelector('.rt-content') || prev;
  if (prevContent.lastChild) {
    r.setStartAfter(prevContent.lastChild);
  } else {
    r.setStart(prevContent, 0);
  }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

function placeCursorAtEndSafe(el) {
  const content = el.querySelector('.rt-content') || el;
  const range = document.createRange();
  if (content.lastChild) {
    range.setStartAfter(content.lastChild);
  } else {
    range.setStart(content, 0);
  }
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function placeCursorAtEnd(el) {
  placeCursorAtEndSafe(el);
}

function patchEmptyBlocks(container) {
  if (!container) return;
  const contents = container.querySelectorAll('.rt-content');
  for (const c of contents) {
    for (const child of Array.from(c.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent === '\u200B') {
        child.remove();
      }
    }
    if (!c.textContent.trim() && c.querySelector('br')) {
      c.appendChild(document.createTextNode('\u200B'));
    }
  }
}

function removeHandlers(es) {
  if (!es._handlers) return;
  const el = es.el;
  if (es._handlers.onInput) el.removeEventListener('input', es._handlers.onInput);
  if (es._handlers.onKeyDown) el.removeEventListener('keydown', es._handlers.onKeyDown);
  if (es._handlers.onPaste) el.removeEventListener('paste', es._handlers.onPaste);
  if (es._handlers.onBlur) el.removeEventListener('blur', es._handlers.onBlur);
  if (es._handlers.onClick) el.removeEventListener('click', es._handlers.onClick);
}
