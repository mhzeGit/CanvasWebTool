import { parseMarkdownLines, NAMED_COLORS, normalizeColor } from './markdown.js';

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
    if (bt === 'num' && line.prefix) {
      const num = parseInt(line.prefix, 10);
      if (!isNaN(num)) block.n = num;
    }
    if (line.spans) {
      for (const sp of line.spans) {
        const s = { t: sp.text };
        if (sp.bold) s.b = true;
        if (sp.italic) s.i = true;
        if (sp.code) s.cd = true;
        if (sp.strike) s.s = true;
        if (sp.fc) s.fc = sp.fc;
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
    else if (bl.t === 'num') prefix = (bl.n || 1) + '. ';
    else if (bl.t === 'chk') prefix = '- [' + (bl.c ? 'x' : ' ') + '] ';
    let line = prefix;
    const spanList = bl.s || [];
    let i = 0;
    while (i < spanList.length) {
      const sp = spanList[i];
      if (sp.fc) {
        const entry = Object.entries(NAMED_COLORS).find(([, v]) => v === normalizeColor(sp.fc));
        if (entry) {
          let j = i + 1;
          while (j < spanList.length && spanList[j].fc === sp.fc) j++;
          line += '{' + entry[0] + ':';
          for (let k = i; k < j; k++) {
            let t = spanList[k].t || '';
            if (spanList[k].cd) t = '`' + t + '`';
            if (spanList[k].s) t = '~~' + t + '~~';
            if (spanList[k].b) t = '*' + t + '*';
            if (spanList[k].i) t = '_' + t + '_';
            line += t;
          }
          line += '}';
          i = j;
          continue;
        }
      }
      let t = sp.t || '';
      if (sp.cd) t = '`' + t + '`';
      if (sp.s) t = '~~' + t + '~~';
      if (sp.b) t = '*' + t + '*';
      if (sp.i) t = '_' + t + '_';
      line += t;
      i++;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

export function getOrCreateBlocks(entity) {
  if (entity.blocks && Array.isArray(entity.blocks) && entity.blocks.length > 0) {
    const text = entity.text || '';
    if (/\{[a-zA-Z]+:/.test(text) && !entity.blocks.some(b => (b.s || []).some(s => s.fc))) {
      entity.blocks = markdownToBlocks(text);
    }
    return entity.blocks;
  }
  if (typeof entity.text === 'string' && entity.text.trim()) {
    entity.blocks = markdownToBlocks(entity.text);
    return entity.blocks;
  }
  entity.blocks = [{ t: 'p', s: [{ t: '' }] }];
  return entity.blocks;
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
      let style = '';
      if (sp.fc) style += 'color:' + sp.fc + ';';
      if (sp.fs) style += 'font-size:' + sp.fs + 'px;';
      if (style) t = '<span style="' + style + '">' + t + '</span>';
      if (sp.cd) t = '<code>' + t + '</code>';
      if (sp.s) t = '<s>' + t + '</s>';
      if (sp.u) t = '<u>' + t + '</u>';
      if (sp.b) t = '<strong>' + t + '</strong>';
      if (sp.i) t = '<em>' + t + '</em>';
      if (sp.lk) t = '<a href="' + escHtml(sp.lk) + '" target="_blank">' + t + '</a>';
      inner += t;
    }
    let prefix = '';
    if (bl.t === 'chk') prefix = '<span class="rt-marker" data-checked="' + (bl.c ? '1' : '0') + '" contenteditable="false"></span> ';
    else if (bl.t === 'bul') prefix = '<span class="rt-marker" contenteditable="false">\u2022</span> ';
    else if (bl.t === 'num') prefix = '<span class="rt-marker" contenteditable="false">' + (bl.n || 1) + '.</span> ';
    let extraStyle = '';
    if (bl.al && bl.al !== 'l' && bl.al !== 'left') extraStyle = 'text-align:' + (bl.al === 'c' || bl.al === 'center' ? 'center' : 'right') + ';';
    const styleAttr = extraStyle ? ' style="' + extraStyle + '"' : '';
    html += '<div class="' + cls + '"' + styleAttr + '>' + prefix + (inner || '<br>') + '</div>';
  }
  return html;
}

export function blocksToEditorHtml(blocks) {
  if (!blocks || !blocks.length) return '<div class="rt-block rt-paragraph"><br></div>';
  let html = '';
  const typeMap = { p: 'rt-paragraph', h1: 'rt-h1', h2: 'rt-h2', h3: 'rt-h3', bul: 'rt-bullet', num: 'rt-numbered', chk: 'rt-checkbox', qt: 'rt-quote', hr: 'rt-divider' };
  for (const bl of blocks) {
    if (bl.t === 'hr') { html += '<div class="rt-block rt-divider" contenteditable="false"><hr></div>'; continue; }
    const cls = 'rt-block ' + (typeMap[bl.t] || 'rt-paragraph');
    let inner = '';
    const spans = bl.s || [];
    if (spans.length === 0) spans.push({ t: '' });
    let i = 0;
    while (i < spans.length) {
      const sp = spans[i];
      if (sp.fc) {
        const colorHex = sp.fc;
        const entry = Object.entries(NAMED_COLORS).find(([, v]) => v === colorHex);
        if (entry) {
          let j = i;
          while (j < spans.length && spans[j].fc === colorHex) j++;
          inner += '<span class="rt-color-syn" contenteditable="false">{' + entry[0] + ':</span>';
          for (let k = i; k < j; k++) {
            let t = escHtml(spans[k].t || '');
            let style = '';
            if (spans[k].fc) style += 'color:' + spans[k].fc + ';';
            if (spans[k].fs) style += 'font-size:' + spans[k].fs + 'px;';
            if (style) t = '<span style="' + style + '">' + t + '</span>';
            if (spans[k].cd) t = '<code>' + t + '</code>';
            if (spans[k].s) t = '<s>' + t + '</s>';
            if (spans[k].u) t = '<u>' + t + '</u>';
            if (spans[k].b) t = '<strong>' + t + '</strong>';
            if (spans[k].i) t = '<em>' + t + '</em>';
            if (spans[k].lk) t = '<a href="' + escHtml(spans[k].lk) + '" target="_blank">' + t + '</a>';
            inner += t;
          }
          inner += '<span class="rt-color-syn" contenteditable="false">}</span>';
          i = j;
          continue;
        }
      }
      let t = escHtml(sp.t || '');
      let style = '';
      if (sp.fc) style += 'color:' + sp.fc + ';';
      if (sp.fs) style += 'font-size:' + sp.fs + 'px;';
      if (style) t = '<span style="' + style + '">' + t + '</span>';
      if (sp.cd) t = '<code>' + t + '</code>';
      if (sp.s) t = '<s>' + t + '</s>';
      if (sp.u) t = '<u>' + t + '</u>';
      if (sp.b) t = '<strong>' + t + '</strong>';
      if (sp.i) t = '<em>' + t + '</em>';
      if (sp.lk) t = '<a href="' + escHtml(sp.lk) + '" target="_blank">' + t + '</a>';
      inner += t;
      i++;
    }
    let prefix = '';
    if (bl.t === 'chk') prefix = '<span class="rt-marker" data-checked="' + (bl.c ? '1' : '0') + '" contenteditable="false"></span> ';
    else if (bl.t === 'bul') prefix = '<span class="rt-marker" contenteditable="false">\u2022</span> ';
    else if (bl.t === 'num') prefix = '<span class="rt-marker" contenteditable="false">' + (bl.n || 1) + '.</span> ';
    let extraStyle = '';
    if (bl.al && bl.al !== 'l' && bl.al !== 'left') extraStyle = 'text-align:' + (bl.al === 'c' || bl.al === 'center' ? 'center' : 'right') + ';';
    const styleAttr = extraStyle ? ' style="' + extraStyle + '"' : '';
    html += '<div class="' + cls + '"' + styleAttr + '>' + prefix + (inner || '<br>') + '</div>';
  }
  return html;
}

function getTagFormat(tagName) {
  switch (tagName) {
    case 'strong': case 'b': return { b: true };
    case 'em': case 'i': return { i: true };
    case 'u': case 'ins': return { u: true };
    case 's': case 'del': case 'strike': return { s: true };
    case 'code': return { cd: true };
    case 'a': return { lk: null };
    default: return {};
  }
}

function collectAncestorFormat(node, blockEl) {
  const fmt = {};
  let cur = node;
  while (cur && cur !== blockEl) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const tag = cur.tagName.toLowerCase();
      const tagFmt = getTagFormat(tag);
      if (tagFmt.b && !fmt.b) fmt.b = true;
      if (tagFmt.i && !fmt.i) fmt.i = true;
      if (tagFmt.u && !fmt.u) fmt.u = true;
      if (tagFmt.s && !fmt.s) fmt.s = true;
      if (tagFmt.cd && !fmt.cd) fmt.cd = true;
      if (tag === 'a' && fmt.lk === undefined) {
        fmt.lk = cur.getAttribute('href') || '';
      }
      if (tag === 'span' || tag === 'font') {
        const c = cur.style && cur.style.color ? normalizeColor(cur.style.color) : (cur.getAttribute && cur.getAttribute('color'));
        if (c && !fmt.fc) fmt.fc = c;
        const fs = cur.style && cur.style.fontSize ? cur.style.fontSize : null;
        if (fs && !fmt.fs) {
          const n = parseFloat(fs);
          if (!isNaN(n)) fmt.fs = n;
        }
      }
      if (tag === 'font') {
        const c = cur.getAttribute('color');
        if (c && !fmt.fc) fmt.fc = c;
        const s = cur.getAttribute('size');
        if (s && !fmt.fs) {
          const sz = parseInt(s, 10);
          if (!isNaN(sz)) fmt.fs = 8 + sz * 2;
        }
      }
    }
    cur = cur.parentNode;
  }
  return fmt;
}

function isMarkerNode(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  return node.getAttribute('contenteditable') === 'false';
}

function isParentMarker(node, blockEl) {
  let cur = node;
  while (cur && cur !== blockEl) {
    if (cur.nodeType === Node.ELEMENT_NODE && cur.getAttribute('contenteditable') === 'false') return true;
    cur = cur.parentNode;
  }
  return false;
}

export function htmlToBlocks(container) {
  const blocks = [];
  const typeMap = { 'rt-paragraph': 'p', 'rt-h1': 'h1', 'rt-h2': 'h2', 'rt-h3': 'h3', 'rt-bullet': 'bul', 'rt-numbered': 'num', 'rt-checkbox': 'chk', 'rt-quote': 'qt', 'rt-divider': 'hr' };
  const tagMap = { 'H1': 'h1', 'H2': 'h2', 'H3': 'h3', 'BLOCKQUOTE': 'qt', 'P': 'p', 'DIV': 'p', 'HR': 'hr' };

  const raw = Array.from(container.children);
  for (let ci = 0; ci < raw.length; ci++) {
    const blockEl = raw[ci];
    let bt = null;
    if (blockEl.classList && blockEl.classList.contains('rt-block')) {
      const cls = Array.from(blockEl.classList).find(c => typeMap[c]);
      if (cls) bt = typeMap[cls];
    } else if (blockEl.tagName === 'HR') {
      bt = 'hr';
    } else if (blockEl.tagName === 'UL' || blockEl.tagName === 'OL') {
      const isBul = blockEl.tagName === 'UL';
      const items = blockEl.querySelectorAll(':scope > li');
      for (const li of items) {
        blocks.push(_liToBlock(li, isBul ? 'bul' : 'num'));
      }
      continue;
    } else if (tagMap[blockEl.tagName]) {
      bt = tagMap[blockEl.tagName];
    }
    if (!bt) continue;
    if (bt === 'hr') { blocks.push({ t: 'hr' }); continue; }

    const baseProps = { t: bt };
    if (blockEl.style.textAlign === 'center') baseProps.al = 'c';
    else if (blockEl.style.textAlign === 'right') baseProps.al = 'r';
    if (bt === 'chk') {
      const marker = blockEl.querySelector('.rt-marker');
      if (marker && marker.dataset.checked !== undefined) {
        baseProps.c = marker.dataset.checked === '1';
      } else {
        baseProps.c = marker && /x/i.test(marker.textContent || '');
      }
    }
    if (bt === 'num') {
      const marker = blockEl.querySelector('.rt-marker');
      if (marker) {
        const num = parseInt(marker.textContent, 10);
        if (!isNaN(num)) baseProps.n = num;
      }
    }

    const subBlocks = [];
    let current = { ...baseProps, s: [] };

    function processNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        if (!text) return;
        const fmt = collectAncestorFormat(node.parentNode, blockEl);
        const span = { t: text };
        if (fmt.b) span.b = true;
        if (fmt.i) span.i = true;
        if (fmt.u) span.u = true;
        if (fmt.s) span.s = true;
        if (fmt.cd) span.cd = true;
        if (fmt.fc) span.fc = fmt.fc;
        if (fmt.fs) span.fs = fmt.fs;
        if (fmt.lk !== undefined && fmt.lk !== null) span.lk = fmt.lk;
        current.s.push(span);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === 'BR') {
          subBlocks.push(current);
          current = { ...baseProps, s: [] };
        } else if (!isMarkerNode(node)) {
          for (const child of node.childNodes) {
            processNode(child);
          }
        }
      }
    }

    for (const child of blockEl.childNodes) {
      processNode(child);
    }
    subBlocks.push(current);

    for (const sb of subBlocks) {
      if (sb.s.length === 0) sb.s.push({ t: '' });
      blocks.push(sb);
    }
  }

  if (blocks.length === 0) blocks.push({ t: 'p', s: [{ t: '' }] });
  return blocks;
}

function _liToBlock(li, type) {
  const bl = { t: type, s: [] };
  const fmt = { b: false, i: false, u: false, s: false, cd: false };
  for (const child of li.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent || '';
      if (text) bl.s.push({ t: text });
    } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== 'BR') {
      const cfmt = collectAncestorFormat(child, li);
      const span = { t: child.textContent || '' };
      if (cfmt.b) span.b = true;
      if (cfmt.i) span.i = true;
      if (cfmt.u) span.u = true;
      if (cfmt.s) span.s = true;
      if (cfmt.cd) span.cd = true;
      if (span.t) bl.s.push(span);
    }
  }
  if (bl.s.length === 0) bl.s.push({ t: '' });
  return bl;
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
      const boxSize = baseFontSize * 0.85;
      const boxY = currentY + (lh - boxSize) / 2;
      ctx.save();
      ctx.strokeStyle = brightenColor(textColor, 0.4);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, boxY, boxSize, boxSize);
      if (bl.c) {
        ctx.fillStyle = '#4caf50';
        ctx.font = (boxSize * 0.8) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✓', x + boxSize / 2, boxY + boxSize / 2 + 1);
      }
      ctx.restore();
      prefixW = boxSize + prefixPad;
    } else if (bl.t === 'bul') {
      const ps = { t: '\u2022', b: true, i: false };
      drawOneSpan(ctx, ps, x, currentY, brightenColor(textColor, 0.4), fontFamily, baseFontSize);
      prefixW = spanWidth(ctx, ps, baseFontSize, fontFamily) + prefixPad;
    } else if (bl.t === 'num') {
      const ps = { t: (bl.n || '1') + '.', b: false, i: false };
      drawOneSpan(ctx, ps, x, currentY, brightenColor(textColor, 0.4), fontFamily, baseFontSize);
      prefixW = spanWidth(ctx, ps, baseFontSize, fontFamily) + prefixPad;
    } else if (bl.t === 'qt') {
      const barW = 3;
      const barPad = 5;
      const qtSpans = (bl.s || []).map(s => ({
        ...s,
        b: s.b || false,
        fs: s.fs || fontSize
      }));
      const qtContentMaxW = maxW - (barW + barPad);
      const qtLines = buildDisplayLines(ctx, qtSpans, qtContentMaxW, fontSize, fontFamily);
      const qtH = qtLines.length * lh;
      const bgPad = 4;
      ctx.save();
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = textColor;
      ctx.fillRect(x, currentY - bgPad, maxW, qtH + bgPad * 2);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = textColor;
      ctx.fillRect(x, currentY, barW, qtH);
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

export function blocksToSimpleText(blocks) {
  if (!blocks || !blocks.length) return '';
  const lines = [];
  for (const bl of blocks) {
    if (bl.t === 'hr') { lines.push('---'); continue; }
    let line = '';
    for (const sp of (bl.s || [])) line += (sp.t || '');
    lines.push(line);
  }
  return lines.join('\n');
}
