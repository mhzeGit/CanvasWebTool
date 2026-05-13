import { state } from './state.js';
import { screenToWorld } from './utils.js';
import { hitTestNode } from './nodes.js';
import { hitTestConnection } from './connections.js';
import { hitTestArrowEnd, hitTestArrowBody, isArrowInBox, getArrowEndpoint } from './arrows.js';
import { openContextMenu, closeContextMenu } from './context-menu.js';
import { refreshSidePanel } from './side-panel.js';
import { commitEditing } from './inline-editing.js';
import {
  addNodeAt, addArrowAt,
  deleteSelectedNodes, duplicateSelectedNodes, copySelectedNodes, pasteNodesAt,
} from './document.js';
import {
  createResizeNodeCmd, createMoveNodesCmd, createMoveArrowEndCmd,
} from './undo.js';
import { flushPanelEdit } from './history.js';
import { getNodeEdgePoint } from './utils.js';
import { findNodeAtPoint } from './nodes.js';
import { DRAG_THRESHOLD_PX, NODE_MIN_W, NODE_MIN_H } from './config.js';
import { getEdgeAt, findNodeAtEdge } from './nodes.js';

let _history;

export function initPointer(history) {
  _history = history;
  setupListeners();
}

function setupListeners() {
  state.canvas.addEventListener('pointerdown', onPointerDown);
  state.canvas.addEventListener('pointermove', onPointerMove);
  state.canvas.addEventListener('pointerup', onPointerUp);
}

export function deleteArrowFn(ai) {
  if (ai < 0 || ai >= state.arrows.length) return;
  state.arrows.splice(ai, 1);
  const toReAdd = [];
  for (const sa of state.selectedArrows) {
    if (sa === ai) continue;
    toReAdd.push(sa > ai ? sa - 1 : sa);
  }
  state.selectedArrows.clear();
  for (const v of toReAdd) state.selectedArrows.add(v);
  if (state.arrowDragTarget) {
    if (state.arrowDragTarget.arrowIdx === ai) state.arrowDragTarget = null;
    else if (state.arrowDragTarget.arrowIdx > ai) state.arrowDragTarget.arrowIdx--;
  }
}

function onPointerDown(e) {
  const canvas = state.canvas;
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const world = screenToWorld(sx, sy, state.offsetX, state.offsetY, state.scale);

  flushPanelEdit();
  if (state.editingState) commitEditing();

  if (state.connectingFrom !== null) {
    if (e.button === 0) {
      const hit = hitTestNode(world.x, world.y);
      if (hit !== -1 && hit !== state.connectingFrom) {
        const exists = state.connections.some(c =>
          (c.from === state.connectingFrom && c.to === hit) || (c.from === hit && c.to === state.connectingFrom)
        );
        if (!exists) {
          let maxId = 0;
          for (const c of state.connections) { if (c.id > maxId) maxId = c.id; }
          state.connections.push({
            id: maxId + 1,
            from: state.connectingFrom,
            to: hit,
            color: '#6bb5ff',
            text: ''
          });
        }
      }
      state.connectingFrom = null;
      e.preventDefault();
      return;
    }
    if (e.button === 2) {
      state.connectingFrom = null;
      return;
    }
  }

  if (e.button === 2) {
    state.lastPanX = e.clientX;
    state.lastPanY = e.clientY;
    state.rmbDownTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    state.rmbMoved = false;
    state.rmbPending = true;
    return;
  }

  if (e.button === 0) {
    const arrowEndHit = hitTestArrowEnd(world.x, world.y);
    if (arrowEndHit) {
      state.selected.clear();
      state.selectedConnection = null;
      state.selectedArrows.clear();
      state.selectedArrows.add(arrowEndHit.arrowIdx);
      state.arrowDragTarget = arrowEndHit;
      state.isDraggingArrowEnd = true;
      state.dragArrowEndWhich = arrowEndHit.end;
      const arrow = state.arrows[arrowEndHit.arrowIdx];
      state.dragArrowEndSnapshot = {
        x1: arrow.x1, y1: arrow.y1,
        x2: arrow.x2, y2: arrow.y2,
        connectedFrom: arrow.connectedFrom,
        connectedTo: arrow.connectedTo
      };
      refreshSidePanel();
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    let hit = hitTestNode(world.x, world.y);

    let edgeHit = null;
    if (hit !== -1) {
      edgeHit = getEdgeAt(world.x, world.y);
    } else {
      const nearHit = findNodeAtEdge(world.x, world.y);
      if (nearHit) {
        edgeHit = nearHit;
        hit = nearHit.idx;
      }
    }
    if (edgeHit) {
      flushPanelEdit();
      if (!state.selected.has(edgeHit.idx)) {
        state.selected.clear();
        state.selected.add(edgeHit.idx);
      }
      state.isResizing = true;
      state.resizeNodeIdx = edgeHit.idx;
      state.resizeNodeId = state.nodes[edgeHit.idx].id;
      state.resizeHandle = edgeHit.handle;
      state.resizeStartWorldX = world.x;
      state.resizeStartWorldY = world.y;
      state.resizeStartNode = { x: state.nodes[edgeHit.idx].x, y: state.nodes[edgeHit.idx].y, w: state.nodes[edgeHit.idx].w, h: state.nodes[edgeHit.idx].h };
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    if (hit !== -1) {
      state.selectedConnection = null;
      state.arrowDragTarget = null;
      if (!e.shiftKey && !state.selected.has(hit)) {
        state.selectedArrows.clear();
      }
      state.pointerDownScreenX = sx;
      state.pointerDownScreenY = sy;
      state.pendingClickIndex = hit;
      state.pendingShiftKey = e.shiftKey;
      state.pendingCtrlKey = e.ctrlKey;
      state.didDragSincePointerDown = false;

      if (e.ctrlKey) {
        if (state.selected.has(hit)) state.selected.delete(hit);
        state.pendingClickIndex = -1;
        e.preventDefault();
        return;
      }
      if (e.shiftKey) {
        state.selected.add(hit);
      }

      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    {
      const bodyHit = hitTestArrowBody(world.x, world.y);
      if (bodyHit !== -1) {
        state.selected.clear();
        state.selectedConnection = null;
        if (e.ctrlKey) {
          if (state.selectedArrows.has(bodyHit)) state.selectedArrows.delete(bodyHit);
          if (state.selectedArrows.size === 0) state.arrowDragTarget = null;
          refreshSidePanel();
          e.preventDefault();
          return;
        }
        if (e.shiftKey) {
          state.selectedArrows.add(bodyHit);
        } else {
          if (!state.selectedArrows.has(bodyHit)) {
            state.selectedArrows.clear();
            state.arrowDragTarget = null;
            state.selectedArrows.add(bodyHit);
          }
        }
        if (state.selectedArrows.size === 0) state.arrowDragTarget = null;
        state.pointerDownScreenX = sx;
        state.pointerDownScreenY = sy;
        state.pendingClickIndex = -2;
        state.didDragSincePointerDown = false;
        refreshSidePanel();
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
    }

    if (hit === -1 && !e.shiftKey && !e.ctrlKey) {
      const connHit = hitTestConnection(world.x, world.y);
      if (connHit !== null) {
        state.selected.clear();
        state.selectedArrows.clear();
        state.arrowDragTarget = null;
        state.selectedConnection = connHit;
        refreshSidePanel();
        e.preventDefault();
        return;
      }
    }

    state.isSelectingBox = true;
    state.selectedConnection = null;
    state.selectedArrows.clear();
    state.arrowDragTarget = null;
    state.boxStartX = world.x;
    state.boxStartY = world.y;
    state.boxEndX = world.x;
    state.boxEndY = world.y;
    state.boxMode = e.shiftKey ? 'add' : (e.ctrlKey ? 'remove' : 'replace');
    state.boxBaseSelection = new Set(state.selected);
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
}

function onPointerMove(e) {
  const canvas = state.canvas;
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  window._lastMouseX = sx;
  window._lastMouseY = sy;
  const world = screenToWorld(sx, sy, state.offsetX, state.offsetY, state.scale);
  state.lastWorldMouse = { x: world.x, y: world.y };

  if (state.connectingFrom !== null) {
    state.connectingMouseWorld = { x: world.x, y: world.y };
  }

  if (state.isDraggingArrowEnd && state.arrowDragTarget) {
    const arrow = state.arrows[state.arrowDragTarget.arrowIdx];
    if (arrow) {
      if (state.arrowDragTarget.end === 'start') {
        arrow.x1 = world.x;
        arrow.y1 = world.y;
        const snapNode = findNodeAtPoint(world.x, world.y);
        if (snapNode !== -1 && snapNode !== arrow.connectedTo) {
          arrow.connectedFrom = snapNode;
          const edge = getNodeEdgePoint(state.nodes[snapNode], arrow.x2, arrow.y2);
          arrow.x1 = edge.x;
          arrow.y1 = edge.y;
        } else if (snapNode === -1) {
          arrow.connectedFrom = null;
        }
      } else {
        arrow.x2 = world.x;
        arrow.y2 = world.y;
        const snapNode = findNodeAtPoint(world.x, world.y);
        if (snapNode !== -1 && snapNode !== arrow.connectedFrom) {
          arrow.connectedTo = snapNode;
          const edge = getNodeEdgePoint(state.nodes[snapNode], arrow.x1, arrow.y1);
          arrow.x2 = edge.x;
          arrow.y2 = edge.y;
        } else if (snapNode === -1) {
          arrow.connectedTo = null;
        }
      }
    }
    e.preventDefault();
    return;
  }

  if (state.isDraggingArrowBody && state.dragArrowBodySnapshots.length > 0) {
    if (state.dragArrowBodyStartWorld) {
      const dx = world.x - state.dragArrowBodyStartWorld.x;
      const dy = world.y - state.dragArrowBodyStartWorld.y;
      for (const snap of state.dragArrowBodySnapshots) {
        const a = state.arrows[snap.idx];
        if (a) {
          a.x1 = snap.x1 + dx;
          a.y1 = snap.y1 + dy;
          a.x2 = snap.x2 + dx;
          a.y2 = snap.y2 + dy;
          a.connectedFrom = null;
          a.connectedTo = null;
        }
      }
    }
    e.preventDefault();
    return;
  }

  if (state.isResizing) {
    const dx = world.x - state.resizeStartWorldX;
    const dy = world.y - state.resizeStartWorldY;
    const start = state.resizeStartNode;
    const n = state.nodes[state.resizeNodeIdx];
    let newX = start.x, newY = start.y, newW = start.w, newH = start.h;

    switch (state.resizeHandle) {
      case 'left':   newX = start.x + dx; newW = start.w - dx; break;
      case 'right':  newW = start.w + dx; break;
      case 'top':    newY = start.y + dy; newH = start.h - dy; break;
      case 'bottom': newH = start.h + dy; break;
      case 'tl':     newX = start.x + dx; newY = start.y + dy; newW = start.w - dx; newH = start.h - dy; break;
      case 'tr':     newY = start.y + dy; newW = start.w + dx; newH = start.h - dy; break;
      case 'bl':     newX = start.x + dx; newW = start.w - dx; newH = start.h + dy; break;
      case 'br':     newW = start.w + dx; newH = start.h + dy; break;
    }

    if (newW < NODE_MIN_W) {
      if (state.resizeHandle.includes('l')) newX = start.x + start.w - NODE_MIN_W;
      newW = NODE_MIN_W;
    }
    if (newH < NODE_MIN_H) {
      if (state.resizeHandle[0] === 't') newY = start.y + start.h - NODE_MIN_H;
      newH = NODE_MIN_H;
    }

    n.x = newX; n.y = newY; n.w = newW; n.h = newH;
    e.preventDefault();
    return;
  }

  if (state.isDraggingNode) {
    const dx = world.x - state.dragStartWorldX;
    const dy = world.y - state.dragStartWorldY;
    for (const item of state.dragGroupStarts) {
      const n = state.nodes[item.i];
      n.x = item.x + dx;
      n.y = item.y + dy;
    }
    for (const s of state.dragArrowStarts) {
      const a = state.arrows[s.idx];
      if (a && a.connectedFrom === null && a.connectedTo === null) {
        a.x1 = s.x1 + dx;
        a.y1 = s.y1 + dy;
        a.x2 = s.x2 + dx;
        a.y2 = s.y2 + dy;
      }
    }
    e.preventDefault();
    return;
  }

  if ((e.buttons & 2) === 2 || state.isPanning) {
    const dx = e.clientX - state.lastPanX;
    const dy = e.clientY - state.lastPanY;
    state.lastPanX = e.clientX;
    state.lastPanY = e.clientY;
    state.targetOffsetX += dx;
    state.targetOffsetY += dy;
    if (Math.abs(dx) + Math.abs(dy) > 0) state.rmbMoved = true;
    state.isPanning = true;
    e.preventDefault();
    return;
  }

  if (state.pendingClickIndex >= 0 && (e.buttons & 1) === 1) {
    const moveDx = Math.abs(sx - state.pointerDownScreenX);
    const moveDy = Math.abs(sy - state.pointerDownScreenY);
    if (moveDx >= DRAG_THRESHOLD_PX || moveDy >= DRAG_THRESHOLD_PX) {
      if (!state.selected.has(state.pendingClickIndex)) {
        state.selected.clear();
        state.selected.add(state.pendingClickIndex);
      }
      state.isDraggingNode = true;
      state.didDragSincePointerDown = true;
      state.dragStartWorldX = world.x;
      state.dragStartWorldY = world.y;
      state.dragGroupStarts = state.getDragGroup(state.selected).map(it => ({ ...it, id: state.nodes[it.i].id }));
      state.dragArrowStarts = [];
      for (const ai of state.selectedArrows) {
        const a = state.arrows[ai];
        if (a) {
          state.dragArrowStarts.push({
            idx: ai,
            x1: a.x1, y1: a.y1,
            x2: a.x2, y2: a.y2,
            connectedFrom: a.connectedFrom,
            connectedTo: a.connectedTo
          });
        }
      }
    }
  }

  if (state.pendingClickIndex === -2 && state.selectedArrows.size > 0 && (e.buttons & 1) === 1) {
    const moveDx = Math.abs(sx - state.pointerDownScreenX);
    const moveDy = Math.abs(sy - state.pointerDownScreenY);
    if (moveDx >= DRAG_THRESHOLD_PX || moveDy >= DRAG_THRESHOLD_PX) {
      state.isDraggingArrowBody = true;
      state.dragArrowBodyStartWorld = { x: world.x, y: world.y };
      state.dragArrowBodySnapshots = [];
      for (const ai of state.selectedArrows) {
        const a = state.arrows[ai];
        if (a) {
          state.dragArrowBodySnapshots.push({
            idx: ai,
            x1: a.x1, y1: a.y1,
            x2: a.x2, y2: a.y2,
            connectedFrom: a.connectedFrom,
            connectedTo: a.connectedTo
          });
        }
      }
      state.didDragSincePointerDown = true;
    }
  }

  let cursorSet = false;
  state.hoveredHandleInfo = null;

  if (state.connectingFrom !== null) {
    canvas.style.cursor = 'crosshair';
    cursorSet = true;
  }
  if (!state.isDraggingNode && !state.isResizing && !state.isPanning && !state.isSelectingBox && !state.isDraggingArrowEnd) {
    const handleHit = getEdgeAt(world.x, world.y);
    if (handleHit) {
      canvas.style.cursor = handleHit.cursor;
      state.hoveredHandleInfo = handleHit;
      cursorSet = true;
    }
  }
  if (!cursorSet && !state.isDraggingNode && !state.isResizing && !state.isPanning && !state.isSelectingBox && state.connectingFrom === null && !state.isDraggingArrowEnd) {
    const connHit = hitTestConnection(world.x, world.y);
    if (connHit !== null) {
      canvas.style.cursor = 'pointer';
      cursorSet = true;
    }
  }
  if (state.isDraggingArrowBody) {
    canvas.style.cursor = 'move';
    cursorSet = true;
  }
  if (!cursorSet && !state.isDraggingNode && !state.isResizing && !state.isPanning && !state.isSelectingBox && !state.isDraggingArrowEnd && !state.isDraggingArrowBody) {
    const bodyHit = hitTestArrowBody(world.x, world.y);
    if (bodyHit !== -1) {
      canvas.style.cursor = 'pointer';
      cursorSet = true;
    }
  }
  if (!cursorSet) {
    let overSelected = false;
    for (const i of state.selected) {
      const n = state.nodes[i];
      if (world.x >= n.x && world.x <= n.x + n.w && world.y >= n.y && world.y <= n.y + n.h) {
        overSelected = true; break;
      }
    }
    canvas.style.cursor = overSelected ? 'move' : 'grab';
  }

  if (state.isSelectingBox) {
    state.boxEndX = world.x;
    state.boxEndY = world.y;

    const bx1 = Math.min(state.boxStartX, state.boxEndX);
    const by1 = Math.min(state.boxStartY, state.boxEndY);
    const bx2 = Math.max(state.boxStartX, state.boxEndX);
    const by2 = Math.max(state.boxStartY, state.boxEndY);
    const hits = [];
    for (let i = 0; i < state.nodes.length; i++) {
      const n = state.nodes[i];
      const ix1 = Math.max(bx1, n.x);
      const iy1 = Math.max(by1, n.y);
      const ix2 = Math.min(bx2, n.x + n.w);
      const iy2 = Math.min(by2, n.y + n.h);
      if (ix2 >= ix1 && iy2 >= iy1) hits.push(i);
    }

    const boxArrowHits = [];
    for (let ai = 0; ai < state.arrows.length; ai++) {
      if (isArrowInBox(state.arrows[ai], bx1, by1, bx2, by2)) {
        boxArrowHits.push(ai);
      }
    }

    let newSelected;
    if (state.boxMode === 'replace') {
      newSelected = new Set(hits);
      state.selectedArrows.clear();
      state.arrowDragTarget = null;
      for (const ai of boxArrowHits) state.selectedArrows.add(ai);
    } else if (state.boxMode === 'add') {
      newSelected = new Set(state.boxBaseSelection);
      for (const i of hits) newSelected.add(i);
      for (const ai of boxArrowHits) state.selectedArrows.add(ai);
    } else {
      newSelected = new Set(state.boxBaseSelection);
      for (const i of hits) newSelected.delete(i);
      for (const ai of boxArrowHits) { state.selectedArrows.delete(ai); state.arrowDragTarget = null; }
    }
    state.selected.clear();
    for (const i of newSelected) state.selected.add(i);
    refreshSidePanel();
  }
}

function onPointerUp(e) {
  const canvas = state.canvas;
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const world = screenToWorld(sx, sy, state.offsetX, state.offsetY, state.scale);

  if (state.isResizing) {
    const n = state.nodes[state.resizeNodeIdx];
    if (n && (n.x !== state.resizeStartNode.x || n.y !== state.resizeStartNode.y || n.w !== state.resizeStartNode.w || n.h !== state.resizeStartNode.h)) {
      _history.push(createResizeNodeCmd(state.nodes, state.selected, refreshSidePanel, state.resizeNodeId,
        { x: state.resizeStartNode.x, y: state.resizeStartNode.y, w: state.resizeStartNode.w, h: state.resizeStartNode.h },
        { x: n.x, y: n.y, w: n.w, h: n.h }));
      state.markDrawOrderDirty();
      for (let i = 0; i < state.nodes.length; i++) {
        state.checkAndUpdateParenting(i);
      }
    }
    state.isResizing = false;
    state.resizeNodeId = -1;
  }
  if (state.isPanning) {
    state.isPanning = false;
  }
  if (state.isDraggingNode) {
    const moves = [];
    const movedIndices = new Set();
    for (const item of state.dragGroupStarts) {
      const n = state.nodes[item.i];
      if (n && (n.x !== item.x || n.y !== item.y)) {
        moves.push({ id: item.id, fromX: item.x, fromY: item.y, toX: n.x, toY: n.y });
        movedIndices.add(item.i);
      }
    }
    if (moves.length > 0) {
      _history.push(createMoveNodesCmd(state.nodes, state.selected, refreshSidePanel, moves));
      for (let i = 0; i < state.nodes.length; i++) {
        state.checkAndUpdateParenting(i);
      }
    }
    state.isDraggingNode = false;
    if (state.dragArrowStarts && state.dragArrowStarts.length > 0) {
      for (const s of state.dragArrowStarts) {
        const a = state.arrows[s.idx];
        if (a && (a.x1 !== s.x1 || a.y1 !== s.y1 || a.x2 !== s.x2 || a.y2 !== s.y2)) {
          _history.push(createMoveArrowEndCmd(state.arrows, s.idx,
            { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, connectedFrom: s.connectedFrom, connectedTo: s.connectedTo },
            { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, connectedFrom: a.connectedFrom, connectedTo: a.connectedTo }
          ));
        }
      }
      state.dragArrowStarts = [];
    }
  }
  if (state.isDraggingArrowEnd && state.arrowDragTarget) {
    const arrow = state.arrows[state.arrowDragTarget.arrowIdx];
    if (arrow && state.dragArrowEndSnapshot) {
      const moved = arrow.x1 !== state.dragArrowEndSnapshot.x1 || arrow.y1 !== state.dragArrowEndSnapshot.y1 ||
                    arrow.x2 !== state.dragArrowEndSnapshot.x2 || arrow.y2 !== state.dragArrowEndSnapshot.y2 ||
                    arrow.connectedFrom !== state.dragArrowEndSnapshot.connectedFrom ||
                    arrow.connectedTo !== state.dragArrowEndSnapshot.connectedTo;
      if (moved) {
        _history.push(createMoveArrowEndCmd(state.arrows, state.arrowDragTarget.arrowIdx,
          { x1: state.dragArrowEndSnapshot.x1, y1: state.dragArrowEndSnapshot.y1,
            x2: state.dragArrowEndSnapshot.x2, y2: state.dragArrowEndSnapshot.y2,
            connectedFrom: state.dragArrowEndSnapshot.connectedFrom,
            connectedTo: state.dragArrowEndSnapshot.connectedTo },
          { x1: arrow.x1, y1: arrow.y1,
            x2: arrow.x2, y2: arrow.y2,
            connectedFrom: arrow.connectedFrom,
            connectedTo: arrow.connectedTo }
        ));
      }
    }
    state.isDraggingArrowEnd = false;
    state.dragArrowEndSnapshot = null;
    refreshSidePanel();
  }

  if (state.isDraggingArrowBody && state.dragArrowBodySnapshots.length > 0) {
    for (const snap of state.dragArrowBodySnapshots) {
      const a = state.arrows[snap.idx];
      if (a) {
        const moved = a.x1 !== snap.x1 || a.y1 !== snap.y1 ||
                      a.x2 !== snap.x2 || a.y2 !== snap.y2;
        if (moved) {
          _history.push(createMoveArrowEndCmd(state.arrows, snap.idx,
            { x1: snap.x1, y1: snap.y1,
              x2: snap.x2, y2: snap.y2,
              connectedFrom: snap.connectedFrom,
              connectedTo: snap.connectedTo },
            { x1: a.x1, y1: a.y1,
              x2: a.x2, y2: a.y2,
              connectedFrom: null, connectedTo: null }
          ));
        }
      }
    }
    state.isDraggingArrowBody = false;
    state.dragArrowBodySnapshots = [];
    state.dragArrowBodyStartWorld = null;
    refreshSidePanel();
  }

  if (state.isSelectingBox) {
    const bx1 = Math.min(state.boxStartX, state.boxEndX);
    const by1 = Math.min(state.boxStartY, state.boxEndY);
    const bx2 = Math.max(state.boxStartX, state.boxEndX);
    const by2 = Math.max(state.boxStartY, state.boxEndY);

    const hits = [];
    for (let i = 0; i < state.nodes.length; i++) {
      const n = state.nodes[i];
      const ix1 = Math.max(bx1, n.x);
      const iy1 = Math.max(by1, n.y);
      const ix2 = Math.min(bx2, n.x + n.w);
      const iy2 = Math.min(by2, n.y + n.h);
      if (ix2 >= ix1 && iy2 >= iy1) hits.push(i);
    }

    const boxArrowHits = [];
    for (let ai = 0; ai < state.arrows.length; ai++) {
      if (isArrowInBox(state.arrows[ai], bx1, by1, bx2, by2)) {
        boxArrowHits.push(ai);
      }
    }

    if (state.boxMode === 'replace') {
      state.selected.clear();
      hits.forEach(i => state.selected.add(i));
      state.selectedArrows.clear();
      state.arrowDragTarget = null;
      for (const ai of boxArrowHits) state.selectedArrows.add(ai);
    } else if (state.boxMode === 'add') {
      hits.forEach(i => state.selected.add(i));
      for (const ai of boxArrowHits) state.selectedArrows.add(ai);
    } else if (state.boxMode === 'remove') {
      hits.forEach(i => state.selected.delete(i));
      for (const ai of boxArrowHits) { state.selectedArrows.delete(ai); state.arrowDragTarget = null; }
    }

    state.isSelectingBox = false;
    refreshSidePanel();
  }

  if (state.pendingClickIndex !== -1 && state.pendingClickIndex !== -2 && !state.didDragSincePointerDown) {
    if (state.selected.has(state.pendingClickIndex) && state.selected.size > 1 && !state.pendingShiftKey) {
      state.selected.clear();
      state.selected.add(state.pendingClickIndex);
    } else if (!state.selected.has(state.pendingClickIndex) && !state.pendingShiftKey && !state.pendingCtrlKey) {
      state.selected.clear();
      state.selected.add(state.pendingClickIndex);
    }
  }
  state.pendingClickIndex = -1;
  state.didDragSincePointerDown = false;
  state.pendingShiftKey = false;
  state.pendingCtrlKey = false;

  if (e.button === 2) {
    if (state.rmbMoved) {
      state.rmbPending = false;
    }
  }
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
  refreshSidePanel();
}
