#!/usr/bin/env electron
/**
 * Capture the desktop window to a PNG, for checking that the interface renders
 * as it should. Run with: `npx electron tools/screenshot.mjs <out.png> [doc]`
 */
import { app, BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHandler, registerScheme, START_URL } from '../electron/protocol.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(process.defaultApp ? 2 : 1).filter((a) => !a.startsWith('-'));
const outPath = resolve(args.find((a) => a.endsWith('.png')) || 'screenshot.png');
const settleMs = Number(process.env.SCREENSHOT_SETTLE_MS || 2500);

registerScheme();

app.whenReady().then(async () => {
  registerHandler(APP_ROOT);

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#111111',
    webPreferences: {
      preload: resolve(APP_ROOT, 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const errors = [];
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) errors.push(`${source}:${line} ${message}`);
  });
  win.webContents.on('did-fail-load', (_e, code, description, url) => {
    errors.push(`failed to load ${url}: ${description} (${code})`);
  });

  await win.loadURL(START_URL);
  await new Promise((r) => setTimeout(r, settleMs));

  const image = await win.webContents.capturePage();
  await writeFile(outPath, image.toPNG());

  if (errors.length > 0) {
    process.stderr.write(`Renderer reported ${errors.length} problem(s):\n${errors.join('\n')}\n`);
  }
  process.stdout.write(`${outPath}\n`);
  app.exit(errors.length > 0 ? 1 : 0);
});
