import { state } from './state.js';
import { screenToWorld, worldToScreen, getDarkerColor, getNodeEdgePoint, getPointOnBezier, wrapTextLines } from './utils.js';
import { hitTestNode } from './nodes.js';
import { hitTestConnection } from './connections.js';
import { hitTestTextBox } from './textboxes.js';
import { createPropertyChangeCmd } from './undo.js';
import { refreshSidePanel } from './side-panel.js';
import { history } from './history.js';
import { createRichTextEditor, markdownToBlocks } from './rich-text.js';
import { TITLE_PLACEHOLDER, DEFAULT_NODE_COLOR } from './config.js';

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
  const isRichText = field === 'text';

  if (isRichText) {
    ensureBlocks(n);
    const baseColor = n.color || DEFAULT_NODE_COLOR;
    const fontSize = n.fontSize || 12;
    const rt = createRichTextEditor({
      blocks: n.blocks || [{ t: 'p', s: [{ t: '' }] }],
    });

    const el = rt.container;
    el.style.position = 'fixed';
    el.style.left = (screen.x + canvasRect.left) + 'px';
    el.style.top = (screen.y + canvasRect.top) + 'px';
    el.style.width = screenW + 'px';
    el.style.height = screenH + 'px';
    el.style.zIndex = '8';
    el.style.color = n.textColor || '#ddd';
    el.style.fontSize = (fontSize * state.scale) + 'px';
    el.style.background = baseColor;
    el.style.border = '1px solid #f0c800';
    el.style.borderRadius = '4px';
    el.style.overflow = 'hidden';
    el.style.outline = 'none';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';

    const area = rt.editorArea;
    area.style.fontSize = (fontSize * state.scale) + 'px';
    area.style.lineHeight = '1.4';
    area.style.color = n.textColor || '#ddd';
    area.style.background = baseColor;

    document.body.appendChild(el);
    rt.focus();

    const originalValue = JSON.stringify(n.blocks || [{ t: 'p', s: [{ t: '' }] }]);
    state.editingState = { type: 'node', idx, field, el, originalValue, isRichText: true, rt };

    el.addEventListener('input', () => {
      n.blocks = rt.getBlocks();
      if (n.blocks && n.blocks.length > 0) {
        n.text = blocksToSimpleText(n.blocks);
      }
    });

    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        cancelEditing();
      }
    });

    const commit = () => { commitEditing(); };
    el.addEventListener('blur', commit);
  } else {
    const el = document.createElement('input');
    el.className = 'inline-editor inline-editor-title';
    el.value = n[field] || '';
    el.placeholder = TITLE_PLACEHOLDER;
    el.style.position = 'fixed';
    el.style.left = (screen.x + canvasRect.left) + 'px';
    el.style.top = (screen.y + canvasRect.top) + 'px';
    el.style.width = screenW + 'px';
    el.style.height = screenH + 'px';
    el.style.zIndex = '8';
    el.style.color = n.titleColor || '#e7e7e7';
    el.style.fontSize = (15 * state.scale) + 'px';
    el.style.lineHeight = (18 * state.scale) + 'px';
    el.style.padding = (8 * state.scale) + 'px';
    const baseColor = n.color || DEFAULT_NODE_COLOR;
    const nodeRadiusEditing = Math.min(12, Math.min(n.w, n.h) * 0.2) * state.scale;
    el.style.background = getDarkerColor(baseColor, 0.6);
    el.style.borderRadius = `${nodeRadiusEditing}px ${nodeRadiusEditing}px 0 0`;
    el.style.border = 'none';
    el.style.outline = 'none';
    el.style.overflow = 'hidden';

    document.body.appendChild(el);
    el.focus();
    el.select();

    const originalValue = n[field];
    state.editingState = { type: 'node', idx, field, el, originalValue, isRichText: false };

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

    const commit = () => { commitEditing(); };
    el.addEventListener('blur', commit);
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

export function commitEditing() {
  if (!state.editingState) return;
  const { type, idx, field, el, originalValue, isRichText, rt } = state.editingState;

  if (isRichText && rt) {
    const blocks = rt.getBlocks();
    if (type === 'textBox') {
      state.textBoxes[idx].blocks = blocks;
      if (blocks && blocks.length > 0) {
        state.textBoxes[idx].text = blocksToSimpleText(blocks);
      }
    } else if (type === 'node') {
      state.nodes[idx].blocks = blocks;
      if (blocks && blocks.length > 0) {
        state.nodes[idx].text = blocksToSimpleText(blocks);
      }
      const newValue = JSON.stringify(blocks);
      if (originalValue !== newValue && state.nodes[idx].id !== undefined) {
        history.push(createPropertyChangeCmd(state.nodes, state.selected, refreshSidePanel, state.nodes[idx].id, field, originalValue, newValue));
      }
    }
    rt.destroy();
  } else {
    const newValue = type === 'textBox' ? state.textBoxes[idx].text :
      type === 'connection' ? state.connections[idx].text : state.nodes[idx][field];
    if (type === 'node' && originalValue !== newValue && state.nodes[idx].id !== undefined) {
      history.push(createPropertyChangeCmd(state.nodes, state.selected, refreshSidePanel, state.nodes[idx].id, field, originalValue, newValue));
    }
  }

  state.editingState = null;
  try { document.body.removeChild(el); } catch {}
  refreshSidePanel();
}

export function cancelEditing() {
  if (!state.editingState) return;
  const { type, idx, field, el, originalValue, isRichText, rt } = state.editingState;

  if (isRichText && rt) {
    rt.destroy();
    try {
      const blocks = JSON.parse(originalValue);
      if (type === 'textBox') {
        state.textBoxes[idx].blocks = blocks;
        if (blocks && blocks.length > 0) state.textBoxes[idx].text = blocksToSimpleText(blocks);
      } else if (type === 'node') {
        state.nodes[idx].blocks = blocks;
        if (blocks && blocks.length > 0) state.nodes[idx].text = blocksToSimpleText(blocks);
      }
    } catch (e) { /* ignore */ }
  } else {
    if (type !== 'connection') {
      state.nodes[idx][field] = originalValue;
    } else {
      state.connections[idx].text = originalValue;
    }
  }

  state.editingState = null;
  try { document.body.removeChild(el); } catch {}
}

function ensureBlocks(entity) {
  if (!entity.blocks || !Array.isArray(entity.blocks) || entity.blocks.length === 0) {
    if (typeof entity.text === 'string' && entity.text.trim()) {
      entity.blocks = markdownToBlocks(entity.text);
    } else {
      entity.blocks = [{ t: 'p', s: [{ t: '' }] }];
    }
  }
}

function blocksToSimpleText(blocks) {
  if (!blocks || !blocks.length) return '';
  const lines = [];
  for (const bl of blocks) {
    if (bl.t === 'hr') { lines.push('---'); continue; }
    let line = '';
    for (const sp of (bl.s || [])) {
      line += (sp.t || '');
    }
    lines.push(line);
  }
  return lines.join('\n');
}

function startTextBoxEditing(tbIdx) {
  cancelEditing();

  const tb = state.textBoxes[tbIdx];
  const canvasRect = state.canvas.getBoundingClientRect();
  const screen = worldToScreen(tb.x, tb.y, state.offsetX, state.offsetY, state.scale);
  const screenW = tb.w * state.scale;
  const screenH = tb.h * state.scale;

  ensureBlocks(tb);
  const rt = createRichTextEditor({
    blocks: tb.blocks || [{ t: 'p', s: [{ t: '' }] }],
  });

  const el = rt.container;
  el.style.position = 'fixed';
  el.style.left = (screen.x + canvasRect.left) + 'px';
  el.style.top = (screen.y + canvasRect.top) + 'px';
  el.style.width = screenW + 'px';
  el.style.height = screenH + 'px';
  el.style.zIndex = '8';
  el.style.color = tb.textColor || '#ddd';
  el.style.fontSize = ((tb.fontSize || 14) * state.scale) + 'px';
  el.style.background = tb.color || '#1a1a1a';
  el.style.border = '1px solid #f0c800';
  el.style.borderRadius = '6px';
  el.style.overflow = 'hidden';
  el.style.outline = 'none';
  el.style.display = 'flex';
  el.style.flexDirection = 'column';

  const area = rt.editorArea;
  area.style.fontSize = ((tb.fontSize || 14) * state.scale) + 'px';
  area.style.lineHeight = '1.4';
  area.style.color = tb.textColor || '#ddd';
  area.style.background = tb.color || '#1a1a1a';

  document.body.appendChild(el);
  rt.focus();

  const originalValue = JSON.stringify(tb.blocks || [{ t: 'p', s: [{ t: '' }] }]);
  state.editingState = { type: 'textBox', idx: tbIdx, el, originalValue, isRichText: true, rt };

  el.addEventListener('input', () => {
    tb.blocks = rt.getBlocks();
    if (tb.blocks && tb.blocks.length > 0) {
      tb.text = blocksToSimpleText(tb.blocks);
    }
  });

  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      cancelEditing();
    }
  });

  const commit = () => { commitEditing(); };
  el.addEventListener('blur', commit);
}
