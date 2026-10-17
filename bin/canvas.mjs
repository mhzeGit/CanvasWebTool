#!/usr/bin/env node
/** JSON-first background CLI; all editing behavior is shared with MCP. */
import { readFile } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { AgentService } from "../lib/agent-service.mjs";
import { agentSchema } from "../lib/agent-schema.mjs";
import { listEntities, getEntity } from "../lib/doc-ops.mjs";
import {
  describePath,
  installOnPath,
  uninstallFromPath,
} from "../lib/path-setup.mjs";
import { connectToApp } from "../lib/client.mjs";
import { readEndpoint } from "../shared/endpoint.mjs";

const HELP = `canvas — background document editing and MCP

Usage: canvas <command> [arguments] [options]

schema                         Discover fields, operations and agent workflows
status                         Inspect the running native app
create <file>                  Create document; --json optionally supplies contents
read [file]                    Portable document plus agent.revision/file/mode
inspect [file]                 Counts, bounds, graph and revision
query [file]                   --text, --type, --ids, --parent, --limit, --offset
list [file]                    Summarise entities; optionally --type
get <id> [file]                Complete entity
add <type> [file]              Create entity with --json or --set
update <id> [file]             Update fields with --json or --set
delete <id> [file]             Remove entity and repair references
connect <from> <to> [file]     --kind arrow|connector|connection --label --color
apply [file]                   Atomic operations from --json/--input; --dry-run
patch [file]                   JSON Patch on the raw envelope from --json/--input
import <source.json> [file]    Replace contents preserving current file identity
export <destination> [file]   Portable JSON, or --raw .cvdoc
open <file>                    Open native session without focusing the window
new                            New session; --discard-changes if explicitly needed
save [path]                    Save native session without a picker
undo | redo                    Native undo history
watch                          Stream native changes as NDJSON
mcp                            Standard MCP stdio server; stdout is protocol only
mcp-config                     Print generic MCP client configuration
path [--install|--uninstall]   Inspect/install CLI PATH launchers

Options:
  -f, --file <path>        Explicit target (or CANVAS_FILE)
      --live|--offline    Require mode; offline cannot change an open file
      --json <json|->    JSON input; - reads stdin
      --input <path>     JSON input file
      --set key=value    Repeatable nested field update, overriding --json
      --revision <rev>   Expected revision; stale changes fail
      --include-images   Include embedded image payloads in reads
      --raw              Read/export complete legacy envelope
      --overwrite        Explicitly replace existing destination
      --dry-run          Validate without writing
  -p, --pretty           Indent output JSON
Errors: JSON on stderr with stable codes and nonzero exit status. No dialogs.
`;
const bools = new Set([
  "live",
  "offline",
  "pretty",
  "quiet",
  "help",
  "version",
  "install",
  "uninstall",
  "raw",
  "include-images",
  "overwrite",
  "dry-run",
  "discard-changes",
  "force",
]);
const values = new Set([
  "file",
  "json",
  "input",
  "set",
  "revision",
  "type",
  "kind",
  "label",
  "color",
  "text",
  "ids",
  "parent",
  "limit",
  "offset",
  "format",
]);
function parse(args) {
  const positional = [],
    options = {},
    sets = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      positional.push(arg);
      continue;
    }
    const split = arg.replace(/^--?/, "").split("=");
    const name =
      {
        f: "file",
        t: "type",
        p: "pretty",
        q: "quiet",
        h: "help",
        v: "version",
      }[split[0]] ?? split[0];
    let value = split.length > 1 ? split.slice(1).join("=") : undefined;
    if (bools.has(name)) {
      options[name] = value !== "false";
      continue;
    }
    if (!values.has(name))
      throw Object.assign(new Error(`Unknown option --${name}`), {
        code: "EUSAGE",
      });
    value ??= args[++i];
    if (value === undefined) throw new Error(`--${name} needs a value`);
    if (name === "set") sets.push(value);
    else options[name] = value;
  }
  if (options.live && options.offline)
    throw new Error("Choose --live or --offline");
  return { positional, options, sets };
}
async function stdin() {
  let text = "";
  for await (const chunk of process.stdin) {
    text += chunk;
    if (Buffer.byteLength(text) > 32 * 1024 * 1024)
      throw new Error("Input exceeds 32 MB");
  }
  return text;
}
async function payload(options, sets) {
  let value = {};
  if (options.input && options.json)
    throw new Error("Choose --input or --json");
  if (options.input)
    value = JSON.parse(await readFile(resolve(options.input), "utf8"));
  else if (options.json)
    value = JSON.parse(options.json === "-" ? await stdin() : options.json);
  for (const entry of sets) {
    const equal = entry.indexOf("=");
    if (equal < 1) throw new Error("--set expects key=value");
    const keys = entry.slice(0, equal).split(".");
    if (keys.some((k) => ["__proto__", "prototype", "constructor"].includes(k)))
      throw new Error("Unsafe field path");
    let target = value;
    for (const k of keys.slice(0, -1)) {
      if (!target[k] || typeof target[k] !== "object") target[k] = {};
      target = target[k];
    }
    const raw = entry.slice(equal + 1);
    let parsed = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {}
    target[keys.at(-1)] = parsed;
  }
  return value;
}
export async function runCli(args) {
  const { positional, options, sets } = parse(args);
  const command = positional.shift();
  if (options.version)
    return JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ).version;
  if (!command || command === "help" || options.help) return HELP;
  if (command === "mcp") {
    await import("./canvas-mcp.mjs");
    return undefined;
  }
  if (command === "mcp-config")
    return {
      mcpServers: {
        canvas: {
          command: process.execPath,
          args: [fileURLToPath(new URL("./canvas-mcp.mjs", import.meta.url))],
          ...(process.versions.electron
            ? { env: { ELECTRON_RUN_AS_NODE: "1" } }
            : {}),
        },
      },
    };
  if (command === "schema") return agentSchema();
  if (command === "path")
    return options.install
      ? installOnPath()
      : options.uninstall
        ? uninstallFromPath()
        : describePath();
  const service = new AgentService();
  if (command === "status") return service.status();
  if (command === "watch") {
    const endpoint = await readEndpoint();
    if (!endpoint)
      throw Object.assign(new Error("Canvas is not running"), {
        code: "ENOTRUNNING",
      });
    const client = await connectToApp(endpoint);
    client.onEvent((e) => process.stdout.write(JSON.stringify(e) + "\n"));
    await client.request("watch");
    await client.closed();
    return undefined;
  }
  const target = (file) => ({
    file: options.file ?? file ?? process.env.CANVAS_FILE,
    mode: options.live ? "live" : options.offline ? "offline" : "auto",
    expectedRevision: options.revision,
    includeImages: options["include-images"] === true,
  });
  if (command === "create") {
    const file = options.file ?? positional.shift();
    const doc =
      options.json || options.input ? await payload(options, sets) : undefined;
    return service.create({
      file,
      document: doc,
      format: options.format ?? "cvdoc",
      overwrite: options.overwrite === true,
    });
  }
  if (["open", "new", "save", "undo", "redo"].includes(command))
    return service.session(command, {
      path: options.file ?? positional.shift(),
      expectedRevision: options.revision,
      overwrite: options.overwrite,
      discardChanges: options["discard-changes"] || options.force,
    });
  if (command === "export")
    return service.export({
      ...target(positional[1]),
      destination: positional[0],
      format: options.raw ? "raw" : "portable",
      overwrite: options.overwrite,
    });
  if (command === "import") {
    const source = positional.shift();
    if (!source) throw new Error("import requires a JSON file or -");
    const document = JSON.parse(
      source === "-" ? await stdin() : await readFile(resolve(source), "utf8"),
    );
    return service.replace({ ...target(positional.shift()), document });
  }
  if (command === "read") {
    const result = await service.read({
      ...target(positional.shift()),
      format: options.raw ? "raw" : "portable",
    });
    return {
      ...result.document,
      agent: {
        revision: result.revision,
        file: result.file,
        mode: result.mode,
        summary: result.summary,
      },
    };
  }
  if (command === "inspect")
    return service.read({ ...target(positional.shift()), format: "summary" });
  if (command === "query")
    return service.query({
      ...target(positional.shift()),
      type: options.type,
      text: options.text,
      ids: options.ids?.split(","),
      parent: options.parent,
      limit: options.limit === undefined ? 100 : Number(options.limit),
      offset: options.offset === undefined ? 0 : Number(options.offset),
    });
  if (command === "get") {
    const id = positional.shift();
    const result = await service.snapshot(target(positional.shift()));
    return getEntity(result.document, id);
  }
  if (command === "list") {
    const result = await service.snapshot(target(positional.shift()));
    return listEntities(result.document, options.type);
  }
  let operations;
  if (command === "apply") {
    const value = await payload(options, sets);
    operations = Array.isArray(value) ? value : value.operations;
  } else if (command === "patch") {
    const value = await payload(options, sets);
    operations = [
      { op: "patch", patches: Array.isArray(value) ? value : value.patches },
    ];
  } else if (command === "add")
    operations = [
      {
        op: "add",
        type: positional.shift(),
        props: await payload(options, sets),
      },
    ];
  else if (command === "update")
    operations = [
      {
        op: "update",
        id: positional.shift(),
        props: await payload(options, sets),
      },
    ];
  else if (command === "delete")
    operations = [{ op: "delete", id: positional.shift() }];
  else if (command === "connect")
    operations = [
      {
        op: "connect",
        from: positional.shift(),
        to: positional.shift(),
        kind: options.kind ?? "arrow",
        label: options.label,
        color: options.color,
      },
    ];
  else
    throw Object.assign(new Error(`Unknown command: ${command}`), {
      code: "EUSAGE",
    });
  const result = await service.apply({
    ...target(positional.shift()),
    operations,
    dryRun: options["dry-run"] === true,
  });
  return ["add", "update", "delete", "connect"].includes(command)
    ? {
        ...result.results[0],
        agent: {
          revision: result.revision,
          file: result.file,
          mode: result.mode,
        },
      }
    : result;
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  runCli(process.argv.slice(2))
    .then((result) => {
      if (result !== undefined)
        process.stdout.write(
          (typeof result === "string"
            ? result
            : JSON.stringify(
                result,
                null,
                process.argv.includes("--pretty") || process.argv.includes("-p")
                  ? 2
                  : 0,
              )) + "\n",
        );
    })
    .catch((error) => {
      process.stderr.write(
        JSON.stringify({
          error: { code: error.code ?? "EFAIL", message: error.message },
        }) + "\n",
      );
      process.exitCode =
        error.code === "ENOENT"
          ? 4
          : error.code === "EUSAGE"
            ? 2
            : error.code === "ENOTRUNNING"
              ? 3
              : 1;
    });
}
