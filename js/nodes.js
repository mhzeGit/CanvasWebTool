import { state } from './state.js';
import { EDGE_MARGIN, DEFAULT_TITLE_COLOR, DEFAULT_TEXT_COLOR, PLACEHOLDER_COLOR, TITLE_PLACEHOLDER, TEXT_PLACEHOLDER } from './config.js';
import { drawRoundedRect, drawRoundedRectTopOnly, getDarkerColor } from './utils.js';
import { renderMarkdownTitle, renderMarkdownBody } from './markdown.js';

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
  for (let i = drawOrder.length - 1; i >= 0; i--) {
    const idx = drawOrder[i];
    const n = state.nodes[idx];
    const onLeft = Math.abs(wx - n.x) <= EDGE_MARGIN;
    const onRight = Math.abs(wx - (n.x + n.w)) <= EDGE_MARGIN;
    const onTop = Math.abs(wy - n.y) <= EDGE_MARGIN;
    const onBottom = Math.abs(wy - (n.y + n.h)) <= EDGE_MARGIN;
    const inX = wx >= n.x - EDGE_MARGIN && wx <= n.x + n.w + EDGE_MARGIN;
    const inY = wy >= n.y - EDGE_MARGIN && wy <= n.y + n.h + EDGE_MARGIN;
    if (!inX || !inY) continue;
    if (onLeft && onTop) return { idx, handle: 'tl', cursor: 'nw-resize' };
    if (onRight && onTop) return { idx, handle: 'tr', cursor: 'ne-resize' };
    if (onLeft && onBottom) return { idx, handle: 'bl', cursor: 'sw-resize' };
    if (onRight && onBottom) return { idx, handle: 'br', cursor: 'se-resize' };
    if (onLeft) return { idx, handle: 'left', cursor: 'ew-resize' };
    if (onRight) return { idx, handle: 'right', cursor: 'ew-resize' };
    if (onTop) return { idx, handle: 'top', cursor: 'ns-resize' };
    if (onBottom) return { idx, handle: 'bottom', cursor: 'ns-resize' };
  }
  return null;
}

export function getEdgeAt(wx, wy) {
  return findNodeAtEdge(wx, wy);
}

export function findNodeAtPoint(wx, wy) {
  return hitTestNode(wx, wy);
}

export function drawNodes(indices) {
  const drawOrder = indices != null ? indices : state.getDrawOrder();
  const ctx = state.ctx;
  for (const idx of drawOrder) {
    const n = state.nodes[idx];
    const baseColor = n.color || 'rgb(43, 43, 43)';

    const nodeRadius = Math.min(12, Math.min(n.w, n.h) * 0.2);
    ctx.save();
    [
      { dx: 10, dy: 10, ex: 10, ey: 10, rr: 3, a: 0.03 },
      { dx: 7, dy: 7, ex: 6, ey: 6, rr: 2, a: 0.06 },
      { dx: 5, dy: 5, ex: 3, ey: 3, rr: 1, a: 0.12 },
      { dx: 4, dy: 4, ex: 0, ey: 0, rr: 0, a: 0.22 },
    ].forEach(l => {
      ctx.fillStyle = `rgba(0, 0, 0, ${l.a})`;
      drawRoundedRect(ctx, n.x + l.dx, n.y + l.dy, n.w + l.ex, n.h + l.ey, nodeRadius + l.rr);
      ctx.fill();
    });
    ctx.restore();

    ctx.save();
    ctx.fillStyle = baseColor;
    drawRoundedRect(ctx, n.x, n.y, n.w, n.h, nodeRadius);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = getDarkerColor(baseColor, 0.7);
    ctx.lineWidth = 2;
    const outlineOffset = ctx.lineWidth / 2;
    drawRoundedRect(ctx, n.x - outlineOffset, n.y - outlineOffset, n.w + outlineOffset * 2, n.h + outlineOffset * 2, nodeRadius + outlineOffset);
    ctx.stroke();

    if (state.selected.has(idx)) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const dpr = window.devicePixelRatio || 1;
      const screenX = (n.x * state.scale + state.offsetX) * dpr;
      const screenY = (n.y * state.scale + state.offsetY) * dpr;
      const screenW = n.w * state.scale * dpr;
      const screenH = n.h * state.scale * dpr;
      const screenRadius = nodeRadius * state.scale * dpr;
      ctx.strokeStyle = '#f0c800';
      ctx.lineWidth = 1.5;
      const selectionOffset = ctx.lineWidth / 2;
      drawRoundedRect(ctx, screenX - selectionOffset, screenY - selectionOffset, screenW + selectionOffset * 2, screenH + selectionOffset * 2, screenRadius + selectionOffset);
      ctx.stroke();
      ctx.restore();
    }

    const padding = 8;
    const titleLineHeight = 18;
    const maxTitleWidth = Math.max(0, n.w - padding * 2);
    const titleH = padding * 2 + titleLineHeight;
    ctx.save();
    ctx.fillStyle = getDarkerColor(baseColor, 0.6);
    drawRoundedRectTopOnly(ctx, n.x, n.y, n.w, titleH, nodeRadius);
    ctx.fill();
    ctx.restore();

    if (n.title && n.title.length > 0) {
      ctx.save();
      const titleBaseFontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
      renderMarkdownTitle(
        ctx,
        n.title,
        n.x + n.w / 2,
        n.y + padding,
        maxTitleWidth,
        titleBaseFontFamily,
        15,
        n.titleColor || DEFAULT_TITLE_COLOR
      );
      ctx.restore();
    } else {
      ctx.save();
      ctx.fillStyle = PLACEHOLDER_COLOR;
      ctx.font = `bold 15px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const ellipsis = ctx.measureText(TITLE_PLACEHOLDER).width > maxTitleWidth ? '…' : '';
      ctx.fillText(
        ellipsis ? ellipsis : TITLE_PLACEHOLDER,
        n.x + n.w / 2,
        n.y + padding,
        maxTitleWidth
      );
      ctx.restore();
    }

    if (n.text && n.text.length > 0) {
      ctx.save();
      const bodyBaseFontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
      renderMarkdownBody(
        ctx,
        n.text,
        n.x + padding,
        n.y + titleH + padding,
        Math.max(0, n.w - padding * 2),
        Math.max(0, n.h - titleH - padding * 2),
        bodyBaseFontFamily,
        12,
        DEFAULT_TEXT_COLOR,
        14
      );
      ctx.restore();
    } else {
      ctx.save();
      ctx.fillStyle = PLACEHOLDER_COLOR;
      ctx.font = `12px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const maxTextWidth = Math.max(0, n.w - padding * 2);
      const ellipsis = ctx.measureText(TEXT_PLACEHOLDER).width > maxTextWidth ? '…' : '';
      ctx.fillText(
        ellipsis ? ellipsis : TEXT_PLACEHOLDER,
        n.x + padding,
        n.y + titleH + padding,
        maxTextWidth
      );
      ctx.restore();
    }
  }
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
