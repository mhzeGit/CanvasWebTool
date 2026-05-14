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
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      type = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
      content = headingMatch[2];
    } else {
      const blockquoteMatch = trimmed.match(/^>\s?(.+)/);
      if (blockquoteMatch) {
        type = 'blockquote';
        content = blockquoteMatch[1];
      } else {
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

    let fontSize = baseFontSize;
    let lh = lineHeight;
    const isBold = line.type === 'h1' || line.type === 'h2' || line.type === 'h3';

    if (line.type === 'h1') {
      fontSize = Math.round(baseFontSize * 1.5);
      lh = Math.round(lineHeight * 1.5);
    } else if (line.type === 'h2') {
      fontSize = Math.round(baseFontSize * 1.3);
      lh = Math.round(lineHeight * 1.3);
    } else if (line.type === 'h3') {
      fontSize = Math.round(baseFontSize * 1.15);
      lh = Math.round(lineHeight * 1.15);
    }

    if (currentY + lh > y + maxHeight) return;

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
    } else if (line.type === 'blockquote') {
      const barW = 3;
      const barPad = 5;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = color;
      ctx.fillRect(x, currentY, barW, lh);
      ctx.restore();
      prefixW = barW + barPad;
    }

    const contentMaxW = maxWidth - prefixW;
    if (contentMaxW <= 0) break;

    const spansForDisplay = isBold
      ? line.spans.map(s => ({ ...s, bold: true }))
      : line.spans;

    const displayLines = buildDisplayLines(ctx, spansForDisplay, contentMaxW, fontSize, baseFontFamily);

    for (let dl = 0; dl < displayLines.length; dl++) {
      if (currentY + lh > y + maxHeight) return;

      let cx = x + prefixW;
      const words = displayLines[dl];
      for (let wi = 0; wi < words.length; wi++) {
        const w = words[wi];
        const wordFontSize = line.type === 'blockquote' ? baseFontSize : fontSize;
        drawSpan(ctx, w, cx, currentY, color, baseFontFamily, wordFontSize);
        cx += getSpanWidth(ctx, w, wordFontSize, baseFontFamily);
        if (wi < words.length - 1) {
          cx += getSpanWidth(ctx, { text: ' ', bold: false, italic: false, code: false, strike: false }, wordFontSize, baseFontFamily);
        }
      }
      currentY += lh;
    }
  }
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderMarkdownToHtml(text) {
  if (!text) return '';
  const lines = parseMarkdownLines(text);
  if (lines.length === 0) return '';

  let html = '';
  for (const line of lines) {
    let inner = '';
    for (const span of line.spans) {
      let t = escHtml(span.text);
      if (span.code) t = '<code>' + t + '</code>';
      if (span.strike) t = '<del>' + t + '</del>';
      if (span.bold) t = '<strong>' + t + '</strong>';
      if (span.italic) t = '<em>' + t + '</em>';
      inner += t;
    }
    switch (line.type) {
      case 'h1': html += '<h3 class="md-h1">' + inner + '</h3>'; break;
      case 'h2': html += '<h4 class="md-h2">' + inner + '</h4>'; break;
      case 'h3': html += '<h5 class="md-h3">' + inner + '</h5>'; break;
      case 'blockquote': html += '<blockquote class="md-blockquote">' + inner + '</blockquote>'; break;
      case 'bullet': html += '<div class="md-bullet"><span class="md-bullet-marker">\u2022</span> ' + inner + '</div>'; break;
      case 'numbered': html += '<div class="md-numbered"><span class="md-numbered-marker">' + escHtml(line.prefix.trimEnd()) + '</span> ' + inner + '</div>'; break;
      case 'checkbox': html += '<div class="md-checkbox"><span class="md-checkbox-box">' + (line.checked ? '[x]' : '[ ]') + '</span> ' + inner + '</div>'; break;
      default: html += '<div class="md-paragraph">' + inner + '</div>'; break;
    }
  }
  return html;
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
