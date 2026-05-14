import { state } from './state.js';
import { history, flushPanelEdit, startPanelEdit, startShapePanelEdit } from './history.js';
import { createResizeNodeCmd, createResizeShapeCmd } from './undo.js';
import { getArrowEndpoint } from './arrows.js';
import { renderMarkdownToHtml } from './markdown.js';
import { TITLE_PLACEHOLDER, TEXT_PLACEHOLDER } from './config.js';

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
    sidePanelContent.innerHTML = [
      '<div class="panel-section-title">Arrow Point (' + state.escAttr(endLabel) + ')</div>',
      '<div class="panel-row"><label>Connected to</label><span class="panel-static">' + state.escAttr(connLabel) + '</span></div>',
      '<div class="panel-row"><label>X</label><span class="panel-static">' + Math.round(pt.x) + '</span></div>',
      '<div class="panel-row"><label>Y</label><span class="panel-static">' + Math.round(pt.y) + '</span></div>',
    ].join('');
    return;
  }

  if (state.selectedArrows.size === 1) {
    flushPanelEdit();
    const arrow = state.arrows[Array.from(state.selectedArrows)[0]];
    const fromLabel = arrow.connectedFrom !== null && state.nodes[arrow.connectedFrom]
      ? (state.nodes[arrow.connectedFrom].title || `Node ${arrow.connectedFrom}`) : 'Free';
    const toLabel = arrow.connectedTo !== null && state.nodes[arrow.connectedTo]
      ? (state.nodes[arrow.connectedTo].title || `Node ${arrow.connectedTo}`) : 'Free';
    sidePanelContent.innerHTML = [
      '<div class="panel-section-title">Arrow</div>',
      '<div class="panel-row"><label>From</label><span class="panel-static">' + state.escAttr(fromLabel) + '</span></div>',
      '<div class="panel-row"><label>To</label><span class="panel-static">' + state.escAttr(toLabel) + '</span></div>',
      '<div class="panel-row"><label>Color</label><input id="panelArrowColor" class="panel-input" type="color" value="' + state.escAttr(arrow.color || '#6bb5ff') + '" /></div>',
    ].join('');
    const colorInput = document.getElementById('panelArrowColor');
    if (colorInput) colorInput.addEventListener('input', (ev) => { arrow.color = ev.target.value; });
    return;
  }

  if (state.selectedArrows.size > 1) {
    flushPanelEdit();
    sidePanelContent.innerHTML = '<div class="panel-section-title">' + state.selectedArrows.size + ' arrows selected</div>';
    return;
  }

  if (state.selectedConnection !== null && state.connections[state.selectedConnection]) {
    flushPanelEdit();
    const conn = state.connections[state.selectedConnection];
    const fromNode = state.nodes[conn.from];
    const toNode = state.nodes[conn.to];
    const fromLabel = fromNode ? (fromNode.title || `Node ${conn.from}`) : '?';
    const toLabel = toNode ? (toNode.title || `Node ${conn.to}`) : '?';
    sidePanelContent.innerHTML = [
      '<div class="panel-section-title">Connection</div>',
      '<div class="panel-row"><label>From</label><span class="panel-static">' + state.escAttr(fromLabel) + '</span></div>',
      '<div class="panel-row"><label>To</label><span class="panel-static">' + state.escAttr(toLabel) + '</span></div>',
      '<div class="panel-row"><label>Color</label><input id="panelConnColor" class="panel-input" type="color" value="' + state.escAttr(conn.color || '#6bb5ff') + '" /></div>',
      '<div class="panel-row"><label>Text</label><input id="panelConnText" class="panel-input" type="text" value="' + state.escAttr(conn.text ?? '') + '" /></div>',
    ].join('');
    const colorInput = document.getElementById('panelConnColor');
    const textInput = document.getElementById('panelConnText');
    if (colorInput) colorInput.addEventListener('input', (ev) => { conn.color = ev.target.value; });
    if (textInput) textInput.addEventListener('input', (ev) => { conn.text = ev.target.value; });
    return;
  }

  if (state.selectedShapes.size === 1) {
    flushPanelEdit();
    const si = Array.from(state.selectedShapes)[0];
    const s = state.shapes[si];
    const shapeId = s.id;
    const isRect = s.shapeType === 'rectangle';

    sidePanelContent.innerHTML = [
      '<div class="panel-section-title">Shape (' + state.escAttr(s.shapeType) + ')</div>',
      '<div class="panel-row"><label>Color</label><input id="panelShapeColor" class="panel-input panel-input-color" type="color" value="' + state.escAttr(s.color ?? '#2b2b2b') + '" /></div>',
      '<div class="panel-row"><label>Border</label><input id="panelShapeBorderColor" class="panel-input panel-input-color" type="color" value="' + state.escAttr(s.borderColor ?? '#6bb5ff') + '" /></div>',
      '<div class="panel-row"><label>Border W</label><input id="panelShapeBorderWidth" class="panel-input" type="number" min="0" max="20" step="0.5" value="' + (s.borderWidth ?? 2) + '" /></div>',
      '<div class="panel-row"><label>Width</label><input id="panelShapeW" class="panel-input" type="number" min="10" value="' + s.w + '" /></div>',
      '<div class="panel-row"><label>Height</label><input id="panelShapeH" class="panel-input" type="number" min="10" value="' + s.h + '" /></div>',
      (isRect ? '<div class="panel-row"><label>Radius</label><input id="panelShapeCornerRadius" class="panel-input" type="number" min="0" max="200" value="' + (s.cornerRadius ?? 4) + '" /></div>' : ''),
    ].join('');

    const colorInput = document.getElementById('panelShapeColor');
    const borderColorInput = document.getElementById('panelShapeBorderColor');
    const borderWidthInput = document.getElementById('panelShapeBorderWidth');
    const wInput = document.getElementById('panelShapeW');
    const hInput = document.getElementById('panelShapeH');
    const radiusInput = document.getElementById('panelShapeCornerRadius');

    if (colorInput) {
      colorInput.addEventListener('input', (ev) => { s.color = ev.target.value; state.lastShapeColor = ev.target.value; });
      colorInput.addEventListener('pointerdown', () => { startShapePanelEdit(shapeId, 'color', s.color); });
      colorInput.addEventListener('change', () => { flushPanelEdit(); });
    }
    if (borderColorInput) {
      borderColorInput.addEventListener('input', (ev) => { s.borderColor = ev.target.value; state.lastShapeBorderColor = ev.target.value; });
      borderColorInput.addEventListener('pointerdown', () => { startShapePanelEdit(shapeId, 'borderColor', s.borderColor); });
      borderColorInput.addEventListener('change', () => { flushPanelEdit(); });
    }
    if (borderWidthInput) {
      borderWidthInput.addEventListener('input', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!Number.isNaN(v) && v >= 0) s.borderWidth = v;
      });
      borderWidthInput.addEventListener('focus', () => { startShapePanelEdit(shapeId, 'borderWidth', s.borderWidth); });
      borderWidthInput.addEventListener('blur', () => { flushPanelEdit(); });
    }
    if (wInput) {
      wInput.setAttribute('data-drag-number', 'true');
      wInput.addEventListener('input', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!Number.isNaN(v) && v >= 10) s.w = v;
      });
      wInput.addEventListener('focus', () => { startShapePanelEdit(shapeId, 'w', s.w, { x: s.x, y: s.y, w: s.w, h: s.h }); });
      wInput.addEventListener('blur', () => { flushPanelEdit(); });
      let wDragStart = { x: s.x, y: s.y, w: s.w, h: s.h };
      attachDragNumber(wInput,
        (delta) => { s.w = Math.max(10, s.w + delta); wInput.value = String(Math.round(s.w)); },
        () => {
          flushPanelEdit();
          wDragStart = { x: s.x, y: s.y, w: s.w, h: s.h };
        },
        () => {
          if (s.w !== wDragStart.w) {
            history.push(createResizeShapeCmd(state.shapes, state.selectedShapes, refreshSidePanel, shapeId,
              { x: wDragStart.x, y: wDragStart.y, w: wDragStart.w, h: wDragStart.h },
              { x: s.x, y: s.y, w: s.w, h: s.h }));
          }
        });
    }
    if (hInput) {
      hInput.setAttribute('data-drag-number', 'true');
      hInput.addEventListener('input', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!Number.isNaN(v) && v >= 10) s.h = v;
      });
      hInput.addEventListener('focus', () => { startShapePanelEdit(shapeId, 'h', s.h, { x: s.x, y: s.y, w: s.w, h: s.h }); });
      hInput.addEventListener('blur', () => { flushPanelEdit(); });
      let hDragStart = { x: s.x, y: s.y, w: s.w, h: s.h };
      attachDragNumber(hInput,
        (delta) => { s.h = Math.max(10, s.h + delta); hInput.value = String(Math.round(s.h)); },
        () => {
          flushPanelEdit();
          hDragStart = { x: s.x, y: s.y, w: s.w, h: s.h };
        },
        () => {
          if (s.h !== hDragStart.h) {
            history.push(createResizeShapeCmd(state.shapes, state.selectedShapes, refreshSidePanel, shapeId,
              { x: hDragStart.x, y: hDragStart.y, w: hDragStart.w, h: hDragStart.h },
              { x: s.x, y: s.y, w: s.w, h: s.h }));
          }
        });
    }
    if (radiusInput) {
      radiusInput.setAttribute('data-drag-number', 'true');
      radiusInput.addEventListener('input', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!Number.isNaN(v) && v >= 0) s.cornerRadius = v;
      });
      radiusInput.addEventListener('focus', () => { startShapePanelEdit(shapeId, 'cornerRadius', s.cornerRadius); });
      radiusInput.addEventListener('blur', () => { flushPanelEdit(); });
      attachDragNumber(radiusInput,
        (delta) => { s.cornerRadius = Math.max(0, (s.cornerRadius ?? 4) + delta); radiusInput.value = String(Math.round(s.cornerRadius)); },
        () => {
          flushPanelEdit();
        },
        () => {});
    }
    return;
  }

  if (state.selectedShapes.size > 1) {
    flushPanelEdit();
    sidePanelContent.innerHTML = '<div class="panel-section-title">' + state.selectedShapes.size + ' shapes selected</div>';
    return;
  }

  if (state.selectedTextBoxes.size === 1) {
    flushPanelEdit();
    const ti = Array.from(state.selectedTextBoxes)[0];
    const tb = state.textBoxes[ti];
    const tbId = tb.id;

    sidePanelContent.innerHTML = [
      '<div class="panel-section-title">Text Box</div>',
      '<div class="panel-row"><label>Color</label><input id="panelTBColor" class="panel-input panel-input-color" type="color" value="' + state.escAttr(tb.color ?? '#1a1a1a') + '" /></div>',
      '<div class="panel-row"><label>Border</label><input id="panelTBBorderColor" class="panel-input panel-input-color" type="color" value="' + state.escAttr(tb.borderColor ?? '#444') + '" /></div>',
      '<div class="panel-row"><label>Text Color</label><input id="panelTBTextColor" class="panel-input panel-input-color" type="color" value="' + state.escAttr(tb.textColor ?? '#ddd') + '" /></div>',
      '<div class="panel-row"><label>Font Size</label><input id="panelTBFontSize" class="panel-input" type="number" min="8" max="72" value="' + (tb.fontSize ?? 14) + '" /></div>',
      '<div class="panel-row"><label>Width</label><input id="panelTBW" class="panel-input" type="number" min="10" value="' + tb.w + '" /></div>',
      '<div class="panel-row"><label>Height</label><input id="panelTBH" class="panel-input" type="number" min="10" value="' + tb.h + '" /></div>',
      '<div class="panel-row"><label>Text</label><textarea id="panelTBText" class="panel-input panel-textarea" placeholder="Enter text...">' + state.escAttr(tb.text ?? '') + '</textarea></div>',
      '<div id="panelTBTextPreview" class="panel-markdown-preview">' + renderMarkdownToHtml(tb.text ?? '') + '</div>',
    ].join('');

    const colorInput = document.getElementById('panelTBColor');
    const borderColorInput = document.getElementById('panelTBBorderColor');
    const textColorInput = document.getElementById('panelTBTextColor');
    const fontSizeInput = document.getElementById('panelTBFontSize');
    const wInput = document.getElementById('panelTBW');
    const hInput = document.getElementById('panelTBH');
    const textInput = document.getElementById('panelTBText');

    if (colorInput) {
      colorInput.addEventListener('input', (ev) => { tb.color = ev.target.value; });
    }
    if (borderColorInput) {
      borderColorInput.addEventListener('input', (ev) => { tb.borderColor = ev.target.value; });
    }
    if (textColorInput) {
      textColorInput.addEventListener('input', (ev) => { tb.textColor = ev.target.value; });
    }
    if (fontSizeInput) {
      fontSizeInput.addEventListener('input', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!Number.isNaN(v) && v >= 8) tb.fontSize = v;
      });
    }
    if (wInput) {
      wInput.addEventListener('input', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!Number.isNaN(v) && v >= 10) tb.w = v;
      });
    }
    if (hInput) {
      hInput.addEventListener('input', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!Number.isNaN(v) && v >= 10) tb.h = v;
      });
    }
    if (textInput) {
      const preview = document.getElementById('panelTBTextPreview');
      textInput.addEventListener('input', (ev) => {
        tb.text = ev.target.value;
        if (preview) preview.innerHTML = renderMarkdownToHtml(ev.target.value);
      });
    }
    return;
  }

  if (state.selectedTextBoxes.size > 1) {
    flushPanelEdit();
    sidePanelContent.innerHTML = '<div class="panel-section-title">' + state.selectedTextBoxes.size + ' text boxes selected</div>';
    return;
  }

  if (state.selectedConnectors.size === 1) {
    flushPanelEdit();
    sidePanelContent.innerHTML = '<div class="panel-section-title">' + state.selectedConnectors.size + ' connector selected</div>';
    return;
  }

  if (state.selectedConnectors.size > 1) {
    flushPanelEdit();
    sidePanelContent.innerHTML = '<div class="panel-section-title">' + state.selectedConnectors.size + ' connectors selected</div>';
    return;
  }

  if (state.selected.size === 0 && state.selectedShapes.size === 0 && state.selectedTextBoxes.size === 0 && state.selectedConnectors.size === 0) {
    flushPanelEdit();
    sidePanelContent.innerHTML = '<div class="panel-empty">Nothing selected</div>';
    return;
  }
  if (state.selected.size > 1) {
    flushPanelEdit();
    sidePanelContent.innerHTML = '<div class="panel-section-title">' + state.selected.size + ' items selected</div>';
    return;
  }

  flushPanelEdit(refreshSidePanel);
  const idx = Array.from(state.selected)[0];
  const n = state.nodes[idx];
  const nodeId = n.id;
  const parentInfo = n.parentId !== null && n.parentId !== undefined
    ? (() => { const p = state.findNodeById(state.nodes, n.parentId); return p ? (p.node.title || `Node ${p.index}`) : '?'; })()
    : null;
  const parentHtml = parentInfo ? '<div class="panel-row"><label>Parent</label><span class="panel-static">' + state.escAttr(parentInfo) + '</span></div>' : '';

  sidePanelContent.innerHTML = [
    '<div class="panel-section-title">Node</div>',
    '<div class="panel-row"><label>Title</label><input id="panelTitle" class="panel-input" type="text" value="' + state.escAttr(n.title ?? '') + '" placeholder="' + state.escAttr(TITLE_PLACEHOLDER) + '" /></div>',
    '<div class="panel-row"><label>Title Color</label><input id="panelTitleColor" class="panel-input panel-input-color" type="color" value="' + (n.titleColor ?? '#e7e7e7') + '" /></div>',
    '<div class="panel-row"><label>Color</label><input id="panelColor" class="panel-input panel-input-color" type="color" value="' + (n.color ?? '#1a1a1a') + '" /></div>',
    '<div class="panel-row"><label>Text Color</label><input id="panelTextColor" class="panel-input panel-input-color" type="color" value="' + (n.textColor ?? '#ddd') + '" /></div>',
    '<div class="panel-row"><label>Font Size</label><input id="panelFontSize" class="panel-input" type="number" min="8" max="72" value="' + (n.fontSize ?? 12) + '" /></div>',
    '<div class="panel-row"><label>Width</label><input id="panelW" class="panel-input" type="number" min="10" value="' + n.w + '" /></div>',
    '<div class="panel-row"><label>Height</label><input id="panelH" class="panel-input" type="number" min="10" value="' + n.h + '" /></div>',
    parentHtml,
    '<div class="panel-row"><label>Text</label><textarea id="panelText" class="panel-input panel-textarea" placeholder="' + state.escAttr(TEXT_PLACEHOLDER) + '">' + state.escAttr(n.text ?? '') + '</textarea></div>',
    '<div id="panelTextPreview" class="panel-markdown-preview">' + renderMarkdownToHtml(n.text ?? '') + '</div>',
  ].join('');

  const titleInput = document.getElementById('panelTitle');
  const titleColorInput = document.getElementById('panelTitleColor');
  const colorInput = document.getElementById('panelColor');
  const textColorInput = document.getElementById('panelTextColor');
  const fontSizeInput = document.getElementById('panelFontSize');
  const wInput = document.getElementById('panelW');
  const hInput = document.getElementById('panelH');
  const textInput = document.getElementById('panelText');

  if (titleInput) {
    titleInput.addEventListener('input', (ev) => { n.title = ev.target.value; });
    titleInput.addEventListener('focus', () => { startPanelEdit(nodeId, 'title', n.title); });
    titleInput.addEventListener('blur', () => { flushPanelEdit(refreshSidePanel); });
  }
  if (titleColorInput) {
    titleColorInput.addEventListener('input', (ev) => { n.titleColor = ev.target.value; });
    titleColorInput.addEventListener('pointerdown', () => { startPanelEdit(nodeId, 'titleColor', n.titleColor); });
    titleColorInput.addEventListener('change', () => { flushPanelEdit(refreshSidePanel); });
  }
  if (colorInput) {
    colorInput.addEventListener('input', (ev) => { n.color = ev.target.value; });
    colorInput.addEventListener('pointerdown', () => { startPanelEdit(nodeId, 'color', n.color); });
    colorInput.addEventListener('change', () => { flushPanelEdit(refreshSidePanel); });
  }
  if (textColorInput) {
    textColorInput.addEventListener('input', (ev) => { n.textColor = ev.target.value; });
    textColorInput.addEventListener('pointerdown', () => { startPanelEdit(nodeId, 'textColor', n.textColor); });
    textColorInput.addEventListener('change', () => { flushPanelEdit(refreshSidePanel); });
  }
  if (fontSizeInput) {
    fontSizeInput.addEventListener('input', (ev) => {
      const v = parseFloat(ev.target.value);
      if (!Number.isNaN(v) && v >= 8) n.fontSize = v;
    });
    fontSizeInput.addEventListener('focus', () => { startPanelEdit(nodeId, 'fontSize', n.fontSize); });
    fontSizeInput.addEventListener('blur', () => { flushPanelEdit(refreshSidePanel); });
  }
  if (wInput) {
    wInput.setAttribute('data-drag-number', 'true');
    wInput.addEventListener('input', (ev) => {
      const v = parseFloat(ev.target.value);
      if (!Number.isNaN(v)) updateNodeWidth(n, v);
    });
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
  if (hInput) {
    hInput.setAttribute('data-drag-number', 'true');
    hInput.addEventListener('input', (ev) => {
      const v = parseFloat(ev.target.value);
      if (!Number.isNaN(v)) updateNodeHeight(n, v);
    });
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
  if (textInput) {
    const preview = document.getElementById('panelTextPreview');
    textInput.addEventListener('input', (ev) => {
      n.text = ev.target.value;
      if (preview) preview.innerHTML = renderMarkdownToHtml(ev.target.value);
    });
    textInput.addEventListener('focus', () => { startPanelEdit(nodeId, 'text', n.text); });
    textInput.addEventListener('blur', () => { flushPanelEdit(refreshSidePanel); });
  }
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
