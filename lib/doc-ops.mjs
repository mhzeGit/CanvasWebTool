/**
 * Document operations for the CLI's offline mode.
 *
 * These work directly on the portable representation — the same JSON
 * `canvas read` prints — so a file can be edited without the app running. The
 * field schema, id scheme and defaults come from `js/portable-format.js`, which
 * the running app uses too, so `canvas update` accepts exactly the same input
 * whether or not the app happens to be open.
 */
import {
  DEFAULTS, ID_PREFIX, PLURAL, SHAPE_TYPES, WRITABLE_FIELDS,
  flattenFields, parsePortableId, portableId, setFieldPath, typeOfId, unknownFields,
} from '../js/portable-format.js';

export class DocError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const ALL_TYPES = Object.keys(ID_PREFIX);

function entitiesOf(doc, type) {
  const list = doc.entities?.[PLURAL[type]];
  if (!Array.isArray(list)) throw new DocError('EFORMAT', `Document has no ${PLURAL[type]} list`);
  return list;
}

function findEntity(doc, id) {
  const type = typeOfId(id);
  if (!type) {
    throw new DocError('ENOENT', `Unknown id "${id}". Expected one of ${ALL_TYPES.map((t) => `${ID_PREFIX[t]}-<n>`).join(', ')}`);
  }
  const list = entitiesOf(doc, type);
  const index = list.findIndex((entity) => entity.id === id);
  if (index < 0) throw new DocError('ENOENT', `No such entity: ${id}`);
  return { type, list, index, entity: list[index] };
}

/** Next free numeric id for a type, so new entities never collide. */
function nextId(doc, type) {
  let max = 0;
  for (const entity of entitiesOf(doc, type)) {
    const { numericId } = parsePortableId(entity.id);
    if (numericId > max) max = numericId;
  }
  return portableId(type, max + 1);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function listEntities(doc, type) {
  if (!type) {
    return Object.fromEntries(ALL_TYPES.map((t) => [PLURAL[t], entitiesOf(doc, t).map(summarise)]));
  }
  const resolved = ALL_TYPES.includes(type) ? type : ALL_TYPES.find((t) => PLURAL[t] === type);
  if (!resolved) {
    throw new DocError('EINVAL', `Unknown type "${type}". Expected one of ${ALL_TYPES.join(', ')}`);
  }
  return { [PLURAL[resolved]]: entitiesOf(doc, resolved).map(summarise) };
}

function summarise(entity) {
  const summary = { id: entity.id };
  if (entity.title) summary.title = entity.title;
  if (entity.type) summary.type = entity.type;
  if (entity.label) summary.label = entity.label;
  if (entity.position) summary.position = entity.position;
  if (entity.size) summary.size = entity.size;
  if (entity.from || entity.to) {
    summary.from = entity.from;
    summary.to = entity.to;
  }
  if (entity.connectedFrom) summary.connectedFrom = entity.connectedFrom.entityId;
  if (entity.connectedTo) summary.connectedTo = entity.connectedTo.entityId;
  if (entity.content) summary.contentLength = entity.content.length;
  if (entity.locked) summary.locked = true;
  return summary;
}

export function getEntity(doc, id) {
  return findEntity(doc, id).entity;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function addEntity(doc, type, props = {}) {
  if (!ALL_TYPES.includes(type)) {
    throw new DocError('EINVAL', `Cannot add "${type}". Expected one of ${ALL_TYPES.join(', ')}`);
  }
  if (type === 'connection') {
    return connectEntities(doc, props.from, props.to, {
      kind: 'connection', label: props.label, color: props.style?.color,
    });
  }

  const flat = flattenFields(props);
  const unknown = unknownFields(type, flat);
  if (unknown.length > 0) {
    throw new DocError('EINVAL', `Cannot set ${unknown.join(', ')} on a ${type}. Writable fields: ${Object.keys(WRITABLE_FIELDS[type]).join(', ')}`);
  }

  const entity = blankEntity(doc, type);
  applyFields(type, entity, flat);
  entitiesOf(doc, type).push(entity);
  return entity;
}

function blankEntity(doc, type) {
  const d = DEFAULTS;
  const id = nextId(doc, type);

  if (type === 'shape') {
    return {
      id,
      type: d.shape.shapeType,
      position: { x: 0, y: 0 },
      size: { w: d.shape.w, h: d.shape.h },
      style: {
        backgroundColor: d.shape.color,
        borderColor: d.shape.borderColor,
        borderWidth: d.shape.borderWidth,
        cornerRadius: 4,
      },
      image: null,
      parent: null,
      locked: false,
    };
  }
  if (type === 'textBox') {
    return {
      id,
      title: d.textBox.title,
      position: { x: 0, y: 0 },
      size: { w: d.textBox.w, h: d.textBox.h },
      style: {
        backgroundColor: d.textBox.color,
        borderColor: d.textBox.borderColor,
        textColor: d.textBox.textColor,
        titleColor: d.textBox.titleColor,
        fontSize: d.textBox.fontSize,
      },
      content: d.textBox.text,
      blocks: null,
      parent: null,
      locked: false,
    };
  }

  const isArrow = type === 'arrow';
  const line = {
    id,
    startPoint: { x: 0, y: 0 },
    endPoint: { x: isArrow ? d.arrow.dx : d.connector.dx, y: 0 },
    connectedFrom: null,
    connectedTo: null,
    style: { color: isArrow ? d.arrow.color : d.connector.color },
    locked: false,
  };
  if (isArrow) {
    line.style.lineWidth = d.arrow.lineWidth;
    line.style.headSize = d.arrow.headSize;
  }
  return line;
}

export function updateEntity(doc, id, props = {}) {
  const { type, entity } = findEntity(doc, id);
  const flat = flattenFields(props);

  const unknown = unknownFields(type, flat);
  if (unknown.length > 0) {
    throw new DocError('EINVAL', `Cannot set ${unknown.join(', ')} on a ${type}. Writable fields: ${Object.keys(WRITABLE_FIELDS[type]).join(', ')}`);
  }

  const changed = applyFields(type, entity, flat);
  // Rich-text blocks are a cached rendering of `content`; stale ones would win.
  if (changed.includes('content')) entity.blocks = null;
  return { id, changed, entity };
}

function applyFields(type, entity, flat) {
  const changed = [];
  for (const [field, value] of Object.entries(flat)) {
    if (WRITABLE_FIELDS[type][field] === undefined) continue;
    if (field === 'type' && !SHAPE_TYPES.includes(value)) {
      throw new DocError('EINVAL', `Unknown shape type "${value}". Expected one of ${SHAPE_TYPES.join(', ')}`);
    }
    // Writable field paths are portable paths, so they address the entity directly.
    setFieldPath(entity, field, field === 'locked' ? !!value : value);
    changed.push(field);
  }
  return changed;
}

export function deleteEntity(doc, id) {
  const { type, list, index } = findEntity(doc, id);
  list.splice(index, 1);
  const cascaded = dropReferencesTo(doc, id, type);
  return { id, deleted: true, ...(cascaded.length > 0 ? { alsoDeleted: cascaded } : {}) };
}

/**
 * Remove anything left dangling by a delete: lines that pointed at the entity
 * lose that endpoint, connections that joined it go entirely, and children lose
 * their parent link.
 */
function dropReferencesTo(doc, id, type) {
  const removed = [];

  for (const lineType of ['arrow', 'connector']) {
    for (const line of entitiesOf(doc, lineType)) {
      if (line.connectedFrom?.entityId === id) line.connectedFrom = null;
      if (line.connectedTo?.entityId === id) line.connectedTo = null;
    }
  }

  const connections = entitiesOf(doc, 'connection');
  for (let i = connections.length - 1; i >= 0; i--) {
    if (connections[i].from === id || connections[i].to === id) {
      removed.push(connections[i].id);
      connections.splice(i, 1);
    }
  }

  if (type === 'textBox' || type === 'shape') {
    for (const childType of ['textBox', 'shape']) {
      for (const child of entitiesOf(doc, childType)) {
        if (child.parent?.entityId === id) child.parent = null;
      }
    }
  }
  return removed;
}

export function connectEntities(doc, from, to, { kind = 'arrow', label, color } = {}) {
  if (!from || !to) throw new DocError('EINVAL', 'connect requires a source and a target id');
  if (from === to) throw new DocError('EINVAL', 'Cannot connect an entity to itself');

  const source = findEntity(doc, from);
  const target = findEntity(doc, to);

  if (kind === 'connection') {
    if (source.type !== 'textBox' || target.type !== 'textBox') {
      throw new DocError('EINVAL', 'A connection can only join two text boxes; use --kind arrow for other entities');
    }
    const existing = entitiesOf(doc, 'connection').find((c) => c.from === from && c.to === to);
    if (existing) return existing;

    const connection = {
      id: nextId(doc, 'connection'),
      from,
      to,
      style: { color: color || DEFAULTS.connection.color },
      label: label || DEFAULTS.connection.text,
      locked: false,
    };
    entitiesOf(doc, 'connection').push(connection);
    return connection;
  }

  if (kind !== 'arrow' && kind !== 'connector') {
    throw new DocError('EINVAL', `Unknown connection kind "${kind}". Expected arrow, connector or connection`);
  }
  for (const end of [source, target]) {
    if (end.type !== 'textBox' && end.type !== 'shape') {
      throw new DocError('EINVAL', `An ${kind} endpoint must be a shape or text box, not a ${end.type}`);
    }
  }

  const line = blankEntity(doc, kind);
  line.connectedFrom = { entityId: from, type: source.type };
  line.connectedTo = { entityId: to, type: target.type };
  line.startPoint = centreOf(source.entity);
  line.endPoint = centreOf(target.entity);
  if (color) line.style.color = color;

  entitiesOf(doc, kind).push(line);
  return line;
}

function centreOf(entity) {
  return {
    x: (entity.position?.x ?? 0) + (entity.size?.w ?? 0) / 2,
    y: (entity.position?.y ?? 0) + (entity.size?.h ?? 0) / 2,
  };
}
