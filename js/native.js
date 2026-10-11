/**
 * Access to the desktop shell, when there is one.
 *
 * `window.canvasNative` is injected by the Electron preload script. In a
 * browser it is simply absent, and every caller falls back to the web APIs, so
 * the same source runs unchanged in both places.
 */

/** @type {object | null} */
export const native = typeof window !== 'undefined' && window.canvasNative ? window.canvasNative : null;

export const isDesktop = native !== null;
