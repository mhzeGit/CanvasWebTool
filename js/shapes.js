import { state } from './state.js';
import { getEdgeAt, drawRoundedRect } from './utils.js';
import { EDGE_MARGIN } from './config.js';

function drawShapePath(ctx, s) {
  const hw = s.w / 2;
  const hh = s.h / 2;
  const cx = s.x + hw;
  const cy = s.y + hh;

  ctx.beginPath();
  switch (s.shapeType) {
    case 'rectangle':
      drawRoundedRect(ctx, s.x, s.y, s.w, s.h, s.cornerRadius ?? 4);
      break;
    case 'circle': {
      const rx = hw;
      const ry = hh;
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      break;
    }
    case 'triangle':
      ctx.moveTo(cx, s.y);
      ctx.lineTo(s.x + s.w, s.y + s.h);
      ctx.lineTo(s.x, s.y + s.h);
      ctx.closePath();
      break;
    case 'diamond':
      ctx.moveTo(cx, s.y);
      ctx.lineTo(s.x + s.w, cy);
      ctx.lineTo(cx, s.y + s.h);
      ctx.lineTo(s.x, cy);
      ctx.closePath();
      break;
    default:
      drawRoundedRect(ctx, s.x, s.y, s.w, s.h, 4);
  }
}

export function hitTestShape(wx, wy) {
  for (let i = state.shapes.length - 1; i >= 0; i--) {
    const s = state.shapes[i];
    if (wx >= s.x && wx <= s.x + s.w && wy >= s.y && wy <= s.y + s.h) return i;
  }
  return -1;
}

export function getShapeEdgeAt(wx, wy) {
  const hit = getEdgeAt(wx, wy, state.shapes, EDGE_MARGIN);
  if (hit) {
    const allOrder = state.getAllDrawOrder();
    const ourPos = allOrder.findIndex(item => item.type === 'shape' && item.i === hit.idx);
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

export function isShapeInBox(shape, bx1, by1, bx2, by2) {
  return !(shape.x + shape.w < bx1 || shape.x > bx2 || shape.y + shape.h < by1 || shape.y > by2);
}

export function drawShapePreview() {
  if (!state.drawingTool || state.drawingTool !== 'shape') return;
  const ctx = state.ctx;
  const x = Math.min(state.drawingStartX, state.lastWorldMouse.x);
  const y = Math.min(state.drawingStartY, state.lastWorldMouse.y);
  const w = Math.abs(state.lastWorldMouse.x - state.drawingStartX);
  const h = Math.abs(state.lastWorldMouse.y - state.drawingStartY);

  const previewShape = {
    shapeType: state.drawingShapeType || 'rectangle',
    x, y, w, h,
    color: state.lastShapeColor || '#2b2b2b',
    borderColor: state.lastShapeBorderColor || '#6bb5ff',
    borderWidth: 2,
  };

  ctx.save();
  ctx.fillStyle = previewShape.color;
  drawShapePath(ctx, previewShape);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = previewShape.borderColor;
  ctx.lineWidth = previewShape.borderWidth;
  drawShapePath(ctx, previewShape);
  ctx.stroke();
  ctx.restore();
}
