import { state } from './state.js';
import { CONN_HIT_THRESHOLD, DEFAULT_CONN_COLOR } from './config.js';
import { getNodeEdgePoint, getPointOnBezier, drawRoundedRect } from './utils.js';

export function hitTestConnection(wx, wy) {
  let bestIdx = -1;
  let bestDist = CONN_HIT_THRESHOLD;
  for (let ci = 0; ci < state.connections.length; ci++) {
    const conn = state.connections[ci];
    const fromNode = state.nodes[conn.from];
    const toNode = state.nodes[conn.to];
    if (!fromNode || !toNode) continue;

    const toCenterX = toNode.x + toNode.w / 2;
    const toCenterY = toNode.y + toNode.h / 2;
    const fromPt = getNodeEdgePoint(fromNode, toCenterX, toCenterY);
    const fromCenterX = fromNode.x + fromNode.w / 2;
    const fromCenterY = fromNode.y + fromNode.h / 2;
    const toPt = getNodeEdgePoint(toNode, fromCenterX, fromCenterY);
    const dx = toPt.x - fromPt.x;
    const dy = toPt.y - fromPt.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const cpDist = Math.min(dist * 0.5, 80);

    let cp1x = fromPt.x, cp1y = fromPt.y;
    let cp2x = toPt.x, cp2y = toPt.y;
    switch (fromPt.side) {
      case 'right': cp1x += cpDist; break;
      case 'left': cp1x -= cpDist; break;
      case 'bottom': cp1y += cpDist; break;
      case 'top': cp1y -= cpDist; break;
    }
    switch (toPt.side) {
      case 'right': cp2x += cpDist; break;
      case 'left': cp2x -= cpDist; break;
      case 'bottom': cp2y += cpDist; break;
      case 'top': cp2y -= cpDist; break;
    }

    for (let s = 0; s <= 20; s++) {
      const t = s / 20;
      const pt = getPointOnBezier(fromPt.x, fromPt.y, cp1x, cp1y, cp2x, cp2y, toPt.x, toPt.y, t);
      const dd = Math.sqrt((wx - pt.x) ** 2 + (wy - pt.y) ** 2);
      if (dd < bestDist) {
        bestDist = dd;
        bestIdx = ci;
      }
    }
  }
  return bestIdx === -1 ? null : bestIdx;
}

export function drawConnection(fromNode, toNode, conn) {
  const ctx = state.ctx;
  const toCenterX = toNode.x + toNode.w / 2;
  const toCenterY = toNode.y + toNode.h / 2;
  const fromPt = getNodeEdgePoint(fromNode, toCenterX, toCenterY);
  const fromCenterX = fromNode.x + fromNode.w / 2;
  const fromCenterY = fromNode.y + fromNode.h / 2;
  const toPt = getNodeEdgePoint(toNode, fromCenterX, fromCenterY);

  const dx = toPt.x - fromPt.x;
  const dy = toPt.y - fromPt.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const cpDist = Math.min(dist * 0.5, 80);

  let cp1x = fromPt.x, cp1y = fromPt.y;
  let cp2x = toPt.x, cp2y = toPt.y;

  switch (fromPt.side) {
    case 'right': cp1x += cpDist; break;
    case 'left': cp1x -= cpDist; break;
    case 'bottom': cp1y += cpDist; break;
    case 'top': cp1y -= cpDist; break;
  }

  switch (toPt.side) {
    case 'right': cp2x += cpDist; break;
    case 'left': cp2x -= cpDist; break;
    case 'bottom': cp2y += cpDist; break;
    case 'top': cp2y -= cpDist; break;
  }

  const connColor = conn.color || DEFAULT_CONN_COLOR;
  const selectedConn = state.selectedConnection !== null && state.connections[state.selectedConnection] === conn;
  const lineWidth = selectedConn ? 3 : 2;

  if (conn.text && conn.text.length > 0) {
    const mid = getPointOnBezier(fromPt.x, fromPt.y, cp1x, cp1y, cp2x, cp2y, toPt.x, toPt.y, 0.5);

    ctx.save();
    ctx.translate(mid.x, mid.y);
    const fontSize = 13;
    ctx.font = `bold ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif`;
    const metrics = ctx.measureText(conn.text);
    const textW = metrics.width;
    const textH = fontSize + 4;
    const pad = 6;
    const rx = -textW / 2 - pad;
    const ry = -textH / 2;
    const bw = textW + pad * 2;
    const bh = textH;
    ctx.restore();

    const dpr = window.devicePixelRatio || 1;
    const pillSX = Math.floor(((mid.x + rx) * state.scale + state.offsetX) * dpr);
    const pillSY = Math.floor(((mid.y + ry) * state.scale + state.offsetY) * dpr);
    const pillSW = Math.ceil(bw * state.scale * dpr);
    const pillSH = Math.ceil(bh * state.scale * dpr);

    let saved = null;
    if (pillSW > 0 && pillSH > 0) {
      saved = ctx.getImageData(pillSX, pillSY, pillSW, pillSH);
    }

    ctx.beginPath();
    ctx.moveTo(fromPt.x, fromPt.y);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, toPt.x, toPt.y);
    ctx.strokeStyle = connColor;
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    ctx.save();
    ctx.translate(mid.x, mid.y);
    drawRoundedRect(ctx, rx, ry, bw, bh, 6);
    ctx.clip();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(0, 0, state.ctx.canvas.width, state.ctx.canvas.height);
    ctx.restore();

    if (saved) ctx.putImageData(saved, pillSX, pillSY);

    ctx.save();
    ctx.translate(mid.x, mid.y);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 3;
    ctx.fillText(conn.text, 0, 0);
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(fromPt.x, fromPt.y);
  ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, toPt.x, toPt.y);
  ctx.strokeStyle = connColor;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

export function drawConnectionPreview(fromNode, mouseWorldX, mouseWorldY) {
  const ctx = state.ctx;
  const fromPt = getNodeEdgePoint(fromNode, mouseWorldX, mouseWorldY);

  const dx = mouseWorldX - fromPt.x;
  const dy = mouseWorldY - fromPt.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const cpDist = Math.min(dist * 0.5, 80);

  let cp1x = fromPt.x, cp1y = fromPt.y;
  switch (fromPt.side) {
    case 'right': cp1x += cpDist; break;
    case 'left': cp1x -= cpDist; break;
    case 'bottom': cp1y += cpDist; break;
    case 'top': cp1y -= cpDist; break;
  }

  ctx.beginPath();
  ctx.moveTo(fromPt.x, fromPt.y);
  ctx.quadraticCurveTo(cp1x, cp1y, mouseWorldX, mouseWorldY);
  ctx.strokeStyle = 'rgba(107, 181, 255, 0.5)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
}
