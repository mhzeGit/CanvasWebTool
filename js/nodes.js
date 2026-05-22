import { state } from './state.js';
import { EDGE_MARGIN } from './config.js';
import { getEdgeAt as getEntityEdgeAt, drawRoundedRect, getDarkerColor, getBorderColor, worldToScreen } from './utils.js';

export function hitTestNode(wx, wy) {
  for (let i = state.textBoxes.length - 1; i >= 0; i--) {
    const tb = state.textBoxes[i];
    if (wx >= tb.x && wx <= tb.x + tb.w && wy >= tb.y && wy <= tb.y + tb.h) return i;
  }
  return -1;
}

export function findNodeAtEdge(wx, wy) {
  const allOrder = state.getAllDrawOrder();
  const tbIndexMap = [];
  const textBoxEntities = [];
  for (const item of allOrder) {
    if (item.type === 'textBox') {
      tbIndexMap.push(item.i);
      textBoxEntities.push(state.textBoxes[item.i]);
    }
  }
  const hit = getEntityEdgeAt(wx, wy, textBoxEntities, EDGE_MARGIN);
  if (hit) {
    const tbIdx = tbIndexMap[hit.idx];
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
  const ctx = state.arrowCtx;
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
  const el = document.getElementById('marquee');
  if (!state.isSelectingBox) {
    if (el) el.style.display = 'none';
    return;
  }
  const canvasRect = state.canvas.getBoundingClientRect();
  const x1 = Math.min(state.boxStartX, state.boxEndX);
  const y1 = Math.min(state.boxStartY, state.boxEndY);
  const x2 = Math.max(state.boxStartX, state.boxEndX);
  const y2 = Math.max(state.boxStartY, state.boxEndY);
  const s1 = worldToScreen(x1, y1, state.offsetX, state.offsetY, state.scale);
  const s2 = worldToScreen(x2, y2, state.offsetX, state.offsetY, state.scale);
  if (el) {
    el.style.left = (s1.x + canvasRect.left) + 'px';
    el.style.top = (s1.y + canvasRect.top) + 'px';
    el.style.width = (s2.x - s1.x) + 'px';
    el.style.height = (s2.y - s1.y) + 'px';
    el.style.display = 'block';
  }
}
