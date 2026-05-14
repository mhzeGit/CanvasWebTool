import { state } from './state.js';
import { screenToWorld, worldToScreen, getDarkerColor, getNodeEdgePoint, getPointOnBezier, wrapTextLines } from './utils.js';
import { hitTestNode } from './nodes.js';
import { hitTestConnection } from './connections.js';
import { hitTestTextBox } from './textboxes.js';
import { createPropertyChangeCmd } from './undo.js';
import { refreshSidePanel } from './side-panel.js';
import { history } from './history.js';
import { blocksToHtml, htmlToBlocks, markdownToBlocks, blocksToSimpleText } from './rich-text.js';
import { TITLE_PLACEHOLDER, DEFAULT_NODE_COLOR } from './config.js';
import { getEntityElement } from './dom-entities.js';

export function setupInlineEditing() {
  state.canvas.addEventListener('dblclick', onDblClick);
}

function onDblClick(e) {
  const rect = state.canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const world = screenToWorld(sx, sy, state.offsetX, state.offsetY, state.scale);

  const hit = hitTestNode(world.x, world.y);

  if (hit === -1) {
    const tbHit = hitTestTextBox(world.x, world.y);
    if (tbHit !== -1) {
      state.selected.clear();
      state.selectedConnection = null;
      state.selectedArrows.clear();
      state.selectedShapes.clear();
      state.selectedConnectors.clear();
      state.selectedTextBoxes.clear();
      state.selectedTextBoxes.add(tbHit);
      startTextBoxEditing(tbHit);
      return;
    }

    const connHit = hitTestConnection(world.x, world.y);
    if (connHit !== null) {
      state.selected.clear();
      state.selectedConnection = connHit;
      startConnectionEditing(connHit);
      return;
    }
    return;
  }

  const n = state.nodes[hit];
  const padding = 8;
  const titleFont = `bold ${15}px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif`;
  const titleLineHeight = 18;
  const maxTitleHeight = n.h / 3;
  const maxTitleWidth = Math.max(0, n.w - padding * 2);
  const titleLines = wrapTextLines(state.ctx, titleFont, n.title || '', maxTitleWidth);
  const requiredTitleHeight = Math.max(0, titleLines.length * titleLineHeight + padding * 2);
  const minTitleHeight = Math.min(maxTitleHeight, Math.max(24, padding * 2 + titleLineHeight));
  const titleH = Math.min(maxTitleHeight, Math.max(minTitleHeight, requiredTitleHeight));

  if (!state.selected.has(hit)) {
    state.selected.clear();
    state.selected.add(hit);
  }

  if (world.y >= n.y && world.y <= n.y + titleH) {
    startEditing(hit, 'title');
  } else {
    startEditing(hit, 'text');
  }
}

function ensureBlocks(entity) {
  if (entity.blocks && Array.isArray(entity.blocks) && entity.blocks.length > 0) {
    return entity.blocks;
  }
  if (typeof entity.text === 'string' && entity.text.trim()) {
    entity.blocks = markdownToBlocks(entity.text);
    return entity.blocks;
  }
  entity.blocks = [{ t: 'p', s: [{ t: '' }] }];
  return entity.blocks;
}

export function startEditing(idx, field) {
  cancelEditing();

  const n = state.nodes[idx];
  const el = getEntityElement('node', idx);
  if (!el) return;

  const isRichText = field === 'text';

  if (isRichText) {
    ensureBlocks(n);
    const body = el.querySelector('.entity-node-body');
    if (!body) return;

    body.contentEditable = 'true';
    body.innerHTML = blocksToHtml(n.blocks) || '<div class="rt-block rt-paragraph"><br></div>';

    body.focus();
    placeCursorAtEnd(body);

    const originalValue = JSON.stringify(n.blocks);
    state.editingState = { type: 'node', idx, field, el: body, originalValue, isRichText: true };

    const onInput = () => {
      n.blocks = htmlToBlocks(body);
      n.text = blocksToSimpleText(n.blocks);
    };

    const onKeyDown = (ev) => {
      if (ev.key === 'Escape') {
        cancelEditing();
      } else if (ev.key === 'Enter') {
        if (ev.shiftKey) {
          document.execCommand('insertLineBreak', false, null);
          body.dispatchEvent(new Event('input', { bubbles: true }));
          ev.preventDefault();
        }
      } else if (ev.key === 'Backspace') {
        handleBackspace(body, ev);
      } else if (ev.ctrlKey || ev.metaKey) {
        const k = ev.key.toLowerCase();
        if (k === 'b') { ev.preventDefault(); document.execCommand('bold', false, null); body.dispatchEvent(new Event('input', { bubbles: true })); }
        else if (k === 'i') { ev.preventDefault(); document.execCommand('italic', false, null); body.dispatchEvent(new Event('input', { bubbles: true })); }
        else if (k === 'u') { ev.preventDefault(); document.execCommand('underline', false, null); body.dispatchEvent(new Event('input', { bubbles: true })); }
        else if (k === 'x' && ev.shiftKey) { ev.preventDefault(); document.execCommand('strikeThrough', false, null); body.dispatchEvent(new Event('input', { bubbles: true })); }
      }
    };

    body.addEventListener('input', onInput);
    body.addEventListener('keydown', onKeyDown);

    const commit = () => { commitEditing(); };
    body.addEventListener('blur', commit);

    state.editingState._handlers = { onInput, onKeyDown, commit };
  } else {
    const titlebar = el.querySelector('.entity-node-titlebar');
    if (!titlebar) return;

    titlebar.contentEditable = 'true';
    titlebar.textContent = n.title || '';

    titlebar.focus();
    placeCursorAtEnd(titlebar);

    const originalValue = n.title;
    state.editingState = { type: 'node', idx, field, el: titlebar, originalValue, isRichText: false };

    const onInput = () => {
      n.title = titlebar.textContent || '';
    };

    const onKeyDown = (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        titlebar.blur();
      } else if (ev.key === 'Escape') {
        cancelEditing();
      }
    };

    titlebar.addEventListener('input', onInput);
    titlebar.addEventListener('keydown', onKeyDown);

    const commit = () => { commitEditing(); };
    titlebar.addEventListener('blur', commit);

    state.editingState._handlers = { onInput, onKeyDown, commit };
  }
}

function startConnectionEditing(connIdx) {
  cancelEditing();

  const conn = state.connections[connIdx];
  const fromNode = state.nodes[conn.from];
  const toNode = state.nodes[conn.to];
  if (!fromNode || !toNode) return;

  const toCenterX = toNode.x + toNode.w / 2;
  const toCenterY = toNode.y + toNode.h / 2;
  const fromPt = getNodeEdgePoint(fromNode, toCenterX, toCenterY);
  const fromCenterX = fromNode.x + fromNode.w / 2;
  const fromCenterY = fromNode.y + fromNode.h / 2;
  const toPt = getNodeEdgePoint(toNode, fromCenterX, fromCenterY);
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
  el.style.width = 'auto';
  el.style.minWidth = '80px';
  el.style.transform = 'translate(-50%, -50%)';
  el.style.zIndex = '8';
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
  state.editingState = { type: 'connection', idx: connIdx, el, originalValue };

  const commit = () => { commitEditing(); };
  el.addEventListener('blur', commit);
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      el.blur();
    } else if (ev.key === 'Escape') {
      cancelEditing();
    }
  });
}

function startTextBoxEditing(tbIdx) {
  cancelEditing();

  const tb = state.textBoxes[tbIdx];
  const el = getEntityElement('textBox', tbIdx);
  if (!el) return;

  ensureBlocks(tb);

  const content = el.querySelector('.entity-textbox-content');
  if (!content) return;

  content.contentEditable = 'true';
  content.innerHTML = blocksToHtml(tb.blocks) || '<div class="rt-block rt-paragraph"><br></div>';

  content.focus();
  placeCursorAtEnd(content);

  const originalValue = JSON.stringify(tb.blocks);
  state.editingState = { type: 'textBox', idx: tbIdx, el: content, originalValue, isRichText: true };

  const onInput = () => {
    tb.blocks = htmlToBlocks(content);
    tb.text = blocksToSimpleText(tb.blocks);
  };

  const onKeyDown = (ev) => {
    if (ev.key === 'Escape') {
      cancelEditing();
    } else if (ev.key === 'Enter') {
      if (ev.shiftKey) {
        document.execCommand('insertLineBreak', false, null);
        content.dispatchEvent(new Event('input', { bubbles: true }));
        ev.preventDefault();
      }
    } else if (ev.key === 'Backspace') {
      handleBackspace(content, ev);
    } else if (ev.ctrlKey || ev.metaKey) {
      const k = ev.key.toLowerCase();
      if (k === 'b') { ev.preventDefault(); document.execCommand('bold', false, null); content.dispatchEvent(new Event('input', { bubbles: true })); }
      else if (k === 'i') { ev.preventDefault(); document.execCommand('italic', false, null); content.dispatchEvent(new Event('input', { bubbles: true })); }
      else if (k === 'u') { ev.preventDefault(); document.execCommand('underline', false, null); content.dispatchEvent(new Event('input', { bubbles: true })); }
      else if (k === 'x' && ev.shiftKey) { ev.preventDefault(); document.execCommand('strikeThrough', false, null); content.dispatchEvent(new Event('input', { bubbles: true })); }
    }
  };

  content.addEventListener('input', onInput);
  content.addEventListener('keydown', onKeyDown);

  const commit = () => { commitEditing(); };
  content.addEventListener('blur', commit);

  state.editingState._handlers = { onInput, onKeyDown, commit };
}

function handleEnter(editor, ev) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let block = sel.anchorNode;
  while (block && block !== editor && !(block.classList && block.classList.contains('rt-block'))) {
    block = block.parentNode;
  }
  if (!block || block === editor) return;

  const isHeading = block.classList.contains('rt-h1') || block.classList.contains('rt-h2') || block.classList.contains('rt-h3');
  const isQuote = block.classList.contains('rt-quote');
  const isBullet = block.classList.contains('rt-bullet');
  const isNumbered = block.classList.contains('rt-numbered');
  const isCheckbox = block.classList.contains('rt-checkbox');
  const isList = isBullet || isNumbered || isCheckbox;

  if ((isList || isHeading || isQuote) && !block.textContent.replace(/[\u2022\[\]xX\d.]/g, '').trim()) {
    block.className = 'rt-block rt-paragraph';
    const marker = block.querySelector('.rt-marker');
    if (marker) marker.remove();
    block.innerHTML = '<br>';
    block.focus();
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  const newBlock = document.createElement('div');
  if (isList || isQuote) {
    newBlock.className = block.className;
    if (isBullet) newBlock.innerHTML = '<span class="rt-marker" contenteditable="false">\u2022</span> <br>';
    else if (isNumbered) newBlock.innerHTML = '<span class="rt-marker" contenteditable="false">1.</span> <br>';
    else if (isCheckbox) newBlock.innerHTML = '<span class="rt-marker" contenteditable="false">[ ]</span> <br>';
    else newBlock.innerHTML = '<br>';
  } else {
    newBlock.className = 'rt-block rt-paragraph';
    newBlock.innerHTML = '<br>';
  }

  block.insertAdjacentElement('afterend', newBlock);
  newBlock.focus();
  editor.dispatchEvent(new Event('input', { bubbles: true }));
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

  const isSpecial = block.classList.contains('rt-h1') || block.classList.contains('rt-h2') || block.classList.contains('rt-h3') ||
    block.classList.contains('rt-bullet') || block.classList.contains('rt-numbered') || block.classList.contains('rt-checkbox') ||
    block.classList.contains('rt-quote');

  const trimmed = block.textContent.replace(/[\u2022\[\]xX\d.]/g, '').trim();
  if (trimmed === '' && isSpecial) {
    block.className = 'rt-block rt-paragraph';
    const marker = block.querySelector('.rt-marker');
    if (marker) marker.remove();
    block.innerHTML = '<br>';
    block.focus();
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  if (trimmed === '') {
    block.remove();
    prev.focus();
    const r = document.createRange();
    r.selectNodeContents(prev);
    r.collapse(false);
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
  prev.focus();
  const r = document.createRange();
  r.selectNodeContents(prev);
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

function placeCursorAtEnd(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

export function commitEditing() {
  if (!state.editingState) return;
  const { type, idx, field, el, originalValue, isRichText } = state.editingState;

  if (state.editingState._handlers) {
    el.removeEventListener('input', state.editingState._handlers.onInput);
    el.removeEventListener('keydown', state.editingState._handlers.onKeyDown);
    el.removeEventListener('blur', state.editingState._handlers.commit);
  }

  if (isRichText) {
    const blocks = htmlToBlocks(el);
    if (type === 'textBox') {
      state.textBoxes[idx].blocks = blocks;
      state.textBoxes[idx].text = blocksToSimpleText(blocks);
    } else if (type === 'node') {
      state.nodes[idx].blocks = blocks;
      state.nodes[idx].text = blocksToSimpleText(blocks);
      const newValue = JSON.stringify(blocks);
      if (originalValue !== newValue && state.nodes[idx].id !== undefined) {
        history.push(createPropertyChangeCmd(state.nodes, state.selected, refreshSidePanel, state.nodes[idx].id, field, originalValue, newValue));
      }
    }
  } else {
    if (type === 'connection') {
      state.connections[idx].text = el.value;
    } else if (type === 'node') {
      const newValue = el.textContent || '';
      state.nodes[idx][field] = newValue;
      if (originalValue !== newValue && state.nodes[idx].id !== undefined) {
        history.push(createPropertyChangeCmd(state.nodes, state.selected, refreshSidePanel, state.nodes[idx].id, field, originalValue, newValue));
      }
    }
  }

  if (type !== 'connection') {
    el.contentEditable = 'false';
  }

  state.editingState = null;
  if (type === 'connection') {
    try { document.body.removeChild(el); } catch {}
  }
  refreshSidePanel();
}

export function cancelEditing() {
  if (!state.editingState) return;
  const { type, idx, field, el, originalValue, isRichText } = state.editingState;

  if (state.editingState._handlers) {
    el.removeEventListener('input', state.editingState._handlers.onInput);
    el.removeEventListener('keydown', state.editingState._handlers.onKeyDown);
    el.removeEventListener('blur', state.editingState._handlers.commit);
  }

  if (isRichText) {
    try {
      const blocks = JSON.parse(originalValue);
      if (type === 'textBox') {
        state.textBoxes[idx].blocks = blocks;
        state.textBoxes[idx].text = blocksToSimpleText(blocks);
      } else if (type === 'node') {
        state.nodes[idx].blocks = blocks;
        state.nodes[idx].text = blocksToSimpleText(blocks);
      }
    } catch (e) { /* ignore */ }
  } else {
    if (type === 'connection') {
      state.connections[idx].text = originalValue;
    } else if (type === 'node') {
      state.nodes[idx][field] = originalValue;
    }
  }

  if (type !== 'connection') {
    el.contentEditable = 'false';
  }

  state.editingState = null;
  if (type === 'connection') {
    try { document.body.removeChild(el); } catch {}
  }
  refreshSidePanel();
}
