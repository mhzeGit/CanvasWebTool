/**
 * Serves the app over a custom `app://` scheme instead of `file://`.
 *
 * ES module imports and import maps do not work on `file://`, and the app is
 * built entirely from ES modules. A privileged custom scheme gives the page a
 * real origin, which also means localStorage, OPFS and secure-context APIs
 * behave exactly as they do when the app is served over HTTP in a browser.
 */
import { protocol, net } from 'electron';
import { pathToFileURL } from 'node:url';
import { normalize, join, sep } from 'node:path';

export const SCHEME = 'app';
export const HOST = 'canvas';
export const ORIGIN = `${SCHEME}://${HOST}`;
export const START_URL = `${ORIGIN}/index.html`;

/**
 * Must run before `app.whenReady()`. `standard` gives the scheme normal URL
 * parsing (so relative import-map paths resolve), and `secure` marks the origin
 * as trustworthy so the page is a secure context.
 */
export function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        codeCache: true,
      },
    },
  ]);
}

/**
 * Resolve a request path to a file inside `rootDir`, or null if it escapes.
 * Directory traversal is rejected by normalising first and then requiring the
 * result to still sit under the root.
 */
function resolveWithinRoot(rootDir, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;

  const relative = decoded.replace(/^\/+/, '') || 'index.html';
  const resolved = normalize(join(rootDir, relative));
  const rootWithSep = rootDir.endsWith(sep) ? rootDir : rootDir + sep;
  return resolved.startsWith(rootWithSep) ? resolved : null;
}

export function registerHandler(rootDir) {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== HOST) {
      return new Response('Not found', { status: 404 });
    }

    const filePath = resolveWithinRoot(rootDir, url.pathname);
    if (!filePath) {
      return new Response('Forbidden', { status: 403 });
    }

    // net.fetch on a file URL streams the body and infers the MIME type,
    // including the `.js` -> application/javascript mapping the app needs.
    try {
      return await net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}
