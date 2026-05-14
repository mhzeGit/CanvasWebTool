import { state } from './state.js';
import { drawRoundedRect, getDarkerColor, getEdgeAt } from './utils.js';
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

export function drawOneShape(si) {
  const ctx = state.ctx;
  const s = state.shapes[si];
  const baseColor = s.color || '#2b2b2b';
  const borderColor = s.borderColor || '#6bb5ff';
  const borderWidth = s.borderWidth ?? 2;

  ctx.save();
  ctx.fillStyle = baseColor;
  drawShapePath(ctx, s);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = borderWidth;
  drawShapePath(ctx, s);
  ctx.stroke();
  ctx.restore();

  if (state.selectedShapes.has(si)) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = window.devicePixelRatio || 1;
    const sx = (s.x * state.scale + state.offsetX) * dpr;
    const sy = (s.y * state.scale + state.offsetY) * dpr;
    const sw = s.w * state.scale * dpr;
    const sh = s.h * state.scale * dpr;
    ctx.strokeStyle = '#f0c800';
    ctx.lineWidth = 1.5;
    const screenShape = { ...s, x: sx, y: sy, w: sw, h: sh };
    drawShapePath(ctx, screenShape);
    ctx.stroke();
    ctx.restore();
  }
}

export function drawShapes(indices) {
  const list = indices || state.shapes.map((_, i) => i);
  for (const si of list) drawOneShape(si);
}

export function hitTestShape(wx, wy) {
  for (let i = state.shapes.length - 1; i >= 0; i--) {
    const s = state.shapes[i];
    if (wx >= s.x && wx <= s.x + s.w && wy >= s.y && wy <= s.y + s.h) return i;
  }
  return -1;
}

export function getShapeEdgeAt(wx, wy) {
  return getEdgeAt(wx, wy, state.shapes, EDGE_MARGIN);
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
