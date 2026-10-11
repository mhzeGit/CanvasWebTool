#!/usr/bin/env electron
/**
 * Measures how much CPU the renderer burns with a document loaded and nobody
 * touching it, plus how long one frame takes under load.
 *
 * Run: npx electron tools/bench-idle.mjs [entityCount] [idleSeconds]
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHandler, registerScheme, START_URL } from '../electron/protocol.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Electron's argv also carries its own switches and this script's path, so the
// options are picked out by shape rather than by position.
const numbers = process.argv.slice(1).filter((a) => /^\d+$/.test(a)).map(Number);
const entityCount = numbers[0] ?? 120;
const idleSeconds = numbers[1] ?? 8;

registerScheme();

let win;
let nextId = 1;
const pending = new Map();

function callRenderer(cmd, cmdArgs = {}) {
  const id = nextId++;
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`timeout: ${cmd}`)), 30000);
    pending.set(id, { res, rej, timer });
    win.webContents.send('agent:request', { id, cmd, args: cmdArgs });
  });
}

/** Renderer CPU seconds, read straight from the kernel. */
async function cpuSeconds(pid) {
  const fields = (await readFile(`/proc/${pid}/stat`, 'utf8')).split(' ');
  const ticks = Number(fields[13]) + Number(fields[14]);
  return ticks / 100;
}

function buildDocument(count) {
  const entities = { textBoxes: [], shapes: [], arrows: [], connectors: [], connections: [] };
  const perRow = 12;
  for (let i = 0; i < count; i++) {
    const x = (i % perRow) * 300;
    const y = Math.floor(i / perRow) * 220;
    if (i % 2 === 0) {
      entities.textBoxes.push({
        id: `tb-${i + 1}`,
        title: `Box ${i}`,
        position: { x, y },
        size: { w: 240, h: 160 },
        style: { backgroundColor: '#1a1a1a', borderColor: '#444', textColor: '#ddd', titleColor: '#e7e7e7', fontSize: 14 },
        content: `Item **${i}** with some body copy to render.`,
        blocks: null, parent: null, locked: false,
      });
    } else {
      entities.shapes.push({
        id: `shp-${i + 1}`,
        type: ['rectangle', 'circle', 'triangle', 'diamond'][i % 4],
        position: { x, y },
        size: { w: 200, h: 140 },
        style: { backgroundColor: '#2b2b2b', borderColor: '#6bb5ff', borderWidth: 2, cornerRadius: 4 },
        image: null, parent: null, locked: false,
      });
    }
  }
  return {
    meta: { format: 'canvaswebtool-portable', version: 1, exportedAt: new Date().toISOString() },
    viewport: { offsetX: 0, offsetY: 0, scale: 0.35 },
    entities,
  };
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
    width: 1440, height: 900, show: true, backgroundColor: '#111111',
    webPreferences: {
      preload: resolve(APP_ROOT, 'electron', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });

  await win.loadURL(START_URL);
  await new Promise((r) => setTimeout(r, 2000));

  const counts = await callRenderer('import', { json: buildDocument(entityCount) });
  console.log('loaded:', JSON.stringify(counts));
  await new Promise((r) => setTimeout(r, 2500));

  const pid = win.webContents.getOSProcessId();
  const before = await cpuSeconds(pid);
  const started = Date.now();
  await new Promise((r) => setTimeout(r, idleSeconds * 1000));
  const elapsed = (Date.now() - started) / 1000;
  const used = (await cpuSeconds(pid)) - before;

  console.log(`idle CPU: ${used.toFixed(2)}s over ${elapsed.toFixed(1)}s wall = ${(100 * used / elapsed).toFixed(1)}% of one core`);
  app.exit(0);
}).catch((e) => { console.error('bench failed:', e.message); app.exit(1); });
