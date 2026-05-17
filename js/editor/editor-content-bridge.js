import { markdownToTiptap, blocksToTiptap, tiptapToMarkdown, EMPTY_DOC } from './editor-serialization.js';

export function getOrCreateTiptapContent(entity) {
  if (entity.content && typeof entity.content === 'object' && entity.content.type === 'doc') {
    return entity.content;
  }

  if (entity.blocks && Array.isArray(entity.blocks) && entity.blocks.length > 0) {
    entity.content = blocksToTiptap(entity.blocks);
    return entity.content;
  }

  if (entity.text && typeof entity.text === 'string') {
    entity.content = markdownToTiptap(entity.text);
    return entity.content;
  }

  entity.content = { ...EMPTY_DOC };
  return entity.content;
}

export function getEntityMarkdown(entity) {
  if (entity.text && typeof entity.text === 'string') {
    return entity.text;
  }
  if (entity.content && entity.content.type === 'doc') {
    return tiptapToMarkdown(entity.content);
  }
  return '';
}

export function syncEntityMarkdown(entity) {
  if (entity.content && entity.content.type === 'doc') {
    entity.text = tiptapToMarkdown(entity.content);
  }
}

export function setEntityContent(entity, content) {
  entity.content = content;
  entity.text = tiptapToMarkdown(content);
  entity.blocks = null;
}

export function migrateEntityToTiptap(entity) {
  if (entity.content && entity.content.type === 'doc') return;

  if (entity.text && typeof entity.text === 'string') {
    entity.content = markdownToTiptap(entity.text);
    return;
  }

  entity.content = { ...EMPTY_DOC };
  entity.text = '';
}
