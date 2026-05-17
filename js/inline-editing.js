import { state } from './state.js';
import { screenToWorld, worldToScreen, getDarkerColor, getNodeEdgePoint, getPointOnBezier, wrapTextLines } from './utils.js';
import { hitTestNode } from './nodes.js';
import { hitTestConnection } from './connections.js';
import { hitTestTextBox } from './textboxes.js';
import { createPropertyChangeCmd } from './undo.js';
import { refreshSidePanel } from './side-panel.js';
import { history, performUndo, performRedo } from './history.js';
import { blocksToHtml, blocksToEditorHtml, htmlToBlocks, markdownToBlocks, blocksToMarkdown } from './rich-text.js';
import { parseInlineSpans } from './markdown.js';
import { TITLE_PLACEHOLDER } from './config.js';
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
  if (typeof entity.text === 'string' && entity.text) {
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
    body.spellcheck = true;
    body.innerHTML = blocksToEditorHtml(n.blocks) || '<div class="rt-block rt-paragraph"><br></div>';

    body.focus();
    const lastBlock = body.querySelector('.rt-block:last-of-type');
    placeCursorAtEnd(lastBlock || body);

    const originalValue = n.text;
    let lastCommittedValue = originalValue;
    let pendingWordBoundary = false;
    state.editingState = { type: 'node', idx, field, el: body, originalValue, lastCommittedValue, isRichText: true };

    const onInput = () => {
      if (!_detectingMarkdown) {
        _detectAndApplyMarkdown(body);
      }
      n.blocks = htmlToBlocks(body);
      n.text = blocksToMarkdown(n.blocks);

      if (pendingWordBoundary && lastCommittedValue !== n.text) {
        pendingWordBoundary = false;
        history.push(createPropertyChangeCmd(state.nodes, state.selected, refreshSidePanel, n.id, field, lastCommittedValue, n.text));
        lastCommittedValue = n.text;
      }
    };

    const onKeyDown = (ev) => {
      if (ev.key === 'Escape') {
        cancelEditing();
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        pendingWordBoundary = true;
        handleEnter(body, ev);
      } else if (ev.key === 'Backspace') {
        handleBackspace(body, ev);
      } else if (ev.key === ' ') {
        pendingWordBoundary = true;
      } else if (ev.ctrlKey || ev.metaKey) {
        const k = ev.key.toLowerCase();
        if (k === 'b') { ev.preventDefault(); document.execCommand('bold', false, null); pendingWordBoundary = true; body.dispatchEvent(new Event('input', { bubbles: true })); }
        else if (k === 'i') { ev.preventDefault(); document.execCommand('italic', false, null); pendingWordBoundary = true; body.dispatchEvent(new Event('input', { bubbles: true })); }
        else if (k === 'u') { ev.preventDefault(); document.execCommand('underline', false, null); pendingWordBoundary = true; body.dispatchEvent(new Event('input', { bubbles: true })); }
        else if (k === 'x' && ev.shiftKey) { ev.preventDefault(); document.execCommand('strikeThrough', false, null); pendingWordBoundary = true; body.dispatchEvent(new Event('input', { bubbles: true })); }
      }
    };

    body.addEventListener('input', onInput);
    body.addEventListener('keydown', onKeyDown);

    const onPaste = (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      if (!text) return;
      e.target.focus();
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      range.deleteContents();
      let block = range.startContainer;
      while (block && block !== body && !(block.classList && block.classList.contains('rt-block'))) {
        block = block.parentNode;
      }
      if (!block || block === body) {
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
      pendingWordBoundary = true;
      body.dispatchEvent(new Event('input', { bubbles: true }));
    };
    body.addEventListener('paste', onPaste);

    const onBlur = () => {
      setTimeout(() => {
        if (!body.contains(document.activeElement)) {
          commitEditing();
        }
      }, 0);
    };
    body.addEventListener('blur', onBlur);

    state.editingState._handlers = { onInput, onKeyDown, onPaste, onBlur };
  } else {
    const titlebar = el.querySelector('.entity-node-titlebar');
    if (!titlebar) return;

    titlebar.contentEditable = 'true';
    titlebar.spellcheck = true;
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

    const onBlur = () => {
      setTimeout(() => {
        if (!titlebar.contains(document.activeElement)) {
          commitEditing();
        }
      }, 0);
    };
    titlebar.addEventListener('blur', onBlur);

    state.editingState._handlers = { onInput, onKeyDown, onBlur };
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
  content.spellcheck = true;
  content.innerHTML = blocksToEditorHtml(tb.blocks) || '<div class="rt-block rt-paragraph"><br></div>';

  content.focus();
  const lastBlock = content.querySelector('.rt-block:last-of-type');
  placeCursorAtEnd(lastBlock || content);

  const originalValue = tb.text;
  let lastCommittedValue = originalValue;
  let pendingWordBoundary = false;
  state.editingState = { type: 'textBox', idx: tbIdx, el: content, originalValue, lastCommittedValue, isRichText: true };

  const onInput = () => {
    if (!_detectingMarkdown) {
      _detectAndApplyMarkdown(content);
    }
    tb.blocks = htmlToBlocks(content);
    tb.text = blocksToMarkdown(tb.blocks);

    if (pendingWordBoundary && lastCommittedValue !== tb.text) {
      pendingWordBoundary = false;
      history.push(createPropertyChangeCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, tb.id, 'text', lastCommittedValue, tb.text));
      lastCommittedValue = tb.text;
    }
  };

  const onKeyDown = (ev) => {
    if (ev.key === 'Escape') {
      cancelEditing();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      pendingWordBoundary = true;
      handleEnter(content, ev);
    } else if (ev.key === 'Backspace') {
      handleBackspace(content, ev);
    } else if (ev.key === ' ') {
      pendingWordBoundary = true;
    } else if (ev.ctrlKey || ev.metaKey) {
      const k = ev.key.toLowerCase();
      if (k === 'z') {
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.shiftKey) {
          performRedo();
        } else {
          performUndo();
        }
        const tb = state.textBoxes[tbIdx];
        ensureBlocks(tb);
        content.innerHTML = blocksToEditorHtml(tb.blocks) || '<div class="rt-block rt-paragraph"><br></div>';
        const lastBlock = content.querySelector('.rt-block:last-of-type');
        placeCursorAtEnd(lastBlock || content);
        lastCommittedValue = tb.text;
        pendingWordBoundary = false;
      } else if (k === 'b') { ev.preventDefault(); document.execCommand('bold', false, null); pendingWordBoundary = true; content.dispatchEvent(new Event('input', { bubbles: true })); }
      else if (k === 'i') { ev.preventDefault(); document.execCommand('italic', false, null); pendingWordBoundary = true; content.dispatchEvent(new Event('input', { bubbles: true })); }
      else if (k === 'u') { ev.preventDefault(); document.execCommand('underline', false, null); pendingWordBoundary = true; content.dispatchEvent(new Event('input', { bubbles: true })); }
      else if (k === 'x' && ev.shiftKey) { ev.preventDefault(); document.execCommand('strikeThrough', false, null); pendingWordBoundary = true; content.dispatchEvent(new Event('input', { bubbles: true })); }
    }
  };

  content.addEventListener('input', onInput);
  content.addEventListener('keydown', onKeyDown);

  const onPaste = (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (!text) return;
    e.target.focus();
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
    pendingWordBoundary = true;
    content.dispatchEvent(new Event('input', { bubbles: true }));
  };
  content.addEventListener('paste', onPaste);

  const onBlur = () => {
    setTimeout(() => {
      if (!content.contains(document.activeElement)) {
        commitEditing();
      }
    }, 0);
  };
  content.addEventListener('blur', onBlur);

  state.editingState._handlers = { onInput, onKeyDown, onPaste, onBlur };
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
  const blockLevel = parseInt(block.dataset.l) || 0;

  if ((isList || isHeading || isQuote) && !block.textContent.replace(/[\u2022\[\]xX\d.]/g, '').trim()) {
    block.className = 'rt-block rt-paragraph';
    const marker = block.querySelector('.rt-marker');
    if (marker) marker.remove();
    block.removeAttribute('data-l');
    block.innerHTML = '<br>';
    placeCursorAtEnd(block);
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
  if (isList || isQuote) {
    newBlock.className = block.className;
    if (blockLevel > 0) newBlock.dataset.l = blockLevel;
    if (isBullet) newBlock.innerHTML = '<span class="rt-marker" contenteditable="false">\u2022</span><span class="rt-content"><br></span>';
    else if (isNumbered) newBlock.innerHTML = '<span class="rt-marker" contenteditable="false">' + getNextNumber(block) + '.</span><span class="rt-content"><br></span>';
    else if (isCheckbox) newBlock.innerHTML = '<span class="rt-marker" data-checked="0" contenteditable="false"></span><span class="rt-content"><br></span>';
    else newBlock.innerHTML = '<br>';
  } else {
    newBlock.className = 'rt-block rt-paragraph';
    newBlock.innerHTML = '<br>';
  }

  if (afterCursor.childNodes.length > 0) {
    const newContent = newBlock.querySelector('.rt-content') || newBlock;
    const br = newContent.querySelector('br');
    if (br) br.remove();
    newContent.insertBefore(afterCursor, newContent.firstChild);
  }

  if (!contentContainer.textContent.trim() && !contentContainer.querySelector('br')) {
    contentContainer.innerHTML = '<br>';
  }

  block.insertAdjacentElement('afterend', newBlock);

  const hadContent = afterCursor.childNodes.length > 0;

  editor.dispatchEvent(new Event('input', { bubbles: true }));

  const placeTarget = newBlock.querySelector('.rt-content') || newBlock;
  if (hadContent) {
    const cursorRange = document.createRange();
    cursorRange.setStart(placeTarget, 0);
    cursorRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(cursorRange);
  } else {
    placeCursorAtEnd(placeTarget);
  }
}

function getNextNumber(block) {
  const marker = block.querySelector('.rt-marker');
  if (marker) {
    const num = parseInt(marker.textContent, 10);
    if (!isNaN(num)) return num + 1;
  }
  return 1;
}

export { handleEnter, getNextNumber };

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

let _detectingMarkdown = false;

function _escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _renderInlineMarkdown(text) {
  if (!text) return '<br>';
  const spans = parseInlineSpans(text);
  let html = '';
  for (const sp of spans) {
    let t = _escHtml(sp.text);
    if (sp.code) t = '<code>' + t + '</code>';
    if (sp.strike) t = '<s>' + t + '</s>';
    if (sp.bold) t = '<strong>' + t + '</strong>';
    if (sp.italic) t = '<em>' + t + '</em>';
    html += t;
  }
  return html || '<br>';
}

function _hasUnformattedMarkdown(block) {
  const text = block.textContent;
  if (!text || !text.trim()) return false;
  const html = block.innerHTML;
  const spans = parseInlineSpans(text);
  const hasBold = spans.some(s => s.bold);
  const hasCode = spans.some(s => s.code);
  const hasStrike = spans.some(s => s.strike);
  if (hasBold && !/<strong>/.test(html)) return true;
  if (hasCode && !/<code>/.test(html)) return true;
  if (hasStrike && !/<s>/.test(html)) return true;
  return false;
}

function _applyBlockMarkdown(block) {
  const text = block.textContent;
  if (!text || !text.trim()) return false;
  if (!block.classList.contains('rt-paragraph')) return false;

  let indent = 0;
  const indentMatch = text.match(/^(\s+)/);
  if (indentMatch) {
    const spaces = indentMatch[1].replace(/\t/g, '    ');
    indent = Math.floor(spaces.length / 4);
  }
  const content = text.trimStart();

  const hMatch = content.match(/^(#{1,3})\s(.+)/);
  if (hMatch) {
    const level = hMatch[1].length;
    const cls = level === 1 ? 'rt-h1' : level === 2 ? 'rt-h2' : 'rt-h3';
    block.classList.remove('rt-paragraph');
    block.classList.add(cls);
    block.innerHTML = _renderInlineMarkdown(hMatch[2]);
    if (indent > 0) block.dataset.l = indent; else block.removeAttribute('data-l');
    placeCursorAtEnd(block);
    return true;
  }

  const chkMatch = content.match(/^(?:-\s*)?\[(\s|x|X)\]\s+(.+)/);
  if (chkMatch) {
    const checked = chkMatch[1].toLowerCase() === 'x';
    block.classList.remove('rt-paragraph');
    block.classList.add('rt-checkbox');
    block.innerHTML = '<span class="rt-marker" data-checked="' + (checked ? '1' : '0') + '" contenteditable="false"></span><span class="rt-content">' + _renderInlineMarkdown(chkMatch[2]) + '</span>';
    if (indent > 0) block.dataset.l = indent; else block.removeAttribute('data-l');
    placeCursorAtEnd(block);
    return true;
  }

  const bulMatch = content.match(/^([-*])\s(.+)/);
  if (bulMatch) {
    block.classList.remove('rt-paragraph');
    block.classList.add('rt-bullet');
    block.innerHTML = '<span class="rt-marker" contenteditable="false">\u2022</span><span class="rt-content">' + _renderInlineMarkdown(bulMatch[2]) + '</span>';
    if (indent > 0) block.dataset.l = indent; else block.removeAttribute('data-l');
    placeCursorAtEnd(block);
    return true;
  }

  const qtMatch = content.match(/^>\s?(.+)/);
  if (qtMatch) {
    block.classList.remove('rt-paragraph');
    block.classList.add('rt-quote');
    block.innerHTML = _renderInlineMarkdown(qtMatch[1]) || '<br>';
    if (indent > 0) block.dataset.l = indent; else block.removeAttribute('data-l');
    placeCursorAtEnd(block);
    return true;
  }

  const numMatch = content.match(/^(\d+)\.\s+(.+)/);
  if (numMatch) {
    block.classList.remove('rt-paragraph');
    block.classList.add('rt-numbered');
    block.innerHTML = '<span class="rt-marker" contenteditable="false">' + numMatch[1] + '.</span><span class="rt-content">' + _renderInlineMarkdown(numMatch[2]) + '</span>';
    if (indent > 0) block.dataset.l = indent; else block.removeAttribute('data-l');
    placeCursorAtEnd(block);
    return true;
  }

  return false;
}

function _applyInlineMarkdown(block) {
  if (block.querySelector('.rt-marker')) return false;
  if (!_hasUnformattedMarkdown(block)) return false;

  const text = block.textContent;
  const newHtml = _renderInlineMarkdown(text);
  if (newHtml === block.innerHTML) return false;

  block.innerHTML = newHtml;
  placeCursorAtEnd(block);
  return true;
}

function _detectAndApplyMarkdown(editor) {
  if (_detectingMarkdown) return;
  _detectingMarkdown = true;
  try {
    let changed = false;
    const blocks = editor.querySelectorAll('.rt-block');
    for (const block of blocks) {
      if (block.contentEditable === 'false') continue;
      if (_applyBlockMarkdown(block)) {
        changed = true;
        continue;
      }
      if (_applyInlineMarkdown(block)) {
        changed = true;
      }
    }
    if (changed) {
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
  } finally {
    _detectingMarkdown = false;
  }
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
  const { type, idx, field, el, originalValue, lastCommittedValue, isRichText } = state.editingState;

  if (state.editingState._handlers) {
    el.removeEventListener('input', state.editingState._handlers.onInput);
    el.removeEventListener('keydown', state.editingState._handlers.onKeyDown);
    el.removeEventListener('paste', state.editingState._handlers.onPaste);
    el.removeEventListener('blur', state.editingState._handlers.onBlur);
  }

  if (isRichText) {
    const domBlocks = htmlToBlocks(el);
    if (type === 'textBox') {
      const newText = blocksToMarkdown(domBlocks);
      state.textBoxes[idx].text = newText;
      state.textBoxes[idx].blocks = markdownToBlocks(newText);
      if (lastCommittedValue !== newText && state.textBoxes[idx].id !== undefined) {
        history.push(createPropertyChangeCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, state.textBoxes[idx].id, field, lastCommittedValue, newText));
      }
    } else if (type === 'node') {
      const newText = blocksToMarkdown(domBlocks);
      state.nodes[idx].text = newText;
      state.nodes[idx].blocks = markdownToBlocks(newText);
      if (lastCommittedValue !== newText && state.nodes[idx].id !== undefined) {
        history.push(createPropertyChangeCmd(state.nodes, state.selected, refreshSidePanel, state.nodes[idx].id, field, lastCommittedValue, newText));
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
    el.removeEventListener('paste', state.editingState._handlers.onPaste);
    el.removeEventListener('blur', state.editingState._handlers.onBlur);
  }

  if (isRichText) {
    if (type === 'textBox') {
      state.textBoxes[idx].text = originalValue;
      state.textBoxes[idx].blocks = null;
    } else if (type === 'node') {
      state.nodes[idx].text = originalValue;
      state.nodes[idx].blocks = null;
    }
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
