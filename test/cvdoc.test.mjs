import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPortable, writePortable } from '../lib/cvdoc.mjs';
import { assetDirFor } from '../lib/document-store.mjs';
import { addEntity, updateEntity } from '../lib/doc-ops.mjs';
import { serializeDocument } from '../js/format.js';

/** A 1x1 transparent PNG, small enough to inline. */
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'cvdoc-test-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function envelope({ textBoxes = [], shapes = [], arrows = [], connectors = [], connections = [] } = {}) {
  return serializeDocument({
    textBoxes, shapes, arrows, connectors, connections,
    viewport: { offsetX: 10, offsetY: 20, scale: 1.25 },
    settings: {},
  });
}

const sampleTextBox = {
  id: 3, x: 300, y: 40, w: 240, h: 160, title: 'Hello', titleColor: '#e7e7e7',
  text: 'body', blocks: null, color: '#1a1a1a', borderColor: '#444',
  textColor: '#ddd', fontSize: 14, parentId: null, parentType: null, locked: false,
};

test('a .cvdoc reads as portable JSON and writes back unchanged', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'plan.cvdoc');
    await writeFile(path, JSON.stringify(envelope({ textBoxes: [sampleTextBox] })), 'utf8');

    const { portable, kind } = await readPortable(path);
    assert.equal(kind, 'cvdoc');
    assert.equal(portable.entities.textBoxes[0].id, 'tb-3');

    await writePortable(path, portable);
    const reread = await readPortable(path);
    assert.deepEqual(reread.portable.entities, portable.entities);
    assert.deepEqual(reread.portable.viewport, { offsetX: 10, offsetY: 20, scale: 1.25 });
  });
});

test('bezier connections survive a save, which they previously did not', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'linked.cvdoc');
    await writeFile(path, JSON.stringify(envelope({
      textBoxes: [sampleTextBox, { ...sampleTextBox, id: 9, title: 'Second' }],
      connections: [{ id: 2, from: 0, to: 1, color: '#6bb5ff', text: 'link', locked: false }],
    })), 'utf8');

    const { portable } = await readPortable(path);
    assert.equal(portable.entities.connections.length, 1);

    await writePortable(path, portable);
    const saved = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(saved.document.connections.length, 1);
    assert.equal(saved.document.connections[0].text, 'link');
  });
});

test('images are written beside the document and read back in', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'pictures.cvdoc');
    const shape = {
      id: 5, shapeType: 'rectangle', x: 0, y: 0, w: 100, h: 100, color: '#2b2b2b',
      borderColor: '#6bb5ff', borderWidth: 2, cornerRadius: 4,
      image: { id: 1, src: PNG_DATA_URL, fileName: '' },
      parentId: null, parentType: null, locked: false,
    };
    await writeFile(path, JSON.stringify(envelope({ shapes: [shape] })), 'utf8');

    const { portable } = await readPortable(path);
    await writePortable(path, portable);

    // The image left the JSON...
    const saved = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(saved.document.shapes[0].image.src, undefined);
    assert.match(saved.document.shapes[0].image.assetPath, /^img_[a-z0-9]+\.png$/);

    // ...and landed in the assets folder.
    const assetDir = assetDirFor(path);
    assert.ok((await stat(assetDir)).isDirectory());

    // Reading puts it back exactly as it was.
    const reread = await readPortable(path);
    assert.equal(reread.portable.entities.shapes[0].image.src, PNG_DATA_URL);
  });
});

test('extracting assets does not strip the image from the live document', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'live.cvdoc');
    const live = {
      id: 5, shapeType: 'rectangle', x: 0, y: 0, w: 100, h: 100, color: '#2b2b2b',
      borderColor: '#6bb5ff', borderWidth: 2, cornerRadius: 4,
      image: { id: 1, src: PNG_DATA_URL, fileName: '' },
      parentId: null, parentType: null, locked: false,
    };

    await writeFile(path, JSON.stringify(envelope({ shapes: [live] })), 'utf8');
    const { portable } = await readPortable(path);
    await writePortable(path, portable);

    // The in-memory copy still has its image, so a second save is not lossy.
    assert.equal(portable.entities.shapes[0].image.src, PNG_DATA_URL);
    assert.equal(live.image.src, PNG_DATA_URL);
  });
});

test('edits made through doc-ops persist to disk', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'edit.cvdoc');
    await writeFile(path, JSON.stringify(envelope({ textBoxes: [sampleTextBox] })), 'utf8');

    const { portable } = await readPortable(path);
    updateEntity(portable, 'tb-3', { title: 'Edited', size: { w: 320 } });
    addEntity(portable, 'shape', { type: 'circle', position: { x: 10, y: 10 } });
    await writePortable(path, portable);

    const { portable: reread } = await readPortable(path);
    assert.equal(reread.entities.textBoxes[0].title, 'Edited');
    assert.equal(reread.entities.textBoxes[0].size.w, 320);
    assert.equal(reread.entities.shapes[0].type, 'circle');
  });
});

test('a portable JSON export can be read straight back', async () => {
  await withTempDir(async (dir) => {
    const source = join(dir, 'src.cvdoc');
    await writeFile(source, JSON.stringify(envelope({ textBoxes: [sampleTextBox] })), 'utf8');
    const { portable } = await readPortable(source);

    const exported = join(dir, 'export.json');
    await writeFile(exported, JSON.stringify(portable), 'utf8');

    const { portable: reread, kind } = await readPortable(exported);
    assert.equal(kind, 'portable');
    assert.deepEqual(reread.entities, portable.entities);
  });
});

test('a legacy element-format document is refused with an explanation', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'legacy.cvdoc');
    await writeFile(path, JSON.stringify({
      format: 'canvaswebtool-document',
      version: 1,
      document: { elements: [{ x: 0, y: 0, w: 10, h: 10 }], viewport: {} },
    }), 'utf8');

    await assert.rejects(() => readPortable(path), /legacy element format/);
  });
});

test('a path that is not a document is refused', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'notes.txt');
    await writeFile(path, 'hello', 'utf8');
    await assert.rejects(() => readPortable(path), /Not a document file/);
  });
});
