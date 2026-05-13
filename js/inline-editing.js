import { state } from './state.js';
import { screenToWorld, worldToScreen, getDarkerColor, getNodeEdgePoint, getPointOnBezier, wrapTextLines } from './utils.js';
import { hitTestNode } from './nodes.js';
import { hitTestConnection } from './connections.js';
import { createPropertyChangeCmd } from './undo.js';
import { refreshSidePanel } from './side-panel.js';
import { history } from './history.js';
import { TITLE_PLACEHOLDER, TEXT_PLACEHOLDER } from './config.js';

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
    const contentY = n.y + titleH + padding;
    const maxTextHeight = Math.max(0, n.h - titleH - padding * 2);
    startEditing(hit, 'text', n.x + padding - 4, contentY - 4, maxTitleWidth + 8, maxTextHeight + 8);
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
  const el = document.createElement(isTitle ? 'input' : 'textarea');
  el.className = isTitle ? 'inline-editor inline-editor-title' : 'inline-editor inline-editor-text';
  el.value = n[field] || '';
  el.placeholder = isTitle ? TITLE_PLACEHOLDER : TEXT_PLACEHOLDER;
  el.style.position = 'fixed';
  el.style.left = (screen.x + canvasRect.left) + 'px';
  el.style.top = (screen.y + canvasRect.top) + 'px';
  el.style.width = screenW + 'px';
  el.style.height = screenH + 'px';
  el.style.zIndex = '8';
  const baseColor = n.color || '#2b2b2b';
  el.style.color = isTitle ? (n.titleColor || '#e7e7e7') : '#ddd';
  el.style.fontSize = (isTitle ? 15 : 12) * state.scale + 'px';
  el.style.lineHeight = (isTitle ? 18 : 14) * state.scale + 'px';
  el.style.padding = (8 * state.scale) + 'px';

  if (isTitle) {
    const nodeRadiusEditing = Math.min(12, Math.min(n.w, n.h) * 0.2) * state.scale;
    el.style.background = getDarkerColor(baseColor, 0.6);
    el.style.borderRadius = `${nodeRadiusEditing}px ${nodeRadiusEditing}px 0 0`;
    el.style.border = 'none';
    el.style.overflow = 'hidden';
  } else {
    el.style.background = baseColor;
  }

  document.body.appendChild(el);
  el.focus();
  el.select();

  const originalValue = n[field];
  state.editingState = { type: 'node', idx, field, el, originalValue };

  const commit = () => { commitEditing(); };
  el.addEventListener('blur', commit);
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && isTitle) {
      ev.preventDefault();
      el.blur();
    } else if (ev.key === 'Escape') {
      cancelEditing();
    }
  });
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
  const { type, idx, field, el, originalValue } = state.editingState;
  const newValue = el.value;
  if (type === 'connection') {
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
  if (type === 'connection') {
    state.connections[idx].text = originalValue;
  } else {
    state.nodes[idx][field] = originalValue;
  }
  state.editingState = null;
  try { document.body.removeChild(el); } catch {}
}
