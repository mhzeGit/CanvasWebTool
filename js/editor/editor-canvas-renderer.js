function getFont(ctx, marks, baseFontSize, baseFontFamily) {
  let weight = '';
  let style = '';
  let family = baseFontFamily;
  let size = baseFontSize;

  for (const mark of (marks || [])) {
    if (mark.type === 'bold') weight = 'bold ';
    if (mark.type === 'italic') style = 'italic ';
    if (mark.type === 'code') family = 'Consolas, "Cascadia Code", "Fira Code", monospace';
    if (mark.type === 'textStyle') {
      if (mark.attrs && mark.attrs.fontSize) {
        const n = parseFloat(mark.attrs.fontSize);
        if (!isNaN(n)) size = n;
      }
    }
  }

  return { font: `${style}${weight}${size}px ${family}`, size };
}

function measureText(ctx, text, marks, baseFontSize, baseFontFamily) {
  ctx.save();
  const { font } = getFont(ctx, marks, baseFontSize, baseFontFamily);
  ctx.font = font;
  const w = ctx.measureText(text || ' ').width;
  ctx.restore();
  return w;
}

function drawTextNode(ctx, node, x, y, baseFontSize, baseFontFamily, defaultColor) {
  const marks = node.marks || [];
  const { font, size } = getFont(ctx, marks, baseFontSize, baseFontFamily);
  ctx.save();
  ctx.font = font;

  let color = defaultColor;
  for (const mark of marks) {
    if (mark.type === 'textStyle' && mark.attrs && mark.attrs.color) {
      color = mark.attrs.color;
    }
  }
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(node.text || '', x, y);

  let textW = 0;
  try { textW = ctx.measureText(node.text || '').width; } catch (_) { textW = 0; }

  for (const mark of marks) {
    if (mark.type === 'underline') {
      const uly = y + size * 1.1;
      ctx.beginPath();
      ctx.moveTo(x, uly);
      ctx.lineTo(x + textW, uly);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (mark.type === 'strike') {
      const strikeY = y + size * 0.45;
      ctx.beginPath();
      ctx.moveTo(x, strikeY);
      ctx.lineTo(x + textW, strikeY);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (mark.type === 'link') {
      const uly = y + size * 1.15;
      ctx.beginPath();
      ctx.moveTo(x, uly);
      ctx.lineTo(x + textW, uly);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  ctx.restore();
  return textW;
}

function tokenizeContent(content) {
  const tokens = [];
  for (const node of (content || [])) {
    if (node.type === 'text') {
      const parts = (node.text || '').split(/\s+/).filter(Boolean);
      for (const part of parts) {
        tokens.push({ type: 'word', text: part, marks: node.marks || [] });
      }
    } else if (node.type === 'hardBreak') {
      tokens.push({ type: 'break' });
    }
  }
  return tokens;
}

function buildDisplayLines(ctx, content, maxWidth, baseFontSize, baseFontFamily) {
  const tokens = tokenizeContent(content);
  if (tokens.length === 0) return [[]];

  const lines = [];
  let currentLine = [];
  let currentWidth = 0;

  const spaceW = measureText(ctx, ' ', [{ type: 'textStyle', attrs: { fontSize: baseFontSize + 'px' } }], baseFontSize, baseFontFamily);

  for (const token of tokens) {
    if (token.type === 'break') {
      if (currentLine.length > 0) lines.push(currentLine);
      lines.push([]);
      currentLine = [];
      currentWidth = 0;
      continue;
    }

    const w = measureText(ctx, token.text, token.marks, baseFontSize, baseFontFamily);
    const needSpace = currentLine.length > 0;

    if (needSpace && currentWidth + spaceW + w > maxWidth) {
      lines.push(currentLine);
      currentLine = [token];
      currentWidth = w;
    } else {
      if (needSpace) currentWidth += spaceW;
      currentWidth += w;
      currentLine.push(token);
    }
  }

  if (currentLine.length > 0) lines.push(currentLine);
  return lines;
}

function renderOneBlock(ctx, node, x, y, maxW, maxH, baseFontSize, baseFontFamily, textColor, lineHeight, isBold) {
  const type = node.type;
  let fontSize = baseFontSize;
  let lh = lineHeight;
  const prefixPad = 4;

  if (type === 'heading') {
    const level = (node.attrs && node.attrs.level) || 1;
    if (level === 1) { fontSize = Math.round(baseFontSize * 1.5); lh = Math.round(lineHeight * 1.5); }
    else if (level === 2) { fontSize = Math.round(baseFontSize * 1.3); lh = Math.round(lineHeight * 1.3); }
    else if (level === 3) { fontSize = Math.round(baseFontSize * 1.15); lh = Math.round(lineHeight * 1.15); }
  }

  if (type === 'horizontalRule') {
    const hrY = y + lh / 2;
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = textColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, hrY);
    ctx.lineTo(x + maxW, hrY);
    ctx.stroke();
    ctx.restore();
    return { lineCount: 1, height: lh };
  }

  let prefixW = 0;

  if (type === 'bulletList' || type === 'orderedList') {
    const items = node.content || [];
    let itemY = y;
    let totalLines = 0;
    let n = (type === 'orderedList' && node.attrs && node.attrs.start) || 1;

    for (const li of items) {
      if (itemY + lh > y + maxH) break;
      if (li.type !== 'listItem') continue;

      let markerText;
      if (type === 'bulletList') {
        markerText = '\u2022';
      } else {
        markerText = n + '.';
        n++;
      }

      ctx.save();
      const markerFont = `${'bold '}${baseFontSize}px ${baseFontFamily}`;
      ctx.font = markerFont;
      ctx.fillStyle = brightenColor(textColor, 0.4);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(markerText, x, itemY);
      const markerW = ctx.measureText(markerText).width;
      ctx.restore();

      const contentMaxW = maxW - (markerW + prefixPad);
      if (contentMaxW <= 0) break;

      const paraContent = li.content?.[0]?.content || [];
      const displayLines = buildDisplayLines(ctx, paraContent, contentMaxW, fontSize, baseFontFamily);

      for (let dl = 0; dl < displayLines.length; dl++) {
        if (itemY + lh > y + maxH) break;
        let cx = x + markerW + prefixPad;
        const words = displayLines[dl];
        for (let wi = 0; wi < words.length; wi++) {
          const w = words[wi];
          const tw = drawTextNode(ctx, w, cx, itemY, baseFontSize, baseFontFamily, textColor);
          cx += tw;
          if (wi < words.length - 1) {
            const sw = measureText(ctx, ' ', [{ type: 'textStyle', attrs: { fontSize: fontSize + 'px' } }], baseFontSize, baseFontFamily);
            cx += sw;
          }
        }
        itemY += lh;
        totalLines++;
      }
    }
    return { lineCount: totalLines, height: itemY - y };
  }

  if (type === 'blockquote') {
    const innerContent = [];
    for (const child of (node.content || [])) {
      if (child.content) innerContent.push(...child.content);
    }

    const qtContentMaxW = maxW - (3 + 5);
    const qtLines = buildDisplayLines(ctx, innerContent, qtContentMaxW, fontSize, baseFontFamily);
    const qtH = qtLines.length * lh;
    const bgPad = 4;

    const barW = 3;
    const barPad = 5;

    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = textColor;
    ctx.fillRect(x, y - bgPad, maxW, qtH + bgPad * 2);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = textColor;
    ctx.fillRect(x, y, barW, qtH);
    ctx.restore();

    prefixW = barW + barPad;

    const contentMaxW = maxW - prefixW;

    for (let dl = 0; dl < qtLines.length; dl++) {
      if (y + dl * lh + lh > y + maxH) break;
      let cx = x + prefixW;
      const words = qtLines[dl];
      for (let wi = 0; wi < words.length; wi++) {
        const w = words[wi];
        const tw = drawTextNode(ctx, w, cx, y + dl * lh, baseFontSize, baseFontFamily, textColor);
        cx += tw;
        if (wi < words.length - 1) {
          const sw = measureText(ctx, ' ', [{ type: 'textStyle', attrs: { fontSize: fontSize + 'px' } }], baseFontSize, baseFontFamily);
          cx += sw;
        }
      }
    }
    return { lineCount: qtLines.length, height: qtLines.length * lh };
  }

  const innerContent = (node.content || []).filter(c => c.type === 'text' || c.type === 'hardBreak');
  const displayLines = buildDisplayLines(ctx, innerContent, maxW, fontSize, baseFontFamily);

  for (let dl = 0; dl < displayLines.length; dl++) {
    if (y + dl * lh + lh > y + maxH) break;
    let cx = x;
    const words = displayLines[dl];
    for (let wi = 0; wi < words.length; wi++) {
      const w = words[wi];
      const wordMarks = isBold ? [...(w.marks || []), { type: 'bold' }] : (w.marks || []);
      const wordNode = { type: 'text', text: w.text, marks: wordMarks };
      const tw = drawTextNode(ctx, wordNode, cx, y + dl * lh, baseFontSize, baseFontFamily, textColor);
      cx += tw;
      if (wi < words.length - 1) {
        const sw = measureText(ctx, ' ', [{ type: 'textStyle', attrs: { fontSize: fontSize + 'px' } }], baseFontSize, baseFontFamily);
        cx += sw;
      }
    }
  }
  return { lineCount: displayLines.length, height: displayLines.length * lh };
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(c => Math.min(255, Math.max(0, Math.round(c))).toString(16).padStart(2, '0')).join('');
}

function brightenColor(hex, amount) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex(
    rgb.r + (255 - rgb.r) * amount,
    rgb.g + (255 - rgb.g) * amount,
    rgb.b + (255 - rgb.b) * amount
  );
}

export function renderTiptapContent(ctx, content, x, y, maxW, maxH, fontFamily, baseFontSize, textColor, lineHeight) {
  if (!content || !content.content || maxW <= 0 || maxH <= 0) return;

  let currentY = y;

  for (let bi = 0; bi < content.content.length; bi++) {
    const node = content.content[bi];
    let lh = lineHeight;
    let fontSize = baseFontSize;
    let isBold = false;

    if (node.type === 'heading') {
      isBold = true;
      const level = (node.attrs && node.attrs.level) || 1;
      if (level === 1) { fontSize = Math.round(baseFontSize * 1.5); lh = Math.round(lineHeight * 1.5); }
      else if (level === 2) { fontSize = Math.round(baseFontSize * 1.3); lh = Math.round(lineHeight * 1.3); }
      else if (level === 3) { fontSize = Math.round(baseFontSize * 1.15); lh = Math.round(lineHeight * 1.15); }
    }

    if (currentY + lh > y + maxH) return;

    const result = renderOneBlock(ctx, node, x, currentY, maxW, maxH, baseFontSize, fontFamily, textColor, lineHeight, isBold);
    currentY += result.height;
  }
}
