export const NAMED_COLORS = {
  red: '#e57373',
  orange: '#ffb74d',
  yellow: '#ffd54f',
  green: '#81c784',
  teal: '#4db6ac',
  blue: '#64b5f6',
  purple: '#ba68c8',
  pink: '#f06292',
  grey: '#bdbdbd',
  gray: '#bdbdbd',
};

function getNamedColor(name) {
  return NAMED_COLORS[name.toLowerCase()] || null;
}

function addSpan(spans, inner, props) {
  const innerSpans = parseInlineSpans(inner);
  for (const s of innerSpans) {
    if (props.bold) s.bold = true;
    if (props.code) s.code = true;
    if (props.strike) s.strike = true;
    if (props.italic) s.italic = true;
    if (props.fc) s.fc = props.fc;
    spans.push(s);
  }
}

export function parseInlineSpans(text) {
  const spans = [];
  let pos = 0;
  let buf = '';

  function flush() {
    if (buf) { spans.push({ text: buf, bold: false, italic: false, code: false, strike: false }); buf = ''; }
  }

  while (pos < text.length) {
    if (text[pos] === '{') {
      const colonPos = text.indexOf(':', pos + 1);
      if (colonPos !== -1) {
        const colorName = text.slice(pos + 1, colonPos).toLowerCase();
        const color = getNamedColor(colorName);
        if (color) {
          const closeBrace = text.indexOf('}', colonPos + 1);
          if (closeBrace !== -1 && closeBrace > colonPos + 1) {
            flush();
            const inner = text.slice(colonPos + 1, closeBrace);
            addSpan(spans, inner, { fc: color });
            pos = closeBrace + 1;
            continue;
          }
        }
      }
      buf += text[pos];
      pos += 1;
    } else if (text.slice(pos, pos + 2) === '**') {
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
        if (inner) spans.push({ text: inner, bold: true, italic: false, code: false, strike: false });
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

export function parseMarkdownLines(text) {
  if (!text) return [];
  const rawLines = text.split('\n');
  const result = [];
  for (const line of rawLines) {
    const trimmed = line.trimStart();
    if (!trimmed) {
      result.push({ type: 'blank' });
      continue;
    }

    if (/^_{3}\s*$/.test(trimmed)) {
      result.push({ type: 'hr' });
      continue;
    }

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
      const boxSize = baseFontSize * 0.85;
      const boxY = currentY + (lh - boxSize) / 2;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, boxY, boxSize, boxSize);
      if (line.checked) {
        ctx.fillStyle = '#4caf50';
        ctx.font = (boxSize * 0.8) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✓', x + boxSize / 2, boxY + boxSize / 2 + 1);
      }
      ctx.restore();
      prefixW = boxSize + prefixPad;
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
      const qtContentMaxW = maxWidth - (barW + barPad);
      const qtLines = buildDisplayLines(ctx, line.spans, qtContentMaxW, fontSize, baseFontFamily);
      const qtH = qtLines.length * lh;
      const bgPad = 4;
      ctx.save();
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = color;
      ctx.fillRect(x, currentY - bgPad, maxWidth, qtH + bgPad * 2);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = color;
      ctx.fillRect(x, currentY, barW, qtH);
      ctx.restore();
      prefixW = barW + barPad;
    }

    if (line.type === 'blank') {
      if (currentY + lh > y + maxHeight) return;
      currentY += lh;
      continue;
    }

    if (line.type === 'hr') {
      if (currentY + lh > y + maxHeight) return;
      const hrY = currentY + lh / 2;
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, hrY);
      ctx.lineTo(x + maxWidth, hrY);
      ctx.stroke();
      ctx.restore();
      currentY += lh;
      continue;
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
    if (line.type === 'blank') {
      html += '<div class="md-block md-blank"><br></div>';
      continue;
    }
    if (line.type === 'hr') {
      html += '<div class="md-block md-hr"><hr></div>';
      continue;
    }
    let inner = '';
    for (const span of line.spans) {
      let t = escHtml(span.text);
      if (span.code) t = '<code>' + t + '</code>';
      if (span.strike) t = '<del>' + t + '</del>';
      if (span.bold) t = '<strong>' + t + '</strong>';
      if (span.italic) t = '<em>' + t + '</em>';
      if (span.fc) t = '<span style="color:' + span.fc + '">' + t + '</span>';
      inner += t;
    }
    switch (line.type) {
      case 'h1': html += '<div class="md-block md-h1"><strong>' + inner + '</strong></div>'; break;
      case 'h2': html += '<div class="md-block md-h2"><strong>' + inner + '</strong></div>'; break;
      case 'h3': html += '<div class="md-block md-h3"><strong>' + inner + '</strong></div>'; break;
      case 'blockquote': html += '<div class="md-block md-blockquote">' + inner + '</div>'; break;
      case 'bullet': html += '<div class="md-block md-bullet"><span class="md-marker" contenteditable="false">\u2022</span> ' + inner + '</div>'; break;
      case 'numbered': html += '<div class="md-block md-numbered"><span class="md-marker" contenteditable="false">' + escHtml(line.prefix.trimEnd()) + '</span> ' + inner + '</div>'; break;
      case 'checkbox': html += '<div class="md-block md-checkbox"><span class="md-marker" contenteditable="false">' + (line.checked ? '[x]' : '[ ]') + '</span> ' + inner + '</div>'; break;
      default: html += '<div class="md-block md-paragraph">' + (inner || '<br>') + '</div>'; break;
    }
  }
  return html;
}

function extractInlineMd(node) {
  let out = '';
  for (const ch of node.childNodes) {
    if (ch.nodeType === Node.TEXT_NODE) {
      out += ch.textContent;
    } else if (ch.nodeType === Node.ELEMENT_NODE) {
      if (ch.getAttribute('contenteditable') === 'false') continue;
      const tag = ch.tagName.toLowerCase();
      const inner = extractInlineMd(ch);
      if (tag === 'strong' || tag === 'b') out += '*' + inner + '*';
      else if (tag === 'em' || tag === 'i') out += '_' + inner + '_';
      else if (tag === 'code') out += '`' + inner + '`';
      else if (tag === 'del' || tag === 's' || tag === 'strike') out += '~~' + inner + '~~';
      else if (tag === 'br') out += '\n';
      else if (tag === 'span') {
        const color = ch.style && ch.style.color;
        if (color) {
          const entry = Object.entries(NAMED_COLORS).find(([, v]) => v === color);
          if (entry) out += '{' + entry[0] + ':' + inner + '}';
          else out += inner;
        } else {
          out += inner;
        }
      }
      else out += inner;
    }
  }
  return out;
}

export function htmlToMarkdown(root) {
  const lines = [];
  for (const el of root.children) {
    const cls = el.classList;
    let prefix = '';

    if (cls.contains('md-h1')) prefix = '# ';
    else if (cls.contains('md-h2')) prefix = '## ';
    else if (cls.contains('md-h3')) prefix = '### ';
    else if (cls.contains('md-blockquote')) prefix = '> ';
    else if (cls.contains('md-bullet')) prefix = '- ';
    else if (cls.contains('md-numbered')) {
      const m = el.querySelector('.md-marker');
      prefix = (m ? m.textContent.trim() : '1.') + ' ';
    }
    else if (cls.contains('md-checkbox')) {
      const m = el.querySelector('.md-marker');
      const checked = m && /x/i.test(m.textContent);
      prefix = '- [' + (checked ? 'x' : ' ') + '] ';
    }
    else if (cls.contains('md-hr')) {
      lines.push('___');
      continue;
    }

    const text = extractInlineMd(el).replace(/\n$/, '');
    if (text || prefix) {
      lines.push(prefix + text);
    } else {
      lines.push('');
    }
  }
  return lines.join('\n');
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
