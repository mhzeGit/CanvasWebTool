function parseInlineSpans(text) {
  const spans = [];
  let pos = 0;
  let buf = '';

  function flush() {
    if (buf) { spans.push({ text: buf, bold: false, italic: false, code: false, strike: false }); buf = ''; }
  }

  while (pos < text.length) {
    if (text.slice(pos, pos + 2) === '**') {
      flush();
      const end = text.indexOf('**', pos + 2);
      if (end !== -1) {
        const inner = text.slice(pos + 2, end);
        if (inner) spans.push({ text: inner, bold: true, italic: false, code: false, strike: false });
        pos = end + 2;
        continue;
      }
      buf += '**';
      pos += 2;
    } else if (text.slice(pos, pos + 2) === '~~') {
      flush();
      const end = text.indexOf('~~', pos + 2);
      if (end !== -1) {
        const inner = text.slice(pos + 2, end);
        if (inner) spans.push({ text: inner, bold: false, italic: false, code: false, strike: true });
        pos = end + 2;
        continue;
      }
      buf += '~~';
      pos += 2;
    } else if (text[pos] === '`') {
      flush();
      const end = text.indexOf('`', pos + 1);
      if (end !== -1) {
        const inner = text.slice(pos + 1, end);
        if (inner) spans.push({ text: inner, bold: false, italic: false, code: true, strike: false });
        pos = end + 1;
        continue;
      }
      buf += '`';
      pos += 1;
    } else if (text[pos] === '*' && text[pos + 1] !== '*') {
      flush();
      const end = text.indexOf('*', pos + 1);
      if (end !== -1 && text[end + 1] !== '*') {
        const inner = text.slice(pos + 1, end);
        if (inner) spans.push({ text: inner, bold: false, italic: true, code: false, strike: false });
        pos = end + 1;
        continue;
      }
      buf += '*';
      pos += 1;
    } else {
      buf += text[pos];
      pos += 1;
    }
  }
  flush();
  return spans;
}

function parseMarkdownLines(text) {
  if (!text) return [];
  const rawLines = text.split('\n');
  const result = [];
  for (const line of rawLines) {
    const trimmed = line.trimStart();
    if (!trimmed) continue;

    let type = 'paragraph';
    let checked = false;
    let prefix = '';
    let content = trimmed;

    const checkboxMatch = trimmed.match(/^-\s*\[(\s|x|X)\]\s+(.+)/);
    if (checkboxMatch) {
      type = 'checkbox';
      checked = checkboxMatch[1].toLowerCase() === 'x';
      prefix = `- [${checkboxMatch[1]}] `;
      content = checkboxMatch[2];
    } else {
      const numberedMatch = trimmed.match(/^(\d+\.\s+)(.+)/);
      if (numberedMatch) {
        type = 'numbered';
        prefix = numberedMatch[1];
        content = numberedMatch[2];
      } else {
        const bulletMatch = trimmed.match(/^(-\s+)(.+)/);
        if (bulletMatch) {
          type = 'bullet';
          prefix = '- ';
          content = bulletMatch[2];
        } else {
          const starBulletMatch = trimmed.match(/^(\*\s+)(.+)/);
          if (starBulletMatch) {
            type = 'bullet';
            prefix = '* ';
            content = starBulletMatch[2];
          }
        }
      }
    }

    const spans = parseInlineSpans(content);
    if (spans.length > 0) {
      result.push({ type, checked, prefix, spans });
    }
  }
  return result;
}

function getSpanFont(span, baseFontSize, baseFontFamily) {
  const weight = span.bold ? 'bold ' : '';
  const style = span.italic ? 'italic ' : '';
  const family = span.code ? 'Consolas, "Cascadia Code", "Fira Code", monospace' : baseFontFamily;
  return `${style}${weight}${baseFontSize}px ${family}`;
}

function getSpanWidth(ctx, span, baseFontSize, baseFontFamily) {
  ctx.save();
  ctx.font = getSpanFont(span, baseFontSize, baseFontFamily);
  const w = ctx.measureText(span.text).width;
  ctx.restore();
  return w;
}

function drawSpan(ctx, span, x, y, fillStyle, baseFontFamily, baseFontSize) {
  ctx.save();
  ctx.font = getSpanFont(span, baseFontSize, baseFontFamily);
  ctx.fillStyle = fillStyle;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(span.text, x, y);
  if (span.strike) {
    const w = ctx.measureText(span.text).width;
    const strikeY = y + baseFontSize * 0.45;
    ctx.beginPath();
    ctx.moveTo(x, strikeY);
    ctx.lineTo(x + w, strikeY);
    ctx.strokeStyle = fillStyle;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function buildDisplayLines(ctx, spans, maxWidth, baseFontSize, baseFontFamily) {
  const words = [];
  for (const span of spans) {
    const parts = span.text.split(/\s+/);
    for (const part of parts) {
      if (part.length === 0) continue;
      words.push({ text: part, bold: span.bold, italic: span.italic, code: span.code, strike: span.strike });
    }
  }

  if (words.length === 0) return [[]];

  const lines = [];
  let currentLine = [];
  let currentWidth = 0;
  const spaceWidth = getSpanWidth(ctx, { text: ' ', bold: false, italic: false, code: false, strike: false }, baseFontSize, baseFontFamily);

  for (const word of words) {
    const w = getSpanWidth(ctx, word, baseFontSize, baseFontFamily);
    const needSpace = currentLine.length > 0;
    if (needSpace && currentWidth + spaceWidth + w > maxWidth) {
      lines.push(currentLine);
      currentLine = [word];
      currentWidth = w;
    } else {
      currentWidth += (needSpace ? spaceWidth : 0) + w;
      currentLine.push(word);
    }
  }
  if (currentLine.length > 0) lines.push(currentLine);
  return lines;
}

export function renderMarkdownBody(ctx, text, x, y, maxWidth, maxHeight, baseFontFamily, baseFontSize, color, lineHeight) {
  if (!text || maxWidth <= 0 || maxHeight <= 0) return;

  const ml = parseMarkdownLines(text);
  if (ml.length === 0) return;

  let currentY = y;
  const prefixPad = 4;

  for (let li = 0; li < ml.length; li++) {
    const line = ml[li];
    if (currentY + lineHeight > y + maxHeight) return;

    let prefixW = 0;
    if (line.type === 'checkbox') {
      const ps = { text: line.checked ? '[x]' : '[ ]', bold: false, italic: false, code: false, strike: false };
      drawSpan(ctx, ps, x, currentY, color, baseFontFamily, baseFontSize);
      prefixW = getSpanWidth(ctx, ps, baseFontSize, baseFontFamily) + prefixPad;
    } else if (line.type === 'bullet') {
      const ps = { text: '\u2022', bold: true, italic: false, code: false, strike: false };
      drawSpan(ctx, ps, x, currentY, color, baseFontFamily, baseFontSize);
      prefixW = getSpanWidth(ctx, ps, baseFontSize, baseFontFamily) + prefixPad;
    } else if (line.type === 'numbered') {
      const ps = { text: line.prefix, bold: false, italic: false, code: false, strike: false };
      drawSpan(ctx, ps, x, currentY, color, baseFontFamily, baseFontSize);
      prefixW = getSpanWidth(ctx, ps, baseFontSize, baseFontFamily) + prefixPad;
    }

    const contentMaxW = maxWidth - prefixW;
    if (contentMaxW <= 0) break;

    const displayLines = buildDisplayLines(ctx, line.spans, contentMaxW, baseFontSize, baseFontFamily);

    for (let dl = 0; dl < displayLines.length; dl++) {
      if (currentY + lineHeight > y + maxHeight) return;

      let cx = x + prefixW;
      const words = displayLines[dl];
      for (let wi = 0; wi < words.length; wi++) {
        drawSpan(ctx, words[wi], cx, currentY, color, baseFontFamily, baseFontSize);
        cx += getSpanWidth(ctx, words[wi], baseFontSize, baseFontFamily);
        if (wi < words.length - 1) {
          cx += getSpanWidth(ctx, { text: ' ', bold: false, italic: false, code: false, strike: false }, baseFontSize, baseFontFamily);
        }
      }
      currentY += lineHeight;
    }
  }
}

export function renderMarkdownTitle(ctx, text, cx, y, maxWidth, baseFontFamily, baseFontSize, color) {
  if (!text || maxWidth <= 0) return;

  const spans = parseInlineSpans(text);
  if (spans.length === 0) return;

  for (const s of spans) s.bold = true;

  let totalWidth = 0;
  for (const span of spans) {
    totalWidth += getSpanWidth(ctx, span, baseFontSize, baseFontFamily);
  }

  if (totalWidth > maxWidth) {
    const ellipsis = { text: '\u2026', bold: true, italic: false, code: false, strike: false };
    const ellipsisW = getSpanWidth(ctx, ellipsis, baseFontSize, baseFontFamily);
    const targetW = maxWidth - ellipsisW;
    const truncated = [];
    let running = 0;

    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      let t = span.text;
      let w = getSpanWidth(ctx, { text: t, bold: span.bold, italic: span.italic, code: span.code, strike: span.strike }, baseFontSize, baseFontFamily);

      if (running + w <= targetW) {
        truncated.push(span);
        running += w;
      } else {
        while (t.length > 0) {
          t = t.slice(0, -1);
          w = getSpanWidth(ctx, { text: t, bold: span.bold, italic: span.italic, code: span.code, strike: span.strike }, baseFontSize, baseFontFamily);
          if (running + w <= targetW) {
            if (t.length > 0) truncated.push({ text: t, bold: span.bold, italic: span.italic, code: span.code, strike: span.strike });
            break;
          }
        }
        break;
      }
    }

    if (truncated.length === 0 && ellipsisW <= maxWidth) {
      truncated.push(ellipsis);
    } else if (truncated.length > 0) {
      truncated.push(ellipsis);
    }

    let trTotal = 0;
    for (const s of truncated) trTotal += getSpanWidth(ctx, s, baseFontSize, baseFontFamily);

    let curX = cx - trTotal / 2;
    for (const s of truncated) {
      drawSpan(ctx, s, curX, y, color, baseFontFamily, baseFontSize);
      curX += getSpanWidth(ctx, s, baseFontSize, baseFontFamily);
    }
    return;
  }

  let curX = cx - totalWidth / 2;
  for (const s of spans) {
    drawSpan(ctx, s, curX, y, color, baseFontFamily, baseFontSize);
    curX += getSpanWidth(ctx, s, baseFontSize, baseFontFamily);
  }
}
