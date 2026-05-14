import { state } from './state.js';
import { history, flushPanelEdit, startPanelEdit, startShapePanelEdit } from './history.js';
import {
  createResizeNodeCmd, createResizeShapeCmd,
  createBatchNodePropertyChangeCmd, createBatchResizeNodeCmd,
  createBatchShapePropertyChangeCmd, createBatchResizeShapeCmd,
  createBatchTextBoxPropertyChangeCmd, createBatchResizeTextBoxCmd
} from './undo.js';
import { getArrowEndpoint } from './arrows.js';
import { blocksToHtml, getOrCreateBlocks, htmlToBlocks, blocksToMarkdown, markdownToBlocks } from './rich-text.js';
import { TITLE_PLACEHOLDER, TEXT_PLACEHOLDER } from './config.js';

function buildMarkdownToolbar() {
  return '<div class="panel-md-toolbar">' +
    '<button class="panel-md-btn" data-cmd="bold" title="Bold (Ctrl+B)"><strong>B</strong></button>' +
    '<button class="panel-md-btn" data-cmd="italic" title="Italic (Ctrl+I)"><em>I</em></button>' +
    '<button class="panel-md-btn" data-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button>' +
    '<button class="panel-md-btn" data-cmd="strikethrough" title="Strikethrough (Ctrl+Shift+S)"><s>S</s></button>' +
    '<span class="panel-md-sep"></span>' +
    '<button class="panel-md-btn" data-cmd="h1" title="Heading 1">H1</button>' +
    '<button class="panel-md-btn" data-cmd="h2" title="Heading 2">H2</button>' +
    '<button class="panel-md-btn" data-cmd="h3" title="Heading 3">H3</button>' +
    '<span class="panel-md-sep"></span>' +
    '<button class="panel-md-btn" data-cmd="ul" title="Bullet List">UL</button>' +
    '<button class="panel-md-btn" data-cmd="ol" title="Numbered List">OL</button>' +
    '<span class="panel-md-sep"></span>' +
    '<button class="panel-md-btn" data-cmd="blockquote" title="Blockquote"><span style="font-family:serif;">\u275D</span></button>' +
    '<button class="panel-md-btn" data-cmd="code" title="Inline Code">&lt;/&gt;</button>' +
    '<button class="panel-md-btn" data-cmd="hr" title="Horizontal Rule">\u2014</button>' +
    '<button class="panel-md-btn" data-cmd="link" title="Insert Link">\uD83D\uDD17</button>' +
    '<span class="panel-md-sep"></span>' +
    '<button class="panel-md-btn panel-md-toggle" data-cmd="toggle" title="Toggle raw markdown/rich text">M</button>' +
    '</div>';
}

function _sp(html) {
  const panel = state.sidePanelContent;
  panel.innerHTML = html;
}

function _getSelectedRtBlock(root) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  let node = sel.getRangeAt(0).startContainer;
  while (node && node !== root) {
    if (node.nodeType === Node.ELEMENT_NODE && node.classList && node.classList.contains('rt-block')) {
      return node;
    }
    node = node.parentNode;
  }
  return null;
}

function _setBlockClass(block, cls) {
  const typeClasses = ['rt-paragraph', 'rt-h1', 'rt-h2', 'rt-h3', 'rt-bullet', 'rt-numbered', 'rt-checkbox', 'rt-quote'];
  for (const c of typeClasses) block.classList.remove(c);
  block.classList.add(cls);
}

function _removeBlockMarker(block) {
  const marker = block.querySelector('.rt-marker');
  if (marker) marker.remove();
}

function _addBlockMarker(block, type) {
  _removeBlockMarker(block);
  const marker = document.createElement('span');
  marker.className = 'rt-marker';
  marker.contentEditable = 'false';
  if (type === 'bul') {
    marker.textContent = '\u2022';
  } else if (type === 'num') {
    marker.textContent = '1.';
  }
  block.insertBefore(marker, block.firstChild);
  if (block.firstChild === marker && marker.nextSibling && marker.nextSibling.nodeType === Node.TEXT_NODE) {
    // space after marker already present from blocksToHtml
  } else if (block.firstChild === marker) {
    marker.after(document.createTextNode(' '));
  }
}

function _handleRichTextCommand(cmd, root) {
  const inlineMap = { bold: 'bold', italic: 'italic', underline: 'underline', strikethrough: 'strikeThrough' };
  if (inlineMap[cmd]) {
    document.execCommand(inlineMap[cmd], false, null);
    return;
  }
  if (cmd === 'code') {
    const sel = window.getSelection().toString() || 'code';
    document.execCommand('insertHTML', false, '<code>' + state.escAttr(sel) + '</code>');
    return;
  }
  if (cmd === 'link') {
    const sel = window.getSelection().toString() || 'link';
    const url = prompt('Enter URL:', 'https://');
    if (url) {
      document.execCommand('insertHTML', false, '<a href="' + state.escAttr(url) + '" target="_blank">' + state.escAttr(sel) + '</a>');
    }
    return;
  }
  if (cmd === 'hr') {
    document.execCommand('insertHTML', false, '<div class="rt-block rt-divider" contenteditable="false"><hr></div><div class="rt-block rt-paragraph"><br></div>');
    return;
  }
  const typeMap = { h1: 'rt-h1', h2: 'rt-h2', h3: 'rt-h3', ul: 'rt-bullet', ol: 'rt-numbered', blockquote: 'rt-quote' };
  const targetClass = typeMap[cmd];
  if (!targetClass) return;
  const block = _getSelectedRtBlock(root);
  if (!block) return;
  if (block.classList.contains(targetClass)) {
    _setBlockClass(block, 'rt-paragraph');
    _removeBlockMarker(block);
  } else {
    _setBlockClass(block, targetClass);
    if (cmd === 'ul' || cmd === 'ol') {
      _addBlockMarker(block, cmd === 'ul' ? 'bul' : 'num');
    } else {
      _removeBlockMarker(block);
    }
  }
}

function _handleRawTextCommand(cmd, ta) {
  const mdPairs = {
    bold: ['**', '**'],
    italic: ['*', '*'],
    underline: ['<u>', '</u>'],
    strikethrough: ['~~', '~~'],
    code: ['`', '`'],
    h1: ['# ', ''],
    h2: ['## ', ''],
    h3: ['### ', ''],
    ul: ['\n- ', ''],
    ol: ['\n1. ', ''],
    blockquote: ['\n> ', ''],
    hr: ['\n___\n', ''],
    link: ['[', '](https://)'],
  };
  const pair = mdPairs[cmd];
  if (!pair) return;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const sel = ta.value.substring(start, end) || 'text';
  const mdPrefix = pair[0];
  const suffix = pair[1];
  const insertText = (mdPrefix.startsWith('\n') && start > 0 && ta.value[start - 1] !== '\n' ? '\n' : '') +
    mdPrefix.replace(/^\n+/, '') + sel + suffix;
  ta.value = ta.value.substring(0, start) + insertText + ta.value.substring(end);
  const cursorPos = start + insertText.length;
  ta.selectionStart = ta.selectionEnd = cursorPos;
  ta.focus();
}

function setupMarkdownEditor(editorId, opts) {
  const editorEl = document.getElementById(editorId + 'Editor');
  const rtDiv = document.getElementById(editorId + 'RT');
  const rawTa = document.getElementById(editorId + 'Raw');
  if (!editorEl || !rtDiv || !rawTa) return;

  let isRichText = true;
  let syncTimer = 0;
  let isSyncing = false;

  function richToText() {
    return blocksToMarkdown(htmlToBlocks(rtDiv));
  }

  function textToRich(text) {
    rtDiv.innerHTML = blocksToHtml(markdownToBlocks(text));
  }

  function syncToEntity() {
    if (isSyncing) return;
    isSyncing = true;
    try {
      if (isRichText) {
        opts.setText(richToText());
      } else {
        opts.setText(rawTa.value);
      }
      if (opts.onChange) opts.onChange();
    } finally {
      isSyncing = false;
    }
  }

  function scheduleSync(ms) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncToEntity, ms);
  }

  function switchMode(toRich) {
    if (toRich === isRichText) return;
    isSyncing = true;
    try {
      if (toRich) {
        const blocks = markdownToBlocks(rawTa.value || opts.getText());
        rtDiv.innerHTML = blocksToHtml(blocks);
        rtDiv.style.display = '';
        rawTa.style.display = 'none';
        isRichText = true;
        rtDiv.focus();
      } else {
        const text = richToText();
        rawTa.value = text;
        rtDiv.style.display = 'none';
        rawTa.style.display = '';
        isRichText = false;
        rawTa.focus();
      }
      opts.setText(isRichText ? richToText() : rawTa.value);
    } finally {
      isSyncing = false;
    }
  }

  rtDiv.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (!text) return;
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    scheduleSync(10);
  });

  editorEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cmd]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const cmd = btn.dataset.cmd;
    if (cmd === 'toggle') {
      switchMode(!isRichText);
      return;
    }
    if (isRichText) {
      rtDiv.focus();
      _handleRichTextCommand(cmd, rtDiv);
    } else {
      _handleRawTextCommand(cmd, rawTa);
    }
    scheduleSync(50);
  });

  rtDiv.addEventListener('input', () => {
    scheduleSync(50);
  });

  rawTa.addEventListener('input', () => {
    if (isSyncing) return;
    opts.setText(rawTa.value);
    if (opts.onChange) opts.onChange();
  });

  let hasFocus = false;
  function onEditorFocus() {
    if (!hasFocus) {
      hasFocus = true;
      if (opts.onFocus) opts.onFocus();
    }
  }
  function onEditorBlur() {
    setTimeout(() => {
      if (!editorEl.contains(document.activeElement)) {
        if (hasFocus) {
          hasFocus = false;
          syncToEntity();
          if (opts.onBlur) opts.onBlur();
        }
      }
    }, 0);
  }
  rtDiv.addEventListener('focus', onEditorFocus);
  rawTa.addEventListener('focus', onEditorFocus);
  rtDiv.addEventListener('blur', onEditorBlur);
  rawTa.addEventListener('blur', onEditorBlur);

  return {
    switchMode,
    sync: syncToEntity,
    isRichMode: () => isRichText,
  };
}

const _nodeBatchSnapshots = new Map();
const _shapeBatchSnapshots = new Map();
const _tbBatchSnapshots = new Map();

function _captureNodeSnapshot(property, members) {
  _nodeBatchSnapshots.set(property, members.map(m => ({
    nodeId: m.id,
    oldValue: m[property],
    oldBounds: (property === 'w' || property === 'h')
      ? { x: m.x, y: m.y, w: m.w, h: m.h } : null
  })));
}

function _commitNodeSnapshot(property) {
  const snapshots = _nodeBatchSnapshots.get(property);
  if (!snapshots) return;
  _nodeBatchSnapshots.delete(property);
  const changes = [];
  for (const snap of snapshots) {
    const found = state.findNodeById(state.nodes, snap.nodeId);
    if (!found) continue;
    const newValue = found.node[property];
    if (snap.oldValue !== newValue) {
      if (property === 'w' || property === 'h') {
        changes.push({
          nodeId: snap.nodeId,
          fromBounds: snap.oldBounds,
          toBounds: { x: found.node.x, y: found.node.y, w: found.node.w, h: found.node.h }
        });
      } else {
        changes.push({ nodeId: snap.nodeId, property, oldValue: snap.oldValue, newValue });
      }
    }
  }
  if (changes.length === 0) return;
  if (property === 'w' || property === 'h') {
    history.push(createBatchResizeNodeCmd(state.nodes, state.selected, refreshSidePanel, changes));
  } else {
    history.push(createBatchNodePropertyChangeCmd(state.nodes, state.selected, refreshSidePanel, changes));
  }
}

function _captureShapeSnapshot(property, members) {
  _shapeBatchSnapshots.set(property, members.map(m => ({
    shapeId: m.id,
    oldValue: m[property],
    oldBounds: (property === 'w' || property === 'h')
      ? { x: m.x, y: m.y, w: m.w, h: m.h } : null
  })));
}

function _commitShapeSnapshot(property) {
  const snapshots = _shapeBatchSnapshots.get(property);
  if (!snapshots) return;
  _shapeBatchSnapshots.delete(property);
  const changes = [];
  for (const snap of snapshots) {
    const found = state.shapes.find(s => s.id === snap.shapeId);
    if (!found) continue;
    const newValue = found[property];
    if (snap.oldValue !== newValue) {
      if (property === 'w' || property === 'h') {
        changes.push({
          shapeId: snap.shapeId,
          fromBounds: snap.oldBounds,
          toBounds: { x: found.x, y: found.y, w: found.w, h: found.h }
        });
      } else {
        changes.push({ shapeId: snap.shapeId, property, oldValue: snap.oldValue, newValue });
      }
    }
  }
  if (changes.length === 0) return;
  if (property === 'w' || property === 'h') {
    history.push(createBatchResizeShapeCmd(state.shapes, state.selectedShapes, refreshSidePanel, changes));
  } else {
    history.push(createBatchShapePropertyChangeCmd(state.shapes, state.selectedShapes, refreshSidePanel, changes));
  }
}

function _captureTbSnapshot(property, members) {
  _tbBatchSnapshots.set(property, members.map(m => ({
    tbId: m.id,
    oldValue: m[property],
    oldBounds: (property === 'w' || property === 'h')
      ? { x: m.x, y: m.y, w: m.w, h: m.h } : null
  })));
}

function _commitTbSnapshot(property) {
  const snapshots = _tbBatchSnapshots.get(property);
  if (!snapshots) return;
  _tbBatchSnapshots.delete(property);
  const changes = [];
  for (const snap of snapshots) {
    const found = state.textBoxes.find(t => t.id === snap.tbId);
    if (!found) continue;
    const newValue = found[property];
    if (snap.oldValue !== newValue) {
      if (property === 'w' || property === 'h') {
        changes.push({
          tbId: snap.tbId,
          fromBounds: snap.oldBounds,
          toBounds: { x: found.x, y: found.y, w: found.w, h: found.h }
        });
      } else {
        changes.push({ tbId: snap.tbId, property, oldValue: snap.oldValue, newValue });
      }
    }
  }
  if (changes.length === 0) return;
  if (property === 'w' || property === 'h') {
    history.push(createBatchResizeTextBoxCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, changes));
  } else {
    history.push(createBatchTextBoxPropertyChangeCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, changes));
  }
}

export function refreshSidePanel() {
  const { sidePanelContent } = state;
  if (!sidePanelContent) return;

  if (state.arrowDragTarget !== null && state.arrows[state.arrowDragTarget.arrowIdx]) {
    flushPanelEdit();
    const arrow = state.arrows[state.arrowDragTarget.arrowIdx];
    const endLabel = state.arrowDragTarget.end === 'start' ? 'Start (Tail)' : 'End (Tip)';
    const connNodeIdx = state.arrowDragTarget.end === 'start' ? arrow.connectedFrom : arrow.connectedTo;
    const connLabel = connNodeIdx !== null && state.nodes[connNodeIdx]
      ? (state.nodes[connNodeIdx].title || `Node ${connNodeIdx}`) : 'None';
    const pt = getArrowEndpoint(arrow, state.arrowDragTarget.end);
    _sp( [
      '<div class="panel-section-title">Arrow Point (' + state.escAttr(endLabel) + ')</div>',
      '<div class="panel-row"><label>Connected to</label><span class="panel-static">' + state.escAttr(connLabel) + '</span></div>',
      '<div class="panel-row"><label>X</label><span class="panel-static">' + Math.round(pt.x) + '</span></div>',
      '<div class="panel-row"><label>Y</label><span class="panel-static">' + Math.round(pt.y) + '</span></div>',
    ].join(''));
    return;
  }

  // --- Mixed-type selection (check before single-type handlers) ---
  {
    let typeCount = 0;
    if (state.selected.size > 0) typeCount++;
    if (state.selectedShapes.size > 0) typeCount++;
    if (state.selectedTextBoxes.size > 0) typeCount++;
    if (state.selectedArrows.size > 0) typeCount++;
    if (state.selectedConnection !== null) typeCount++;
    if (state.selectedConnectors.size > 0) typeCount++;
    if (typeCount > 1) {
      flushPanelEdit();
      renderMixedEditor();
      return;
    }
  }

  if (state.selectedArrows.size === 1) {
    flushPanelEdit();
    const arrow = state.arrows[Array.from(state.selectedArrows)[0]];
    const fromLabel = arrow.connectedFrom !== null && state.nodes[arrow.connectedFrom]
      ? (state.nodes[arrow.connectedFrom].title || `Node ${arrow.connectedFrom}`) : 'Free';
    const toLabel = arrow.connectedTo !== null && state.nodes[arrow.connectedTo]
      ? (state.nodes[arrow.connectedTo].title || `Node ${arrow.connectedTo}`) : 'Free';
    _sp( [
      '<div class="panel-section-title">Arrow</div>',
      '<div class="panel-row"><label>From</label><span class="panel-static">' + state.escAttr(fromLabel) + '</span></div>',
      '<div class="panel-row"><label>To</label><span class="panel-static">' + state.escAttr(toLabel) + '</span></div>',
      '<div class="panel-row"><label>Color</label><input id="panelArrowColor" class="panel-input" type="color" value="' + state.escAttr(arrow.color || '#6bb5ff') + '" /></div>',
    ].join(''));
    const colorInput = document.getElementById('panelArrowColor');
    if (colorInput) colorInput.addEventListener('input', (ev) => { arrow.color = ev.target.value; });
    return;
  }

  if (state.selectedArrows.size > 1) {
    flushPanelEdit();
    _sp( '<div class="panel-section-title">' + state.selectedArrows.size + ' arrows selected</div>');
    return;
  }

  if (state.selectedConnection !== null && state.connections[state.selectedConnection]) {
    flushPanelEdit();
    const conn = state.connections[state.selectedConnection];
    const fromNode = state.nodes[conn.from];
    const toNode = state.nodes[conn.to];
    const fromLabel = fromNode ? (fromNode.title || `Node ${conn.from}`) : '?';
    const toLabel = toNode ? (toNode.title || `Node ${conn.to}`) : '?';
    _sp( [
      '<div class="panel-section-title">Connection</div>',
      '<div class="panel-row"><label>From</label><span class="panel-static">' + state.escAttr(fromLabel) + '</span></div>',
      '<div class="panel-row"><label>To</label><span class="panel-static">' + state.escAttr(toLabel) + '</span></div>',
      '<div class="panel-row"><label>Color</label><input id="panelConnColor" class="panel-input" type="color" value="' + state.escAttr(conn.color || '#6bb5ff') + '" /></div>',
      '<div class="panel-row"><label>Text</label><input id="panelConnText" class="panel-input" type="text" value="' + state.escAttr(conn.text ?? '') + '" /></div>',
    ].join(''));
    const colorInput = document.getElementById('panelConnColor');
    const textInput = document.getElementById('panelConnText');
    if (colorInput) colorInput.addEventListener('input', (ev) => { conn.color = ev.target.value; });
    if (textInput) textInput.addEventListener('input', (ev) => { conn.text = ev.target.value; });
    return;
  }

  // --- Shapes (single or multi, same UI) ---
  if (state.selectedShapes.size >= 1) {
    flushPanelEdit();
    const indices = Array.from(state.selectedShapes);
    const isBatch = indices.length > 1;
    const firstIdx = indices[0];
    const s = state.shapes[firstIdx];
    const shapeId = s.id;
    const isRect = s.shapeType === 'rectangle';
    const members = indices.map(i => state.shapes[i]);

    const colorMixed = isBatch && members.some(m => m.color !== s.color);
    const borderColorMixed = isBatch && members.some(m => m.borderColor !== s.borderColor);
    const borderWidthMixed = isBatch && members.some(m => m.borderWidth !== s.borderWidth);
    const wMixed = isBatch && members.some(m => m.w !== s.w);
    const hMixed = isBatch && members.some(m => m.h !== s.h);
    const radiusMixed = isRect && isBatch && members.some(m => m.cornerRadius !== s.cornerRadius);

    const title = isBatch ? indices.length + ' shapes selected' : 'Shape (' + state.escAttr(s.shapeType) + ')';

    _sp( [
      '<div class="panel-section-title">' + title + '</div>',
      '<div class="panel-row"><label>Color</label><input id="panelShapeColor" class="panel-input panel-input-color" type="color" value="' + state.escAttr(s.color ?? '#2b2b2b') + '" /></div>',
      '<div class="panel-row"><label>Border</label><input id="panelShapeBorderColor" class="panel-input panel-input-color" type="color" value="' + state.escAttr(s.borderColor ?? '#6bb5ff') + '" /></div>',
      '<div class="panel-row"><label>Border W</label><input id="panelShapeBorderWidth" class="panel-input" type="number" min="0" max="20" step="0.5" value="' + (colorMixed || borderWidthMixed ? '' : (s.borderWidth ?? 2)) + '" placeholder="' + (borderWidthMixed ? '(mixed)' : '') + '" /></div>',
      '<div class="panel-row"><label>Width</label><input id="panelShapeW" class="panel-input" type="number" min="10" value="' + (wMixed ? '' : s.w) + '" placeholder="' + (wMixed ? '(mixed)' : '') + '" /></div>',
      '<div class="panel-row"><label>Height</label><input id="panelShapeH" class="panel-input" type="number" min="10" value="' + (hMixed ? '' : s.h) + '" placeholder="' + (hMixed ? '(mixed)' : '') + '" /></div>',
      (isRect ? '<div class="panel-row"><label>Radius</label><input id="panelShapeCornerRadius" class="panel-input" type="number" min="0" max="200" value="' + (radiusMixed ? '' : (s.cornerRadius ?? 4)) + '" placeholder="' + (radiusMixed ? '(mixed)' : '') + '" /></div>' : ''),
    ].join(''));

    const colorInput = document.getElementById('panelShapeColor');
    const borderColorInput = document.getElementById('panelShapeBorderColor');
    const borderWidthInput = document.getElementById('panelShapeBorderWidth');
    const wInput = document.getElementById('panelShapeW');
    const hInput = document.getElementById('panelShapeH');
    const radiusInput = document.getElementById('panelShapeCornerRadius');

    if (colorInput) {
      colorInput.addEventListener('input', (ev) => {
        const v = ev.target.value;
        if (isBatch) { for (const m of members) m.color = v; } else { s.color = v; }
        state.lastShapeColor = v;
      });
      if (isBatch) {
        colorInput.addEventListener('pointerdown', () => _captureShapeSnapshot('color', members));
        colorInput.addEventListener('change', () => _commitShapeSnapshot('color'));
      } else {
        colorInput.addEventListener('pointerdown', () => { startShapePanelEdit(shapeId, 'color', s.color); });
        colorInput.addEventListener('change', () => { flushPanelEdit(); });
      }
    }
    if (borderColorInput) {
      borderColorInput.addEventListener('input', (ev) => {
        const v = ev.target.value;
        if (isBatch) { for (const m of members) m.borderColor = v; } else { s.borderColor = v; }
        state.lastShapeBorderColor = v;
      });
      if (isBatch) {
        borderColorInput.addEventListener('pointerdown', () => _captureShapeSnapshot('borderColor', members));
        borderColorInput.addEventListener('change', () => _commitShapeSnapshot('borderColor'));
      } else {
        borderColorInput.addEventListener('pointerdown', () => { startShapePanelEdit(shapeId, 'borderColor', s.borderColor); });
        borderColorInput.addEventListener('change', () => { flushPanelEdit(); });
      }
    }
    if (borderWidthInput) {
      borderWidthInput.addEventListener('input', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!Number.isNaN(v) && v >= 0) {
          if (isBatch) { for (const m of members) m.borderWidth = v; } else { s.borderWidth = v; }
        }
      });
      if (isBatch) {
        borderWidthInput.addEventListener('focus', () => _captureShapeSnapshot('borderWidth', members));
        borderWidthInput.addEventListener('blur', () => _commitShapeSnapshot('borderWidth'));
      } else {
        borderWidthInput.addEventListener('focus', () => { startShapePanelEdit(shapeId, 'borderWidth', s.borderWidth); });
        borderWidthInput.addEventListener('blur', () => { flushPanelEdit(); });
      }
    }
    if (wInput) {
      wInput.setAttribute('data-drag-number', 'true');
      wInput.addEventListener('input', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!Number.isNaN(v) && v >= 10) {
          if (isBatch) { for (const m of members) m.w = v; } else { s.w = v; }
        }
      });
      if (isBatch) {
        wInput.addEventListener('focus', () => _captureShapeSnapshot('w', members));
        wInput.addEventListener('blur', () => _commitShapeSnapshot('w'));
        let dragStartBoundsPerMember = null;
        attachDragNumber(wInput,
          (delta) => {
            for (const m of members) { m.w = Math.max(10, m.w + delta); }
            wInput.value = String(Math.round(members[0].w));
          },
          () => {
            _commitShapeSnapshot('w');
            dragStartBoundsPerMember = members.map(m => ({ shapeId: m.id, bounds: { x: m.x, y: m.y, w: m.w, h: m.h } }));
          },
          () => {
            if (!dragStartBoundsPerMember) return;
            const changes = [];
            for (let i = 0; i < members.length; i++) {
              const fromB = dragStartBoundsPerMember[i].bounds;
              const toB = { x: members[i].x, y: members[i].y, w: members[i].w, h: members[i].h };
              if (fromB.w !== toB.w) changes.push({ shapeId: members[i].id, fromBounds: fromB, toBounds: toB });
            }
            if (changes.length > 0) history.push(createBatchResizeShapeCmd(state.shapes, state.selectedShapes, refreshSidePanel, changes));
          });
      } else {
        wInput.addEventListener('focus', () => { startShapePanelEdit(shapeId, 'w', s.w, { x: s.x, y: s.y, w: s.w, h: s.h }); });
        wInput.addEventListener('blur', () => { flushPanelEdit(); });
        let wDragStart = { x: s.x, y: s.y, w: s.w, h: s.h };
        attachDragNumber(wInput,
          (delta) => { s.w = Math.max(10, s.w + delta); wInput.value = String(Math.round(s.w)); },
          () => { flushPanelEdit(); wDragStart = { x: s.x, y: s.y, w: s.w, h: s.h }; },
          () => {
            if (s.w !== wDragStart.w) {
              history.push(createResizeShapeCmd(state.shapes, state.selectedShapes, refreshSidePanel, shapeId,
                { x: wDragStart.x, y: wDragStart.y, w: wDragStart.w, h: wDragStart.h },
                { x: s.x, y: s.y, w: s.w, h: s.h }));
            }
          });
      }
    }
    if (hInput) {
      hInput.setAttribute('data-drag-number', 'true');
      hInput.addEventListener('input', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!Number.isNaN(v) && v >= 10) {
          if (isBatch) { for (const m of members) m.h = v; } else { s.h = v; }
        }
      });
      if (isBatch) {
        hInput.addEventListener('focus', () => _captureShapeSnapshot('h', members));
        hInput.addEventListener('blur', () => _commitShapeSnapshot('h'));
        let dragStartBoundsPerMember = null;
        attachDragNumber(hInput,
          (delta) => {
            for (const m of members) { m.h = Math.max(10, m.h + delta); }
            hInput.value = String(Math.round(members[0].h));
          },
          () => {
            _commitShapeSnapshot('h');
            dragStartBoundsPerMember = members.map(m => ({ shapeId: m.id, bounds: { x: m.x, y: m.y, w: m.w, h: m.h } }));
          },
          () => {
            if (!dragStartBoundsPerMember) return;
            const changes = [];
            for (let i = 0; i < members.length; i++) {
              const fromB = dragStartBoundsPerMember[i].bounds;
              const toB = { x: members[i].x, y: members[i].y, w: members[i].w, h: members[i].h };
              if (fromB.h !== toB.h) changes.push({ shapeId: members[i].id, fromBounds: fromB, toBounds: toB });
            }
            if (changes.length > 0) history.push(createBatchResizeShapeCmd(state.shapes, state.selectedShapes, refreshSidePanel, changes));
          });
      } else {
        hInput.addEventListener('focus', () => { startShapePanelEdit(shapeId, 'h', s.h, { x: s.x, y: s.y, w: s.w, h: s.h }); });
        hInput.addEventListener('blur', () => { flushPanelEdit(); });
        let hDragStart = { x: s.x, y: s.y, w: s.w, h: s.h };
        attachDragNumber(hInput,
          (delta) => { s.h = Math.max(10, s.h + delta); hInput.value = String(Math.round(s.h)); },
          () => { flushPanelEdit(); hDragStart = { x: s.x, y: s.y, w: s.w, h: s.h }; },
          () => {
            if (s.h !== hDragStart.h) {
              history.push(createResizeShapeCmd(state.shapes, state.selectedShapes, refreshSidePanel, shapeId,
                { x: hDragStart.x, y: hDragStart.y, w: hDragStart.w, h: hDragStart.h },
                { x: s.x, y: s.y, w: s.w, h: s.h }));
            }
          });
      }
    }
    if (radiusInput) {
      radiusInput.setAttribute('data-drag-number', 'true');
      radiusInput.addEventListener('input', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!Number.isNaN(v) && v >= 0) {
          if (isBatch) { for (const m of members) m.cornerRadius = v; } else { s.cornerRadius = v; }
        }
      });
      if (isBatch) {
        radiusInput.addEventListener('focus', () => _captureShapeSnapshot('cornerRadius', members));
        radiusInput.addEventListener('blur', () => _commitShapeSnapshot('cornerRadius'));
        attachDragNumber(radiusInput,
          (delta) => {
            const v = Math.max(0, (members[0].cornerRadius ?? 4) + delta);
            for (const m of members) m.cornerRadius = v;
            radiusInput.value = String(Math.round(members[0].cornerRadius));
          }, () => {}, () => {});
      } else {
        radiusInput.addEventListener('focus', () => { startShapePanelEdit(shapeId, 'cornerRadius', s.cornerRadius); });
        radiusInput.addEventListener('blur', () => { flushPanelEdit(); });
        attachDragNumber(radiusInput,
          (delta) => { s.cornerRadius = Math.max(0, (s.cornerRadius ?? 4) + delta); radiusInput.value = String(Math.round(s.cornerRadius)); },
          () => { flushPanelEdit(); }, () => {});
      }
    }
    return;
  }

  // --- TextBoxes (single or multi, same UI) ---
  if (state.selectedTextBoxes.size >= 1) {
    flushPanelEdit();
    const indices = Array.from(state.selectedTextBoxes);
    const isBatch = indices.length > 1;
    const firstIdx = indices[0];
    const tb = state.textBoxes[firstIdx];
    const tbId = tb.id;
    const members = indices.map(i => state.textBoxes[i]);

    const colorMixed = isBatch && members.some(m => m.color !== tb.color);
    const borderColorMixed = isBatch && members.some(m => m.borderColor !== tb.borderColor);
    const textColorMixed = isBatch && members.some(m => m.textColor !== tb.textColor);
    const fontSizeMixed = isBatch && members.some(m => m.fontSize !== tb.fontSize);
    const wMixed = isBatch && members.some(m => m.w !== tb.w);
    const hMixed = isBatch && members.some(m => m.h !== tb.h);
    const textMixed = isBatch && members.some(m => m.text !== tb.text);

    const title = isBatch ? indices.length + ' text boxes selected' : 'Text Box';

    _sp( [
      '<div class="panel-section-title">' + title + '</div>',
      '<div class="panel-row"><label>Color</label><input id="panelTBColor" class="panel-input panel-input-color" type="color" value="' + state.escAttr(tb.color ?? '#1a1a1a') + '" /></div>',
      '<div class="panel-row"><label>Border</label><input id="panelTBBorderColor" class="panel-input panel-input-color" type="color" value="' + state.escAttr(tb.borderColor ?? '#444444') + '" /></div>',
      '<div class="panel-row"><label>Text Color</label><input id="panelTBTextColor" class="panel-input panel-input-color" type="color" value="' + state.escAttr(tb.textColor ?? '#dddddd') + '" /></div>',
      '<div class="panel-row"><label>Font Size</label><input id="panelTBFontSize" class="panel-input" type="number" min="8" max="72" value="' + (fontSizeMixed ? '' : (tb.fontSize ?? 14)) + '" placeholder="' + (fontSizeMixed ? '(mixed)' : '') + '" /></div>',
      '<div class="panel-row"><label>Width</label><input id="panelTBW" class="panel-input" type="number" min="10" value="' + (wMixed ? '' : tb.w) + '" placeholder="' + (wMixed ? '(mixed)' : '') + '" /></div>',
      '<div class="panel-row"><label>Height</label><input id="panelTBH" class="panel-input" type="number" min="10" value="' + (hMixed ? '' : tb.h) + '" placeholder="' + (hMixed ? '(mixed)' : '') + '" /></div>',
      '<div class="panel-md-editor" id="panelTBTextEditor">' +
        buildMarkdownToolbar() +
        '<div class="panel-md-editor-body">' +
          '<div id="panelTBTextRT" class="panel-md-richtext" contenteditable="true">' + (textMixed ? '' : blocksToHtml(getOrCreateBlocks(tb))) + '</div>' +
          '<textarea id="panelTBTextRaw" class="panel-input panel-textarea panel-md-raw" style="display:none" placeholder="' + (textMixed ? '(mixed)' : 'Enter text...') + '">' + (textMixed ? '' : state.escAttr(tb.text ?? '')) + '</textarea>' +
        '</div>' +
      '</div>',
    ].join(''));

    const colorInput = document.getElementById('panelTBColor');
    const borderColorInput = document.getElementById('panelTBBorderColor');
    const textColorInput = document.getElementById('panelTBTextColor');
    const fontSizeInput = document.getElementById('panelTBFontSize');
    const wInput = document.getElementById('panelTBW');
    const hInput = document.getElementById('panelTBH');
    if (colorInput) {
      colorInput.addEventListener('input', (ev) => {
        const v = ev.target.value;
        if (isBatch) { for (const m of members) m.color = v; } else { tb.color = v; }
      });
      if (isBatch) {
        colorInput.addEventListener('pointerdown', () => _captureTbSnapshot('color', members));
        colorInput.addEventListener('change', () => _commitTbSnapshot('color'));
      }
    }
    if (borderColorInput) {
      borderColorInput.addEventListener('input', (ev) => {
        const v = ev.target.value;
        if (isBatch) { for (const m of members) m.borderColor = v; } else { tb.borderColor = v; }
      });
      if (isBatch) {
        borderColorInput.addEventListener('pointerdown', () => _captureTbSnapshot('borderColor', members));
        borderColorInput.addEventListener('change', () => _commitTbSnapshot('borderColor'));
      }
    }
    if (textColorInput) {
      textColorInput.addEventListener('input', (ev) => {
        const v = ev.target.value;
        if (isBatch) { for (const m of members) m.textColor = v; } else { tb.textColor = v; }
      });
      if (isBatch) {
        textColorInput.addEventListener('pointerdown', () => _captureTbSnapshot('textColor', members));
        textColorInput.addEventListener('change', () => _commitTbSnapshot('textColor'));
      }
    }
    if (fontSizeInput) {
      fontSizeInput.addEventListener('input', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!Number.isNaN(v) && v >= 8) {
          if (isBatch) { for (const m of members) m.fontSize = v; } else { tb.fontSize = v; }
        }
      });
      if (isBatch) {
        fontSizeInput.addEventListener('focus', () => _captureTbSnapshot('fontSize', members));
        fontSizeInput.addEventListener('blur', () => _commitTbSnapshot('fontSize'));
      }
    }
    if (wInput) {
      wInput.addEventListener('input', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!Number.isNaN(v) && v >= 10) {
          if (isBatch) { for (const m of members) m.w = v; } else { tb.w = v; }
        }
      });
      if (isBatch) {
        wInput.addEventListener('focus', () => _captureTbSnapshot('w', members));
        wInput.addEventListener('blur', () => _commitTbSnapshot('w'));
        let dragStartBoundsPerMember = null;
        attachDragNumber(wInput,
          (delta) => { for (const m of members) { m.w = Math.max(10, m.w + delta); } wInput.value = String(Math.round(members[0].w)); },
          () => {
            _commitTbSnapshot('w');
            dragStartBoundsPerMember = members.map(m => ({ tbId: m.id, bounds: { x: m.x, y: m.y, w: m.w, h: m.h } }));
          },
          () => {
            if (!dragStartBoundsPerMember) return;
            const changes = [];
            for (let i = 0; i < members.length; i++) {
              const fromB = dragStartBoundsPerMember[i].bounds;
              const toB = { x: members[i].x, y: members[i].y, w: members[i].w, h: members[i].h };
              if (fromB.w !== toB.w) changes.push({ tbId: members[i].id, fromBounds: fromB, toBounds: toB });
            }
            if (changes.length > 0) history.push(createBatchResizeTextBoxCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, changes));
          });
      }
    }
    if (hInput) {
      hInput.addEventListener('input', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!Number.isNaN(v) && v >= 10) {
          if (isBatch) { for (const m of members) m.h = v; } else { tb.h = v; }
        }
      });
      if (isBatch) {
        hInput.addEventListener('focus', () => _captureTbSnapshot('h', members));
        hInput.addEventListener('blur', () => _commitTbSnapshot('h'));
        let dragStartBoundsPerMember = null;
        attachDragNumber(hInput,
          (delta) => { for (const m of members) { m.h = Math.max(10, m.h + delta); } hInput.value = String(Math.round(members[0].h)); },
          () => {
            _commitTbSnapshot('h');
            dragStartBoundsPerMember = members.map(m => ({ tbId: m.id, bounds: { x: m.x, y: m.y, w: m.w, h: m.h } }));
          },
          () => {
            if (!dragStartBoundsPerMember) return;
            const changes = [];
            for (let i = 0; i < members.length; i++) {
              const fromB = dragStartBoundsPerMember[i].bounds;
              const toB = { x: members[i].x, y: members[i].y, w: members[i].w, h: members[i].h };
              if (fromB.h !== toB.h) changes.push({ tbId: members[i].id, fromBounds: fromB, toBounds: toB });
            }
            if (changes.length > 0) history.push(createBatchResizeTextBoxCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, changes));
          });
      }
    }
    setupMarkdownEditor('panelTBText', {
      getText: () => tb.text ?? '',
      setText: (v) => {
        if (isBatch) { for (const m of members) { m.text = v; m.blocks = null; } } else { tb.text = v; tb.blocks = null; }
      },
      onFocus: isBatch ? (() => _captureTbSnapshot('text', members)) : null,
      onBlur: isBatch ? (() => _commitTbSnapshot('text')) : null,
      onChange: () => {},
    });
    return;
  }

  if (state.selectedConnectors.size === 1) {
    flushPanelEdit();
    _sp( '<div class="panel-section-title">' + state.selectedConnectors.size + ' connector selected</div>');
    return;
  }

  if (state.selectedConnectors.size > 1) {
    flushPanelEdit();
    _sp( '<div class="panel-section-title">' + state.selectedConnectors.size + ' connectors selected</div>');
    return;
  }

  if (state.selected.size === 0 && state.selectedShapes.size === 0 && state.selectedTextBoxes.size === 0 && state.selectedConnectors.size === 0) {
    flushPanelEdit();
    _sp( '<div class="panel-empty">Nothing selected</div>');
    return;
  }

  // --- Nodes (single or multi, same UI) ---
  flushPanelEdit(refreshSidePanel);
  const indices = Array.from(state.selected);
  const isBatch = indices.length > 1;
  const firstIdx = indices[0];
  const n = state.nodes[firstIdx];
  const nodeId = n.id;
  const members = indices.map(i => state.nodes[i]);

  const parentInfo = n.parentId !== null && n.parentId !== undefined
    ? (() => { const p = state.findNodeById(state.nodes, n.parentId); return p ? (p.node.title || `Node ${p.index}`) : '?'; })()
    : null;
  const parentHtml = parentInfo ? '<div class="panel-row"><label>Parent</label><span class="panel-static">' + state.escAttr(parentInfo) + '</span></div>' : '';

  const titleMixed = isBatch && members.some(m => m.title !== n.title);
  const titleColorMixed = isBatch && members.some(m => m.titleColor !== n.titleColor);
  const colorMixed = isBatch && members.some(m => m.color !== n.color);
  const textColorMixed = isBatch && members.some(m => m.textColor !== n.textColor);
  const fontSizeMixed = isBatch && members.some(m => m.fontSize !== n.fontSize);
  const wMixed = isBatch && members.some(m => m.w !== n.w);
  const hMixed = isBatch && members.some(m => m.h !== n.h);
  const textMixed = isBatch && members.some(m => m.text !== n.text);

  const sectionTitle = isBatch ? indices.length + ' nodes selected' : 'Node';

  _sp( [
    '<div class="panel-section-title">' + sectionTitle + '</div>',
    '<div class="panel-row"><label>Title</label><input id="panelTitle" class="panel-input" type="text" value="' + (titleMixed ? '' : state.escAttr(n.title ?? '')) + '" placeholder="' + (titleMixed ? '(mixed)' : state.escAttr(TITLE_PLACEHOLDER)) + '" /></div>',
    '<div class="panel-row"><label>Title Color</label><input id="panelTitleColor" class="panel-input panel-input-color" type="color" value="' + (n.titleColor ?? '#e7e7e7') + '" /></div>',
    '<div class="panel-row"><label>Color</label><input id="panelColor" class="panel-input panel-input-color" type="color" value="' + (n.color ?? '#1a1a1a') + '" /></div>',
    '<div class="panel-row"><label>Text Color</label><input id="panelTextColor" class="panel-input panel-input-color" type="color" value="' + (n.textColor ?? '#dddddd') + '" /></div>',
    '<div class="panel-row"><label>Font Size</label><input id="panelFontSize" class="panel-input" type="number" min="8" max="72" value="' + (fontSizeMixed ? '' : (n.fontSize ?? 12)) + '" placeholder="' + (fontSizeMixed ? '(mixed)' : '') + '" /></div>',
    '<div class="panel-row"><label>Width</label><input id="panelW" class="panel-input" type="number" min="10" value="' + (wMixed ? '' : n.w) + '" placeholder="' + (wMixed ? '(mixed)' : '') + '" /></div>',
    '<div class="panel-row"><label>Height</label><input id="panelH" class="panel-input" type="number" min="10" value="' + (hMixed ? '' : n.h) + '" placeholder="' + (hMixed ? '(mixed)' : '') + '" /></div>',
    parentHtml,
    '<div class="panel-md-editor" id="panelTextEditor">' +
      buildMarkdownToolbar() +
      '<div class="panel-md-editor-body">' +
        '<div id="panelTextRT" class="panel-md-richtext" contenteditable="true">' + (textMixed ? '' : blocksToHtml(getOrCreateBlocks(n))) + '</div>' +
        '<textarea id="panelTextRaw" class="panel-input panel-textarea panel-md-raw" style="display:none" placeholder="' + (textMixed ? '(mixed)' : state.escAttr(TEXT_PLACEHOLDER)) + '">' + (textMixed ? '' : state.escAttr(n.text ?? '')) + '</textarea>' +
      '</div>' +
    '</div>',
  ].join(''));

  const titleInput = document.getElementById('panelTitle');
  const titleColorInput = document.getElementById('panelTitleColor');
  const colorInput = document.getElementById('panelColor');
  const textColorInput = document.getElementById('panelTextColor');
  const fontSizeInput = document.getElementById('panelFontSize');
  const wInput = document.getElementById('panelW');
  const hInput = document.getElementById('panelH');

  if (titleInput) {
    titleInput.addEventListener('input', (ev) => {
      const v = ev.target.value;
      if (isBatch) { for (const m of members) m.title = v; } else { n.title = v; }
    });
    if (isBatch) {
      titleInput.addEventListener('focus', () => _captureNodeSnapshot('title', members));
      titleInput.addEventListener('blur', () => _commitNodeSnapshot('title'));
    } else {
      titleInput.addEventListener('focus', () => { startPanelEdit(nodeId, 'title', n.title); });
      titleInput.addEventListener('blur', () => { flushPanelEdit(refreshSidePanel); });
    }
  }
  if (titleColorInput) {
    titleColorInput.addEventListener('input', (ev) => {
      const v = ev.target.value;
      if (isBatch) { for (const m of members) m.titleColor = v; } else { n.titleColor = v; }
    });
    if (isBatch) {
      titleColorInput.addEventListener('pointerdown', () => _captureNodeSnapshot('titleColor', members));
      titleColorInput.addEventListener('change', () => _commitNodeSnapshot('titleColor'));
    } else {
      titleColorInput.addEventListener('pointerdown', () => { startPanelEdit(nodeId, 'titleColor', n.titleColor); });
      titleColorInput.addEventListener('change', () => { flushPanelEdit(refreshSidePanel); });
    }
  }
  if (colorInput) {
    colorInput.addEventListener('input', (ev) => {
      const v = ev.target.value;
      if (isBatch) { for (const m of members) m.color = v; } else { n.color = v; }
    });
    if (isBatch) {
      colorInput.addEventListener('pointerdown', () => _captureNodeSnapshot('color', members));
      colorInput.addEventListener('change', () => _commitNodeSnapshot('color'));
    } else {
      colorInput.addEventListener('pointerdown', () => { startPanelEdit(nodeId, 'color', n.color); });
      colorInput.addEventListener('change', () => { flushPanelEdit(refreshSidePanel); });
    }
  }
  if (textColorInput) {
    textColorInput.addEventListener('input', (ev) => {
      const v = ev.target.value;
      if (isBatch) { for (const m of members) m.textColor = v; } else { n.textColor = v; }
    });
    if (isBatch) {
      textColorInput.addEventListener('pointerdown', () => _captureNodeSnapshot('textColor', members));
      textColorInput.addEventListener('change', () => _commitNodeSnapshot('textColor'));
    } else {
      textColorInput.addEventListener('pointerdown', () => { startPanelEdit(nodeId, 'textColor', n.textColor); });
      textColorInput.addEventListener('change', () => { flushPanelEdit(refreshSidePanel); });
    }
  }
  if (fontSizeInput) {
    fontSizeInput.addEventListener('input', (ev) => {
      const v = parseFloat(ev.target.value);
      if (!Number.isNaN(v) && v >= 8) {
        if (isBatch) { for (const m of members) m.fontSize = v; } else { n.fontSize = v; }
      }
    });
    if (isBatch) {
      fontSizeInput.addEventListener('focus', () => _captureNodeSnapshot('fontSize', members));
      fontSizeInput.addEventListener('blur', () => _commitNodeSnapshot('fontSize'));
    } else {
      fontSizeInput.addEventListener('focus', () => { startPanelEdit(nodeId, 'fontSize', n.fontSize); });
      fontSizeInput.addEventListener('blur', () => { flushPanelEdit(refreshSidePanel); });
    }
  }
  if (wInput) {
    wInput.setAttribute('data-drag-number', 'true');
    wInput.addEventListener('input', (ev) => {
      const v = parseFloat(ev.target.value);
      if (!Number.isNaN(v)) {
        if (isBatch) { for (const m of members) updateNodeWidth(m, v); } else { updateNodeWidth(n, v); }
      }
    });
    if (isBatch) {
      wInput.addEventListener('focus', () => _captureNodeSnapshot('w', members));
      wInput.addEventListener('blur', () => _commitNodeSnapshot('w'));
      let dragStartBoundsPerMember = null;
      attachDragNumber(wInput,
        (delta) => {
          for (const m of members) { updateNodeWidth(m, Math.max(10, m.w + delta)); }
          wInput.value = String(Math.round(members[0].w));
        },
        () => {
          _commitNodeSnapshot('w');
          dragStartBoundsPerMember = members.map(m => ({ nodeId: m.id, bounds: { x: m.x, y: m.y, w: m.w, h: m.h } }));
        },
        () => {
          if (!dragStartBoundsPerMember) return;
          const changes = [];
          for (let i = 0; i < members.length; i++) {
            const fromB = dragStartBoundsPerMember[i].bounds;
            const toB = { x: members[i].x, y: members[i].y, w: members[i].w, h: members[i].h };
            if (fromB.w !== toB.w || fromB.x !== toB.x) changes.push({ nodeId: members[i].id, fromBounds: fromB, toBounds: toB });
          }
          if (changes.length > 0) history.push(createBatchResizeNodeCmd(state.nodes, state.selected, refreshSidePanel, changes));
        });
    } else {
      wInput.addEventListener('focus', () => { startPanelEdit(nodeId, 'w', n.w, { x: n.x, y: n.y, w: n.w, h: n.h }); });
      wInput.addEventListener('blur', () => { flushPanelEdit(refreshSidePanel); });
      let wDragStartBounds = { x: n.x, y: n.y, w: n.w, h: n.h };
      attachDragNumber(wInput,
        (delta) => { updateNodeWidth(n, n.w + delta); wInput.value = String(Math.round(n.w)); },
        () => {
          flushPanelEdit();
          const found = state.findNodeById(state.nodes, nodeId);
          if (found) wDragStartBounds = { x: found.node.x, y: found.node.y, w: found.node.w, h: found.node.h };
        },
        () => {
          const found = state.findNodeById(state.nodes, nodeId);
          if (found && (found.node.w !== wDragStartBounds.w || found.node.x !== wDragStartBounds.x)) {
            history.push(createResizeNodeCmd(state.nodes, state.selected, refreshSidePanel, nodeId,
              { x: wDragStartBounds.x, y: wDragStartBounds.y, w: wDragStartBounds.w, h: wDragStartBounds.h },
              { x: found.node.x, y: found.node.y, w: found.node.w, h: found.node.h }));
          }
        });
    }
  }
  if (hInput) {
    hInput.setAttribute('data-drag-number', 'true');
    hInput.addEventListener('input', (ev) => {
      const v = parseFloat(ev.target.value);
      if (!Number.isNaN(v)) {
        if (isBatch) { for (const m of members) updateNodeHeight(m, v); } else { updateNodeHeight(n, v); }
      }
    });
    if (isBatch) {
      hInput.addEventListener('focus', () => _captureNodeSnapshot('h', members));
      hInput.addEventListener('blur', () => _commitNodeSnapshot('h'));
      let dragStartBoundsPerMember = null;
      attachDragNumber(hInput,
        (delta) => {
          for (const m of members) { updateNodeHeight(m, Math.max(10, m.h + delta)); }
          hInput.value = String(Math.round(members[0].h));
        },
        () => {
          _commitNodeSnapshot('h');
          dragStartBoundsPerMember = members.map(m => ({ nodeId: m.id, bounds: { x: m.x, y: m.y, w: m.w, h: m.h } }));
        },
        () => {
          if (!dragStartBoundsPerMember) return;
          const changes = [];
          for (let i = 0; i < members.length; i++) {
            const fromB = dragStartBoundsPerMember[i].bounds;
            const toB = { x: members[i].x, y: members[i].y, w: members[i].w, h: members[i].h };
            if (fromB.h !== toB.h || fromB.y !== toB.y) changes.push({ nodeId: members[i].id, fromBounds: fromB, toBounds: toB });
          }
          if (changes.length > 0) history.push(createBatchResizeNodeCmd(state.nodes, state.selected, refreshSidePanel, changes));
        });
    } else {
      hInput.addEventListener('focus', () => { startPanelEdit(nodeId, 'h', n.h, { x: n.x, y: n.y, w: n.w, h: n.h }); });
      hInput.addEventListener('blur', () => { flushPanelEdit(refreshSidePanel); });
      let hDragStartBounds = { x: n.x, y: n.y, w: n.w, h: n.h };
      attachDragNumber(hInput,
        (delta) => { updateNodeHeight(n, n.h + delta); hInput.value = String(Math.round(n.h)); },
        () => {
          flushPanelEdit();
          const found = state.findNodeById(state.nodes, nodeId);
          if (found) hDragStartBounds = { x: found.node.x, y: found.node.y, w: found.node.w, h: found.node.h };
        },
        () => {
          const found = state.findNodeById(state.nodes, nodeId);
          if (found && (found.node.h !== hDragStartBounds.h || found.node.y !== hDragStartBounds.y)) {
            history.push(createResizeNodeCmd(state.nodes, state.selected, refreshSidePanel, nodeId,
              { x: hDragStartBounds.x, y: hDragStartBounds.y, w: hDragStartBounds.w, h: hDragStartBounds.h },
              { x: found.node.x, y: found.node.y, w: found.node.w, h: found.node.h }));
          }
        });
    }
  }
  setupMarkdownEditor('panelText', {
    getText: () => n.text ?? '',
    setText: (v) => {
      if (isBatch) { for (const m of members) { m.text = v; m.blocks = null; } } else { n.text = v; n.blocks = null; }
    },
    onFocus: isBatch ? (() => _captureNodeSnapshot('text', members)) : (() => { startPanelEdit(nodeId, 'text', n.text); }),
    onBlur: isBatch ? (() => _commitNodeSnapshot('text')) : (() => { flushPanelEdit(refreshSidePanel); }),
    onChange: () => {},
  });
}

function renderMixedEditor() {
  const parts = [];
  let prefixCounter = 0;

  if (state.selected.size > 0) {
    const indices = Array.from(state.selected);
    const members = indices.map(i => state.nodes[i]);
    const first = members[0];
    const prefix = 'mx' + (prefixCounter++);

    if (parts.length > 0) parts.push('<hr class="panel-group-divider" />');
    parts.push('<div class="panel-section-title">' + members.length + ' node' + (members.length > 1 ? 's' : '') + '</div>');
    appendNodeEditorHTML(parts, prefix, members, first);
  }

  if (state.selectedShapes.size > 0) {
    const indices = Array.from(state.selectedShapes);
    const members = indices.map(i => state.shapes[i]);
    const first = members[0];
    const prefix = 'mx' + (prefixCounter++);

    if (parts.length > 0) parts.push('<hr class="panel-group-divider" />');
    parts.push('<div class="panel-section-title">' + members.length + ' shape' + (members.length > 1 ? 's' : '') + ' (' + state.escAttr(first.shapeType) + ')</div>');
    appendShapeEditorHTML(parts, prefix, members, first);
  }

  if (state.selectedTextBoxes.size > 0) {
    const indices = Array.from(state.selectedTextBoxes);
    const members = indices.map(i => state.textBoxes[i]);
    const first = members[0];
    const prefix = 'mx' + (prefixCounter++);

    if (parts.length > 0) parts.push('<hr class="panel-group-divider" />');
    parts.push('<div class="panel-section-title">' + members.length + ' text box' + (members.length > 1 ? 'es' : '') + '</div>');
    appendTextBoxEditorHTML(parts, prefix, members, first);
  }

  if (state.selectedArrows.size > 0) {
    const members = Array.from(state.selectedArrows).map(i => state.arrows[i]);
    const prefix = 'mx' + (prefixCounter++);

    if (parts.length > 0) parts.push('<hr class="panel-group-divider" />');
    parts.push('<div class="panel-section-title">' + members.length + ' arrow' + (members.length > 1 ? 's' : '') + '</div>');
    const colorMixed = members.some(m => m.color !== members[0].color);
    parts.push(
      '<div class="panel-row"><label>Color</label><input id="' + prefix + '_color" class="panel-input" type="color" value="' + state.escAttr(members[0].color || '#6bb5ff') + '" /></div>'
    );
  }

  if (state.selectedConnection !== null && state.connections[state.selectedConnection]) {
    const conn = state.connections[state.selectedConnection];
    const prefix = 'mx' + (prefixCounter++);

    if (parts.length > 0) parts.push('<hr class="panel-group-divider" />');
    parts.push('<div class="panel-section-title">Connection</div>');
    const fromNode = state.nodes[conn.from];
    const toNode = state.nodes[conn.to];
    const fromLabel = fromNode ? (fromNode.title || 'Node ' + conn.from) : '?';
    const toLabel = toNode ? (toNode.title || 'Node ' + conn.to) : '?';
    parts.push(
      '<div class="panel-row"><label>From</label><span class="panel-static">' + state.escAttr(fromLabel) + '</span></div>',
      '<div class="panel-row"><label>To</label><span class="panel-static">' + state.escAttr(toLabel) + '</span></div>',
      '<div class="panel-row"><label>Color</label><input id="' + prefix + '_color" class="panel-input" type="color" value="' + state.escAttr(conn.color || '#6bb5ff') + '" /></div>',
      '<div class="panel-row"><label>Text</label><input id="' + prefix + '_text" class="panel-input" type="text" value="' + state.escAttr(conn.text ?? '') + '" /></div>'
    );
  }

  if (state.selectedConnectors.size > 0) {
    if (parts.length > 0) parts.push('<hr class="panel-group-divider" />');
    parts.push('<div class="panel-section-title">' + state.selectedConnectors.size + ' connector' + (state.selectedConnectors.size > 1 ? 's' : '') + '</div>');
  }

  _sp(parts.join(''));

  prefixCounter = 0;
  if (state.selected.size > 0) {
    const members = Array.from(state.selected).map(i => state.nodes[i]);
    wireBatchNodeGroup('mx' + (prefixCounter++), members);
  }
  if (state.selectedShapes.size > 0) {
    const members = Array.from(state.selectedShapes).map(i => state.shapes[i]);
    wireMixedShapeGroup('mx' + (prefixCounter++), members);
  }
  if (state.selectedTextBoxes.size > 0) {
    const members = Array.from(state.selectedTextBoxes).map(i => state.textBoxes[i]);
    wireMixedTBGroup('mx' + (prefixCounter++), members);
  }
  if (state.selectedArrows.size > 0) {
    const members = Array.from(state.selectedArrows).map(i => state.arrows[i]);
    const prefix = 'mx' + (prefixCounter++);
    const ci = document.getElementById(prefix + '_color');
    if (ci) {
      ci.addEventListener('input', (ev) => { for (const m of members) m.color = ev.target.value; });
    }
  }
  if (state.selectedConnection !== null && state.connections[state.selectedConnection]) {
    const conn = state.connections[state.selectedConnection];
    const prefix = 'mx' + (prefixCounter++);
    const ci = document.getElementById(prefix + '_color');
    const ti = document.getElementById(prefix + '_text');
    if (ci) ci.addEventListener('input', (ev) => { conn.color = ev.target.value; });
    if (ti) ti.addEventListener('input', (ev) => { conn.text = ev.target.value; });
  }
}

function appendNodeEditorHTML(parts, prefix, members, first) {
  const titleMixed = members.some(m => m.title !== first.title);
  const textMixed = members.some(m => m.text !== first.text);
  const fontSizeMixed = members.some(m => m.fontSize !== first.fontSize);
  const wMixed = members.some(m => m.w !== first.w);
  const hMixed = members.some(m => m.h !== first.h);

  parts.push(
    '<div class="panel-row"><label>Title</label><input id="' + prefix + '_title" class="panel-input" type="text" value="' + (titleMixed ? '' : state.escAttr(first.title ?? '')) + '" placeholder="' + (titleMixed ? '(mixed)' : state.escAttr(TITLE_PLACEHOLDER)) + '" /></div>',
    '<div class="panel-row"><label>Title Color</label><input id="' + prefix + '_titleColor" class="panel-input panel-input-color" type="color" value="' + (first.titleColor ?? '#e7e7e7') + '" /></div>',
    '<div class="panel-row"><label>Color</label><input id="' + prefix + '_color" class="panel-input panel-input-color" type="color" value="' + (first.color ?? '#1a1a1a') + '" /></div>',
    '<div class="panel-row"><label>Text Color</label><input id="' + prefix + '_textColor" class="panel-input panel-input-color" type="color" value="' + (first.textColor ?? '#dddddd') + '" /></div>',
    '<div class="panel-row"><label>Font Size</label><input id="' + prefix + '_fontSize" class="panel-input" type="number" min="8" max="72" value="' + (fontSizeMixed ? '' : (first.fontSize ?? 12)) + '" placeholder="' + (fontSizeMixed ? '(mixed)' : '') + '" /></div>',
    '<div class="panel-row"><label>Width</label><input id="' + prefix + '_w" class="panel-input" type="number" min="10" value="' + (wMixed ? '' : first.w) + '" placeholder="' + (wMixed ? '(mixed)' : '') + '" /></div>',
    '<div class="panel-row"><label>Height</label><input id="' + prefix + '_h" class="panel-input" type="number" min="10" value="' + (hMixed ? '' : first.h) + '" placeholder="' + (hMixed ? '(mixed)' : '') + '" /></div>',
    '<div class="panel-md-editor" id="' + prefix + '_textEditor">' +
      buildMarkdownToolbar() +
      '<div class="panel-md-editor-body">' +
        '<div id="' + prefix + '_textRT" class="panel-md-richtext" contenteditable="true">' + (textMixed ? '' : blocksToHtml(getOrCreateBlocks(first))) + '</div>' +
        '<textarea id="' + prefix + '_textRaw" class="panel-input panel-textarea panel-md-raw" style="display:none" placeholder="' + (textMixed ? '(mixed)' : state.escAttr(TEXT_PLACEHOLDER)) + '">' + (textMixed ? '' : state.escAttr(first.text ?? '')) + '</textarea>' +
      '</div>' +
    '</div>'
  );
}

function appendShapeEditorHTML(parts, prefix, members, first) {
  const isRect = first.shapeType === 'rectangle';
  const wMixed = members.some(m => m.w !== first.w);
  const hMixed = members.some(m => m.h !== first.h);
  const bwMixed = members.some(m => m.borderWidth !== first.borderWidth);
  const rMixed = isRect && members.some(m => m.cornerRadius !== first.cornerRadius);

  parts.push(
    '<div class="panel-row"><label>Color</label><input id="' + prefix + '_color" class="panel-input panel-input-color" type="color" value="' + (first.color ?? '#2b2b2b') + '" /></div>',
    '<div class="panel-row"><label>Border</label><input id="' + prefix + '_borderColor" class="panel-input panel-input-color" type="color" value="' + (first.borderColor ?? '#6bb5ff') + '" /></div>',
    '<div class="panel-row"><label>Border W</label><input id="' + prefix + '_borderWidth" class="panel-input" type="number" min="0" max="20" step="0.5" value="' + (bwMixed ? '' : (first.borderWidth ?? 2)) + '" placeholder="' + (bwMixed ? '(mixed)' : '') + '" /></div>',
    '<div class="panel-row"><label>Width</label><input id="' + prefix + '_w" class="panel-input" type="number" min="10" value="' + (wMixed ? '' : first.w) + '" placeholder="' + (wMixed ? '(mixed)' : '') + '" /></div>',
    '<div class="panel-row"><label>Height</label><input id="' + prefix + '_h" class="panel-input" type="number" min="10" value="' + (hMixed ? '' : first.h) + '" placeholder="' + (hMixed ? '(mixed)' : '') + '" /></div>',
    (isRect ? '<div class="panel-row"><label>Radius</label><input id="' + prefix + '_cornerRadius" class="panel-input" type="number" min="0" max="200" value="' + (rMixed ? '' : (first.cornerRadius ?? 4)) + '" placeholder="' + (rMixed ? '(mixed)' : '') + '" /></div>' : '')
  );
}

function appendTextBoxEditorHTML(parts, prefix, members, first) {
  const textMixed = members.some(m => m.text !== first.text);
  const fontSizeMixed = members.some(m => m.fontSize !== first.fontSize);
  const wMixed = members.some(m => m.w !== first.w);
  const hMixed = members.some(m => m.h !== first.h);

  parts.push(
    '<div class="panel-row"><label>Color</label><input id="' + prefix + '_color" class="panel-input panel-input-color" type="color" value="' + (first.color ?? '#1a1a1a') + '" /></div>',
    '<div class="panel-row"><label>Border</label><input id="' + prefix + '_borderColor" class="panel-input panel-input-color" type="color" value="' + (first.borderColor ?? '#444444') + '" /></div>',
    '<div class="panel-row"><label>Text Color</label><input id="' + prefix + '_textColor" class="panel-input panel-input-color" type="color" value="' + (first.textColor ?? '#dddddd') + '" /></div>',
    '<div class="panel-row"><label>Font Size</label><input id="' + prefix + '_fontSize" class="panel-input" type="number" min="8" max="72" value="' + (fontSizeMixed ? '' : (first.fontSize ?? 14)) + '" placeholder="' + (fontSizeMixed ? '(mixed)' : '') + '" /></div>',
    '<div class="panel-row"><label>Width</label><input id="' + prefix + '_w" class="panel-input" type="number" min="10" value="' + (wMixed ? '' : first.w) + '" placeholder="' + (wMixed ? '(mixed)' : '') + '" /></div>',
    '<div class="panel-row"><label>Height</label><input id="' + prefix + '_h" class="panel-input" type="number" min="10" value="' + (hMixed ? '' : first.h) + '" placeholder="' + (hMixed ? '(mixed)' : '') + '" /></div>',
    '<div class="panel-md-editor" id="' + prefix + '_textEditor">' +
      buildMarkdownToolbar() +
      '<div class="panel-md-editor-body">' +
        '<div id="' + prefix + '_textRT" class="panel-md-richtext" contenteditable="true">' + (textMixed ? '' : blocksToHtml(getOrCreateBlocks(first))) + '</div>' +
        '<textarea id="' + prefix + '_textRaw" class="panel-input panel-textarea panel-md-raw" style="display:none" placeholder="' + (textMixed ? '(mixed)' : 'Enter text...') + '">' + (textMixed ? '' : state.escAttr(first.text ?? '')) + '</textarea>' +
      '</div>' +
    '</div>'
  );
}

function wireBatchNodeGroup(prefix, members) {
  const titleInput = document.getElementById(prefix + '_title');
  const titleColorInput = document.getElementById(prefix + '_titleColor');
  const colorInput = document.getElementById(prefix + '_color');
  const textColorInput = document.getElementById(prefix + '_textColor');
  const fontSizeInput = document.getElementById(prefix + '_fontSize');
  const wInput = document.getElementById(prefix + '_w');
  const hInput = document.getElementById(prefix + '_h');

  if (titleInput) {
    titleInput.addEventListener('input', (ev) => { for (const m of members) m.title = ev.target.value; });
    titleInput.addEventListener('focus', () => _captureNodeSnapshot('title', members));
    titleInput.addEventListener('blur', () => _commitNodeSnapshot('title'));
  }
  if (titleColorInput) {
    titleColorInput.addEventListener('input', (ev) => { for (const m of members) m.titleColor = ev.target.value; });
    titleColorInput.addEventListener('pointerdown', () => _captureNodeSnapshot('titleColor', members));
    titleColorInput.addEventListener('change', () => _commitNodeSnapshot('titleColor'));
  }
  if (colorInput) {
    colorInput.addEventListener('input', (ev) => { for (const m of members) m.color = ev.target.value; });
    colorInput.addEventListener('pointerdown', () => _captureNodeSnapshot('color', members));
    colorInput.addEventListener('change', () => _commitNodeSnapshot('color'));
  }
  if (textColorInput) {
    textColorInput.addEventListener('input', (ev) => { for (const m of members) m.textColor = ev.target.value; });
    textColorInput.addEventListener('pointerdown', () => _captureNodeSnapshot('textColor', members));
    textColorInput.addEventListener('change', () => _commitNodeSnapshot('textColor'));
  }
  if (fontSizeInput) {
    fontSizeInput.addEventListener('input', (ev) => {
      const v = parseFloat(ev.target.value);
      if (!Number.isNaN(v) && v >= 8) for (const m of members) m.fontSize = v;
    });
    fontSizeInput.addEventListener('focus', () => _captureNodeSnapshot('fontSize', members));
    fontSizeInput.addEventListener('blur', () => _commitNodeSnapshot('fontSize'));
  }
  if (wInput) {
    wInput.setAttribute('data-drag-number', 'true');
    wInput.addEventListener('input', (ev) => {
      const v = parseFloat(ev.target.value);
      if (!Number.isNaN(v)) for (const m of members) updateNodeWidth(m, v);
    });
    wInput.addEventListener('focus', () => _captureNodeSnapshot('w', members));
    wInput.addEventListener('blur', () => _commitNodeSnapshot('w'));
    let ds = null;
    attachDragNumber(wInput,
      (delta) => { for (const m of members) { updateNodeWidth(m, Math.max(10, m.w + delta)); } wInput.value = String(Math.round(members[0].w)); },
      () => { _commitNodeSnapshot('w'); ds = members.map(m => ({ nodeId: m.id, bounds: { x: m.x, y: m.y, w: m.w, h: m.h } })); },
      () => {
        if (!ds) return;
        const ch = [];
        for (let i = 0; i < members.length; i++) {
          const fb = ds[i].bounds, tb = { x: members[i].x, y: members[i].y, w: members[i].w, h: members[i].h };
          if (fb.w !== tb.w || fb.x !== tb.x) ch.push({ nodeId: members[i].id, fromBounds: fb, toBounds: tb });
        }
        if (ch.length > 0) history.push(createBatchResizeNodeCmd(state.nodes, state.selected, refreshSidePanel, ch));
      });
  }
  if (hInput) {
    hInput.setAttribute('data-drag-number', 'true');
    hInput.addEventListener('input', (ev) => {
      const v = parseFloat(ev.target.value);
      if (!Number.isNaN(v)) for (const m of members) updateNodeHeight(m, v);
    });
    hInput.addEventListener('focus', () => _captureNodeSnapshot('h', members));
    hInput.addEventListener('blur', () => _commitNodeSnapshot('h'));
    let ds = null;
    attachDragNumber(hInput,
      (delta) => { for (const m of members) { updateNodeHeight(m, Math.max(10, m.h + delta)); } hInput.value = String(Math.round(members[0].h)); },
      () => { _commitNodeSnapshot('h'); ds = members.map(m => ({ nodeId: m.id, bounds: { x: m.x, y: m.y, w: m.w, h: m.h } })); },
      () => {
        if (!ds) return;
        const ch = [];
        for (let i = 0; i < members.length; i++) {
          const fb = ds[i].bounds, tb = { x: members[i].x, y: members[i].y, w: members[i].w, h: members[i].h };
          if (fb.h !== tb.h || fb.y !== tb.y) ch.push({ nodeId: members[i].id, fromBounds: fb, toBounds: tb });
        }
        if (ch.length > 0) history.push(createBatchResizeNodeCmd(state.nodes, state.selected, refreshSidePanel, ch));
      });
  }
  setupMarkdownEditor(prefix + '_text', {
    getText: () => members[0]?.text ?? '',
    setText: (v) => { for (const m of members) { m.text = v; m.blocks = null; } },
    onFocus: () => _captureNodeSnapshot('text', members),
    onBlur: () => _commitNodeSnapshot('text'),
    onChange: () => {},
  });
}

function wireMixedShapeGroup(prefix, members) {
  const colorInput = document.getElementById(prefix + '_color');
  const borderColorInput = document.getElementById(prefix + '_borderColor');
  const borderWidthInput = document.getElementById(prefix + '_borderWidth');
  const wInput = document.getElementById(prefix + '_w');
  const hInput = document.getElementById(prefix + '_h');
  const radiusInput = document.getElementById(prefix + '_cornerRadius');

  if (colorInput) {
    colorInput.addEventListener('input', (ev) => { for (const m of members) m.color = ev.target.value; state.lastShapeColor = ev.target.value; });
    colorInput.addEventListener('pointerdown', () => _captureShapeSnapshot('color', members));
    colorInput.addEventListener('change', () => _commitShapeSnapshot('color'));
  }
  if (borderColorInput) {
    borderColorInput.addEventListener('input', (ev) => { for (const m of members) m.borderColor = ev.target.value; state.lastShapeBorderColor = ev.target.value; });
    borderColorInput.addEventListener('pointerdown', () => _captureShapeSnapshot('borderColor', members));
    borderColorInput.addEventListener('change', () => _commitShapeSnapshot('borderColor'));
  }
  if (borderWidthInput) {
    borderWidthInput.addEventListener('input', (ev) => {
      const v = parseFloat(ev.target.value);
      if (!Number.isNaN(v) && v >= 0) for (const m of members) m.borderWidth = v;
    });
    borderWidthInput.addEventListener('focus', () => _captureShapeSnapshot('borderWidth', members));
    borderWidthInput.addEventListener('blur', () => _commitShapeSnapshot('borderWidth'));
  }
  if (wInput) {
    wInput.setAttribute('data-drag-number', 'true');
    wInput.addEventListener('input', (ev) => {
      const v = parseFloat(ev.target.value);
      if (!Number.isNaN(v) && v >= 10) for (const m of members) m.w = v;
    });
    wInput.addEventListener('focus', () => _captureShapeSnapshot('w', members));
    wInput.addEventListener('blur', () => _commitShapeSnapshot('w'));
    let ds = null;
    attachDragNumber(wInput,
      (delta) => { for (const m of members) { m.w = Math.max(10, m.w + delta); } wInput.value = String(Math.round(members[0].w)); },
      () => { _commitShapeSnapshot('w'); ds = members.map(m => ({ shapeId: m.id, bounds: { x: m.x, y: m.y, w: m.w, h: m.h } })); },
      () => {
        if (!ds) return;
        const ch = [];
        for (let i = 0; i < members.length; i++) {
          const fb = ds[i].bounds, tb = { x: members[i].x, y: members[i].y, w: members[i].w, h: members[i].h };
          if (fb.w !== tb.w) ch.push({ shapeId: members[i].id, fromBounds: fb, toBounds: tb });
        }
        if (ch.length > 0) history.push(createBatchResizeShapeCmd(state.shapes, state.selectedShapes, refreshSidePanel, ch));
      });
  }
  if (hInput) {
    hInput.setAttribute('data-drag-number', 'true');
    hInput.addEventListener('input', (ev) => {
      const v = parseFloat(ev.target.value);
      if (!Number.isNaN(v) && v >= 10) for (const m of members) m.h = v;
    });
    hInput.addEventListener('focus', () => _captureShapeSnapshot('h', members));
    hInput.addEventListener('blur', () => _commitShapeSnapshot('h'));
    let ds = null;
    attachDragNumber(hInput,
      (delta) => { for (const m of members) { m.h = Math.max(10, m.h + delta); } hInput.value = String(Math.round(members[0].h)); },
      () => { _commitShapeSnapshot('h'); ds = members.map(m => ({ shapeId: m.id, bounds: { x: m.x, y: m.y, w: m.w, h: m.h } })); },
      () => {
        if (!ds) return;
        const ch = [];
        for (let i = 0; i < members.length; i++) {
          const fb = ds[i].bounds, tb = { x: members[i].x, y: members[i].y, w: members[i].w, h: members[i].h };
          if (fb.h !== tb.h) ch.push({ shapeId: members[i].id, fromBounds: fb, toBounds: tb });
        }
        if (ch.length > 0) history.push(createBatchResizeShapeCmd(state.shapes, state.selectedShapes, refreshSidePanel, ch));
      });
  }
  if (radiusInput) {
    radiusInput.addEventListener('input', (ev) => {
      const v = parseFloat(ev.target.value);
      if (!Number.isNaN(v) && v >= 0) for (const m of members) m.cornerRadius = v;
    });
    radiusInput.addEventListener('focus', () => _captureShapeSnapshot('cornerRadius', members));
    radiusInput.addEventListener('blur', () => _commitShapeSnapshot('cornerRadius'));
    attachDragNumber(radiusInput,
      (delta) => {
        const v = Math.max(0, (members[0].cornerRadius ?? 4) + delta);
        for (const m of members) m.cornerRadius = v;
        radiusInput.value = String(Math.round(members[0].cornerRadius));
      }, () => {}, () => {});
  }
}

function wireMixedTBGroup(prefix, members) {
  const colorInput = document.getElementById(prefix + '_color');
  const borderColorInput = document.getElementById(prefix + '_borderColor');
  const textColorInput = document.getElementById(prefix + '_textColor');
  const fontSizeInput = document.getElementById(prefix + '_fontSize');
  const wInput = document.getElementById(prefix + '_w');
  const hInput = document.getElementById(prefix + '_h');

  if (colorInput) {
    colorInput.addEventListener('input', (ev) => { for (const m of members) m.color = ev.target.value; });
    colorInput.addEventListener('pointerdown', () => _captureTbSnapshot('color', members));
    colorInput.addEventListener('change', () => _commitTbSnapshot('color'));
  }
  if (borderColorInput) {
    borderColorInput.addEventListener('input', (ev) => { for (const m of members) m.borderColor = ev.target.value; });
    borderColorInput.addEventListener('pointerdown', () => _captureTbSnapshot('borderColor', members));
    borderColorInput.addEventListener('change', () => _commitTbSnapshot('borderColor'));
  }
  if (textColorInput) {
    textColorInput.addEventListener('input', (ev) => { for (const m of members) m.textColor = ev.target.value; });
    textColorInput.addEventListener('pointerdown', () => _captureTbSnapshot('textColor', members));
    textColorInput.addEventListener('change', () => _commitTbSnapshot('textColor'));
  }
  if (fontSizeInput) {
    fontSizeInput.addEventListener('input', (ev) => {
      const v = parseFloat(ev.target.value);
      if (!Number.isNaN(v) && v >= 8) for (const m of members) m.fontSize = v;
    });
    fontSizeInput.addEventListener('focus', () => _captureTbSnapshot('fontSize', members));
    fontSizeInput.addEventListener('blur', () => _commitTbSnapshot('fontSize'));
  }
  if (wInput) {
    wInput.addEventListener('input', (ev) => {
      const v = parseFloat(ev.target.value);
      if (!Number.isNaN(v) && v >= 10) for (const m of members) m.w = v;
    });
    wInput.addEventListener('focus', () => _captureTbSnapshot('w', members));
    wInput.addEventListener('blur', () => _commitTbSnapshot('w'));
    let ds = null;
    attachDragNumber(wInput,
      (delta) => { for (const m of members) { m.w = Math.max(10, m.w + delta); } wInput.value = String(Math.round(members[0].w)); },
      () => { _commitTbSnapshot('w'); ds = members.map(m => ({ tbId: m.id, bounds: { x: m.x, y: m.y, w: m.w, h: m.h } })); },
      () => {
        if (!ds) return;
        const ch = [];
        for (let i = 0; i < members.length; i++) {
          const fb = ds[i].bounds, tb = { x: members[i].x, y: members[i].y, w: members[i].w, h: members[i].h };
          if (fb.w !== tb.w) ch.push({ tbId: members[i].id, fromBounds: fb, toBounds: tb });
        }
        if (ch.length > 0) history.push(createBatchResizeTextBoxCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, ch));
      });
  }
  if (hInput) {
    hInput.addEventListener('input', (ev) => {
      const v = parseFloat(ev.target.value);
      if (!Number.isNaN(v) && v >= 10) for (const m of members) m.h = v;
    });
    hInput.addEventListener('focus', () => _captureTbSnapshot('h', members));
    hInput.addEventListener('blur', () => _commitTbSnapshot('h'));
    let ds = null;
    attachDragNumber(hInput,
      (delta) => { for (const m of members) { m.h = Math.max(10, m.h + delta); } hInput.value = String(Math.round(members[0].h)); },
      () => { _commitTbSnapshot('h'); ds = members.map(m => ({ tbId: m.id, bounds: { x: m.x, y: m.y, w: m.w, h: m.h } })); },
      () => {
        if (!ds) return;
        const ch = [];
        for (let i = 0; i < members.length; i++) {
          const fb = ds[i].bounds, tb = { x: members[i].x, y: members[i].y, w: members[i].w, h: members[i].h };
          if (fb.h !== tb.h) ch.push({ tbId: members[i].id, fromBounds: fb, toBounds: tb });
        }
        if (ch.length > 0) history.push(createBatchResizeTextBoxCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, ch));
      });
  }
  setupMarkdownEditor(prefix + '_text', {
    getText: () => members[0]?.text ?? '',
    setText: (v) => { for (const m of members) { m.text = v; m.blocks = null; } },
    onFocus: () => _captureTbSnapshot('text', members),
    onBlur: () => _commitTbSnapshot('text'),
    onChange: () => {},
  });
}

function updateNodeWidth(n, newWidth) {
  const minW = 100;
  const targetW = Math.max(minW, newWidth);
  const delta = targetW - n.w;
  if (delta === 0) return;
  n.x -= delta / 2;
  n.w = targetW;
  state.markDrawOrderDirty();
}

function updateNodeHeight(n, newHeight) {
  const minH = 60;
  const targetH = Math.max(minH, newHeight);
  const delta = targetH - n.h;
  if (delta === 0) return;
  n.y -= delta / 2;
  n.h = targetH;
  state.markDrawOrderDirty();
}

function attachDragNumber(inputEl, onDelta, onDragStart, onDragEnd) {
  let isDragging = false;
  let startX = 0;
  let accum = 0;
  let dragDistance = 0;
  const step = 1;
  const DRAG_THRESHOLD = 5;

  const down = (e) => {
    if (e.button !== 0) return;
    isDragging = false;
    dragDistance = 0;
    startX = e.clientX;
    accum = 0;
    inputEl.setPointerCapture(e.pointerId);
  };

  const move = (e) => {
    if (!inputEl.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - startX;
    dragDistance += Math.abs(dx);
    startX = e.clientX;
    if (dragDistance > DRAG_THRESHOLD) {
      if (!isDragging) {
        isDragging = true;
        if (onDragStart) onDragStart();
        inputEl.blur();
      }
      accum += dx * step;
      if (Math.abs(accum) >= 1) {
        const delta = Math.trunc(accum);
        accum -= delta;
        onDelta(delta);
      }
      e.preventDefault();
    }
  };

  const up = (e) => {
    if (!inputEl.hasPointerCapture) return;
    try { inputEl.releasePointerCapture(e.pointerId); } catch {}
    if (isDragging) {
      if (onDragEnd) onDragEnd();
    } else {
      inputEl.focus();
      inputEl.select();
    }
    isDragging = false;
  };

  inputEl.addEventListener('pointerdown', down);
  inputEl.addEventListener('pointermove', move);
  inputEl.addEventListener('pointerup', up);
}
