import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { connectToApp } from '../lib/client.mjs';

const dir = await mkdtemp(join(tmpdir(), 'canvas-subcanvas-ui-'));
const child = spawn(resolve('native/Canvas/bin/Debug/net8.0/Canvas.Native.exe'), ['--background', '--test-mode', '--render-test-mode'], {
  windowsHide: true, stdio: 'ignore', env: { ...process.env, CANVASWEBTOOL_STATE_DIR: dir },
});
let client;
try {
  let endpoint;
  for (let i = 0; i < 100; i++) {
    try { endpoint = JSON.parse(await readFile(join(dir, 'endpoint.json'), 'utf8')); break; } catch {}
    if (child.exitCode !== null) throw Error('Native app exited during startup');
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(endpoint, 'Native app ready');
  client = await connectToApp(endpoint);
  const call = (command, args) => client.request(command, args);
  const card = await call('add-subcanvas');
  await call('update', { id: card.id, props: { title: 'Project planning', content: 'Explore flows and states in a focused workspace.' } });
  await call('select', { ids: [card.id] });
  await call('screenshot', { path: resolve('artifacts/subcanvas-native.png') });
  const entered = await call('enter-canvas', { id: card.id });
  assert.equal(entered.path.length, 1);
  assert.equal((await call('read')).entities.textBoxes.length, 0);
  await call('add', { type: 'textBox', props: { title: 'Draft state', position: { x: 100, y: 100 } } });
  const nested = await call('add-subcanvas');
  await call('update', { id: nested.id, props: { title: 'Details' } });
  await call('enter-canvas', { id: nested.id });
  assert.equal((await call('read')).entities.textBoxes.length, 0);
  const shape = await call('add', { type: 'shape', props: { type: 'circle' } });
  await call('screenshot', { path: resolve('artifacts/subcanvas-native-inside.png') });
  await call('navigate-canvas', { depth: 0 });
  await call('undo'); // Undo jumps to the canvas containing the reverted edit.
  assert.equal((await call('read')).entities.shapes.length, 0);
  await call('redo');
  assert.equal((await call('get', { id: shape.id })).type, 'circle');
  const path = join(dir, 'nested.cvdoc');
  await call('save', { path });
  await call('open', { path, force: true });
  const reopened = await call('read');
  assert.equal(reopened.entities.textBoxes[0].subCanvas.textBoxes[1].subCanvas.shapes.length, 1);
  await call('enter-canvas', { id: card.id });
  assert.equal((await call('read')).entities.textBoxes.length, 2);
  console.log('Native sub-canvas UI checks passed: creation, editing, navigation, history, save/reopen, rendered root and nested views.');
} finally {
  if (client) { try { await client.request('quit', { force: true }); } catch {} client.close(); }
  if (child.exitCode === null) await new Promise(r => { child.once('exit', r); setTimeout(() => { child.kill(); r(); }, 2000).unref(); });
  await rm(dir, { recursive: true, force: true });
}
