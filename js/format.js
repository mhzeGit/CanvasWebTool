export const FORMAT_IDENTIFIER = 'canvaswebtool-document';
export const FORMAT_VERSION = 1;
export const FILE_EXTENSION = '.cvdoc';

function serializeArrow(arrow) {
  return { ...arrow };
}

function serializeShape(shape) {
  return { ...shape };
}

function serializeTextBox(textBox) {
  return { ...textBox };
}

function serializeConnector(connector) {
  return { ...connector };
}

export function serializeDocument(state) {
  const { connections, arrows, shapes, textBoxes, connectors, viewport, settings } = state;
  const now = new Date().toISOString();

  return {
    format: FORMAT_IDENTIFIER,
    version: FORMAT_VERSION,
    metadata: {
      created: now,
      modified: now
    },
    document: {
      settings: settings ?? {},
      viewport: {
        offsetX: viewport.offsetX ?? 0,
        offsetY: viewport.offsetY ?? 0,
        scale: viewport.scale ?? 1
      },
      arrows: (arrows || []).map(serializeArrow),
      shapes: (shapes || []).map(serializeShape),
      textBoxes: (textBoxes || []).map(serializeTextBox),
      connectors: (connectors || []).map(serializeConnector),
    }
  };
}

export function deserializeDocument(doc) {
  if (!doc || !doc.document) {
    throw new Error('Invalid document: missing document section');
  }

  const docBody = doc.document;

  const vp = docBody.viewport || {};

  return {
    nodes: docBody.elements || [],
    connections: docBody.connections || [],
    arrows: docBody.arrows || [],
    shapes: docBody.shapes || [],
    textBoxes: docBody.textBoxes || [],
    connectors: docBody.connectors || [],
    viewport: {
      offsetX: vp.offsetX ?? 0,
      offsetY: vp.offsetY ?? 0,
      scale: vp.scale ?? 1
    },
    settings: docBody.settings ?? {}
  };
}

export function migrateDocument(doc) {
  return { ...doc };
}
