import { state } from './state.js';
import { history, flushPanelEdit, startPanelEdit, startShapePanelEdit, startTextBoxPanelEdit, startArrowPanelEdit, startConnectionPanelEdit } from './history.js';
import { colorSwatchHTML, initColorSwatch } from './color-palette.js';
import {
  createResizeShapeCmd, createResizeTextBoxCmd,
  createBatchShapePropertyChangeCmd, createBatchResizeShapeCmd,
  createBatchTextBoxPropertyChangeCmd, createBatchResizeTextBoxCmd
} from './undo.js';
import { addImageToShape, removeImageFromShape, openImageInShape } from './document.js';
import { getArrowEndpoint } from './arrows.js';
import { tiptapToMarkdown, markdownToTiptap } from './editor/editor-serialization.js';
import { createEditor } from './editor/editor-core.js';
import { getToolbarActions, buildToolbarHtml } from './editor/editor-toolbar.js';
import { TITLE_PLACEHOLDER, TEXT_PLACEHOLDER } from './config.js';

function buildMarkdownToolbar() {
  return buildToolbarHtml();
}

function _sp(html) {
  const panel = state.sidePanelContent;
  _cleanupPanelEditors();
  panel.innerHTML = html;
}

function _cleanupPanelEditors() {
  const panel = state.sidePanelContent;
  if (!panel) return;
  const editors = panel.querySelectorAll('.panel-md-richtext');
  for (const el of editors) {
    if (el._tiptapEditor) {
      try { el._tiptapEditor.destroy(); } catch (_) {}
      el._tiptapEditor = null;
    }
  }
  const toolbars = panel.querySelectorAll('.panel-md-toolbar');
  for (const tb of toolbars) {
    if (tb._wireCleanup) {
      try { tb._wireCleanup.off(); } catch (_) {}
      tb._wireCleanup = null;
    }
  }
}

function setupMarkdownEditor(editorId, opts) {
  const editorEl = document.getElementById(editorId + 'Editor');
  if (!editorEl) return;

  const editorBody = editorEl.querySelector('.panel-md-editor-body');
  if (!editorBody) return;

  const toolbarEl = editorEl.querySelector('.panel-md-toolbar');

  let editor = null;
  let rawTa = null;
  let isRichText = (state.panelTextMode !== 'raw');
  let isDestroyed = false;

  function getTextFromEntity() {
    return opts.getText ? opts.getText() : '';
  }

  function setTextOnEntity(v) {
    if (opts.setText) opts.setText(v);
  }

  function syncToEntity() {
    if (isDestroyed) return;
    if (isRichText && editor && !editor.isDestroyed) {
      const doc = editor.getJSON();
      const md = tiptapToMarkdown(doc);
      setTextOnEntity(md);
    } else if (!isRichText && rawTa) {
      setTextOnEntity(rawTa.value);
    }
    if (opts.onChange) opts.onChange();
  }

  function buildRichMode() {
    editorBody.innerHTML = '';
    rawTa = null;

    const editorDiv = document.createElement('div');
    editorDiv.className = 'panel-md-richtext';
    editorBody.appendChild(editorDiv);

    editor = createEditor({
      element: editorDiv,
      content: markdownToTiptap(getTextFromEntity()),
      editable: true,
      onUpdate: () => {
        syncToEntity();
      },
      onFocus: () => {
        if (opts.onFocus) opts.onFocus();
      },
      onBlur: () => {
        if (opts.onBlur) opts.onBlur();
      },
    });

    editorDiv._tiptapEditor = editor;

    if (toolbarEl) {
      wireToolbar(toolbarEl, editor, () => switchMode(!isRichText));
    }
  }

  function buildRawMode(text) {
    editorBody.innerHTML = '';
    if (editor && !editor.isDestroyed) editor.destroy();
    editor = null;

    rawTa = document.createElement('textarea');
    rawTa.className = 'panel-input panel-textarea panel-md-raw';
    rawTa.placeholder = TEXT_PLACEHOLDER;
    rawTa.value = text || '';
    editorBody.appendChild(rawTa);

    rawTa.addEventListener('input', () => {
      syncToEntity();
    });

    rawTa.addEventListener('focus', () => {
      if (opts.onFocus) opts.onFocus();
    });

    rawTa.addEventListener('blur', () => {
      syncToEntity();
      if (opts.onBlur) opts.onBlur();
    });

    if (isRichText) {
      rawTa.focus();
    }

    if (toolbarEl) {
      wireToolbar(toolbarEl, null, () => switchMode(!isRichText));
    }
  }

  function switchMode(toRich) {
    if (toRich === isRichText) return;
    const text = isRichText
      ? (editor && !editor.isDestroyed ? tiptapToMarkdown(editor.getJSON()) : getTextFromEntity())
      : (rawTa ? rawTa.value : getTextFromEntity());

    isRichText = toRich;
    state.panelTextMode = toRich ? 'rich' : 'raw';
    setTextOnEntity(text);

    if (toRich) {
      buildRichMode();
    } else {
      buildRawMode(text);
    }
  }

  if (isRichText) {
    buildRichMode();
  } else {
    buildRawMode(getTextFromEntity());
  }

  return {
    switchMode,
    sync: syncToEntity,
    isRichMode: () => isRichText,
    destroy: () => {
      isDestroyed = true;
      if (editor && !editor.isDestroyed) editor.destroy();
      editor = null;
    },
  };
}

function wireToolbar(toolbarEl, editor, onToggle) {
  if (!toolbarEl) return;

  if (toolbarEl._wireCleanup) {
    toolbarEl._wireCleanup.off();
    toolbarEl._wireCleanup = null;
  }

  let actions = null;
  if (editor && !editor.isDestroyed) {
    actions = getToolbarActions(editor);
  }

  const clickHandler = (e) => {
    const btn = e.target.closest('[data-tb-cmd]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    const cmd = btn.dataset.tbCmd;

    if (cmd === 'toggle') {
      if (onToggle) onToggle();
      return;
    }

    if (!actions) return;

    if (cmd === 'link') {
      const url = prompt('Enter URL:', 'https://');
      if (url) actions.setLink(url);
      return;
    }

    if (typeof actions[cmd] === 'function') {
      actions[cmd]();
    }
  };

  toolbarEl.addEventListener('click', clickHandler);

  let updateActive;
  if (editor && !editor.isDestroyed) {
    updateActive = () => {
      const state = actions.getState();
      for (const btn of toolbarEl.querySelectorAll('[data-tb-cmd]')) {
        const cmd = btn.dataset.tbCmd;
        const activeKeyMap = {
          bold: 'isBold', italic: 'isItalic', underline: 'isUnderline',
          strikethrough: 'isStrike', code: 'isCode',
          h1: 'isH1', h2: 'isH2', h3: 'isH3',
          bulletList: 'isBulletList', orderedList: 'isOrderedList',
          blockquote: 'isBlockquote',
        };
        const key = activeKeyMap[cmd];
        if (key && state[key] !== undefined) {
          btn.classList.toggle('active', state[key]);
        }
      }
    };
    editor.on('selectionUpdate', updateActive);
    editor.on('transaction', updateActive);
  }

  toolbarEl._wireCleanup = { clickHandler, off: () => {
    toolbarEl.removeEventListener('click', clickHandler);
    if (editor && !editor.isDestroyed && updateActive) {
      editor.off('selectionUpdate', updateActive);
      editor.off('transaction', updateActive);
    }
  }};
}

const _tbBatchSnapshots = new Map();

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

const _shapeBatchSnapshots = new Map();

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

export function refreshSidePanel() {
  requestAnimationFrame(() => wirePropertyClipboard());
  const { sidePanelContent } = state;
  if (!sidePanelContent) return;

  if (state.arrowDragTarget !== null && state.arrows[state.arrowDragTarget.arrowIdx]) {
    flushPanelEdit();
    const arrow = state.arrows[state.arrowDragTarget.arrowIdx];
    const endLabel = state.arrowDragTarget.end === 'start' ? 'Start (Tail)' : 'End (Tip)';
    const connTextBoxIdx = state.arrowDragTarget.end === 'start' ? arrow.connectedFrom : arrow.connectedTo;
    const connLabel = connTextBoxIdx !== null && state.textBoxes[connTextBoxIdx]
      ? (state.textBoxes[connTextBoxIdx].title || `Text Box ${connTextBoxIdx}`) : 'None';
    const pt = getArrowEndpoint(arrow, state.arrowDragTarget.end);
    _sp( [
      '<div class="panel-section-title">Arrow Point (' + state.escAttr(endLabel) + ')</div>',
      '<div class="panel-row"><label>Connected to</label><span class="panel-static">' + state.escAttr(connLabel) + '</span></div>',
      '<div class="panel-row"><label>X</label><span class="panel-static">' + Math.round(pt.x) + '</span></div>',
      '<div class="panel-row"><label>Y</label><span class="panel-static">' + Math.round(pt.y) + '</span></div>',
    ].join(''));
    return;
  }

  {
    let typeCount = 0;
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
    const fromLabel = arrow.connectedFrom !== null && state.textBoxes[arrow.connectedFrom]
      ? (state.textBoxes[arrow.connectedFrom].title || `Text Box ${arrow.connectedFrom}`) : 'Free';
    const toLabel = arrow.connectedTo !== null && state.textBoxes[arrow.connectedTo]
      ? (state.textBoxes[arrow.connectedTo].title || `Text Box ${arrow.connectedTo}`) : 'Free';
    _sp( [
      '<div class="panel-section-title">Arrow</div>',
      '<div class="panel-row"><label>From</label><span class="panel-static">' + state.escAttr(fromLabel) + '</span></div>',
      '<div class="panel-row"><label>To</label><span class="panel-static">' + state.escAttr(toLabel) + '</span></div>',
      '<div class="panel-row"><label>Color</label>' + colorSwatchHTML('panelArrowColor', arrow.color || '#6bb5ff') + '</div>',
      '<div class="panel-row"><label>Thickness</label><input id="panelArrowThickness" class="panel-input" type="number" min="0.5" max="20" step="0.5" value="' + (arrow.lineWidth ?? 2) + '" /></div>',
      '<div class="panel-row"><label>Head Size</label><input id="panelArrowHeadSize" class="panel-input" type="number" min="4" max="60" step="1" value="' + (arrow.headSize ?? 14) + '" /></div>',
    ].join(''));
    const colorSwatch = document.getElementById('panelArrowColor');
    initColorSwatch(colorSwatch, {
      onSelect: (color) => { arrow.color = color; },
    });
    const thicknessInput = document.getElementById('panelArrowThickness');
    const headSizeInput = document.getElementById('panelArrowHeadSize');
    if (thicknessInput) {
      thicknessInput.addEventListener('input', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!Number.isNaN(v) && v > 0) arrow.lineWidth = v;
      });
      thicknessInput.addEventListener('focus', () => { startArrowPanelEdit(arrow.id, 'lineWidth', arrow.lineWidth); });
      thicknessInput.addEventListener('blur', () => { flushPanelEdit(); });
      attachDragNumber(thicknessInput,
        (delta) => { arrow.lineWidth = Math.max(0.5, (arrow.lineWidth ?? 2) + delta * 0.5); thicknessInput.value = String(arrow.lineWidth); },
        () => { flushPanelEdit(); },
        () => {});
    }
    if (headSizeInput) {
      headSizeInput.addEventListener('input', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!Number.isNaN(v) && v >= 4) arrow.headSize = v;
      });
      headSizeInput.addEventListener('focus', () => { startArrowPanelEdit(arrow.id, 'headSize', arrow.headSize); });
      headSizeInput.addEventListener('blur', () => { flushPanelEdit(); });
      attachDragNumber(headSizeInput,
        (delta) => { arrow.headSize = Math.max(4, (arrow.headSize ?? 14) + delta); headSizeInput.value = String(Math.round(arrow.headSize)); },
        () => { flushPanelEdit(); },
        () => {});
    }
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
    const fromNode = state.textBoxes[conn.from];
    const toNode = state.textBoxes[conn.to];
    const fromLabel = fromNode ? (fromNode.title || `Text Box ${conn.from}`) : '?';
    const toLabel = toNode ? (toNode.title || `Text Box ${conn.to}`) : '?';
    _sp( [
      '<div class="panel-section-title">Connection</div>',
      '<div class="panel-row"><label>From</label><span class="panel-static">' + state.escAttr(fromLabel) + '</span></div>',
      '<div class="panel-row"><label>To</label><span class="panel-static">' + state.escAttr(toLabel) + '</span></div>',
      '<div class="panel-row"><label>Color</label>' + colorSwatchHTML('panelConnColor', conn.color || '#6bb5ff') + '</div>',
      '<div class="panel-row"><label>Text</label><input id="panelConnText" class="panel-input" type="text" value="' + state.escAttr(conn.text ?? '') + '" /></div>',
    ].join(''));
    const colorSwatch = document.getElementById('panelConnColor');
    const textInput = document.getElementById('panelConnText');
    initColorSwatch(colorSwatch, {
      onSelect: (color) => { conn.color = color; },
    });
    if (textInput) textInput.addEventListener('input', (ev) => { conn.text = ev.target.value; });
    return;
  }

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

    const title = isBatch ? indices.length + ' shapes selected' : 'Shape (' + state.escAttr(s.shapeType) + ')';

    const shapeParentInfo = !isBatch && s.parentId !== null && s.parentId !== undefined
      ? (() => {
          if (s.parentType === 'textBox') {
            const found = state.textBoxes.find(t => t.id === s.parentId);
            return found ? (found.title || `Text Box ${found.id}`) : '?';
          }
          const found = state.shapes.find(sh => sh.id === s.parentId);
          return found ? `Shape ${found.id} (${found.shapeType})` : '?';
        })()
      : null;
    const shapeParentHtml = shapeParentInfo ? '<div class="panel-row"><label>Parent</label><span class="panel-static">' + state.escAttr(shapeParentInfo) + '</span></div>' : '';

    const hasImage = s.image != null;
    const imageMixed = isBatch && members.some(m => (m.image != null) !== hasImage);
    let imageSectionHtml = '';
    if (!isBatch || imageMixed) {
      if (hasImage) {
        imageSectionHtml = '<div class="panel-section-title" style="margin-top:12px">Image</div>' +
          '<div class="panel-row" style="flex-direction:row;align-items:center;gap:4px;"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;">' + state.escAttr(s.image.fileName || 'Image') + '</span>' +
          '<button id="panelShapeRemoveImage" style="background:none;border:1px solid #555;color:#e74c3c;border-radius:3px;cursor:pointer;padding:0 6px;font-size:11px;line-height:1.4;">\u00d7</button></div>' +
          '<div class="panel-row" style="flex-direction:row;gap:4px;"><button id="panelShapeAddImage" class="panel-input" style="cursor:pointer;flex:1">Replace...</button>' +
          '<button id="panelShapeUrlAddBtn" class="panel-input" style="cursor:pointer;width:auto;">URL</button></div>' +
          '<div class="panel-row"><span style="font-size:12px;color:#999">Image fills the shape. Resize corner handles to scale with locked ratio.</span></div>';
      } else {
        imageSectionHtml = '<div class="panel-section-title" style="margin-top:12px">Image</div>' +
          '<div class="panel-row" style="color:#777;font-size:11px;">No image</div>' +
          '<div class="panel-row" style="flex-direction:row;gap:4px;"><button id="panelShapeAddImage" class="panel-input" style="cursor:pointer;flex:1">+ Add Image' +
          '</button><button id="panelShapeUrlAddBtn" class="panel-input" style="cursor:pointer;width:auto;">URL</button></div>';
      }
    }

    _sp( [
      '<div class="panel-section-title">' + title + '</div>',
      '<div class="panel-row"><label>Color</label>' + colorSwatchHTML('panelShapeColor', s.color ?? '#2b2b2b') + '</div>',
      '<div class="panel-row"><label>Border</label>' + colorSwatchHTML('panelShapeBorderColor', s.borderColor ?? '#6bb5ff') + '</div>',
      '<div class="panel-row"><label>Border W</label><input id="panelShapeBorderWidth" class="panel-input" type="number" min="0" max="20" step="0.5" value="' + (colorMixed || borderWidthMixed ? '' : (s.borderWidth ?? 2)) + '" placeholder="' + (borderWidthMixed ? '(mixed)' : '') + '" /></div>',
      '<div class="panel-row"><label>Width</label><input id="panelShapeW" class="panel-input" type="number" min="10" value="' + (wMixed ? '' : s.w) + '" placeholder="' + (wMixed ? '(mixed)' : '') + '" /></div>',
      '<div class="panel-row"><label>Height</label><input id="panelShapeH" class="panel-input" type="number" min="10" value="' + (hMixed ? '' : s.h) + '" placeholder="' + (hMixed ? '(mixed)' : '') + '" /></div>',
      shapeParentHtml,
      imageSectionHtml,
    ].join(''));

    const colorSwatch = document.getElementById('panelShapeColor');
    const borderColorSwatch = document.getElementById('panelShapeBorderColor');
    const borderWidthInput = document.getElementById('panelShapeBorderWidth');
    const wInput = document.getElementById('panelShapeW');
    const hInput = document.getElementById('panelShapeH');
    if (colorSwatch) {
      initColorSwatch(colorSwatch, {
        onSelect: (v) => {
          if (isBatch) { for (const m of members) m.color = v; } else { s.color = v; }
          state.lastShapeColor = v;
        },
        onOpen: isBatch ? (() => _captureShapeSnapshot('color', members)) : (() => { startShapePanelEdit(shapeId, 'color', s.color); }),
        onClose: isBatch ? (() => _commitShapeSnapshot('color')) : (() => { flushPanelEdit(); }),
      });
    }
    if (borderColorSwatch) {
      initColorSwatch(borderColorSwatch, {
        onSelect: (v) => {
          if (isBatch) { for (const m of members) m.borderColor = v; } else { s.borderColor = v; }
          state.lastShapeBorderColor = v;
        },
        onOpen: isBatch ? (() => _captureShapeSnapshot('borderColor', members)) : (() => { startShapePanelEdit(shapeId, 'borderColor', s.borderColor); }),
        onClose: isBatch ? (() => _commitShapeSnapshot('borderColor')) : (() => { flushPanelEdit(); }),
      });
    }
    if (borderWidthInput) {
      borderWidthInput.setAttribute('data-drag-number', 'true');
      borderWidthInput.addEventListener('input', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!Number.isNaN(v) && v >= 0) {
          if (isBatch) { for (const m of members) m.borderWidth = v; } else { s.borderWidth = v; }
        }
      });
      if (isBatch) {
        borderWidthInput.addEventListener('focus', () => _captureShapeSnapshot('borderWidth', members));
        borderWidthInput.addEventListener('blur', () => _commitShapeSnapshot('borderWidth'));
        attachDragNumber(borderWidthInput,
          (delta) => {
            const v = Math.max(0, (members[0].borderWidth ?? 2) + delta * 0.5);
            for (const m of members) m.borderWidth = v;
            borderWidthInput.value = String(v);
          }, () => {}, () => {});
      } else {
        borderWidthInput.addEventListener('focus', () => { startShapePanelEdit(shapeId, 'borderWidth', s.borderWidth); });
        borderWidthInput.addEventListener('blur', () => { flushPanelEdit(); });
        attachDragNumber(borderWidthInput,
          (delta) => {
            s.borderWidth = Math.max(0, (s.borderWidth ?? 2) + delta * 0.5);
            borderWidthInput.value = String(s.borderWidth);
          },
          () => { flushPanelEdit(); }, () => {});
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
    if (!isBatch) {
      const addImgBtn = document.getElementById('panelShapeAddImage');
      if (addImgBtn) {
        addImgBtn.addEventListener('click', () => {
          openImageInShape(firstIdx);
        });
      }
      const urlAddBtn = document.getElementById('panelShapeUrlAddBtn');
      if (urlAddBtn) {
        urlAddBtn.addEventListener('click', () => {
          const url = prompt('Enter image URL:');
          if (url && url.trim()) {
            addImageToShape(firstIdx, url.trim());
          }
        });
      }
      const removeBtn = document.getElementById('panelShapeRemoveImage');
      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          removeImageFromShape(firstIdx);
        });
      }
    }
    return;
  }

  if (state.selectedTextBoxes.size >= 1) {
    flushPanelEdit();
    const indices = Array.from(state.selectedTextBoxes);
    const isBatch = indices.length > 1;
    const firstIdx = indices[0];
    const tb = state.textBoxes[firstIdx];
    const tbId = tb.id;
    const members = indices.map(i => state.textBoxes[i]);

    const titleMixed = isBatch && members.some(m => m.title !== tb.title);
    const titleColorMixed = isBatch && members.some(m => m.titleColor !== tb.titleColor);
    const colorMixed = isBatch && members.some(m => m.color !== tb.color);
    const borderColorMixed = isBatch && members.some(m => m.borderColor !== tb.borderColor);
    const textColorMixed = isBatch && members.some(m => m.textColor !== tb.textColor);
    const fontSizeMixed = isBatch && members.some(m => m.fontSize !== tb.fontSize);
    const wMixed = isBatch && members.some(m => m.w !== tb.w);
    const hMixed = isBatch && members.some(m => m.h !== tb.h);
    const textMixed = isBatch && members.some(m => m.text !== tb.text);

    const parentInfo = tb.parentId !== null && tb.parentId !== undefined
      ? (() => {
          if (tb.parentType === 'shape') {
            const found = state.shapes.find(s => s.id === tb.parentId);
            return found ? `Shape ${found.id} (${found.shapeType})` : '?';
          }
          const found = state.textBoxes.find(t => t.id === tb.parentId);
          return found ? (found.title || `Text Box ${found.id}`) : '?';
        })()
      : null;
    const parentHtml = parentInfo ? '<div class="panel-row"><label>Parent</label><span class="panel-static">' + state.escAttr(parentInfo) + '</span></div>' : '';

    const sectionTitle = isBatch ? indices.length + ' text boxes selected' : 'Text Box';

    _sp( [
      '<div class="panel-section-title">' + sectionTitle + '</div>',
      '<div class="panel-row"><label>Title</label><input id="panelTBTitle" class="panel-input" type="text" value="' + (titleMixed ? '' : state.escAttr(tb.title ?? '')) + '" placeholder="' + (titleMixed ? '(mixed)' : state.escAttr(TITLE_PLACEHOLDER)) + '" /></div>',
      '<div class="panel-row"><label>Title Color</label>' + colorSwatchHTML('panelTBTitleColor', tb.titleColor ?? '#e7e7e7') + '</div>',
      '<div class="panel-row"><label>Color</label>' + colorSwatchHTML('panelTBColor', tb.color ?? '#1a1a1a') + '</div>',
      '<div class="panel-row"><label>Border</label>' + colorSwatchHTML('panelTBBorderColor', tb.borderColor ?? '#444444') + '</div>',
      '<div class="panel-row"><label>Text Color</label>' + colorSwatchHTML('panelTBTextColor', tb.textColor ?? '#dddddd') + '</div>',
      '<div class="panel-row"><label>Font Size</label><input id="panelTBFontSize" class="panel-input" type="number" min="8" max="72" value="' + (fontSizeMixed ? '' : (tb.fontSize ?? 14)) + '" placeholder="' + (fontSizeMixed ? '(mixed)' : '') + '" /></div>',
      '<div class="panel-row"><label>Width</label><input id="panelTBW" class="panel-input" type="number" min="10" value="' + (wMixed ? '' : tb.w) + '" placeholder="' + (wMixed ? '(mixed)' : '') + '" /></div>',
      '<div class="panel-row"><label>Height</label><input id="panelTBH" class="panel-input" type="number" min="10" value="' + (hMixed ? '' : tb.h) + '" placeholder="' + (hMixed ? '(mixed)' : '') + '" /></div>',
      parentHtml,
      '<div class="panel-md-editor" id="panelTBTextEditor">' +
        buildMarkdownToolbar() +
        '<div class="panel-md-editor-body"></div>' +
      '</div>',
    ].join(''));

    const titleInput = document.getElementById('panelTBTitle');
    const titleColorSwatch = document.getElementById('panelTBTitleColor');
    const colorSwatch = document.getElementById('panelTBColor');
    const borderColorSwatch = document.getElementById('panelTBBorderColor');
    const textColorSwatch = document.getElementById('panelTBTextColor');
    const fontSizeInput = document.getElementById('panelTBFontSize');
    const wInput = document.getElementById('panelTBW');
    const hInput = document.getElementById('panelTBH');

    if (titleInput) {
      titleInput.addEventListener('input', (ev) => {
        const v = ev.target.value;
        if (isBatch) { for (const m of members) m.title = v; } else { tb.title = v; }
      });
      if (isBatch) {
        titleInput.addEventListener('focus', () => _captureTbSnapshot('title', members));
        titleInput.addEventListener('blur', () => _commitTbSnapshot('title'));
      } else {
        titleInput.addEventListener('focus', () => { startTextBoxPanelEdit(tbId, 'title', tb.title); });
        titleInput.addEventListener('blur', () => { flushPanelEdit(refreshSidePanel); });
      }
    }
    if (titleColorSwatch) {
      initColorSwatch(titleColorSwatch, {
        onSelect: (v) => { if (isBatch) { for (const m of members) m.titleColor = v; } else { tb.titleColor = v; } },
        onOpen: isBatch ? (() => _captureTbSnapshot('titleColor', members)) : (() => { startTextBoxPanelEdit(tbId, 'titleColor', tb.titleColor); }),
        onClose: isBatch ? (() => _commitTbSnapshot('titleColor')) : (() => { flushPanelEdit(refreshSidePanel); }),
      });
    }
    if (colorSwatch) {
      initColorSwatch(colorSwatch, {
        onSelect: (v) => { if (isBatch) { for (const m of members) m.color = v; } else { tb.color = v; } },
        onOpen: isBatch ? (() => _captureTbSnapshot('color', members)) : (() => { startTextBoxPanelEdit(tbId, 'color', tb.color); }),
        onClose: isBatch ? (() => _commitTbSnapshot('color')) : (() => { flushPanelEdit(refreshSidePanel); }),
      });
    }
    if (borderColorSwatch) {
      initColorSwatch(borderColorSwatch, {
        onSelect: (v) => { if (isBatch) { for (const m of members) m.borderColor = v; } else { tb.borderColor = v; } },
        onOpen: isBatch ? (() => _captureTbSnapshot('borderColor', members)) : (() => { startTextBoxPanelEdit(tbId, 'borderColor', tb.borderColor); }),
        onClose: isBatch ? (() => _commitTbSnapshot('borderColor')) : (() => { flushPanelEdit(refreshSidePanel); }),
      });
    }
    if (textColorSwatch) {
      initColorSwatch(textColorSwatch, {
        onSelect: (v) => { if (isBatch) { for (const m of members) m.textColor = v; } else { tb.textColor = v; } },
        onOpen: isBatch ? (() => _captureTbSnapshot('textColor', members)) : (() => { startTextBoxPanelEdit(tbId, 'textColor', tb.textColor); }),
        onClose: isBatch ? (() => _commitTbSnapshot('textColor')) : (() => { flushPanelEdit(refreshSidePanel); }),
      });
    }
    if (fontSizeInput) {
      fontSizeInput.setAttribute('data-drag-number', 'true');
      fontSizeInput.addEventListener('input', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!Number.isNaN(v) && v >= 8) {
          if (isBatch) { for (const m of members) m.fontSize = v; } else { tb.fontSize = v; }
        }
      });
      if (isBatch) {
        fontSizeInput.addEventListener('focus', () => _captureTbSnapshot('fontSize', members));
        fontSizeInput.addEventListener('blur', () => _commitTbSnapshot('fontSize'));
        attachDragNumber(fontSizeInput,
          (delta) => {
            const v = Math.max(8, Math.min(72, (members[0].fontSize ?? 14) + delta));
            for (const m of members) m.fontSize = v;
            fontSizeInput.value = String(Math.round(members[0].fontSize));
          }, () => {}, () => {});
      } else {
        fontSizeInput.addEventListener('focus', () => { startTextBoxPanelEdit(tbId, 'fontSize', tb.fontSize); });
        fontSizeInput.addEventListener('blur', () => { flushPanelEdit(); });
        attachDragNumber(fontSizeInput,
          (delta) => {
            tb.fontSize = Math.max(8, Math.min(72, (tb.fontSize ?? 14) + delta));
            fontSizeInput.value = String(Math.round(tb.fontSize));
          },
          () => { flushPanelEdit(); }, () => {});
      }
    }
    if (wInput) {
      wInput.setAttribute('data-drag-number', 'true');
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
      } else {
        wInput.addEventListener('focus', () => { startTextBoxPanelEdit(tbId, 'w', tb.w, { x: tb.x, y: tb.y, w: tb.w, h: tb.h }); });
        wInput.addEventListener('blur', () => { flushPanelEdit(); });
        let wDragStartBounds = { x: tb.x, y: tb.y, w: tb.w, h: tb.h };
        attachDragNumber(wInput,
          (delta) => { tb.w = Math.max(10, tb.w + delta); wInput.value = String(Math.round(tb.w)); },
          () => {
            flushPanelEdit();
            wDragStartBounds = { x: tb.x, y: tb.y, w: tb.w, h: tb.h };
          },
          () => {
            if (tb.w !== wDragStartBounds.w) {
              history.push(createResizeTextBoxCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, tbId,
                { x: wDragStartBounds.x, y: wDragStartBounds.y, w: wDragStartBounds.w, h: wDragStartBounds.h },
                { x: tb.x, y: tb.y, w: tb.w, h: tb.h }));
            }
          });
      }
    }
    if (hInput) {
      hInput.setAttribute('data-drag-number', 'true');
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
      } else {
        hInput.addEventListener('focus', () => { startTextBoxPanelEdit(tbId, 'h', tb.h, { x: tb.x, y: tb.y, w: tb.w, h: tb.h }); });
        hInput.addEventListener('blur', () => { flushPanelEdit(); });
        let hDragStartBounds = { x: tb.x, y: tb.y, w: tb.w, h: tb.h };
        attachDragNumber(hInput,
          (delta) => { tb.h = Math.max(10, tb.h + delta); hInput.value = String(Math.round(tb.h)); },
          () => {
            flushPanelEdit();
            hDragStartBounds = { x: tb.x, y: tb.y, w: tb.w, h: tb.h };
          },
          () => {
            if (tb.h !== hDragStartBounds.h) {
              history.push(createResizeTextBoxCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, tbId,
                { x: hDragStartBounds.x, y: hDragStartBounds.y, w: hDragStartBounds.w, h: hDragStartBounds.h },
                { x: tb.x, y: tb.y, w: tb.w, h: tb.h }));
            }
          });
      }
    }
    setupMarkdownEditor('panelTBText', {
      getText: () => tb.text ?? '',
      setText: (v) => {
        if (isBatch) { for (const m of members) { m.text = v; m.blocks = null; m.content = null; m._contentVersion = (m._contentVersion || 0) + 1; } } else { tb.text = v; tb.blocks = null; tb.content = null; tb._contentVersion = (tb._contentVersion || 0) + 1; }
      },
      onFocus: isBatch ? (() => _captureTbSnapshot('text', members)) : (() => { startTextBoxPanelEdit(tbId, 'text', tb.text); }),
      onBlur: isBatch ? (() => _commitTbSnapshot('text')) : (() => { flushPanelEdit(); }),
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

  if (state.selectedTextBoxes.size === 0 && state.selectedShapes.size === 0 && state.selectedConnectors.size === 0) {
    flushPanelEdit();
    _sp( '<div class="panel-empty">Nothing selected</div>');
    return;
  }
}

function renderMixedEditor() {
  const parts = [];
  let prefixCounter = 0;

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
    const thickMixed = members.some(m => m.lineWidth !== members[0].lineWidth);
    const headMixed = members.some(m => m.headSize !== members[0].headSize);
    parts.push(
      '<div class="panel-row"><label>Color</label>' + colorSwatchHTML(prefix + '_color', members[0].color || '#6bb5ff') + '</div>',
      '<div class="panel-row"><label>Thickness</label><input id="' + prefix + '_thickness" class="panel-input" type="number" min="0.5" max="20" step="0.5" value="' + (thickMixed ? '' : (members[0].lineWidth ?? 2)) + '" placeholder="' + (thickMixed ? '(mixed)' : '') + '" /></div>',
      '<div class="panel-row"><label>Head Size</label><input id="' + prefix + '_headSize" class="panel-input" type="number" min="4" max="60" step="1" value="' + (headMixed ? '' : (members[0].headSize ?? 14)) + '" placeholder="' + (headMixed ? '(mixed)' : '') + '" /></div>'
    );
  }

  if (state.selectedConnection !== null && state.connections[state.selectedConnection]) {
    const conn = state.connections[state.selectedConnection];
    const prefix = 'mx' + (prefixCounter++);

    if (parts.length > 0) parts.push('<hr class="panel-group-divider" />');
    parts.push('<div class="panel-section-title">Connection</div>');
    const fromNode = state.textBoxes[conn.from];
    const toNode = state.textBoxes[conn.to];
    const fromLabel = fromNode ? (fromNode.title || 'Text Box ' + conn.from) : '?';
    const toLabel = toNode ? (toNode.title || 'Text Box ' + conn.to) : '?';
    parts.push(
      '<div class="panel-row"><label>From</label><span class="panel-static">' + state.escAttr(fromLabel) + '</span></div>',
      '<div class="panel-row"><label>To</label><span class="panel-static">' + state.escAttr(toLabel) + '</span></div>',
      '<div class="panel-row"><label>Color</label>' + colorSwatchHTML(prefix + '_color', conn.color || '#6bb5ff') + '</div>',
      '<div class="panel-row"><label>Text</label><input id="' + prefix + '_text" class="panel-input" type="text" value="' + state.escAttr(conn.text ?? '') + '" /></div>'
    );
  }

  if (state.selectedConnectors.size > 0) {
    if (parts.length > 0) parts.push('<hr class="panel-group-divider" />');
    parts.push('<div class="panel-section-title">' + state.selectedConnectors.size + ' connector' + (state.selectedConnectors.size > 1 ? 's' : '') + '</div>');
  }

  _sp(parts.join(''));

  prefixCounter = 0;
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
    const cs = document.getElementById(prefix + '_color');
    if (cs) {
      initColorSwatch(cs, {
        onSelect: (v) => { for (const m of members) m.color = v; },
      });
    }
    const thickInput = document.getElementById(prefix + '_thickness');
    const headInput = document.getElementById(prefix + '_headSize');
    if (thickInput) {
      thickInput.addEventListener('input', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!Number.isNaN(v) && v > 0) for (const m of members) m.lineWidth = v;
      });
    }
    if (headInput) {
      headInput.addEventListener('input', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!Number.isNaN(v) && v >= 4) for (const m of members) m.headSize = v;
      });
    }
  }
  if (state.selectedConnection !== null && state.connections[state.selectedConnection]) {
    const conn = state.connections[state.selectedConnection];
    const prefix = 'mx' + (prefixCounter++);
    const cs = document.getElementById(prefix + '_color');
    const ti = document.getElementById(prefix + '_text');
    if (cs) {
      initColorSwatch(cs, {
        onSelect: (v) => { conn.color = v; },
      });
    }
    if (ti) ti.addEventListener('input', (ev) => { conn.text = ev.target.value; });
  }
}

function appendShapeEditorHTML(parts, prefix, members, first) {
  const wMixed = members.some(m => m.w !== first.w);
  const hMixed = members.some(m => m.h !== first.h);
  const bwMixed = members.some(m => m.borderWidth !== first.borderWidth);

  parts.push(
    '<div class="panel-row"><label>Color</label>' + colorSwatchHTML(prefix + '_color', first.color ?? '#2b2b2b') + '</div>',
    '<div class="panel-row"><label>Border</label>' + colorSwatchHTML(prefix + '_borderColor', first.borderColor ?? '#6bb5ff') + '</div>',
    '<div class="panel-row"><label>Border W</label><input id="' + prefix + '_borderWidth" class="panel-input" type="number" min="0" max="20" step="0.5" value="' + (bwMixed ? '' : (first.borderWidth ?? 2)) + '" placeholder="' + (bwMixed ? '(mixed)' : '') + '" /></div>',
    '<div class="panel-row"><label>Width</label><input id="' + prefix + '_w" class="panel-input" type="number" min="10" value="' + (wMixed ? '' : first.w) + '" placeholder="' + (wMixed ? '(mixed)' : '') + '" /></div>',
    '<div class="panel-row"><label>Height</label><input id="' + prefix + '_h" class="panel-input" type="number" min="10" value="' + (hMixed ? '' : first.h) + '" placeholder="' + (hMixed ? '(mixed)' : '') + '" /></div>'
  );
}

function appendTextBoxEditorHTML(parts, prefix, members, first) {
  const titleMixed = members.some(m => m.title !== first.title);
  const textMixed = members.some(m => m.text !== first.text);
  const fontSizeMixed = members.some(m => m.fontSize !== first.fontSize);
  const wMixed = members.some(m => m.w !== first.w);
  const hMixed = members.some(m => m.h !== first.h);

  parts.push(
    '<div class="panel-row"><label>Title</label><input id="' + prefix + '_title" class="panel-input" type="text" value="' + (titleMixed ? '' : state.escAttr(first.title ?? '')) + '" placeholder="' + (titleMixed ? '(mixed)' : state.escAttr(TITLE_PLACEHOLDER)) + '" /></div>',
    '<div class="panel-row"><label>Title Color</label>' + colorSwatchHTML(prefix + '_titleColor', first.titleColor ?? '#e7e7e7') + '</div>',
    '<div class="panel-row"><label>Color</label>' + colorSwatchHTML(prefix + '_color', first.color ?? '#1a1a1a') + '</div>',
    '<div class="panel-row"><label>Border</label>' + colorSwatchHTML(prefix + '_borderColor', first.borderColor ?? '#444444') + '</div>',
    '<div class="panel-row"><label>Text Color</label>' + colorSwatchHTML(prefix + '_textColor', first.textColor ?? '#dddddd') + '</div>',
    '<div class="panel-row"><label>Font Size</label><input id="' + prefix + '_fontSize" class="panel-input" type="number" min="8" max="72" value="' + (fontSizeMixed ? '' : (first.fontSize ?? 14)) + '" placeholder="' + (fontSizeMixed ? '(mixed)' : '') + '" /></div>',
    '<div class="panel-row"><label>Width</label><input id="' + prefix + '_w" class="panel-input" type="number" min="10" value="' + (wMixed ? '' : first.w) + '" placeholder="' + (wMixed ? '(mixed)' : '') + '" /></div>',
    '<div class="panel-row"><label>Height</label><input id="' + prefix + '_h" class="panel-input" type="number" min="10" value="' + (hMixed ? '' : first.h) + '" placeholder="' + (hMixed ? '(mixed)' : '') + '" /></div>',
    '<div class="panel-md-editor" id="' + prefix + '_textEditor">' +
      buildMarkdownToolbar() +
      '<div class="panel-md-editor-body"></div>' +
    '</div>'
  );
}

function wireMixedShapeGroup(prefix, members) {
  const colorSwatch = document.getElementById(prefix + '_color');
  const borderColorSwatch = document.getElementById(prefix + '_borderColor');
  const borderWidthInput = document.getElementById(prefix + '_borderWidth');
  const wInput = document.getElementById(prefix + '_w');
  const hInput = document.getElementById(prefix + '_h');

  if (colorSwatch) {
    initColorSwatch(colorSwatch, {
      onSelect: (v) => { for (const m of members) m.color = v; state.lastShapeColor = v; },
      onOpen: () => _captureShapeSnapshot('color', members),
      onClose: () => _commitShapeSnapshot('color'),
    });
  }
  if (borderColorSwatch) {
    initColorSwatch(borderColorSwatch, {
      onSelect: (v) => { for (const m of members) m.borderColor = v; state.lastShapeBorderColor = v; },
      onOpen: () => _captureShapeSnapshot('borderColor', members),
      onClose: () => _commitShapeSnapshot('borderColor'),
    });
  }
  if (borderWidthInput) {
    borderWidthInput.setAttribute('data-drag-number', 'true');
    borderWidthInput.addEventListener('input', (ev) => {
      const v = parseFloat(ev.target.value);
      if (!Number.isNaN(v) && v >= 0) for (const m of members) m.borderWidth = v;
    });
    borderWidthInput.addEventListener('focus', () => _captureShapeSnapshot('borderWidth', members));
    borderWidthInput.addEventListener('blur', () => _commitShapeSnapshot('borderWidth'));
    attachDragNumber(borderWidthInput,
      (delta) => {
        const v = Math.max(0, (members[0].borderWidth ?? 2) + delta * 0.5);
        for (const m of members) m.borderWidth = v;
        borderWidthInput.value = String(v);
      }, () => {}, () => {});
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
}

function wireMixedTBGroup(prefix, members) {
  const titleInput = document.getElementById(prefix + '_title');
  const titleColorSwatch = document.getElementById(prefix + '_titleColor');
  const colorSwatch = document.getElementById(prefix + '_color');
  const borderColorSwatch = document.getElementById(prefix + '_borderColor');
  const textColorSwatch = document.getElementById(prefix + '_textColor');
  const fontSizeInput = document.getElementById(prefix + '_fontSize');
  const wInput = document.getElementById(prefix + '_w');
  const hInput = document.getElementById(prefix + '_h');

  if (titleInput) {
    titleInput.addEventListener('input', (ev) => { for (const m of members) m.title = ev.target.value; });
    titleInput.addEventListener('focus', () => _captureTbSnapshot('title', members));
    titleInput.addEventListener('blur', () => _commitTbSnapshot('title'));
  }
  if (titleColorSwatch) {
    initColorSwatch(titleColorSwatch, {
      onSelect: (v) => { for (const m of members) m.titleColor = v; },
      onOpen: () => _captureTbSnapshot('titleColor', members),
      onClose: () => _commitTbSnapshot('titleColor'),
    });
  }
  if (colorSwatch) {
    initColorSwatch(colorSwatch, {
      onSelect: (v) => { for (const m of members) m.color = v; },
      onOpen: () => _captureTbSnapshot('color', members),
      onClose: () => _commitTbSnapshot('color'),
    });
  }
  if (borderColorSwatch) {
    initColorSwatch(borderColorSwatch, {
      onSelect: (v) => { for (const m of members) m.borderColor = v; },
      onOpen: () => _captureTbSnapshot('borderColor', members),
      onClose: () => _commitTbSnapshot('borderColor'),
    });
  }
  if (textColorSwatch) {
    initColorSwatch(textColorSwatch, {
      onSelect: (v) => { for (const m of members) m.textColor = v; },
      onOpen: () => _captureTbSnapshot('textColor', members),
      onClose: () => _commitTbSnapshot('textColor'),
    });
  }
  if (fontSizeInput) {
    fontSizeInput.setAttribute('data-drag-number', 'true');
    fontSizeInput.addEventListener('input', (ev) => {
      const v = parseFloat(ev.target.value);
      if (!Number.isNaN(v) && v >= 8) for (const m of members) m.fontSize = v;
    });
    fontSizeInput.addEventListener('focus', () => _captureTbSnapshot('fontSize', members));
    fontSizeInput.addEventListener('blur', () => _commitTbSnapshot('fontSize'));
    attachDragNumber(fontSizeInput,
      (delta) => {
        const v = Math.max(8, Math.min(72, (members[0].fontSize ?? 14) + delta));
        for (const m of members) m.fontSize = v;
        fontSizeInput.value = String(Math.round(members[0].fontSize));
      }, () => {}, () => {});
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
    setText: (v) => { for (const m of members) { m.text = v; m.blocks = null; m.content = null; } },
    onFocus: () => _captureTbSnapshot('text', members),
    onBlur: () => _commitTbSnapshot('text'),
    onChange: () => {},
  });
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

const ID_PROP_MAP = {
  panelShapeColor: { entityType: 'shape', prop: 'color' },
  panelShapeBorderColor: { entityType: 'shape', prop: 'borderColor' },
  panelShapeBorderWidth: { entityType: 'shape', prop: 'borderWidth' },
  panelShapeW: { entityType: 'shape', prop: 'w' },
  panelShapeH: { entityType: 'shape', prop: 'h' },
  panelTBTitle: { entityType: 'textBox', prop: 'title' },
  panelTBTitleColor: { entityType: 'textBox', prop: 'titleColor' },
  panelTBColor: { entityType: 'textBox', prop: 'color' },
  panelTBBorderColor: { entityType: 'textBox', prop: 'borderColor' },
  panelTBTextColor: { entityType: 'textBox', prop: 'textColor' },
  panelTBFontSize: { entityType: 'textBox', prop: 'fontSize' },
  panelTBW: { entityType: 'textBox', prop: 'w' },
  panelTBH: { entityType: 'textBox', prop: 'h' },
  panelArrowThickness: { entityType: 'arrow', prop: 'lineWidth' },
  panelArrowHeadSize: { entityType: 'arrow', prop: 'headSize' },
};

function parseMixedId(id) {
  const m = id.match(/^mx(\d+)_(.+)$/);
  if (!m) return null;
  const idx = parseInt(m[1]);
  const prop = m[2];
  const typeOrder = [];
  if (state.selectedShapes.size > 0) typeOrder.push('shape');
  if (state.selectedTextBoxes.size > 0) typeOrder.push('textBox');
  if (state.selectedArrows.size > 0) typeOrder.push('arrow');
  if (state.selectedConnection !== null) typeOrder.push('connection');
  if (idx < typeOrder.length) return { entityType: typeOrder[idx], prop };
  return null;
}

function getPropInfoFromId(id) {
  if (ID_PROP_MAP[id]) return ID_PROP_MAP[id];
  return parseMixedId(id);
}

function getEntityArray(entityType) {
  if (entityType === 'shape') return state.shapes;
  if (entityType === 'textBox') return state.textBoxes;
  if (entityType === 'arrow') return state.arrows;
  if (entityType === 'connection') return state.connections;
  return null;
}

function getSelectedIndices(entityType) {
  if (entityType === 'shape') return Array.from(state.selectedShapes);
  if (entityType === 'textBox') return Array.from(state.selectedTextBoxes);
  if (entityType === 'arrow') return Array.from(state.selectedArrows);
  if (entityType === 'connection') return state.selectedConnection !== null ? [state.selectedConnection] : [];
  return [];
}

function getPropertyValue(entityType, propKey) {
  const entities = getEntityArray(entityType);
  const indices = getSelectedIndices(entityType);
  if (!entities || indices.length === 0) return undefined;
  return entities[indices[0]][propKey];
}

function setPropertyValue(entityType, propKey, value) {
  const entities = getEntityArray(entityType);
  const indices = getSelectedIndices(entityType);
  if (!entities || indices.length === 0) return;
  const firstId = entities[indices[0]].id;
  const oldVal = entities[indices[0]][propKey];
  if (oldVal === value) return;

  if (entityType === 'shape') {
    startShapePanelEdit(firstId, propKey, oldVal);
    for (const idx of indices) entities[idx][propKey] = value;
  } else if (entityType === 'textBox') {
    startTextBoxPanelEdit(firstId, propKey, oldVal);
    for (const idx of indices) entities[idx][propKey] = value;
  } else if (entityType === 'arrow') {
    startArrowPanelEdit(firstId, propKey, oldVal);
    for (const idx of indices) entities[idx][propKey] = value;
  } else if (entityType === 'connection') {
    startConnectionPanelEdit(firstId, propKey, oldVal);
    for (const idx of indices) entities[idx][propKey] = value;
  }
  flushPanelEdit();
  refreshSidePanel();
}

function showPropClipboardMenu(x, y, entityType, propKey) {
  const existing = document.getElementById('propClipboardMenu');
  if (existing) existing.remove();
  const menu = document.createElement('div');
  menu.id = 'propClipboardMenu';
  menu.className = 'context-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.innerHTML =
    '<button class="context-item" data-action="copy">Copy <span style="opacity:0.45;font-size:11px;margin-left:16px">Ctrl+C</span></button>' +
    '<button class="context-item" data-action="paste">Paste <span style="opacity:0.45;font-size:11px;margin-left:16px">Ctrl+V</span></button>';
  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('.context-item');
    if (!btn) return;
    const action = btn.dataset.action;
    const et = menu.dataset.entityType;
    const pk = menu.dataset.propKey;
    if (action === 'copy') {
      const val = getPropertyValue(et, pk);
      if (val !== undefined) state.propertyClipboard = { value: val, entityType: et, propKey: pk };
    } else if (action === 'paste') {
      if (state.propertyClipboard) setPropertyValue(et, pk, state.propertyClipboard.value);
    }
    menu.remove();
  });
  menu.dataset.entityType = entityType;
  menu.dataset.propKey = propKey;
  document.body.appendChild(menu);
  const offClick = (ev) => { if (!menu.contains(ev.target)) menu.remove(); };
  const onEsc = (ev) => { if (ev.key === 'Escape') menu.remove(); };
  setTimeout(() => {
    document.addEventListener('pointerdown', offClick, { once: true });
    document.addEventListener('keydown', onEsc, { once: true });
  }, 0);
}

function wirePropertyClipboard() {
  const panel = state.sidePanelContent;
  if (!panel) return;
  const rows = panel.querySelectorAll('.panel-row');
  for (const row of rows) {
    if (row._propClipboardWired) continue;
    const childEl = row.querySelector('input, button.panel-color-swatch');
    if (!childEl) continue;
    const info = getPropInfoFromId(childEl.id);
    if (!info) continue;
    row._propClipboardWired = true;
    row.addEventListener('mouseenter', () => {
      state.hoveredPropField = { entityType: info.entityType, propKey: info.prop };
    });
    row.addEventListener('mouseleave', () => {
      if (state.hoveredPropField && state.hoveredPropField.entityType === info.entityType && state.hoveredPropField.propKey === info.prop) {
        state.hoveredPropField = null;
      }
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showPropClipboardMenu(e.clientX, e.clientY, info.entityType, info.prop);
    });
  }
}
