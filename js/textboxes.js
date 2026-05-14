import { state } from './state.js';
import { drawRoundedRect } from './utils.js';
import { renderMarkdownBody } from './markdown.js';

export function drawTextBoxes() {
  const ctx = state.ctx;
  for (let ti = 0; ti < state.textBoxes.length; ti++) {
    const tb = state.textBoxes[ti];
    const baseColor = tb.color || '#1a1a1a';
    const borderColor = tb.borderColor || '#444';

    ctx.save();
    ctx.fillStyle = baseColor;
    drawRoundedRect(ctx, tb.x, tb.y, tb.w, tb.h, 6);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    const outlineOffset = ctx.lineWidth / 2;
    drawRoundedRect(ctx, tb.x - outlineOffset, tb.y - outlineOffset, tb.w + outlineOffset * 2, tb.h + outlineOffset * 2, 6 + outlineOffset);
    ctx.stroke();
    ctx.restore();

    const padding = 8;
    const fontSize = tb.fontSize || 14;
    const lineHeight = fontSize * 1.4;
    const fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
    const text = tb.text || '';
    if (text) {
      renderMarkdownBody(ctx, text,
        tb.x + padding, tb.y + padding,
        Math.max(0, tb.w - padding * 2),
        Math.max(0, tb.h - padding * 2),
        fontFamily, fontSize, tb.textColor || '#ddd', lineHeight
      );
    } else {
      ctx.save();
      ctx.fillStyle = '#777';
      ctx.font = `${fontSize}px ${fontFamily}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('Double-click to edit', tb.x + padding, tb.y + padding);
      ctx.restore();
    }

    if (state.selectedTextBoxes.has(ti)) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const dpr = window.devicePixelRatio || 1;
      const screenX = (tb.x * state.scale + state.offsetX) * dpr;
      const screenY = (tb.y * state.scale + state.offsetY) * dpr;
      const screenW = tb.w * state.scale * dpr;
      const screenH = tb.h * state.scale * dpr;
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

export function hitTestTextBox(wx, wy) {
  for (let i = state.textBoxes.length - 1; i >= 0; i--) {
    const tb = state.textBoxes[i];
    if (wx >= tb.x && wx <= tb.x + tb.w && wy >= tb.y && wy <= tb.y + tb.h) return i;
  }
  return -1;
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

export function getTextBoxEdgeAt(wx, wy) {
  const EDGE_MARGIN = 8;
  for (let i = state.textBoxes.length - 1; i >= 0; i--) {
    const tb = state.textBoxes[i];
    const onLeft = Math.abs(wx - tb.x) <= EDGE_MARGIN;
    const onRight = Math.abs(wx - (tb.x + tb.w)) <= EDGE_MARGIN;
    const onTop = Math.abs(wy - tb.y) <= EDGE_MARGIN;
    const onBottom = Math.abs(wy - (tb.y + tb.h)) <= EDGE_MARGIN;
    const inX = wx >= tb.x - EDGE_MARGIN && wx <= tb.x + tb.w + EDGE_MARGIN;
    const inY = wy >= tb.y - EDGE_MARGIN && wy <= tb.y + tb.h + EDGE_MARGIN;
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
