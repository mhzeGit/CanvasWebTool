/**
 * Generic diagram helpers that work on one portable canvas (see agent-document.mjs):
 * a layered "flow" layout driven by the arrows/connections between boxes, and an
 * estimate of the height a text box needs for its title and Markdown content.
 *
 * Pure functions: they mutate the document passed in and return a small summary.
 */
import { parsePortableId } from "../js/portable-format.js";
import { DocError } from "./doc-ops.mjs";

const fail = (message) => {
  throw new DocError("EINVAL", message);
};
const finite = (v, fallback) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
const order = (e) => parsePortableId(e.id).numericId;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function boxesOf(doc, ids) {
  const all = [...doc.entities.textBoxes, ...doc.entities.shapes];
  if (!ids) return all;
  const wanted = new Set(ids);
  const found = all.filter((e) => wanted.has(e.id));
  const missing = ids.filter((id) => !found.some((e) => e.id === id));
  if (missing.length)
    fail(`layout: unknown text box or shape id(s): ${missing.join(", ")}`);
  return found;
}

function edgesOf(doc, nodeIds) {
  const edges = [];
  const seen = new Set();
  const add = (from, to) => {
    if (!from || !to || from === to) return;
    if (!nodeIds.has(from) || !nodeIds.has(to)) return;
    const key = from + ">" + to;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push([from, to]);
  };
  for (const line of [...doc.entities.arrows, ...doc.entities.connectors])
    add(line.connectedFrom?.entityId, line.connectedTo?.entityId);
  for (const link of doc.entities.connections) add(link.from, link.to);
  return edges;
}

/** Longest-path layering after dropping the back edges found by a DFS. */
function layerNodes(nodes, edges) {
  const out = new Map(nodes.map((n) => [n.id, []]));
  for (const [from, to] of edges) out.get(from).push(to);
  const state = new Map();
  const dag = [];
  const visit = (start) => {
    const stack = [[start, 0]];
    state.set(start, 1);
    while (stack.length) {
      const frame = stack.at(-1);
      const [id, i] = frame;
      const next = out.get(id)[i];
      if (next === undefined) {
        state.set(id, 2);
        stack.pop();
        continue;
      }
      frame[1]++;
      if (state.get(next) === 1) continue; // back edge: ignored for layering
      dag.push([id, next]);
      if (!state.get(next)) {
        state.set(next, 1);
        stack.push([next, 0]);
      }
    }
  };
  for (const n of nodes) if (!state.get(n.id)) visit(n.id);
  const preds = new Map(nodes.map((n) => [n.id, []]));
  const indegree = new Map(nodes.map((n) => [n.id, 0]));
  const succs = new Map(nodes.map((n) => [n.id, []]));
  for (const [from, to] of dag) {
    preds.get(to).push(from);
    succs.get(from).push(to);
    indegree.set(to, indegree.get(to) + 1);
  }
  const layer = new Map();
  const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  for (const id of queue) layer.set(id, 0);
  while (queue.length) {
    const id = queue.shift();
    for (const to of succs.get(id)) {
      layer.set(to, Math.max(layer.get(to) ?? 0, layer.get(id) + 1));
      indegree.set(to, indegree.get(to) - 1);
      if (indegree.get(to) === 0) queue.push(to);
    }
  }
  return { layer, preds, succs };
}

function rectEdge(box, toward) {
  const cx = box.position.x + box.size.w / 2;
  const cy = box.position.y + box.size.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (Math.abs(dx) + Math.abs(dy) < 0.001) return { x: cx, y: cy };
  const t = 1 / Math.max(Math.abs(dx) / (box.size.w / 2), Math.abs(dy) / (box.size.h / 2));
  return { x: cx + dx * t, y: cy + dy * t };
}

const centre = (box) => ({
  x: box.position.x + box.size.w / 2,
  y: box.position.y + box.size.h / 2,
});

function refreshLines(doc) {
  const byId = new Map(
    [...doc.entities.textBoxes, ...doc.entities.shapes].map((e) => [e.id, e]),
  );
  for (const line of [...doc.entities.arrows, ...doc.entities.connectors]) {
    const from = byId.get(line.connectedFrom?.entityId);
    const to = byId.get(line.connectedTo?.entityId);
    if (!from && !to) continue;
    const a = from ? centre(from) : line.startPoint;
    const b = to ? centre(to) : line.endPoint;
    if (from) line.startPoint = rectEdge(from, b);
    if (to) line.endPoint = rectEdge(to, a);
  }
}

/**
 * Arrange boxes in columns (direction "right") or rows ("down") by flow order.
 * Options: ids (default every text box and shape), direction, gap {x, y},
 * origin {x, y} (default: the current top-left of the arranged boxes),
 * align "center" | "start" for the cross axis.
 */
export function layoutFlow(doc, options = {}) {
  const { ids, direction = "right", align = "center" } = options;
  if (!["right", "down"].includes(direction))
    fail('layout direction must be "right" or "down"');
  if (!["center", "start"].includes(align))
    fail('layout align must be "center" or "start"');
  const horizontal = direction === "right";
  const gapX = finite(options.gap?.x, horizontal ? 120 : 60);
  const gapY = finite(options.gap?.y, horizontal ? 50 : 90);
  const nodes = boxesOf(doc, ids).sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id));
  if (!nodes.length) return { nodes: 0, layers: 0 };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = edgesOf(doc, new Set(byId.keys()));
  const { layer, preds, succs } = layerNodes(nodes, edges);
  const layerCount = Math.max(...layer.values()) + 1;
  const columns = Array.from({ length: layerCount }, () => []);
  for (const n of nodes) columns[layer.get(n.id)].push(n.id);

  const positionOf = (col) => new Map(col.map((id, i) => [id, i]));
  const bary = (id, neighbours, index) => {
    const known = neighbours.map((n) => index.get(n)).filter((v) => v !== undefined);
    return known.length ? known.reduce((s, v) => s + v, 0) / known.length : undefined;
  };
  for (let sweep = 0; sweep < 4; sweep++) {
    for (let l = 1; l < layerCount; l++) {
      const index = positionOf(columns[l - 1]);
      const current = positionOf(columns[l]);
      columns[l] = [...columns[l]].sort(
        (a, b) =>
          (bary(a, preds.get(a), index) ?? current.get(a)) -
            (bary(b, preds.get(b), index) ?? current.get(b)) ||
          current.get(a) - current.get(b),
      );
    }
    for (let l = layerCount - 2; l >= 0; l--) {
      const index = positionOf(columns[l + 1]);
      const current = positionOf(columns[l]);
      columns[l] = [...columns[l]].sort(
        (a, b) =>
          (bary(a, succs.get(a), index) ?? current.get(a)) -
            (bary(b, succs.get(b), index) ?? current.get(b)) ||
          current.get(a) - current.get(b),
      );
    }
  }

  const main = (n) => (horizontal ? n.size.w : n.size.h);
  const cross = (n) => (horizontal ? n.size.h : n.size.w);
  const mainGap = horizontal ? gapX : gapY;
  const crossGap = horizontal ? gapY : gapX;
  const origin = {
    x: finite(options.origin?.x, Math.min(...nodes.map((n) => n.position.x))),
    y: finite(options.origin?.y, Math.min(...nodes.map((n) => n.position.y))),
  };
  const extents = columns.map((col) =>
    col.reduce((sum, id, i) => sum + cross(byId.get(id)) + (i ? crossGap : 0), 0),
  );
  const widest = Math.max(...extents);
  let mainAt = 0;
  let moved = 0;
  columns.forEach((col, l) => {
    const mainSize = Math.max(0, ...col.map((id) => main(byId.get(id))));
    let crossAt = align === "center" ? (widest - extents[l]) / 2 : 0;
    for (const id of col) {
      const n = byId.get(id);
      const m = mainAt + (mainSize - main(n)) / 2;
      const x = origin.x + (horizontal ? m : crossAt);
      const y = origin.y + (horizontal ? crossAt : m);
      if (n.position.x !== x || n.position.y !== y) moved++;
      n.position = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
      crossAt += cross(n) + crossGap;
    }
    mainAt += mainSize + mainGap;
  });
  refreshLines(doc);
  return { nodes: nodes.length, layers: layerCount, moved };
}

// ---------------------------------------------------------------------------
// Fitting text boxes to their content
// ---------------------------------------------------------------------------

const NARROW = new Set("iljtfI.,:;'!|()[]/\\- ");
const WIDE = new Set("mwMW@%&");
/** Approximate advance width, in em, of one character in Segoe UI / Arial class fonts. */
function em(ch) {
  if (ch === " ") return 0.28;
  if (NARROW.has(ch)) return 0.3;
  if (WIDE.has(ch)) return 0.82;
  if (/[A-Z]/.test(ch)) return 0.63;
  if (/[0-9]/.test(ch)) return 0.55;
  if (/[^\x00-\x7f]/.test(ch)) return 0.95;
  return 0.52;
}
const textEm = (text) => [...text].reduce((sum, ch) => sum + em(ch), 0);

/** Visible text of a Markdown line: the native renderer's inline markup removed. */
function visible(text) {
  let previous;
  do {
    previous = text;
    text = text
      .replace(/\{([^:{}]+):([^{}]+)\}/g, "$2")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/<u>(.+?)<\/u>/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
      .replace(/(^|\W)_([^_]+)_(?=\W|$)/g, "$1$2");
  } while (text !== previous);
  return text;
}

/** Greedy word wrap of `text` into lines no wider than `width` px at `size` px. */
export function wrappedLineCount(text, width, size) {
  if (!text.trim()) return 1;
  const limit = Math.max(1, width / size);
  let lines = 1;
  let used = 0;
  for (const word of text.split(/(\s+)/)) {
    if (!word) continue;
    const w = textEm(word);
    if (/^\s+$/.test(word)) {
      used += w;
      continue;
    }
    if (used + w > limit && used > 0) {
      lines++;
      used = 0;
    }
    if (w > limit) {
      lines += Math.floor(w / limit);
      used = w % limit;
    } else used += w;
  }
  return lines;
}

/** Height in px of Markdown `content` as drawn by the native/web renderers. */
export function contentHeight(content, width, fontSize, safety = 1.05) {
  let height = 0;
  for (const raw of String(content ?? "").replaceAll("\r", "").split("\n")) {
    let text = raw;
    let size = fontSize;
    const heading = /^(#{1,3})\s+(.*)$/.exec(text);
    if (heading) {
      size = fontSize * ({ 1: 1.7, 2: 1.4, 3: 1.15 }[heading[1].length]);
      text = heading[2];
    }
    if (/^[-*_]{3,}$/.test(text)) text = "─";
    else if (/^- \[[ xX]\] /.test(text)) text = "☐  " + text.slice(6);
    else if (/^[-*] /.test(text)) text = "•  " + text.slice(2);
    else if (text.startsWith("> ")) text = "│  " + text.slice(2);
    const rendered = visible(text);
    const lines = wrappedLineCount(rendered, width / safety, size);
    height += Math.max(size * 1.25, lines * size * 1.25) + 2;
  }
  return height;
}

/**
 * Set each text box's height so its title and content fit (never clipped).
 * Options: ids (default every text box), minHeight (default 60), maxHeight,
 * extra (px of spare room, default 6), safety (width multiplier, default 1.05).
 */
export function fitTextBoxes(doc, options = {}) {
  const minHeight = finite(options.minHeight, 60);
  const maxHeight = finite(options.maxHeight, Infinity);
  const extra = finite(options.extra, 6);
  const safety = finite(options.safety, 1.05);
  const boxes = options.ids
    ? boxesOf(doc, options.ids).filter((e) => doc.entities.textBoxes.includes(e))
    : doc.entities.textBoxes;
  let changed = 0;
  const heights = {};
  for (const box of boxes) {
    const size = finite(box.style?.fontSize, 14);
    const width = Math.max(1, box.size.w - 16);
    const hasTitle = !!box.title;
    const isCanvas = !!box.subCanvas;
    const top = hasTitle ? 39.5 : 8;
    const bottom = isCanvas ? 34 : 8;
    const body = box.content ? contentHeight(box.content, width, size, safety) : 0;
    let h = top + body + bottom + extra;
    if (hasTitle) {
      const titleLines = wrappedLineCount(visible(box.title), (box.size.w - 16) / safety, 15 * 1.07);
      h += (titleLines - 1) * 19;
    }
    h = Math.min(maxHeight, Math.max(minHeight, Math.ceil(h)));
    if (h !== box.size.h) {
      box.size = { ...box.size, h };
      changed++;
    }
    heights[box.id] = h;
  }
  refreshLines(doc);
  return { fitted: boxes.length, changed, heights };
}
