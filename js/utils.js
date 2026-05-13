export function screenToWorld(sx, sy, offsetX, offsetY, scale) {
  return { x: (sx - offsetX) / scale, y: (sy - offsetY) / scale };
}

export function worldToScreen(wx, wy, offsetX, offsetY, scale) {
  return { x: wx * scale + offsetX, y: wy * scale + offsetY };
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

export function getNodeEdgePoint(node, targetX, targetY) {
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  const dx = targetX - cx;
  const dy = targetY - cy;

  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return { x: cx, y: cy, side: 'right' };

  const hw = node.w / 2;
  const hh = node.h / 2;

  if (dx !== 0) {
    const t = dx > 0 ? hw / dx : -hw / dx;
    const yAtEdge = cy + dy * t;
    if (yAtEdge >= node.y && yAtEdge <= node.y + node.h) {
      return { x: cx + (dx > 0 ? hw : -hw), y: yAtEdge, side: dx > 0 ? 'right' : 'left' };
    }
  }

  const t = dy > 0 ? hh / dy : -hh / dy;
  const xAtEdge = cx + dx * t;
  return { x: xAtEdge, y: cy + (dy > 0 ? hh : -hh), side: dy > 0 ? 'bottom' : 'top' };
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
