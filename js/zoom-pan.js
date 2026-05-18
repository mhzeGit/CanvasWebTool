import { state } from './state.js';
import { GRID, TOUCHPAD_ZOOM_FACTOR } from './config.js';
import { commitEditing } from './inline-editing.js';

let _wheelAccX = 0;
let _wheelAccY = 0;
let _wheelAccPending = false;

function _flushWheelAcc() {
  if (_wheelAccX !== 0 || _wheelAccY !== 0) {
    state.targetOffsetX -= _wheelAccX;
    state.targetOffsetY -= _wheelAccY;
    _wheelAccX = 0;
    _wheelAccY = 0;
  }
  _wheelAccPending = false;
}

export function setupZoomPan() {
  state.canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (state.editingState) {
      commitEditing();
    }

    if (e.ctrlKey || e.metaKey) {
      const zoomDir = e.deltaY < 0 ? 1 : -1;
      const factor = (e.deltaMode === 0) ? TOUCHPAD_ZOOM_FACTOR : GRID.zoomFactor;
      const zoomFactor = Math.pow(factor, zoomDir);
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
      _wheelAccX += panX;
      _wheelAccY += panY;
      state.isSelectingBox = false;
      if (!_wheelAccPending) {
        _wheelAccPending = true;
        requestAnimationFrame(_flushWheelAcc);
      }
    }
  }, { passive: false });
}
