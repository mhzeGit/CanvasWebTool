# CanvasWebTool — Universal AI Context

## Project Overview

- Canvas whiteboard/diagramming tool (flowcharts, wireframes, mind maps). Similar to Excalidraw / draw.io but self-contained.
- Ships in three forms from **one** copy of the interface code: a **desktop app** (Electron), the original **web app**, and a **`canvas` CLI** for agents.
- Entirely client-side SPA — no build step, no server rendering, no framework. ES module imports via an import map pointing at `vendor/` (Tiptap/ProseMirror copied out of node_modules by `npm run vendor`; nothing is fetched from a CDN at runtime).
- The desktop build serves the same `index.html` over a custom `app://` scheme; the web build needs a static HTTP server (ES modules fail on `file://`). Use `python serve.py --port 5173`. The Python server also fixes the Windows `.js` → `text/plain` MIME issue.

## Running and building

| Command | What it does |
| --- | --- |
| `npm install` | Installs deps and runs `npm run vendor` automatically |
| `npm run vendor` | Copies browser ES modules from node_modules into `vendor/`, rewrites the import map, prunes anything unreachable |
| `npm start` | Runs the desktop app (Electron) |
| `npm run serve` | Serves the web app on :5173 |
| `npm run dist` | Builds the Windows installer + portable .exe into `release/` |
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
