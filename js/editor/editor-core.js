import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import { TextStyle, Color, FontSize } from '@tiptap/extension-text-style';

const BASE_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    codeBlock: false,
    dropcursor: { color: 'currentColor', width: 2 },
    link: {
      openOnClick: false,
      HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
    },
  }),
  TextStyle,
  Color,
  FontSize,
];

export function createEditorExtensions(options = {}) {
  const exts = [...BASE_EXTENSIONS];
  if (options.excludeHistory) {
    return exts.filter(ext => ext.name !== 'history');
  }
  return exts;
}

export function createEditor({ element, content, editable = true, onUpdate, onFocus, onBlur, excludeHistory = false }) {
  const extensions = createEditorExtensions({ excludeHistory });

  const editor = new Editor({
    element,
    extensions,
    content,
    editable,
    autofocus: false,
    onUpdate: ({ editor: ed }) => {
      if (onUpdate) onUpdate({ editor: ed });
    },
    onFocus: ({ editor: ed, event }) => {
      if (onFocus) onFocus({ editor: ed, event });
    },
    onBlur: ({ editor: ed, event }) => {
      if (onBlur) onBlur({ editor: ed, event });
    },
  });

  return editor;
}

export function emptyDoc() {
  return {
    type: 'doc',
    content: [{ type: 'paragraph' }],
  };
}

export { Editor };
export { TextStyle, Color, FontSize };
