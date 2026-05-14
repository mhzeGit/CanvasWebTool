import { state } from './state.js';
import { getDarkerColor, worldToScreen } from './utils.js';
import { blocksToHtml, getOrCreateBlocks } from './rich-text.js';
import { parseInlineSpans } from './markdown.js';
import {
  DEFAULT_TITLE_COLOR, DEFAULT_TEXT_COLOR, TITLE_PLACEHOLDER, TEXT_PLACEHOLDER,
} from './config.js';

function isEditingEntity(type, idx, field) {
  if (!state.editingState) return false;
  if (state.editingState.type !== type || state.editingState.idx !== idx) return false;
  return !field || state.editingState.field === field;
}

let entityLayer;
const domByTypeIdx = {
  node: {},
  shape: {},
  textBox: {},
};

let prevDrawOrderKey = '';
let prevSelectionKey = '';

export function initEntityLayer() {
  entityLayer = document.getElementById('entityLayer');
}

export function destroyAllEntities() {
  for (const key in domByTypeIdx.node) {
    domByTypeIdx.node[key].remove();
  }
  for (const key in domByTypeIdx.shape) {
    domByTypeIdx.shape[key].remove();
  }
  for (const key in domByTypeIdx.textBox) {
    domByTypeIdx.textBox[key].remove();
  }
  domByTypeIdx.node = {};
  domByTypeIdx.shape = {};
  domByTypeIdx.textBox = {};
  prevDrawOrderKey = '';
  prevSelectionKey = '';
}

export function updateEntityLayerTransform() {
  // no-op: each entity is positioned directly now
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function titleToHtml(title) {
  if (!title || title.length === 0) {
    return `<span class="md-title-empty">${escapeHtml(TITLE_PLACEHOLDER)}</span>`;
  }
  const spans = parseInlineSpans(title);
  if (spans.length === 0) return '';
  let html = '';
  for (const s of spans) {
    let t = escapeHtml(s.text);
    if (s.bold) t = '<strong>' + t + '</strong>';
    if (s.italic) t = '<em>' + t + '</em>';
    if (s.code) t = '<code>' + t + '</code>';
    if (s.strike) t = '<s>' + t + '</s>';
    html += t;
  }
  return html;
}

export function getEntityElement(type, idx) {
  if (type === 'node') return domByTypeIdx.node['n' + idx] || null;
  if (type === 'textBox') return domByTypeIdx.textBox['t' + idx] || null;
  if (type === 'shape') return domByTypeIdx.shape['s' + idx] || null;
  return null;
}

function makeHandlesHtml() {
  return [
    '<div class="entity-handle tl" data-handle="tl"></div>',
    '<div class="entity-handle tr" data-handle="tr"></div>',
    '<div class="entity-handle bl" data-handle="bl"></div>',
    '<div class="entity-handle br" data-handle="br"></div>',
    '<div class="entity-handle tc" data-handle="tc"></div>',
    '<div class="entity-handle bc" data-handle="bc"></div>',
    '<div class="entity-handle ml" data-handle="ml"></div>',
    '<div class="entity-handle mr" data-handle="mr"></div>',
  ].join('');
}

function placeEntity(el, wx, wy, ww, wh) {
  const canvasRect = state.canvas.getBoundingClientRect();
  const tl = worldToScreen(wx, wy, state.offsetX, state.offsetY, state.scale);
  const br = worldToScreen(wx + ww, wy + wh, state.offsetX, state.offsetY, state.scale);
  const screenW = br.x - tl.x;
  const screenH = br.y - tl.y;

  el.style.position = 'fixed';
  el.style.left = (tl.x + canvasRect.left) + 'px';
  el.style.top = (tl.y + canvasRect.top) + 'px';
  el.style.width = Math.max(1, screenW) + 'px';
  el.style.height = Math.max(1, screenH) + 'px';
}

function ensureNodeElement(idx) {
  const n = state.nodes[idx];
  if (!n) return null;
  const key = 'n' + idx;
  let el = domByTypeIdx.node[key];
  if (!el) {
    el = document.createElement('div');
    el.className = 'entity entity-node';
    el.dataset.entityType = 'node';
    el.dataset.entityIdx = idx;
    el.innerHTML = [
      '<div class="entity-node-titlebar"></div>',
      '<div class="entity-node-body"></div>',
      makeHandlesHtml(),
    ].join('');
    document.body.appendChild(el);
    domByTypeIdx.node[key] = el;
  }

  const baseColor = n.color || 'rgb(43, 43, 43)';
  const nodeRadius = Math.min(12, Math.min(n.w, n.h) * 0.2);

  placeEntity(el, n.x, n.y, n.w, n.h);

  el.style.background = baseColor;
  el.style.borderRadius = (nodeRadius * state.scale) + 'px';
  el.style.borderColor = getDarkerColor(baseColor, 0.7);
  el.style.zIndex = ''; // set by applyDrawOrder

  const titlebar = el.querySelector('.entity-node-titlebar');
  titlebar.style.background = getDarkerColor(baseColor, 0.6);
  titlebar.style.borderRadius = (nodeRadius * state.scale) + 'px ' + (nodeRadius * state.scale) + 'px 0 0';
  titlebar.style.color = n.titleColor || DEFAULT_TITLE_COLOR;
  titlebar.style.fontSize = (15 * state.scale) + 'px';
  titlebar.style.padding = (8 * state.scale) + 'px';
  titlebar.style.minHeight = (18 * state.scale + 16 * state.scale) + 'px';
  if (!isEditingEntity('node', idx, 'title')) {
    titlebar.innerHTML = titleToHtml(n.title);
  }

  const body = el.querySelector('.entity-node-body');
  body.style.color = n.textColor || DEFAULT_TEXT_COLOR;
  body.style.fontSize = ((n.fontSize || 12) * state.scale) + 'px';
  body.style.padding = (8 * state.scale) + 'px';
  body.style.lineHeight = (1.4 * state.scale);

  if (!isEditingEntity('node', idx, 'text')) {
    if (n.text && n.text.length > 0) {
      const blocks = getOrCreateBlocks(n);
      body.innerHTML = blocksToHtml(blocks);
    } else {
      body.innerHTML = `<span class="entity-node-placeholder" style="font-size:${(n.fontSize || 12) * state.scale}px">${escapeHtml(TEXT_PLACEHOLDER)}</span>`;
    }
  }

  return el;
}

function ensureShapeElement(idx) {
  const s = state.shapes[idx];
  if (!s) return null;
  const key = 's' + idx;
  let el = domByTypeIdx.shape[key];
  if (!el) {
    el = document.createElement('div');
    el.className = 'entity entity-shape';
    el.dataset.entityType = 'shape';
    el.dataset.entityIdx = idx;
    el.innerHTML = '<div class="entity-shape-border"></div><div class="entity-shape-fill"></div>' + makeHandlesHtml();
    document.body.appendChild(el);
    domByTypeIdx.shape[key] = el;
  }

  placeEntity(el, s.x, s.y, s.w, s.h);

  const borderEl = el.querySelector('.entity-shape-border');
  const fillEl = el.querySelector('.entity-shape-fill');
  const bw = (s.borderWidth || 2) * state.scale;
  const borderColor = s.borderColor || '#6bb5ff';
  const fillColor = s.color || '#2b2b2b';

  borderEl.className = 'entity-shape-border';
  fillEl.className = 'entity-shape-fill';
  borderEl.style.position = 'absolute';
  borderEl.style.inset = '0';
  fillEl.style.position = 'absolute';
  fillEl.style.inset = Math.max(0.5, bw) + 'px';

  switch (s.shapeType) {
    case 'rectangle':
      borderEl.classList.add('entity-shape-rect');
      fillEl.classList.add('entity-shape-rect');
      borderEl.style.borderRadius = ((s.cornerRadius ?? 4) * state.scale) + 'px';
      fillEl.style.borderRadius = Math.max(0, ((s.cornerRadius ?? 4) - (s.borderWidth || 2)) * state.scale) + 'px';
      break;
    case 'circle':
      borderEl.classList.add('entity-shape-circle');
      fillEl.classList.add('entity-shape-circle');
      break;
    case 'triangle':
      borderEl.classList.add('entity-shape-triangle');
      fillEl.classList.add('entity-shape-triangle');
      break;
    case 'diamond':
      borderEl.classList.add('entity-shape-diamond');
      fillEl.classList.add('entity-shape-diamond');
      break;
    default:
      borderEl.classList.add('entity-shape-rect');
      fillEl.classList.add('entity-shape-rect');
  }

  borderEl.style.background = borderColor;
  fillEl.style.background = fillColor;

  return el;
}

function ensureTextBoxElement(idx) {
  const tb = state.textBoxes[idx];
  if (!tb) return null;
  const key = 't' + idx;
  let el = domByTypeIdx.textBox[key];
  if (!el) {
    el = document.createElement('div');
    el.className = 'entity entity-textbox';
    el.dataset.entityType = 'textBox';
    el.dataset.entityIdx = idx;
    el.innerHTML = '<div class="entity-textbox-content"></div>' + makeHandlesHtml();
    document.body.appendChild(el);
    domByTypeIdx.textBox[key] = el;
  }

  const baseColor = tb.color || '#1a1a1a';
  const borderColor = tb.borderColor || '#444';

  placeEntity(el, tb.x, tb.y, tb.w, tb.h);

  el.style.background = baseColor;
  el.style.borderColor = borderColor;
  el.style.borderWidth = (1.5 * state.scale) + 'px';
  el.style.borderRadius = (6 * state.scale) + 'px';

  const content = el.querySelector('.entity-textbox-content');
  content.style.color = tb.textColor || '#ddd';
  content.style.fontSize = ((tb.fontSize || 14) * state.scale) + 'px';
  content.style.padding = (8 * state.scale) + 'px';
  content.style.lineHeight = (1.4 * state.scale);

  if (!isEditingEntity('textBox', idx)) {
    const blocks = getOrCreateBlocks(tb);
    const hasContent = blocks && blocks.length > 0 && blocks.some(b => b.t !== 'p' || (b.s && b.s.length > 0 && b.s.some(s => s.t)));
    if (hasContent) {
      content.innerHTML = blocksToHtml(blocks);
    } else {
      content.innerHTML = '';
      const placeholder = document.createElement('span');
      placeholder.className = 'entity-textbox-placeholder';
      placeholder.textContent = 'Double-click to edit';
      placeholder.style.fontSize = ((tb.fontSize || 14) * state.scale) + 'px';
      content.appendChild(placeholder);
    }
  }

  return el;
}

function applyDrawOrder() {
  const order = state.getAllDrawOrder();
  for (let i = 0; i < order.length; i++) {
    const item = order[i];
    let el = null;
    if (item.type === 'node') {
      el = domByTypeIdx.node['n' + item.i];
    } else if (item.type === 'shape') {
      el = domByTypeIdx.shape['s' + item.i];
    } else if (item.type === 'textBox') {
      el = domByTypeIdx.textBox['t' + item.i];
    }
    if (el) {
      el.style.zIndex = 5 + i;
    }
  }
}

function applySelectionClasses() {
  for (const key in domByTypeIdx.node) {
    const el = domByTypeIdx.node[key];
    const idx = parseInt(el.dataset.entityIdx);
    el.classList.toggle('selected', state.selected.has(idx));
  }
  for (const key in domByTypeIdx.shape) {
    const el = domByTypeIdx.shape[key];
    const idx = parseInt(el.dataset.entityIdx);
    el.classList.toggle('selected', state.selectedShapes.has(idx));
  }
  for (const key in domByTypeIdx.textBox) {
    const el = domByTypeIdx.textBox[key];
    const idx = parseInt(el.dataset.entityIdx);
    el.classList.toggle('selected', state.selectedTextBoxes.has(idx));
  }
}

function cleanupStaleElements() {
  const aliveNodeKeys = new Set();
  for (let i = 0; i < state.nodes.length; i++) aliveNodeKeys.add('n' + i);
  for (const key in domByTypeIdx.node) {
    if (!aliveNodeKeys.has(key)) {
      domByTypeIdx.node[key].remove();
      delete domByTypeIdx.node[key];
    }
  }
  const aliveShapeKeys = new Set();
  for (let i = 0; i < state.shapes.length; i++) aliveShapeKeys.add('s' + i);
  for (const key in domByTypeIdx.shape) {
    if (!aliveShapeKeys.has(key)) {
      domByTypeIdx.shape[key].remove();
      delete domByTypeIdx.shape[key];
    }
  }
  const aliveTBKeys = new Set();
  for (let i = 0; i < state.textBoxes.length; i++) aliveTBKeys.add('t' + i);
  for (const key in domByTypeIdx.textBox) {
    if (!aliveTBKeys.has(key)) {
      domByTypeIdx.textBox[key].remove();
      delete domByTypeIdx.textBox[key];
    }
  }
}

export function syncAllEntities() {
  const order = state.getAllDrawOrder();
  const drawOrderKey = order.map(item => item.type[0] + item.i).join(',');
  const selKey = state.selected.size + ',' + state.selectedShapes.size + ',' + state.selectedTextBoxes.size;

  cleanupStaleElements();

  for (let i = 0; i < state.nodes.length; i++) {
    ensureNodeElement(i);
  }
  for (let i = 0; i < state.shapes.length; i++) {
    ensureShapeElement(i);
  }
  for (let i = 0; i < state.textBoxes.length; i++) {
    ensureTextBoxElement(i);
  }

  if (drawOrderKey !== prevDrawOrderKey) {
    applyDrawOrder();
    prevDrawOrderKey = drawOrderKey;
  }

  if (selKey !== prevSelectionKey) {
    applySelectionClasses();
    prevSelectionKey = selKey;
  }
}
