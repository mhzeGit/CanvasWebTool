import { parseMarkdownLines } from './markdown.js';

const BLOCK_ID = 0;
function nextBlockId() { return 'b' + (BLOCK_ID++); }

export function markdownToBlocks(text) {
  if (!text) return [{ t: 'p', s: [{ t: '' }] }];
  const ml = parseMarkdownLines(text);
  const blocks = [];
  for (const line of ml) {
    if (line.type === 'blank') continue;
    if (line.type === 'hr') { blocks.push({ t: 'hr' }); continue; }
    const typeMap = { h1: 'h1', h2: 'h2', h3: 'h3', blockquote: 'qt', bullet: 'bul', numbered: 'num', checkbox: 'chk', paragraph: 'p' };
    const bt = typeMap[line.type] || 'p';
    const block = { t: bt, s: [] };
    if (bt === 'chk') block.c = line.checked || false;
    if (line.spans) {
      for (const sp of line.spans) {
        const s = { t: sp.text };
        if (sp.bold) s.b = true;
        if (sp.italic) s.i = true;
        if (sp.code) s.cd = true;
        if (sp.strike) s.s = true;
        block.s.push(s);
      }
    }
    if (block.s.length === 0) block.s.push({ t: '' });
    blocks.push(block);
  }
  if (blocks.length === 0) blocks.push({ t: 'p', s: [{ t: '' }] });
  return blocks;
}

export function blocksToMarkdown(blocks) {
  const lines = [];
  for (const bl of blocks) {
    if (bl.t === 'hr') { lines.push('___'); continue; }
    let prefix = '';
    if (bl.t === 'h1') prefix = '# ';
    else if (bl.t === 'h2') prefix = '## ';
    else if (bl.t === 'h3') prefix = '### ';
    else if (bl.t === 'qt') prefix = '> ';
    else if (bl.t === 'bul') prefix = '- ';
    else if (bl.t === 'num') prefix = '1. ';
    else if (bl.t === 'chk') prefix = '- [' + (bl.c ? 'x' : ' ') + '] ';
    let line = prefix;
    for (const sp of (bl.s || [])) {
      let t = sp.t || '';
      if (sp.cd) t = '`' + t + '`';
      if (sp.s) t = '~~' + t + '~~';
      if (sp.b) t = '**' + t + '**';
      if (sp.i) t = '*' + t + '*';
      line += t;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

function getSpanFont(ctx, span, baseFontSize, baseFontFamily) {
  const weight = span.b ? 'bold ' : '';
  const style = span.i ? 'italic ' : '';
  const family = span.cd ? 'Consolas, "Cascadia Code", "Fira Code", monospace' : baseFontFamily;
  const fs = span.fs || baseFontSize;
  return `${style}${weight}${fs}px ${family}`;
}

function spanWidth(ctx, span, baseFontSize, baseFontFamily) {
  ctx.save();
  ctx.font = getSpanFont(ctx, span, baseFontSize, baseFontFamily);
  const w = ctx.measureText(span.t || ' ').width;
  ctx.restore();
  return w;
}

function drawOneSpan(ctx, span, x, y, fillStyle, baseFontFamily, baseFontSize) {
  ctx.save();
  const color = span.fc || fillStyle;
  ctx.font = getSpanFont(ctx, span, baseFontSize, baseFontFamily);
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(span.t || '', x, y);
  if (span.u) {
    const w = ctx.measureText(span.t || '').width;
    const uly = y + (span.fs || baseFontSize) * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, uly);
    ctx.lineTo(x + w, uly);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (span.s) {
    const w = ctx.measureText(span.t || '').width;
    const strikeY = y + (span.fs || baseFontSize) * 0.45;
    ctx.beginPath();
    ctx.moveTo(x, strikeY);
    ctx.lineTo(x + w, strikeY);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (span.lk) {
    const w = ctx.measureText(span.t || '').width;
    const uly = y + (span.fs || baseFontSize) * 1.15;
    ctx.beginPath();
    ctx.moveTo(x, uly);
    ctx.lineTo(x + w, uly);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function buildDisplayLines(ctx, spans, maxWidth, baseFontSize, baseFontFamily) {
  const words = [];
  for (const span of spans) {
    const parts = (span.t || '').split(/\s+/);
    for (const part of parts) {
      if (part.length === 0) continue;
      words.push({ t: part, b: span.b, i: span.i, u: span.u, s: span.s, cd: span.cd, fc: span.fc, fs: span.fs, lk: span.lk });
    }
  }
  if (words.length === 0) return [[]];
  const lines = [];
  let currentLine = [];
  let currentWidth = 0;
  const spaceW = spanWidth(ctx, { t: ' ', b: false, i: false }, baseFontSize, baseFontFamily);
  for (const word of words) {
    const w = spanWidth(ctx, word, baseFontSize, baseFontFamily);
    const needSpace = currentLine.length > 0;
    if (needSpace && currentWidth + spaceW + w > maxWidth) {
      lines.push(currentLine);
      currentLine = [word];
      currentWidth = w;
    } else {
      currentWidth += (needSpace ? spaceW : 0) + w;
      currentLine.push(word);
    }
  }
  if (currentLine.length > 0) lines.push(currentLine);
  return lines;
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

function darkenColor(hex, amount) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex(rgb.r * amount, rgb.g * amount, rgb.b * amount);
}

export function renderRichText(ctx, blocks, x, y, maxW, maxH, fontFamily, baseFontSize, textColor, lineHeight) {
  if (!blocks || !blocks.length || maxW <= 0 || maxH <= 0) return;
  let currentY = y;
  const prefixPad = 4;

  for (let bi = 0; bi < blocks.length; bi++) {
    const bl = blocks[bi];
    let fontSize = baseFontSize;
    let lh = lineHeight;
    const isBold = bl.t === 'h1' || bl.t === 'h2' || bl.t === 'h3';

    if (bl.t === 'h1') { fontSize = Math.round(baseFontSize * 1.5); lh = Math.round(lineHeight * 1.5); }
    else if (bl.t === 'h2') { fontSize = Math.round(baseFontSize * 1.3); lh = Math.round(lineHeight * 1.3); }
    else if (bl.t === 'h3') { fontSize = Math.round(baseFontSize * 1.15); lh = Math.round(lineHeight * 1.15); }

    if (currentY + lh > y + maxH) return;
    if (bl.t === 'hr') {
      const hrY = currentY + lh / 2;
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = textColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, hrY);
      ctx.lineTo(x + maxW, hrY);
      ctx.stroke();
      ctx.restore();
      currentY += lh;
      continue;
    }

    let prefixW = 0;
    if (bl.t === 'chk') {
      const ps = { t: bl.c ? '[x]' : '[ ]', b: false, i: false };
      drawOneSpan(ctx, ps, x, currentY, brightenColor(textColor, 0.4), fontFamily, baseFontSize);
      prefixW = spanWidth(ctx, ps, baseFontSize, fontFamily) + prefixPad;
    } else if (bl.t === 'bul') {
      const ps = { t: '\u2022', b: true, i: false };
      drawOneSpan(ctx, ps, x, currentY, brightenColor(textColor, 0.4), fontFamily, baseFontSize);
      prefixW = spanWidth(ctx, ps, baseFontSize, fontFamily) + prefixPad;
    } else if (bl.t === 'num') {
      const ps = { t: '1.', b: false, i: false };
      drawOneSpan(ctx, ps, x, currentY, brightenColor(textColor, 0.4), fontFamily, baseFontSize);
      prefixW = spanWidth(ctx, ps, baseFontSize, fontFamily) + prefixPad;
    } else if (bl.t === 'qt') {
      const barW = 3; const barPad = 5;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = textColor;
      ctx.fillRect(x, currentY, barW, lh);
      ctx.restore();
      prefixW = barW + barPad;
    }

    const contentMaxW = maxW - prefixW;
    if (contentMaxW <= 0) break;

    const spans = (bl.s || []).map(s => ({
      ...s,
      b: isBold ? true : (s.b || false),
      fs: s.fs || fontSize
    }));

    const displayLines = buildDisplayLines(ctx, spans, contentMaxW, fontSize, fontFamily);

    for (let dl = 0; dl < displayLines.length; dl++) {
      if (currentY + lh > y + maxH) return;
      const words = displayLines[dl];
      let totalLineW = 0;
      for (let wi = 0; wi < words.length; wi++) {
        totalLineW += spanWidth(ctx, words[wi], baseFontSize, fontFamily);
        if (wi < words.length - 1) {
          totalLineW += spanWidth(ctx, { t: ' ', b: false, i: false }, baseFontSize, fontFamily);
        }
      }

      let alignOffset = 0;
      if (bl.al === 'c' || bl.al === 'center') {
        alignOffset = (contentMaxW - totalLineW) / 2;
      } else if (bl.al === 'r' || bl.al === 'right') {
        alignOffset = contentMaxW - totalLineW;
      }

      let cx = x + prefixW + Math.max(0, alignOffset);
      for (let wi = 0; wi < words.length; wi++) {
        const w = words[wi];
        drawOneSpan(ctx, w, cx, currentY, textColor, fontFamily, baseFontSize);
        cx += spanWidth(ctx, w, baseFontSize, fontFamily);
        if (wi < words.length - 1) {
          cx += spanWidth(ctx, { t: ' ', b: false, i: false }, baseFontSize, fontFamily);
        }
      }
      currentY += lh;
    }
  }
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function blocksToHtml(blocks) {
  if (!blocks || !blocks.length) return '<div class="rt-block rt-paragraph"><br></div>';
  let html = '';
  const typeMap = { p: 'rt-paragraph', h1: 'rt-h1', h2: 'rt-h2', h3: 'rt-h3', bul: 'rt-bullet', num: 'rt-numbered', chk: 'rt-checkbox', qt: 'rt-quote', hr: 'rt-divider' };
  for (const bl of blocks) {
    if (bl.t === 'hr') { html += '<div class="rt-block rt-divider" contenteditable="false"><hr></div>'; continue; }
    const cls = 'rt-block ' + (typeMap[bl.t] || 'rt-paragraph');
    let inner = '';
    const spans = bl.s || [];
    if (spans.length === 0) spans.push({ t: '' });
    for (const sp of spans) {
      let t = escHtml(sp.t || '');
      if (sp.cd) t = '<code>' + t + '</code>';
      if (sp.s) t = '<s>' + t + '</s>';
      if (sp.u) t = '<u>' + t + '</u>';
      if (sp.b) t = '<strong>' + t + '</strong>';
      if (sp.i) t = '<em>' + t + '</em>';
      if (sp.lk) t = '<a href="' + escHtml(sp.lk) + '" target="_blank">' + t + '</a>';
      let style = '';
      if (sp.fc) style += 'color:' + sp.fc + ';';
      if (sp.fs) style += 'font-size:' + sp.fs + 'px;';
      if (style) t = '<span style="' + style + '">' + t + '</span>';
      inner += t;
    }
    let prefix = '';
    if (bl.t === 'chk') prefix = '<span class="rt-marker" contenteditable="false">' + (bl.c ? '[x]' : '[ ]') + '</span> ';
    else if (bl.t === 'bul') prefix = '<span class="rt-marker" contenteditable="false">\u2022</span> ';
    else if (bl.t === 'num') prefix = '<span class="rt-marker" contenteditable="false">1.</span> ';
    let extraStyle = '';
    if (bl.al && bl.al !== 'l' && bl.al !== 'left') extraStyle = 'text-align:' + (bl.al === 'c' || bl.al === 'center' ? 'center' : 'right') + ';';
    const styleAttr = extraStyle ? ' style="' + extraStyle + '"' : '';
    html += '<div class="' + cls + '"' + styleAttr + '>' + prefix + (inner || '<br>') + '</div>';
  }
  return html;
}

function htmlToBlocks(container) {
  const blocks = [];
  const typeMap = { 'rt-paragraph': 'p', 'rt-h1': 'h1', 'rt-h2': 'h2', 'rt-h3': 'h3', 'rt-bullet': 'bul', 'rt-numbered': 'num', 'rt-checkbox': 'chk', 'rt-quote': 'qt', 'rt-divider': 'hr' };
  for (const el of container.children) {
    if (!el.classList || !el.classList.contains('rt-block')) continue;
    const cls = Array.from(el.classList).find(c => typeMap[c]);
    if (!cls) continue;
    const bt = typeMap[cls];
    if (bt === 'hr') { blocks.push({ t: 'hr' }); continue; }
    const block = { t: bt, s: [] };
    const alignEl = el.style.textAlign;
    if (alignEl === 'center') block.al = 'c';
    else if (alignEl === 'right') block.al = 'r';
    if (bt === 'chk') {
      const marker = el.querySelector('.rt-marker');
      block.c = marker && /x/i.test(marker.textContent || '');
    }
    extractSpans(el, block.s);
    if (block.s.length === 0) block.s.push({ t: '' });
    blocks.push(block);
  }
  if (blocks.length === 0) blocks.push({ t: 'p', s: [{ t: '' }] });
  return blocks;
}

function extractSpans(el, spans) {
  for (const ch of el.childNodes) {
    if (ch.nodeType === Node.TEXT_NODE) {
      const text = ch.textContent || '';
      if (text) spans.push({ t: text });
    } else if (ch.nodeType === Node.ELEMENT_NODE) {
      if (ch.getAttribute('contenteditable') === 'false') continue;
      const tag = ch.tagName.toLowerCase();
      if (tag === 'br') {
        if (spans.length === 0) spans.push({ t: '' });
      } else if (tag === 'strong' || tag === 'b') {
        const sub = []; extractSpans(ch, sub);
        for (const s of sub) { s.b = true; spans.push(s); }
      } else if (tag === 'em' || tag === 'i') {
        const sub = []; extractSpans(ch, sub);
        for (const s of sub) { s.i = true; spans.push(s); }
      } else if (tag === 'u') {
        const sub = []; extractSpans(ch, sub);
        for (const s of sub) { s.u = true; spans.push(s); }
      } else if (tag === 's' || tag === 'del' || tag === 'strike') {
        const sub = []; extractSpans(ch, sub);
        for (const s of sub) { s.s = true; spans.push(s); }
      } else if (tag === 'code') {
        const sub = []; extractSpans(ch, sub);
        for (const s of sub) { s.cd = true; spans.push(s); }
      } else if (tag === 'a') {
        const sub = []; extractSpans(ch, sub);
        for (const s of sub) { s.lk = ch.getAttribute('href') || ''; spans.push(s); }
      } else if (tag === 'span') {
        const sub = []; extractSpans(ch, sub);
        const color = ch.style.color;
        const fontSize = ch.style.fontSize;
        for (const s of sub) {
          if (color && !s.fc) s.fc = color;
          if (fontSize) { const n = parseFloat(fontSize); if (!isNaN(n)) s.fs = n; }
          spans.push(s);
        }
      } else {
        extractSpans(ch, spans);
      }
    }
  }
}

function getBlockTypeClass(bt) {
  const m = { p: 'rt-paragraph', h1: 'rt-h1', h2: 'rt-h2', h3: 'rt-h3', bul: 'rt-bullet', num: 'rt-numbered', chk: 'rt-checkbox', qt: 'rt-quote', hr: 'rt-divider' };
  return m[bt] || 'rt-paragraph';
}

function getBlockTag(bt) {
  const m = { p: 'P', h1: 'H1', h2: 'H2', h3: 'H3', bul: 'Bullet', num: 'Numbered', chk: 'Checkbox', qt: 'Quote' };
  return m[bt] || 'Paragraph';
}

function ensureBlock(el) {
  while (el && el !== document.body) {
    if (el.classList && el.classList.contains('rt-block')) return el;
    el = el.parentNode;
  }
  return null;
}

function isListBlock(bt) {
  return bt === 'bul' || bt === 'num' || bt === 'chk';
}

function isSpecialBlock(bt) {
  return isListBlock(bt) || bt === 'qt' || bt === 'h1' || bt === 'h2' || bt === 'h3';
}

function createBlockHtml(bt, inner, align) {
  const cls = 'rt-block ' + getBlockTypeClass(bt);
  let prefix = '';
  if (bt === 'chk') prefix = '<span class="rt-marker" contenteditable="false">[ ]</span> ';
  else if (bt === 'bul') prefix = '<span class="rt-marker" contenteditable="false">\u2022</span> ';
  else if (bt === 'num') prefix = '<span class="rt-marker" contenteditable="false">1.</span> ';
  let style = '';
  if (align && align !== 'l' && align !== 'left') style = 'text-align:' + (align === 'c' || align === 'center' ? 'center' : 'right');
  return '<div class="' + cls + '"' + (style ? ' style="' + style + '"' : '') + '>' + prefix + (inner || '<br>') + '</div>';
}

function createToolbar() {
  const tb = document.createElement('div');
  tb.className = 'rt-toolbar';
  tb.innerHTML = [
    '<button class="rt-tb-btn" data-cmd="bold" title="Bold (Ctrl+B)"><strong>B</strong></button>',
    '<button class="rt-tb-btn" data-cmd="italic" title="Italic (Ctrl+I)"><em>I</em></button>',
    '<button class="rt-tb-btn" data-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button>',
    '<button class="rt-tb-btn" data-cmd="strike" title="Strikethrough"><s>S</s></button>',
    '<button class="rt-tb-btn" data-cmd="code" title="Inline Code">&lt;/&gt;</button>',
    '<span class="rt-tb-sep"></span>',
    '<button class="rt-tb-btn" data-cmd="link" title="Add Link">\u{1F517}</button>',
    '<span class="rt-tb-sep"></span>',
    '<button class="rt-tb-btn" data-cmd="alignLeft" title="Align Left">\u{2190}</button>',
    '<button class="rt-tb-btn" data-cmd="alignCenter" title="Align Center">\u{2194}</button>',
    '<button class="rt-tb-btn" data-cmd="alignRight" title="Align Right">\u{2192}</button>',
    '<span class="rt-tb-sep"></span>',
    '<button class="rt-tb-btn" data-cmd="h1" title="Heading 1">H1</button>',
    '<button class="rt-tb-btn" data-cmd="h2" title="Heading 2">H2</button>',
    '<button class="rt-tb-btn" data-cmd="h3" title="Heading 3">H3</button>',
    '<button class="rt-tb-btn" data-cmd="bullet" title="Bullet List">\u2022</button>',
    '<button class="rt-tb-btn" data-cmd="numbered" title="Numbered List">1.</button>',
    '<button class="rt-tb-btn" data-cmd="checkbox" title="Checkbox">\u2610</button>',
    '<button class="rt-tb-btn" data-cmd="quote" title="Blockquote">\u201C</button>',
    '<span class="rt-tb-sep"></span>',
    '<button class="rt-tb-btn" data-cmd="fontSizeSm" title="Smaller">A\u207B</button>',
    '<button class="rt-tb-btn" data-cmd="fontSizeLg" title="Larger">A\u207A</button>',
    '<input class="rt-tb-color" type="color" data-cmd="color" title="Text Color" value="#dddddd" />',
  ].join('');
  return tb;
}

function wrapInline(tag, editor) {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  try {
    document.execCommand(tag, false, null);
  } catch (e) { /* ignore */ }
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

function setAlignment(block, align) {
  block.style.textAlign = align;
  block.dispatchEvent(new Event('input', { bubbles: true }));
}

function changeBlockType(block, newType) {
  const oldCls = Array.from(block.classList).find(c => c.startsWith('rt-'));
  if (oldCls) block.classList.remove(oldCls);
  block.classList.add(getBlockTypeClass(newType));
  const existingMarker = block.querySelector('.rt-marker');
  if (existingMarker) existingMarker.remove();
  if (newType === 'chk') {
    block.insertAdjacentHTML('afterbegin', '<span class="rt-marker" contenteditable="false">[ ]</span> ');
  } else if (newType === 'bul') {
    block.insertAdjacentHTML('afterbegin', '<span class="rt-marker" contenteditable="false">\u2022</span> ');
  } else if (newType === 'num') {
    block.insertAdjacentHTML('afterbegin', '<span class="rt-marker" contenteditable="false">1.</span> ');
  }
  block.dispatchEvent(new Event('input', { bubbles: true }));
}

function getOrCreateEditorBlocks(editor) {
  let blocks = htmlToBlocks(editor);
  if (blocks.length === 0) blocks = [{ t: 'p', s: [{ t: '' }] }];
  return blocks;
}

function handleEditorKeydown(editor, ev, options) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;

  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    const block = ensureBlock(sel.anchorNode);
    if (!block || !block.classList.contains('rt-block')) return;
    const spans = getOrCreateEditorBlocks(editor).find((b, i) => {
      const els = editor.querySelectorAll('.rt-block');
      return els[i] === block;
    });
    let bt = 'p';
    if (spans) bt = spans.t || 'p';
    if (!isSpecialBlock(bt)) { bt = 'p'; }
    if (isListBlock(bt)) {
      const isEmpty = !block.textContent.replace(/[\u2022\[\]xX\d.]/g, '').trim();
      if (isEmpty) {
        block.className = 'rt-block rt-paragraph';
        const marker = block.querySelector('.rt-marker');
        if (marker) marker.remove();
        block.innerHTML = '<br>';
      } else {
        const newBlock = document.createElement('div');
        const nc = 'rt-block ' + getBlockTypeClass(bt);
        newBlock.className = nc;
        if (bt === 'chk') newBlock.innerHTML = '<span class="rt-marker" contenteditable="false">[ ]</span> <br>';
        else if (bt === 'bul') newBlock.innerHTML = '<span class="rt-marker" contenteditable="false">\u2022</span> <br>';
        else if (bt === 'num') newBlock.innerHTML = '<span class="rt-marker" contenteditable="false">1.</span> <br>';
        block.insertAdjacentElement('afterend', newBlock);
        newBlock.focus();
      }
    } else {
      const newBlock = document.createElement('div');
      newBlock.className = 'rt-block rt-paragraph';
      newBlock.innerHTML = '<br>';
      block.insertAdjacentElement('afterend', newBlock);
      newBlock.focus();
    }
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  if (ev.key === 'Backspace') {
    const block = ensureBlock(sel.anchorNode);
    if (!block || !block.classList.contains('rt-block')) return;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) return;
    const node = range.startContainer;
    const offset = range.startOffset;
    const textBefore = (node.nodeType === Node.TEXT_NODE && offset === 0) ||
      (node.nodeType === Node.ELEMENT_NODE && node.textContent.length === 0);
    const isAtStart = textBefore || (node === block && offset === 0);
    if (!isAtStart) return;

    const text = block.textContent || '';
    const trimmed = text.replace(/[\u2022\[\]xX\d.]/g, '').trim();
    const blocks = editor.querySelectorAll('.rt-block');
    if (blocks.length <= 1) return;

    let bt = 'p';
    for (const c of Array.from(block.classList)) {
      if (c === 'rt-h1') bt = 'h1';
      else if (c === 'rt-h2') bt = 'h2';
      else if (c === 'rt-h3') bt = 'h3';
      else if (c === 'rt-bullet') bt = 'bul';
      else if (c === 'rt-numbered') bt = 'num';
      else if (c === 'rt-checkbox') bt = 'chk';
      else if (c === 'rt-quote') bt = 'qt';
    }

    if (trimmed === '' && isSpecialBlock(bt)) {
      ev.preventDefault();
      block.className = 'rt-block rt-paragraph';
      const marker = block.querySelector('.rt-marker');
      if (marker) marker.remove();
      block.innerHTML = '<br>';
      block.focus();
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    if (trimmed === '') {
      ev.preventDefault();
      const prev = block.previousElementSibling;
      if (prev && prev.classList.contains('rt-block')) {
        block.remove();
        prev.focus();
        const r = document.createRange();
        r.selectNodeContents(prev);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }

    const prev = block.previousElementSibling;
    if (prev && prev.classList.contains('rt-block')) {
      ev.preventDefault();
      while (block.firstChild) {
        prev.appendChild(block.firstChild);
      }
      block.remove();
      prev.normalize();
      prev.focus();
      const r = document.createRange();
      r.selectNodeContents(prev);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return;
  }

  if (ev.ctrlKey || ev.metaKey) {
    if (ev.key.toLowerCase() === 'b') { ev.preventDefault(); document.execCommand('bold', false, null); editor.dispatchEvent(new Event('input', { bubbles: true })); }
    else if (ev.key.toLowerCase() === 'i') { ev.preventDefault(); document.execCommand('italic', false, null); editor.dispatchEvent(new Event('input', { bubbles: true })); }
    else if (ev.key.toLowerCase() === 'u') { ev.preventDefault(); document.execCommand('underline', false, null); editor.dispatchEvent(new Event('input', { bubbles: true })); }
  }
}

function handleToolbarClick(editor, ev, options) {
  const btn = ev.target.closest('.rt-tb-btn,.rt-tb-color');
  if (!btn) return;
  const cmd = btn.dataset.cmd;
  if (!cmd) return;

  const block = ensureBlock(window.getSelection().anchorNode) || editor.querySelector('.rt-block');

  switch (cmd) {
    case 'bold': document.execCommand('bold', false, null); break;
    case 'italic': document.execCommand('italic', false, null); break;
    case 'underline': document.execCommand('underline', false, null); break;
    case 'strike': document.execCommand('strikeThrough', false, null); break;
    case 'code': {
      const sel = window.getSelection();
      if (sel.rangeCount && !sel.isCollapsed) {
        const range = sel.getRangeAt(0);
        const wrapper = document.createElement('code');
        try { range.surroundContents(wrapper); } catch (e) { return; }
        sel.removeAllRanges();
        sel.addRange(document.createRange());
        sel.getRangeAt(0).selectNodeContents(wrapper);
      }
      break;
    }
    case 'link': {
      const sel = window.getSelection();
      if (sel.rangeCount && !sel.isCollapsed) {
        const url = prompt('Enter URL:', 'https://');
        if (url) {
          document.execCommand('createLink', false, url);
        }
      }
      break;
    }
    case 'alignLeft': if (block) setAlignment(block, 'left'); break;
    case 'alignCenter': if (block) setAlignment(block, 'center'); break;
    case 'alignRight': if (block) setAlignment(block, 'right'); break;
    case 'h1': if (block) changeBlockType(block, 'h1'); break;
    case 'h2': if (block) changeBlockType(block, 'h2'); break;
    case 'h3': if (block) changeBlockType(block, 'h3'); break;
    case 'bullet': if (block) changeBlockType(block, 'bul'); break;
    case 'numbered': if (block) changeBlockType(block, 'num'); break;
    case 'checkbox': if (block) changeBlockType(block, 'chk'); break;
    case 'quote': if (block) changeBlockType(block, 'qt'); break;
    case 'fontSizeSm': if (block) adjustFontSize(block, -2); break;
    case 'fontSizeLg': if (block) adjustFontSize(block, 2); break;
  }
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

function handleToolbarColorChange(ev, editor) {
  const input = ev.target;
  if (input.type !== 'color') return;
  const color = input.value;
  document.execCommand('foreColor', false, color);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

function adjustFontSize(block, delta) {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const span = document.createElement('span');
  const currentSize = parseFloat(getComputedStyle(block).fontSize) || 14;
  span.style.fontSize = Math.max(8, currentSize + delta) + 'px';
  try { range.surroundContents(span); } catch (e) {}
}

function updateToolbarState(toolbar, editor) {
  if (!toolbar) return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;

  const btnMap = { bold: false, italic: false, underline: false, strike: false };
  if (sel.rangeCount) {
    const parent = sel.anchorNode && sel.anchorNode.parentElement;
    if (parent) {
      btnMap.bold = document.queryCommandState('bold');
      btnMap.italic = document.queryCommandState('italic');
      btnMap.underline = document.queryCommandState('underline');
      btnMap.strike = document.queryCommandState('strikeThrough');
    }
  }

  const buttons = toolbar.querySelectorAll('.rt-tb-btn');
  buttons.forEach(b => {
    const cmd = b.dataset.cmd;
    if (cmd && btnMap[cmd] !== undefined) {
      b.classList.toggle('active', btnMap[cmd]);
    }
  });
}

export function getOrCreateBlocks(entity) {
  if (entity.blocks && Array.isArray(entity.blocks) && entity.blocks.length > 0) {
    return entity.blocks;
  }
  if (typeof entity.text === 'string' && entity.text.trim()) {
    entity.blocks = markdownToBlocks(entity.text);
    return entity.blocks;
  }
  entity.blocks = [{ t: 'p', s: [{ t: '' }] }];
  return entity.blocks;
}

export function createRichTextEditor(options = {}) {
  const container = document.createElement('div');
  container.className = 'rt-editor-container';

  const toolbar = createToolbar();
  const editorArea = document.createElement('div');
  editorArea.className = 'rt-editor-area';

  const initialBlocks = options.blocks || [{ t: 'p', s: [{ t: '' }] }];
  editorArea.innerHTML = blocksToHtml(initialBlocks);

  container.appendChild(toolbar);
  container.appendChild(editorArea);

  const makeEditable = () => {
    const blocks = editorArea.querySelectorAll('.rt-block');
    blocks.forEach(b => {
      if (!b.classList.contains('rt-divider')) {
        b.contentEditable = 'true';
      }
    });
  };
  makeEditable();

  editorArea.addEventListener('keydown', (ev) => handleEditorKeydown(editorArea, ev, options));
  toolbar.addEventListener('click', (ev) => handleToolbarClick(editorArea, ev, options));
  toolbar.addEventListener('input', (ev) => handleToolbarColorChange(ev, editorArea));

  editorArea.addEventListener('click', () => updateToolbarState(toolbar, editorArea));
  editorArea.addEventListener('keyup', () => updateToolbarState(toolbar, editorArea));

  options.onEditorReady && options.onEditorReady(container, editorArea);

  return {
    container,
    editorArea,
    toolbar,
    getBlocks() {
      return htmlToBlocks(editorArea);
    },
    setBlocks(blocks) {
      editorArea.innerHTML = blocksToHtml(blocks);
      makeEditable();
    },
    focus() {
      const first = editorArea.querySelector('.rt-block');
      if (first) {
        first.focus();
        const sel = window.getSelection();
        const r = document.createRange();
        r.selectNodeContents(first);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
      }
    },
    destroy() {
      if (container.parentNode) container.parentNode.removeChild(container);
    }
  };
}
