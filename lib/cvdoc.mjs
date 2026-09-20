/**
 * Reading and writing `.cvdoc` files as portable JSON.
 *
 * `canvas read plan.cvdoc` and `canvas read` against the running app must print
 * the same thing, so this converts on the way in and out using the very modules
 * the app itself uses: `js/format.js` for the on-disk envelope and image assets,
 * `js/portable-format.js` for the id-addressed view.
 */
import { basename } from 'node:path';
import {
  deserializeDocument, serializeDocument, extractImageAssets, embedImageAssets,
} from '../js/format.js';
import { fromPortable, toPortable } from '../js/portable-format.js';
import { assetDirFor, readAssets, readDocument, writeAssets, writeDocument } from './document-store.mjs';

/** Read a `.cvdoc` (or portable `.json`) file and return it as portable JSON. */
export async function readPortable(path) {
  const { data, path: full, name, mtimeMs } = await readDocument(path);

  // A portable export can be read back directly; a .cvdoc needs unwrapping.
  if (data?.meta?.format) {
    return { portable: data, path: full, name, mtimeMs, kind: 'portable' };
  }

  const assets = await readAssets(assetDirFor(full));
  if (Object.keys(assets).length > 0) embedImageAssets(data.document || data, assets);

  const internal = deserializeDocument(data);
  if (internal.nodes.length > 0) {
    // Pre-textBox documents need the app's own migration path; converting them
    // here as well would be a second, drifting copy of it.
    const error = new Error(`${name} uses the legacy element format. Open and re-save it in the app once, then the CLI can edit it.`);
    error.code = 'ELEGACY';
    throw error;
  }

  return { portable: toPortable(internal), path: full, name, mtimeMs, kind: 'cvdoc', envelope: data };
}

/**
 * Write portable JSON back out as a `.cvdoc`, splitting embedded images into
 * the document's assets folder exactly as the app does when it saves.
 */
export async function writePortable(path, portable) {
  const { document: internal } = fromPortable(portable);
  const envelope = serializeDocument(internal);

  const assets = extractImageAssets(envelope.document);
  await writeAssets(assetDirFor(path), assets);

  const written = await writeDocument(path, envelope);
  return { ...written, assets: assets.length };
}

/** Write portable JSON verbatim, for `canvas export`. */
export async function writePortableJson(path, portable) {
  return writeDocument(path, portable);
}

export function documentName(path) {
  return basename(path);
}
