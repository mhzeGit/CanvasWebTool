import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

function cli(args, input = "") {
  return new Promise((done, reject) => {
    const child = spawn(
      process.execPath,
      [resolve("bin/canvas.mjs"), ...args],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "",
      err = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (err += b));
    child.on("error", reject);
    child.on("close", (code) => done({ code, out, err }));
    child.stdin.end(input);
  });
}
test("CLI runs offline from arbitrary cwd paths and accepts stdin with structured errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "canvas-cli-"));
  const file = join(dir, "plan with spaces.cvdoc");
  try {
    assert.equal((await cli(["create", file])).code, 0);
    const added = await cli(
      ["add", "textBox", file, "--json", "-"],
      JSON.stringify({ title: "CLI note", position: { x: 15, y: 30 } }),
    );
    assert.equal(added.code, 0, added.err);
    assert.equal(JSON.parse(added.out).id, "tb-1");
    const read = JSON.parse((await cli(["read", file])).out);
    assert.equal(read.entities.textBoxes[0].title, "CLI note");
    assert.ok(read.agent.revision);
    const ops = join(dir, "batch.json");
    await writeFile(
      ops,
      JSON.stringify([
        { op: "update", id: "tb-1", props: { title: "Changed" } },
      ]),
    );
    assert.equal(
      (
        await cli([
          "apply",
          file,
          "--input",
          ops,
          "--revision",
          read.agent.revision,
        ])
      ).code,
      0,
    );
    const stale = await cli([
      "delete",
      "tb-1",
      file,
      "--revision",
      read.agent.revision,
    ]);
    assert.notEqual(stale.code, 0);
    assert.equal(JSON.parse(stale.err).error.code, "ECONFLICT");
    const config = JSON.parse((await cli(["mcp-config"])).out);
    assert.ok(config.mcpServers.canvas.args[0].endsWith("canvas-mcp.mjs"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
