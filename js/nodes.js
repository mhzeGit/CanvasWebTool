import { state } from './state.js';
import { EDGE_MARGIN, NODE_MIN_W, NODE_MIN_H, DEFAULT_NODE_COLOR } from './config.js';
import { getEdgeAt as getEntityEdgeAt, drawRoundedRect, getDarkerColor, getBorderColor } from './utils.js';

export function hitTestNode(wx, wy) {
  const drawOrder = state.getDrawOrder();
  for (let i = drawOrder.length - 1; i >= 0; i--) {
    const idx = drawOrder[i];
    const n = state.nodes[idx];
    if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) return idx;
  }
  return -1;
}

export function findNodeAtEdge(wx, wy) {
  const drawOrder = state.getDrawOrder();
  const entities = drawOrder.map(i => state.nodes[i]);
  const hit = getEntityEdgeAt(wx, wy, entities, EDGE_MARGIN);
  if (hit) {
    const nodeIdx = drawOrder[hit.idx];
    const allOrder = state.getAllDrawOrder();
    const ourPos = allOrder.findIndex(item => item.type === 'node' && item.i === nodeIdx);
    if (ourPos === -1) return null;
    for (let i = allOrder.length - 1; i > ourPos; i--) {
      const item = allOrder[i];
      const e = item.type === 'node' ? state.nodes[item.i]
        : item.type === 'shape' ? state.shapes[item.i]
        : state.textBoxes[item.i];
      if (e && wx >= e.x - EDGE_MARGIN && wx <= e.x + e.w + EDGE_MARGIN && wy >= e.y - EDGE_MARGIN && wy <= e.y + e.h + EDGE_MARGIN) return null;
    }
    return { idx: nodeIdx, handle: hit.handle, cursor: hit.cursor };
  }
  return null;
}

export function getEdgeAt(wx, wy) {
  return findNodeAtEdge(wx, wy);
}

export function findNodeAtPoint(wx, wy) {
  return hitTestNode(wx, wy);
}

export function drawNodePreview() {
  if (!state.drawingTool || state.drawingTool !== 'node') return;
  const ctx = state.ctx;
  const x = Math.min(state.drawingStartX, state.lastWorldMouse.x);
  const y = Math.min(state.drawingStartY, state.lastWorldMouse.y);
  const w = Math.abs(state.lastWorldMouse.x - state.drawingStartX);
  const h = Math.abs(state.lastWorldMouse.y - state.drawingStartY);
  const cornerRadius = Math.min(12, Math.min(w, h) * 0.2);

  ctx.save();
  ctx.fillStyle = DEFAULT_NODE_COLOR;
  drawRoundedRect(ctx, x, y, w, h, cornerRadius);
  ctx.fill();
  ctx.strokeStyle = getBorderColor(DEFAULT_NODE_COLOR);
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, x, y, w, h, cornerRadius);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  const titleBarH = Math.min(30, h);
  ctx.fillStyle = getDarkerColor(DEFAULT_NODE_COLOR, 0.6);
  ctx.beginPath();
  ctx.moveTo(x + cornerRadius, y);
  ctx.lineTo(x + w - cornerRadius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + cornerRadius);
  ctx.lineTo(x + w, y + titleBarH);
  ctx.lineTo(x, y + titleBarH);
  ctx.lineTo(x, y + cornerRadius);
  ctx.quadraticCurveTo(x, y, x + cornerRadius, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawSelectionMarquee() {
  if (!state.isSelectingBox) return;
  const x1 = Math.min(state.boxStartX, state.boxEndX);
  const y1 = Math.min(state.boxStartY, state.boxEndY);
  const w = Math.abs(state.boxEndX - state.boxStartX);
  const h = Math.abs(state.boxEndY - state.boxStartY);
  const ctx = state.ctx;
  const dpr = window.devicePixelRatio || 1;
  ctx.lineWidth = 1 / (state.scale * dpr);
  ctx.strokeStyle = 'rgba(90,160,255,0.9)';
  ctx.fillStyle = 'rgba(90,160,255,0.15)';
  ctx.beginPath();
  ctx.rect(x1, y1, w, h);
  ctx.fill();
  ctx.stroke();
}
