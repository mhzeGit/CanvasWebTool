import { state } from './state.js';
import { screenToWorld, worldToScreen, getDarkerColor, getNodeEdgePoint, getPointOnBezier, wrapTextLines } from './utils.js';
import { hitTestNode } from './nodes.js';
import { hitTestConnection } from './connections.js';
import { hitTestTextBox } from './textboxes.js';
import { createPropertyChangeCmd } from './undo.js';
import { refreshSidePanel } from './side-panel.js';
import { history } from './history.js';
import { renderMarkdownToHtml, htmlToMarkdown } from './markdown.js';
import { TITLE_PLACEHOLDER, TEXT_PLACEHOLDER, DEFAULT_NODE_COLOR } from './config.js';

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
    startEditing(hit, 'title', n.x, n.y, n.w, titleH);
  } else {
    startEditing(hit, 'text', n.x + padding, n.y + titleH + padding, n.w - padding * 2, n.h - titleH - padding * 2);
  }
}

export function startEditing(idx, field, worldX, worldY, worldW, worldH) {
  cancelEditing();

  const n = state.nodes[idx];
  const canvasRect = state.canvas.getBoundingClientRect();
  const screen = worldToScreen(worldX, worldY, state.offsetX, state.offsetY, state.scale);
  const screenW = worldW * state.scale;
  const screenH = worldH * state.scale;

  const isTitle = field === 'title';
  const baseColor = n.color || DEFAULT_NODE_COLOR;
  const isRichText = field === 'text';

  const el = isRichText
    ? document.createElement('div')
    : document.createElement('input');

  if (isRichText) {
    el.contentEditable = 'true';
    el.className = 'inline-editor-richtext';
    el.innerHTML = renderMarkdownToHtml(n.text || '') || '<div class="md-block md-paragraph"><br></div>';
    el.style.fontSize = (12 * state.scale) + 'px';
    el.style.lineHeight = (1.4 * state.scale) + '';
    el.style.background = baseColor;
    el.style.padding = '4px 6px';
  } else {
    el.className = 'inline-editor inline-editor-title';
    el.value = n[field] || '';
    el.placeholder = TITLE_PLACEHOLDER;
    el.style.color = n.titleColor || '#e7e7e7';
    el.style.fontSize = (15 * state.scale) + 'px';
    el.style.lineHeight = (18 * state.scale) + 'px';
    el.style.padding = (8 * state.scale) + 'px';
    const nodeRadiusEditing = Math.min(12, Math.min(n.w, n.h) * 0.2) * state.scale;
    el.style.background = getDarkerColor(baseColor, 0.6);
    el.style.borderRadius = `${nodeRadiusEditing}px ${nodeRadiusEditing}px 0 0`;
    el.style.border = 'none';
    el.style.overflow = 'hidden';
  }

  el.style.position = 'fixed';
  el.style.left = (screen.x + canvasRect.left) + 'px';
  el.style.top = (screen.y + canvasRect.top) + 'px';
  el.style.width = screenW + 'px';
  el.style.height = screenH + 'px';
  el.style.zIndex = '8';
  el.style.border = 'none';
  el.style.outline = 'none';
  el.style.overflow = 'hidden';

  document.body.appendChild(el);
  el.focus();

  if (!isRichText) el.select();

  const originalValue = n[field];
  state.editingState = { type: 'node', idx, field, el, originalValue, isRichText };

  if (isRichText) {
    el.addEventListener('input', () => {
      const md = htmlToMarkdown(el);
      n.text = md;
    });

    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        cancelEditing();
      } else if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        handleRichEnter(el, ev);
      } else if (ev.key === 'Backspace') {
        handleRichBackspace(el, ev);
      } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'e') {
        ev.preventDefault();
        wrapSelectionWithTag(el, 'code');
      }
    });
  } else {
    el.addEventListener('input', () => {
      n[field] = el.value;
    });

    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        el.blur();
      } else if (ev.key === 'Escape') {
        cancelEditing();
      }
    });
  }

  const commit = () => { commitEditing(); };
  el.addEventListener('blur', commit);
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

export function commitEditing() {
  if (!state.editingState) return;
  const { type, idx, field, el, originalValue, isRichText } = state.editingState;
  const newValue = isRichText ? htmlToMarkdown(el) : el.value;
  if (type === 'textBox') {
    state.textBoxes[idx].text = newValue;
  } else if (type === 'connection') {
    state.connections[idx].text = newValue;
  } else {
    state.nodes[idx][field] = newValue;
    if (originalValue !== newValue && state.nodes[idx].id !== undefined) {
      history.push(createPropertyChangeCmd(state.nodes, state.selected, refreshSidePanel, state.nodes[idx].id, field, originalValue, newValue));
    }
  }
  state.editingState = null;
  try { document.body.removeChild(el); } catch {}
  refreshSidePanel();
}

export function cancelEditing() {
  if (!state.editingState) return;
  const { type, idx, field, el, originalValue } = state.editingState;
  if (type === 'textBox') {
    state.textBoxes[idx].text = originalValue;
  } else if (type === 'connection') {
    state.connections[idx].text = originalValue;
  } else {
    state.nodes[idx][field] = originalValue;
  }
  state.editingState = null;
  try { document.body.removeChild(el); } catch {}
}

function handleRichEnter(editor, ev) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let block = sel.anchorNode;
  while (block && block !== editor && !(block.classList && block.classList.contains('md-block'))) {
    block = block.parentNode;
  }
  if (!block || block === editor) {
    block = editor.querySelector('.md-block.md-paragraph');
  }
  if (!block) return;

  const isEmpty = !block.textContent.trim() ||
    (block.classList.contains('md-bullet') && block.textContent.trim() === '\u2022') ||
    (block.classList.contains('md-numbered') && /^\d+\.\s*$/.test(block.textContent.trim())) ||
    (block.classList.contains('md-checkbox') && /^\[[ x]\]\s*$/i.test(block.textContent.trim()));

  const isList = block.classList.contains('md-bullet') ||
                 block.classList.contains('md-numbered') ||
                 block.classList.contains('md-checkbox');

  if (isEmpty && isList) {
    block.className = 'md-block md-paragraph';
    block.innerHTML = '<br>';
    block.focus();
    const r = document.createRange();
    const br = block.querySelector('br');
    if (br) { r.setStartBefore(br); r.collapse(true); }
    sel.removeAllRanges();
    sel.addRange(r);
    return;
  }

  const tag = isList ? (block.classList.contains('md-bullet') ? 'md-bullet' :
              block.classList.contains('md-numbered') ? 'md-numbered' :
              'md-checkbox') :
              block.classList.contains('md-blockquote') ? 'md-blockquote' :
              'md-paragraph';

  const newBlock = document.createElement('div');
  newBlock.className = 'md-block ' + tag;

  if (tag === 'md-bullet') {
    newBlock.innerHTML = '<span class="md-marker" contenteditable="false">\u2022</span> <br>';
  } else if (tag === 'md-numbered') {
    const m = block.querySelector('.md-marker');
    const num = m ? parseInt(m.textContent, 10) || 1 : 1;
    newBlock.innerHTML = '<span class="md-marker" contenteditable="false">' + (num + 1) + '.</span> <br>';
  } else if (tag === 'md-checkbox') {
    newBlock.innerHTML = '<span class="md-marker" contenteditable="false">[ ]</span> <br>';
  } else if (tag === 'md-blockquote') {
    newBlock.innerHTML = '<br>';
  } else {
    newBlock.innerHTML = '<br>';
  }

  block.insertAdjacentElement('afterend', newBlock);
  newBlock.focus();

  const r = document.createRange();
  const br = newBlock.querySelector('br');
  if (br) {
    r.setStartBefore(br);
    r.collapse(true);
  } else {
    r.selectNodeContents(newBlock);
    r.collapse(true);
  }
  sel.removeAllRanges();
  sel.addRange(r);
}

function wrapSelectionWithTag(editor, tag) {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const wrapper = document.createElement(tag);
  try {
    range.surroundContents(wrapper);
  } catch (e) {
    return;
  }
  sel.removeAllRanges();
  const r = document.createRange();
  r.selectNodeContents(wrapper);
  sel.addRange(r);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

function handleRichBackspace(editor, ev) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return;

  const node = range.startContainer;
  const offset = range.startOffset;
  if (offset > 0 || (node.nodeType === Node.ELEMENT_NODE && node.textContent.length > 0)) return;

  let block = node;
  while (block && block !== editor && !(block.classList && block.classList.contains('md-block'))) {
    block = block.parentNode;
  }
  if (!block || block === editor) return;

  const prev = block.previousElementSibling;
  if (!prev || !prev.classList || !prev.classList.contains('md-block')) return;

  ev.preventDefault();

  if (block.textContent.trim() === '' && (block.classList.contains('md-bullet') || block.classList.contains('md-numbered') || block.classList.contains('md-checkbox') || block.classList.contains('md-blockquote') || block.classList.contains('md-h1') || block.classList.contains('md-h2') || block.classList.contains('md-h3'))) {
    block.className = 'md-block md-paragraph';
    block.innerHTML = '<br>';
    block.focus();
    const r = document.createRange();
    const br = block.querySelector('br');
    if (br) { r.setStartBefore(br); r.collapse(true); }
    else { r.selectNodeContents(block); r.collapse(false); }
    sel.removeAllRanges();
    sel.addRange(r);
    return;
  }

  if (block.textContent.trim() === '') {
    block.remove();
    prev.focus();
    const r = document.createRange();
    r.selectNodeContents(prev);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  } else {
    const content = block.childNodes;
    while (content.length) {
      prev.appendChild(content[0]);
    }
    block.remove();
  }
}

function startTextBoxEditing(tbIdx) {
  cancelEditing();

  const tb = state.textBoxes[tbIdx];
  const canvasRect = state.canvas.getBoundingClientRect();
  const screen = worldToScreen(tb.x, tb.y, state.offsetX, state.offsetY, state.scale);
  const screenW = tb.w * state.scale;
  const screenH = tb.h * state.scale;

  const el = document.createElement('textarea');
  el.className = 'inline-editor inline-editor-text';
  el.value = tb.text || '';
  el.placeholder = 'Enter text...';
  el.style.position = 'fixed';
  el.style.left = (screen.x + canvasRect.left) + 'px';
  el.style.top = (screen.y + canvasRect.top) + 'px';
  el.style.width = screenW + 'px';
  el.style.height = screenH + 'px';
  el.style.zIndex = '8';
  el.style.color = tb.textColor || '#ddd';
  el.style.fontSize = (tb.fontSize || 14) * state.scale + 'px';
  el.style.lineHeight = '1.4';
  el.style.padding = (8 * state.scale) + 'px';
  el.style.background = tb.color || '#1a1a1a';
  el.style.borderRadius = (6 * state.scale) + 'px';
  el.style.border = '1px solid #f0c800';

  document.body.appendChild(el);
  el.focus();
  el.select();

  const originalValue = tb.text;
  state.editingState = { type: 'textBox', idx: tbIdx, el, originalValue };

  el.addEventListener('input', () => {
    tb.text = el.value;
  });

  const commit = () => { commitEditing(); };
  el.addEventListener('blur', commit);
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      cancelEditing();
    }
  });
}
