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
    if (bl.t === 'chk') prefix = '<span class="rt-marker" data-checked="' + (bl.c ? '1' : '0') + '" contenteditable="false"></span>';
    else if (bl.t === 'bul') prefix = '<span class="rt-marker" contenteditable="false">\u2022</span>';
    else if (bl.t === 'num') prefix = '<span class="rt-marker" contenteditable="false">' + (bl.n || 1) + '.</span>';
    let extraStyle = '';
    if (bl.al && bl.al !== 'l' && bl.al !== 'left') extraStyle = 'text-align:' + (bl.al === 'c' || bl.al === 'center' ? 'center' : 'right') + ';';
    const levelAttr = bl.l ? ' data-l="' + bl.l + '"' : '';
    const styleAttr = extraStyle ? ' style="' + extraStyle + '"' : '';
    html += '<div class="' + cls + '"' + levelAttr + styleAttr + '>' + prefix + '<span class="rt-content">' + (inner || '<br>') + '</span></div>';
  }
  return html;
}
