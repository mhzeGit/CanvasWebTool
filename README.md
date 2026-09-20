# Canvas

A canvas whiteboard and diagramming tool — flowcharts, wireframes, mind maps.

It ships three ways from one copy of the interface code:

- a **desktop app** for Windows, macOS and Linux;
- the original **web app**, served from any static file server;
- a **`canvas` command line tool** for scripts and AI agents, which works whether the app is open or closed.

## Running it

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
or `--offline` to insist on editing the file.

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
```

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

Ids, parent links and array indices are derived and cannot be set directly.

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
npm run smoke        # boots the real window, drives it, screenshots the result
npm run bench        # idle CPU with a large document loaded
```

`npm run vendor` re-copies the browser modules out of `node_modules` into
`vendor/` and rewrites the import map. It runs automatically after `npm install`.
It also walks the module graph to prove every specifier resolves locally, so a
missing import map entry fails the build rather than the app.
