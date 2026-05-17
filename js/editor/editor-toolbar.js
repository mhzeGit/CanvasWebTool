export function getToolbarActions(editor) {
  if (!editor) return {};

  const chain = editor.chain();

  return {
    bold: () => editor.chain().focus().toggleBold().run(),
    italic: () => editor.chain().focus().toggleItalic().run(),
    underline: () => editor.chain().focus().toggleUnderline().run(),
    strikethrough: () => editor.chain().focus().toggleStrike().run(),
    code: () => editor.chain().focus().toggleCode().run(),
    h1: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    h2: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    h3: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    bulletList: () => editor.chain().focus().toggleBulletList().run(),
    orderedList: () => editor.chain().focus().toggleOrderedList().run(),
    blockquote: () => editor.chain().focus().toggleBlockquote().run(),
    horizontalRule: () => editor.chain().focus().setHorizontalRule().run(),
    undo: () => editor.chain().focus().undo().run(),
    redo: () => editor.chain().focus().redo().run(),
    setColor: (color) => {
      if (!color) {
        editor.chain().focus().unsetColor().run();
      } else {
        editor.chain().focus().setColor(color).run();
      }
    },
    setFontSize: (size) => {
      if (!size) {
        editor.chain().focus().unsetFontSize().run();
      } else {
        editor.chain().focus().setFontSize(size).run();
      }
    },
    setLink: (href) => {
      if (!href) {
        editor.chain().focus().unsetLink().run();
      } else {
        editor.chain().focus().setLink({ href }).run();
      }
    },
    getState: () => ({
      isBold: editor.isActive('bold'),
      isItalic: editor.isActive('italic'),
      isUnderline: editor.isActive('underline'),
      isStrike: editor.isActive('strike'),
      isCode: editor.isActive('code'),
      isH1: editor.isActive('heading', { level: 1 }),
      isH2: editor.isActive('heading', { level: 2 }),
      isH3: editor.isActive('heading', { level: 3 }),
      isBulletList: editor.isActive('bulletList'),
      isOrderedList: editor.isActive('orderedList'),
      isBlockquote: editor.isActive('blockquote'),
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
    }),
  };
}

export function buildToolbarHtml() {
  return (
    '<div class="panel-md-toolbar">' +
      '<button class="panel-md-btn" data-tb-cmd="bold" title="Bold (Ctrl+B)"><strong>B</strong></button>' +
      '<button class="panel-md-btn" data-tb-cmd="italic" title="Italic (Ctrl+I)"><em>I</em></button>' +
      '<button class="panel-md-btn" data-tb-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button>' +
      '<button class="panel-md-btn" data-tb-cmd="strikethrough" title="Strikethrough (Ctrl+Shift+X)"><s>S</s></button>' +
      '<span class="panel-md-sep"></span>' +
      '<button class="panel-md-btn" data-tb-cmd="h1" title="Heading 1">H1</button>' +
      '<button class="panel-md-btn" data-tb-cmd="h2" title="Heading 2">H2</button>' +
      '<button class="panel-md-btn" data-tb-cmd="h3" title="Heading 3">H3</button>' +
      '<span class="panel-md-sep"></span>' +
      '<button class="panel-md-btn" data-tb-cmd="bulletList" title="Bullet List">UL</button>' +
      '<button class="panel-md-btn" data-tb-cmd="orderedList" title="Numbered List">OL</button>' +
      '<span class="panel-md-sep"></span>' +
      '<button class="panel-md-btn" data-tb-cmd="blockquote" title="Blockquote"><span style="font-family:serif;">\u275D</span></button>' +
      '<button class="panel-md-btn" data-tb-cmd="code" title="Inline Code">&lt;/&gt;</button>' +
      '<button class="panel-md-btn" data-tb-cmd="horizontalRule" title="Horizontal Rule">\u2014</button>' +
      '<button class="panel-md-btn" data-tb-cmd="link" title="Insert Link">\uD83D\uDD17</button>' +
      '<span class="panel-md-sep"></span>' +
      '<button class="panel-md-btn panel-md-toggle" data-tb-cmd="toggle" title="Toggle raw markdown">M</button>' +
    '</div>'
  );
}

export function wireToolbar(toolbarEl, editor, onToggleMode) {
  if (!toolbarEl || !editor) return;

  const actions = getToolbarActions(editor);

  toolbarEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tb-cmd]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    const cmd = btn.dataset.tbCmd;

    if (cmd === 'toggle') {
      if (onToggleMode) onToggleMode();
      return;
    }

    if (cmd === 'link') {
      const url = prompt('Enter URL:', 'https://');
      if (url) actions.setLink(url);
      return;
    }

    if (typeof actions[cmd] === 'function') {
      actions[cmd]();
    }
  });

  const updateActiveStates = () => {
    const state = actions.getState();
    for (const btn of toolbarEl.querySelectorAll('[data-tb-cmd]')) {
      const cmd = btn.dataset.tbCmd;
      btn.classList.toggle('active', !!state['is' + cmd.charAt(0).toUpperCase() + cmd.slice(1)]);
    }
  };

  editor.on('selectionUpdate', updateActiveStates);
  editor.on('transaction', updateActiveStates);

  return { updateActiveStates };
}
