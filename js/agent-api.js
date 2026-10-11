/**
 * The command surface the `canvas` CLI drives when the app is open.
 *
 * Everything here works on the live document and goes through the same undo
 * history the user's own edits do, so an agent's change can be undone with
 * Ctrl+Z like any other, and the canvas updates immediately.
 *
 * Entities are addressed by their portable ids (`tb-3`, `shp-7`, …) and
 * described with the portable vocabulary, so `canvas read` output can be fed
 * straight back into `canvas update` without translation.
 */
import { state } from './state.js';
import { history, flushPanelEdit, performRedo, performUndo } from './history.js';
import {
  createAddShapeCmd, createAddTextBoxCmd, createAddArrowCmd, createAddConnectorCmd,
  createAddConnectionCmd,
} from './undo.js';
import { refreshSidePanel } from './side-panel.js';
import { exportAsPortableJSON, getPlainDocument, importFromPortableJSON } from './json-port.js';
import {
  toPortable, parsePortableId, ID_PREFIX, DEFAULTS, PLURAL,
  WRITABLE_FIELDS, SHAPE_TYPES as SHAPE_TYPE_LIST, flattenFields, unknownFields,
} from './portable-format.js';
import {
  newDocument, openDocumentPath, saveDocument, saveDocumentAs,
  deleteSelectedShapes, deleteSelectedArrows, deleteSelectedConnectors,
  deleteSelectedTextBoxesWithConnections, deleteConnection,
} from './document.js';
import { requestRender } from './render-scheduler.js';
import { DEFAULT_TEXTBOX_COLOR } from './config.js';

class AgentError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Portable id prefix -> the state array and entity type it addresses. */
const COLLECTIONS = Object.fromEntries(
  Object.entries(ID_PREFIX).map(([type, prefix]) => [prefix, { type, key: PLURAL[type], plural: PLURAL[type] }]),
);

const TYPE_BY_NAME = Object.fromEntries(
  Object.values(COLLECTIONS).map((c) => [c.type, c]),
);

const WRITABLE = WRITABLE_FIELDS;
const SHAPE_TYPES = new Set(SHAPE_TYPE_LIST);

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

function locate(portableId) {
  const { prefix, numericId } = parsePortableId(portableId);
  const collection = COLLECTIONS[prefix];
  if (!collection) {
    throw new AgentError('ENOENT', `Unknown id "${portableId}". Expected one of ${Object.keys(COLLECTIONS).map((p) => `${p}-<n>`).join(', ')}`);
  }
  const list = state[collection.key];
  const index = list.findIndex((entity) => entity.id === numericId);
  if (index < 0) throw new AgentError('ENOENT', `No such entity: ${portableId}`);
  return { ...collection, list, index, entity: list[index] };
}

/** The portable view of one entity, taken from a full export so the shape matches. */
function describe(portableId) {
  const { plural } = locate(portableId);
  const exported = toPortable(getPlainDocument());
  const found = exported.entities[plural].find((e) => e.id === portableId);
  if (!found) throw new AgentError('ENOENT', `No such entity: ${portableId}`);
  return found;
}

const flatten = flattenFields;

function afterMutation() {
  state.markDrawOrderDirty();
  state.reparentAll();
  refreshSidePanel();
  requestRender(3);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdRead() {
  return exportAsPortableJSON();
}

function cmdList({ type } = {}) {
  const exported = exportAsPortableJSON();
  if (!type) {
    return Object.fromEntries(
      Object.entries(exported.entities).map(([plural, list]) => [plural, list.map(summarise)]),
    );
  }
  const collection = TYPE_BY_NAME[type] || Object.values(COLLECTIONS).find((c) => c.plural === type);
  if (!collection) {
    throw new AgentError('EINVAL', `Unknown type "${type}". Expected one of ${Object.values(COLLECTIONS).map((c) => c.type).join(', ')}`);
  }
  return { [collection.plural]: exported.entities[collection.plural].map(summarise) };
}

/** One-line view used by `list`: enough to choose an id, short enough to scan. */
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

function cmdGet({ id }) {
  if (!id) throw new AgentError('EINVAL', 'get requires an id');
  return describe(id);
}

function cmdAdd({ type, props = {} }) {
  const collection = TYPE_BY_NAME[type];
  if (!collection) {
    throw new AgentError('EINVAL', `Cannot add "${type}". Expected one of ${Object.values(COLLECTIONS).map((c) => c.type).join(', ')}`);
  }
  if (collection.type === 'connection') return cmdConnect({ ...flattenConnectionProps(props), kind: 'connection' });

  flushPanelEdit();
  const flat = flatten(props);
  const { entity, command, portableId } = buildEntity(collection.type, flat);

  applyWritableFields(collection.type, entity, flat);
  history.push(command());
  afterMutation();
  return describe(portableId);
}

function flattenConnectionProps(props) {
  return { from: props.from, to: props.to, label: props.label, color: props.style?.color };
}

/** Create the entity, register it, and return the undo command for adding it. */
function buildEntity(type, flat) {
  const centre = viewportCentre();
  const d = DEFAULTS;

  if (type === 'shape') {
    const shapeType = flat.type || d.shape.shapeType;
    if (!SHAPE_TYPES.has(shapeType)) {
      throw new AgentError('EINVAL', `Unknown shape type "${shapeType}". Expected one of ${[...SHAPE_TYPES].join(', ')}`);
    }
    const w = numberOr(flat['size.w'], d.shape.w);
    const h = numberOr(flat['size.h'], d.shape.h);
    const shape = {
      id: state.nextShapeId++,
      shapeType,
      x: numberOr(flat['position.x'], centre.x - w / 2),
      y: numberOr(flat['position.y'], centre.y - h / 2),
      w, h,
      color: state.lastShapeColor || d.shape.color,
      borderColor: state.lastShapeBorderColor || d.shape.borderColor,
      borderWidth: d.shape.borderWidth,
      cornerRadius: shapeType === 'rectangle' ? 4 : 0,
      image: null,
      parentId: null,
      parentType: null,
      locked: false,
    };
    const index = state.shapes.length;
    state.shapes.push(shape);
    state.parentTree.register('shape', shape.id, shape);
    return {
      entity: shape,
      portableId: `${ID_PREFIX.shape}-${shape.id}`,
      command: () => createAddShapeCmd(state.shapes, state.selectedShapes, refreshSidePanel, shape, index),
    };
  }

  if (type === 'textBox') {
    const w = numberOr(flat['size.w'], d.textBox.w);
    const h = numberOr(flat['size.h'], d.textBox.h);
    const textBox = {
      id: state.nextTextBoxId++,
      x: numberOr(flat['position.x'], centre.x - w / 2),
      y: numberOr(flat['position.y'], centre.y - h / 2),
      w, h,
      text: '',
      blocks: null,
      color: DEFAULT_TEXTBOX_COLOR,
      borderColor: d.textBox.borderColor,
      textColor: d.textBox.textColor,
      fontSize: d.textBox.fontSize,
      title: '',
      titleColor: d.textBox.titleColor,
      parentId: null,
      parentType: null,
      locked: false,
    };
    const index = state.textBoxes.length;
    state.textBoxes.push(textBox);
    state.parentTree.register('textBox', textBox.id, textBox);
    return {
      entity: textBox,
      portableId: `${ID_PREFIX.textBox}-${textBox.id}`,
      command: () => createAddTextBoxCmd(state.textBoxes, state.selectedTextBoxes, refreshSidePanel, textBox, index),
    };
  }

  // Arrows and connectors share a geometry, differing only in their styling.
  const isArrow = type === 'arrow';
  const line = {
    id: isArrow ? state.nextArrowId++ : state.nextConnectorId++,
    x1: numberOr(flat['startPoint.x'], centre.x - 60),
    y1: numberOr(flat['startPoint.y'], centre.y),
    x2: numberOr(flat['endPoint.x'], centre.x + 60),
    y2: numberOr(flat['endPoint.y'], centre.y),
    connectedFrom: null,
    connectedTo: null,
    connectedFromType: null,
    connectedToType: null,
    color: isArrow ? d.arrow.color : d.connector.color,
    locked: false,
  };
  if (isArrow) {
    line.lineWidth = d.arrow.lineWidth;
    line.headSize = d.arrow.headSize;
  }

  const list = isArrow ? state.arrows : state.connectors;
  const index = list.length;
  list.push(line);
  return {
    entity: line,
    portableId: `${isArrow ? ID_PREFIX.arrow : ID_PREFIX.connector}-${line.id}`,
    command: () => (isArrow
      ? createAddArrowCmd(state.arrows, state.selectedArrows, refreshSidePanel, line, index)
      : createAddConnectorCmd(state.connectors, state.selectedConnectors, refreshSidePanel, line, index)),
  };
}

function viewportCentre() {
  const rect = state.canvas.getBoundingClientRect();
  return {
    x: (rect.width / 2 - state.targetOffsetX) / state.targetScale,
    y: (rect.height / 2 - state.targetOffsetY) / state.targetScale,
  };
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function applyWritableFields(type, entity, flat) {
  const allowed = WRITABLE[type];
  for (const [path, value] of Object.entries(flat)) {
    const property = allowed[path];
    if (property === undefined) continue;
    entity[property] = coerce(type, property, value);
  }
}

function coerce(type, property, value) {
  if (property === 'locked') return !!value;
  if (property === 'shapeType') {
    if (!SHAPE_TYPES.has(value)) {
      throw new AgentError('EINVAL', `Unknown shape type "${value}"`);
    }
    return value;
  }
  return value;
}

function cmdUpdate({ id, props = {} }) {
  if (!id) throw new AgentError('EINVAL', 'update requires an id');

  const target = locate(id);
  const allowed = WRITABLE[target.type];
  const flat = flatten(props);

  const unknown = unknownFields(target.type, flat);
  if (unknown.length > 0) {
    throw new AgentError('EINVAL', `Cannot set ${unknown.join(', ')} on a ${target.type}. Writable fields: ${Object.keys(allowed).join(', ')}`);
  }

  flushPanelEdit();

  const before = {};
  const after = {};
  // Reported back as portable field paths, matching what the caller sent and
  // what the offline CLI returns for the same edit.
  const changed = [];
  for (const [path, value] of Object.entries(flat)) {
    const property = allowed[path];
    const next = coerce(target.type, property, value);
    if (target.entity[property] === next) continue;
    before[property] = target.entity[property];
    after[property] = next;
    changed.push(path);
  }

  if (changed.length === 0) return { id, changed: [], entity: describe(id) };

  Object.assign(target.entity, after);
  // Editing text invalidates the cached rich-text rendering of that box.
  if ('text' in after) invalidateContent(target.entity);

  const { key } = target;
  const entityId = target.entity.id;
  history.push({
    description: `Update ${id}`,
    undo() { restore(key, entityId, before); },
    redo() { restore(key, entityId, after); },
  });

  afterMutation();
  return { id, changed, entity: describe(id) };
}

function restore(key, entityId, values) {
  const entity = state[key].find((candidate) => candidate.id === entityId);
  if (!entity) return;
  Object.assign(entity, values);
  if ('text' in values) invalidateContent(entity);
  refreshSidePanel();
  requestRender(3);
}

/** Drop the cached Tiptap/legacy rendering so the new text is picked up. */
function invalidateContent(entity) {
  entity.blocks = null;
  entity.content = null;
  entity._contentVersion = (entity._contentVersion || 0) + 1;
}

/**
 * Deleting goes through the app's own delete paths rather than splicing the
 * arrays here. Those paths also repair the index-based references that arrows,
 * connectors and connections hold, and record an undo entry that knows how to
 * put them all back — none of which is worth reimplementing.
 */
function cmdDelete({ id }) {
  if (!id) throw new AgentError('EINVAL', 'delete requires an id');

  const { index, type } = locate(id);
  flushPanelEdit();

  const selectOnly = (set) => {
    set.clear();
    set.add(index);
  };

  switch (type) {
    case 'shape':
      selectOnly(state.selectedShapes);
      deleteSelectedShapes();
      break;
    case 'textBox':
      selectOnly(state.selectedTextBoxes);
      deleteSelectedTextBoxesWithConnections();
      break;
    case 'arrow':
      selectOnly(state.selectedArrows);
      deleteSelectedArrows();
      break;
    case 'connector':
      selectOnly(state.selectedConnectors);
      deleteSelectedConnectors();
      break;
    case 'connection':
      deleteConnection(index);
      break;
    default:
      throw new AgentError('EINVAL', `Cannot delete a ${type}`);
  }

  afterMutation();
  return { id, deleted: true };
}

/**
 * Join two entities. `kind` picks the visual: an arrow (default), a plain
 * connector line, or a bezier "connection" — which only text boxes support.
 */
function cmdConnect({ from, to, kind = 'arrow', label, color }) {
  if (!from || !to) throw new AgentError('EINVAL', 'connect requires --from and --to');
  if (from === to) throw new AgentError('EINVAL', 'Cannot connect an entity to itself');

  const source = locate(from);
  const target = locate(to);
  flushPanelEdit();

  if (kind === 'connection') {
    if (source.type !== 'textBox' || target.type !== 'textBox') {
      throw new AgentError('EINVAL', 'A connection can only join two text boxes; use --kind arrow for other entities');
    }
    const existing = state.connections.find((c) => c.from === source.index && c.to === target.index);
    if (existing) return { id: `${ID_PREFIX.connection}-${existing.id}`, created: false };

    const connection = {
      id: state.nextConnectionId++,
      from: source.index,
      to: target.index,
      color: color || DEFAULTS.connection.color,
      text: label || DEFAULTS.connection.text,
      locked: false,
    };
    state.connections.push(connection);
    history.push(createAddConnectionCmd(state.connections, state.selectedConnection, refreshSidePanel, connection));
    afterMutation();
    return { id: `${ID_PREFIX.connection}-${connection.id}`, created: true };
  }

  if (!['arrow', 'connector'].includes(kind)) {
    throw new AgentError('EINVAL', `Unknown connection kind "${kind}". Expected arrow, connector or connection`);
  }
  for (const end of [source, target]) {
    if (end.type !== 'textBox' && end.type !== 'shape') {
      throw new AgentError('EINVAL', `An ${kind} endpoint must be a shape or text box, not a ${end.type}`);
    }
  }

  const isArrow = kind === 'arrow';
  const line = {
    id: isArrow ? state.nextArrowId++ : state.nextConnectorId++,
    x1: source.entity.x + source.entity.w / 2,
    y1: source.entity.y + source.entity.h / 2,
    x2: target.entity.x + target.entity.w / 2,
    y2: target.entity.y + target.entity.h / 2,
    connectedFrom: source.index,
    connectedFromType: source.type,
    connectedTo: target.index,
    connectedToType: target.type,
    color: color || (isArrow ? DEFAULTS.arrow.color : DEFAULTS.connector.color),
    locked: false,
  };
  if (isArrow) {
    line.lineWidth = DEFAULTS.arrow.lineWidth;
    line.headSize = DEFAULTS.arrow.headSize;
  }

  const list = isArrow ? state.arrows : state.connectors;
  const index = list.length;
  list.push(line);
  history.push(isArrow
    ? createAddArrowCmd(state.arrows, state.selectedArrows, refreshSidePanel, line, index)
    : createAddConnectorCmd(state.connectors, state.selectedConnectors, refreshSidePanel, line, index));

  afterMutation();
  return { id: `${isArrow ? ID_PREFIX.arrow : ID_PREFIX.connector}-${line.id}`, created: true };
}

function cmdImport({ json }) {
  if (!json) throw new AgentError('EINVAL', 'import requires a document');
  importFromPortableJSON(json);
  afterMutation();
  return { imported: true, ...countEntities() };
}

function countEntities() {
  return {
    textBoxes: state.textBoxes.length,
    shapes: state.shapes.length,
    arrows: state.arrows.length,
    connectors: state.connectors.length,
    connections: state.connections.length,
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const HANDLERS = {
  read: cmdRead,
  list: cmdList,
  get: cmdGet,
  add: cmdAdd,
  update: cmdUpdate,
  delete: cmdDelete,
  connect: cmdConnect,
  import: cmdImport,
  async save() {
    await saveDocument();
    return { saved: !state.isDirty, file: state.currentFilePath || state.currentFileName };
  },
  async 'save-as'() {
    await saveDocumentAs();
    return { saved: !state.isDirty, file: state.currentFilePath || state.currentFileName };
  },
  async open({ path }) {
    if (!path) throw new AgentError('EINVAL', 'open requires a path');
    const opened = await openDocumentPath(path);
    if (!opened) throw new AgentError('EFAIL', `Could not open ${path}`);
    return { opened: true, file: state.currentFilePath, ...countEntities() };
  },
  async new() {
    await newDocument();
    return { created: true };
  },
  undo() {
    performUndo();
    requestRender(3);
    return { undone: true };
  },
  redo() {
    performRedo();
    requestRender(3);
    return { redone: true };
  },
};

/** Entry point used by desktop.js to answer a request from the CLI. */
export async function handleAgentCommand(cmd, args = {}) {
  const handler = HANDLERS[cmd];
  if (!handler) throw new AgentError('ENOCMD', `Unknown command: ${cmd}`);
  return handler(args);
}
