#!/usr/bin/env electron
/**
 * End-to-end smoke test: boots the real window, drives it through the agent
 * command surface the CLI uses, and captures the result to a PNG.
 * Run: npx electron tools/smoke.mjs <out.png>
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHandler, registerScheme, START_URL } from '../electron/protocol.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(process.defaultApp ? 2 : 1).filter((a) => !a.startsWith('-'));
const outPath = resolve(args.find((a) => a.endsWith('.png')) || 'smoke.png');

registerScheme();

let win;
let nextId = 1;
const pending = new Map();

function callRenderer(cmd, cmdArgs = {}) {
  const id = nextId++;
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`timeout: ${cmd}`)), 15000);
    pending.set(id, { res, rej, timer });
    win.webContents.send('agent:request', { id, cmd, args: cmdArgs });
  });
}

app.whenReady().then(async () => {
  registerHandler(APP_ROOT);
  ipcMain.handle('native:setBackgroundColor', () => true);
  ipcMain.on('native:documentState', () => {});
  ipcMain.on('native:changed', () => {});
  ipcMain.on('agent:response', (_e, m) => {
    const p = pending.get(m.id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(m.id);
    m.ok ? p.res(m.result) : p.rej(new Error(`${m.error?.code}: ${m.error?.message}`));
  });

  win = new BrowserWindow({
    width: 1440, height: 900, show: false, backgroundColor: '#111111',
    webPreferences: {
      preload: resolve(APP_ROOT, 'electron', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });

  const problems = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && !message.includes('Electron Security Warning')) problems.push(message);
  });

  await win.loadURL(START_URL);
  await new Promise((r) => setTimeout(r, 2000));

  const log = (label, value) => console.log(label, JSON.stringify(value));

  const tb1 = await callRenderer('add', { type: 'textBox', props: {
    title: 'Ingest', content: 'Reads **.cvdoc** files', position: { x: 80, y: 80 }, size: { w: 260, h: 150 },
  }});
  log('add textBox ->', tb1.id);

  const tb2 = await callRenderer('add', { type: 'textBox', props: {
    title: 'Render', content: 'Draws the canvas', position: { x: 520, y: 320 }, size: { w: 260, h: 150 },
  }});
  const shp = await callRenderer('add', { type: 'shape', props: {
    type: 'circle', position: { x: 520, y: 80 }, size: { w: 160, h: 160 },
    style: { backgroundColor: '#1d3b53', borderColor: '#6bb5ff' },
  }});
  log('add shape ->', shp.id);

  log('connect ->', await callRenderer('connect', { from: tb1.id, to: shp.id, kind: 'arrow' }));
  log('connect ->', await callRenderer('connect', { from: tb1.id, to: tb2.id, kind: 'connection', label: 'then' }));
  log('update ->', (await callRenderer('update', { id: tb2.id, props: { style: { backgroundColor: '#25322a' } } })).changed);
  log('list ->', Object.fromEntries(Object.entries(await callRenderer('list')).map(([k, v]) => [k, v.length])));

  await new Promise((r) => setTimeout(r, 1200));
  await writeFile(outPath, (await win.webContents.capturePage()).toPNG());

  // Undo must put it all back.
  for (let i = 0; i < 5; i++) await callRenderer('undo');
  await new Promise((r) => setTimeout(r, 400));
  log('after 5 undos ->', Object.fromEntries(Object.entries(await callRenderer('list')).map(([k, v]) => [k, v.length])));

  if (problems.length) console.log('RENDERER ERRORS:\n' + problems.join('\n'));
  console.log(problems.length ? 'FAILED' : 'OK');
  app.exit(problems.length ? 1 : 0);
}).catch((e) => { console.error('smoke failed:', e.message); app.exit(1); });
