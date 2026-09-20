/**
 * The portable, ID-addressed document format.
 *
 * This is the representation agents and the CLI work with: every entity has a
 * stable string id (`tb-3`, `shp-7`) and references point at those ids rather
 * than at array positions, so a document can be edited, reordered and written
 * back without renumbering anything.
 *
 * Deliberately free of any DOM, app-state or Node dependency — the same module
 * is loaded by the renderer (`json-port.js`) and by the `canvas` CLI, so both
 * agree on the format by construction instead of by duplicated code.
 */

export const FORMAT = 'canvaswebtool-portable';
export const VERSION = 1;

export const ID_PREFIX = {
  textBox: 'tb',
  shape: 'shp',
  arrow: 'arr',
  connector: 'cnr',
  connection: 'cnn',
};

/** Defaults applied when a field is absent, matching the app's own defaults. */
export const DEFAULTS = {
  textBox: {
    w: 240, h: 160, title: '', titleColor: '#e7e7e7', text: '',
    color: '#1a1a1a', borderColor: '#444', textColor: '#ddd', fontSize: 14,
  },
  shape: {
    shapeType: 'rectangle', w: 120, h: 80,
    color: '#2b2b2b', borderColor: '#6bb5ff', borderWidth: 2,
  },
  arrow: { color: '#6bb5ff', lineWidth: 2, headSize: 14, dx: 120 },
  connector: { color: '#6bb5ff', dx: 120 },
  connection: { color: '#6bb5ff', text: '' },
};

export const ENTITY_TYPES = Object.keys(ID_PREFIX);

/** Plural key each entity type occupies inside `entities`. */
export const PLURAL = {
  textBox: 'textBoxes',
  shape: 'shapes',
  arrow: 'arrows',
  connector: 'connectors',
  connection: 'connections',
};

export const TYPE_BY_PREFIX = Object.fromEntries(
  Object.entries(ID_PREFIX).map(([type, prefix]) => [prefix, type]),
);

export const SHAPE_TYPES = ['rectangle', 'circle', 'triangle', 'diamond'];

/**
 * Fields an agent may write, as portable paths mapped to the internal property
 * they set. Anything absent is read-only by design: ids, parent links and the
 * array indices that cross-references use are all derived, and letting them be
 * set directly would corrupt the document.
 *
 * Shared by the live app and the CLI so both accept exactly the same input.
 */
export const WRITABLE_FIELDS = {
  textBox: {
    title: 'title',
    content: 'text',
    'position.x': 'x',
    'position.y': 'y',
    'size.w': 'w',
    'size.h': 'h',
    'style.backgroundColor': 'color',
    'style.borderColor': 'borderColor',
    'style.textColor': 'textColor',
    'style.titleColor': 'titleColor',
    'style.fontSize': 'fontSize',
    locked: 'locked',
  },
  shape: {
    type: 'shapeType',
    'position.x': 'x',
    'position.y': 'y',
    'size.w': 'w',
    'size.h': 'h',
    'style.backgroundColor': 'color',
    'style.borderColor': 'borderColor',
    'style.borderWidth': 'borderWidth',
    'style.cornerRadius': 'cornerRadius',
    locked: 'locked',
  },
  arrow: {
    'startPoint.x': 'x1',
    'startPoint.y': 'y1',
    'endPoint.x': 'x2',
    'endPoint.y': 'y2',
    'style.color': 'color',
    'style.lineWidth': 'lineWidth',
    'style.headSize': 'headSize',
    locked: 'locked',
  },
  connector: {
    'startPoint.x': 'x1',
    'startPoint.y': 'y1',
    'endPoint.x': 'x2',
    'endPoint.y': 'y2',
    'style.color': 'color',
    locked: 'locked',
  },
  connection: {
    label: 'text',
    'style.color': 'color',
    locked: 'locked',
  },
};

export function portableId(type, numericId) {
  return `${ID_PREFIX[type]}-${numericId}`;
}

/** The entity type a portable id addresses, or null if the prefix is unknown. */
export function typeOfId(id) {
  return TYPE_BY_PREFIX[parsePortableId(id).prefix] || null;
}

/** Turn `{style: {color: 'x'}}` into `{'style.color': 'x'}`. */
export function flattenFields(value, prefix = '', out = {}) {
  for (const [key, entry] of Object.entries(value || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) flattenFields(entry, path, out);
    else out[path] = entry;
  }
  return out;
}

/** Write `'style.color'` into a nested object, creating levels as needed. */
export function setFieldPath(target, path, value) {
  const parts = path.split('.');
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cursor[parts[i]] || typeof cursor[parts[i]] !== 'object') cursor[parts[i]] = {};
    cursor = cursor[parts[i]];
  }
  cursor[parts.at(-1)] = value;
}

/**
 * Check a set of flattened field paths against the schema for `type`.
 * @returns {string[]} the paths that are not writable
 */
export function unknownFields(type, flat) {
  const allowed = WRITABLE_FIELDS[type] || {};
  return Object.keys(flat).filter((path) => allowed[path] === undefined);
}

/** Split `shp-12` into its prefix and numeric id; `numericId` is 0 if absent. */
export function parsePortableId(id) {
  const text = String(id ?? '');
  const dash = text.indexOf('-');
  if (dash < 0) return { prefix: text, numericId: 0 };
  const numericId = parseInt(text.slice(dash + 1), 10);
  return { prefix: text.slice(0, dash), numericId: Number.isNaN(numericId) ? 0 : numericId };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Turn an index-referencing endpoint (`connectedFrom` / `connectedFromType`)
 * into a portable `{ entityId, type }` reference.
 */
function refFromIndex(doc, index, type) {
  if (index === null || index === undefined || !type) return null;
  const list = type === 'textBox' ? doc.textBoxes : type === 'shape' ? doc.shapes : null;
  const entity = list?.[index];
  return entity ? { entityId: portableId(type, entity.id), type } : null;
}

/**
 * @param {object} doc plain document: `{ textBoxes, shapes, arrows, connectors,
 *   connections, viewport }` with index-based cross references.
 * @returns {object} portable JSON, ready to serialise.
 */
export function toPortable(doc) {
  const textBoxes = (doc.textBoxes || []).map((tb) => ({
    id: portableId('textBox', tb.id),
    title: tb.title || '',
    position: { x: tb.x, y: tb.y },
    size: { w: tb.w, h: tb.h },
    style: {
      backgroundColor: tb.color,
      borderColor: tb.borderColor,
      textColor: tb.textColor,
      titleColor: tb.titleColor,
      fontSize: tb.fontSize,
    },
    content: tb.text || '',
    blocks: tb.blocks ? structuredCloneish(tb.blocks) : null,
    parent: tb.parentId ? { entityId: portableId(tb.parentType || 'textBox', tb.parentId), type: tb.parentType } : null,
    locked: !!tb.locked,
  }));

  const shapes = (doc.shapes || []).map((s) => ({
    id: portableId('shape', s.id),
    type: s.shapeType,
    position: { x: s.x, y: s.y },
    size: { w: s.w, h: s.h },
    style: {
      backgroundColor: s.color,
      borderColor: s.borderColor,
      borderWidth: s.borderWidth,
      cornerRadius: s.cornerRadius,
    },
    image: s.image ? { src: s.image.src || null, fileName: s.image.fileName || '' } : null,
    parent: s.parentId ? { entityId: portableId(s.parentType || 'shape', s.parentId), type: s.parentType } : null,
    locked: !!s.locked,
  }));

  const arrows = (doc.arrows || []).map((a) => ({
    id: portableId('arrow', a.id),
    startPoint: { x: a.x1, y: a.y1 },
    endPoint: { x: a.x2, y: a.y2 },
    connectedFrom: refFromIndex(doc, a.connectedFrom, a.connectedFromType),
    connectedTo: refFromIndex(doc, a.connectedTo, a.connectedToType),
    style: { color: a.color, lineWidth: a.lineWidth, headSize: a.headSize },
    locked: !!a.locked,
  }));

  const connectors = (doc.connectors || []).map((c) => ({
    id: portableId('connector', c.id),
    startPoint: { x: c.x1, y: c.y1 },
    endPoint: { x: c.x2, y: c.y2 },
    connectedFrom: refFromIndex(doc, c.connectedFrom, c.connectedFromType),
    connectedTo: refFromIndex(doc, c.connectedTo, c.connectedToType),
    style: { color: c.color },
    locked: !!c.locked,
  }));

  const connections = (doc.connections || []).map((cn) => {
    const from = doc.textBoxes?.[cn.from];
    const to = doc.textBoxes?.[cn.to];
    return {
      id: portableId('connection', cn.id),
      from: from ? portableId('textBox', from.id) : null,
      to: to ? portableId('textBox', to.id) : null,
      style: { color: cn.color },
      label: cn.text || '',
      locked: !!cn.locked,
    };
  });

  const viewport = doc.viewport || {};
  return {
    meta: { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString() },
    viewport: {
      offsetX: viewport.offsetX ?? 0,
      offsetY: viewport.offsetY ?? 0,
      scale: viewport.scale ?? 1,
    },
    entities: { textBoxes, shapes, arrows, connectors, connections },
  };
}

/** structuredClone is unavailable in some embedders; JSON round-trip is enough here. */
function structuredCloneish(value) {
  return JSON.parse(JSON.stringify(value));
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export function isPortable(json) {
  return !!json && json.meta?.format === FORMAT;
}

function num(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function pick(value, fallback) {
  return value === undefined || value === null ? fallback : value;
}

/**
 * Resolve a portable reference to `{ index, type }` using the lookup tables
 * built while entities were created.
 */
function refToIndex(ref, indexById) {
  const entityId = typeof ref === 'string' ? ref : ref?.entityId;
  if (!entityId) return { index: null, type: null };
  if (entityId in indexById.textBox) return { index: indexById.textBox[entityId], type: 'textBox' };
  if (entityId in indexById.shape) return { index: indexById.shape[entityId], type: 'shape' };
  return { index: null, type: null };
}

/**
 * Convert portable JSON back into the app's internal document shape.
 *
 * @returns {{document: object, nextIds: object}} entities with index-based
 *   references, plus the next free numeric id per entity type.
 */
export function fromPortable(json) {
  if (!isPortable(json)) {
    throw new Error(`Not a ${FORMAT} document`);
  }

  const entities = json.entities || {};
  const source = {
    textBoxes: entities.textBoxes || [],
    shapes: entities.shapes || [],
    arrows: entities.arrows || [],
    connectors: entities.connectors || [],
    connections: entities.connections || [],
  };

  const indexById = { textBox: {}, shape: {} };

  // Ids are assigned in two steps so that an entity which arrives without one
  // can never be handed an id that a later entity claims explicitly.
  const maxId = { textBox: 0, shape: 0, arrow: 0, connector: 0, connection: 0 };
  const LISTS = {
    textBox: source.textBoxes, shape: source.shapes, arrow: source.arrows,
    connector: source.connectors, connection: source.connections,
  };
  for (const [type, list] of Object.entries(LISTS)) {
    for (const raw of list) {
      const { numericId } = parsePortableId(raw?.id);
      if (numericId > maxId[type]) maxId[type] = numericId;
    }
  }
  const nextFreeId = { ...maxId };

  const idFor = (type, rawId) => {
    const { numericId } = parsePortableId(rawId);
    return numericId > 0 ? numericId : ++nextFreeId[type];
  };

  const d = DEFAULTS;

  const textBoxes = source.textBoxes.map((e, i) => {
    const style = e.style || {};
    indexById.textBox[e.id] = i;
    return {
      id: idFor('textBox', e.id),
      x: num(e.position?.x, 0),
      y: num(e.position?.y, 0),
      w: num(e.size?.w, d.textBox.w),
      h: num(e.size?.h, d.textBox.h),
      title: e.title || d.textBox.title,
      titleColor: pick(style.titleColor, d.textBox.titleColor),
      text: e.content || d.textBox.text,
      blocks: e.blocks || null,
      color: pick(style.backgroundColor, d.textBox.color),
      borderColor: pick(style.borderColor, d.textBox.borderColor),
      textColor: pick(style.textColor, d.textBox.textColor),
      fontSize: pick(style.fontSize, d.textBox.fontSize),
      parentId: null,
      parentType: null,
      locked: !!e.locked,
    };
  });

  const shapes = source.shapes.map((e, i) => {
    const style = e.style || {};
    const shapeType = e.type || d.shape.shapeType;
    indexById.shape[e.id] = i;
    return {
      id: idFor('shape', e.id),
      shapeType,
      x: num(e.position?.x, 0),
      y: num(e.position?.y, 0),
      w: num(e.size?.w, d.shape.w),
      h: num(e.size?.h, d.shape.h),
      color: pick(style.backgroundColor, d.shape.color),
      borderColor: pick(style.borderColor, d.shape.borderColor),
      borderWidth: pick(style.borderWidth, d.shape.borderWidth),
      cornerRadius: pick(style.cornerRadius, shapeType === 'rectangle' ? 4 : 0),
      image: e.image ? { id: 0, src: e.image.src || null, fileName: e.image.fileName || '' } : null,
      parentId: null,
      parentType: null,
      locked: !!e.locked,
    };
  });

  // Parents are resolved in a second pass: a child may appear before its parent.
  const resolveParent = (entity, raw) => {
    if (!raw.parent) return;
    const { index, type } = refToIndex(raw.parent, indexById);
    if (index === null) return;
    const parent = type === 'textBox' ? textBoxes[index] : shapes[index];
    if (!parent || parent === entity) return;
    entity.parentId = parent.id;
    entity.parentType = type;
  };
  source.textBoxes.forEach((raw, i) => resolveParent(textBoxes[i], raw));
  source.shapes.forEach((raw, i) => resolveParent(shapes[i], raw));

  const lineEndpoints = (raw, defaults) => {
    const from = refToIndex(raw.connectedFrom, indexById);
    const to = refToIndex(raw.connectedTo, indexById);
    return {
      x1: num(raw.startPoint?.x, 0),
      y1: num(raw.startPoint?.y, 0),
      x2: num(raw.endPoint?.x, defaults.dx),
      y2: num(raw.endPoint?.y, 0),
      connectedFrom: from.index,
      connectedFromType: from.type,
      connectedTo: to.index,
      connectedToType: to.type,
    };
  };

  const arrows = source.arrows.map((raw) => {
    const style = raw.style || {};
    return {
      id: idFor('arrow', raw.id),
      ...lineEndpoints(raw, d.arrow),
      color: pick(style.color, d.arrow.color),
      lineWidth: pick(style.lineWidth, d.arrow.lineWidth),
      headSize: pick(style.headSize, d.arrow.headSize),
      locked: !!raw.locked,
    };
  });

  const connectors = source.connectors.map((raw) => {
    const style = raw.style || {};
    return {
      id: idFor('connector', raw.id),
      ...lineEndpoints(raw, d.connector),
      color: pick(style.color, d.connector.color),
      locked: !!raw.locked,
    };
  });

  // Connections only join text boxes, and a dangling one cannot be drawn.
  const connections = [];
  for (const raw of source.connections) {
    const from = indexById.textBox[raw.from];
    const to = indexById.textBox[raw.to];
    if (from === undefined || to === undefined) continue;
    connections.push({
      id: idFor('connection', raw.id),
      from,
      to,
      color: pick(raw.style?.color, d.connection.color),
      text: raw.label || d.connection.text,
      locked: !!raw.locked,
    });
  }

  const viewport = json.viewport || {};
  return {
    document: {
      textBoxes,
      shapes,
      arrows,
      connectors,
      connections,
      viewport: {
        offsetX: num(viewport.offsetX, 0),
        offsetY: num(viewport.offsetY, 0),
        scale: num(viewport.scale, 1),
      },
    },
    nextIds: {
      textBox: nextFreeId.textBox + 1,
      shape: nextFreeId.shape + 1,
      arrow: nextFreeId.arrow + 1,
      connector: nextFreeId.connector + 1,
      connection: nextFreeId.connection + 1,
    },
  };
}
