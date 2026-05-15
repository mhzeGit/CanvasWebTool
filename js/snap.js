import { GRID } from './config.js';

export function getSnapIncrement(scale) {
  for (const level of GRID.gridLevels) {
    const vpx = level.spacing * scale;
    if (vpx >= level.minPx && vpx <= level.maxPx) {
      return level.spacing;
    }
  }
  return GRID.gridLevels[GRID.gridLevels.length - 1].spacing;
}

export function snapValue(value, increment) {
  return Math.round(value / increment) * increment;
}

export function snapResizeBounds(start, handle, dx, dy, minW, minH, scale, ctrlHeld) {
  let newX = start.x, newY = start.y, newW = start.w, newH = start.h;

  switch (handle) {
    case 'left':   newX = start.x + dx; newW = start.w - dx; break;
    case 'right':  newW = start.w + dx; break;
    case 'top':    newY = start.y + dy; newH = start.h - dy; break;
    case 'bottom': newH = start.h + dy; break;
    case 'tl':     newX = start.x + dx; newY = start.y + dy; newW = start.w - dx; newH = start.h - dy; break;
    case 'tr':     newY = start.y + dy; newW = start.w + dx; newH = start.h - dy; break;
    case 'bl':     newX = start.x + dx; newW = start.w - dx; newH = start.h + dy; break;
    case 'br':     newW = start.w + dx; newH = start.h + dy; break;
  }

  if (ctrlHeld) {
    const inc = getSnapIncrement(scale);
    const leftMoves = handle.includes('l');
    const topMoves = handle[0] === 't';

    if (leftMoves) {
      newX = snapValue(newX, inc);
      newW = (start.x + start.w) - newX;
    } else {
      newW = snapValue(start.x + newW, inc) - start.x;
    }

    if (topMoves) {
      newY = snapValue(newY, inc);
      newH = (start.y + start.h) - newY;
    } else {
      newH = snapValue(start.y + newH, inc) - start.y;
    }
  }

  if (newW < minW) {
    if (handle.includes('l')) newX = start.x + start.w - minW;
    newW = minW;
  }
  if (newH < minH) {
    if (handle[0] === 't') newY = start.y + start.h - minH;
    newH = minH;
  }

  return { x: newX, y: newY, w: newW, h: newH };
}
