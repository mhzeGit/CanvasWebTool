import { state } from './state.js';
import { GRID } from './config.js';
import { commitEditing } from './inline-editing.js';

export function setupZoomPan() {
  state.canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (state.editingState) {
      commitEditing();
    }

    if (e.ctrlKey || e.metaKey) {
      const zoomDir = e.deltaY < 0 ? 1 : -1;
      const zoomFactor = Math.pow(GRID.zoomFactor, zoomDir);
      const newScale = state.targetScale * zoomFactor;

      if (newScale < GRID.minScale || newScale > GRID.maxScale) return;

      const rect = state.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      state.targetOffsetX -= (mouseX - state.targetOffsetX) * (zoomFactor - 1);
      state.targetOffsetY -= (mouseY - state.targetOffsetY) * (zoomFactor - 1);

      state.targetScale = newScale;
    } else {
      let panX = e.deltaX;
      let panY = e.deltaY;
      if (e.deltaMode === 1) {
        panX *= 40;
        panY *= 40;
      } else if (e.deltaMode === 2) {
        panX *= state.canvas.clientWidth;
        panY *= state.canvas.clientHeight;
      }
      state.targetOffsetX -= panX;
      state.targetOffsetY -= panY;
    }
  }, { passive: false });
}
