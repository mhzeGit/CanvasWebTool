#!/usr/bin/env node
/**
 * Vendors the browser ES modules listed in index.html's import map into `vendor/`.
 *
 * The app originally resolved these specifiers against jsDelivr, which makes the
 * desktop build depend on the network at startup. This script copies the exact
 * same `dist` files out of `node_modules` so the import map can point at local
 * paths instead — same modules, same versions, no network.
 *
 * Run: npm run vendor
 */
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR_DIR = join(ROOT, 'vendor');
const INDEX_HTML = join(ROOT, 'index.html');

const CDN_PATTERN = /^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@([^/]+)\/(.+)$/;
const VENDOR_PATTERN = /^\.\/vendor\/((?:@[^/]+\/)?[^/]+)\/(.+)$/;

function readImportMap(html) {
  const match = html.match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/);
  if (!match) throw new Error('No <script type="importmap"> block found in index.html');
  return { json: JSON.parse(match[1]), raw: match[0] };
}

/**
 * Resolve an import map target to the package and file it refers to. Accepts
 * both the original jsDelivr URLs and the rewritten `./vendor/...` paths, so the
 * script is idempotent and still works on a fresh clone where index.html already
 * points at vendor/ but the directory has not been generated yet.
 */
function parseTarget(url, pinnedVersions) {
  const cdn = CDN_PATTERN.exec(url);
  if (cdn) return { pkg: cdn[1], version: cdn[2], subpath: cdn[3] };

  const local = VENDOR_PATTERN.exec(url);
  if (!local) return null;
  const pkg = local[1];
  const version = pinnedVersions[pkg];
  if (!version) throw new Error(`${pkg} is in the import map but not a dependency in package.json`);
  return { pkg, version, subpath: local[2] };
}

/**
 * Locate a package directory by walking node_modules upwards. `require.resolve`
 * cannot be used here: these packages declare `exports` maps that deliberately
 * hide both `package.json` and the raw `dist` files we need to copy.
 */
async function packageRoot(pkg) {
  let dir = ROOT;
  for (;;) {
    const candidate = join(dir, 'node_modules', pkg);
    try {
      if ((await stat(candidate)).isDirectory()) return candidate;
    } catch { /* keep walking */ }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`Package not installed: ${pkg} (run npm install)`);
    dir = parent;
  }
}

async function installedVersion(pkg) {
  const manifest = JSON.parse(await readFile(join(await packageRoot(pkg), 'package.json'), 'utf8'));
  return manifest.version;
}

/**
 * Module specifiers a source file imports. Deliberately conservative: only
 * `import`/`export` statement forms are matched, and anything that cannot be a
 * specifier (whitespace, empty) is dropped, so string literals elsewhere in the
 * file are not mistaken for imports.
 */
function moduleSpecifiers(source) {
  const found = new Set();
  const patterns = [
    /\bimport\s+(?:[^'";]+?\s+from\s*)?["']([^"'\s]+)["']/g,
    /\bexport\s+(?:[^'";]+?\s+)?from\s*["']([^"'\s]+)["']/g,
    /\bimport\s*\(\s*["']([^"'\s]+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const [, spec] of source.matchAll(pattern)) {
      if (spec) found.add(spec);
    }
  }
  return found;
}

/**
 * Walk the module graph from the import map's entry points, following relative
 * imports, and report any bare specifier the map does not cover. This checks
 * exactly the files the browser will actually load — nothing more.
 */
async function walkModuleGraph(entryPaths, mapped) {
  const unresolved = new Set();
  const seen = new Set();
  const queue = [...entryPaths];

  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);

    let source;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      unresolved.add(`missing file: ${relative(ROOT, file)}`);
      continue;
    }

    for (const spec of moduleSpecifiers(source)) {
      if (spec.startsWith('.')) queue.push(resolve(dirname(file), spec));
      else if (!mapped.has(spec)) unresolved.add(`${spec}  (from ${relative(ROOT, file)})`);
    }
  }
  return { unresolved, reachable: seen };
}

/** Files kept alongside the reachable modules: manifests and licence notices. */
const KEEP_PATTERN = /(^|\/)(package\.json|LICENSE[^/]*|LICENCE[^/]*)$/i;

/** Delete everything in vendor/ that the browser will never load. */
async function pruneUnreachable(dir, reachable) {
  let keptHere = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const kept = await pruneUnreachable(full, reachable);
      if (kept === 0) await rm(full, { recursive: true, force: true });
      else keptHere += kept;
    } else if (reachable.has(full) || KEEP_PATTERN.test(relative(VENDOR_DIR, full))) {
      keptHere++;
    } else {
      await rm(full, { force: true });
    }
  }
  return keptHere;
}

async function main() {
  const html = await readFile(INDEX_HTML, 'utf8');
  const { json: importMap, raw } = readImportMap(html);
  // Browser modules are devDependencies: they are copied into vendor/ at build
  // time and never require()d, so the installer must not bundle node_modules.
  const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const pinnedVersions = { ...manifest.devDependencies, ...manifest.dependencies };

  const packages = new Map(); // pkg -> version the import map resolves to
  const rewritten = {};

  for (const [specifier, url] of Object.entries(importMap.imports)) {
    const parsed = parseTarget(url, pinnedVersions);
    if (!parsed) throw new Error(`Unrecognised import map target for "${specifier}": ${url}`);

    const { pkg, version, subpath } = parsed;
    const previous = packages.get(pkg);
    if (previous && previous !== version) {
      throw new Error(`Import map pins two versions of ${pkg}: ${previous} and ${version}`);
    }
    packages.set(pkg, version);
    rewritten[specifier] = `./vendor/${pkg}/${subpath}`;
  }

  await rm(VENDOR_DIR, { recursive: true, force: true });
  await mkdir(VENDOR_DIR, { recursive: true });

  const mismatches = [];
  for (const [pkg, wanted] of packages) {
    const actual = await installedVersion(pkg);
    if (actual !== wanted) mismatches.push(`${pkg}: import map wants ${wanted}, node_modules has ${actual}`);

    const src = await packageRoot(pkg);
    const dest = join(VENDOR_DIR, pkg);
    await mkdir(dirname(dest), { recursive: true });
    await cp(src, dest, {
      recursive: true,
      filter: (path) => {
        const rel = relative(src, path);
        if (rel === '') return true;
        // Drop nested deps, sources and types — the browser only loads dist ESM.
        return !rel.startsWith('node_modules') && !rel.startsWith('src') && !rel.endsWith('.d.ts');
      },
    });
  }

  if (mismatches.length > 0) {
    throw new Error(`Version mismatch between import map and node_modules:\n  ${mismatches.join('\n  ')}`);
  }

  // Every file the import map names must actually exist.
  const missing = [];
  for (const [specifier, path] of Object.entries(rewritten)) {
    if (!path.startsWith('./vendor/')) continue;
    const full = join(ROOT, path);
    try {
      await stat(full);
    } catch {
      missing.push(`${specifier} -> ${path}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Import map targets missing from node_modules:\n  ${missing.join('\n  ')}`);
  }

  // Every specifier reachable from the entry points must resolve locally.
  const mapped = new Set(Object.keys(rewritten));
  const entryPaths = Object.values(rewritten)
    .filter((path) => path.startsWith('./vendor/'))
    .map((path) => join(ROOT, path));
  const { unresolved, reachable } = await walkModuleGraph(entryPaths, mapped);
  if (unresolved.size > 0) {
    throw new Error(`Vendored modules import specifiers the import map does not cover:\n  ${[...unresolved].join('\n  ')}`);
  }

  await pruneUnreachable(VENDOR_DIR, reachable);

  const body = JSON.stringify({ imports: rewritten }, null, 2)
    .split('\n')
    .map((line) => (line ? '  ' + line : line))
    .join('\n');
  const block = `<script type="importmap">\n${body}\n  </script>`;
  await writeFile(INDEX_HTML, html.replace(raw, block), 'utf8');

  console.log(`Vendored ${packages.size} packages (${Object.keys(rewritten).length} specifiers) into vendor/.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
