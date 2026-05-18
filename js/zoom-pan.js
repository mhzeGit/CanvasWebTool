import { state } from './state.js';
import { GRID, TOUCHPAD_ZOOM_FACTOR } from './config.js';
import { commitEditing } from './inline-editing.js';

const TOUCHPAD_DELTA_THRESHOLD = 30;

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

function _zoom(e, factor) {
  const zoomDir = e.deltaY < 0 ? 1 : -1;
  const zoomFactor = Math.pow(factor, zoomDir);
  const newScale = state.targetScale * zoomFactor;

  if (newScale < GRID.minScale || newScale > GRID.maxScale) return;

  const rect = state.canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  state.targetOffsetX -= (mouseX - state.targetOffsetX) * (zoomFactor - 1);
  state.targetOffsetY -= (mouseY - state.targetOffsetY) * (zoomFactor - 1);

  state.targetScale = newScale;
}

export function setupZoomPan() {
  state.canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (state.editingState) {
      commitEditing();
    }

    if (e.ctrlKey || e.metaKey) {
      const factor = (e.deltaMode === 0) ? TOUCHPAD_ZOOM_FACTOR : GRID.zoomFactor;
      _zoom(e, factor);
      return;
    }

    if (e.deltaMode === 1 || Math.abs(e.deltaY) > TOUCHPAD_DELTA_THRESHOLD) {
      _zoom(e, GRID.zoomFactor);
      return;
    }

    _wheelAccX += e.deltaX;
    _wheelAccY += e.deltaY;
    state.isSelectingBox = false;
    if (!_wheelAccPending) {
      _wheelAccPending = true;
      requestAnimationFrame(_flushWheelAcc);
    }
  }, { passive: false });
}
