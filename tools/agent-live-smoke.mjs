/** Runs an isolated invisible native session and verifies background CLI/MCP against its real named pipe. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { AgentService } from "../lib/agent-service.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { connectToApp } from "../lib/client.mjs";

const dir = await mkdtemp(join(tmpdir(), "canvas-native-agents-"));
process.env.CANVASWEBTOOL_STATE_DIR = dir;
const executable = resolve("native/Canvas/bin/Debug/net8.0/Canvas.Native.exe");
const child = spawn(executable, ["--background", "--test-mode"], {
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, CANVASWEBTOOL_STATE_DIR: dir },
});
let log = "";
child.stderr.on("data", (b) => (log += b));
child.stdout.on("data", (b) => (log += b));
let client,
  rawClient,
  checks = 0;
const check = (label, condition) => {
  assert.ok(condition, label);
  checks++;
  console.log("PASS:", label);
};
try {
  let endpoint;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Native app exited: ${log}`);
    try {
      endpoint = JSON.parse(await readFile(join(dir, "endpoint.json"), "utf8"));
      break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(endpoint, `Native app did not become ready: ${log}`);
  check(
    "native advertises background agent protocol",
    endpoint.agentProtocol === 1 && endpoint.testMode === true,
  );
  const service = new AgentService();
  const empty = await service.read({ format: "summary" });
  const edit = await service.apply({
    expectedRevision: empty.revision,
    operations: [
      {
        op: "add",
        type: "textBox",
        alias: "a",
        props: { title: "A", position: { x: 100, y: 100 } },
      },
      {
        op: "add",
        type: "textBox",
        alias: "b",
        props: { title: "B", position: { x: 400, y: 100 } },
      },
      { op: "connect", from: "$a", to: "$b", kind: "connection" },
    ],
  });
  check(
    "live batch creates nodes and graph without selection or dialogs",
    edit.summary.counts.textBoxes === 2 && edit.summary.graph.length === 1,
  );
  await assert.rejects(
    service.apply({
      expectedRevision: empty.revision,
      operations: [{ op: "delete", id: "tb-1" }],
    }),
    { code: "ECONFLICT" },
  );
  check("live compare-and-swap rejects stale revision", true);
  await service.session("undo");
  check("live batch is one undo step", (await service.query()).total === 0);
  await service.session("redo");
  check("redo restores all entities", (await service.query()).total === 3);
  const before = await service.read({ format: "raw" });
  await assert.rejects(
    service.apply({
      operations: [
        { op: "update", id: "tb-1", props: { title: "Wrong" } },
        { op: "update", id: "tb-999", props: { title: "Missing" } },
      ],
    }),
    { code: "ENOENT" },
  );
  check(
    "failed live batch rolls back without changing revision",
    (await service.read({ format: "summary" })).revision === before.revision,
  );
  await assert.rejects(service.session("save"), { code: "EPATH" });
  check("saving untitled session returns EPATH instead of picker", true);
  await assert.rejects(service.session("new"), { code: "EUNSAVED" });
  check("new on dirty session returns EUNSAVED instead of dialog", true);
  const file = join(dir, "live.cvdoc");
  await service.session("save", { path: file });
  check(
    "explicit native save writes file",
    JSON.parse(await readFile(file, "utf8")).document.connections.length === 1,
  );
  await assert.rejects(
    service.apply({
      file,
      mode: "offline",
      operations: [{ op: "delete", id: "tb-1" }],
    }),
    { code: "EOPEN" },
  );
  check("offline mode cannot overwrite a live file", true);
  await service.apply({
    file,
    operations: [
      {
        op: "patch",
        patches: [
          { op: "add", path: "/metadata/owner", value: "agent" },
          {
            op: "add",
            path: "/document/textBoxes/0/custom",
            value: { kept: true },
          },
        ],
      },
    ],
  });
  check(
    "raw metadata and extension edits survive native application",
    (await service.read({ format: "raw" })).document.document.textBoxes[0]
      .custom.kept === true,
  );
  const rich = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Native rich", marks: [{ type: "bold" }] },
        ],
      },
    ],
  };
  await service.apply({
    operations: [
      { op: "update", id: "tb-1", props: { richText: rich } },
      { op: "add", type: "shape", alias: "photo", props: {} },
      {
        op: "image",
        id: "$photo",
        path: resolve("favicon.png"),
        width: 75,
        height: 48,
      },
    ],
  });
  await service.session("save");
  await service.session("open", { path: file });
  const withAssets = (await service.read({ format: "raw" })).document;
  check(
    "native rich-text JSON survives background edit/save/open",
    JSON.stringify(withAssets.document.textBoxes[0].content) ===
      JSON.stringify(rich),
  );
  check(
    "native image and placement survive background edit/save/open",
    withAssets.document.shapes[0].image.src.startsWith("data:") &&
      withAssets.document.shapes[0].image.w === 75 &&
      withAssets.document.shapes[0].image.h === 48,
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("bin/canvas-mcp.mjs")],
    env: { ...process.env, CANVASWEBTOOL_STATE_DIR: dir },
    stderr: "pipe",
  });
  client = new Client({ name: "canvas-native-live-test", version: "1" });
  await client.connect(transport);
  const mcp = await client.callTool({
    name: "canvas_query",
    arguments: { file, text: "A" },
  });
  check(
    "real MCP server routes into native session",
    !mcp.isError &&
      mcp.structuredContent.mode === "live" &&
      mcp.structuredContent.total === 1,
  );
  const command = spawn(
    process.execPath,
    [
      resolve("bin/canvas.mjs"),
      "update",
      "tb-1",
      file,
      "--set",
      "title=CLI live",
    ],
    {
      windowsHide: true,
      env: { ...process.env, CANVASWEBTOOL_STATE_DIR: dir },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let cliOut = "",
    cliErr = "";
  command.stdout.on("data", (b) => (cliOut += b));
  command.stderr.on("data", (b) => (cliErr += b));
  const exit = await new Promise((r) => command.on("close", r));
  check(
    "real CLI updates live native document",
    exit === 0 && JSON.parse(cliOut).agent.mode === "live",
  );
  assert.equal(cliErr, "");
  const root = (await service.read({ format: "raw" })).document;
  root.document.textBoxes[0].title = "disk edit";
  await writeFile(file, JSON.stringify(root));
  await assert.rejects(service.session("save"), { code: "ECONFLICT" });
  check("native save refuses external disk changes", true);
  rawClient = await connectToApp(endpoint);
  const current = await rawClient.request("agent.read");
  await assert.rejects(
    rawClient.request("agent.replace", {
      expectedRevision: current.revision,
      expectedPath: "other.cvdoc",
      data: current.data,
    }),
    { code: "ECONFLICT" },
  );
  check("native rejects document-switch race", true);
  const malformed = structuredClone(current.data);
  malformed.document.connections[0].from = 999;
  await assert.rejects(
    rawClient.request("agent.replace", {
      expectedRevision: current.revision,
      expectedPath: current.file,
      data: malformed,
    }),
    { code: "EINVAL" },
  );
  check(
    "native validates raw references before committing",
    (await rawClient.request("agent.read")).revision === current.revision,
  );
  console.log(`Native background checks passed: ${checks}`);
} finally {
  await client?.close();
  if (rawClient) {
    try {
      await rawClient.request("quit", { force: true });
    } catch {}
    rawClient.close();
  }
  if (child.exitCode === null) {
    await new Promise((r) => {
      const timer = setTimeout(() => {
        child.kill();
        r();
      }, 1500);
      child.once("close", () => {
        clearTimeout(timer);
        r();
      });
    });
  }
  await rm(dir, { recursive: true, force: true });
}
