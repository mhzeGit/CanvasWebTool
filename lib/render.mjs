/**
 * Render a document (or one nested canvas of it) to a PNG using a private,
 * invisible native Canvas session. Nothing is shown on screen, the user's own
 * running app is never touched, and the file on disk is only read.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, mkdir, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectToApp } from "./client.mjs";
import { DocError } from "./doc-ops.mjs";
import { parseCanvasPath } from "./agent-document.mjs";
import { AgentService } from "./agent-service.mjs";
import { assetDirFor } from "./document-store.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function findNativeExecutable() {
  const candidates = [
    process.env.CANVAS_NATIVE_EXE,
    ...["Release", "Debug"].map((c) =>
      join(root, "native", "Canvas", "bin", c, "net8.0", "Canvas.Native.exe"),
    ),
  ].filter(Boolean);
  const found = candidates.find((c) => existsSync(c));
  if (!found)
    throw new DocError(
      "ENOTRUNNING",
      "The native app is not built. Run: dotnet build native/Canvas/Canvas.csproj (or set CANVAS_NATIVE_EXE)",
    );
  return found;
}

/**
 * @param {object} options file (a .cvdoc/.json to open), out (PNG path),
 *   canvas (sub-canvas path), width/height (window px), canvasOnly (omit the
 *   app chrome, default true), theme ("dark" | "light"), at {x, y} and scale:
 *   show the world point (x, y) of the canvas at the top-left of the view at
 *   that zoom instead of fitting everything (to read small text)
 */
export async function renderDocument({
  file,
  out,
  canvas,
  width = 1600,
  height = 900,
  canvasOnly = true,
  theme,
  at,
  scale,
}) {
  if (!file || !out) throw new DocError("EINVAL", "render needs a file and an output .png path");
  const path = parseCanvasPath(canvas);
  const exe = findNativeExecutable();
  const state = await mkdtemp(join(tmpdir(), "canvas-render-"));
  let source = resolve(file);
  if (at || scale) {
    // The view is part of the document: render a private copy with that viewport.
    const s = scale ?? 1;
    const copy = join(state, "view.cvdoc");
    await cp(source, copy);
    await cp(assetDirFor(source), assetDirFor(copy), { recursive: true }).catch(() => {});
    await new AgentService().apply({
      file: copy,
      mode: "offline",
      operations: [
        { op: "document", canvas: path.join("/"), viewport: { offsetX: -(at?.x ?? 0) * s, offsetY: -(at?.y ?? 0) * s, scale: s } },
      ],
    });
    source = copy;
  }
  const child = spawn(exe, ["--background", "--test-mode", "--render-test-mode"], {
    windowsHide: true,
    stdio: "ignore",
    env: { ...process.env, CANVASWEBTOOL_STATE_DIR: state },
  });
  let client;
  try {
    let endpoint;
    for (let i = 0; i < 150 && !endpoint; i++) {
      try {
        endpoint = JSON.parse(await readFile(join(state, "endpoint.json"), "utf8"));
      } catch {
        if (child.exitCode !== null)
          throw new DocError("EFAIL", "The native app exited during startup");
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (!endpoint) throw new DocError("EFAIL", "The native app did not start");
    client = await connectToApp(endpoint);
    const call = (cmd, args) => client.request(cmd, args);
    await call("resize-window", { width, height });
    if (theme) await call("set-theme", { theme });
    await call("open", { path: source, force: true });
    for (const id of path) await call("enter-canvas", { id });
    if (!at && !scale) await call("focus-content", { all: true });
    const target = resolve(out);
    await mkdir(dirname(target), { recursive: true });
    await call("screenshot", { path: target, canvasOnly });
    return { rendered: true, file: resolve(file), canvas: path.join("/"), out: target };
  } finally {
    if (client) {
      try {
        await client.request("quit", { force: true });
      } catch {}
      client.close();
    }
    if (child.exitCode === null)
      await new Promise((done) => {
        child.once("exit", done);
        setTimeout(() => {
          child.kill();
          done();
        }, 2000).unref();
      });
    await rm(state, { recursive: true, force: true });
  }
}
