#!/usr/bin/env node
/**
 * `canvas` — read and edit Canvas documents from a terminal or an agent.
 *
 * The same commands work whether or not the app is open:
 *
 *   - **app open, same document** — the command is sent to the running app, so
 *     the change appears on screen at once and lands on the app's undo stack.
 *   - **app closed, or a different document** — the file on disk is edited
 *     directly.
 *
 * Which one applies is decided automatically; `--live` and `--offline` force
 * the choice. Output is JSON on stdout, diagnostics on stderr, and the exit
 * code is 0 for success and non-zero for failure, so it is safe to pipe.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readEndpoint } from '../shared/endpoint.mjs';
import { connectToApp } from '../lib/client.mjs';
import { readPortable, writePortable, writePortableJson } from '../lib/cvdoc.mjs';
import {
  addEntity, connectEntities, deleteEntity, DocError, getEntity, listEntities, updateEntity,
} from '../lib/doc-ops.mjs';
import { isPortable } from '../js/portable-format.js';
import { describePath, installOnPath, uninstallFromPath } from '../lib/path-setup.mjs';

const EXIT = { ok: 0, usage: 2, failed: 1, noApp: 3, notFound: 4 };

class UsageError extends Error {}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/** Flags that take no value. */
const BOOLEAN_FLAGS = new Set([
  'live', 'offline', 'pretty', 'quiet', 'help', 'version', 'install', 'uninstall', 'force',
]);

function parseArgs(argv) {
  const positional = [];
  const options = {};
  const sets = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith('-') || arg === '-') {
      positional.push(arg);
      continue;
    }

    const long = arg.startsWith('--');
    let name = long ? arg.slice(2) : arg.slice(1);
    let value = null;

    const equals = name.indexOf('=');
    if (equals >= 0) {
      value = name.slice(equals + 1);
      name = name.slice(0, equals);
    }
    name = SHORT_FLAGS[name] || name;

    if (BOOLEAN_FLAGS.has(name)) {
      options[name] = value === null ? true : value !== 'false';
      continue;
    }
    if (value === null) {
      value = argv[++i];
      if (value === undefined) throw new UsageError(`--${name} needs a value`);
    }
    if (name === 'set') sets.push(value);
    else options[name] = value;
  }

  return { positional, options, sets };
}

const SHORT_FLAGS = { f: 'file', t: 'type', h: 'help', v: 'version', p: 'pretty', q: 'quiet' };

/** `--set style.color=#ff0000` -> nested props, with JSON-ish value coercion. */
function propsFromSets(sets) {
  const props = {};
  for (const entry of sets) {
    const equals = entry.indexOf('=');
    if (equals < 0) throw new UsageError(`--set expects key=value, got "${entry}"`);
    assignPath(props, entry.slice(0, equals), coerceValue(entry.slice(equals + 1)));
  }
  return props;
}

function assignPath(target, path, value) {
  const parts = path.split('.');
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cursor[parts[i]] !== 'object' || cursor[parts[i]] === null) cursor[parts[i]] = {};
    cursor = cursor[parts[i]];
  }
  cursor[parts.at(-1)] = value;
}

/**
 * Numbers, booleans and null are recognised; everything else stays a string,
 * so `--set style.color=#ff0000` and `--set title=123 Main St` both behave.
 */
function coerceValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

async function readProps(options, sets) {
  const props = propsFromSets(sets);
  if (!options.json) return props;

  const text = options.json === '-' ? await readStdin() : options.json;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new UsageError(`--json is not valid JSON: ${err.message}`);
  }
  // --set wins, so a scripted JSON body can still be tweaked on the command line.
  return { ...parsed, ...props };
}

function readStdin() {
  return new Promise((resolvePromise, rejectPromise) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolvePromise(data));
    process.stdin.on('error', rejectPromise);
  });
}

// ---------------------------------------------------------------------------
// Choosing between the running app and the file on disk
// ---------------------------------------------------------------------------

function samePath(a, b) {
  if (!a || !b) return false;
  const normalise = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  return normalise(a) === normalise(b);
}

/**
 * Decide where a command should run.
 *
 * Editing a file on disk that the app currently has open would be overwritten
 * by the app's next save, so when the app holds the requested document the
 * command is always routed to it.
 */
async function chooseTarget(options, filePath) {
  const endpoint = options.offline ? null : await readEndpoint();

  if (options.live) {
    if (!endpoint) {
      const err = new Error('No running Canvas app to talk to. Start it, or drop --live to edit the file directly.');
      err.exitCode = EXIT.noApp;
      throw err;
    }
    if (filePath && !samePath(filePath, endpoint.filePath)) {
      const err = new Error(`The app has ${endpoint.filePath || 'an unsaved document'} open, not ${filePath}.`);
      err.exitCode = EXIT.failed;
      throw err;
    }
    return { mode: 'live', endpoint };
  }

  if (options.offline) {
    if (!filePath) throw new UsageError('--offline needs a file: pass one, or set CANVAS_FILE');
    return { mode: 'file', filePath };
  }

  if (endpoint && (!filePath || samePath(filePath, endpoint.filePath))) {
    return { mode: 'live', endpoint };
  }
  if (!filePath) {
    const err = new Error('No file given and no running app. Pass a file path, or set CANVAS_FILE.');
    err.exitCode = EXIT.noApp;
    throw err;
  }
  return { mode: 'file', filePath };
}

/** The document a command addresses, from the argument, a flag, or the environment. */
function resolveFile(options, positionalFile) {
  const candidate = positionalFile || options.file || process.env.CANVAS_FILE;
  return candidate ? resolve(candidate) : null;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Commands that read or edit a document. Each has a `live` form (forwarded to
 * the app) and a `file` form (applied to the portable JSON on disk).
 *
 * `file.mutates` marks the ones whose result must be written back.
 */
const DOCUMENT_COMMANDS = {
  read: {
    usage: 'canvas read [file]',
    summary: 'Print the whole document as portable JSON',
    live: (client) => client.request('read'),
    file: ({ doc }) => doc,
  },
  list: {
    usage: 'canvas list [file] [--type shape|textBox|arrow|connector|connection]',
    summary: 'Summarise the entities in the document',
    live: (client, { options }) => client.request('list', { type: options.type }),
    file: ({ doc, options }) => listEntities(doc, options.type),
  },
  get: {
    usage: 'canvas get <id> [file]',
    summary: 'Print one entity',
    args: ['id'],
    live: (client, { args }) => client.request('get', { id: args.id }),
    file: ({ doc, args }) => getEntity(doc, args.id),
  },
  add: {
    usage: 'canvas add <shape|textBox|arrow|connector> [--json {...}] [--set key=value]',
    summary: 'Create an entity',
    args: ['type'],
    mutates: true,
    live: (client, { args, props }) => client.request('add', { type: args.type, props }),
    file: ({ doc, args, props }) => addEntity(doc, args.type, props),
  },
  update: {
    usage: 'canvas update <id> [--json {...}] [--set key=value]',
    summary: 'Change fields on an entity',
    args: ['id'],
    mutates: true,
    live: (client, { args, props }) => client.request('update', { id: args.id, props }),
    file: ({ doc, args, props }) => updateEntity(doc, args.id, props),
  },
  delete: {
    usage: 'canvas delete <id>',
    summary: 'Remove an entity and anything left dangling',
    args: ['id'],
    mutates: true,
    live: (client, { args }) => client.request('delete', { id: args.id }),
    file: ({ doc, args }) => deleteEntity(doc, args.id),
  },
  connect: {
    usage: 'canvas connect <from-id> <to-id> [--kind arrow|connector|connection] [--label text]',
    summary: 'Join two entities',
    args: ['from', 'to'],
    mutates: true,
    live: (client, { args, options }) => client.request('connect', {
      from: args.from, to: args.to, kind: options.kind, label: options.label, color: options.color,
    }),
    file: ({ doc, args, options }) => connectEntities(doc, args.from, args.to, {
      kind: options.kind, label: options.label, color: options.color,
    }),
  },
};

async function runDocumentCommand(name, spec, { positional, options, sets }) {
  const args = {};
  for (const key of spec.args || []) {
    const value = positional.shift();
    if (!value) throw new UsageError(`${spec.usage}\n\nMissing <${key}>`);
    args[key] = value;
  }

  const props = spec.mutates ? await readProps(options, sets) : {};
  const filePath = resolveFile(options, positional.shift());
  const target = await chooseTarget(options, filePath);

  if (target.mode === 'live') {
    const client = await connectToApp(target.endpoint);
    try {
      return { result: await spec.live(client, { args, options, props }), via: 'app' };
    } finally {
      client.close();
    }
  }

  const { portable: doc, path } = await readPortable(target.filePath);
  const result = spec.file({ doc, args, options, props });
  if (spec.mutates) await writePortable(path, doc);
  return { result, via: 'file', file: path };
}

// ---------------------------------------------------------------------------
// Commands that are not document edits
// ---------------------------------------------------------------------------

async function cmdStatus({ options }) {
  const endpoint = await readEndpoint();
  if (!endpoint) {
    return { result: { running: false }, via: 'none' };
  }
  const client = await connectToApp(endpoint);
  try {
    return { result: await client.request('status'), via: 'app' };
  } catch {
    // The endpoint file is there but the socket is not answering.
    return { result: { running: false, stale: true }, via: 'none' };
  } finally {
    client.close();
  }
}

async function cmdOpen({ positional, options }) {
  const filePath = resolveFile(options, positional.shift());
  if (!filePath) throw new UsageError('canvas open <file>');

  const endpoint = await readEndpoint();
  if (!endpoint) {
    const err = new Error('The Canvas app is not running, so there is nothing to open the file in.');
    err.exitCode = EXIT.noApp;
    throw err;
  }
  const client = await connectToApp(endpoint);
  try {
    return { result: await client.request('open', { path: filePath }), via: 'app' };
  } finally {
    client.close();
  }
}

/** Commands the app alone can perform, because they act on its live session. */
function appOnlyCommand(cmd, usage, summary) {
  return {
    usage,
    summary,
    run: async () => {
      const endpoint = await readEndpoint();
      if (!endpoint) {
        const err = new Error(`"${cmd}" needs the Canvas app to be running.`);
        err.exitCode = EXIT.noApp;
        throw err;
      }
      const client = await connectToApp(endpoint);
      try {
        return { result: await client.request(cmd), via: 'app' };
      } finally {
        client.close();
      }
    },
  };
}

async function cmdExport({ positional, options }) {
  const destination = positional.shift();
  const filePath = resolveFile(options, positional.shift());
  const target = await chooseTarget(options, filePath);

  let doc;
  if (target.mode === 'live') {
    const client = await connectToApp(target.endpoint);
    try {
      doc = await client.request('read');
    } finally {
      client.close();
    }
  } else {
    doc = (await readPortable(target.filePath)).portable;
  }

  if (!destination || destination === '-') return { result: doc, via: target.mode };
  const written = await writePortableJson(resolve(destination), doc);
  return { result: { exported: true, file: written.path }, via: target.mode };
}

async function cmdImport({ positional, options }) {
  const source = positional.shift();
  if (!source) throw new UsageError('canvas import <portable.json> [target.cvdoc]');

  const text = source === '-' ? await readStdin() : await readFile(resolve(source), 'utf8');
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new UsageError(`${source} is not valid JSON: ${err.message}`);
  }
  if (!isPortable(doc)) throw new UsageError(`${source} is not a portable Canvas document`);

  const filePath = resolveFile(options, positional.shift());
  const target = await chooseTarget(options, filePath);

  if (target.mode === 'live') {
    const client = await connectToApp(target.endpoint);
    try {
      return { result: await client.request('import', { json: doc }), via: 'app' };
    } finally {
      client.close();
    }
  }

  const written = await writePortable(target.filePath, doc);
  return { result: { imported: true, file: written.path }, via: 'file' };
}

async function cmdWatch({ options }) {
  const endpoint = await readEndpoint();
  if (!endpoint) {
    const err = new Error('watch needs the Canvas app to be running.');
    err.exitCode = EXIT.noApp;
    throw err;
  }

  const client = await connectToApp(endpoint);
  client.onEvent((event) => {
    process.stdout.write(JSON.stringify(event) + '\n');
  });
  await client.request('watch');
  if (!options.quiet) process.stderr.write('Watching for changes. Press Ctrl+C to stop.\n');

  // Resolve only when the socket drops, so the process stays alive streaming.
  await client.closed();
  return null;
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

async function cmdPath({ options }) {
  if (options.install) return { result: await installOnPath(), via: 'none' };
  if (options.uninstall) return { result: await uninstallFromPath(), via: 'none' };
  return { result: describePath(), via: 'none' };
}

const EXTRA_COMMANDS = {
  status: { usage: 'canvas status', summary: 'Report whether the app is running and what it has open', run: cmdStatus },
  path: { usage: 'canvas path [--install|--uninstall]', summary: 'Show or change whether this CLI is on your PATH', run: cmdPath },
  open: { usage: 'canvas open <file>', summary: 'Open a document in the running app', run: cmdOpen },
  save: appOnlyCommand('save', 'canvas save', 'Save the document the app has open'),
  new: appOnlyCommand('new', 'canvas new', 'Start a new document in the app'),
  undo: appOnlyCommand('undo', 'canvas undo', 'Undo the last change in the app'),
  redo: appOnlyCommand('redo', 'canvas redo', 'Redo the last undone change in the app'),
  export: { usage: 'canvas export [out.json] [file]', summary: 'Write the document as portable JSON', run: cmdExport },
  import: { usage: 'canvas import <portable.json> [file]', summary: 'Replace a document from portable JSON', run: cmdImport },
  watch: { usage: 'canvas watch', summary: 'Stream change events from the running app', run: cmdWatch },
};

function helpText() {
  const rows = [
    ...Object.entries(DOCUMENT_COMMANDS),
    ...Object.entries(EXTRA_COMMANDS),
  ].map(([name, spec]) => [name, spec.summary]);
  const width = Math.max(...rows.map(([name]) => name.length));

  return `canvas — read and edit Canvas documents

Usage: canvas <command> [arguments] [options]

Commands:
${rows.map(([name, summary]) => `  ${name.padEnd(width)}  ${summary}`).join('\n')}

Options:
  -f, --file <path>   Document to act on (defaults to $CANVAS_FILE)
      --live          Require the running app; fail if it is not running
      --offline       Edit the file on disk even if the app is running
      --json <json>   Properties as JSON ("-" reads stdin)
      --set k=v       Set one property; repeatable, and wins over --json
  -t, --type <type>   Filter for list, or the type for add
      --kind <kind>   connect: arrow (default), connector or connection
      --label <text>  connect: label for the new link
  -p, --pretty        Indent the JSON output
  -q, --quiet         Suppress progress messages on stderr
  -h, --help          Show this help
  -v, --version       Show the version

By default a command talks to the running app when it has the document open,
and edits the file on disk otherwise, so the same command works either way.

Examples:
  canvas status
  canvas list plan.cvdoc --type shape
  canvas add shape --set type=circle --set position.x=120 --set position.y=40
  canvas update tb-3 --set title="Design review" --set style.backgroundColor=#1d3b53
  canvas connect shp-1 tb-3 --kind arrow --label "feeds"
  canvas read plan.cvdoc | jq '.entities.textBoxes[].title'
`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const { positional, options } = parsed;
  const command = positional.shift();

  if (options.version) {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    process.stdout.write(`${manifest.version}\n`);
    return EXIT.ok;
  }
  if (!command || options.help || command === 'help') {
    process.stdout.write(helpText());
    return command || options.help ? EXIT.ok : EXIT.usage;
  }

  const documentSpec = DOCUMENT_COMMANDS[command];
  const extraSpec = EXTRA_COMMANDS[command];
  if (!documentSpec && !extraSpec) {
    throw new UsageError(`Unknown command "${command}". Run "canvas help" to see the list.`);
  }

  const outcome = documentSpec
    ? await runDocumentCommand(command, documentSpec, parsed)
    : await extraSpec.run(parsed);

  if (outcome && outcome.result !== null && outcome.result !== undefined) {
    process.stdout.write(JSON.stringify(outcome.result, null, options.pretty ? 2 : 0) + '\n');
  }
  return EXIT.ok;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(EXIT.usage);
    }
    const code = err instanceof DocError && err.code === 'ENOENT'
      ? EXIT.notFound
      : err.exitCode || EXIT.failed;
    process.stderr.write(`${err.message}\n`);
    process.exit(code);
  });
