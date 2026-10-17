import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentService } from "../lib/agent-service.mjs";
import {
  emptyDocument,
  toAgentDocument,
  toLegacy,
  applyOperations,
  patchJson,
} from "../lib/agent-document.mjs";

async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), "canvas-agents-"));
  try {
    await run(new AgentService(), join(dir, "plan.cvdoc"), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const add = {
  op: "add",
  type: "textBox",
  alias: "note",
  props: { title: "Design", content: "Body", position: { x: 10, y: 20 } },
};
test("atomic batches create aliases and links and can query graph and text", () =>
  fixture(async (s, file) => {
    await s.create({ file });
    const original = await s.read({ file });
    const result = await s.apply({
      file,
      expectedRevision: original.revision,
      operations: [
        add,
        { op: "add", type: "shape", alias: "shape", props: { type: "circle" } },
        {
          op: "connect",
          from: "$note",
          to: "$shape",
          kind: "arrow",
          alias: "link",
        },
      ],
    });
    assert.equal(result.aliases.note, "tb-1");
    assert.equal(result.aliases.link, "arr-1");
    assert.equal(result.summary.graph[0].to, "shp-1");
    const found = await s.query({ file, text: "design" });
    assert.equal(found.total, 1);
    assert.equal(found.entities[0].title, "Design");
  }));
test("failed batches and dry runs leave exact file bytes unchanged", () =>
  fixture(async (s, file) => {
    await s.create({ file });
    const before = await readFile(file, "utf8");
    await assert.rejects(
      s.apply({
        file,
        operations: [
          add,
          { op: "update", id: "tb-1", props: { size: { w: -1 } } },
        ],
      }),
      { code: "EINVAL" },
    );
    assert.equal(await readFile(file, "utf8"), before);
    await s.apply({ file, operations: [add], dryRun: true });
    assert.equal(await readFile(file, "utf8"), before);
  }));
test("stale revisions reject writes", () =>
  fixture(async (s, file) => {
    const original = await s.create({ file });
    await s.apply({ file, operations: [add] });
    await assert.rejects(
      s.apply({ file, expectedRevision: original.revision, operations: [add] }),
      { code: "ECONFLICT" },
    );
  }));
test("concurrent agents serialize edits rather than lose updates", () =>
  fixture(async (s, file) => {
    await s.create({ file });
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        s.apply({
          file,
          operations: [{ ...add, props: { title: String(i) } }],
        }),
      ),
    );
    assert.equal((await s.query({ file })).total, 8);
  }));
test("lossless edits preserve rich JSON, unknown fields, metadata, settings and image placement", () =>
  fixture(async (s, file, dir) => {
    const raw = emptyDocument();
    raw.customRoot = { kept: true };
    raw.metadata = { created: "original", author: "Artist" };
    raw.document.settings = { custom: "yes" };
    raw.document.customDoc = { kept: true };
    const p = applyOperations(toAgentDocument(raw), [
      add,
      { op: "add", type: "shape", props: {} },
    ]).document;
    const root = toLegacy(p);
    root.document.textBoxes[0].content = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Rich" }] },
      ],
    };
    root.document.textBoxes[0].text = "";
    root.document.textBoxes[0].custom = { kept: true };
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    root.document.shapes[0].image = {
      src: "data:image/png;base64," + png,
      x: 17,
      y: 13,
      w: 72,
      h: 31,
      keepRatio: false,
      fileName: "custom.png",
      custom: "kept",
    };
    await s.create({ file, document: root });
    await s.apply({
      file,
      operations: [{ op: "update", id: "tb-1", props: { title: "Retitled" } }],
    });
    const round = (await s.read({ file, format: "raw" })).document;
    assert.deepEqual(
      round.document.textBoxes[0].content,
      root.document.textBoxes[0].content,
    );
    assert.deepEqual(round.document.textBoxes[0].custom, { kept: true });
    assert.deepEqual(round.metadata, root.metadata);
    assert.deepEqual(round.document.settings, root.document.settings);
    assert.deepEqual(round.customRoot, { kept: true });
    assert.deepEqual(round.document.customDoc, { kept: true });
    assert.deepEqual(
      round.document.shapes[0].image,
      root.document.shapes[0].image,
    );
    const out = join(dir, "export.json");
    await s.export({ file, destination: out });
    assert.equal(
      (await s.read({ file: out })).document.entities.shapes[0].image.w,
      72,
    );
  }));
test("content updates clear rich caches while richText and blocks remain editable", () =>
  fixture(async (s, file) => {
    await s.create({ file });
    await s.apply({
      file,
      operations: [
        add,
        {
          op: "update",
          id: "$note",
          props: { richText: { type: "doc", content: [] } },
        },
      ],
    });
    let raw = (await s.read({ file, format: "raw" })).document;
    assert.equal(raw.document.textBoxes[0].content.type, "doc");
    assert.equal(raw.document.textBoxes[0].text, "");
    await s.apply({
      file,
      operations: [
        { op: "update", id: "tb-1", props: { content: "Markdown" } },
      ],
    });
    raw = (await s.read({ file, format: "raw" })).document;
    assert.equal(raw.document.textBoxes[0].content, undefined);
    assert.equal(raw.document.textBoxes[0].text, "Markdown");
  }));
test("full JSON Patch edits extension fields, tests revisions and rejects prototype pollution", () =>
  fixture(async (s, file) => {
    await s.create({ file });
    await s.apply({
      file,
      operations: [
        add,
        {
          op: "patch",
          patches: [
            {
              op: "add",
              path: "/document/textBoxes/0/custom",
              value: { nested: 1 },
            },
            {
              op: "test",
              path: "/document/textBoxes/0/title",
              value: "Design",
            },
          ],
        },
      ],
    });
    assert.equal(
      (await s.read({ file, format: "raw" })).document.document.textBoxes[0]
        .custom.nested,
      1,
    );
    await assert.rejects(
      s.apply({
        file,
        operations: [
          {
            op: "patch",
            patches: [{ op: "add", path: "/__proto__/polluted", value: true }],
          },
        ],
      }),
      { code: "EINVAL" },
    );
    assert.equal({}.polluted, undefined);
    assert.throws(
      () => patchJson({}, [{ op: "test", path: "", value: { no: true } }]),
      { code: "ECONFLICT" },
    );
  }));
test("reference validation rejects cycles and dangling links", () =>
  fixture(async (s, file) => {
    await s.create({ file });
    await s.apply({
      file,
      operations: [add, { op: "add", type: "shape", props: {} }],
    });
    await assert.rejects(
      s.apply({
        file,
        operations: [
          {
            op: "update",
            id: "tb-1",
            props: { parent: { entityId: "shp-999", type: "shape" } },
          },
        ],
      }),
      { code: "EINVAL" },
    );
    await assert.rejects(
      s.apply({
        file,
        operations: [
          {
            op: "update",
            id: "tb-1",
            props: { parent: { entityId: "shp-1", type: "shape" } },
          },
          {
            op: "update",
            id: "shp-1",
            props: { parent: { entityId: "tb-1", type: "textBox" } },
          },
        ],
      }),
      { code: "EINVAL" },
    );
  }));
test("locked edits require explicit unlock and deleting nodes repairs links", () =>
  fixture(async (s, file) => {
    await s.create({ file });
    await s.apply({
      file,
      operations: [
        add,
        { op: "add", type: "textBox", alias: "other", props: {} },
        { op: "connect", from: "$note", to: "$other", kind: "connection" },
        { op: "update", id: "$note", props: { locked: true } },
      ],
    });
    await assert.rejects(
      s.apply({ file, operations: [{ op: "delete", id: "tb-1" }] }),
      { code: "ELOCKED" },
    );
    await s.apply({
      file,
      operations: [
        { op: "update", id: "tb-1", props: { locked: false } },
        { op: "delete", id: "tb-1" },
      ],
    });
    assert.equal(
      (await s.read({ file, format: "summary" })).summary.counts.connections,
      0,
    );
  }));
test("portable files remain portable and create/export never silently overwrite", () =>
  fixture(async (s, file, dir) => {
    const json = join(dir, "plan.json");
    await s.create({ file: json, format: "portable" });
    await s.apply({ file: json, operations: [add] });
    assert.equal(
      JSON.parse(await readFile(json, "utf8")).meta.format,
      "canvaswebtool-portable",
    );
    await assert.rejects(s.create({ file: json }), { code: "EEXIST" });
    await assert.rejects(s.export({ file: json, destination: json }), {
      code: "EINVAL",
    });
  }));
test("strict numeric validation, shape validation and pagination limits", () =>
  fixture(async (s, file) => {
    await s.create({ file });
    for (const props of [
      { size: { w: -2 } },
      { position: { x: "4" } },
      { locked: "false" },
      { style: { fontSize: 0 } },
    ])
      await assert.rejects(s.apply({ file, operations: [{ ...add, props }] }), {
        code: "EINVAL",
      });
    await assert.rejects(s.query({ file, limit: 1001 }), { code: "EINVAL" });
    await assert.rejects(
      s.apply({
        file,
        operations: [{ op: "add", type: "shape", props: { type: "hexagon" } }],
      }),
      { code: "EINVAL" },
    );
  }));

test("raw dangling line indices are rejected instead of silently detached", () =>
  fixture(async (s, file) => {
    await s.create({ file });
    await s.apply({
      file,
      operations: [add, { op: "add", type: "arrow", props: {} }],
    });
    await assert.rejects(
      s.apply({
        file,
        operations: [
          {
            op: "patch",
            patches: [
              {
                op: "add",
                path: "/document/arrows/0/connectedFrom",
                value: 999,
              },
              {
                op: "add",
                path: "/document/arrows/0/connectedFromType",
                value: "textBox",
              },
            ],
          },
        ],
      }),
      { code: "EINVAL" },
    );
  }));
test("add connection accepts stable endpoints and native exports retain rich JSON", () =>
  fixture(async (s, file) => {
    await s.create({ file });
    await s.apply({
      file,
      operations: [
        add,
        { op: "add", type: "textBox", alias: "other", props: {} },
        {
          op: "add",
          type: "connection",
          props: { from: "$note", to: "$other", label: "then" },
        },
      ],
    });
    assert.equal(
      (await s.read({ file, format: "summary" })).summary.counts.connections,
      1,
    );
    const p = (await s.snapshot({ file })).document;
    const rich = { type: "doc", content: [] };
    p.entities.textBoxes[0].nativeData = { content: rich, text: "" };
    delete p.entities.textBoxes[0].richText;
    assert.deepEqual(toLegacy(p).document.textBoxes[0].content, rich);
  }));
