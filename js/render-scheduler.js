/**
 * Decides which animation frames actually need to draw.
 *
 * The app used to redraw both canvases, re-place every DOM entity and re-run
 * the image-LOD pass on every single frame, whether or not anything had
 * changed — so an idle window still burned a full core's worth of work at the
 * display's refresh rate. Nothing in this app animates on its own: the picture
 * only changes in response to input, to the viewport easing towards its target,
 * or to an async load finishing. This module tracks exactly those three things.
 *
 * The output is pixel-for-pixel the same; frames that would have redrawn an
 * identical picture are simply skipped.
 */

import { GRID } from './config.js';

/** Frames still owed. More than one so a change that settles over a couple of
 *  frames (layout, focus, an editor committing) is not missed. */
let pendingFrames = 0;

/** Below this the viewport lerp is visually finished and can be snapped. */
const VIEWPORT_EPSILON = 0.01;
const SCALE_EPSILON = 0.00001;

/**
 * Backstop: while idle, draw one frame twice a second. If some future change
 * ever forgets to call requestRender(), the picture still corrects itself
 * rather than staying stale until the next click.
 */
const IDLE_HEARTBEAT_MS = 500;
let lastFrameTime = 0;

/** Events that can change what is on screen. Kept broad on purpose — a
 *  needless frame costs nothing, a missed one is a visible bug. */
const INPUT_EVENTS = [
  'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerover', 'pointerout',
  'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu',
  'wheel', 'keydown', 'keyup', 'input', 'change', 'paste', 'cut',
  'touchstart', 'touchmove', 'touchend', 'touchcancel',
  'focusin', 'focusout', 'dragover', 'drop', 'scroll',
];

/**
 * Ask for the next `frames` animation frames to be drawn.
 * Call this after changing anything that affects the canvas or entity layer.
 */
export function requestRender(frames = 2) {
  if (frames > pendingFrames) pendingFrames = frames;
}

/** Force continuous drawing for as long as `predicate()` holds (drag gestures). */
export function requestRenderWhile(predicate) {
  activePredicates.add(predicate);
}

const activePredicates = new Set();

function viewportIsSettling(state) {
  return Math.abs(state.targetOffsetX - state.offsetX) > VIEWPORT_EPSILON
    || Math.abs(state.targetOffsetY - state.offsetY) > VIEWPORT_EPSILON
    || Math.abs(state.targetScale - state.scale) > SCALE_EPSILON;
}

/**
 * Advance the viewport easing. Snapping once inside the epsilon stops the
 * exponential lerp from chasing the target forever with sub-pixel deltas,
 * which is what would otherwise keep the loop awake indefinitely.
 */
function stepViewport(state) {
  if (!viewportIsSettling(state)) {
    state.offsetX = state.targetOffsetX;
    state.offsetY = state.targetOffsetY;
    state.scale = state.targetScale;
    return false;
  }
  state.offsetX += (state.targetOffsetX - state.offsetX) * GRID.panLerp;
  state.offsetY += (state.targetOffsetY - state.offsetY) * GRID.panLerp;
  state.scale += (state.targetScale - state.scale) * GRID.zoomLerp;
  return true;
}

/**
 * Start the animation loop.
 *
 * @param {object} state the app state singleton
 * @param {() => void} drawFrame renders one complete frame
 */
export function startRenderLoop(state, drawFrame) {
  for (const type of INPUT_EVENTS) {
    // Capture phase so a handler calling stopPropagation cannot hide the event.
    window.addEventListener(type, () => requestRender(), { capture: true, passive: true });
  }
  window.addEventListener('resize', () => requestRender(4), { passive: true });
  window.addEventListener('focus', () => requestRender(), { passive: true });
  document.addEventListener('visibilitychange', () => requestRender(4));

  function frame(now) {
    requestAnimationFrame(frame);

    for (const predicate of activePredicates) {
      let keep = false;
      try {
        keep = predicate();
      } catch { /* a broken predicate must not stall the loop */ }
      if (keep) requestRender();
      else activePredicates.delete(predicate);
    }

    const moving = stepViewport(state);
    const heartbeat = now - lastFrameTime >= IDLE_HEARTBEAT_MS;

    if (!moving && pendingFrames <= 0 && !heartbeat) return;

    if (pendingFrames > 0) pendingFrames--;
    lastFrameTime = now;
    drawFrame();
  }

  requestRender(4);
  requestAnimationFrame(frame);
}
