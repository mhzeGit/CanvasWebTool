import { state } from './state.js';
import { getDarkerColor, getBorderColor, getDividerColor, worldToScreen } from './utils.js';
import { parseInlineSpans } from './markdown.js';
import { getOrCreateTiptapContent } from './editor/editor-content-bridge.js';
import { createEditor, emptyDoc } from './editor/editor-core.js';
import {
  DEFAULT_TITLE_COLOR, DEFAULT_TEXT_COLOR, TITLE_PLACEHOLDER, TEXT_PLACEHOLDER,
} from './config.js';
import { history } from './history.js';
import { createSetLockCmd } from './undo.js';

function isEditingEntity(type, idx, field) {
  if (!state.editingState) return false;
  if (state.editingState.type !== type || state.editingState.idx !== idx) return false;
  return !field || state.editingState.field === field;
}

let entityLayer;
const domByTypeIdx = {
  shape: {},
  textBox: {},
};

let prevDrawOrder = null;
let prevSelectionKey = '';

export function initEntityLayer() {
  entityLayer = document.getElementById('entityLayer');
}

export function destroyAllEntities() {
  for (const key in domByTypeIdx.shape) {
    domByTypeIdx.shape[key].remove();
  }
  for (const key in domByTypeIdx.textBox) {
    destroyTextBoxElement(domByTypeIdx.textBox[key]);
  }
  domByTypeIdx.shape = {};
  domByTypeIdx.textBox = {};
  prevDrawOrder = null;
  prevSelectionKey = '';
}

export function updateEntityLayerTransform() {
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

function syncUnlockButton(el, isLocked, entityArray, entityId) {
  let btn = el.querySelector('.entity-unlock-btn');
  if (isLocked) {
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'entity-unlock-btn';
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/><circle cx="12" cy="16" r="1"/></svg>';
      btn.title = 'Unlock';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const found = entityArray.find(ent => ent.id === entityId);
        if (found && found.locked) {
          found.locked = false;
          history.push(createSetLockCmd(entityArray, entityId, true, false, () => {}));
        }
      });
      el.appendChild(btn);
    }
  } else if (btn) {
    btn.remove();
  }
  el.classList.toggle('locked', isLocked);
}

export function getEntityElement(type, idx) {
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

/**
 * Style writes are cached per element.
 *
 * Every entity is re-placed and re-styled on each sync, which used to mean
 * dozens of writes per entity per frame. Assigning the value a property already
 * holds still costs a CSSOM write and can invalidate style, so the last value
 * written is remembered and identical writes are skipped. `el._styleCache` is
 * created with the element and dies with it.
 */
function setStyle(el, property, value) {
  const cache = el._styleCache;
  if (cache[property] === value) return;
  cache[property] = value;
  el.style[property] = value;
}

function setClassName(el, child, value) {
  if (child._lastClassName === value) return;
  child._lastClassName = value;
  child.className = value;
}

/**
 * The canvas rectangle is the same for every entity in a frame, and reading it
 * forces a layout. It is therefore measured once per sync rather than once per
 * entity — the single biggest cost in the old per-frame path.
 */
let canvasLeft = 0;
let canvasTop = 0;

function measureCanvas() {
  const rect = state.canvas.getBoundingClientRect();
  canvasLeft = rect.left;
  canvasTop = rect.top;
}

function placeEntity(el, wx, wy, ww, wh, useWorldSize) {
  const tl = worldToScreen(wx, wy, state.offsetX, state.offsetY, state.scale);

  setStyle(el, 'position', 'fixed');
  setStyle(el, 'left', (tl.x + canvasLeft) + 'px');
  setStyle(el, 'top', (tl.y + canvasTop) + 'px');

  if (useWorldSize) {
    setStyle(el, 'width', ww + 'px');
    setStyle(el, 'height', wh + 'px');
  } else {
    const br = worldToScreen(wx + ww, wy + wh, state.offsetX, state.offsetY, state.scale);
    setStyle(el, 'width', Math.max(1, br.x - tl.x) + 'px');
    setStyle(el, 'height', Math.max(1, br.y - tl.y) + 'px');
  }
}

/** Shape kind -> the modifier class its border and fill layers carry. */
const SHAPE_CLASS = {
  rectangle: 'entity-shape-rect',
  circle: 'entity-shape-circle',
  triangle: 'entity-shape-triangle',
  diamond: 'entity-shape-diamond',
};

/** Outer-element corner radius per shape kind; rectangles use their own value. */
function outerRadiusFor(shape) {
  switch (shape.shapeType) {
    case 'circle': return '50%';
    case 'triangle':
    case 'diamond': return '0';
    default: return (shape.cornerRadius ?? 4) + 'px';
  }
}

function createShapeElement(idx, shape) {
  const el = document.createElement('div');
  el._styleCache = {};
  el.className = 'entity entity-shape';
  el.dataset.entityType = 'shape';
  el.dataset.entityIdx = idx;
  el.dataset.entityId = shape.id;
  el.innerHTML = '<div class="entity-shape-border"></div><div class="entity-shape-fill"></div><div class="entity-shape-image-wrap"></div>' + makeHandlesHtml();

  // Looking these up once and hanging them off the element avoids three
  // querySelector calls per shape per frame.
  el._parts = {
    border: el.querySelector('.entity-shape-border'),
    fill: el.querySelector('.entity-shape-fill'),
    imageWrap: el.querySelector('.entity-shape-image-wrap'),
  };
  for (const part of Object.values(el._parts)) part._styleCache = {};

  document.body.appendChild(el);
  return el;
}

function ensureShapeElement(idx) {
  const s = state.shapes[idx];
  if (!s) return null;

  const key = 's' + idx;
  let el = domByTypeIdx.shape[key];
  if (!el) {
    el = createShapeElement(idx, s);
    domByTypeIdx.shape[key] = el;
  }

  placeEntity(el, s.x, s.y, s.w, s.h, true);
  setStyle(el, 'transform', `scale(${state.scale})`);
  setStyle(el, 'transformOrigin', '0 0');
  setStyle(el, 'borderRadius', outerRadiusFor(s));
  if (el.dataset.entityId !== String(s.id)) el.dataset.entityId = s.id;
  syncUnlockButton(el, !!s.locked, state.shapes, s.id);

  const { border: borderEl, fill: fillEl, imageWrap } = el._parts;
  const borderWidth = s.borderWidth || 2;
  const inset = Math.max(0.5, borderWidth);
  const corner = s.cornerRadius ?? 4;
  const innerRadius = Math.max(0, corner - borderWidth) + 'px';
  const shapeClass = SHAPE_CLASS[s.shapeType] || SHAPE_CLASS.rectangle;

  setClassName(el, borderEl, 'entity-shape-border ' + shapeClass);
  setStyle(borderEl, 'position', 'absolute');
  setStyle(borderEl, 'inset', '0');
  setStyle(borderEl, 'background', s.borderColor || '#6bb5ff');

  setClassName(el, fillEl, 'entity-shape-fill ' + shapeClass);
  setStyle(fillEl, 'position', 'absolute');
  setStyle(fillEl, 'inset', inset + 'px');
  setStyle(fillEl, 'background', s.color || '#2b2b2b');

  // Only rectangles round their border and fill layers; the other kinds are
  // drawn by clip paths, so a radius there would do nothing.
  setStyle(borderEl, 'borderRadius', s.shapeType === 'rectangle' ? corner + 'px' : '');
  setStyle(fillEl, 'borderRadius', s.shapeType === 'rectangle' ? innerRadius : '');

  setClassName(el, imageWrap, 'entity-shape-image-wrap');
  setStyle(imageWrap, 'position', 'absolute');
  setStyle(imageWrap, 'overflow', 'hidden');
  setStyle(imageWrap, 'borderRadius', innerRadius);
  setStyle(imageWrap, 'inset', inset + 'px');
  syncShapeImage(imageWrap, s);

  return el;
}

function syncShapeImage(imageWrap, shape) {
  if (!shape.image) {
    const existing = imageWrap.querySelector('.si-img');
    if (existing) existing.remove();
    setStyle(imageWrap, 'display', 'none');
    return;
  }

  let imgEl = imageWrap.querySelector('.si-img');
  if (!imgEl) {
    // Built once; the <img> src is then driven each frame by the LOD manager.
    imgEl = document.createElement('div');
    imgEl.className = 'si-img';
    imgEl.style.position = 'absolute';
    imgEl.style.inset = '0';

    const innerImg = document.createElement('img');
    innerImg.className = 'si-img-inner';
    innerImg.draggable = false;
    innerImg.alt = '';
    innerImg.style.width = '100%';
    innerImg.style.height = '100%';
    innerImg.style.objectFit = 'contain';
    innerImg.style.display = 'block';

    imgEl.appendChild(innerImg);
    imageWrap.appendChild(imgEl);
  }
  setStyle(imageWrap, 'display', '');
}

function createTextBoxElement(idx) {
  const el = document.createElement('div');
  el._styleCache = {};
  el.className = 'entity entity-textbox';
  el.dataset.entityType = 'textBox';
  el.dataset.entityIdx = idx;
  el.innerHTML = '<div class="entity-textbox-titlebar"></div><div class="entity-textbox-content"></div>' + makeHandlesHtml();

  el._parts = {
    titlebar: el.querySelector('.entity-textbox-titlebar'),
    content: el.querySelector('.entity-textbox-content'),
  };
  for (const part of Object.values(el._parts)) part._styleCache = {};

  document.body.appendChild(el);
  return el;
}

function ensureTextBoxElement(idx) {
  const tb = state.textBoxes[idx];
  if (!tb) return null;

  const key = 't' + idx;
  let el = domByTypeIdx.textBox[key];
  if (!el) {
    el = createTextBoxElement(idx);
    domByTypeIdx.textBox[key] = el;
  }

  const baseColor = tb.color || '#1a1a1a';
  const hasTitle = !!tb.title && tb.title.length > 0;
  const scale = state.scale;
  const { titlebar, content } = el._parts;

  setStyle(el, 'background', baseColor);
  setStyle(el, 'borderColor', tb.borderColor || '#444');
  if (el._dividerFor !== baseColor) {
    el._dividerFor = baseColor;
    el.style.setProperty('--node-divider-color', getDividerColor(baseColor));
  }

  syncUnlockButton(el, !!tb.locked, state.textBoxes, tb.id);
  placeEntity(el, tb.x, tb.y, tb.w, tb.h);
  setStyle(el, 'transform', 'none');
  setStyle(el, 'borderWidth', (1.5 * scale) + 'px');
  setStyle(el, 'borderRadius', (6 * scale) + 'px');

  if (hasTitle) {
    const radius = 6 * scale;
    setStyle(titlebar, 'display', '');
    setStyle(titlebar, 'background', getDarkerColor(baseColor, 0.6));
    setStyle(titlebar, 'color', tb.titleColor || DEFAULT_TITLE_COLOR);
    setStyle(titlebar, 'lineHeight', '1.2');
    setStyle(titlebar, 'borderRadius', radius + 'px ' + radius + 'px 0 0');
    setStyle(titlebar, 'fontSize', (15 * scale) + 'px');
    setStyle(titlebar, 'padding', (4 * scale) + 'px ' + (8 * scale) + 'px');
    setStyle(titlebar, 'minHeight', ((15 * 1.2 * scale) + (4 * scale) + (4 * scale)) + 'px');

    // Re-parsing and rewriting the title markup on every frame would also
    // destroy any selection inside it, so it is rebuilt only when it changes.
    if (!isEditingEntity('textBox', idx, 'title') && titlebar._renderedTitle !== tb.title) {
      titlebar._renderedTitle = tb.title;
      titlebar.innerHTML = titleToHtml(tb.title);
    }
    setStyle(content, 'paddingTop', (4 * scale) + 'px');
  } else {
    setStyle(titlebar, 'display', 'none');
    titlebar._renderedTitle = undefined;
    setStyle(content, 'paddingTop', (8 * scale) + 'px');
  }

  setStyle(content, 'color', tb.textColor || DEFAULT_TEXT_COLOR);
  setStyle(content, 'fontSize', ((tb.fontSize || 14) * scale) + 'px');
  setStyle(content, 'paddingLeft', (8 * scale) + 'px');
  setStyle(content, 'paddingRight', (8 * scale) + 'px');
  setStyle(content, 'paddingBottom', (8 * scale) + 'px');
  setStyle(content, 'lineHeight', '1.25');
  setStyle(content, 'overflowY', 'hidden');

  if (!isEditingEntity('textBox', idx)) syncTextBoxContent(content, tb);

  return el;
}

/**
 * Keep the read-only Tiptap view in step with the entity's content.
 *
 * The content object is compared by identity and by the version counter that
 * edits bump, rather than by serialising it. The old code ran
 * JSON.stringify over every text box's document on every frame, which for a
 * board of any size was the single most expensive thing in the loop.
 */
function syncTextBoxContent(content, tb) {
  const tiptapContent = getOrCreateTiptapContent(tb);
  const version = tb._contentVersion || 0;
  const editor = content._tiptapEditor;

  if (!editor || editor.isDestroyed) {
    content._tiptapEditor = createEditor({
      element: content,
      content: tiptapContent,
      editable: false,
      excludeHistory: true,
    });
    content._tiptapEditor._renderedContent = tiptapContent;
    content._tiptapEditor._renderedVersion = version;
    return;
  }

  if (editor._renderedContent === tiptapContent && editor._renderedVersion === version) return;

  editor.commands.setContent(tiptapContent, { emitUpdate: false });
  editor._renderedContent = tiptapContent;
  editor._renderedVersion = version;
}

function applyDrawOrder(order) {
  for (let i = 0; i < order.length; i++) {
    const item = order[i];
    const el = item.type === 'shape'
      ? domByTypeIdx.shape['s' + item.i]
      : domByTypeIdx.textBox['t' + item.i];
    if (el) setStyle(el, 'zIndex', String(2 + i * 2));
  }
  state.arrowCanvas.style.zIndex = 2 + (order.length + 1) * 2;
}

function applySelectionClasses() {
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

/**
 * Elements are keyed by array position, so the ones past the end of a shrunken
 * array are the stale ones. Comparing against the length directly avoids
 * building a set of live keys on every frame.
 */
function cleanupStaleElements() {
  for (const key in domByTypeIdx.shape) {
    if (Number(key.slice(1)) < state.shapes.length) continue;
    domByTypeIdx.shape[key].remove();
    delete domByTypeIdx.shape[key];
  }

  for (const key in domByTypeIdx.textBox) {
    if (Number(key.slice(1)) < state.textBoxes.length) continue;
    destroyTextBoxElement(domByTypeIdx.textBox[key]);
    delete domByTypeIdx.textBox[key];
  }
}

function destroyTextBoxElement(el) {
  const content = el._parts?.content || el.querySelector('.entity-textbox-content');
  if (content?._tiptapEditor && !content._tiptapEditor.isDestroyed) {
    content._tiptapEditor.destroy();
    content._tiptapEditor = null;
  }
  el.remove();
}

/** Stable key for the current selection, used to skip redundant class updates. */
function selectionKey() {
  if (state.selectedShapes.size === 0 && state.selectedTextBoxes.size === 0) return '|';
  return [...state.selectedShapes].sort((a, b) => a - b).join(',') + '|'
    + [...state.selectedTextBoxes].sort((a, b) => a - b).join(',');
}

export function syncAllEntities() {
  measureCanvas();
  cleanupStaleElements();

  for (let i = 0; i < state.shapes.length; i++) ensureShapeElement(i);
  for (let i = 0; i < state.textBoxes.length; i++) ensureTextBoxElement(i);

  // getAllDrawOrder returns a cached array, so a new reference means the order
  // was actually recomputed — no key string needed to detect the change.
  const order = state.getAllDrawOrder();
  if (order !== prevDrawOrder) {
    applyDrawOrder(order);
    prevDrawOrder = order;
  }

  const selKey = selectionKey();
  if (selKey !== prevSelectionKey) {
    applySelectionClasses();
    prevSelectionKey = selKey;
  }
}
