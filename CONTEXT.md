# CanvasWebTool — Universal AI Context

## Project Overview

- `native/Canvas/` is the true native C# / Avalonia 11.2.7 port (the same UI framework and AXAML language as Graphmat), independent of Electron and browser engines. `Canvas.csproj` pins Avalonia packages and the .NET 8 target; `Program.cs` initializes the platform and application; `App.axaml` defines compact native control styles; `MainWindow.axaml` recreates the 40px menu bar, 44px tool rail, canvas/editor layers and resizable property panel; `Document.cs` owns lossless legacy JSON, assets, validation, undo/redo, selection, hierarchy and entity CRUD. Native build products and verification captures are ignored through `.gitignore`.

- Canvas whiteboard/diagramming tool (flowcharts, wireframes, mind maps). Similar to Excalidraw / draw.io but self-contained.
- Ships in three forms from **one** copy of the interface code: a **desktop app** (Electron), the original **web app**, and a **`canvas` CLI** for agents.
- Entirely client-side SPA — no build step, no server rendering, no framework. ES module imports via an import map pointing at `vendor/` (Tiptap/ProseMirror copied out of node_modules by `npm run vendor`; nothing is fetched from a CDN at runtime).
- The desktop build serves the same `index.html` over a custom `app://` scheme; the web build needs a static HTTP server (ES modules fail on `file://`). Use `python serve.py --port 5173`. The Python server also fixes the Windows `.js` → `text/plain` MIME issue.

- `release/` contains generated Electron installers, portable executables and unpacked runtime files. These remain local build outputs excluded by `.gitignore`; regenerate them with the existing build scripts rather than committing them to Git.

## Running and building

`tools/file-association-smoke.mjs` checks native file activation in an isolated invisible session: quoted paths with spaces, uppercase `.CVDOC`, opening a second document through a second launch, and reuse of the original process; it closes only its own test instance.

`native/Canvas/FileAssociations.cs` registers `.cvdoc`, its icon, quoted native open command, Open With entry and Default Apps capabilities under the current user's Windows registry, preserves protected Windows UserChoice preferences and synchronously notifies Explorer; normal interactive starts repair missing registration, `--register-file-associations` updates it and reports the saved UserChoice separately, and `--choose-default-app` opens Windows Default Apps. `native/Canvas/ShellActivation.cs` forwards file/double-click launches to an existing native session, where `shell.open` restores the window and handles unsaved edits without creating a competing instance. `tools/install-native.ps1` publishes a self-contained Windows build to the stable per-user `%LOCALAPPDATA%/Programs/CanvasNative` folder, registers it for `.cvdoc` and opens Default Apps when the saved Canvas choice is missing (`-NoDefaultAppPrompt` skips that UI for unattended installs); no administrator access is needed.

`.mcp.json` is the project-scoped MCP registration generated from the local Node executable and absolute `bin/canvas-mcp.mjs` path; regenerate with `canvas mcp-config` if the checkout or Node installation moves. Offline writes use the pinned `proper-lockfile` runtime dependency for cross-process locks with heartbeat and 30-second abandoned-lock recovery.

`docs/AGENT_API.md` is the agent integration reference: MCP client setup generated from real executable paths, tool/resource/prompt inventory, CLI compatibility, stable ids and atomic batches, full JSON Patch access, rich-text/image behavior, native history/persistence, conflict/error recovery, platform limits and reproducible verification commands. `README.md` now points to it and distinguishes native agent access from the original Electron/web reference implementation.

`bin/canvas.cmd` and `bin/canvas-mcp.cmd` are checkout/native Windows launchers using the installed Node runtime; `lib/path-setup.mjs` now points checkout PATH installation at these launchers while preserving packaged Electron launcher detection.

`tools/agent-live-smoke.mjs` starts an isolated invisible native session with its own state directory/pipe, verifies the actual live CLI and MCP transports, atomic history/revisions, dialog-free errors, open-file protection, raw field preservation and external-save conflict handling, then closes only its own test process and removes its temporary data.

`test/agent-service.test.mjs` verifies lossless offline edits, alias/graph batches, rollback/dry-run, stale revisions, concurrent writers, image/rich-text preservation, JSON Patch and invalid references/values. `test/agent-mcp.test.mjs` uses the official MCP client over real stdio to test negotiation, tool/resource/prompt discovery, calls and error recovery; `test/agent-cli.test.mjs` spawns the CLI to check stdin/JSON files, paths with spaces, revisions and structured errors. Native `--background` starts an invisible session for agent verification without window activation.

`bin/canvas-mcp.mjs` is the official MCP SDK stdio server with nine typed tools for discovery/status, lossless reads, search, atomic editing, create/import/export and native session control, plus guide/schema/current-document resources and an editing prompt. It shares `AgentService` with the CLI, reserves stdout exclusively for MCP and returns structured tool errors. `package.json` pins the MCP SDK/Zod runtime dependencies, adds the `canvas-mcp` executable and native/agent test commands.

`lib/agent-schema.mjs` publishes field/type discovery and the agent workflow guide (world geometry, references, operations, revisions, errors, rich text and images). `bin/canvas.mjs` now uses the shared background service: adds schema/inspect/query/create/atomic apply/JSON Patch/MCP/config commands, retains CRUD/session commands, reports revisions and structured errors, and never opens UI dialogs.

`native/Canvas/AgentProtocol.cs` implements background agent protocol v1: raw lossless reads, atomic revision-checked document replacement, explicit-path save/open/new and undo/redo. It returns structured busy/unsaved/conflict errors without focusing windows, closing user edits or displaying dialogs; `ControlServer.cs` advertises the protocol and isolates named pipes when a test state directory is supplied.

`lib/agent-service.mjs` is the transport-independent background API used by CLI/MCP: automatically routes open documents to native compare-and-swap RPC and closed files to locked atomic writes, blocks offline edits to open files, preserves assets through content-addressed non-destructive storage, returns revisions/dry runs and exposes read/query/apply/create/import/export and dialog-free session commands.

`lib/diagram-layout.mjs` holds the pure diagram helpers behind the agent `layout` and `fit` operations: a layered flow layout (longest-path layering with cycle breaking, barycentre ordering, columns for `right` or rows for `down`, arrow ends re-attached to box edges) and a text-height estimator that mirrors the native/web Markdown renderer (title bar, padding, bullet/quote prefixes, greedy word wrap) so boxes are sized to fit their content. `lib/render.mjs` powers `canvas render`: it starts a private invisible native session (isolated state dir, never the user's running app), opens a document, enters an optional sub-canvas path, fits the view and writes a PNG, so agents can check what they built. `test/agent-nested.test.mjs` covers sub-canvas creation, scoped operations and aliases, nested reads/deep queries, disk round trips, layout, fit and the CLI `--canvas` option.

`lib/agent-document.mjs` is the lossless agent document boundary (it also makes sub-canvases first-class: every operation takes an optional `canvas` path such as `tb-3/tb-2` or `$alias`, opens that nested canvas as an ordinary id-scoped portable document, applies the operation and writes it back; `subCanvas:true/false` creates or removes a nested canvas; summaries list nested canvases and queries can search them with `deep`): preserves envelope metadata, settings, unknown fields, full image placement and rich text; validates ids, numeric fields, references and parent cycles; supplies atomic domain operations with aliases, JSON Patch, search/pagination and graph summaries shared by the CLI and MCP server.

`tools/native-smoke.mjs` exercises the running Avalonia build through the existing CLI client, preserves any pre-test document, checks live CRUD/undo/redo/links, validation and image/file round trips, and captures native empty/fixture/property screenshots beside the web references in `artifacts/`.

`native/Canvas.Tests/Canvas.Tests.csproj` and `Program.cs` provide a dependency-light executable regression suite covering native transactions/history, legacy and portable round trips, references, deletion/duplication, locked objects/hierarchy, polygon/ellipse geometry, rich text preservation, image assets/Save As and invalid-input rejection. `tools/native-reference.mjs` captures the original Electron-rendered UI in empty, fixture and selected-property states and writes a shared deterministic `.cvdoc` into ignored `artifacts/` for native comparison.

`native/Canvas/ControlServer.cs` exposes the existing local NDJSON named-pipe CLI protocol from Avalonia, dispatches document changes on the UI thread, publishes the per-user endpoint, streams watch notifications and adds screenshot/tool commands for native verification; it refuses to replace an endpoint owned by another live Canvas process.

`native/Canvas/MainWindow.axaml.cs` wires native menus, tool icons, property editors with drag numbers and batch styles, Markdown formatting/inline edits, clipboard, context actions, dialogs, images and drops, file open/save/import/export, external-change protection, auto-save and crash recovery. `native/Canvas/NativeSettings.cs` stores native theme/grid/palette, snapping, auto-save and window/panel dimensions in the per-user Canvas state directory; test mode isolates settings and disables recovery writes.

`native/Canvas/RichText.cs` converts legacy block/Tiptap content to Markdown and uses native Avalonia text layouts for marked text, headings, lists, checkboxes, colors and links. `native/Canvas/CanvasView.cs` is the native canvas renderer and pointer controller: multilevel grid, image clipping/cache, entities, links, selection/handles, drag creation/movement/resizing, endpoint attachments, marquee, pan, anchored zoom, snapping, touch pinch and focus-to-fit; no browser view is involved.

`native/Canvas/Portable.cs` translates the existing CLI portable JSON schema and stable ids to indexed legacy documents, validates writable fields, and preserves native extension data; `native/Canvas/Geometry.cs` provides native shape paths, polygon hit tests, shape-edge attachments, Bézier curves, line distances and resize-handle coordinates shared by rendering, input and verification.

| Command | What it does |
| --- | --- |
| `npm install` | Installs deps and runs `npm run vendor` automatically |
| `npm run vendor` | Copies browser ES modules from node_modules into `vendor/`, rewrites the import map, prunes anything unreachable |
| `npm start` | Runs the desktop app (Electron) |
| `npm run serve` | Serves the web app on :5173 |
| `npm run dist` | Builds the Windows installer + portable .exe into `release/` |
| `build-and-run.bat` | Click-to-run: clean `release/`, rebuild, then launch the built portable .exe |
| `npm test` | Node test runner over `test/**/*.test.mjs` |
| `npm run smoke` | Boots the real window, drives it via agent commands, captures a PNG |
| `npm run bench` | Measures idle CPU with a large document loaded |

Building Windows artifacts on Linux additionally needs Wine (32-bit, for the NSIS step); on Windows it needs nothing extra.

## File & Folder Structure

```
/
├── index.html              Entry point. Top bar menus, toolbar, canvas layers, side panel, CSP, import map pointing at vendor/
├── css/style.css           Complete dark/light theme (CSS custom properties). Canvas, panel, context menu, inline editors, markdown, responsive mobile (<=768px)
├── serve.py                Python static file server with correct JS MIME types. Run: python serve.py --port 5173
├── build-and-run.bat       Windows one-click build: deletes release/, re-runs npm run vendor, runs npm run dist, then launches the freshly built portable .exe (falls back to release/win-unpacked/Canvas.exe)
├── package.json            Scripts, electron-builder deps, and the pinned browser modules that `npm run vendor` copies into vendor/
├── electron-builder.yml    Packaging config: which files go in the asar, Windows nsis + portable targets, file associations
├── vendor/                 **Generated, gitignored** — Tiptap/ProseMirror ES modules copied out of node_modules so the app needs no network
├── electron/               Desktop shell (see below)
├── lib/                    Node-side document code shared by the shell and the CLI (see below)
├── shared/                 Tiny modules used by both the shell and the CLI (see below)
├── bin/canvas.mjs          The `canvas` CLI (see below)
├── README.md               User-facing docs: running, building, and the full CLI reference
├── test/                   node:test suites for the format, the document operations and the on-disk layer
├── tools/                  Build and verification scripts (see below)
├── js/
│   ├── main.js             App entry. Resizes canvas (DPR-aware), owns drawFrame(), wires top bar / mobile UI / auto-save / external change detection
│   ├── render-scheduler.js **Decides which frames need drawing.** Input events, viewport easing and explicit requestRender() calls mark the loop dirty; idle frames are skipped entirely. Includes a slow heartbeat so a missed invalidation self-corrects
│   ├── native.js           Exposes `window.canvasNative` (injected by the Electron preload) as `native` / `isDesktop`; null in a browser
│   ├── desktop.js          Desktop-only wiring: reports document state to the shell, handles open-file requests, registers the agent command handler, keeps the window background in step with the theme
│   ├── agent-api.js        **Command surface the CLI drives when the app is open.** Addresses entities by portable id, validates against the shared field schema, and routes every change through the normal undo history
│   ├── portable-format.js  **Pure, dependency-free definition of the portable format** — id scheme, defaults, writable-field schema, and toPortable/fromPortable. Imported by the renderer *and* by the Node CLI, so both agree by construction
│   ├── state.js            **Central state singleton** — all mutable data lives here: viewport, entity arrays, selection sets, drag/resize/touch state
│   ├── config.js           Constants: grid params, arrow sizes, drag thresholds, min entity sizes, colors, history cap, touch/touchpad zoom factors
│   ├── utils.js            Math/geometry helpers: screen↔world, color manipulation, rounded rect drawing, text wrapping, edge/resize bounds, Bezier evaluators
│   ├── document.js         Document CRUD: add/delete/duplicate/copy/paste every entity type, serialization round-trip, file new/save/open/reload
│   ├── format.js           File format: header identifier (.cvdoc), serialize/deserialize, image asset extraction/embedding (data URI ↔ external file)
│   ├── file-io.js          File I/O behind one interface with two backends: **native** (real paths, assets in a sibling `<name>_assets/` folder) and **web** (File System Access API, Web Share, download fallback, OPFS assets). Picks the backend from `isDesktop`
│   ├── image-lod.js        Image LOD manager: generates per-image downscaled data URIs (5 levels: original/800/320/120/48px max), tracks state by stable shape.id (not array index), queries DOM via data-entity-id, updates `<img>.src` each frame, culls off-screen images to lowest LOD, per-generation canvas for thread-safe downscaling
│   ├── json-port.js        Portable JSON export/import wired to live state: reads/writes through `portable-format.js`, handles the file picker and the download, and owns clearing the document on import
│   ├── history.js           Thin integration layer: creates shared history manager, wraps undo/redo with draw-order reparenting, flush/start panel edits
│   ├── undo.js             **Command-pattern undo/redo** — createHistoryManager() factory, command factory functions for every operation, batch command wrapper
│   ├── grid.js             Multi-level canvas grid rendering with smooth opacity transitions
│   ├── pointer.js          **Largest module (1663 lines)** — all pointer/mouse interactions: tool dispatch, drag-to-create, drag-to-move, resize handles, arrow endpoint dragging, selection box, cursor management, image drop
│   ├── keyboard.js         Keyboard shortcuts: Ctrl+Z/Y undo/redo, Delete/Backspace delete, arrows nudge, Ctrl+C/V/D copy/paste/duplicate, F focus, Ctrl+S save, markdown shortcuts in inputs
│   ├── touch.js            Touch gestures: single-finger pan, two-finger pinch zoom (dampened), long-press context menu, double-tap
│   ├── zoom-pan.js         Mouse wheel zoom (Ctrl+wheel) and pan (wheel without Ctrl), touchpad factor, accumulation via animation frame
│   ├── focus.js            Camera auto-focus: computes bounding box of selected/all entities, pans and zooms to fit with padding
│   ├── context-menu.js     Right-click context menu: hit detection, Add submenu, delete/duplicate/copy/paste, "Connect to...", extensible registration
│   ├── dialog.js           Modal dialogs: showAlertDialog, showConfirmDialog with keyboard nav (Tab, Enter, Escape)
│   ├── toolbar.js          Left toolbar: SVG icon buttons for each tool (cursor, arrow, connection, text, image, shapes submenu), active state, mobile panel toggle
│   ├── toolManager.js      Tool state constants and active tool tracking with subtype + change callback
│   ├── side-panel.js       **Property editor panel (1471 lines)** — dynamic editors per selection type (shapes, textboxes, arrows, connectors, connections, mixed). Batch edits, Tiptap rich text in panel, drag-number inputs, property clipboard
│   ├── panel-resize.js     Side panel drag-to-resize (220-700px), persisted in localStorage, hidden on mobile
│   ├── color-palette.js    Color picker popover: HSV wheel + sliders, built-in + custom palette, viewport-bounded positioning
│   ├── settings.js         localStorage settings: dark/light theme, background/gridline colors, custom color palette, CSS custom property application
│   ├── settings-dialog.js  Settings UI: theme toggle, color pickers, palette management, reset all
│   ├── dom-entities.js     DOM-based entity layer management: creates/manages actual HTML elements for shapes and textboxes, draw order via ParentTree, selection highlighting, Tiptap editor integration, garbage collection
│   ├── inline-editing.js   Double-click inline editing: title (contentEditable), body (Tiptap), connection text, commit/cancel with history
│   ├── parent-tree.js      **ParentTree class** — spatial parent-child hierarchy for entities. Determines draw order (depth), supports cycle detection, dirty marking, batch recomputation, getDescendants
│   ├── snap.js             Grid snapping: snap value/increment based on visible grid level, resize bounds snapping with min constraints
│   ├── nodes.js             Legacy node/textbox hit-testing + preview drawing (dashed outlines), selection marquee DOM div
│   ├── shapes.js            Shape rendering/hit-testing: drawShapePath (rect/circle/triangle/diamond), hitTestShape, getShapeEdgeAt, isShapeInBox, drawShapePreview
│   ├── textboxes.js         Textbox hit-testing: hitTestTextBox, getTextBoxEdgeAt, drawTextBoxPreview
│   ├── arrows.js            Arrow rendering and hit-testing: endpoint updates from connected objects, drawArrows with filled arrowhead, endpoint handles, hitTestArrowEnd/Body
│   ├── connectors.js        Straight line connectors: endpoint updates, drawConnectors, hitTestConnector, drawConnectorPreview
│   ├── connections.js       Bezier connection lines between textboxes: hitTestConnection with Bezier sampling, drawConnection with text pill label, drawConnectionPreview
│   ├── markdown.js          Markdown parser: named colors (`{red:text}`), inline spans (**bold**, *italic*, `code`, ~~strike~~), block syntax (headings, quotes, checkboxes, lists, HR)
│   ├── rich-text.js         Legacy rich text HTML rendering from block format (blocksToHtml)
│   └── editor/
│       ├── editor-core.js           Tiptap Editor factory: creates Editor instance with StarterKit + TextStyle + Color + FontSize extensions
│       ├── editor-canvas-renderer.js Canvas rendering of Tiptap JSON content: tokenizes into display lines, renders paragraphs/headings/lists/quotes/HR with marks
│       ├── editor-serialization.js   Bidirectional format conversion: Tiptap JSON ↔ legacy blocks, Tiptap JSON ↔ Markdown, named color resolution
│       ├── editor-toolbar.js        Rich text toolbar: action functions, HTML builder, click handler wiring with active state
│       └── editor-content-bridge.js  Storage format conversion: lazy migration from legacy blocks/text to Tiptap JSON, content sync helpers
│   └── package.json        Marks js/ as ES modules for Node (browsers ignore it). Without it the CLI could not import format.js / portable-format.js
├── electron/
│   ├── main.mjs            Main process: single-instance lock, window + remembered geometry, IPC handlers for the file bridge, agent request/response bridge, control-server lifecycle
│   ├── preload.js          The only page↔OS channel. Sandboxed, context-isolated, no Node in the page. Exposes `window.canvasNative` and queues open-file messages that arrive before the page is ready
│   ├── protocol.mjs        Registers and serves the privileged `app://` scheme (ES modules and import maps do not work on `file://`), with directory-traversal checks
│   ├── control-server.mjs  NDJSON socket the CLI connects to (named pipe on Windows, unix socket elsewhere). Dispatches to main or forwards to the renderer; supports `watch` subscriptions
│   └── resources/          Packaging assets: `icon.png`, and `cli/canvas{,.cmd}` launchers that run the CLI through the app's own bundled Node
├── lib/
│   ├── document-store.mjs  The only place that knows the on-disk layout: reads/writes `.cvdoc` files and their `<name>_assets/` folders, validating every path. Used by the shell and the CLI
│   ├── cvdoc.mjs           Converts between `.cvdoc` files and portable JSON, reusing js/format.js and js/portable-format.js
│   ├── doc-ops.mjs         list/get/add/update/delete/connect applied directly to portable JSON — the CLI's offline mode. Shares the field schema with agent-api.js
│   ├── diagram-layout.mjs  Flow layout and text-fit helpers for the agent `layout`/`fit` operations
│   ├── render.mjs          `canvas render`: private invisible native session that draws a document or nested canvas to PNG
│   ├── client.mjs          CLI-side client for the control socket: request/response by id, plus event streaming for `watch`
│   └── path-setup.mjs      `canvas path --install`: adds the launcher directory to the user's PATH (registry on Windows, printed instructions elsewhere)
├── shared/
│   ├── endpoint.mjs        Where the running app advertises its socket, and how the CLI decides whether an app is actually alive (stale-file detection via pid)
│   └── wire.mjs            NDJSON framing for the control socket
├── tools/
│   ├── vendor-deps.mjs     Copies browser modules out of node_modules, rewrites the import map, walks the module graph to prove every specifier resolves, prunes unreachable files
│   ├── screenshot.mjs      Captures the desktop window to a PNG
│   ├── smoke.mjs           End-to-end check: boots the window, runs agent commands, verifies undo, captures a PNG
│   └── bench-idle.mjs      Measures renderer CPU while idle with a large document
├── devtools/
│   └── style-palette.html  Standalone color/style playground (not part of the app)
└── .kilo/                   Kilo agent-manager configuration — ignore during development
```

### Files to ignore / never read
- `.kilo/` — Kilo agent-manager config, worktrees, agent state
- `vendor/` — generated by `npm run vendor`; edit package.json and the import map instead
- `release/` — electron-builder output
- `node_modules/` — npm dependencies
- `devtools/style-palette.html` — standalone dev tool, not part of app
- `package-lock.json` — auto-generated
- `.git/` — version control

## Architecture & Patterns

### Codebase organization
- **Flat JS module structure** — 25+ modules in `js/`, 5 in `js/editor/`. All modules import from each other directly (no barrel files). `main.js` is the single entry point that wires everything together.
- **No framework** — vanilla JS, DOM APIs, Canvas 2D. ES modules with import maps for external deps.
- **Rendering layers** (stacked in DOM order):
  1. `gridCanvas` — background grid (Canvas 2D)
  2. `arrowCanvas` — arrows, connectors, connections, selection marquee (Canvas 2D, rendered on top of grid)
  3. `entityLayer` — actual DOM elements for shapes and textboxes (positioned absolutely, scaled by viewport transform)
- **Animation loop** — `render-scheduler.js` owns the `requestAnimationFrame` loop and calls `main.js`'s `drawFrame()` only on frames that need it. One frame does: clear and redraw grid → arrows → connectors → sync DOM entities → image LOD → marquee → previews → refresh side panel if the selection changed.
- **A frame is drawn when** any input event fires, the viewport is still easing toward its target, something calls `requestRender()` (async loads, document replacement, agent commands), or the slow idle heartbeat comes round. An idle window costs essentially nothing; the picture is unchanged.
- **After changing anything that affects the canvas from outside an input handler, call `requestRender()`** — a change with no frame behind it will not appear until the next input or heartbeat.

### Three builds, one interface
- `index.html`, `css/style.css` and everything in `js/` are shared verbatim. The desktop build adds no interface code of its own.
- Desktop-only behaviour is reached through `native.js` (`isDesktop` / `native`), which is null in a browser, so every desktop branch is inert on the web.
- Anything the CLI and the app must agree on — the portable format, the writable-field schema, the on-disk layout — lives in exactly one module that both import (`js/portable-format.js`, `js/format.js`, `lib/document-store.mjs`).

### State management
- **Single mutable state object** in `state.js` — all entity arrays, selection sets, drag state, viewport, tool state. Modules import `state` and read/write directly. No immutability, no observable/reactive system.
- **Selection key mechanism** — `computeSelectionKey()` returns a deterministic string representing current selection. Side panel only re-renders when this key changes (compared each animation frame).
- **Parent-child hierarchy** via `ParentTree` class — spatial containment determines draw order depth. Rebuilt on entity add/delete, repaired lazily with dirty marking.

### Undo/redo
- **Command pattern** — `undo.js` exports `createHistoryManager()` factory and per-operation command factories (`createAddShapeCmd`, `createResizeShapeCmd`, `createPropertyChangeCmd`, etc.). Each command is `{ undo(){}, redo(){} }`. History cap = 200 entries.
- **Batch commands** — `createBatchCmd` wraps multiple commands as a single undo/redo step.
- **Panel edits** — property changes in side panel use snapshot-based batching: snapshot before editing starts, commit diff on blur/enter.

### Entity types and data model
Each entity is a plain object in a flat array on `state`:
- **textBox** — `{id, x, y, w, h, title, titleColor, text, blocks, color, borderColor, textColor, fontSize, parentId, parentType, locked}`
- **shape** — `{id, shapeType, x, y, w, h, color, borderColor, borderWidth, cornerRadius, image, parentId, parentType, locked}`. shapeType: `rectangle | circle | triangle | diamond`
- **arrow** — `{id, x1, y1, x2, y2, connectedFrom, connectedTo, connectedFromType, connectedToType, color, lineWidth, headSize, locked}`
- **connector** — `{id, x1, y1, x2, y2, connectedFrom, connectedTo, connectedFromType, connectedToType, color, locked}`
- **connection** — `{id, from, to, color, text, locked}` (index-based references into textBoxes array)

### Portable ids
Agents address entities by a stable, type-prefixed id: `tb-<n>` text box, `shp-<n>` shape, `arr-<n>` arrow, `cnr-<n>` connector, `cnn-<n>` connection. Internally the entity arrays still cross-reference each other **by array index**, and `portable-format.js` is what converts between the two. Never persist an index outside the live state.

### The CLI's two modes
`canvas <command>` picks its target automatically:
- the **running app**, when it has the requested document open — the change appears on screen immediately and joins the undo stack;
- the **file on disk** otherwise.

A file the app currently holds is never edited behind its back, because the app's next save would overwrite it. `--live` and `--offline` force the choice.

### Key shared utilities
- `state.js` — exported singleton `state`, `markDrawOrderDirty()`, `reparentAll()`, `getTopHitAt()` (z-ordered entity hit test), `getAllDrawOrder()` (sorted by depth, cached), `computeSelectionKey()`, `escAttr()`, plus `onDocumentStatusChange()`. `isDirty`, `currentFileName` and `currentFilePath` are accessors that notify listeners when they change, so auto-save and the desktop window title never need to be told explicitly
- `render-scheduler.js` — `requestRender(frames)`, `requestRenderWhile(predicate)`, `startRenderLoop(state, drawFrame)`
- `utils.js` — `screenToWorld`/`worldToScreen`, color brightness utilities, `drawRoundedRect`, text drawing (wrapped, ellipsis), `getRectEdgePoint`, `computeResizeBounds`, `getPointOnBezier`
- `config.js` — all magic numbers in one place: grid params, thresholds, defaults, limits
- `document.js` — gateways for all entity CRUD, always goes through `flushPanelEdit()` then pushes undo command

### Naming conventions
- **Variables/functions**: camelCase (`addShapeAt`, `computeSelectionKey`)
- **Classes**: PascalCase (`ParentTree`, `Editor`)
- **Constants/Config**: UPPER_SNAKE_CASE (`GRID`, `DRAG_THRESHOLD_PX`), exported as named from `config.js`
- **Entity properties**: snake_case for persistence (`connectedFrom`, `connectedToType`), camelCase for geometry (`x1`, `y1`, `shapeType`, `borderWidth`)
- **Selection sets**: `selected<EntityType>s` on state: `selectedShapes`, `selectedTextBoxes`, `selectedArrows`, `selectedConnectors`, `selectedConnection`
- **Undo commands**: `create<Action><Entity>Cmd` (`createAddShapeCmd`, `createDeleteTextBoxesCmd`, `createSetLockCmd`)
- **File names**: kebab-case (`inline-editing.js`, `context-menu.js`, `color-palette.js`, `editor-content-bridge.js`)
- **CSS**: hyphen-case class names (`side-panel`, `panel-resize-handle`, `context-menu`), BEM-style for nested elements

- `js/sub-canvases.js` owns nested canvas card creation, breadcrumb/keyboard navigation, isolated per-canvas undo stacks and viewport restoration; root-aware document capture keeps all nested content in saves and portable exports. Sub-canvases are text boxes with a `subCanvas` document body, shared with the native model and preserved recursively with image assets.

- `tools/subcanvas-smoke.mjs` runs an invisible Electron UI regression for portal creation, nested editing, viewport restoration, per-canvas undo, independent duplication, cross-canvas paste and save/portable round trips, capturing the rendered card in ignored `artifacts/subcanvas-web.png`. Run with `electron tools/subcanvas-smoke.mjs`.

- `tools/native-subcanvas-smoke.mjs` launches an isolated invisible native app, verifies sub-canvas creation and nested navigation through the live command bridge, confirms undo/redo navigation and save/reopen retention, and captures both card and inner-workspace views under ignored `artifacts/`; it closes only its own process.
