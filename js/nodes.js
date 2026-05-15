import { state } from './state.js';
import { EDGE_MARGIN } from './config.js';
import { getEdgeAt as getEntityEdgeAt, drawRoundedRect, getDarkerColor, getBorderColor } from './utils.js';

export function hitTestNode(wx, wy) {
  for (let i = state.nodes.length - 1; i >= 0; i--) {
    const n = state.nodes[i];
    if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) return i;
  }
  return -1;
}

export function findNodeAtEdge(wx, wy) {
  const allOrder = state.getAllDrawOrder();
  const textBoxEntities = allOrder.filter(item => item.type === 'textBox').map(item => state.textBoxes[item.i]);
  const hit = getEntityEdgeAt(wx, wy, textBoxEntities, EDGE_MARGIN);
  if (hit) {
    const tbIdx = hit.idx;
    const allPos = allOrder.findIndex(item => item.type === 'textBox' && item.i === tbIdx);
    if (allPos === -1) return null;
    for (let i = allOrder.length - 1; i > allPos; i--) {
      const item = allOrder[i];
      const e = item.type === 'shape' ? state.shapes[item.i]
        : state.textBoxes[item.i];
      if (e && wx >= e.x - EDGE_MARGIN && wx <= e.x + e.w + EDGE_MARGIN && wy >= e.y - EDGE_MARGIN && wy <= e.y + e.h + EDGE_MARGIN) return null;
    }
    return { idx: tbIdx, handle: hit.handle, cursor: hit.cursor };
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
  if (!state.drawingTool || state.drawingTool !== 'text') return;
  const ctx = state.ctx;
  const x = Math.min(state.drawingStartX, state.lastWorldMouse.x);
  const y = Math.min(state.drawingStartY, state.lastWorldMouse.y);
  const w = Math.abs(state.lastWorldMouse.x - state.drawingStartX);
  const h = Math.abs(state.lastWorldMouse.y - state.drawingStartY);

  ctx.save();
  ctx.fillStyle = '#1a1a1a';
  drawRoundedRect(ctx, x, y, w, h, 6);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1.5;
  const outlineOffset = ctx.lineWidth / 2;
  drawRoundedRect(ctx, x - outlineOffset, y - outlineOffset, w + outlineOffset * 2, h + outlineOffset * 2, 6 + outlineOffset);
  ctx.stroke();
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
