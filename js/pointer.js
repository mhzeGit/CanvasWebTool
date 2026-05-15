import { state } from './state.js';
import { screenToWorld, computeResizeBounds, getObjectEdgePoint } from './utils.js';
import { hitTestNode, getEdgeAt, findNodeAtEdge } from './nodes.js';
import { hitTestConnection } from './connections.js';
import { hitTestArrowEnd, hitTestArrowBody, isArrowInBox } from './arrows.js';
import { getShapeEdgeAt, isShapeInBox } from './shapes.js';
import { getTextBoxEdgeAt } from './textboxes.js';
import { hitTestConnector, isConnectorInBox } from './connectors.js';
import { getActiveTool, getShapeSubType, setActiveTool, TOOLS } from './toolManager.js';
import { openContextMenu, closeContextMenu } from './context-menu.js';
import { refreshSidePanel } from './side-panel.js';
import { commitEditing } from './inline-editing.js';
import {
  addNodeAt, addArrowAt,
  deleteSelectedNodes, duplicateSelectedNodes, copySelectedNodes, pasteNodesAt,
  addShapeAt, addTextBoxAt, addConnector, addArrowFromPoints,
  deleteSelectedShapes, deleteSelectedTextBoxes, deleteSelectedConnectors,
  addConnection,
} from './document.js';
import {
  createMoveShapesCmd, createResizeShapeCmd, createMoveTextBoxesCmd,
  createMoveConnectorsCmd, createResizeTextBoxCmd, createMoveArrowEndCmd,
} from './undo.js';
import { flushPanelEdit } from './history.js';
import { DRAG_THRESHOLD_PX, TEXTBOX_MIN_W, TEXTBOX_MIN_H, SHAPE_MIN_W, SHAPE_MIN_H } from './config.js';

let _history;

export function initPointer(history) {
  _history = history;
  setupListeners();
}

function setupListeners() {
  state.canvas.addEventListener('pointerdown', onPointerDown);
  state.canvas.addEventListener('pointermove', onPointerMove);
  state.canvas.addEventListener('pointerup', onPointerUp);
  state.canvas.addEventListener('pointercancel', onPointerCancel);
}

function gatherChildDragStarts() {
  state.dragChildShapeStarts = [];
  state.dragChildTextBoxStarts = [];
  const parentIds = new Set();
  const parentTypes = new Set();
  for (const ti of state.selectedTextBoxes) {
    parentIds.add(state.textBoxes[ti].id);
    parentTypes.add('textBox');
  }
  for (const si of state.selectedShapes) {
    parentIds.add(state.shapes[si].id);
    parentTypes.add('shape');
  }
  for (let i = 0; i < state.shapes.length; i++) {
    const s = state.shapes[i];
    if (s.parentId !== null && parentIds.has(s.parentId) && parentTypes.has(s.parentType)) {
      state.dragChildShapeStarts.push({ i, x: s.x, y: s.y, id: s.id });
    }
  }
  for (let i = 0; i < state.textBoxes.length; i++) {
    const tb = state.textBoxes[i];
    if (tb.parentId !== null && parentIds.has(tb.parentId) && parentTypes.has(tb.parentType)) {
      state.dragChildTextBoxStarts.push({ i, x: tb.x, y: tb.y, id: tb.id });
    }
  }
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

function onPointerCancel(e) {
  if (state.drawingTool) {
    state.drawingTool = null;
    state.drawingShapeType = null;
    state.drawingStartX = 0;
    state.drawingStartY = 0;
    state.drawingStartConnected = null;
  }
  try { state.canvas.releasePointerCapture(e.pointerId); } catch {}
}

function findConnectedObjectAtPoint(wx, wy) {
  const hit = state.getTopHitAt(wx, wy);
  if (hit) return { type: hit.type, index: hit.i };
  return null;
}

function hasHitOnExistingItem(wx, wy) {
  if (hitTestArrowEnd(wx, wy)) return true;
  const tbIdx = hitTestNode(wx, wy);
  if (tbIdx !== -1) {
    if (getEdgeAt(wx, wy)) return true;
  } else {
    if (findNodeAtEdge(wx, wy)) return true;
  }
  if (getShapeEdgeAt(wx, wy)) return true;
  if (getTextBoxEdgeAt(wx, wy)) return true;
  if (state.getTopHitAt(wx, wy)) return true;
  if (hitTestConnector(wx, wy) !== -1) return true;
  if (hitTestArrowBody(wx, wy) !== -1) return true;
  if (hitTestConnection(wx, wy) !== null) return true;
  return false;
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
          addConnection(state.connectingFrom, hit);
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
    const tool = getActiveTool();

    if (tool === TOOLS.TEXT || tool === TOOLS.SHAPES) {
      if (hasHitOnExistingItem(world.x, world.y)) {
        setActiveTool(TOOLS.CURSOR);
      } else if (tool === TOOLS.TEXT) {
        state.selectedTextBoxes.clear();
        state.selectedConnection = null;
        state.selectedArrows.clear();
        state.selectedShapes.clear();
        state.selectedConnectors.clear();
        state.arrowDragTarget = null;
        state.drawingTool = 'text';
        state.drawingStartX = world.x;
        state.drawingStartY = world.y;
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      } else if (tool === TOOLS.SHAPES) {
        state.selectedTextBoxes.clear();
        state.selectedConnection = null;
        state.selectedArrows.clear();
        state.selectedShapes.clear();
        state.selectedConnectors.clear();
        state.arrowDragTarget = null;
        state.drawingTool = 'shape';
        state.drawingShapeType = getShapeSubType();
        state.drawingStartX = world.x;
        state.drawingStartY = world.y;
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
    }

    if (tool === TOOLS.ARROW) {
      state.selectedTextBoxes.clear();
      state.selectedConnection = null;
      state.selectedArrows.clear();
      state.selectedShapes.clear();
      state.selectedConnectors.clear();
      state.arrowDragTarget = null;
      state.drawingTool = 'arrow';
      state.drawingStartX = world.x;
      state.drawingStartY = world.y;
      const startHit = state.getTopHitAt(world.x, world.y);
      state.drawingStartConnected = startHit ? { type: startHit.type, index: startHit.i } : null;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (tool === TOOLS.CONNECTION_LINE) {
      state.selectedTextBoxes.clear();
      state.selectedConnection = null;
      state.selectedArrows.clear();
      state.selectedShapes.clear();
      state.selectedConnectors.clear();
      state.arrowDragTarget = null;
      state.drawingTool = 'connector';
      state.drawingStartX = world.x;
      state.drawingStartY = world.y;
      const startHit = state.getTopHitAt(world.x, world.y);
      state.drawingStartConnected = startHit ? { type: startHit.type, index: startHit.i } : null;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    const arrowEndHit = hitTestArrowEnd(world.x, world.y);
    if (arrowEndHit) {
      state.selectedTextBoxes.clear();
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
        connectedTo: arrow.connectedTo,
        connectedFromType: arrow.connectedFromType,
        connectedToType: arrow.connectedToType,
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
      if (!state.selectedTextBoxes.has(edgeHit.idx)) {
        state.selectedTextBoxes.clear();
        state.selectedTextBoxes.add(edgeHit.idx);
      }
      state.isResizing = true;
      state.resizeNodeIdx = edgeHit.idx;
      state.resizeNodeId = state.textBoxes[edgeHit.idx].id;
      state.resizeHandle = edgeHit.handle;
      state.resizeStartWorldX = world.x;
      state.resizeStartWorldY = world.y;
      state.resizeStartNode = { x: state.textBoxes[edgeHit.idx].x, y: state.textBoxes[edgeHit.idx].y, w: state.textBoxes[edgeHit.idx].w, h: state.textBoxes[edgeHit.idx].h };
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    {
      const shapeEdge = getShapeEdgeAt(world.x, world.y);
      if (shapeEdge) {
        flushPanelEdit();
        state.selectedTextBoxes.clear();
        state.selectedConnection = null;
        state.selectedArrows.clear();
        state.selectedShapes.clear();
        state.selectedConnectors.clear();
        state.selectedShapes.add(shapeEdge.idx);
        state.isResizingShape = true;
        state.resizeShapeIdx = shapeEdge.idx;
        state.resizeShapeId = state.shapes[shapeEdge.idx].id;
        state.resizeShapeHandle = shapeEdge.handle;
        state.resizeShapeStartWorldX = world.x;
        state.resizeShapeStartWorldY = world.y;
        const s = state.shapes[shapeEdge.idx];
        state.resizeShapeStartBounds = { x: s.x, y: s.y, w: s.w, h: s.h };
        refreshSidePanel();
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
    }

    {
      const tbEdge = getTextBoxEdgeAt(world.x, world.y);
      if (tbEdge) {
        flushPanelEdit();
        state.selectedTextBoxes.clear();
        state.selectedConnection = null;
        state.selectedArrows.clear();
        state.selectedShapes.clear();
        state.selectedConnectors.clear();
        state.selectedTextBoxes.add(tbEdge.idx);
        state.isResizingTextBox = true;
        state.resizeTextBoxIdx = tbEdge.idx;
        state.resizeTextBoxId = state.textBoxes[tbEdge.idx].id;
        state.resizeTextBoxHandle = tbEdge.handle;
        state.resizeTextBoxStartWorldX = world.x;
        state.resizeTextBoxStartWorldY = world.y;
        const tb = state.textBoxes[tbEdge.idx];
        state.resizeTextBoxStartBounds = { x: tb.x, y: tb.y, w: tb.w, h: tb.h };
        refreshSidePanel();
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
    }

    {
      const topHit = state.getTopHitAt(world.x, world.y);
      if (topHit) {
        if (topHit.type === 'textBox') {
          state.selectedConnection = null;
          state.arrowDragTarget = null;
          if (!e.shiftKey && !e.ctrlKey) {
            state.selectedTextBoxes.clear();
            state.selectedArrows.clear();
            state.selectedShapes.clear();
            state.selectedConnectors.clear();
          }
          hit = topHit.i;
          state.pointerDownScreenX = sx;
          state.pointerDownScreenY = sy;
          state.pendingClickIndex = hit;
          state.pendingShiftKey = e.shiftKey;
          state.pendingCtrlKey = e.ctrlKey;
          state.didDragSincePointerDown = false;
          if (e.ctrlKey) {
            if (state.selectedTextBoxes.has(hit)) state.selectedTextBoxes.delete(hit);
            state.pendingClickIndex = -1;
            refreshSidePanel();
            e.preventDefault();
            return;
          }
          if (e.shiftKey) {
            state.selectedTextBoxes.add(hit);
          } else {
            state.selectedTextBoxes.clear();
            state.selectedTextBoxes.add(hit);
          }
          refreshSidePanel();
          canvas.setPointerCapture(e.pointerId);
          e.preventDefault();
          return;
        }
        if (topHit.type === 'shape') {
          if (!e.shiftKey && !e.ctrlKey) {
            state.selectedTextBoxes.clear();
            state.selectedConnection = null;
            state.selectedArrows.clear();
            state.selectedShapes.clear();
            state.selectedConnectors.clear();
            state.arrowDragTarget = null;
          }
          if (e.ctrlKey) {
            if (state.selectedShapes.has(topHit.i)) state.selectedShapes.delete(topHit.i);
            refreshSidePanel();
            e.preventDefault();
            return;
          }
          if (e.shiftKey) {
            state.selectedShapes.add(topHit.i);
          } else if (!state.selectedShapes.has(topHit.i)) {
            state.selectedShapes.clear();
            state.selectedShapes.add(topHit.i);
          }
          state.pendingClickIndex = -3;
          state.pointerDownScreenX = sx;
          state.pointerDownScreenY = sy;
          state.pendingShiftKey = e.shiftKey;
          state.pendingCtrlKey = e.ctrlKey;
          state.didDragSincePointerDown = false;
          refreshSidePanel();
          canvas.setPointerCapture(e.pointerId);
          e.preventDefault();
          return;
        }
      }
    }

    {
      const connHit = hitTestConnector(world.x, world.y);
      if (connHit !== -1) {
        state.selectedTextBoxes.clear();
        state.selectedConnection = null;
        state.selectedArrows.clear();
        state.selectedShapes.clear();
        state.selectedConnectors.clear();
        if (e.ctrlKey) {
          if (state.selectedConnectors.has(connHit)) state.selectedConnectors.delete(connHit);
          refreshSidePanel();
          e.preventDefault();
          return;
        }
        if (e.shiftKey) {
          state.selectedConnectors.add(connHit);
        } else if (!state.selectedConnectors.has(connHit)) {
          state.selectedConnectors.clear();
          state.selectedConnectors.add(connHit);
        }
        state.pointerDownScreenX = sx;
        state.pointerDownScreenY = sy;
        state.pendingClickIndex = -5;
        state.pendingShiftKey = e.shiftKey;
        state.pendingCtrlKey = e.ctrlKey;
        state.didDragSincePointerDown = false;
        refreshSidePanel();
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
    }

    {
      const bodyHit = hitTestArrowBody(world.x, world.y);
      if (bodyHit !== -1) {
        state.selectedTextBoxes.clear();
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
        state.selectedTextBoxes.clear();
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
    state.selectedShapes.clear();
    state.selectedTextBoxes.clear();
    state.selectedConnectors.clear();
    state.arrowDragTarget = null;
    state.boxStartX = world.x;
    state.boxStartY = world.y;
    state.boxEndX = world.x;
    state.boxEndY = world.y;
    state.boxMode = e.shiftKey ? 'add' : (e.ctrlKey ? 'remove' : 'replace');
    state.boxBaseSelection = new Set(state.selectedTextBoxes);
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

  if (state.drawingTool) {
    e.preventDefault();
    return;
  }

  if (state.isDraggingArrowEnd && state.arrowDragTarget) {
    const arrow = state.arrows[state.arrowDragTarget.arrowIdx];
    if (arrow) {
      if (state.arrowDragTarget.end === 'start') {
        arrow.x1 = world.x;
        arrow.y1 = world.y;
        const snapHit = state.getTopHitAt(world.x, world.y);
        if (snapHit) {
          arrow.connectedFrom = snapHit.i;
          arrow.connectedFromType = snapHit.type;
          const obj = snapHit.type === 'shape' ? state.shapes[snapHit.i]
            : state.textBoxes[snapHit.i];
          if (obj) {
            const edge = getObjectEdgePoint(obj, arrow.x2, arrow.y2);
            arrow.x1 = edge.x;
            arrow.y1 = edge.y;
          }
        } else {
          arrow.connectedFrom = null;
          arrow.connectedFromType = null;
        }
      } else {
        arrow.x2 = world.x;
        arrow.y2 = world.y;
        const snapHit = state.getTopHitAt(world.x, world.y);
        if (snapHit) {
          arrow.connectedTo = snapHit.i;
          arrow.connectedToType = snapHit.type;
          const obj = snapHit.type === 'shape' ? state.shapes[snapHit.i]
            : state.textBoxes[snapHit.i];
          if (obj) {
            const edge = getObjectEdgePoint(obj, arrow.x1, arrow.y1);
            arrow.x2 = edge.x;
            arrow.y2 = edge.y;
          }
        } else {
          arrow.connectedTo = null;
          arrow.connectedToType = null;
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
          a.connectedFromType = null;
          a.connectedToType = null;
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
    const tb = state.textBoxes[state.resizeNodeIdx];
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

    newW = Math.max(10, newW);
    newH = Math.max(10, newH);

    tb.x = newX; tb.y = newY; tb.w = newW; tb.h = newH;
    e.preventDefault();
    return;
  }

  if (state.isResizingShape) {
    const dx = world.x - state.resizeShapeStartWorldX;
    const dy = world.y - state.resizeShapeStartWorldY;
    const start = state.resizeShapeStartBounds;
    const s = state.shapes[state.resizeShapeIdx];
    const MIN_W = 20; const MIN_H = 20;
    let newX = start.x, newY = start.y, newW = start.w, newH = start.h;

    switch (state.resizeShapeHandle) {
      case 'left':   newX = start.x + dx; newW = start.w - dx; break;
      case 'right':  newW = start.w + dx; break;
      case 'top':    newY = start.y + dy; newH = start.h - dy; break;
      case 'bottom': newH = start.h + dy; break;
      case 'tl':     newX = start.x + dx; newY = start.y + dy; newW = start.w - dx; newH = start.h - dy; break;
      case 'tr':     newY = start.y + dy; newW = start.w + dx; newH = start.h - dy; break;
      case 'bl':     newX = start.x + dx; newW = start.w - dx; newH = start.h + dy; break;
      case 'br':     newW = start.w + dx; newH = start.h + dy; break;
    }

    if (newW < MIN_W) {
      if (state.resizeShapeHandle.includes('l')) newX = start.x + start.w - MIN_W;
      newW = MIN_W;
    }
    if (newH < MIN_H) {
      if (state.resizeShapeHandle[0] === 't') newY = start.y + start.h - MIN_H;
      newH = MIN_H;
    }

    s.x = newX; s.y = newY; s.w = newW; s.h = newH;
    e.preventDefault();
    return;
  }

  if (state.isResizingTextBox) {
    const dx = world.x - state.resizeTextBoxStartWorldX;
    const dy = world.y - state.resizeTextBoxStartWorldY;
    const tb = state.textBoxes[state.resizeTextBoxIdx];
    const b = computeResizeBounds(state.resizeTextBoxStartBounds, state.resizeTextBoxHandle, dx, dy, TEXTBOX_MIN_W, TEXTBOX_MIN_H);
    tb.x = b.x; tb.y = b.y; tb.w = b.w; tb.h = b.h;
    e.preventDefault();
    return;
  }

  const dragDx = world.x - state.dragStartWorldX;
  const dragDy = world.y - state.dragStartWorldY;

  if (state.isDraggingNode) {
    for (const item of state.dragGroupStarts) {
      const tb = state.textBoxes[item.i];
      tb.x = item.x + dragDx;
      tb.y = item.y + dragDy;
    }
    for (const s of state.dragArrowStarts) {
      const a = state.arrows[s.idx];
      if (a && a.connectedFrom === null && a.connectedTo === null) {
        a.x1 = s.x1 + dragDx;
        a.y1 = s.y1 + dragDy;
        a.x2 = s.x2 + dragDx;
        a.y2 = s.y2 + dragDy;
      }
    }
    for (const item of state.dragChildShapeStarts) {
      const s = state.shapes[item.i];
      if (s) { s.x = item.x + dragDx; s.y = item.y + dragDy; }
    }
    for (const item of state.dragChildTextBoxStarts) {
      const tb = state.textBoxes[item.i];
      if (tb) { tb.x = item.x + dragDx; tb.y = item.y + dragDy; }
    }
    e.preventDefault();
    return;
  }

  if (state.isDraggingShape) {
    for (const item of state.dragShapeStarts) {
      const s = state.shapes[item.i];
      s.x = item.x + dragDx;
      s.y = item.y + dragDy;
    }
    for (const item of state.dragChildShapeStarts) {
      const s = state.shapes[item.i];
      if (s) { s.x = item.x + dragDx; s.y = item.y + dragDy; }
    }
    for (const item of state.dragChildTextBoxStarts) {
      const tb = state.textBoxes[item.i];
      if (tb) { tb.x = item.x + dragDx; tb.y = item.y + dragDy; }
    }
    e.preventDefault();
    return;
  }

  if (state.isDraggingTextBox) {
    for (const item of state.dragTextBoxStarts) {
      const tb = state.textBoxes[item.i];
      tb.x = item.x + dragDx;
      tb.y = item.y + dragDy;
    }
    for (const item of state.dragChildShapeStarts) {
      const s = state.shapes[item.i];
      if (s) { s.x = item.x + dragDx; s.y = item.y + dragDy; }
    }
    for (const item of state.dragChildTextBoxStarts) {
      const tb = state.textBoxes[item.i];
      if (tb) { tb.x = item.x + dragDx; tb.y = item.y + dragDy; }
    }
    e.preventDefault();
    return;
  }

  if (state.isDraggingConnectorBody && state.dragConnectorBodySnapshots.length > 0) {
    if (state.dragArrowBodyStartWorld) {
      const dx = world.x - state.dragArrowBodyStartWorld.x;
      const dy = world.y - state.dragArrowBodyStartWorld.y;
      for (const snap of state.dragConnectorBodySnapshots) {
        const c = state.connectors[snap.idx];
        if (c) {
          c.x1 = snap.x1 + dx;
          c.y1 = snap.y1 + dy;
          c.x2 = snap.x2 + dx;
          c.y2 = snap.y2 + dy;
        }
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
      if (!state.selectedTextBoxes.has(state.pendingClickIndex)) {
        state.selectedTextBoxes.clear();
        state.selectedTextBoxes.add(state.pendingClickIndex);
      }
      state.isDraggingNode = true;
      state.didDragSincePointerDown = true;
      state.dragStartWorldX = world.x;
      state.dragStartWorldY = world.y;
      state.dragGroupStarts = [];
      for (const ti of state.selectedTextBoxes) {
        const tb = state.textBoxes[ti];
        if (tb) state.dragGroupStarts.push({ i: ti, x: tb.x, y: tb.y, id: tb.id });
      }
      gatherChildDragStarts();
      state.dragArrowStarts = [];
      for (const ai of state.selectedArrows) {
        const a = state.arrows[ai];
        if (a) {
          state.dragArrowStarts.push({
            idx: ai,
            x1: a.x1, y1: a.y1,
            x2: a.x2, y2: a.y2,
            connectedFrom: a.connectedFrom,
            connectedTo: a.connectedTo,
            connectedFromType: a.connectedFromType,
            connectedToType: a.connectedToType,
          });
        }
      }
    }
  }

  if (state.pendingClickIndex === -3 && state.selectedShapes.size > 0 && (e.buttons & 1) === 1) {
    const moveDx = Math.abs(sx - state.pointerDownScreenX);
    const moveDy = Math.abs(sy - state.pointerDownScreenY);
    if (moveDx >= DRAG_THRESHOLD_PX || moveDy >= DRAG_THRESHOLD_PX) {
      state.isDraggingShape = true;
      state.didDragSincePointerDown = true;
      state.dragStartWorldX = world.x;
      state.dragStartWorldY = world.y;
      state.dragShapeStarts = [];
      for (const si of state.selectedShapes) {
        const s = state.shapes[si];
        if (s) state.dragShapeStarts.push({ i: si, x: s.x, y: s.y, id: s.id });
      }
      gatherChildDragStarts();
    }
  }

  if (state.pendingClickIndex === -4 && state.selectedTextBoxes.size > 0 && (e.buttons & 1) === 1) {
    const moveDx = Math.abs(sx - state.pointerDownScreenX);
    const moveDy = Math.abs(sy - state.pointerDownScreenY);
    if (moveDx >= DRAG_THRESHOLD_PX || moveDy >= DRAG_THRESHOLD_PX) {
      state.isDraggingTextBox = true;
      state.didDragSincePointerDown = true;
      state.dragStartWorldX = world.x;
      state.dragStartWorldY = world.y;
      state.dragTextBoxStarts = [];
      for (const ti of state.selectedTextBoxes) {
        const tb = state.textBoxes[ti];
        if (tb) state.dragTextBoxStarts.push({ i: ti, x: tb.x, y: tb.y, id: tb.id });
      }
      gatherChildDragStarts();
    }
  }

  if (state.pendingClickIndex === -5 && state.selectedConnectors.size > 0 && (e.buttons & 1) === 1) {
    const moveDx = Math.abs(sx - state.pointerDownScreenX);
    const moveDy = Math.abs(sy - state.pointerDownScreenY);
    if (moveDx >= DRAG_THRESHOLD_PX || moveDy >= DRAG_THRESHOLD_PX) {
      state.isDraggingConnectorBody = true;
      state.dragArrowBodyStartWorld = { x: world.x, y: world.y };
      state.dragConnectorBodySnapshots = [];
      for (const ci of state.selectedConnectors) {
        const c = state.connectors[ci];
        if (c) state.dragConnectorBodySnapshots.push({ idx: ci, x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2 });
      }
      state.didDragSincePointerDown = true;
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
            connectedTo: a.connectedTo,
            connectedFromType: a.connectedFromType,
            connectedToType: a.connectedToType,
          });
        }
      }
      state.didDragSincePointerDown = true;
    }
  }

  let cursorSet = false;
  state.hoveredHandleInfo = null;

  const activeTool = getActiveTool();

  if (state.connectingFrom !== null) {
    canvas.style.cursor = 'crosshair';
    cursorSet = true;
  }
  if (!cursorSet && activeTool !== TOOLS.CURSOR) {
    canvas.style.cursor = 'crosshair';
    cursorSet = true;
  }
  if (!state.isDraggingNode && !state.isResizing && !state.isResizingShape && !state.isResizingTextBox && !state.isDraggingShape && !state.isDraggingTextBox && !state.isPanning && !state.isSelectingBox && !state.isDraggingArrowEnd) {
    const handleHit = getEdgeAt(world.x, world.y);
    if (handleHit) {
      canvas.style.cursor = handleHit.cursor;
      state.hoveredHandleInfo = handleHit;
      cursorSet = true;
    }
  }
  if (!cursorSet && !state.isDraggingNode && !state.isResizing && !state.isResizingShape && !state.isResizingTextBox && !state.isDraggingShape && !state.isDraggingTextBox && !state.isPanning && !state.isSelectingBox && !state.isDraggingArrowEnd) {
    const shapeEdge = getShapeEdgeAt(world.x, world.y);
    if (shapeEdge) {
      canvas.style.cursor = shapeEdge.cursor;
      cursorSet = true;
    }
  }
  if (!cursorSet && !state.isDraggingNode && !state.isResizing && !state.isResizingShape && !state.isResizingTextBox && !state.isDraggingShape && !state.isDraggingTextBox && !state.isPanning && !state.isSelectingBox && !state.isDraggingArrowEnd) {
    const tbEdge = getTextBoxEdgeAt(world.x, world.y);
    if (tbEdge) {
      canvas.style.cursor = tbEdge.cursor;
      cursorSet = true;
    }
  }
  if (!cursorSet && !state.isDraggingNode && !state.isResizing && !state.isResizingShape && !state.isResizingTextBox && !state.isDraggingShape && !state.isDraggingTextBox && !state.isPanning && !state.isSelectingBox && state.connectingFrom === null && !state.isDraggingArrowEnd) {
    const connHit = hitTestConnection(world.x, world.y);
    if (connHit !== null) {
      canvas.style.cursor = 'pointer';
      cursorSet = true;
    }
  }
  if (state.isDraggingArrowBody || state.isDraggingConnectorBody) {
    canvas.style.cursor = 'move';
    cursorSet = true;
  }
  if (!cursorSet && !state.isDraggingNode && !state.isResizing && !state.isResizingShape && !state.isResizingTextBox && !state.isDraggingShape && !state.isDraggingTextBox && !state.isPanning && !state.isSelectingBox && !state.isDraggingArrowEnd && !state.isDraggingArrowBody) {
    const bodyHit = hitTestArrowBody(world.x, world.y);
    if (bodyHit !== -1) {
      canvas.style.cursor = 'pointer';
      cursorSet = true;
    }
  }
  if (!cursorSet) {
    let overSelected = false;
    for (const ti of state.selectedTextBoxes) {
      const tb = state.textBoxes[ti];
      if (world.x >= tb.x && world.x <= tb.x + tb.w && world.y >= tb.y && world.y <= tb.y + tb.h) {
        overSelected = true; break;
      }
    }
    if (!overSelected) {
      for (const si of state.selectedShapes) {
        const s = state.shapes[si];
        if (s && world.x >= s.x && world.x <= s.x + s.w && world.y >= s.y && world.y <= s.y + s.h) {
          overSelected = true; break;
        }
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
    for (let i = 0; i < state.textBoxes.length; i++) {
      const tb = state.textBoxes[i];
      const ix1 = Math.max(bx1, tb.x);
      const iy1 = Math.max(by1, tb.y);
      const ix2 = Math.min(bx2, tb.x + tb.w);
      const iy2 = Math.min(by2, tb.y + tb.h);
      if (ix2 >= ix1 && iy2 >= iy1) hits.push(i);
    }

    const boxArrowHits = [];
    for (let ai = 0; ai < state.arrows.length; ai++) {
      if (isArrowInBox(state.arrows[ai], bx1, by1, bx2, by2)) {
        boxArrowHits.push(ai);
      }
    }

    const boxShapeHits = [];
    for (let si = 0; si < state.shapes.length; si++) {
      if (isShapeInBox(state.shapes[si], bx1, by1, bx2, by2)) {
        boxShapeHits.push(si);
      }
    }

    const boxTBHits = [];
    for (let ti = 0; ti < state.textBoxes.length; ti++) {
      const tb = state.textBoxes[ti];
      if (!(tb.x + tb.w < bx1 || tb.x > bx2 || tb.y + tb.h < by1 || tb.y > by2)) {
        boxTBHits.push(ti);
      }
    }

    const boxConnHits = [];
    for (let ci = 0; ci < state.connectors.length; ci++) {
      if (isConnectorInBox(state.connectors[ci], bx1, by1, bx2, by2)) {
        boxConnHits.push(ci);
      }
    }

    if (state.boxMode === 'replace') {
      state.selectedTextBoxes.clear();
      hits.forEach(i => state.selectedTextBoxes.add(i));
      state.selectedArrows.clear();
      state.selectedShapes.clear();
      state.selectedConnectors.clear();
      state.arrowDragTarget = null;
      for (const ai of boxArrowHits) state.selectedArrows.add(ai);
      for (const si of boxShapeHits) state.selectedShapes.add(si);
      for (const ti of boxTBHits) state.selectedTextBoxes.add(ti);
      for (const ci of boxConnHits) state.selectedConnectors.add(ci);
    } else if (state.boxMode === 'add') {
      for (const i of hits) state.selectedTextBoxes.add(i);
      for (const ai of boxArrowHits) state.selectedArrows.add(ai);
      for (const si of boxShapeHits) state.selectedShapes.add(si);
      for (const ti of boxTBHits) state.selectedTextBoxes.add(ti);
      for (const ci of boxConnHits) state.selectedConnectors.add(ci);
    } else {
      for (const i of hits) state.selectedTextBoxes.delete(i);
      for (const ai of boxArrowHits) { state.selectedArrows.delete(ai); state.arrowDragTarget = null; }
      for (const si of boxShapeHits) state.selectedShapes.delete(si);
      for (const ti of boxTBHits) state.selectedTextBoxes.delete(ti);
      for (const ci of boxConnHits) state.selectedConnectors.delete(ci);
    }
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
    const tb = state.textBoxes[state.resizeNodeIdx];
    if (tb && (tb.x !== state.resizeStartNode.x || tb.y !== state.resizeStartNode.y || tb.w !== state.resizeStartNode.w || tb.h !== state.resizeStartNode.h)) {
      _history.push(createResizeTextBoxCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, state.resizeNodeId,
        { x: state.resizeStartNode.x, y: state.resizeStartNode.y, w: state.resizeStartNode.w, h: state.resizeStartNode.h },
        { x: tb.x, y: tb.y, w: tb.w, h: tb.h }));
      state.markDrawOrderDirty();
      state.reparentAll();
    }
    state.isResizing = false;
    state.resizeNodeId = -1;
  }
  if (state.isResizingShape) {
    const s = state.shapes[state.resizeShapeIdx];
    if (s && state.resizeShapeStartBounds) {
      if (s.x !== state.resizeShapeStartBounds.x || s.y !== state.resizeShapeStartBounds.y ||
          s.w !== state.resizeShapeStartBounds.w || s.h !== state.resizeShapeStartBounds.h) {
        _history.push(createResizeShapeCmd(state.shapes, state.selectedShapes, refreshSidePanel, state.resizeShapeId,
          { x: state.resizeShapeStartBounds.x, y: state.resizeShapeStartBounds.y, w: state.resizeShapeStartBounds.w, h: state.resizeShapeStartBounds.h },
          { x: s.x, y: s.y, w: s.w, h: s.h }));
      }
    }
    state.isResizingShape = false;
    state.resizeShapeId = -1;
    state.resizeShapeStartBounds = null;
  }
  if (state.isResizingTextBox) {
    const tb = state.textBoxes[state.resizeTextBoxIdx];
    if (tb && state.resizeTextBoxStartBounds) {
      if (tb.x !== state.resizeTextBoxStartBounds.x || tb.y !== state.resizeTextBoxStartBounds.y ||
          tb.w !== state.resizeTextBoxStartBounds.w || tb.h !== state.resizeTextBoxStartBounds.h) {
        _history.push(createResizeTextBoxCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, state.resizeTextBoxId,
          { x: state.resizeTextBoxStartBounds.x, y: state.resizeTextBoxStartBounds.y, w: state.resizeTextBoxStartBounds.w, h: state.resizeTextBoxStartBounds.h },
          { x: tb.x, y: tb.y, w: tb.w, h: tb.h }));
        state.reparentAll();
      }
    }
    state.isResizingTextBox = false;
    state.resizeTextBoxId = -1;
    state.resizeTextBoxStartBounds = null;
  }
  if (state.isPanning) {
    state.isPanning = false;
  }
  if (state.isDraggingNode) {
    const moves = [];
    for (const item of state.dragGroupStarts) {
      const tb = state.textBoxes[item.i];
      if (tb && (tb.x !== item.x || tb.y !== item.y)) {
        moves.push({ id: item.id, fromX: item.x, fromY: item.y, toX: tb.x, toY: tb.y });
      }
    }
    if (moves.length > 0) {
      _history.push(createMoveTextBoxesCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, moves));
      state.reparentAll();
    }
    state.isDraggingNode = false;
    if (state.dragArrowStarts && state.dragArrowStarts.length > 0) {
      for (const s of state.dragArrowStarts) {
        const a = state.arrows[s.idx];
        if (a && (a.x1 !== s.x1 || a.y1 !== s.y1 || a.x2 !== s.x2 || a.y2 !== s.y2)) {
          _history.push(createMoveArrowEndCmd(state.arrows, s.idx,
            { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2,
              connectedFrom: s.connectedFrom, connectedTo: s.connectedTo,
              connectedFromType: s.connectedFromType, connectedToType: s.connectedToType },
            { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2,
              connectedFrom: a.connectedFrom, connectedTo: a.connectedTo,
              connectedFromType: a.connectedFromType, connectedToType: a.connectedToType }
          ));
        }
      }
      state.dragArrowStarts = [];
    }
    const childShapeMoves = [];
    for (const item of state.dragChildShapeStarts) {
      const s = state.shapes[item.i];
      if (s && (s.x !== item.x || s.y !== item.y)) {
        childShapeMoves.push({ id: item.id, fromX: item.x, fromY: item.y, toX: s.x, toY: s.y });
      }
    }
    if (childShapeMoves.length > 0) {
      _history.push(createMoveShapesCmd(state.shapes, state.selectedShapes, refreshSidePanel, childShapeMoves));
    }
    const childTBMoves = [];
    for (const item of state.dragChildTextBoxStarts) {
      const tb = state.textBoxes[item.i];
      if (tb && (tb.x !== item.x || tb.y !== item.y)) {
        childTBMoves.push({ id: item.id, fromX: item.x, fromY: item.y, toX: tb.x, toY: tb.y });
      }
    }
    if (childTBMoves.length > 0) {
      _history.push(createMoveTextBoxesCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, childTBMoves));
    }
    state.dragChildShapeStarts = [];
    state.dragChildTextBoxStarts = [];
  }
  if (state.isDraggingShape) {
    const moves = [];
    for (const item of state.dragShapeStarts) {
      const s = state.shapes[item.i];
      if (s && (s.x !== item.x || s.y !== item.y)) {
        moves.push({ id: item.id, fromX: item.x, fromY: item.y, toX: s.x, toY: s.y });
      }
    }
    if (moves.length > 0) {
      _history.push(createMoveShapesCmd(state.shapes, state.selectedShapes, refreshSidePanel, moves));
    }
    state.isDraggingShape = false;
    state.dragShapeStarts = [];
    const childShapeMoves = [];
    for (const item of state.dragChildShapeStarts) {
      const s = state.shapes[item.i];
      if (s && (s.x !== item.x || s.y !== item.y)) {
        childShapeMoves.push({ id: item.id, fromX: item.x, fromY: item.y, toX: s.x, toY: s.y });
      }
    }
    if (childShapeMoves.length > 0) {
      _history.push(createMoveShapesCmd(state.shapes, state.selectedShapes, refreshSidePanel, childShapeMoves));
    }
    const childTBMoves = [];
    for (const item of state.dragChildTextBoxStarts) {
      const tb = state.textBoxes[item.i];
      if (tb && (tb.x !== item.x || tb.y !== item.y)) {
        childTBMoves.push({ id: item.id, fromX: item.x, fromY: item.y, toX: tb.x, toY: tb.y });
      }
    }
    if (childTBMoves.length > 0) {
      _history.push(createMoveTextBoxesCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, childTBMoves));
    }
    state.dragChildShapeStarts = [];
    state.dragChildTextBoxStarts = [];
    state.reparentAll();
  }
  if (state.isDraggingTextBox) {
    const moves = [];
    for (const item of state.dragTextBoxStarts) {
      const tb = state.textBoxes[item.i];
      if (tb && (tb.x !== item.x || tb.y !== item.y)) {
        moves.push({ id: item.id, fromX: item.x, fromY: item.y, toX: tb.x, toY: tb.y });
      }
    }
    if (moves.length > 0) {
      _history.push(createMoveTextBoxesCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, moves));
    }
    state.isDraggingTextBox = false;
    state.dragTextBoxStarts = [];
    const childShapeMoves = [];
    for (const item of state.dragChildShapeStarts) {
      const s = state.shapes[item.i];
      if (s && (s.x !== item.x || s.y !== item.y)) {
        childShapeMoves.push({ id: item.id, fromX: item.x, fromY: item.y, toX: s.x, toY: s.y });
      }
    }
    if (childShapeMoves.length > 0) {
      _history.push(createMoveShapesCmd(state.shapes, state.selectedShapes, refreshSidePanel, childShapeMoves));
    }
    const childTBMoves = [];
    for (const item of state.dragChildTextBoxStarts) {
      const tb = state.textBoxes[item.i];
      if (tb && (tb.x !== item.x || tb.y !== item.y)) {
        childTBMoves.push({ id: item.id, fromX: item.x, fromY: item.y, toX: tb.x, toY: tb.y });
      }
    }
    if (childTBMoves.length > 0) {
      _history.push(createMoveTextBoxesCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, childTBMoves));
    }
    state.dragChildShapeStarts = [];
    state.dragChildTextBoxStarts = [];
    state.reparentAll();
  }
  if (state.isDraggingConnectorBody && state.dragConnectorBodySnapshots.length > 0) {
    for (const snap of state.dragConnectorBodySnapshots) {
      const c = state.connectors[snap.idx];
      if (c) {
        const moved = c.x1 !== snap.x1 || c.y1 !== snap.y1 || c.x2 !== snap.x2 || c.y2 !== snap.y2;
        if (moved) {
          _history.push(createMoveConnectorsCmd(state.connectors, state.selectedConnectors, [{
            id: c.id,
            fromX1: snap.x1, fromY1: snap.y1, fromX2: snap.x2, fromY2: snap.y2,
            toX1: c.x1, toY1: c.y1, toX2: c.x2, toY2: c.y2,
          }]));
        }
      }
    }
    state.isDraggingConnectorBody = false;
    state.dragConnectorBodySnapshots = [];
    state.dragArrowBodyStartWorld = null;
  }

  if (state.drawingTool) {
    try {
      if (state.drawingTool === 'arrow') {
        const dx = world.x - state.drawingStartX;
        const dy = world.y - state.drawingStartY;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          const endHit = state.getTopHitAt(world.x, world.y);
          const endConnected = endHit ? { type: endHit.type, index: endHit.i } : null;
          let startX = state.drawingStartX;
          let startY = state.drawingStartY;
          let endX = world.x;
          let endY = world.y;
          if (state.drawingStartConnected) {
            const obj = state.drawingStartConnected.type === 'shape' ? state.shapes[state.drawingStartConnected.index]
              : state.textBoxes[state.drawingStartConnected.index];
            if (obj) {
              const refPt = endConnected
                ? { x: (endConnected.type === 'shape' ? state.shapes[endConnected.index] : state.textBoxes[endConnected.index])?.x ?? endX, y: (endConnected.type === 'shape' ? state.shapes[endConnected.index] : state.textBoxes[endConnected.index])?.y ?? endY }
                : { x: endX, y: endY };
              const edge = getObjectEdgePoint(obj, refPt.x, refPt.y);
              startX = edge.x;
              startY = edge.y;
            }
          }
          if (endConnected) {
            const obj = endConnected.type === 'shape' ? state.shapes[endConnected.index]
              : state.textBoxes[endConnected.index];
            if (obj) {
              const refPt = state.drawingStartConnected
                ? { x: startX, y: startY }
                : { x: startX, y: startY };
              const edge = getObjectEdgePoint(obj, refPt.x, refPt.y);
              endX = edge.x;
              endY = edge.y;
            }
          }
          addArrowFromPoints(startX, startY, endX, endY,
            state.drawingStartConnected ? state.drawingStartConnected.index : null,
            endConnected ? endConnected.index : null,
            state.drawingStartConnected ? state.drawingStartConnected.type : null,
            endConnected ? endConnected.type : null);
        }
      } else if (state.drawingTool === 'connector') {
        const dx = world.x - state.drawingStartX;
        const dy = world.y - state.drawingStartY;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          const endHit = state.getTopHitAt(world.x, world.y);
          const endConnected = endHit ? { type: endHit.type, index: endHit.i } : null;
          let startX = state.drawingStartX;
          let startY = state.drawingStartY;
          let endX = world.x;
          let endY = world.y;
          if (state.drawingStartConnected) {
            const obj = state.drawingStartConnected.type === 'shape' ? state.shapes[state.drawingStartConnected.index]
              : state.textBoxes[state.drawingStartConnected.index];
            if (obj) {
              const refPt = endConnected
                ? { x: (endConnected.type === 'shape' ? state.shapes[endConnected.index] : state.textBoxes[endConnected.index])?.x ?? endX, y: (endConnected.type === 'shape' ? state.shapes[endConnected.index] : state.textBoxes[endConnected.index])?.y ?? endY }
                : { x: endX, y: endY };
              const edge = getObjectEdgePoint(obj, refPt.x, refPt.y);
              startX = edge.x;
              startY = edge.y;
            }
          }
          if (endConnected) {
            const obj = endConnected.type === 'shape' ? state.shapes[endConnected.index]
              : state.textBoxes[endConnected.index];
            if (obj) {
              const refPt = state.drawingStartConnected
                ? { x: startX, y: startY }
                : { x: startX, y: startY };
              const edge = getObjectEdgePoint(obj, refPt.x, refPt.y);
              endX = edge.x;
              endY = edge.y;
            }
          }
          addConnector(startX, startY, endX, endY,
            state.drawingStartConnected ? state.drawingStartConnected.index : null,
            endConnected ? endConnected.index : null,
            state.drawingStartConnected ? state.drawingStartConnected.type : null,
            endConnected ? endConnected.type : null);
        }
      } else if (state.drawingTool === 'shape') {
        const dx = world.x - state.drawingStartX;
        const dy = world.y - state.drawingStartY;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          const x = Math.min(state.drawingStartX, world.x);
          const y = Math.min(state.drawingStartY, world.y);
          const w = Math.abs(dx);
          const h = Math.abs(dy);
          if (w < SHAPE_MIN_W || h < SHAPE_MIN_H) {
            addShapeAt(state.drawingStartX, state.drawingStartY, state.drawingShapeType);
          } else {
            addShapeAt(x, y, state.drawingShapeType, w, h);
          }
        }
      } else if (state.drawingTool === 'text') {
        const dx = world.x - state.drawingStartX;
        const dy = world.y - state.drawingStartY;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          const x = Math.min(state.drawingStartX, world.x);
          const y = Math.min(state.drawingStartY, world.y);
          const w = Math.abs(dx);
          const h = Math.abs(dy);
          if (w < TEXTBOX_MIN_W || h < TEXTBOX_MIN_H) {
            addTextBoxAt(state.drawingStartX, state.drawingStartY);
          } else {
            addTextBoxAt(x, y, w, h);
          }
        } else {
          addTextBoxAt(world.x, world.y);
        }
      }
    } finally {
      state.drawingTool = null;
      state.drawingShapeType = null;
      state.drawingStartX = 0;
      state.drawingStartY = 0;
      state.drawingStartConnected = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
      refreshSidePanel();
    }
    return;
  }
  if (state.isDraggingArrowEnd && state.arrowDragTarget) {
    const arrow = state.arrows[state.arrowDragTarget.arrowIdx];
    if (arrow && state.dragArrowEndSnapshot) {
      const moved = arrow.x1 !== state.dragArrowEndSnapshot.x1 || arrow.y1 !== state.dragArrowEndSnapshot.y1 ||
                    arrow.x2 !== state.dragArrowEndSnapshot.x2 || arrow.y2 !== state.dragArrowEndSnapshot.y2 ||
                    arrow.connectedFrom !== state.dragArrowEndSnapshot.connectedFrom ||
                    arrow.connectedTo !== state.dragArrowEndSnapshot.connectedTo ||
                    arrow.connectedFromType !== state.dragArrowEndSnapshot.connectedFromType ||
                    arrow.connectedToType !== state.dragArrowEndSnapshot.connectedToType;
      if (moved) {
        _history.push(createMoveArrowEndCmd(state.arrows, state.arrowDragTarget.arrowIdx,
          { x1: state.dragArrowEndSnapshot.x1, y1: state.dragArrowEndSnapshot.y1,
            x2: state.dragArrowEndSnapshot.x2, y2: state.dragArrowEndSnapshot.y2,
            connectedFrom: state.dragArrowEndSnapshot.connectedFrom,
            connectedTo: state.dragArrowEndSnapshot.connectedTo,
            connectedFromType: state.dragArrowEndSnapshot.connectedFromType,
            connectedToType: state.dragArrowEndSnapshot.connectedToType },
          { x1: arrow.x1, y1: arrow.y1,
            x2: arrow.x2, y2: arrow.y2,
            connectedFrom: arrow.connectedFrom,
            connectedTo: arrow.connectedTo,
            connectedFromType: arrow.connectedFromType,
            connectedToType: arrow.connectedToType }
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
              connectedTo: snap.connectedTo,
              connectedFromType: snap.connectedFromType,
              connectedToType: snap.connectedToType },
            { x1: a.x1, y1: a.y1,
              x2: a.x2, y2: a.y2,
              connectedFrom: null, connectedTo: null,
              connectedFromType: null, connectedToType: null }
          ));
        }
      }
    }
    state.isDraggingArrowBody = false;
    state.dragArrowBodySnapshots = [];
    state.dragArrowBodyStartWorld = null;
    state.reparentAll();
    refreshSidePanel();
  }

  if (state.isSelectingBox) {
    const bx1 = Math.min(state.boxStartX, state.boxEndX);
    const by1 = Math.min(state.boxStartY, state.boxEndY);
    const bx2 = Math.max(state.boxStartX, state.boxEndX);
    const by2 = Math.max(state.boxStartY, state.boxEndY);

    const hits = [];
    for (let i = 0; i < state.textBoxes.length; i++) {
      const tb = state.textBoxes[i];
      const ix1 = Math.max(bx1, tb.x);
      const iy1 = Math.max(by1, tb.y);
      const ix2 = Math.min(bx2, tb.x + tb.w);
      const iy2 = Math.min(by2, tb.y + tb.h);
      if (ix2 >= ix1 && iy2 >= iy1) hits.push(i);
    }

    const boxArrowHits = [];
    for (let ai = 0; ai < state.arrows.length; ai++) {
      if (isArrowInBox(state.arrows[ai], bx1, by1, bx2, by2)) {
        boxArrowHits.push(ai);
      }
    }

    const boxShapeHits = [];
    for (let si = 0; si < state.shapes.length; si++) {
      if (isShapeInBox(state.shapes[si], bx1, by1, bx2, by2)) {
        boxShapeHits.push(si);
      }
    }

    const boxTBHits = [];
    for (let ti = 0; ti < state.textBoxes.length; ti++) {
      const tb = state.textBoxes[ti];
      if (!(tb.x + tb.w < bx1 || tb.x > bx2 || tb.y + tb.h < by1 || tb.y > by2)) {
        boxTBHits.push(ti);
      }
    }

    const boxConnHits = [];
    for (let ci = 0; ci < state.connectors.length; ci++) {
      if (isConnectorInBox(state.connectors[ci], bx1, by1, bx2, by2)) {
        boxConnHits.push(ci);
      }
    }

    if (state.boxMode === 'replace') {
      state.selectedTextBoxes.clear();
      hits.forEach(i => state.selectedTextBoxes.add(i));
      state.selectedArrows.clear();
      state.selectedShapes.clear();
      state.selectedConnectors.clear();
      state.arrowDragTarget = null;
      for (const ai of boxArrowHits) state.selectedArrows.add(ai);
      for (const si of boxShapeHits) state.selectedShapes.add(si);
      for (const ti of boxTBHits) state.selectedTextBoxes.add(ti);
      for (const ci of boxConnHits) state.selectedConnectors.add(ci);
    } else if (state.boxMode === 'add') {
      hits.forEach(i => state.selectedTextBoxes.add(i));
      for (const ai of boxArrowHits) state.selectedArrows.add(ai);
      for (const si of boxShapeHits) state.selectedShapes.add(si);
      for (const ti of boxTBHits) state.selectedTextBoxes.add(ti);
      for (const ci of boxConnHits) state.selectedConnectors.add(ci);
    } else if (state.boxMode === 'remove') {
      hits.forEach(i => state.selectedTextBoxes.delete(i));
      for (const ai of boxArrowHits) { state.selectedArrows.delete(ai); state.arrowDragTarget = null; }
      for (const si of boxShapeHits) state.selectedShapes.delete(si);
      for (const ti of boxTBHits) state.selectedTextBoxes.delete(ti);
      for (const ci of boxConnHits) state.selectedConnectors.delete(ci);
    }

    state.isSelectingBox = false;
    refreshSidePanel();
  }

  if (state.pendingClickIndex !== -1 && state.pendingClickIndex !== -2 && state.pendingClickIndex !== -3 && state.pendingClickIndex !== -4 && state.pendingClickIndex !== -5 && !state.didDragSincePointerDown) {
    if (state.selectedTextBoxes.has(state.pendingClickIndex) && state.selectedTextBoxes.size > 1 && !state.pendingShiftKey) {
      state.selectedTextBoxes.clear();
      state.selectedTextBoxes.add(state.pendingClickIndex);
    } else if (!state.selectedTextBoxes.has(state.pendingClickIndex) && !state.pendingShiftKey && !state.pendingCtrlKey) {
      state.selectedTextBoxes.clear();
      state.selectedTextBoxes.add(state.pendingClickIndex);
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
