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

function serializeImageContainer(container) {
  return { ...container };
}

export function serializeDocument(state) {
  const { connections, arrows, shapes, textBoxes, connectors, imageContainers, viewport, settings } = state;
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
      imageContainers: (imageContainers || []).map(serializeImageContainer),
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
    imageContainers: docBody.imageContainers || [],
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

export function extractImageAssets(docState) {
  const assets = [];
  const containerArr = docState.imageContainers || [];
  for (const c of containerArr) {
    if (c.image && c.image.src && c.image.src.startsWith('data:')) {
      const ext = c.image.src.split(';')[0].split('/')[1] || 'png';
      const hash = simpleHash(c.image.src).toString(36);
      const fileName = `img_${hash}.${ext}`;
      const dataUrl = c.image.src;
      c.image.src = undefined;
      c.image.assetPath = fileName;
      assets.push({ fileName, dataUrl });
    }
  }
  return assets;
}

export function embedImageAssets(docState, assetsMap) {
  const containerArr = docState.imageContainers || [];
  for (const c of containerArr) {
    if (c.image && c.image.assetPath && assetsMap[c.image.assetPath]) {
      c.image.src = assetsMap[c.image.assetPath];
      delete c.image.assetPath;
    }
  }
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}
