import { state } from './state.js';

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
    };
    img.onerror = () => {
      entry.lods = [imageSrc];
      entry.loading = false;
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

    const currentShapeIds = new Set();

    for (let i = 0; i < shapes.length; i++) {
      const shape = shapes[i];
      if (!shape || !shape.image) continue;

      const shapeId = shape.id;
      currentShapeIds.add(shapeId);

      const imgData = shape.image;
      const prevState = this._shapeState.get(shapeId);

      if (prevState && prevState.imageId !== imgData.id) {
        this._clearDomSrc(shapeId);
        this._shapeState.delete(shapeId);
      }

      if (!this._cache.has(imgData.id)) {
        this.generateLODs(imgData.id, imgData.src);
      }

      const visible = this._isInViewport(shape, offsetX, offsetY, scale, canvasCssW, canvasCssH);
      const screenWidth = shape.w * scale;
      let targetSrc = null;
      let targetLevel = -1;

      const lod = visible
        ? this._getLOD(imgData.id, screenWidth)
        : this._getLOD(imgData.id, 0);
      if (lod) { targetSrc = lod.src; targetLevel = lod.level; }

      if (targetSrc) {
        this._shapeState.set(shapeId, { level: targetLevel, src: targetSrc, imageId: imgData.id });
        this._applyToDom(shapeId, targetSrc, targetLevel, visible);
      }
    }

    for (const [shapeId] of this._shapeState) {
      if (!currentShapeIds.has(shapeId)) {
        this._shapeState.delete(shapeId);
      }
    }

    const staleCacheKeys = [];
    for (const key of this._cache.keys()) {
      let found = false;
      for (const shape of shapes) {
        if (shape.image && shape.image.id === key) { found = true; break; }
      }
      if (!found) staleCacheKeys.push(key);
    }
    for (const key of staleCacheKeys) {
      this._cache.delete(key);
    }
  }

  _clearDomSrc(shapeId) {
    const el = document.querySelector(`[data-entity-type="shape"][data-entity-id="${shapeId}"]`);
    if (!el) return;
    const innerImg = el.querySelector('.si-img-inner');
    if (innerImg) innerImg.removeAttribute('src');
  }

  _applyToDom(shapeId, src, level, visible) {
    const el = document.querySelector(`[data-entity-type="shape"][data-entity-id="${shapeId}"]`);
    if (!el) return;

    const imageWrap = el.querySelector('.entity-shape-image-wrap');
    if (!imageWrap) return;

    const innerImg = imageWrap.querySelector('.si-img-inner');
    if (!innerImg) return;

    if (innerImg.src !== src) {
      innerImg.src = src;
    }

    imageWrap.dataset.lod = level >= 0 && LOD_CONFIG[level] ? LOD_CONFIG[level].label || 'original' : 'original';
    imageWrap.dataset.lodLevel = level;
    imageWrap.dataset.lodVisible = visible ? '1' : '0';
  }
}

export const imageLOD = new ImageLODManager();
