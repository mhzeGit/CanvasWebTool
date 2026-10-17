import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("official MCP client negotiates stdio and discovers/tools/resources/prompts, edits without app", async () => {
  const dir = await mkdtemp(join(tmpdir(), "canvas-mcp-"));
  const file = join(dir, "mcp.cvdoc");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("bin/canvas-mcp.mjs")],
    stderr: "pipe",
  });
  let errors = "";
  transport.stderr?.on("data", (data) => (errors += data));
  const client = new Client({
    name: "canvas-integration-test",
    version: "1.0.0",
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 9);
    assert.ok(
      tools.tools.find((t) => t.name === "canvas_edit").inputSchema.properties
        .operations,
    );
    const resources = await client.listResources();
    assert.equal(resources.resources.length, 3);
    assert.match(
      (await client.readResource({ uri: "canvas://guide" })).contents[0].text,
      /expectedRevision/,
    );
    assert.equal((await client.listPrompts()).prompts[0].name, "edit-canvas");
    const call = async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError, JSON.stringify(result));
      return result.structuredContent;
    };
    await call("canvas_create", { file });
    const read = await call("canvas_read", { file, format: "summary" });
    await call("canvas_edit", {
      file,
      expectedRevision: read.revision,
      operations: [
        { op: "add", type: "textBox", props: { title: "MCP background" } },
      ],
    });
    const query = await call("canvas_query", { file, text: "background" });
    assert.equal(query.total, 1);
    const stale = await client.callTool({
      name: "canvas_edit",
      arguments: {
        file,
        expectedRevision: read.revision,
        operations: [{ op: "delete", id: "tb-1" }],
      },
    });
    assert.equal(stale.isError, true);
    assert.equal(stale.structuredContent.error.code, "ECONFLICT");
    const invalid = await client.callTool({
      name: "canvas_query",
      arguments: { file, limit: -1 },
    });
    assert.equal(invalid.isError, true);
    assert.equal((await call("canvas_query", { file })).total, 1);
    assert.equal(errors, "");
  } finally {
    await client.close();
    await rm(dir, { recursive: true, force: true });
  }
});
