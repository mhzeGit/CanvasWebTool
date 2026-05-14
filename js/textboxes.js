import { state } from './state.js';
import { getEdgeAt, drawRoundedRect } from './utils.js';
import { EDGE_MARGIN } from './config.js';

export function hitTestTextBox(wx, wy) {
  for (let i = state.textBoxes.length - 1; i >= 0; i--) {
    const tb = state.textBoxes[i];
    if (wx >= tb.x && wx <= tb.x + tb.w && wy >= tb.y && wy <= tb.y + tb.h) return i;
  }
  return -1;
}

export function getTextBoxEdgeAt(wx, wy) {
  const hit = getEdgeAt(wx, wy, state.textBoxes, EDGE_MARGIN);
  if (hit) {
    const allOrder = state.getAllDrawOrder();
    const ourPos = allOrder.findIndex(item => item.type === 'textBox' && item.i === hit.idx);
    if (ourPos === -1) return null;
    for (let i = allOrder.length - 1; i > ourPos; i--) {
      const item = allOrder[i];
      const e = item.type === 'node' ? state.nodes[item.i]
        : item.type === 'shape' ? state.shapes[item.i]
        : state.textBoxes[item.i];
      if (e && wx >= e.x - EDGE_MARGIN && wx <= e.x + e.w + EDGE_MARGIN && wy >= e.y - EDGE_MARGIN && wy <= e.y + e.h + EDGE_MARGIN) return null;
    }
  }
  return hit;
}

export function drawTextBoxPreview() {
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
