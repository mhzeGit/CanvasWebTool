import { state } from './state.js';
import { DEFAULT_CONN_COLOR } from './config.js';
import { getObjectEdgePoint } from './utils.js';

const END_HIT_RADIUS = 8;
const BODY_HIT_THRESHOLD = 6;

function getConnectedObject(conn, which) {
  const idx = which === 'start' ? conn.connectedFrom : conn.connectedTo;
  const type = which === 'start' ? conn.connectedFromType : conn.connectedToType;
  if (idx === null || idx === undefined) return null;
  const resolvedType = type || 'textBox';
  if (resolvedType === 'textBox' && state.textBoxes[idx]) return state.textBoxes[idx];
  if (resolvedType === 'shape' && state.shapes[idx]) return state.shapes[idx];
  return null;
  return null;
}

function getOtherEndpoint(conn, which) {
  if (which === 'start') {
    const other = getConnectedObject(conn, 'end');
    return other ? getObjectEdgePoint(other, conn.x1, conn.y1) : { x: conn.x2, y: conn.y2 };
  } else {
    const other = getConnectedObject(conn, 'start');
    return other ? getObjectEdgePoint(other, conn.x2, conn.y2) : { x: conn.x1, y: conn.y1 };
  }
}

export function getConnectorEndpoint(conn, which) {
  const obj = getConnectedObject(conn, which);
  if (obj) {
    const otherPt = getOtherEndpoint(conn, which);
    return getObjectEdgePoint(obj, otherPt.x, otherPt.y);
  }
  return which === 'start' ? { x: conn.x1, y: conn.y1 } : { x: conn.x2, y: conn.y2 };
}

export function updateConnectorPositionsFromConnections() {
  for (const conn of state.connectors) {
    const startObj = getConnectedObject(conn, 'start');
    const endObj = getConnectedObject(conn, 'end');

    if (startObj) {
      const refPt = endObj ? { x: endObj.x + endObj.w / 2, y: endObj.y + endObj.h / 2 } : { x: conn.x2, y: conn.y2 };
      const edge = getObjectEdgePoint(startObj, refPt.x, refPt.y);
      conn.x1 = edge.x;
      conn.y1 = edge.y;
    }
    if (endObj) {
      const refPt = startObj ? { x: startObj.x + startObj.w / 2, y: startObj.y + startObj.h / 2 } : { x: conn.x1, y: conn.y1 };
      const edge = getObjectEdgePoint(endObj, refPt.x, refPt.y);
      conn.x2 = edge.x;
      conn.y2 = edge.y;
    }
  }
}

export function drawConnectors() {
  const ctx = state.ctx;
  for (let ci = 0; ci < state.connectors.length; ci++) {
    const conn = state.connectors[ci];
    const startPt = getConnectorEndpoint(conn, 'start');
    const endPt = getConnectorEndpoint(conn, 'end');
    const isSelected = state.selectedConnectors.has(ci);

    ctx.strokeStyle = conn.color || DEFAULT_CONN_COLOR;
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(startPt.x, startPt.y);
    ctx.lineTo(endPt.x, endPt.y);
    ctx.stroke();

    if (isSelected) {
      const r = 5;
      ctx.fillStyle = '#f0c800';
      ctx.beginPath();
      ctx.arc(startPt.x, startPt.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(endPt.x, endPt.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function drawConnectorPreview() {
  if (!state.drawingTool || state.drawingTool !== 'connector') return;
  const ctx = state.ctx;
  let x1 = state.drawingStartX;
  let y1 = state.drawingStartY;

  if (state.drawingStartConnected) {
    const { type, index } = state.drawingStartConnected;
    let obj = null;
    if (type === 'textBox' && state.textBoxes[index]) obj = state.textBoxes[index];
    else if (type === 'shape' && state.shapes[index]) obj = state.shapes[index];
    if (obj) {
      const edge = getObjectEdgePoint(obj, state.lastWorldMouse.x, state.lastWorldMouse.y);
      x1 = edge.x;
      y1 = edge.y;
    }
  }

  const x2 = state.lastWorldMouse.x;
  const y2 = state.lastWorldMouse.y;

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = 'rgba(107, 181, 255, 0.5)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  if (state.drawingStartConnected) {
    ctx.fillStyle = 'rgba(107, 181, 255, 0.4)';
    ctx.beginPath();
    ctx.arc(x1, y1, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawArrowPreview() {
  if (!state.drawingTool || state.drawingTool !== 'arrow') return;
  const ctx = state.ctx;
  let x1 = state.drawingStartX;
  let y1 = state.drawingStartY;

  if (state.drawingStartConnected) {
    const { type, index } = state.drawingStartConnected;
    let obj = null;
    if (type === 'textBox' && state.textBoxes[index]) obj = state.textBoxes[index];
    else if (type === 'shape' && state.shapes[index]) obj = state.shapes[index];
    if (obj) {
      const edge = getObjectEdgePoint(obj, state.lastWorldMouse.x, state.lastWorldMouse.y);
      x1 = edge.x;
      y1 = edge.y;
    }
  }

  const x2 = state.lastWorldMouse.x;
  const y2 = state.lastWorldMouse.y;

  const headLen = 14;
  const headAngle = Math.PI / 6;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) return;
  const nx = dx / len;
  const ny = dy / len;
  const shorten = headLen * Math.cos(headAngle);
  const lineLen = Math.max(len - shorten, 0);
  const t = lineLen / len;
  const lineEndX = x1 + dx * t;
  const lineEndY = y1 + dy * t;

  ctx.strokeStyle = 'rgba(107, 181, 255, 0.5)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(lineEndX, lineEndY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(107, 181, 255, 0.5)';
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

  if (state.drawingStartConnected) {
    ctx.fillStyle = 'rgba(107, 181, 255, 0.4)';
    ctx.beginPath();
    ctx.arc(x1, y1, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function hitTestConnector(wx, wy) {
  for (let ci = 0; ci < state.connectors.length; ci++) {
    const conn = state.connectors[ci];
    const startPt = getConnectorEndpoint(conn, 'start');
    const endPt = getConnectorEndpoint(conn, 'end');
    const abx = endPt.x - startPt.x;
    const aby = endPt.y - startPt.y;
    const len2 = abx * abx + aby * aby;
    if (len2 < 0.001) continue;
    let t = ((wx - startPt.x) * abx + (wy - startPt.y) * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = startPt.x + t * abx;
    const py = startPt.y + t * aby;
    const d = Math.sqrt((wx - px) ** 2 + (wy - py) ** 2);
    if (d < BODY_HIT_THRESHOLD) return ci;
  }
  return -1;
}

export function isConnectorInBox(conn, bx1, by1, bx2, by2) {
  const startPt = getConnectorEndpoint(conn, 'start');
  const endPt = getConnectorEndpoint(conn, 'end');
  const x1 = startPt.x, y1 = startPt.y;
  const x2 = endPt.x, y2 = endPt.y;

  const in1 = x1 >= bx1 && x1 <= bx2 && y1 >= by1 && y1 <= by2;
  const in2 = x2 >= bx1 && x2 <= bx2 && y2 >= by1 && y2 <= by2;
  if (in1 || in2) return true;
  const x1l = x1 < bx1, x1r = x1 > bx2, y1t = y1 < by1, y1b = y1 > by2;
  const x2l = x2 < bx1, x2r = x2 > bx2, y2t = y2 < by1, y2b = y2 > by2;
  if ((x1l && x2l) || (x1r && x2r) || (y1t && y2t) || (y1b && y2b)) return false;
  return true;
}
