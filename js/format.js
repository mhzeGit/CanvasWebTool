export const FORMAT_IDENTIFIER = 'canvaswebtool-document';
export const FORMAT_VERSION = 1;
export const FILE_EXTENSION = '.cvdoc';

function serializeElement(node) {
  const { id, x, y, w, h, ...properties } = node;
  return {
    id,
    type: 'node',
    geometry: { x, y, w, h },
    properties
  };
}

function deserializeElement(element) {
  const geom = element.geometry || {};
  const props = element.properties || {};
  return {
    id: element.id,
    x: geom.x ?? 0,
    y: geom.y ?? 0,
    w: geom.w ?? 240,
    h: geom.h ?? 160,
    ...props
  };
}

function serializeConnection(conn, nodes) {
  const { id, from, to, ...extra } = conn;
  return {
    id,
    from: nodes[conn.from]?.id ?? null,
    to: nodes[conn.to]?.id ?? null,
    properties: extra
  };
}

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
  const { nodes, connections, arrows, shapes, textBoxes, connectors, viewport, settings } = state;
  const now = new Date().toISOString();

  const elements = nodes.map(serializeElement);

  const conns = connections.map(c => serializeConnection(c, nodes))
    .filter(c => c.from !== null && c.to !== null);

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
      elements,
      connections: conns,
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

  const nodes = [];
  const idToIndex = new Map();

  for (const el of (docBody.elements || [])) {
    const idx = nodes.length;
    nodes.push(deserializeElement(el));
    idToIndex.set(el.id, idx);
  }

  const connections = [];
  for (const conn of (docBody.connections || [])) {
    const fromIdx = idToIndex.get(conn.from);
    const toIdx = idToIndex.get(conn.to);
    if (fromIdx !== undefined && toIdx !== undefined) {
      const { from, to, properties, ...meta } = conn;
      connections.push({ id: meta.id, from: fromIdx, to: toIdx, ...(properties ?? {}) });
    }
  }

  const vp = docBody.viewport || {};

  return {
    nodes,
    connections,
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
