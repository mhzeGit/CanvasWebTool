import { state } from './state.js';
import {
  ARROW_END_RADIUS, ARROW_END_HIT_RADIUS, ARROW_BODY_HIT_THRESHOLD,
  ARROW_HEAD_LENGTH, ARROW_HEAD_ANGLE, DEFAULT_ARROW_COLOR,
} from './config.js';
import { getNodeEdgePoint } from './utils.js';
import { findNodeAtPoint } from './nodes.js';

export function getArrowEndpoint(arrow, which) {
  if (which === 'start') {
    if (arrow.connectedFrom !== null && state.nodes[arrow.connectedFrom]) {
      return getNodeEdgePoint(state.nodes[arrow.connectedFrom], arrow.x2, arrow.y2);
    }
    return { x: arrow.x1, y: arrow.y1 };
  } else {
    if (arrow.connectedTo !== null && state.nodes[arrow.connectedTo]) {
      return getNodeEdgePoint(state.nodes[arrow.connectedTo], arrow.x1, arrow.y1);
    }
    return { x: arrow.x2, y: arrow.y2 };
  }
}

export function updateArrowPositionsFromConnections() {
  for (const arrow of state.arrows) {
    if (arrow.connectedFrom !== null && state.nodes[arrow.connectedFrom]) {
      const edge = getNodeEdgePoint(state.nodes[arrow.connectedFrom], arrow.x2, arrow.y2);
      arrow.x1 = edge.x;
      arrow.y1 = edge.y;
    }
    if (arrow.connectedTo !== null && state.nodes[arrow.connectedTo]) {
      const edge = getNodeEdgePoint(state.nodes[arrow.connectedTo], arrow.x1, arrow.y1);
      arrow.x2 = edge.x;
      arrow.y2 = edge.y;
    }
  }
}

export function drawArrows() {
  const ctx = state.ctx;
  for (let ai = 0; ai < state.arrows.length; ai++) {
    const arrow = state.arrows[ai];
    const startPt = getArrowEndpoint(arrow, 'start');
    const endPt = getArrowEndpoint(arrow, 'end');

    const x1 = startPt.x;
    const y1 = startPt.y;
    const x2 = endPt.x;
    const y2 = endPt.y;

    const isWholeSelected = state.selectedArrows.has(ai);
    const isEndSelected = state.arrowDragTarget && state.arrowDragTarget.arrowIdx === ai;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) continue;

    const headLen = ARROW_HEAD_LENGTH;
    const headAngle = ARROW_HEAD_ANGLE;
    const nx = dx / len;
    const ny = dy / len;
    const shorten = headLen * Math.cos(headAngle);
    const lineLen = Math.max(len - shorten, 0);
    const t = lineLen / len;
    const lineEndX = x1 + dx * t;
    const lineEndY = y1 + dy * t;

    ctx.strokeStyle = arrow.color || DEFAULT_ARROW_COLOR;
    ctx.lineWidth = isWholeSelected ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(lineEndX, lineEndY);
    ctx.stroke();

    ctx.fillStyle = arrow.color || DEFAULT_ARROW_COLOR;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - headLen * Math.cos(Math.atan2(dy, dx) - headAngle),
      y2 - headLen * Math.sin(Math.atan2(dy, dx) - headAngle)
    );
    ctx.lineTo(
      x2 - headLen * Math.cos(Math.atan2(dy, dx) + headAngle),
      y2 - headLen * Math.sin(Math.atan2(dy, dx) + headAngle)
    );
    ctx.closePath();
    ctx.fill();

    const isStartDrag = state.isDraggingArrowEnd && state.arrowDragTarget && state.arrowDragTarget.arrowIdx === ai && state.arrowDragTarget.end === 'start';
    const isEndDrag = state.isDraggingArrowEnd && state.arrowDragTarget && state.arrowDragTarget.arrowIdx === ai && state.arrowDragTarget.end === 'end';
    const dstStart = Math.sqrt((state.lastWorldMouse.x - x1) ** 2 + (state.lastWorldMouse.y - y1) ** 2);
    const dstEnd = Math.sqrt((state.lastWorldMouse.x - x2) ** 2 + (state.lastWorldMouse.y - y2) ** 2);
    const isStartHover = !state.isDraggingArrowEnd && !state.isDraggingArrowBody && dstStart <= ARROW_END_HIT_RADIUS;
    const isEndHover = !state.isDraggingArrowEnd && !state.isDraggingArrowBody && dstEnd <= ARROW_END_HIT_RADIUS;

    if (isStartDrag || isStartHover) {
      drawArrowHandle(ctx, x1, y1);
    }
    if (isEndDrag || isEndHover) {
      drawArrowHandle(ctx, x2, y2);
    }
  }
}

function drawArrowHandle(ctx, x, y) {
  const r = ARROW_END_RADIUS;
  ctx.save();
  ctx.fillStyle = '#6bb5ff';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function hitTestArrowEnd(wx, wy) {
  let best = null;
  let bestDist = ARROW_END_HIT_RADIUS;
  for (let ai = 0; ai < state.arrows.length; ai++) {
    const arrow = state.arrows[ai];
    for (const which of ['start', 'end']) {
      const pt = getArrowEndpoint(arrow, which);
      const d = Math.sqrt((wx - pt.x) ** 2 + (wy - pt.y) ** 2);
      if (d < bestDist) {
        bestDist = d;
        best = { arrowIdx: ai, end: which };
      }
    }
  }
  return best;
}

export function hitTestArrowBody(wx, wy) {
  for (let ai = 0; ai < state.arrows.length; ai++) {
    const arrow = state.arrows[ai];
    const startPt = getArrowEndpoint(arrow, 'start');
    const endPt = getArrowEndpoint(arrow, 'end');
    const x1 = startPt.x;
    const y1 = startPt.y;
    const x2 = endPt.x;
    const y2 = endPt.y;

    const abx = x2 - x1;
    const aby = y2 - y1;
    const len2 = abx * abx + aby * aby;
    if (len2 < 0.001) continue;
    let t = ((wx - x1) * abx + (wy - y1) * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = x1 + t * abx;
    const py = y1 + t * aby;
    const d = Math.sqrt((wx - px) ** 2 + (wy - py) ** 2);
    if (d < ARROW_BODY_HIT_THRESHOLD) return ai;
  }
  return -1;
}

export function isArrowInBox(arrow, bx1, by1, bx2, by2) {
  const startPt = getArrowEndpoint(arrow, 'start');
  const endPt = getArrowEndpoint(arrow, 'end');
  const x1 = startPt.x, y1 = startPt.y;
  const x2 = endPt.x, y2 = endPt.y;

  if (x1 >= bx1 && x1 <= bx2 && y1 >= by1 && y1 <= by2) return true;
  if (x2 >= bx1 && x2 <= bx2 && y2 >= by1 && y2 <= by2) return true;

  const x1l = x1 < bx1, x1r = x1 > bx2, y1t = y1 < by1, y1b = y1 > by2;
  const x2l = x2 < bx1, x2r = x2 > bx2, y2t = y2 < by1, y2b = y2 > by2;
  if ((x1l && x2l) || (x1r && x2r) || (y1t && y2t) || (y1b && y2b)) return false;

  return true;
}
