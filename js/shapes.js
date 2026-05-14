import { state } from './state.js';
import { drawRoundedRect, getDarkerColor } from './utils.js';

function drawShapePath(ctx, s) {
  const hw = s.w / 2;
  const hh = s.h / 2;
  const cx = s.x + hw;
  const cy = s.y + hh;

  ctx.beginPath();
  switch (s.shapeType) {
    case 'rectangle':
      drawRoundedRect(ctx, s.x, s.y, s.w, s.h, 4);
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

export function drawShapes() {
  const ctx = state.ctx;
  for (let si = 0; si < state.shapes.length; si++) {
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
      const screenX = (s.x * state.scale + state.offsetX) * dpr;
      const screenY = (s.y * state.scale + state.offsetY) * dpr;
      const screenW = s.w * state.scale * dpr;
      const screenH = s.h * state.scale * dpr;
      ctx.strokeStyle = '#f0c800';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(screenX, screenY, screenW, screenH);

      const handleSz = 6 * dpr;
      const handles = [
        [screenX, screenY],
        [screenX + screenW / 2, screenY],
        [screenX + screenW, screenY],
        [screenX, screenY + screenH / 2],
        [screenX + screenW, screenY + screenH / 2],
        [screenX, screenY + screenH],
        [screenX + screenW / 2, screenY + screenH],
        [screenX + screenW, screenY + screenH],
      ];
      ctx.fillStyle = '#f0c800';
      for (const [hx, hy] of handles) {
        ctx.fillRect(hx - handleSz / 2, hy - handleSz / 2, handleSz, handleSz);
      }
      ctx.restore();
    }
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
  const EDGE_MARGIN = 8;
  for (let i = state.shapes.length - 1; i >= 0; i--) {
    const s = state.shapes[i];
    const onLeft = Math.abs(wx - s.x) <= EDGE_MARGIN;
    const onRight = Math.abs(wx - (s.x + s.w)) <= EDGE_MARGIN;
    const onTop = Math.abs(wy - s.y) <= EDGE_MARGIN;
    const onBottom = Math.abs(wy - (s.y + s.h)) <= EDGE_MARGIN;
    const inX = wx >= s.x - EDGE_MARGIN && wx <= s.x + s.w + EDGE_MARGIN;
    const inY = wy >= s.y - EDGE_MARGIN && wy <= s.y + s.h + EDGE_MARGIN;
    if (!inX || !inY) continue;
    if (onLeft && onTop) return { idx: i, handle: 'tl', cursor: 'nw-resize' };
    if (onRight && onTop) return { idx: i, handle: 'tr', cursor: 'ne-resize' };
    if (onLeft && onBottom) return { idx: i, handle: 'bl', cursor: 'sw-resize' };
    if (onRight && onBottom) return { idx: i, handle: 'br', cursor: 'se-resize' };
    if (onLeft) return { idx: i, handle: 'left', cursor: 'ew-resize' };
    if (onRight) return { idx: i, handle: 'right', cursor: 'ew-resize' };
    if (onTop) return { idx: i, handle: 'top', cursor: 'ns-resize' };
    if (onBottom) return { idx: i, handle: 'bottom', cursor: 'ns-resize' };
  }
  return null;
}

export function isShapeInBox(shape, bx1, by1, bx2, by2) {
  return !(shape.x + shape.w < bx1 || shape.x > bx2 || shape.y + shape.h < by1 || shape.y > by2);
}
