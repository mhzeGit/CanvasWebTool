export const TOOLS = {
  CURSOR: 'cursor',
  ARROW: 'arrow',
  CONNECTION_LINE: 'connectionLine',
  NODE: 'node',
  TEXT: 'text',
  SHAPES: 'shapes',
};

let activeTool = TOOLS.CURSOR;
let shapeSubType = 'rectangle';
let onChangeCallback = null;

export function getActiveTool() {
  return activeTool;
}

export function setActiveTool(tool, subType) {
  activeTool = tool;
  if (subType !== undefined) {
    shapeSubType = subType;
  }
  if (onChangeCallback) onChangeCallback(tool);
}

export function getShapeSubType() {
  return shapeSubType;
}

export function setShapeSubType(type) {
  shapeSubType = type;
}

export function onToolChange(cb) {
  onChangeCallback = cb;
}
