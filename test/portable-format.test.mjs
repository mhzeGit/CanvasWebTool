import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromPortable, isPortable, toPortable } from '../js/portable-format.js';

/** A document exercising every entity type and every kind of cross-reference. */
function sampleDocument() {
  return {
    textBoxes: [
      {
        id: 3, x: 300, y: 40, w: 240, h: 160, title: 'Hello', titleColor: '#e7e7e7',
        text: 'body', blocks: null, color: '#1a1a1a', borderColor: '#444',
        textColor: '#ddd', fontSize: 14, parentId: null, parentType: null, locked: false,
      },
      {
        id: 9, x: 700, y: 40, w: 200, h: 120, title: 'Child', titleColor: '#e7e7e7',
        text: '', blocks: null, color: '#1a1a1a', borderColor: '#444',
        textColor: '#ddd', fontSize: 14, parentId: 5, parentType: 'shape', locked: true,
      },
    ],
    shapes: [
      {
        id: 5, shapeType: 'circle', x: 0, y: 0, w: 600, h: 600, color: '#2b2b2b',
        borderColor: '#6bb5ff', borderWidth: 2, cornerRadius: 0, image: null,
        parentId: null, parentType: null, locked: false,
      },
    ],
    arrows: [
      {
        id: 1, x1: 0, y1: 0, x2: 100, y2: 0,
        connectedFrom: 0, connectedFromType: 'shape',
        connectedTo: 0, connectedToType: 'textBox',
        color: '#6bb5ff', lineWidth: 2, headSize: 14, locked: false,
      },
    ],
    connectors: [
      {
        id: 4, x1: 5, y1: 5, x2: 55, y2: 55,
        connectedFrom: null, connectedFromType: null,
        connectedTo: 1, connectedToType: 'textBox',
        color: '#6bb5ff', locked: false,
      },
    ],
    connections: [
      { id: 2, from: 0, to: 1, color: '#6bb5ff', text: 'link', locked: false },
    ],
    viewport: { offsetX: 10, offsetY: 20, scale: 1.25 },
  };
}

test('exports entities under stable, type-prefixed ids', () => {
  const portable = toPortable(sampleDocument());

  assert.ok(isPortable(portable));
  assert.equal(portable.entities.textBoxes[0].id, 'tb-3');
  assert.equal(portable.entities.shapes[0].id, 'shp-5');
  assert.equal(portable.entities.arrows[0].id, 'arr-1');
  assert.equal(portable.entities.connectors[0].id, 'cnr-4');
  assert.equal(portable.entities.connections[0].id, 'cnn-2');
});

test('index-based references become id references', () => {
  const { entities } = toPortable(sampleDocument());

  assert.deepEqual(entities.arrows[0].connectedFrom, { entityId: 'shp-5', type: 'shape' });
  assert.deepEqual(entities.arrows[0].connectedTo, { entityId: 'tb-3', type: 'textBox' });
  assert.equal(entities.connectors[0].connectedFrom, null);
  assert.deepEqual(entities.connectors[0].connectedTo, { entityId: 'tb-9', type: 'textBox' });
  assert.equal(entities.connections[0].from, 'tb-3');
  assert.equal(entities.connections[0].to, 'tb-9');
});

test('a parent of a different type keeps its own id prefix', () => {
  // The text box's parent is a shape, so the reference must say shp-5, not tb-5.
  const { entities } = toPortable(sampleDocument());
  assert.deepEqual(entities.textBoxes[1].parent, { entityId: 'shp-5', type: 'shape' });
});

test('a full round trip preserves the document', () => {
  const original = sampleDocument();
  const { document: restored } = fromPortable(toPortable(original));

  for (const key of ['textBoxes', 'shapes', 'arrows', 'connectors', 'connections']) {
    assert.equal(restored[key].length, original[key].length, `${key} count`);
  }
  assert.deepEqual(restored.viewport, original.viewport);
  assert.deepEqual(restored.textBoxes[0], original.textBoxes[0]);
  assert.deepEqual(restored.shapes[0], original.shapes[0]);
  assert.deepEqual(restored.arrows[0], original.arrows[0]);
  assert.deepEqual(restored.connectors[0], original.connectors[0]);
  assert.deepEqual(restored.connections[0], original.connections[0]);
});

test('the locked flag survives a round trip', () => {
  const { document } = fromPortable(toPortable(sampleDocument()));
  assert.equal(document.textBoxes[1].locked, true);
  assert.equal(document.textBoxes[0].locked, false);
});

test('exporting twice produces the same entities', () => {
  const once = toPortable(sampleDocument());
  const twice = toPortable(fromPortable(once).document);
  assert.deepEqual(twice.entities, once.entities);
});

test('next ids leave room above every id in the document', () => {
  const { nextIds } = fromPortable(toPortable(sampleDocument()));
  assert.equal(nextIds.textBox, 10);
  assert.equal(nextIds.shape, 6);
  assert.equal(nextIds.arrow, 2);
  assert.equal(nextIds.connector, 5);
  assert.equal(nextIds.connection, 3);
});

test('entities without an id never collide with one claimed later', () => {
  const portable = toPortable(sampleDocument());
  portable.entities.shapes.unshift({
    id: 'shp-', // malformed on purpose
    type: 'rectangle',
    position: { x: 0, y: 0 },
    size: { w: 10, h: 10 },
    style: {},
    image: null,
    parent: null,
  });

  const ids = fromPortable(portable).document.shapes.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, `ids must be unique, got ${ids}`);
  assert.ok(ids.includes(5), 'the explicitly numbered shape keeps its id');
});

test('a connection to a missing text box is dropped, not left dangling', () => {
  const portable = toPortable(sampleDocument());
  portable.entities.connections[0].to = 'tb-999';

  assert.equal(fromPortable(portable).document.connections.length, 0);
});

test('importing something that is not a portable document is refused', () => {
  assert.equal(isPortable({ meta: { format: 'something-else' } }), false);
  assert.throws(() => fromPortable({ entities: {} }), /canvaswebtool-portable/);
});
