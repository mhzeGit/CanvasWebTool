import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addEntity, connectEntities, deleteEntity, getEntity, listEntities, updateEntity,
} from '../lib/doc-ops.mjs';
import { toPortable } from '../js/portable-format.js';

function emptyDocument() {
  return toPortable({
    textBoxes: [], shapes: [], arrows: [], connectors: [], connections: [],
    viewport: { offsetX: 0, offsetY: 0, scale: 1 },
  });
}

function documentWithTwoBoxes() {
  const doc = emptyDocument();
  addEntity(doc, 'textBox', { title: 'One', position: { x: 0, y: 0 } });
  addEntity(doc, 'textBox', { title: 'Two', position: { x: 400, y: 0 } });
  return doc;
}

test('add assigns the next free id and applies the given fields', () => {
  const doc = emptyDocument();

  const first = addEntity(doc, 'shape', { type: 'diamond', position: { x: 50, y: 60 } });
  assert.equal(first.id, 'shp-1');
  assert.equal(first.type, 'diamond');
  assert.deepEqual(first.position, { x: 50, y: 60 });

  assert.equal(addEntity(doc, 'shape', {}).id, 'shp-2');
});

test('add rejects an unknown shape type', () => {
  assert.throws(() => addEntity(emptyDocument(), 'shape', { type: 'hexagon' }), /Unknown shape type/);
});

test('add rejects an unknown entity type', () => {
  assert.throws(() => addEntity(emptyDocument(), 'sticky', {}), /Cannot add "sticky"/);
});

test('update changes only the fields given and reports them', () => {
  const doc = documentWithTwoBoxes();

  const result = updateEntity(doc, 'tb-1', {
    title: 'Renamed',
    style: { backgroundColor: '#123456' },
  });

  assert.deepEqual(result.changed.sort(), ['style.backgroundColor', 'title']);
  assert.equal(result.entity.title, 'Renamed');
  assert.equal(result.entity.style.backgroundColor, '#123456');
  // Untouched fields keep their values.
  assert.equal(result.entity.style.textColor, '#ddd');
  assert.equal(getEntity(doc, 'tb-2').title, 'Two');
});

test('update refuses fields that are not writable', () => {
  const doc = documentWithTwoBoxes();
  assert.throws(() => updateEntity(doc, 'tb-1', { id: 'tb-99' }), /Cannot set id/);
  assert.throws(() => updateEntity(doc, 'tb-1', { parent: { entityId: 'tb-2' } }), /Cannot set parent/);
});

test('update clears cached rich text when the content changes', () => {
  const doc = documentWithTwoBoxes();
  getEntity(doc, 'tb-1').blocks = [{ stale: true }];

  updateEntity(doc, 'tb-1', { content: 'new text' });
  assert.equal(getEntity(doc, 'tb-1').blocks, null);
});

test('update on a missing entity says so', () => {
  assert.throws(() => updateEntity(emptyDocument(), 'tb-42', { title: 'x' }), /No such entity: tb-42/);
});

test('an unrecognised id prefix is reported clearly', () => {
  assert.throws(() => getEntity(emptyDocument(), 'widget-1'), /Unknown id "widget-1"/);
});

test('connect joins two entities by id', () => {
  const doc = documentWithTwoBoxes();
  const arrow = connectEntities(doc, 'tb-1', 'tb-2');

  assert.equal(arrow.id, 'arr-1');
  assert.deepEqual(arrow.connectedFrom, { entityId: 'tb-1', type: 'textBox' });
  assert.deepEqual(arrow.connectedTo, { entityId: 'tb-2', type: 'textBox' });
});

test('connect refuses a self-link and an unknown kind', () => {
  const doc = documentWithTwoBoxes();
  assert.throws(() => connectEntities(doc, 'tb-1', 'tb-1'), /itself/);
  assert.throws(() => connectEntities(doc, 'tb-1', 'tb-2', { kind: 'rope' }), /Unknown connection kind/);
});

test('a bezier connection only joins text boxes', () => {
  const doc = documentWithTwoBoxes();
  const shape = addEntity(doc, 'shape', {});

  assert.throws(
    () => connectEntities(doc, 'tb-1', shape.id, { kind: 'connection' }),
    /only join two text boxes/,
  );
  assert.equal(connectEntities(doc, 'tb-1', 'tb-2', { kind: 'connection' }).id, 'cnn-1');
});

test('connecting the same two boxes twice reuses the existing connection', () => {
  const doc = documentWithTwoBoxes();
  const first = connectEntities(doc, 'tb-1', 'tb-2', { kind: 'connection' });
  const second = connectEntities(doc, 'tb-1', 'tb-2', { kind: 'connection' });

  assert.equal(second.id, first.id);
  assert.equal(doc.entities.connections.length, 1);
});

test('delete removes the entity and clears references to it', () => {
  const doc = documentWithTwoBoxes();
  connectEntities(doc, 'tb-1', 'tb-2');
  connectEntities(doc, 'tb-1', 'tb-2', { kind: 'connection' });

  const result = deleteEntity(doc, 'tb-2');

  assert.equal(result.deleted, true);
  assert.deepEqual(result.alsoDeleted, ['cnn-1']);
  assert.equal(doc.entities.textBoxes.length, 1);
  // The arrow survives, but no longer points at anything that is gone.
  assert.equal(doc.entities.arrows.length, 1);
  assert.equal(doc.entities.arrows[0].connectedTo, null);
  assert.deepEqual(doc.entities.arrows[0].connectedFrom, { entityId: 'tb-1', type: 'textBox' });
});

test('delete detaches children of the removed entity', () => {
  const doc = emptyDocument();
  const parent = addEntity(doc, 'shape', { size: { w: 900, h: 900 } });
  const child = addEntity(doc, 'textBox', {});
  getEntity(doc, child.id).parent = { entityId: parent.id, type: 'shape' };

  deleteEntity(doc, parent.id);
  assert.equal(getEntity(doc, child.id).parent, null);
});

test('list summarises each type and can be filtered', () => {
  const doc = documentWithTwoBoxes();
  addEntity(doc, 'shape', { type: 'circle' });

  const all = listEntities(doc);
  assert.equal(all.textBoxes.length, 2);
  assert.equal(all.shapes.length, 1);

  const shapesOnly = listEntities(doc, 'shape');
  assert.deepEqual(Object.keys(shapesOnly), ['shapes']);
  assert.equal(shapesOnly.shapes[0].type, 'circle');

  // The plural form works too, since that is how `read` labels them.
  assert.equal(listEntities(doc, 'shapes').shapes.length, 1);
  assert.throws(() => listEntities(doc, 'sticky'), /Unknown type "sticky"/);
});
