import { state } from './state.js';
import { DEFAULT_CONN_COLOR } from './config.js';

export function drawConnectors() {
  const ctx = state.ctx;
  for (let ci = 0; ci < state.connectors.length; ci++) {
    const conn = state.connectors[ci];
    const isSelected = state.selectedConnectors.has(ci);

    ctx.strokeStyle = conn.color || DEFAULT_CONN_COLOR;
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(conn.x1, conn.y1);
    ctx.lineTo(conn.x2, conn.y2);
    ctx.stroke();

    if (isSelected) {
      const r = 5;
      ctx.fillStyle = '#f0c800';
      ctx.beginPath();
      ctx.arc(conn.x1, conn.y1, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(conn.x2, conn.y2, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function drawConnectorPreview() {
  if (!state.drawingTool || state.drawingTool !== 'connector') return;
  const ctx = state.ctx;
  ctx.beginPath();
  ctx.moveTo(state.drawingStartX, state.drawingStartY);
  ctx.lineTo(state.lastWorldMouse.x, state.lastWorldMouse.y);
  ctx.strokeStyle = 'rgba(107, 181, 255, 0.5)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawArrowPreview() {
  if (!state.drawingTool || state.drawingTool !== 'arrow') return;
  const ctx = state.ctx;
  const x1 = state.drawingStartX;
  const y1 = state.drawingStartY;
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
}

export function hitTestConnector(wx, wy) {
  const THRESHOLD = 6;
  for (let ci = 0; ci < state.connectors.length; ci++) {
    const conn = state.connectors[ci];
    const abx = conn.x2 - conn.x1;
    const aby = conn.y2 - conn.y1;
    const len2 = abx * abx + aby * aby;
    if (len2 < 0.001) continue;
    let t = ((wx - conn.x1) * abx + (wy - conn.y1) * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = conn.x1 + t * abx;
    const py = conn.y1 + t * aby;
    const d = Math.sqrt((wx - px) ** 2 + (wy - py) ** 2);
    if (d < THRESHOLD) return ci;
  }
  return -1;
}

export function isConnectorInBox(conn, bx1, by1, bx2, by2) {
  const in1 = conn.x1 >= bx1 && conn.x1 <= bx2 && conn.y1 >= by1 && conn.y1 <= by2;
  const in2 = conn.x2 >= bx1 && conn.x2 <= bx2 && conn.y2 >= by1 && conn.y2 <= by2;
  if (in1 || in2) return true;
  const x1l = conn.x1 < bx1, x1r = conn.x1 > bx2, y1t = conn.y1 < by1, y1b = conn.y1 > by2;
  const x2l = conn.x2 < bx1, x2r = conn.x2 > bx2, y2t = conn.y2 < by1, y2b = conn.y2 > by2;
  if ((x1l && x2l) || (x1r && x2r) || (y1t && y2t) || (y1b && y2b)) return false;
  return true;
}
