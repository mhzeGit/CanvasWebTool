# Canvas

A canvas whiteboard and diagramming tool — flowcharts, wireframes, mind maps.

The native desktop application uses **C# and Avalonia 11.2.7 / AXAML**, matching Graphmat's UI framework. The original Electron and web implementations remain available as references.

AI agents can inspect and edit documents entirely in the background through the **MCP server** or **CLI**. Both use the same backend and support closed files and the running native app, without mouse/keyboard automation, window activation or file-picker dialogs.

```powershell
npm install
npm run start:native                  # Avalonia desktop app (.NET 8 SDK required)
node bin/canvas.mjs schema             # Discover the complete agent API
node bin/canvas.mjs create plan.cvdoc   # Works with the application closed
node bin/canvas.mjs add textBox plan.cvdoc --set title="Design"
node bin/canvas.mjs inspect plan.cvdoc
node bin/canvas.mjs mcp-config          # Exact absolute-path MCP client configuration
```

Use Node 20 or newer. Configure an MCP client with the output of `mcp-config`; its command starts `bin/canvas-mcp.mjs` directly. Avoid `npm run mcp` in a stdio client configuration because npm can print script banners on stdout. Full setup, operation examples and concurrency/error semantics are in [the agent API guide](docs/AGENT_API.md).

The MCP server exposes nine tools, three resources and a task prompt. Agents can read/search the graph, edit every stored document field, manipulate rich text and image placement, and apply multi-step atomic edits with revision checks. Live batches join native undo history as one step. Closed-file edits preserve unknown fields and assets and use locked atomic writes. Native live access currently uses Windows named pipes; offline file editing and MCP are platform-independent.

The original implementation ships these ways:

- a **desktop app** for Windows, macOS and Linux;
- the original **web app**, served from any static file server;
- a **`canvas` command line tool** for scripts and AI agents, which works whether the app is open or closed.

## Running it

On Windows, install the native app and register `.cvdoc` double-click opening with `powershell -File tools/install-native.ps1`. The self-contained build installs under `%LOCALAPPDATA%\Programs\CanvasNative`. Existing Canvas windows receive double-clicked files and retain the usual unsaved-changes prompt. Registration alone does not confirm Explorer's default: the installer opens Windows Default Apps when a saved Canvas choice is missing. Choose **Canvas Native** for `.cvdoc` and **Set default**, or use **Open with → Choose another app → Always**. If Canvas is missing from the list, use **Choose an app on your PC** and select `%LOCALAPPDATA%\Programs\CanvasNative\Canvas.Native.exe`. Interactive launches repair missing registration; `Canvas.Native.exe --register-file-associations` updates it and reports the saved `userChoiceProgId` separately from the resolved executable. `Canvas.Native.exe --choose-default-app` reopens Windows Default Apps; installers can use `-NoDefaultAppPrompt` for unattended registration.

```sh
npm install          # also copies the browser modules into vendor/
npm start            # desktop app
npm run serve        # web app on http://localhost:5173
```

## Building the desktop app

```sh
npm run dist         # Windows installer + portable .exe, into release/
```

On Windows this needs nothing beyond Node. Cross-building Windows artifacts from
Linux additionally needs Wine (including 32-bit support, for the installer step).

`npm run dist` produces two things in `release/`:

| File | What it is |
| --- | --- |
| `Canvas-<version>-setup.exe` | Installer. Adds Start Menu and desktop shortcuts and associates `.cvdoc` files |
| `Canvas-<version>-portable.exe` | Single file, no install, runs from anywhere |

The app is self-contained: it loads nothing from the network at any point.

## The `canvas` CLI

Built for agents: JSON in, JSON out, meaningful exit codes, no interactive prompts.

After installing the desktop app, put the CLI on your PATH once:

```sh
canvas path --install       # or add <install dir>\resources\cli yourself
```

From a checkout you can also run it directly with `node bin/canvas.mjs`.

### It works whether the app is open or not

Every command picks its target automatically:

- **The app is open with that document** → the command goes to the running app. The
  change appears on screen straight away and can be undone with Ctrl+Z like any
  other edit.
- **Otherwise** → the file on disk is edited directly.

A document the app currently has open is never written behind its back, because
the app's next save would overwrite it. Use `--live` to require the running app,
or `--offline` to require a closed file. Offline access to the currently open file is rejected to prevent lost edits.

### Commands

```
canvas status                      Is the app running, and what does it have open?
canvas read   [file]               The whole document as portable JSON
canvas list   [file] [--type T]    A short summary of each entity
canvas get    <id> [file]          One entity in full

canvas add    <type> [--json {...}] [--set key=value ...]
canvas update <id>   [--json {...}] [--set key=value ...]
canvas delete <id>
canvas connect <from-id> <to-id> [--kind arrow|connector|connection] [--label text]

canvas export [out.json] [file]    Write the document as portable JSON
canvas import <in.json>  [file]    Replace a document from portable JSON

canvas open <file>                 Open a document in the running app
canvas save                        Save what the app has open
canvas new | undo | redo           Act on the running app
canvas watch                       Stream change events as they happen
canvas path [--install|--uninstall]

canvas schema                      Complete agent schema and workflow guide
canvas create <file>               Create a closed document
canvas inspect [file]              Counts, graph, bounds and revision
canvas query [file] --text "word"   Paginated entity search
canvas apply [file] --input batch.json --revision <revision>   (add/update/delete/connect/layout/fit/document/patch)
canvas render <out.png> [file] [--canvas tb-3/tb-2]   Draw a document or nested canvas to a PNG in a private invisible session
canvas patch [file] --input patch.json --revision <revision>
canvas mcp                        Run the MCP stdio server
canvas mcp-config                 Generate client configuration
```

### Sub-canvases

A text box can hold a whole canvas inside it (the card shows its title and description; open it to see the contents). The agent API treats nested canvases as ordinary documents: add `--canvas tb-3` (or `tb-3/tb-2` for a canvas inside a canvas) to `read`, `list`, `get`, `query`, `add`, `update`, `delete`, `connect` and `apply`. Ids are scoped per canvas. Make a card with `canvas add textBox --set subCanvas=true --set title=Stage`, and search every nested canvas at once with `canvas query --text word --deep`. Reads of a parent omit nested contents (just an object count) unless `--nested` is given. `apply` also offers `layout` (arrange boxes in flow order from their arrows) and `fit` (size text boxes to their content); see [the agent API guide](docs/AGENT_API.md#sub-canvases).

### Addressing entities

Entities have stable, type-prefixed ids, and `canvas read` output can be fed
straight back into `canvas update` without translation:

| Prefix | Entity |
| --- | --- |
| `tb-3` | Text box |
| `shp-7` | Shape — `rectangle`, `circle`, `triangle`, `diamond` |
| `arr-2` | Arrow |
| `cnr-4` | Connector line |
| `cnn-1` | Bezier connection between two text boxes |

### Examples

```sh
# What is going on
canvas status
canvas list plan.cvdoc --type shape --pretty

# Build something
canvas add textBox --set title="Ingest" --set position.x=80 --set position.y=80
canvas add shape --set type=circle --set position.x=520 --set style.backgroundColor=#1d3b53
canvas connect tb-1 shp-1 --kind arrow --label "feeds"

# Edit an existing document without opening the app
canvas update tb-3 --set title="Design review" --set size.w=320 -f plan.cvdoc

# Pipe things around
canvas read plan.cvdoc | jq '.entities.textBoxes[].title'
canvas add shape --json - <<< '{"type":"diamond","position":{"x":0,"y":0}}'

# React to edits as they happen
canvas watch | while read -r event; do echo "changed: $event"; done
```

### Fields you can set

`--set` takes portable field paths; `--json` takes the same shape nested. `--set`
wins where both name the same field. Values that look like numbers, `true`,
`false` or `null` are converted; everything else stays a string.

| Entity | Writable fields |
| --- | --- |
| textBox | `title`, `content`, `position.x/y`, `size.w/h`, `style.backgroundColor`, `style.borderColor`, `style.textColor`, `style.titleColor`, `style.fontSize`, `locked` |
| shape | `type`, `position.x/y`, `size.w/h`, `style.backgroundColor`, `style.borderColor`, `style.borderWidth`, `style.cornerRadius`, `locked` |
| arrow | `startPoint.x/y`, `endPoint.x/y`, `style.color`, `style.lineWidth`, `style.headSize`, `locked` |
| connector | `startPoint.x/y`, `endPoint.x/y`, `style.color`, `locked` |
| connection | `label`, `style.color`, `locked` |

Ids are stable and derived. The background API additionally edits parent/endpoint references, rich-text JSON, legacy blocks and full image placement. `canvas patch` can edit any stored field in the raw envelope, with validation of document integrity. See `canvas schema` and the [agent API guide](docs/AGENT_API.md).

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | The command failed |
| 2 | Bad usage |
| 3 | The app had to be running and was not |
| 4 | No such entity |

## Files

Documents are `.cvdoc` files — JSON, so they diff and merge reasonably. Images
are stored next to the document in a `<name>_assets/` folder rather than inlined,
which keeps the document itself small and readable.

`canvas export` writes the portable JSON format instead: the same thing `canvas
read` prints, with ids rather than array indices, which is the better choice for
anything that has to read or generate documents.

## Development

```sh
npm test             # unit tests
npm run test:native  # native model regressions
npm run test:agents:live # isolated invisible native session: real CLI/MCP and pipe tests
npm run smoke        # boots the real window, drives it, screenshots the result
npm run bench        # idle CPU with a large document loaded
```

`npm run vendor` re-copies the browser modules out of `node_modules` into
`vendor/` and rewrites the import map. It runs automatically after `npm install`.
It also walks the module graph to prove every specifier resolves locally, so a
missing import map entry fails the build rather than the app.
