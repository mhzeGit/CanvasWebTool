import { state } from './state.js';
import { history, flushPanelEdit, setCanvasHistory } from './history.js';
import { createHistoryManager, createAddTextBoxCmd } from './undo.js';
import { destroyAllEntities } from './dom-entities.js';
import { refreshSidePanel } from './side-panel.js';
import { commitEditing } from './inline-editing.js';
import { requestRender } from './render-scheduler.js';
import { screenToWorld } from './utils.js';
import { setActiveTool, TOOLS } from './toolManager.js';
import { registerAddItem } from './context-menu.js';

const collections = ['textBoxes', 'shapes', 'arrows', 'connectors', 'connections'];
const counters = ['nextTextBoxId', 'nextShapeId', 'nextArrowId', 'nextConnectorId', 'nextConnectionId'];
const frames = [];
const histories = new WeakMap();
let navigation;

export function emptyCanvas() {
  return { textBoxes: [], shapes: [], arrows: [], connectors: [], connections: [], viewport: { offsetX: 0, offsetY: 0, scale: 1 } };
}

function capture() {
  const body = Object.fromEntries(collections.map(k => [k, state[k]]));
  body.viewport = { offsetX: state.targetOffsetX, offsetY: state.targetOffsetY, scale: state.targetScale };
  return body;
}

// Save/export always sees the complete document, even several canvases deep.
export function rootCanvasDocument() {
  const body = capture();
  if (!frames.length) return body;
  frames.forEach((frame, i) => Object.assign(frame.card.subCanvas, frames[i + 1]?.body || body));
  return frames[0].body;
}

function show(body, canvasHistory, savedCounters) {
  destroyAllEntities();
  for (const key of collections) state[key] = body[key] || [];
  counters.forEach((key, i) => { state[key] = savedCounters?.[key] ?? Math.max(0, ...state[collections[i]].map(e => e.id || 0)) + 1; });
  for (const key of ['selected', 'selectedTextBoxes', 'selectedShapes', 'selectedArrows', 'selectedConnectors']) state[key].clear();
  state.selectedConnection = null;
  state.arrowDragTarget = null;
  state.connectingFrom = null;
  state.drawingTool = null;
  state.hoveredHandleInfo = null;
  state.isSelectingBox = false;
  const vp = body.viewport || {};
  state.offsetX = state.targetOffsetX = vp.offsetX ?? 0;
  state.offsetY = state.targetOffsetY = vp.offsetY ?? 0;
  state.scale = state.targetScale = vp.scale ?? 1;
  setCanvasHistory(canvasHistory);
  state.lastPanelKey = '';
  state.markDrawOrderDirty();
  state.reparentAll();
  refreshSidePanel();
  renderCanvasNavigation();
  setActiveTool(TOOLS.CURSOR);
  requestRender();
}

export function enterCanvas(index) {
  const card = state.textBoxes[index];
  if (!card?.subCanvas) return;
  commitEditing(); flushPanelEdit();
  frames.push({ card, body: capture(), history, counters: Object.fromEntries(counters.map(k => [k, state[k]])) });
  if (!histories.has(card.subCanvas)) histories.set(card.subCanvas, createHistoryManager());
  show(card.subCanvas, histories.get(card.subCanvas));
}

export function navigateCanvas(depth) {
  commitEditing(); flushPanelEdit();
  depth = Math.max(0, depth);
  while (frames.length > depth) {
    Object.assign(frames.at(-1).card.subCanvas, capture());
    const frame = frames.pop();
    show(frame.body, frame.history, frame.counters);
  }
}

export function resetCanvasNavigation() {
  // Document replacement must leave the nested arrays before clearing them.
  navigateCanvas(0);
  renderCanvasNavigation();
}

export function addSubCanvasAt(x, y) {
  commitEditing(); flushPanelEdit();
  const card = { id: state.nextTextBoxId++, x: x - 140, y: y - 90, w: 280, h: 180,
    title: 'Untitled canvas', text: '', color: '#1a1a1a', borderColor: '#6bb5ff',
    titleColor: '#e7e7e7', textColor: '#dddddd', fontSize: 14, parentId: null, parentType: null, subCanvas: emptyCanvas() };
  const index = state.textBoxes.push(card) - 1;
  for (const key of ['selectedShapes', 'selectedArrows', 'selectedConnectors', 'selectedTextBoxes']) state[key].clear();
  state.selectedConnection = null; state.selectedTextBoxes.add(index);
  history.push(createAddTextBoxCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, card, index));
  state.markDrawOrderDirty(); state.reparentAll(); refreshSidePanel(); requestRender();
}

export function addSubCanvasAtCenter() {
  const rect = state.canvas.getBoundingClientRect();
  const point = screenToWorld(rect.width / 2, rect.height / 2, state.offsetX, state.offsetY, state.scale);
  addSubCanvasAt(point.x, point.y);
}

export function renderCanvasNavigation() {
  if (!navigation) return;
  navigation.replaceChildren();
  const back = document.createElement('button');
  back.textContent = '←'; back.title = 'Parent canvas (Alt+Left)'; back.disabled = !frames.length;
  back.onclick = () => navigateCanvas(frames.length - 1); navigation.append(back);
  ['Main canvas', ...frames.map(f => f.card.title || 'Untitled canvas')].forEach((title, depth) => {
    if (depth) { const divider = document.createElement('span'); divider.textContent = '/'; navigation.append(divider); }
    const button = document.createElement('button'); button.textContent = title; button.title = title;
    if (depth === frames.length) button.setAttribute('aria-current', 'page');
    button.onclick = () => navigateCanvas(depth); navigation.append(button);
  });
}

export function initSubCanvases() {
  navigation = document.createElement('nav'); navigation.className = 'canvas-breadcrumbs'; navigation.setAttribute('aria-label', 'Canvas location');
  document.body.append(navigation); renderCanvasNavigation();
  registerAddItem({ label: 'Sub-canvas', create: addSubCanvasAt });
  window.addEventListener('keydown', e => {
    if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
    if (e.altKey && e.key === 'ArrowLeft' && frames.length) { e.preventDefault(); navigateCanvas(frames.length - 1); }
    if (e.key === 'Enter' && state.selectedTextBoxes.size === 1) { const index = [...state.selectedTextBoxes][0]; if (state.textBoxes[index]?.subCanvas) { e.preventDefault(); enterCanvas(index); } }
    if (e.key.toLowerCase() === 'b' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); addSubCanvasAtCenter(); }
  });
}
