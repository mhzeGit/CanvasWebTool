# CanvasWebTool — Universal AI Context

## Project Overview

- Browser-based canvas whiteboard/diagramming tool (flowcharts, wireframes, mind maps). Similar to Excalidraw / draw.io but self-contained.
- Entirely client-side SPA — no build step, no server rendering. ES module imports via import map (CDN-loaded Tiptap/ProseMirror). Runs on any static HTTP server.
- Must be served over HTTP (ES modules fail on `file://` protocol). Use `python serve.py --port 5173` or `npx live-server . --port=5173`. Python server in `serve.py` fixes Windows `.js` → `text/plain` MIME issue.

## File & Folder Structure

```
/
├── index.html              Entry point. Top bar menus, toolbar, canvas layers, side panel, import map for CDN packages
├── css/style.css           Complete dark/light theme (CSS custom properties). Canvas, panel, context menu, inline editors, markdown, responsive mobile (<=768px)
├── serve.py                Python static file server with correct JS MIME types. Run: python serve.py --port 5173
├── package.json            npm deps (Tiptap ecosystem) — for IDE intellisense only; actual imports come from CDN via import map
├── js/
│   ├── main.js             App entry. Resizes canvas (DPR-aware), runs animation loop, wires top bar / mobile UI / auto-save / external change detection
│   ├── state.js            **Central state singleton** — all mutable data lives here: viewport, entity arrays, selection sets, drag/resize/touch state
│   ├── config.js           Constants: grid params, arrow sizes, drag thresholds, min entity sizes, colors, history cap, touch/touchpad zoom factors
│   ├── utils.js            Math/geometry helpers: screen↔world, color manipulation, rounded rect drawing, text wrapping, edge/resize bounds, Bezier evaluators
│   ├── document.js         Document CRUD: add/delete/duplicate/copy/paste every entity type, serialization round-trip, file new/save/open/reload
│   ├── format.js           File format: header identifier (.cvdoc), serialize/deserialize, image asset extraction/embedding (data URI ↔ external file)
│   ├── file-io.js          File I/O: File System Access API (showSaveFilePicker/showOpenFilePicker), Web Share fallback, download blob, OPFS asset storage
│   ├── image-lod.js        Image LOD manager: generates per-image downscaled data URIs (5 levels: original/800/320/120/48px max), tracks state by stable shape.id (not array index), queries DOM via data-entity-id, updates `<img>.src` each frame, culls off-screen images to lowest LOD, per-generation canvas for thread-safe downscaling
│   ├── json-port.js        Portable JSON export/import: human & AI-readable format with ID-based entity references, roundtrip for all entity types (textBoxes, shapes, arrows, connectors, connections) — independent of .cvdoc save system
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
├── devtools/
│   └── style-palette.html  Standalone color/style playground (not part of the app)
└── .kilo/                   Kilo agent-manager configuration — ignore during development
```

### Files to ignore / never read
- `.kilo/` — Kilo agent-manager config, worktrees, agent state
- `node_modules/` — npm dependencies (all CDN-imported anyway)
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
- **Animation loop** in `main.js` — `requestAnimationFrame(animate)`. Each frame: lerps viewport, clears and redraws grid → arrows → connectors → sync DOM entities → marquee → previews → refresh side panel if selection changed.

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

### Key shared utilities
- `state.js` — exported singleton `state`, `markDrawOrderDirty()`, `reparentAll()`, `getTopHitAt()` (z-ordered entity hit test), `getAllDrawOrder()` (sorted by depth), `computeSelectionKey()`, `escAttr()`
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
