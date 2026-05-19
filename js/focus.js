import { state } from './state.js';
import { GRID } from './config.js';

function extendBounds(minX, minY, maxX, maxY, ex, ey, ew, eh) {
  return {
    minX: Math.min(minX, ex),
    minY: Math.min(minY, ey),
    maxX: Math.max(maxX, ex + (ew || 0)),
    maxY: Math.max(maxY, ey + (eh || 0)),
  };
}

function getSelectedBounds() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let hasAny = false;

  for (const idx of state.selectedShapes) {
    const s = state.shapes[idx];
    if (!s) continue;
    ({ minX, minY, maxX, maxY } = extendBounds(minX, minY, maxX, maxY, s.x, s.y, s.w, s.h));
    hasAny = true;
  }

  for (const idx of state.selectedTextBoxes) {
    const t = state.textBoxes[idx];
    if (!t) continue;
    ({ minX, minY, maxX, maxY } = extendBounds(minX, minY, maxX, maxY, t.x, t.y, t.w, t.h));
    hasAny = true;
  }

  for (const idx of state.selectedConnectors) {
    const c = state.connectors[idx];
    if (!c) continue;
    ({ minX, minY, maxX, maxY } = extendBounds(minX, minY, maxX, maxY, c.x1, c.y1));
    ({ minX, minY, maxX, maxY } = extendBounds(minX, minY, maxX, maxY, c.x2, c.y2));
    hasAny = true;
  }

  for (const idx of state.selectedArrows) {
    const a = state.arrows[idx];
    if (!a) continue;
    ({ minX, minY, maxX, maxY } = extendBounds(minX, minY, maxX, maxY, a.x1, a.y1));
    ({ minX, minY, maxX, maxY } = extendBounds(minX, minY, maxX, maxY, a.x2, a.y2));
    hasAny = true;
  }

  if (!hasAny) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function getAllBounds() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (let i = 0; i < state.shapes.length; i++) {
    const s = state.shapes[i];
    ({ minX, minY, maxX, maxY } = extendBounds(minX, minY, maxX, maxY, s.x, s.y, s.w, s.h));
  }

  for (let i = 0; i < state.textBoxes.length; i++) {
    const t = state.textBoxes[i];
    ({ minX, minY, maxX, maxY } = extendBounds(minX, minY, maxX, maxY, t.x, t.y, t.w, t.h));
  }

  for (let i = 0; i < state.connectors.length; i++) {
    const c = state.connectors[i];
    ({ minX, minY, maxX, maxY } = extendBounds(minX, minY, maxX, maxY, c.x1, c.y1));
    ({ minX, minY, maxX, maxY } = extendBounds(minX, minY, maxX, maxY, c.x2, c.y2));
  }

  for (let i = 0; i < state.arrows.length; i++) {
    const a = state.arrows[i];
    ({ minX, minY, maxX, maxY } = extendBounds(minX, minY, maxX, maxY, a.x1, a.y1));
    ({ minX, minY, maxX, maxY } = extendBounds(minX, minY, maxX, maxY, a.x2, a.y2));
  }

  if (minX === Infinity) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function zoomToBounds(bounds) {
  const canvas = state.canvas;
  const rect = canvas.getBoundingClientRect();
  const cw = rect.width;
  const ch = rect.height;

  const padding = bounds.w === 0 && bounds.h === 0
    ? 100
    : Math.max(50, Math.min(bounds.w, bounds.h) * 0.5);

  const paddedW = bounds.w + padding * 2;
  const paddedH = bounds.h + padding * 2;

  let targetScale = Math.min(cw / paddedW, ch / paddedH);
  targetScale = Math.max(GRID.minScale, Math.min(GRID.maxScale, targetScale));

  const centerX = bounds.x + bounds.w / 2;
  const centerY = bounds.y + bounds.h / 2;

  state.targetOffsetX = cw / 2 - centerX * targetScale;
  state.targetOffsetY = ch / 2 - centerY * targetScale;
  state.targetScale = targetScale;
}

export function focusOnSelected() {
  const bounds = getSelectedBounds();
  if (!bounds) return;
  zoomToBounds(bounds);
}

export function focusOnAll() {
  const bounds = getAllBounds();
  if (!bounds) return;
  zoomToBounds(bounds);
}
