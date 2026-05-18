import { state } from './state.js';
import { GRID, TOUCH_ZOOM_DAMPENING } from './config.js';
import { openContextMenu, closeContextMenu } from './context-menu.js';

let _touchActionHandler = null;

const TAP_MAX_MS = 300;
const LONG_PRESS_MS = 500;
const TAP_MAX_MOVE = 10;
const DOUBLE_TAP_MAX_MS = 300;
const DOUBLE_TAP_MAX_MOVE = 30;

let _longPressTimer = null;
let _longPressTriggered = false;

let _lastTapTime = null;
let _lastTapX = 0;
let _lastTapY = 0;

export function initTouch(ontouchaction) {
  _touchActionHandler = ontouchaction;
}

function _clearLongPress() {
  if (_longPressTimer !== null) {
    clearTimeout(_longPressTimer);
    _longPressTimer = null;
  }
}

function _startLongPressTimer(clientX, clientY) {
  _clearLongPress();
  _longPressTriggered = false;
  _longPressTimer = setTimeout(() => {
    _longPressTimer = null;
    _longPressTriggered = true;
    _lastTapTime = null;
    closeContextMenu();
    const rect = state.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    if (sx >= 0 && sx <= rect.width && sy >= 0 && sy <= rect.height) {
      state.rmbPending = true;
      state.rmbDownTime = performance.now();
      state.rmbMoved = false;
      const evt = { clientX, clientY, preventDefault: () => {} };
      openContextMenu(evt);
    }
  }, LONG_PRESS_MS);
}

export function isTouchActive() {
  return state.touchPointers.size > 0;
}

export function isTwoFingerActive() {
  return state.isTwoFingerGesture;
}

function getTouchMidpoint() {
  const pts = Array.from(state.touchPointers.values());
  if (pts.length < 2) return { x: 0, y: 0 };
  const a = pts[0];
  const b = pts[1];
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
  };
}

function getTouchDistance() {
  const pts = Array.from(state.touchPointers.values());
  if (pts.length < 2) return 0;
  const a = pts[0];
  const b = pts[1];
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

export function handleTouchDown(e) {
  if (e.pointerType !== 'touch') return false;

  state.touchPointers.set(e.pointerId, {
    clientX: e.clientX,
    clientY: e.clientY,
    startX: e.clientX,
    startY: e.clientY,
    time: e.timeStamp,
  });

  const count = state.touchPointers.size;

  if (count === 1) {
    state.isTouchPanning = false;
    state.touchTapData = {
      clientX: e.clientX,
      clientY: e.clientY,
      time: e.timeStamp,
      moved: false,
    };
    state.isTwoFingerGesture = false;
    _startLongPressTimer(e.clientX, e.clientY);
    return false;
  }

  if (count === 2) {
    _clearLongPress();
    _longPressTriggered = false;
    _lastTapTime = null;
    state.isTwoFingerGesture = true;
    state.touchTapData = null;
    state.isPanning = false;
    state.isSelectingBox = false;

    const mid = getTouchMidpoint();
    const dist = getTouchDistance();

    state.twoFingerMidX = mid.x;
    state.twoFingerMidY = mid.y;
    state.twoFingerStartDist = dist;
    state.twoFingerStartScale = state.targetScale;
    state.twoFingerStartOffsetX = state.targetOffsetX;
    state.twoFingerStartOffsetY = state.targetOffsetY;

    state.twoFingerInitMidX = mid.x;
    state.twoFingerInitMidY = mid.y;
    state.twoFingerInitDist = dist;
    state.twoFingerInitScale = state.targetScale;
    state.twoFingerInitOffsetX = state.targetOffsetX;
    state.twoFingerInitOffsetY = state.targetOffsetY;

    _resetDrawingState();
    return true;
  }

  if (count > 2) {
    return true;
  }

  return false;
}

export function handleTouchMove(e) {
  if (e.pointerType !== 'touch') return false;

  const ptr = state.touchPointers.get(e.pointerId);
  if (ptr) {
    ptr.clientX = e.clientX;
    ptr.clientY = e.clientY;
    if (Math.abs(e.clientX - ptr.startX) > TAP_MAX_MOVE ||
      Math.abs(e.clientY - ptr.startY) > TAP_MAX_MOVE) {
      if (state.touchTapData) {
        state.touchTapData.moved = true;
      }
      _lastTapTime = null;
      _clearLongPress();
    }
  }

  if (!state.isTwoFingerGesture) {
    const movedPastTap = ptr && (Math.abs(e.clientX - ptr.startX) > TAP_MAX_MOVE ||
      Math.abs(e.clientY - ptr.startY) > TAP_MAX_MOVE);

    if (state.isTouchPanning) {
      const dx = e.clientX - state.touchPanLastX;
      const dy = e.clientY - state.touchPanLastY;
      state.touchPanLastX = e.clientX;
      state.touchPanLastY = e.clientY;
      state.targetOffsetX += dx;
      state.targetOffsetY += dy;
      return true;
    }

    if (movedPastTap && state.isSelectingBox) {
      state.isSelectingBox = false;
      state.isTouchPanning = true;
      state.touchPanLastX = e.clientX;
      state.touchPanLastY = e.clientY;
      _lastTapTime = null;
      state.touchTapData = null;
      return true;
    }

    return false;
  }

  if (state.touchPointers.size >= 2) {
    const mid = getTouchMidpoint();
    const dist = getTouchDistance();

    const panDx = mid.x - state.twoFingerInitMidX;
    const panDy = mid.y - state.twoFingerInitMidY;

    state.targetOffsetX = state.twoFingerInitOffsetX + panDx;
    state.targetOffsetY = state.twoFingerInitOffsetY + panDy;

    const ZOOM_DEAD_ZONE = 0.025;
    const distRatio = dist / state.twoFingerInitDist;

    if (state.twoFingerInitDist > 10 && dist > 10 &&
        Math.abs(distRatio - 1) > ZOOM_DEAD_ZONE) {
      const dampedRatio = 1 + (distRatio - 1) * TOUCH_ZOOM_DAMPENING;
      let newScale = state.twoFingerInitScale * dampedRatio;
      newScale = Math.max(GRID.minScale, Math.min(GRID.maxScale, newScale));

      const factor = newScale / state.twoFingerInitScale;

      const rect = state.canvas.getBoundingClientRect();
      const focusSx = mid.x - rect.left;
      const focusSy = mid.y - rect.top;

      state.targetOffsetX = factor * state.twoFingerInitOffsetX + factor * panDx + focusSx * (1 - factor);
      state.targetOffsetY = factor * state.twoFingerInitOffsetY + factor * panDy + focusSy * (1 - factor);
      state.targetScale = newScale;
    }

    state.twoFingerMidX = mid.x;
    state.twoFingerMidY = mid.y;
  }

  return true;
}

export function handleTouchUp(e) {
  if (e.pointerType !== 'touch') return false;

  state.touchPointers.delete(e.pointerId);

  if (state.isTouchPanning) {
    state.isTouchPanning = false;
    _clearLongPress();
    state.touchTapData = null;
    _lastTapTime = null;
    state.isSelectingBox = false;
    return true;
  }

  if (state.isTwoFingerGesture && state.touchPointers.size < 2) {
    _clearLongPress();
    state.isTwoFingerGesture = false;

    if (state.touchPointers.size === 1) {
      const remaining = state.touchPointers.values().next().value;
      if (remaining) {
        remaining.startX = remaining.clientX;
        remaining.startY = remaining.clientY;
        state.touchTapData = {
          clientX: remaining.clientX,
          clientY: remaining.clientY,
          time: performance.now(),
          moved: false,
        };
      }
    }
    return true;
  }

  if (_longPressTriggered) {
    _clearLongPress();
    state.touchTapData = null;
    return true;
  }

  _clearLongPress();

  if (state.touchTapData && !state.touchTapData.moved &&
    (e.timeStamp - state.touchTapData.time) < TAP_MAX_MS) {
    if (_lastTapTime !== null &&
        (e.timeStamp - _lastTapTime) < DOUBLE_TAP_MAX_MS &&
        Math.abs(e.clientX - _lastTapX) < DOUBLE_TAP_MAX_MOVE &&
        Math.abs(e.clientY - _lastTapY) < DOUBLE_TAP_MAX_MOVE) {
      _lastTapTime = null;
      state.touchTapData = null;
      state.canvas.dispatchEvent(new MouseEvent('dblclick', {
        clientX: e.clientX,
        clientY: e.clientY,
        bubbles: true,
        cancelable: true,
      }));
      return true;
    }
    _lastTapTime = e.timeStamp;
    _lastTapX = e.clientX;
    _lastTapY = e.clientY;
    state.touchTapData = null;
    return false;
  }

  state.touchTapData = null;
  return false;
}

export function handleTouchCancel(e) {
  if (e.pointerType !== 'touch') return false;
  _clearLongPress();
  state.touchPointers.delete(e.pointerId);

  if (state.touchPointers.size < 2) {
    state.isTwoFingerGesture = false;
  }
  state.isTouchPanning = false;
  state.touchTapData = null;
  _longPressTriggered = false;
  _lastTapTime = null;
  return true;
}

function _resetDrawingState() {
  state.drawingTool = null;
  state.drawingShapeType = null;
  state.drawingStartX = 0;
  state.drawingStartY = 0;
  state.drawingStartConnected = null;
  state.isResizingShape = false;
  state.isResizingTextBox = false;
  state.isDraggingNode = false;
  state.isDraggingShape = false;
  state.isDraggingTextBox = false;
  state.isDraggingArrowBody = false;
  state.isDraggingConnectorBody = false;
  state.isDraggingArrowEnd = false;
  state.isSelectingBox = false;
  state.isTouchPanning = false;
  state.pendingClickIndex = -1;
  state.didDragSincePointerDown = false;
}
