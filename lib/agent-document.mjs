/** Lossless document boundary and validated atomic operations used by both agent transports. */
import { isDeepStrictEqual } from "node:util";
import {
  toPortable,
  fromPortable,
  PLURAL,
  ID_PREFIX,
  WRITABLE_FIELDS,
  flattenFields,
} from "../js/portable-format.js";
import {
  addEntity,
  updateEntity,
  deleteEntity,
  connectEntities,
  getEntity,
  DocError,
} from "./doc-ops.mjs";

export const TYPES = Object.keys(PLURAL);
const clone = (value) => structuredClone(value);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const unsafe = new Set(["__proto__", "prototype", "constructor"]);
export const fail = (code, message) => {
  throw new DocError(code, message);
};
export function safeJson(value, depth = 0) {
  if (depth > 100) fail("EINVAL", "JSON nesting exceeds 100 levels");
  if (typeof value === "number" && !Number.isFinite(value))
    fail("EINVAL", "Numbers must be finite");
  if (value && typeof value === "object")
    for (const [key, v] of Object.entries(value)) {
      if (unsafe.has(key)) fail("EINVAL", `Unsupported object key: ${key}`);
      safeJson(v, depth + 1);
    }
}
export function emptyDocument() {
  return {
    format: "canvaswebtool-document",
    version: 1,
    metadata: {},
    document: {
      viewport: { offsetX: 0, offsetY: 0, scale: 1 },
      settings: {},
      ...Object.fromEntries(Object.values(PLURAL).map((k) => [k, []])),
    },
  };
}
export function toAgentDocument(root) {
  if (root?.meta?.format === "canvaswebtool-portable") {
    validatePortable(root);
    return clone(root);
  }
  if (
    root?.format !== "canvaswebtool-document" ||
    root.version !== 1 ||
    !root.document
  )
    fail(
      "EFORMAT",
      "Expected a version 1 .cvdoc or Canvas portable JSON document",
    );
  if (root.document.elements?.length)
    fail(
      "ELEGACY",
      "Legacy element documents require migration in the original app",
    );
  safeJson(root);
  for (const type of TYPES) {
    const list = root.document[PLURAL[type]] ?? [];
    if (!Array.isArray(list))
      fail("EFORMAT", `Invalid ${PLURAL[type]} collection`);
    for (const raw of list) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        fail("EFORMAT", "Entities must be objects");
      for (const end of ["From", "To"])
        if (raw["connected" + end] != null) {
          const targetType = raw["connected" + end + "Type"] ?? "textBox";
          const index = raw["connected" + end];
          if (
            !["textBox", "shape"].includes(targetType) ||
            !Number.isInteger(index) ||
            index < 0 ||
            !root.document[PLURAL[targetType]]?.[index]
          )
            fail("EINVAL", "Dangling raw line endpoint");
          raw["connected" + end + "Type"] = targetType;
        }
    }
  }
  const p = JSON.parse(JSON.stringify(toPortable(root.document)));
  p.settings = clone(root.document.settings ?? {});
  p.metadata = clone(root.metadata ?? {});
  p.extensions = clone(root);
  delete p.extensions.document;
  delete p.extensions.metadata;
  delete p.extensions.format;
  delete p.extensions.version;
  p.documentExtensions = clone(root.document);
  for (const k of [...Object.values(PLURAL), "viewport", "settings"])
    delete p.documentExtensions[k];
  for (const type of TYPES)
    for (let i = 0; i < p.entities[PLURAL[type]].length; i++) {
      const raw = root.document[PLURAL[type]][i],
        e = p.entities[PLURAL[type]][i];
      e.extensions = clone(raw);
      for (const key of [
        "id",
        "locked",
        "parentId",
        "parentType",
        ...Object.values(WRITABLE_FIELDS[type]),
        "connectedFrom",
        "connectedTo",
        "connectedFromType",
        "connectedToType",
        "from",
        "to",
        "image",
        "blocks",
        "content",
      ])
        delete e.extensions[key];
      if (type === "textBox") e.richText = clone(raw.content ?? null);
      if (type === "shape") e.image = clone(raw.image ?? null);
    }
  validatePortable(p);
  return p;
}
export function toLegacy(p) {
  validatePortable(p);
  const { document } = fromPortable(p);
  for (const type of TYPES)
    for (let i = 0; i < document[PLURAL[type]].length; i++) {
      const raw = document[PLURAL[type]][i],
        e = p.entities[PLURAL[type]][i];
      // nativeData is accepted from the original native exporter; mapped portable fields win.
      const combined = {
        ...clone(e.nativeData ?? {}),
        ...clone(e.extensions ?? {}),
        ...raw,
      };
      if (type === "shape") combined.image = clone(e.image ?? null);
      if (type === "textBox") {
        if (own(e, "richText")) {
          if (e.richText !== null) combined.content = clone(e.richText);
          else delete combined.content;
        }
      }
      document[PLURAL[type]][i] = combined;
    }
  return {
    ...clone(p.extensions ?? {}),
    format: "canvaswebtool-document",
    version: 1,
    metadata: clone(p.metadata ?? {}),
    document: {
      ...clone(p.documentExtensions ?? {}),
      ...document,
      settings: clone(p.settings ?? {}),
    },
  };
}
const numericFields = new Set([
  "position.x",
  "position.y",
  "size.w",
  "size.h",
  "startPoint.x",
  "startPoint.y",
  "endPoint.x",
  "endPoint.y",
  "style.fontSize",
  "style.borderWidth",
  "style.cornerRadius",
  "style.lineWidth",
  "style.headSize",
]);
const positiveFields = new Set(["size.w", "size.h", "style.fontSize"]);
export function validateProps(type, props) {
  safeJson(props);
  if (!props || Array.isArray(props) || typeof props !== "object")
    fail("EINVAL", "props must be an object");
  const extra =
    type === "textBox"
      ? ["richText", "blocks", "parent"]
      : type === "shape"
        ? ["image", "parent"]
        : type === "connection"
          ? ["from", "to"]
          : ["connectedFrom", "connectedTo"];
  const simple = Object.fromEntries(
    Object.entries(props).filter(([k]) => !extra.includes(k)),
  );
  for (const [path, value] of Object.entries(flattenFields(simple))) {
    if (!own(WRITABLE_FIELDS[type] ?? {}, path))
      fail("EINVAL", `Unknown ${type} field: ${path}`);
    if (numericFields.has(path)) {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        Math.abs(value) > 1e9 ||
        (positiveFields.has(path) && value <= 0) ||
        (/(?:borderWidth|cornerRadius|lineWidth|headSize)$/.test(path) &&
          value < 0)
      )
        fail("EINVAL", `Invalid number for ${path}`);
    } else if (path === "locked") {
      if (typeof value !== "boolean")
        fail("EINVAL", "locked must be a boolean");
    } else if (typeof value !== "string")
      fail("EINVAL", `${path} must be a string`);
  }
  return { simple, extra };
}
function idType(id) {
  return TYPES.find(
    (t) =>
      typeof id === "string" &&
      new RegExp(`^${ID_PREFIX[t]}-[1-9][0-9]*$`).test(id),
  );
}
export function validatePortable(p) {
  safeJson(p);
  if (
    p?.meta?.format !== "canvaswebtool-portable" ||
    p.meta.version !== 1 ||
    !p.entities
  )
    fail("EFORMAT", "Expected Canvas portable JSON version 1");
  const byId = new Map();
  for (const type of TYPES) {
    const list = p.entities[PLURAL[type]];
    if (!Array.isArray(list)) fail("EFORMAT", `Missing ${PLURAL[type]} array`);
    for (const e of list) {
      if (
        idType(e?.id) !== type ||
        !Number.isSafeInteger(Number(e?.id?.split("-")[1])) ||
        byId.has(e.id)
      )
        fail("EFORMAT", `Invalid or duplicate ${type} id: ${e?.id}`);
      byId.set(e.id, { e, type });
      const props = Object.fromEntries(
        Object.entries(e).filter(
          ([k]) => !["id", "extensions", "nativeData"].includes(k),
        ),
      );
      validateProps(type, props);
      if (
        type === "shape" &&
        !["rectangle", "circle", "triangle", "diamond"].includes(e.type)
      )
        fail("EINVAL", "Unknown shape type");
      if (e.image !== undefined && e.image !== null) {
        if (
          type !== "shape" ||
          typeof e.image !== "object" ||
          Array.isArray(e.image)
        )
          fail("EINVAL", "image must be an object or null");
        if (
          e.image.src != null &&
          (typeof e.image.src !== "string" ||
            !/^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml|avif);base64,[A-Za-z0-9+/]*={0,2}$/.test(
              e.image.src,
            ))
        )
          fail(
            "EINVAL",
            "Images must be embedded data URLs; use the image operation for a local file",
          );
        for (const f of ["x", "y", "w", "h"])
          if (
            e.image[f] != null &&
            (typeof e.image[f] !== "number" ||
              !Number.isFinite(e.image[f]) ||
              ((f === "w" || f === "h") && e.image[f] <= 0))
          )
            fail("EINVAL", `Invalid image ${f}`);
      }
      if (
        e.richText != null &&
        (typeof e.richText !== "object" || e.richText.type !== "doc")
      )
        fail("EINVAL", "richText must be a Tiptap doc object or null");
      if (e.blocks != null && !Array.isArray(e.blocks))
        fail("EINVAL", "blocks must be an array or null");
    }
  }
  const ref = (r, onlyText = false) => {
    const id = typeof r === "string" ? r : r?.entityId;
    const found = byId.get(id);
    if (
      !found ||
      !["shape", "textBox"].includes(found.type) ||
      (onlyText && found.type !== "textBox") ||
      (r?.type && r.type !== found.type)
    )
      fail("EINVAL", `Dangling or invalid reference: ${id}`);
    return found;
  };
  for (const { e, type } of byId.values()) {
    if (e.parent) {
      if (!["shape", "textBox"].includes(type) || ref(e.parent).e.id === e.id)
        fail("EINVAL", "Invalid parent");
      const seen = new Set([e.id]);
      let next = e.parent;
      while (next) {
        const target = ref(next).e;
        if (seen.has(target.id)) fail("EINVAL", "Parent cycle detected");
        seen.add(target.id);
        next = target.parent;
      }
    }
    for (const key of ["connectedFrom", "connectedTo"]) if (e[key]) ref(e[key]);
    if (type === "connection") {
      ref(e.from, true);
      ref(e.to, true);
      if (e.from === e.to) fail("EINVAL", "Cannot connect a box to itself");
    }
  }
  if (p.viewport) {
    for (const f of ["offsetX", "offsetY", "scale"])
      if (typeof p.viewport[f] !== "number" || !Number.isFinite(p.viewport[f]))
        fail("EINVAL", `Invalid viewport ${f}`);
    if (p.viewport.scale < 0.05 || p.viewport.scale > 5)
      fail("EINVAL", "Viewport scale must be between 0.05 and 5");
  }
}
function setProps(p, e, type, props) {
  const { simple, extra } = validateProps(type, props);
  const changed = updateEntity(p, e.id, simple).changed;
  for (const field of extra)
    if (own(props, field)) {
      e[field] = clone(props[field]);
      changed.push(field);
    }
  if (own(props, "content")) {
    e.blocks = null;
    e.richText = null;
    if (e.nativeData) {
      delete e.nativeData.content;
      delete e.nativeData.blocks;
      e.nativeData.text = props.content;
    }
  }
  if (own(props, "richText")) {
    e.blocks = null;
    /* native reads rich JSON when the Markdown cache is empty */ e.content =
      "";
  }
  if (
    own(props, "blocks") &&
    !own(props, "content") &&
    !own(props, "richText")
  ) {
    e.richText = null;
    e.content = "";
  }
  return changed;
}
function pointer(path) {
  if (path === "") return [];
  if (typeof path !== "string" || !path.startsWith("/"))
    fail("EINVAL", "JSON Patch paths must be JSON pointers");
  return path
    .slice(1)
    .split("/")
    .map((s) => {
      if (/~(?![01])/u.test(s)) fail("EINVAL", "Invalid JSON pointer escape");
      const key = s.replaceAll("~1", "/").replaceAll("~0", "~");
      if (unsafe.has(key)) fail("EINVAL", "Unsafe JSON pointer");
      return key;
    });
}
export function patchJson(input, patches) {
  let result = clone(input);
  if (!Array.isArray(patches) || patches.length > 1000)
    fail("EINVAL", "patches must be an array of at most 1000 operations");
  const locate = (path, add = false) => {
    const parts = pointer(path);
    if (!parts.length) return { root: true };
    let obj = result;
    for (const key of parts.slice(0, -1)) {
      if (!obj || !own(obj, key)) fail("EINVAL", `Missing path: ${path}`);
      obj = obj[key];
    }
    let key = parts.at(-1);
    if (!obj || typeof obj !== "object")
      fail("EINVAL", "Patch parent must be an object");
    if (Array.isArray(obj)) {
      if (key === "-" && add) key = obj.length;
      else if (
        !/^(0|[1-9][0-9]*)$/.test(key) ||
        Number(key) > (add ? obj.length : obj.length - 1)
      )
        fail("EINVAL", "Invalid array index");
      else key = Number(key);
    }
    return { obj, key };
  };
  const get = (path) => {
    const p = locate(path);
    if (p.root) return clone(result);
    if (!own(p.obj, p.key)) fail("EINVAL", `Missing path: ${path}`);
    return clone(p.obj[p.key]);
  };
  const remove = (path) => {
    const p = locate(path);
    if (p.root) {
      result = null;
      return;
    }
    if (!own(p.obj, p.key)) fail("EINVAL", "Missing remove target");
    if (Array.isArray(p.obj)) p.obj.splice(p.key, 1);
    else delete p.obj[p.key];
  };
  const put = (path, value, add) => {
    const p = locate(path, add);
    if (p.root) {
      result = clone(value);
      return;
    }
    if (!add && !own(p.obj, p.key)) fail("EINVAL", "Missing replace target");
    if (add && Array.isArray(p.obj)) p.obj.splice(p.key, 0, clone(value));
    else p.obj[p.key] = clone(value);
  };
  for (const patch of patches) {
    safeJson(patch);
    switch (patch.op) {
      case "add":
      case "replace":
        if (!own(patch, "value")) fail("EINVAL", "Patch value is required");
        put(patch.path, patch.value, patch.op === "add");
        break;
      case "remove":
        remove(patch.path);
        break;
      case "test":
        if (!isDeepStrictEqual(get(patch.path), patch.value))
          fail("ECONFLICT", `Patch test failed at ${patch.path}`);
        break;
      case "copy":
        put(patch.path, get(patch.from), true);
        break;
      case "move": {
        if (patch.path.startsWith(patch.from + "/"))
          fail("EINVAL", "Cannot move into a descendant");
        const v = get(patch.from);
        remove(patch.from);
        put(patch.path, v, true);
        break;
      }
      default:
        fail("EINVAL", `Unknown patch operation: ${patch.op}`);
    }
  }
  return result;
}
export function applyOperations(document, operations) {
  let p = clone(document);
  const aliases = {},
    results = [];
  if (
    !Array.isArray(operations) ||
    operations.length < 1 ||
    operations.length > 1000
  )
    fail("EINVAL", "operations must contain 1–1000 actions");
  const resolveId = (id) =>
    typeof id === "string" && id.startsWith("$")
      ? (aliases[id.slice(1)] ?? fail("EINVAL", `Unknown alias: ${id}`))
      : id;
  for (const operation of operations) {
    safeJson(operation);
    let result;
    const op = clone(operation);
    for (const field of ["id", "from", "to"])
      if (op[field]) op[field] = resolveId(op[field]);
    if (op.op === "add") {
      const props = op.props ?? {};
      const { simple } = validateProps(op.type, props);
      if (op.type === "connection") {
        props.from = resolveId(props.from);
        props.to = resolveId(props.to);
      }
      const e =
        op.type === "connection"
          ? connectEntities(p, props.from, props.to, {
              kind: "connection",
              label: props.label,
              color: props.style?.color,
            })
          : addEntity(p, op.type, simple);
      setProps(p, e, op.type, props);
      result = e;
    } else if (op.op === "update") {
      const e = getEntity(p, op.id),
        type = idType(op.id);
      if (
        e.locked &&
        !(Object.keys(op.props ?? {}).length === 1 && op.props.locked === false)
      )
        fail("ELOCKED", `Unlock ${op.id} before editing`);
      result = { id: e.id, changed: setProps(p, e, type, op.props ?? {}) };
    } else if (op.op === "delete") {
      if (getEntity(p, op.id).locked)
        fail("ELOCKED", `Unlock ${op.id} before deleting`);
      result = deleteEntity(p, op.id);
    } else if (op.op === "connect")
      result = connectEntities(p, op.from, op.to, op);
    else if (op.op === "document") {
      if (op.viewport) p.viewport = { ...p.viewport, ...op.viewport };
      for (const field of ["settings", "metadata"])
        if (own(op, field)) p[field] = clone(op[field]);
      result = { updated: true };
    } else if (op.op === "patch") {
      p = toAgentDocument(patchJson(toLegacy(p), op.patches));
      result = { patched: op.patches.length };
    } else fail("EINVAL", `Unknown operation: ${op.op}`);
    validatePortable(p);
    if (op.alias) {
      if (
        !/^[A-Za-z][A-Za-z0-9_-]*$/.test(op.alias) ||
        own(aliases, op.alias) ||
        !result.id
      )
        fail(
          "EINVAL",
          "Aliases must be unique names attached to entity creation",
        );
      aliases[op.alias] = result.id;
    }
    results.push(clone(result));
  }
  return { document: p, results, aliases };
}
export function summarize(p) {
  const entities = Object.values(p.entities).flat();
  return {
    counts: Object.fromEntries(
      Object.entries(p.entities).map(([k, v]) => [k, v.length]),
    ),
    bounds: entities
      .filter((e) => e.position)
      .reduce((r, e) => {
        const x = e.position.x,
          y = e.position.y,
          w = e.size.w,
          h = e.size.h;
        return r
          ? {
              left: Math.min(r.left, x),
              top: Math.min(r.top, y),
              right: Math.max(r.right, x + w),
              bottom: Math.max(r.bottom, y + h),
            }
          : { left: x, top: y, right: x + w, bottom: y + h };
      }, null),
    viewport: p.viewport,
    settings: p.settings ?? {},
    graph: entities
      .filter((e) => e.from || e.connectedFrom || e.connectedTo)
      .map((e) => ({
        id: e.id,
        from: e.from ?? e.connectedFrom?.entityId,
        to: e.to ?? e.connectedTo?.entityId,
        label: e.label ?? "",
      })),
  };
}
export function query(
  p,
  { type, text, ids, parent, offset = 0, limit = 100 } = {},
) {
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 1000
  )
    fail("EINVAL", "offset must be nonnegative and limit must be 1–1000");
  if (type && !TYPES.includes(type) && !Object.values(PLURAL).includes(type))
    fail("EINVAL", "Unknown entity type");
  const all = Object.entries(p.entities)
    .filter(([k]) => !type || k === (PLURAL[type] ?? type))
    .flatMap(([collection, items]) => items.map((e) => ({ collection, ...e })))
    .filter(
      (e) =>
        (!ids || ids.includes(e.id)) &&
        (!parent || e.parent?.entityId === parent) &&
        (!text ||
          [
            e.title,
            e.content,
            e.label,
            JSON.stringify(e.richText ?? e.blocks ?? ""),
          ].some((s) => s?.toLowerCase().includes(text.toLowerCase()))),
    );
  return {
    total: all.length,
    offset,
    limit,
    entities: all.slice(offset, offset + limit),
  };
}
