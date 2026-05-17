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

export function normalizeColor(val) {
  if (!val) return val;
  const s = val.trim().toLowerCase();
  const rgb = s.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgb) {
    return '#' + [rgb[1], rgb[2], rgb[3]].map(n => parseInt(n, 10).toString(16).padStart(2, '0')).join('');
  }
  if (/^#[0-9a-f]{6}$/.test(s) || /^#[0-9a-f]{3}$/.test(s)) return s;
  return val;
}

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

function getIndentLevel(line) {
  let spaces = 0;
  for (const ch of line) {
    if (ch === ' ') spaces++;
    else if (ch === '\t') spaces += 4;
    else break;
  }
  return Math.floor(spaces / 4);
}

export function parseMarkdownLines(text) {
  if (!text) return [];
  const rawLines = text.split('\n');
  const result = [];
  for (const line of rawLines) {
    const trimmed = line.trimStart();
    const level = getIndentLevel(line);
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
      result.push({ type, checked, prefix, spans, level });
    }
  }
  return result;
}
