export function screenToWorld(sx, sy, offsetX, offsetY, scale) {
  return { x: (sx - offsetX) / scale, y: (sy - offsetY) / scale };
}

export function worldToScreen(wx, wy, offsetX, offsetY, scale) {
  return { x: wx * scale + offsetX, y: wy * scale + offsetY };
}

/**
 * Returns the world coordinates of the center of the canvas viewport.
 * Used by all add*AtCenter functions to determine where to place new entities.
 */
export function getViewportCenterWorld(canvas, offsetX, offsetY, scale) {
  const rect = canvas.getBoundingClientRect();
  const centerCssX = rect.width / 2;
  const centerCssY = rect.height / 2;
  return screenToWorld(centerCssX, centerCssY, offsetX, offsetY, scale);
}

export function getDividerColor(color) {
  let r, g, b;
  if (typeof color === 'string' && color.startsWith('#') && color.length === 7) {
    r = parseInt(color.slice(1,3), 16);
    g = parseInt(color.slice(3,5), 16);
    b = parseInt(color.slice(5,7), 16);
  } else if (typeof color === 'string' && color.startsWith('rgb')) {
    const m = color.match(/\d+/g);
    if (m && m.length >= 3) {
      r = parseInt(m[0], 10); g = parseInt(m[1], 10); b = parseInt(m[2], 10);
    }
  }
  if (r === undefined) return 'rgba(255,255,255,0.15)';
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance < 128 ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)';
}

export function getBorderColor(color) {
  let r, g, b;
  if (typeof color === 'string' && color.startsWith('#') && color.length === 7) {
    r = parseInt(color.slice(1,3), 16);
    g = parseInt(color.slice(3,5), 16);
    b = parseInt(color.slice(5,7), 16);
  } else if (typeof color === 'string' && color.startsWith('rgb')) {
    const m = color.match(/\d+/g);
    if (m && m.length >= 3) {
      r = parseInt(m[0], 10); g = parseInt(m[1], 10); b = parseInt(m[2], 10);
    }
  }
  if (r === undefined) return 'rgb(100, 100, 100)';
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  if (luminance < 128) {
    const t = 1 - luminance / 128;
    const amt = 0.12 + t * 0.10;
    r = Math.min(255, Math.round(r + (255 - r) * amt));
    g = Math.min(255, Math.round(g + (255 - g) * amt));
    b = Math.min(255, Math.round(b + (255 - b) * amt));
  } else {
    r = Math.max(0, Math.round(r * 0.55));
    g = Math.max(0, Math.round(g * 0.55));
    b = Math.max(0, Math.round(b * 0.55));
  }
  return `rgb(${r}, ${g}, ${b})`;
}

export function getDarkerColor(color, factor = 0.7) {
  let r, g, b;
  if (typeof color === 'string' && color.startsWith('#') && color.length === 7) {
    r = parseInt(color.slice(1,3), 16);
    g = parseInt(color.slice(3,5), 16);
    b = parseInt(color.slice(5,7), 16);
  } else if (typeof color === 'string' && color.startsWith('rgb')) {
    const m = color.match(/\d+/g);
    if (m && m.length >= 3) {
      r = parseInt(m[0], 10); g = parseInt(m[1], 10); b = parseInt(m[2], 10);
    }
  }
  if (r === undefined) return 'rgb(100, 100, 100)';
  r = Math.max(0, Math.min(255, Math.round(r * factor)));
  g = Math.max(0, Math.min(255, Math.round(g * factor)));
  b = Math.max(0, Math.min(255, Math.round(b * factor)));
  return `rgb(${r}, ${g}, ${b})`;
}

export function drawRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export function drawRoundedRectTopOnly(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export function drawWrappedTextWithEllipsis(ctx, text, x, y, maxWidth, maxHeight, lineHeight) {
  if (maxWidth <= 0 || maxHeight <= 0) return;
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';
  const maxLines = Math.max(1, Math.floor(maxHeight / lineHeight));
  for (let i = 0; i < words.length; i++) {
    const candidate = current ? current + ' ' + words[i] : words[i];
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current); else lines.push(words[i]);
      current = '';
      if (lines.length === maxLines) break;
      if (!current && ctx.measureText(words[i]).width <= maxWidth) {
        current = words[i];
      }
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length > maxLines) lines.length = maxLines;
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li];
    if (li === lines.length - 1) {
      const usedText = lines.slice(0, li).join(' ') + (lines.length > 1 ? ' ' : '') + line;
      if (usedText.length < text.length) {
        while (ctx.measureText(line + '\u2026').width > maxWidth && line.length > 0) {
          line = line.slice(0, -1);
        }
        line = line + '\u2026';
      }
    }
    ctx.fillText(line, x, y + li * lineHeight);
  }
}

export function drawSingleLineEllipsis(ctx, text, cx, cy, maxWidth) {
  let str = text;
  if (ctx.measureText(str).width <= maxWidth) {
    ctx.fillText(str, cx, cy);
    return;
  }
  while (str.length > 0 && ctx.measureText(str + '\u2026').width > maxWidth) {
    str = str.slice(0, -1);
  }
  ctx.fillText(str + '\u2026', cx, cy);
}

export function wrapTextLines(ctx, font, text, maxWidth) {
  ctx.save();
  ctx.font = font;
  const words = (text || '').split(/\s+/);
  const lines = [];
  let current = '';
  for (let i = 0; i < words.length; i++) {
    const candidate = current ? current + ' ' + words[i] : words[i];
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current); else lines.push(words[i]);
      current = '';
    }
  }
  if (current) lines.push(current);
  ctx.restore();
  return lines;
}

export function drawWrappedTextWithEllipsisAligned(ctx, font, text, cx, y, maxWidth, maxHeight, lineHeight, align) {
  ctx.save();
  ctx.font = font;
  ctx.textAlign = align === 'center' ? 'center' : 'left';
  const words = (text || '').split(/\s+/);
  const lines = [];
  let current = '';
  const maxLines = Math.max(1, Math.floor(maxHeight / lineHeight));
  for (let i = 0; i < words.length; i++) {
    const candidate = current ? current + ' ' + words[i] : words[i];
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current); else lines.push(words[i]);
      current = '';
      if (lines.length === maxLines) break;
      if (!current && ctx.measureText(words[i]).width <= maxWidth) {
        current = words[i];
      }
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length > maxLines) lines.length = maxLines;
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li];
    if (li === lines.length - 1) {
      const all = lines.join(' ');
      if (all.length < (text || '').length) {
        while (ctx.measureText(line + '\u2026').width > maxWidth && line.length > 0) line = line.slice(0, -1);
        line = line + '\u2026';
      }
    }
    const x = align === 'center' ? cx : (cx - maxWidth / 2);
    ctx.fillText(line, x, y + li * lineHeight);
  }
  ctx.restore();
}

export function getRectEdgePoint(x, y, w, h, targetX, targetY) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const dx = targetX - cx;
  const dy = targetY - cy;

  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return { x: cx, y: cy, side: 'top' };

  const hw = w / 2;
  const hh = h / 2;

  if (dx !== 0) {
    const t = dx > 0 ? hw / dx : -hw / dx;
    const yAtEdge = cy + dy * t;
    if (yAtEdge >= y && yAtEdge <= y + h) {
      const side = dx > 0 ? 'right' : 'left';
      return { x: cx + (dx > 0 ? hw : -hw), y: yAtEdge, side };
    }
  }

  const t = dy > 0 ? hh / dy : -hh / dy;
  const xAtEdge = cx + dx * t;
  const side = dy > 0 ? 'bottom' : 'top';
  return { x: xAtEdge, y: cy + (dy > 0 ? hh : -hh), side };
}

export function getNodeEdgePoint(node, targetX, targetY) {
  return getRectEdgePoint(node.x, node.y, node.w, node.h, targetX, targetY);
}

export function getObjectEdgePoint(obj, targetX, targetY) {
  return getRectEdgePoint(obj.x, obj.y, obj.w, obj.h, targetX, targetY);
}

export function getEdgeAt(wx, wy, entities, edgeMargin) {
  for (let i = entities.length - 1; i >= 0; i--) {
    const e = entities[i];
    const onLeft = Math.abs(wx - e.x) <= edgeMargin;
    const onRight = Math.abs(wx - (e.x + e.w)) <= edgeMargin;
    const onTop = Math.abs(wy - e.y) <= edgeMargin;
    const onBottom = Math.abs(wy - (e.y + e.h)) <= edgeMargin;
    const inX = wx >= e.x - edgeMargin && wx <= e.x + e.w + edgeMargin;
    const inY = wy >= e.y - edgeMargin && wy <= e.y + e.h + edgeMargin;
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

export function computeResizeBounds(start, handle, dx, dy, minW, minH) {
  let newX = start.x, newY = start.y, newW = start.w, newH = start.h;
  switch (handle) {
    case 'left':   newX = start.x + dx; newW = start.w - dx; break;
    case 'right':  newW = start.w + dx; break;
    case 'top':    newY = start.y + dy; newH = start.h - dy; break;
    case 'bottom': newH = start.h + dy; break;
    case 'tl':     newX = start.x + dx; newY = start.y + dy; newW = start.w - dx; newH = start.h - dy; break;
    case 'tr':     newY = start.y + dy; newW = start.w + dx; newH = start.h - dy; break;
    case 'bl':     newX = start.x + dx; newW = start.w - dx; newH = start.h + dy; break;
    case 'br':     newW = start.w + dx; newH = start.h + dy; break;
  }
  if (newW < minW) {
    if (handle.includes('l')) newX = start.x + start.w - minW;
    newW = minW;
  }
  if (newH < minH) {
    if (handle[0] === 't') newY = start.y + start.h - minH;
    newH = minH;
  }
  return { x: newX, y: newY, w: newW, h: newH };
}

export function getPointOnBezier(x1, y1, cx1, cy1, cx2, cy2, x2, y2, t) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * x1 + 3 * mt2 * t * cx1 + 3 * mt * t2 * cx2 + t2 * t * x2,
    y: mt2 * mt * y1 + 3 * mt2 * t * cy1 + 3 * mt * t2 * cy2 + t2 * t * y2,
  };
}

export function getTangentOnBezier(x1, y1, cx1, cy1, cx2, cy2, x2, y2, t) {
  const mt = 1 - t;
  return {
    dx: -3 * mt * mt * x1 + 3 * mt * (mt - 2 * t) * cx1 + 3 * t * (2 * mt - t) * cx2 + 3 * t * t * x2,
    dy: -3 * mt * mt * y1 + 3 * mt * (mt - 2 * t) * cy1 + 3 * t * (2 * mt - t) * cy2 + 3 * t * t * y2,
  };
}
