export const TOOLS = {
  CURSOR: 'cursor',
  ARROW: 'arrow',
  CONNECTION_LINE: 'connectionLine',
  TEXT: 'text',
  SHAPES: 'shapes',
  IMAGE_CONTAINER: 'imageContainer',
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
