/** Background-only agent access. Live documents use native compare-and-swap; closed files use locks and atomic rename. */
import { createHash, randomUUID } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  unlink,
  rename,
  realpath,
  link,
} from "node:fs/promises";
import { dirname, basename, extname, resolve, join } from "node:path";
import { readEndpoint } from "../shared/endpoint.mjs";
import lockfile from "proper-lockfile";
import { connectToApp } from "./client.mjs";
import { validateDocumentPath, assetDirFor } from "./document-store.mjs";
import {
  emptyDocument,
  toAgentDocument,
  toLegacy,
  applyOperations,
  summarize,
  query,
  fail,
  validatePortable,
} from "./agent-document.mjs";

const hash = (text) => createHash("sha256").update(text).digest("hex");
const mime = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};
export async function canonicalPath(path) {
  let full = resolve(path);
  try {
    full = await realpath(full);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return process.platform === "win32" ? full.toLowerCase() : full;
}
const samePath = async (a, b) =>
  !!a && !!b && (await canonicalPath(a)) === (await canonicalPath(b));
async function liveRequest(endpoint, cmd, args = {}) {
  const client = await connectToApp(endpoint);
  try {
    return await client.request(cmd, args);
  } finally {
    client.close();
  }
}
async function choose({ file, mode = "auto" } = {}) {
  if (!["auto", "live", "offline"].includes(mode))
    fail("EINVAL", "mode must be auto, live or offline");
  const path = file ? await canonicalPath(validateDocumentPath(file)) : null;
  const endpoint = await readEndpoint();
  const matching =
    endpoint && (!path || (await samePath(path, endpoint.filePath)));
  if (
    mode === "offline" &&
    endpoint &&
    path &&
    (await samePath(path, endpoint.filePath))
  )
    fail(
      "EOPEN",
      "This file is open in Canvas; use auto/live so the app cannot overwrite your edit",
    );
  if (mode === "live" && !matching)
    fail(
      "ENOTRUNNING",
      path
        ? "Canvas does not have this document open"
        : "No running Canvas app",
    );
  if (mode !== "offline" && matching) {
    if (endpoint.agentProtocol !== 1)
      fail(
        "EUPGRADE",
        "This app does not support the background agent API. Run the current native build or close the app to edit its file offline",
      );
    return { mode: "live", endpoint, path };
  }
  if (!path) fail("EINVAL", "Specify a file when no native canvas is open");
  return { mode: "offline", path };
}
async function readDisk(path) {
  const text = await readFile(path, "utf8");
  let raw;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    fail("EFORMAT", `${basename(path)} is not valid JSON`);
  }
  const portable = raw?.meta?.format === "canvaswebtool-portable";
  const body = portable ? raw.entities : raw.document;
  for (const shape of body?.shapes ?? []) {
    const image = shape.image;
    if (image?.assetPath) {
      const name = image.assetPath;
      if (
        typeof name !== "string" ||
        name !== basename(name) ||
        name.includes("\\") ||
        name.includes("/") ||
        !mime[extname(name).toLowerCase()]
      )
        fail("EINVAL", "Invalid image asset path");
      const asset = join(assetDirFor(path), name);
      const bytes = await readFile(asset);
      image.src = `data:${mime[extname(name).toLowerCase()]};base64,${bytes.toString("base64")}`;
      delete image.assetPath;
    }
  }
  const document = toAgentDocument(raw);
  return {
    document,
    revision: hash(
      text +
        "\n" +
        JSON.stringify(
          document.entities.shapes.map((e) => e.image?.src ?? null),
        ),
    ),
    kind: portable ? "portable" : "cvdoc",
  };
}
async function lockFile(path, action) {
  await mkdir(dirname(path), { recursive: true });
  const release = await lockfile.lock(path, {
    realpath: false,
    lockfilePath: path + ".agent-lock",
    stale: 30000,
    update: 10000,
    retries: { retries: 40, factor: 1, minTimeout: 50, maxTimeout: 50 },
  });
  try {
    return await action();
  } finally {
    await release();
  }
}
async function assertNotOpen(path) {
  const endpoint = await readEndpoint();
  if (endpoint && (await samePath(path, endpoint.filePath)))
    fail(
      "EOPEN",
      "The file was opened in Canvas while editing; retry in auto mode",
    );
}
async function writeDisk(
  path,
  document,
  kind,
  { expectedRevision, create = false, overwrite = false } = {},
) {
  validatePortable(document);
  let current;
  try {
    current = await readDisk(path);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (create && current && !overwrite)
    fail("EEXIST", "File already exists; explicitly allow overwrite");
  if (expectedRevision !== undefined && expectedRevision !== current?.revision)
    fail(
      "ECONFLICT",
      "Document changed since it was read; read again before editing",
    );
  await assertNotOpen(path);
  const data =
    kind === "portable" ? structuredClone(document) : toLegacy(document);
  const shapes =
    kind === "portable" ? data.entities.shapes : data.document.shapes;
  // Content-addressed assets are added before replacing the document. Old assets are retained,
  // so failures and concurrent readers can never lose an image referenced by the previous file.
  if (kind !== "portable")
    for (const shape of shapes) {
      const image = shape.image;
      if (!image?.src) continue;
      const match = /^data:(image\/[^;]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(
        image.src,
      );
      if (!match) fail("EINVAL", "Unsupported image data URL");
      const ext = Object.entries(mime).find(([, m]) => m === match[1])?.[0];
      if (!ext) fail("EINVAL", "Unsupported image MIME type");
      const bytes = Buffer.from(match[2], "base64");
      const name = "img_" + hash(bytes).slice(0, 24) + ext;
      await mkdir(assetDirFor(path), { recursive: true });
      await writeFile(join(assetDirFor(path), name), bytes);
      delete image.src;
      image.assetPath = name;
    }
  const temporary = join(
    dirname(path),
    "." + basename(path) + "." + randomUUID() + ".tmp",
  );
  try {
    await writeFile(temporary, JSON.stringify(data, null, 2) + "\n", {
      flag: "wx",
    });
    // Recheck after asset I/O, immediately before the atomic document replacement.
    await assertNotOpen(path);
    if (current && (await readDisk(path)).revision !== current.revision)
      fail("ECONFLICT", "Document changed during the edit");
    if (create && !overwrite) await link(temporary, path);
    else await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return readDisk(path);
}
function withoutImages(document) {
  const copy = structuredClone(document);
  for (const shape of copy.entities.shapes) {
    for (const image of [shape.image, shape.nativeData?.image])
      if (image?.src) {
        image.byteLength = Buffer.byteLength(image.src);
        image.src = "[omitted; read with includeImages=true]";
      }
  }
  return copy;
}
export class AgentService {
  async status() {
    const endpoint = await readEndpoint();
    if (!endpoint)
      return { running: false, offlineAvailable: true, agentProtocol: 1 };
    const status = await liveRequest(endpoint, "status");
    return { ...status, offlineAvailable: true };
  }
  async snapshot(options = {}) {
    const target = await choose(options);
    if (target.mode === "offline")
      return {
        ...(await readDisk(target.path)),
        mode: "offline",
        file: target.path,
      };
    const result = await liveRequest(target.endpoint, "agent.read");
    if (target.path && !(await samePath(target.path, result.file)))
      fail("ECONFLICT", "Canvas switched to another document; retry");
    return { ...result, document: toAgentDocument(result.data), mode: "live" };
  }
  async read(options = {}) {
    const s = await this.snapshot(options);
    const document = options.includeImages
      ? s.document
      : withoutImages(s.document);
    const result = {
      mode: s.mode,
      file: s.file ?? null,
      revision: s.revision,
      summary: summarize(s.document),
    };
    if (options.format === "raw")
      result.document = toLegacy(s.document); // raw is intentionally complete and lossless
    else if (options.format !== "summary") result.document = document;
    return result;
  }
  async query(options = {}) {
    const s = await this.snapshot(options);
    return {
      mode: s.mode,
      file: s.file ?? null,
      revision: s.revision,
      ...query(
        options.includeImages ? s.document : withoutImages(s.document),
        options,
      ),
    };
  }
  async apply(options) {
    const target = await choose(options);
    const run = async () => {
      const s =
        target.mode === "live"
          ? await this.snapshot({ ...options, mode: "live" })
          : {
              ...(await readDisk(target.path)),
              mode: "offline",
              file: target.path,
            };
      if (
        options.expectedRevision !== undefined &&
        s.revision !== options.expectedRevision
      )
        fail(
          "ECONFLICT",
          "Document changed since it was read; read again before editing",
        );
      const operations = structuredClone(options.operations);
      for (const op of operations ?? [])
        if (op.op === "image") {
          const bytes = await readFile(resolve(op.path));
          if (bytes.length > 16 * 1024 * 1024)
            fail("EINVAL", "Image exceeds 16 MB");
          const type = mime[extname(op.path).toLowerCase()];
          if (!type) fail("EINVAL", "Unsupported image extension");
          op.op = "update";
          op.props = {
            image: {
              src: `data:${type};base64,${bytes.toString("base64")}`,
              fileName: basename(op.path),
              x: 10,
              y: 10,
              w: op.width ?? 120,
              h: op.height ?? 120,
              keepRatio: true,
            },
          };
          delete op.path;
        }
      const changed = applyOperations(s.document, operations);
      if (options.dryRun)
        return {
          mode: s.mode,
          file: s.file,
          revision: s.revision,
          dryRun: true,
          results: changed.results,
          aliases: changed.aliases,
          summary: summarize(changed.document),
        };
      let saved;
      if (s.mode === "live")
        saved = await liveRequest(target.endpoint, "agent.replace", {
          data: toLegacy(changed.document),
          expectedRevision: s.revision,
          expectedPath: s.file ?? null,
        });
      else
        saved = await writeDisk(target.path, changed.document, s.kind, {
          expectedRevision: s.revision,
        });
      return {
        mode: s.mode,
        file: s.file ?? null,
        revision: saved.revision,
        results: changed.results,
        aliases: changed.aliases,
        summary: summarize(changed.document),
      };
    };
    return target.mode === "offline" ? lockFile(target.path, run) : run();
  }
  async create({ file, document, format = "cvdoc", overwrite = false } = {}) {
    const path = await canonicalPath(validateDocumentPath(file));
    const portable = document
      ? toAgentDocument(document)
      : toAgentDocument(emptyDocument());
    if (!["cvdoc", "portable"].includes(format))
      fail("EINVAL", "format must be cvdoc or portable");
    return lockFile(path, async () => {
      const result = await writeDisk(path, portable, format, {
        create: true,
        overwrite,
      });
      return {
        created: true,
        file: path,
        revision: result.revision,
        summary: summarize(portable),
      };
    });
  }
  async replace(options) {
    const input = toAgentDocument(options.document);
    return this.apply({
      ...options,
      operations: [
        {
          op: "patch",
          patches: [{ op: "replace", path: "", value: toLegacy(input) }],
        },
      ],
    });
  }
  async session(action, options = {}) {
    const endpoint = await readEndpoint();
    if (!endpoint || endpoint.agentProtocol !== 1)
      fail(
        "ENOTRUNNING",
        "Start the current native Canvas app for session commands",
      );
    if (!["open", "new", "save", "undo", "redo"].includes(action))
      fail("EINVAL", "Unknown session action");
    return liveRequest(endpoint, "agent." + action, {
      path: options.path ? validateDocumentPath(options.path) : undefined,
      expectedRevision: options.expectedRevision,
      discardChanges: options.discardChanges === true,
      overwrite: options.overwrite === true,
    });
  }
  async export({ destination, format = "portable", ...options }) {
    const s = await this.snapshot(options);
    if (!destination)
      return {
        revision: s.revision,
        document: format === "raw" ? toLegacy(s.document) : s.document,
      };
    if (s.file && (await samePath(s.file, destination)))
      fail(
        "EINVAL",
        "Use apply/save to modify the source; export needs a different destination",
      );
    return this.create({
      file: destination,
      document: s.document,
      format: format === "raw" ? "cvdoc" : "portable",
      overwrite: options.overwrite === true,
    });
  }
}
