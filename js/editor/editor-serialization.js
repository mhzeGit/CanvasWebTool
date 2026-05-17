import { NAMED_COLORS, normalizeColor, parseMarkdownLines } from '../markdown.js';

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

const MARK_TYPE_MAP = {
  bold: 'bold', italic: 'italic', underline: 'underline',
  strike: 'strike', code: 'code',
};

function blockTypeToNodeType(bt) {
  const map = {
    p: 'paragraph', h1: 'heading', h2: 'heading', h3: 'heading',
    bul: 'bulletList', num: 'orderedList', chk: null, qt: 'blockquote', hr: 'horizontalRule',
  };
  return map[bt] || 'paragraph';
}

function nodeTypeToBlockType(type, attrs) {
  if (type === 'paragraph') return 'p';
  if (type === 'heading') {
    if (attrs && attrs.level === 1) return 'h1';
    if (attrs && attrs.level === 2) return 'h2';
    return 'h3';
  }
  if (type === 'blockquote') return 'qt';
  if (type === 'horizontalRule') return 'hr';
  if (type === 'bulletList') return 'bul';
  if (type === 'orderedList') return 'num';
  return 'p';
}

function spanToMark(span) {
  const result = { type: 'text', text: span.t || '' };
  const marks = [];
  if (span.b) marks.push({ type: 'bold' });
  if (span.i) marks.push({ type: 'italic' });
  if (span.u) marks.push({ type: 'underline' });
  if (span.s) marks.push({ type: 'strike' });
  if (span.cd) marks.push({ type: 'code' });
  if (span.lk) marks.push({ type: 'link', attrs: { href: span.lk, target: '_blank', rel: 'noopener noreferrer' } });
  if (span.fc) {
    marks.push({
      type: 'textStyle',
      attrs: { color: span.fc },
    });
  }
  if (span.fs && typeof span.fs === 'number') {
    marks.push({
      type: 'textStyle',
      attrs: { fontSize: span.fs + 'px' },
    });
  }
  if (marks.length > 0) result.marks = marks;
  return result;
}

function markToSpanProps(mark) {
  const props = {};
  if (mark.type === 'bold') props.b = true;
  if (mark.type === 'italic') props.i = true;
  if (mark.type === 'underline') props.u = true;
  if (mark.type === 'strike') props.s = true;
  if (mark.type === 'code') props.cd = true;
  if (mark.type === 'link') {
    props.lk = (mark.attrs && mark.attrs.href) || '';
  }
  if (mark.type === 'textStyle') {
    if (mark.attrs && mark.attrs.color) props.fc = mark.attrs.color;
    if (mark.attrs && mark.attrs.fontSize) {
      const n = parseFloat(mark.attrs.fontSize);
      if (!isNaN(n)) props.fs = n;
    }
  }
  return props;
}

function mergeSpanProps(existing, incoming) {
  if (incoming.b) existing.b = true;
  if (incoming.i) existing.i = true;
  if (incoming.u) existing.u = true;
  if (incoming.s) existing.s = true;
  if (incoming.cd) existing.cd = true;
  if (incoming.lk !== undefined) existing.lk = incoming.lk;
  if (incoming.fc !== undefined) existing.fc = incoming.fc;
  if (incoming.fs !== undefined) existing.fs = incoming.fs;
}

function extractSpansFromNode(node, parentBlockType, parentAttrs) {
  const spans = [];

  function walk(n, inheritedMarks) {
    if (n.type === 'text') {
      const s = { t: n.text || '' };
      for (const mark of (n.marks || [])) {
        mergeSpanProps(s, markToSpanProps(mark));
      }
      for (const mark of inheritedMarks) {
        mergeSpanProps(s, markToSpanProps(mark));
      }
      spans.push(s);
      return;
    }

    if (n.type === 'hardBreak') {
      spans.push({ t: '\n' });
      return;
    }

    const newMarks = [...inheritedMarks, ...(n.marks || [])];

    if (n.content) {
      for (const child of n.content) {
        walk(child, newMarks);
      }
    }
  }

  for (const child of (node.content || [])) {
    walk(child, []);
  }

  if (spans.length === 0) spans.push({ t: '' });
  return spans;
}

export function tiptapToBlocks(content) {
  if (!content || !content.content) return [{ t: 'p', s: [{ t: '' }] }];

  const blocks = [];

  for (const node of content.content) {
    if (node.type === 'paragraph') {
      blocks.push({
        t: 'p',
        s: extractSpansFromNode(node),
        ...(node.attrs && node.attrs.textAlign ? { al: node.attrs.textAlign === 'center' ? 'c' : node.attrs.textAlign === 'right' ? 'r' : 'l' } : {}),
      });
    } else if (node.type === 'heading') {
      const level = (node.attrs && node.attrs.level) || 1;
      blocks.push({
        t: 'h' + level,
        s: extractSpansFromNode(node),
        ...(node.attrs && node.attrs.textAlign ? { al: node.attrs.textAlign === 'center' ? 'c' : node.attrs.textAlign === 'right' ? 'r' : 'l' } : {}),
      });
    } else if (node.type === 'blockquote') {
      blocks.push({
        t: 'qt',
        s: extractSpansFromNode(node),
      });
    } else if (node.type === 'horizontalRule') {
      blocks.push({ t: 'hr' });
    } else if (node.type === 'bulletList') {
      for (const li of (node.content || [])) {
        if (li.type === 'listItem') {
          blocks.push({
            t: 'bul',
            s: extractSpansFromNode(li),
          });
        }
      }
    } else if (node.type === 'orderedList') {
      let n = (node.attrs && node.attrs.start) || 1;
      for (const li of (node.content || [])) {
        if (li.type === 'listItem') {
          blocks.push({
            t: 'num',
            n: n,
            s: extractSpansFromNode(li),
          });
          n++;
        }
      }
    }
  }

  if (blocks.length === 0) blocks.push({ t: 'p', s: [{ t: '' }] });
  return blocks;
}

export function blocksToTiptap(blocks) {
  if (!blocks || !blocks.length) return { ...EMPTY_DOC };

  const content = [];

  let i = 0;
  while (i < blocks.length) {
    const bl = blocks[i];

    if (bl.t === 'hr') {
      content.push({ type: 'horizontalRule' });
      i++;
      continue;
    }

    if (bl.t === 'bul') {
      const items = [];
      while (i < blocks.length && blocks[i].t === 'bul') {
        const listItem = {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: (blocks[i].s || []).map(spanToMark),
          }],
        };
        items.push(listItem);
        i++;
      }
      content.push({ type: 'bulletList', content: items });
      continue;
    }

    if (bl.t === 'num') {
      const items = [];
      const start = bl.n || 1;
      while (i < blocks.length && blocks[i].t === 'num') {
        const listItem = {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: (blocks[i].s || []).map(spanToMark),
          }],
        };
        items.push(listItem);
        i++;
      }
      content.push({ type: 'orderedList', attrs: { start }, content: items });
      continue;
    }

    if (bl.t === 'h1' || bl.t === 'h2' || bl.t === 'h3') {
      const level = parseInt(bl.t.charAt(1), 10);
      content.push({
        type: 'heading',
        attrs: { level },
        content: (bl.s || []).map(spanToMark),
      });
      i++;
      continue;
    }

    if (bl.t === 'qt') {
      content.push({
        type: 'blockquote',
        content: [{
          type: 'paragraph',
          content: (bl.s || []).map(spanToMark),
        }],
      });
      i++;
      continue;
    }

    const paraContent = (bl.s || []).map(spanToMark);
    if (paraContent.length === 0) {
      paraContent.push({ type: 'text', text: '' });
    }
    const attrs = {};
    if (bl.al && bl.al !== 'l') {
      attrs.textAlign = bl.al === 'c' ? 'center' : 'right';
    }
    content.push({
      type: 'paragraph',
      ...(Object.keys(attrs).length ? { attrs } : {}),
      content: paraContent,
    });
    i++;
  }

  if (content.length === 0) {
    content.push({ type: 'paragraph' });
  }

  return { type: 'doc', content };
}

export function markdownToTiptap(text) {
  if (!text) return { ...EMPTY_DOC };
  const lines = parseMarkdownLines(text);
  if (!lines.length) return { ...EMPTY_DOC };

  const content = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.type === 'blank') { i++; continue; }

    if (line.type === 'hr') {
      content.push({ type: 'horizontalRule' });
      i++;
      continue;
    }

    if (line.type === 'bullet') {
      const items = [];
      while (i < lines.length && lines[i].type === 'bullet') {
        items.push({
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: spansToTiptapContent(lines[i].spans || []),
          }],
        });
        i++;
      }
      content.push({ type: 'bulletList', content: items });
      continue;
    }

    if (line.type === 'numbered') {
      const items = [];
      while (i < lines.length && lines[i].type === 'numbered') {
        items.push({
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: spansToTiptapContent(lines[i].spans || []),
          }],
        });
        i++;
      }
      content.push({ type: 'orderedList', content: items });
      continue;
    }

    if (line.type === 'h1' || line.type === 'h2' || line.type === 'h3') {
      const level = line.type === 'h1' ? 1 : line.type === 'h2' ? 2 : 3;
      content.push({
        type: 'heading',
        attrs: { level },
        content: spansToTiptapContent(line.spans || []),
      });
      i++;
      continue;
    }

    if (line.type === 'blockquote') {
      content.push({
        type: 'blockquote',
        content: [{
          type: 'paragraph',
          content: spansToTiptapContent(line.spans || []),
        }],
      });
      i++;
      continue;
    }

    const paraContent = spansToTiptapContent(line.spans || []);
    if (paraContent.length === 0) paraContent.push({ type: 'text', text: '' });
    content.push({ type: 'paragraph', content: paraContent });
    i++;
  }

  if (content.length === 0) content.push({ type: 'paragraph' });
  return { type: 'doc', content };
}

function spansToTiptapContent(spans) {
  return spans.map(sp => {
    const result = { type: 'text', text: sp.text || '' };
    const marks = [];
    if (sp.bold) marks.push({ type: 'bold' });
    if (sp.italic) marks.push({ type: 'italic' });
    if (sp.code) marks.push({ type: 'code' });
    if (sp.strike) marks.push({ type: 'strike' });
    if (sp.fc) {
      marks.push({ type: 'textStyle', attrs: { color: sp.fc } });
    }
    if (marks.length > 0) result.marks = marks;
    return result;
  });
}

export function tiptapToMarkdown(content) {
  if (!content || !content.content) return '';
  const lines = [];
  for (const node of content.content) {
    const line = tiptapNodeToMarkdown(node);
    if (line !== null) lines.push(line);
  }
  return lines.join('\n');
}

function tiptapNodeToMarkdown(node) {
  if (!node) return null;

  if (node.type === 'paragraph') {
    return tiptapContentToMarkdownInline(node.content);
  }

  if (node.type === 'heading') {
    const level = (node.attrs && node.attrs.level) || 1;
    return '#'.repeat(level) + ' ' + tiptapContentToMarkdownInline(node.content);
  }

  if (node.type === 'blockquote') {
    const inner = node.content
      ? node.content.map(c => tiptapNodeToMarkdown(c)).filter(Boolean).join('\n')
      : '';
    const parts = inner.split('\n');
    return parts.map(p => '> ' + p).join('\n');
  }

  if (node.type === 'horizontalRule') {
    return '___';
  }

  if (node.type === 'bulletList') {
    return (node.content || [])
      .map(li => '- ' + tiptapContentToMarkdownInline(li.content?.[0]?.content || []))
      .join('\n');
  }

  if (node.type === 'orderedList') {
    let n = (node.attrs && node.attrs.start) || 1;
    return (node.content || [])
      .map(li => (n++) + '. ' + tiptapContentToMarkdownInline(li.content?.[0]?.content || []))
      .join('\n');
  }

  return null;
}

function tiptapContentToMarkdownInline(content) {
  if (!content || !content.length) return '';
  let result = '';
  for (const node of content) {
    if (node.type === 'text') {
      let text = node.text || '';
      const marks = node.marks || [];
      for (const mark of marks) {
        if (mark.type === 'bold') text = '*' + text + '*';
        else if (mark.type === 'italic') text = '_' + text + '_';
        else if (mark.type === 'code') text = '`' + text + '`';
        else if (mark.type === 'strike') text = '~~' + text + '~~';
        else if (mark.type === 'textStyle' && mark.attrs && mark.attrs.color) {
          const entry = Object.entries(NAMED_COLORS).find(([, v]) => v === mark.attrs.color);
          if (entry) text = '{' + entry[0] + ':' + text + '}';
        }
      }
      result += text;
    } else if (node.type === 'hardBreak') {
      result += '\n';
    } else if (node.content) {
      result += tiptapContentToMarkdownInline(node.content);
    }
  }
  return result;
}

export { EMPTY_DOC };
