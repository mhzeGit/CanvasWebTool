import { GRID } from './config.js';

function gridOpacity(visiblePx, minPx, peakPx, maxPx) {
  if (visiblePx <= minPx || visiblePx >= maxPx) return 0;
  if (visiblePx < peakPx) {
    const t = (visiblePx - minPx) / (peakPx - minPx);
    return t * t * (3 - 2 * t);
  }
  const t = (visiblePx - peakPx) / (maxPx - peakPx);
  return 1 - t * t * (3 - 2 * t);
}

export function drawGrid(ctx, canvas, offsetX, offsetY, scale, dpr = 1) {
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offsetX * dpr, offsetY * dpr);

  const minWorldX = (0 - offsetX) / scale;
  const maxWorldX = (canvas.width / dpr - offsetX) / scale;
  const minWorldY = (0 - offsetY) / scale;
  const maxWorldY = (canvas.height / dpr - offsetY) / scale;

  ctx.fillStyle = GRID.backgroundColor;
  ctx.fillRect(minWorldX, minWorldY, maxWorldX - minWorldX, maxWorldY - minWorldY);

  const baseLineWidth = GRID.lineWidth / (scale * dpr);
  const [r, g, b] = GRID.lineColor;

  for (const level of GRID.gridLevels) {
    const visiblePx = level.spacing * scale;
    const opacity = gridOpacity(visiblePx, level.minPx, level.peakPx, level.maxPx);
    if (opacity <= 0.001) continue;

    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
    ctx.lineWidth = baseLineWidth * level.weight;

    const s = level.spacing;
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
}
