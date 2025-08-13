// gridDraw.js
import { gridSettings } from './gridSettings.js';

// offsetX/offsetY in CSS pixels. dpr applied here.
export function drawGrid(ctx, canvas, offsetX, offsetY, scale, dpr = 1) {
  // world -> device transform
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offsetX * dpr, offsetY * dpr);

  // visible bounds in world units
  const minWorldX = (0 - offsetX) / scale;
  const maxWorldX = (canvas.width / dpr - offsetX) / scale;
  const minWorldY = (0 - offsetY) / scale;
  const maxWorldY = (canvas.height / dpr - offsetY) / scale;

  // background (world coords)
  ctx.fillStyle = gridSettings.backgroundColor;
  ctx.fillRect(minWorldX, minWorldY, maxWorldX - minWorldX, maxWorldY - minWorldY);

  // grid lines ~1 device pixel
  ctx.strokeStyle = gridSettings.lineColor;
  ctx.lineWidth = gridSettings.lineWidth / (scale * dpr);

  const s = gridSettings.spacing;
  const startX = Math.floor(minWorldX / s) * s;
  const endX = Math.ceil(maxWorldX / s) * s;
  for (let x = startX; x <= endX; x += s) {
    ctx.beginPath();
    ctx.moveTo(x, minWorldY);
    ctx.lineTo(x, maxWorldY);
    ctx.stroke();
  }

  const startY = Math.floor(minWorldY / s) * s;
  const endY = Math.ceil(maxWorldY / s) * s;
  for (let y = startY; y <= endY; y += s) {
    ctx.beginPath();
    ctx.moveTo(minWorldX, y);
    ctx.lineTo(maxWorldX, y);
    ctx.stroke();
  }
}