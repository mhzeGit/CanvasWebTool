import { state } from './state.js';
import { getEntityElement } from './dom-entities.js';
import { requestRender } from './render-scheduler.js';

const LOD_CONFIG = [
  { level: 0, threshold: 600, maxDim: null },
  { level: 1, threshold: 250, maxDim: 800 },
  { level: 2, threshold: 100, maxDim: 320 },
  { level: 3, threshold: 40,  maxDim: 120 },
  { level: 4, threshold: 0,   maxDim: 48 },
];

const CULL_MARGIN_WORLD = 400;

function createDownscaleCanvas() {
  const c = document.createElement('canvas');
  return { canvas: c, ctx: c.getContext('2d') };
}

class ImageLODManager {
  constructor() {
    this._cache = new Map();
    this._shapeState = new Map();
    this._initialized = false;
  }

  init() {
    if (this._initialized) return;
    this._initialized = true;
  }

  generateLODs(imageId, imageSrc) {
    if (!this._initialized) return;

    if (this._cache.has(imageId)) {
      const existing = this._cache.get(imageId);
      if (existing.loading) return;
      this._cache.delete(imageId);
    }

    const entry = { lods: [], loading: true, src: imageSrc };
    this._cache.set(imageId, entry);

    const img = new Image();
    const downscale = createDownscaleCanvas();
    img.onload = () => {
      const srcW = img.naturalWidth;
      const srcH = img.naturalHeight;

      for (const lod of LOD_CONFIG) {
        if (lod.maxDim === null) {
          entry.lods.push(imageSrc);
        } else if (srcW <= lod.maxDim && srcH <= lod.maxDim) {
          entry.lods.push(imageSrc);
        } else {
          const scale = lod.maxDim / Math.max(srcW, srcH);
          const w = Math.max(1, Math.round(srcW * scale));
          const h = Math.max(1, Math.round(srcH * scale));
          downscale.canvas.width = w;
          downscale.canvas.height = h;
          downscale.ctx.drawImage(img, 0, 0, w, h);
          entry.lods.push(downscale.canvas.toDataURL());
        }
      }
      entry.loading = false;
      // Decoding and downscaling finish asynchronously, with no user input to
      // trigger the next frame, so ask for one explicitly.
      requestRender(2);
    };
    img.onerror = () => {
      entry.lods = [imageSrc];
      entry.loading = false;
      requestRender(2);
    };
    img.src = imageSrc;
  }

  _getLOD(imageId, screenWidth) {
    const entry = this._cache.get(imageId);
    if (!entry) return null;

    if (entry.loading) {
      return { src: entry.src, level: -1 };
    }

    for (let i = 0; i < LOD_CONFIG.length; i++) {
      if (screenWidth >= LOD_CONFIG[i].threshold) {
        return { src: entry.lods[i] || entry.lods[entry.lods.length - 1], level: i };
      }
    }
    const last = entry.lods.length - 1;
    return { src: entry.lods[last], level: last };
  }

  _isInViewport(shape, offsetX, offsetY, scale, canvasCssW, canvasCssH) {
    const m = CULL_MARGIN_WORLD;
    const vLeft = -offsetX / scale - m;
    const vTop = -offsetY / scale - m;
    const vRight = (-offsetX + canvasCssW) / scale + m;
    const vBottom = (-offsetY + canvasCssH) / scale + m;
    return !(shape.x + shape.w < vLeft || shape.x > vRight || shape.y + shape.h < vTop || shape.y > vBottom);
  }

  removeImage(imageId) {
    this._cache.delete(imageId);
    for (const [shapeId, st] of this._shapeState) {
      if (st.imageId === imageId) {
        this._shapeState.delete(shapeId);
      }
    }
  }

  update() {
    if (!this._initialized) return;

    const { shapes, offsetX, offsetY, scale } = state;
    const dpr = window.devicePixelRatio || 1;
    const canvasCssW = state.canvas.width / dpr;
    const canvasCssH = state.canvas.height / dpr;

    const liveShapeIds = new Set();
    const liveImageIds = new Set();

    for (let i = 0; i < shapes.length; i++) {
      const shape = shapes[i];
      const imgData = shape?.image;
      if (!imgData) continue;

      liveShapeIds.add(shape.id);
      liveImageIds.add(imgData.id);

      // The element is looked up by array position rather than with an
      // attribute selector, which used to run a document-wide query for every
      // image on every frame.
      const el = getEntityElement('shape', i);

      const previous = this._shapeState.get(shape.id);
      if (previous && previous.imageId !== imgData.id) {
        clearImageSrc(el);
        this._shapeState.delete(shape.id);
      }

      if (!this._cache.has(imgData.id)) this.generateLODs(imgData.id, imgData.src);

      const visible = this._isInViewport(shape, offsetX, offsetY, scale, canvasCssW, canvasCssH);
      // Off-screen images drop to the smallest level so panning stays cheap.
      const lod = this._getLOD(imgData.id, visible ? shape.w * scale : 0);
      if (!lod) continue;

      this._shapeState.set(shape.id, { level: lod.level, src: lod.src, imageId: imgData.id });
      applyImageSrc(el, lod.src, lod.level, visible);
    }

    for (const shapeId of this._shapeState.keys()) {
      if (!liveShapeIds.has(shapeId)) this._shapeState.delete(shapeId);
    }
    for (const imageId of this._cache.keys()) {
      if (!liveImageIds.has(imageId)) this._cache.delete(imageId);
    }
  }
}

/** The <img> inside a shape element, or null if it has no image layer yet. */
function imageElement(el) {
  return el ? el.querySelector('.si-img-inner') : null;
}

function clearImageSrc(el) {
  const img = imageElement(el);
  if (!img) return;
  img.removeAttribute('src');
  img._appliedSrc = null;
}

/**
 * Point the <img> at the chosen level. The last applied value is remembered on
 * the element: comparing against `img.src` would compare the whole data URL
 * string — often megabytes — on every frame.
 */
function applyImageSrc(el, src, level, visible) {
  const img = imageElement(el);
  if (!img) return;

  if (img._appliedSrc !== src) {
    img._appliedSrc = src;
    img.src = src;
  }

  // Diagnostics: makes the chosen level and cull state visible in devtools.
  const wrap = el._parts?.imageWrap;
  if (!wrap) return;
  const lodLevel = String(level);
  const lodVisible = visible ? '1' : '0';
  if (wrap.dataset.lodLevel !== lodLevel) wrap.dataset.lodLevel = lodLevel;
  if (wrap.dataset.lodVisible !== lodVisible) wrap.dataset.lodVisible = lodVisible;
}

export const imageLOD = new ImageLODManager();
