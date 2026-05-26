import { state } from './state.js';

const LOD_CONFIG = [
  { level: 0, threshold: 600, maxDim: null },
  { level: 1, threshold: 250, maxDim: 800 },
  { level: 2, threshold: 100, maxDim: 320 },
  { level: 3, threshold: 40,  maxDim: 120 },
  { level: 4, threshold: 0,   maxDim: 48 },
];

const CULL_MARGIN_WORLD = 400;

class ImageLODManager {
  constructor() {
    this._cache = new Map();
    this._shapeState = new Map();
    this._canvas = null;
    this._ctx = null;
    this._initialized = false;
  }

  init() {
    if (this._initialized) return;
    this._canvas = document.createElement('canvas');
    this._ctx = this._canvas.getContext('2d');
    this._initialized = true;
  }

  generateLODs(imageId, imageSrc) {
    if (!this._initialized || this._cache.has(imageId)) return;

    const entry = { lods: [], loading: true, src: imageSrc };
    this._cache.set(imageId, entry);

    const img = new Image();
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
          this._canvas.width = w;
          this._canvas.height = h;
          this._ctx.drawImage(img, 0, 0, w, h);
          entry.lods.push(this._canvas.toDataURL());
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
    if (!entry || entry.loading) return null;

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
  }

  update() {
    if (!this._initialized) return;

    const { shapes, offsetX, offsetY, scale } = state;
    const dpr = window.devicePixelRatio || 1;
    const canvasCssW = state.canvas.width / dpr;
    const canvasCssH = state.canvas.height / dpr;
    const activeImageIds = new Set();

    for (let i = 0; i < shapes.length; i++) {
      const shape = shapes[i];
      if (!shape || !shape.image) continue;

      const imgData = shape.image;
      activeImageIds.add(imgData.id);

      if (!this._cache.has(imgData.id)) {
        this.generateLODs(imgData.id, imgData.src);
      }

      const visible = this._isInViewport(shape, offsetX, offsetY, scale, canvasCssW, canvasCssH);
      const screenWidth = shape.w * scale;
      let targetSrc = null;
      let targetLevel = -1;

      if (visible) {
        const lod = this._getLOD(imgData.id, screenWidth);
        if (lod) { targetSrc = lod.src; targetLevel = lod.level; }
      } else {
        const lod = this._getLOD(imgData.id, 0);
        if (lod) { targetSrc = lod.src; targetLevel = lod.level; }
      }

      if (targetLevel === -1) continue;

      const prev = this._shapeState.get(i);
      if (prev && prev.level === targetLevel && prev.src === targetSrc) continue;

      this._shapeState.set(i, { level: targetLevel, src: targetSrc });
      this._applyToDom(i, targetSrc, targetLevel, visible);
    }

    for (const key of this._shapeState.keys()) {
      const shape = shapes[key];
      if (!shape || !shape.image || !activeImageIds.has(shape.image.id)) {
        this._shapeState.delete(key);
      }
    }

    for (const key of this._cache.keys()) {
      let found = false;
      for (const shape of shapes) {
        if (shape.image && shape.image.id === key) { found = true; break; }
      }
      if (!found) this._cache.delete(key);
    }
  }

  _applyToDom(shapeIdx, src, level, visible) {
    const el = document.querySelector(`[data-entity-type="shape"][data-entity-idx="${shapeIdx}"]`);
    if (!el) return;

    const imageWrap = el.querySelector('.entity-shape-image-wrap');
    if (!imageWrap) return;

    const innerImg = imageWrap.querySelector('.si-img-inner');
    if (!innerImg) return;

    if (innerImg.src !== src) {
      innerImg.src = src;
    }

    const lodLabel = LOD_CONFIG[level] ? LOD_CONFIG[level].label : 'unknown';
    imageWrap.dataset.lod = lodLabel;
    imageWrap.dataset.lodLevel = level;
    imageWrap.dataset.lodVisible = visible ? '1' : '0';
  }
}

export const imageLOD = new ImageLODManager();
