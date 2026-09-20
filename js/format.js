export const FORMAT_IDENTIFIER = 'canvaswebtool-document';
export const FORMAT_VERSION = 1;
export const FILE_EXTENSION = '.cvdoc';

/**
 * Entities are stored as-is. The copy matters: callers such as
 * `extractImageAssets` replace fields on the serialised document, and must not
 * reach through into the live entities the user is still editing.
 */
function copyEntities(list) {
  return (list || []).map((entity) => ({ ...entity }));
}

export function serializeDocument(state) {
  const { connections, arrows, shapes, textBoxes, connectors, viewport, settings } = state;
  const now = new Date().toISOString();

  return {
    format: FORMAT_IDENTIFIER,
    version: FORMAT_VERSION,
    metadata: {
      created: now,
      modified: now,
    },
    document: {
      settings: settings ?? {},
      viewport: {
        offsetX: viewport.offsetX ?? 0,
        offsetY: viewport.offsetY ?? 0,
        scale: viewport.scale ?? 1,
      },
      arrows: copyEntities(arrows),
      shapes: copyEntities(shapes),
      textBoxes: copyEntities(textBoxes),
      connectors: copyEntities(connectors),
      // Bezier connections were previously written by no one and read by
      // deserializeDocument, so every save silently dropped them.
      connections: copyEntities(connections),
    },
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

/** MIME subtypes whose natural file extension differs from the subtype name. */
const ASSET_EXTENSIONS = {
  jpeg: 'jpg',
  'svg+xml': 'svg',
  'x-icon': 'ico',
};

function assetExtension(dataUrl) {
  const subtype = dataUrl.slice(5).split(';')[0].split('/')[1] || 'png';
  const normalised = ASSET_EXTENSIONS[subtype] || subtype;
  // Anything unexpected falls back to png rather than producing an odd filename.
  return /^[a-z0-9]{1,5}$/i.test(normalised) ? normalised.toLowerCase() : 'png';
}

/**
 * Move embedded images out of a serialised document and into a list of assets
 * to be written alongside it, leaving an `assetPath` reference behind.
 *
 * The image object is replaced rather than edited: `serializeDocument` makes
 * shallow copies of each shape, so mutating `shape.image` in place would strip
 * the source out of the live document the user is still looking at.
 */
export function extractImageAssets(docState) {
  const assets = [];
  for (const shape of docState.shapes || []) {
    const image = shape.image;
    if (!image || typeof image.src !== 'string' || !image.src.startsWith('data:')) continue;

    const fileName = `img_${simpleHash(image.src).toString(36)}.${assetExtension(image.src)}`;
    assets.push({ fileName, dataUrl: image.src });
    shape.image = { ...image, src: undefined, assetPath: fileName };
  }
  return assets;
}

/** Inverse of extractImageAssets: fold stored assets back into the document. */
export function embedImageAssets(docState, assetsMap) {
  for (const shape of docState.shapes || []) {
    const image = shape.image;
    if (!image || !image.assetPath || !assetsMap[image.assetPath]) continue;

    shape.image = { ...image, src: assetsMap[image.assetPath] };
    delete shape.image.assetPath;
  }
}

/** Deterministic 32-bit content hash, so identical images share one asset file. */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
