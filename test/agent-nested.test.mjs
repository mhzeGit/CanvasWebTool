import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { AgentService } from "../lib/agent-service.mjs";
import {
  emptyDocument,
  toAgentDocument,
  applyOperations,
  canvasDocument,
  parseCanvasPath,
  summarize,
} from "../lib/agent-document.mjs";
import { layoutFlow, fitTextBoxes, wrappedLineCount } from "../lib/diagram-layout.mjs";

const blank = () => toAgentDocument(emptyDocument());
const stage = {
  op: "add",
  type: "textBox",
  alias: "stage",
  props: { title: "Family intro", content: "- GF greets you", subCanvas: true },
};
const note = (alias, title, content = "") => ({
  op: "add",
  canvas: "$stage",
  type: "textBox",
  alias,
  props: { title, content },
});

async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), "canvas-nested-"));
  try {
    await run(new AgentService(), join(dir, "plan.cvdoc"), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("created files keep the letter case of the name they were given", () =>
  fixture(async (s, _file, dir) => {
    const file = join(dir, "Mixed_Case Plan.cvdoc");
    const created = await s.create({ file });
    assert.ok(created.file.endsWith("Mixed_Case Plan.cvdoc"), created.file);
    await s.apply({ file, operations: [{ op: "add", type: "textBox", props: { title: "x" } }] });
    assert.deepEqual((await readdir(dir)).filter((n) => /plan/i.test(n)), ["Mixed_Case Plan.cvdoc"]);
  }));

test("a text box becomes a sub-canvas and operations run inside it with scoped ids and aliases", () => {
  const { document, aliases, aliasPaths, results } = applyOperations(blank(), [
    stage,
    note("a", "Sister door"),
    note("b", "Chandelier"),
    { op: "connect", canvas: "$stage", from: "$a", to: "$b", kind: "arrow" },
    { op: "add", type: "textBox", alias: "next", props: { title: "Cat" } },
  ]);
  assert.equal(aliases.stage, "tb-1");
  assert.equal(aliases.a, "tb-1", "ids are scoped to their own canvas");
  assert.equal(aliases.next, "tb-2");
  assert.equal(aliasPaths.a, "tb-1/tb-1");
  assert.equal(results[0].subCanvas.textBoxes.length, 0);
  const inner = canvasDocument(document, ["tb-1"]);
  assert.deepEqual(inner.entities.textBoxes.map((t) => t.title), ["Sister door", "Chandelier"]);
  assert.equal(inner.entities.arrows[0].connectedTo.entityId, "tb-2");
  assert.equal(document.entities.textBoxes.length, 2, "the main canvas is untouched");
});

test("canvas paths accept ids, arrays and alias prefixes", () => {
  assert.deepEqual(parseCanvasPath(""), []);
  assert.deepEqual(parseCanvasPath("tb-3/tb-2"), ["tb-3", "tb-2"]);
  assert.deepEqual(parseCanvasPath(["tb-1"]), ["tb-1"]);
  assert.deepEqual(parseCanvasPath("$x/tb-4", { x: "tb-1/tb-2" }), ["tb-1", "tb-2", "tb-4"]);
  assert.throws(() => parseCanvasPath("shp-1"), { code: "EINVAL" });
  assert.throws(() => parseCanvasPath("tb-1/$x", { x: "tb-2" }), { code: "EINVAL" });
  assert.throws(() => parseCanvasPath("$nope"), { code: "EINVAL" });
});

test("nested canvases can nest again and aliasPaths address them", () => {
  const { document, aliasPaths } = applyOperations(blank(), [
    stage,
    { ...note("deep", "Deep state"), props: { title: "Deep state", subCanvas: true } },
    { op: "add", canvas: "$deep", type: "textBox", alias: "leaf", props: { title: "Leaf" } },
  ]);
  assert.equal(aliasPaths.leaf, "tb-1/tb-1/tb-1");
  const leaf = canvasDocument(document, ["tb-1", "tb-1"]);
  assert.equal(leaf.entities.textBoxes[0].title, "Leaf");
  assert.deepEqual(
    summarize(document).canvases.map((c) => c.path),
    ["tb-1", "tb-1/tb-1"],
  );
});

test("misused scopes and aliases are rejected without partial effects", () => {
  assert.throws(
    () => applyOperations(blank(), [stage, { op: "add", canvas: "tb-9", type: "textBox" }]),
    { code: "ENOENT" },
  );
  assert.throws(
    () =>
      applyOperations(blank(), [
        { op: "add", type: "textBox", props: { title: "plain" } },
        { op: "add", canvas: "tb-1", type: "textBox" },
      ]),
    { code: "EINVAL" },
    "a text box that is not a sub-canvas has no inside",
  );
  assert.throws(
    () =>
      applyOperations(blank(), [
        stage,
        note("a", "A"),
        { op: "update", id: "$a", props: { title: "main canvas cannot see it" } },
      ]),
    /Alias \$a was created in canvas "tb-1"/,
  );
  assert.throws(
    () => applyOperations(blank(), [{ op: "add", type: "textBox", props: { subCanvas: { textBoxes: [] } } }]),
    { code: "EINVAL" },
  );
});

test("subCanvas:false removes it and subCanvas:true on an existing one keeps its contents", () => {
  let { document } = applyOperations(blank(), [stage, note("a", "Keep me")]);
  document = applyOperations(document, [
    { op: "update", id: "tb-1", props: { subCanvas: true } },
  ]).document;
  assert.equal(canvasDocument(document, ["tb-1"]).entities.textBoxes.length, 1);
  document = applyOperations(document, [
    { op: "update", id: "tb-1", props: { subCanvas: false } },
  ]).document;
  assert.equal(document.entities.textBoxes[0].subCanvas, undefined);
});

test("nested content survives disk round trips, reads omit it by default and deep queries find it", () =>
  fixture(async (s, file) => {
    await s.create({ file });
    await s.apply({
      file,
      operations: [
        stage,
        note("a", "Chandelier", "- It lands on you"),
        { op: "document", canvas: "$stage", viewport: { scale: 0.5 } },
      ],
    });
    const disk = JSON.parse(await readFile(file, "utf8"));
    const body = disk.document.textBoxes[0].subCanvas;
    assert.equal(body.textBoxes[0].title, "Chandelier", "stored in the apps' own nested shape");
    assert.equal(body.viewport.scale, 0.5);
    const read = await s.read({ file });
    assert.equal(read.document.entities.textBoxes[0].subCanvas.omitted, true);
    assert.equal(read.summary.canvases[0].objects, 1);
    const full = await s.read({ file, includeNested: true });
    assert.equal(full.document.entities.textBoxes[0].subCanvas.textBoxes.length, 1);
    const inside = await s.read({ file, canvas: "tb-1" });
    assert.equal(inside.canvas, "tb-1");
    assert.equal(inside.document.entities.textBoxes[0].content, "- It lands on you");
    assert.equal((await s.query({ file, text: "lands" })).total, 0);
    const deep = await s.query({ file, text: "lands", deep: true });
    assert.equal(deep.total, 1);
    assert.equal(deep.entities[0].canvas, "tb-1");
    // default canvas for a whole batch
    await s.apply({
      file,
      canvas: "tb-1",
      operations: [{ op: "update", id: "tb-1", props: { title: "Chandelier falls" } }],
    });
    assert.equal(
      (await s.read({ file, canvas: "tb-1" })).document.entities.textBoxes[0].title,
      "Chandelier falls",
    );
  }));

test("layout arranges a flow left to right, splits branches and re-attaches arrows", () => {
  const { document } = applyOperations(blank(), [
    { op: "add", type: "textBox", alias: "a", props: { title: "Start" } },
    { op: "add", type: "textBox", alias: "b", props: { title: "Sip" } },
    { op: "add", type: "textBox", alias: "c", props: { title: "Refuse" } },
    { op: "add", type: "textBox", alias: "d", props: { title: "Football" } },
    { op: "connect", from: "$a", to: "$b", kind: "arrow" },
    { op: "connect", from: "$a", to: "$c", kind: "arrow" },
    { op: "connect", from: "$b", to: "$d", kind: "arrow" },
    { op: "connect", from: "$c", to: "$d", kind: "arrow" },
    { op: "layout", direction: "right", gap: { x: 100, y: 40 }, origin: { x: 0, y: 0 } },
  ]);
  const at = Object.fromEntries(document.entities.textBoxes.map((t) => [t.title, t.position]));
  assert.equal(at.Start.x, 0);
  assert.equal(at.Sip.x, 340);
  assert.equal(at.Refuse.x, 340);
  assert.notEqual(at.Sip.y, at.Refuse.y, "branches are stacked");
  assert.equal(at.Football.x, 680);
  const toSip = document.entities.arrows.find((a) => a.connectedTo.entityId === "tb-2");
  assert.equal(toSip.endPoint.x, at.Sip.x, "arrow ends on the box edge");
});

test("layout down uses rows, tolerates cycles and rejects bad input", () => {
  const { document } = applyOperations(blank(), [
    { op: "add", type: "textBox", alias: "a", props: {} },
    { op: "add", type: "textBox", alias: "b", props: {} },
    { op: "connect", from: "$a", to: "$b", kind: "arrow" },
    { op: "connect", from: "$b", to: "$a", kind: "arrow" },
    { op: "layout", direction: "down" },
  ]);
  const [a, b] = document.entities.textBoxes;
  assert.ok(b.position.y > a.position.y);
  assert.throws(() => layoutFlow(blank(), { direction: "up" }), { code: "EINVAL" });
  assert.throws(() => layoutFlow(document, { ids: ["tb-99"] }), { code: "EINVAL" });
});

test("fit grows a text box to its wrapped content and shrinks an oversized one", () => {
  const long = "- " + "word ".repeat(80);
  const { document } = applyOperations(blank(), [
    { op: "add", type: "textBox", props: { title: "Long", content: long, size: { w: 240, h: 60 } } },
    { op: "add", type: "textBox", props: { title: "Short", content: "- one line", size: { w: 240, h: 400 } } },
    { op: "add", type: "textBox", props: { title: "Card", content: "text", subCanvas: true } },
    { op: "fit" },
  ]);
  const [longBox, shortBox, card] = document.entities.textBoxes;
  assert.ok(longBox.size.h > 250, `long box was ${longBox.size.h}`);
  assert.ok(shortBox.size.h < 100, `short box was ${shortBox.size.h}`);
  assert.ok(card.size.h >= 39.5 + 17.5 + 34, "a sub-canvas card keeps room for its footer");
  assert.equal(wrappedLineCount("", 100, 14), 1);
  assert.ok(wrappedLineCount("a ".repeat(100), 100, 14) > 5);
  assert.equal(fitTextBoxes(document, { ids: ["tb-2"], minHeight: 200 }).heights["tb-2"], 200);
});

test("CLI --canvas scopes list, get, add and query --deep", async () => {
  const dir = await mkdtemp(join(tmpdir(), "canvas-nested-cli-"));
  const file = join(dir, "plan.cvdoc");
  const run = (args) =>
    new Promise((done, reject) => {
      const child = spawn(process.execPath, [resolve("bin/canvas.mjs"), ...args], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "",
        err = "";
      child.stdout.on("data", (b) => (out += b));
      child.stderr.on("data", (b) => (err += b));
      child.on("error", reject);
      child.on("close", (code) => done({ code, out, err }));
    });
  try {
    assert.equal((await run(["create", file])).code, 0);
    assert.equal(
      (await run(["add", "textBox", file, "--set", "title=Stage", "--set", "subCanvas=true"])).code,
      0,
    );
    const inner = await run(["add", "textBox", file, "--canvas", "tb-1", "--set", "title=Inner"]);
    assert.equal(inner.code, 0, inner.err);
    const listed = JSON.parse((await run(["list", file, "--canvas", "tb-1"])).out);
    assert.equal(listed.textBoxes[0].title, "Inner");
    const main = JSON.parse((await run(["list", file])).out);
    assert.equal(main.textBoxes[0].subCanvas.objects, 1);
    const got = JSON.parse((await run(["get", "tb-1", file, "--canvas", "tb-1"])).out);
    assert.equal(got.title, "Inner");
    const deep = JSON.parse((await run(["query", file, "--text", "inner", "--deep"])).out);
    assert.equal(deep.entities[0].canvas, "tb-1");
    const bad = await run(["add", "textBox", file, "--canvas", "tb-7"]);
    assert.equal(JSON.parse(bad.err).error.code, "ENOENT");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
