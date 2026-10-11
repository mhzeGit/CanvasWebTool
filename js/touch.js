import { state } from './state.js';
import { GRID } from './config.js';
import { openContextMenu, closeContextMenu } from './context-menu.js';

let _touchActionHandler = null;

const TAP_MAX_MS = 300;
const TAP_MAX_MOVE = 10;

export function initTouch(ontouchaction) {
  _touchActionHandler = ontouchaction;
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
    state.touchTapData = {
      clientX: e.clientX,
      clientY: e.clientY,
      time: e.timeStamp,
      moved: false,
    };
    state.isTwoFingerGesture = false;
    return false;
  }

  if (count === 2) {
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
    }
  }

  if (!state.isTwoFingerGesture) return false;

  if (state.touchPointers.size >= 2) {
    const mid = getTouchMidpoint();
    const dist = getTouchDistance();

    const panDx = mid.x - state.twoFingerMidX;
    const panDy = mid.y - state.twoFingerMidY;

    state.targetOffsetX = state.twoFingerStartOffsetX + panDx;
    state.targetOffsetY = state.twoFingerStartOffsetY + panDy;

    if (state.twoFingerStartDist > 10 && dist > 10) {
      const ratio = dist / state.twoFingerStartDist;
      let newScale = state.twoFingerStartScale * ratio;
      newScale = Math.max(GRID.minScale, Math.min(GRID.maxScale, newScale));

      const scaleFactor = newScale / state.twoFingerStartScale;

      const rect = state.canvas.getBoundingClientRect();
      const focusSx = mid.x - rect.left;
      const focusSy = mid.y - rect.top;

      const offsetAdjustX = (focusSx - state.twoFingerStartOffsetX) * (scaleFactor - 1);
      const offsetAdjustY = (focusSy - state.twoFingerStartOffsetY) * (scaleFactor - 1);

      state.targetOffsetX = state.twoFingerStartOffsetX + panDx - offsetAdjustX;
      state.targetOffsetY = state.twoFingerStartOffsetY + panDy - offsetAdjustY;
      state.targetScale = newScale;

      state.twoFingerMidX = mid.x;
      state.twoFingerMidY = mid.y;
      state.twoFingerStartDist = dist;
      state.twoFingerStartScale = newScale;
      state.twoFingerStartOffsetX = state.targetOffsetX;
      state.twoFingerStartOffsetY = state.targetOffsetY;
    } else {
      state.twoFingerMidX = mid.x;
      state.twoFingerMidY = mid.y;
    }
  }

  return true;
}

export function handleTouchUp(e) {
  if (e.pointerType !== 'touch') return false;

  state.touchPointers.delete(e.pointerId);

  if (state.isTwoFingerGesture && state.touchPointers.size < 2) {
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

  if (state.touchTapData && !state.touchTapData.moved &&
    (e.timeStamp - state.touchTapData.time) < TAP_MAX_MS) {
    const td = state.touchTapData;
    state.touchTapData = null;
    triggerTouchContextMenu(td.clientX, td.clientY);
    return true;
  }

  state.touchTapData = null;
  return false;
}

export function handleTouchCancel(e) {
  if (e.pointerType !== 'touch') return false;
  state.touchPointers.delete(e.pointerId);

  if (state.touchPointers.size < 2) {
    state.isTwoFingerGesture = false;
  }
  state.touchTapData = null;
  return true;
}

function triggerTouchContextMenu(clientX, clientY) {
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
}

function _resetDrawingState() {
  state.drawingTool = null;
  state.drawingShapeType = null;
  state.drawingStartX = 0;
  state.drawingStartY = 0;
  state.drawingStartConnected = null;
  state.isResizingShape = false;
  state.isResizingTextBox = false;
  state.isResizingImageContainer = false;
  state.isResizingImageItem = false;
  state.isDraggingNode = false;
  state.isDraggingShape = false;
  state.isDraggingTextBox = false;
  state.isDraggingImageContainer = false;
  state.isDraggingImageItem = false;
  state.isDraggingArrowBody = false;
  state.isDraggingConnectorBody = false;
  state.isDraggingArrowEnd = false;
  state.isSelectingBox = false;
  state.pendingClickIndex = -1;
  state.didDragSincePointerDown = false;
}
