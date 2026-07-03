// ids.js
// Tiny, framework-free ID helper. Isolated so ID creation never throws under
// file:// or a non-secure context (where crypto.randomUUID may be unavailable),
// keeping headless renders and offline GitHub Pages loads console-error free.

/**
 * Generate a unique-enough string id.
 *
 * Prefers the platform crypto.randomUUID() when it exists and is callable;
 * otherwise falls back to a timestamp + Math.random() composite that needs no
 * secure context. Never throws.
 *
 * @returns {string}
 */
export function newId() {
  try {
    if (
      typeof crypto !== 'undefined' &&
      crypto &&
      typeof crypto.randomUUID === 'function'
    ) {
      return crypto.randomUUID();
    }
  } catch (_err) {
    // Some engines expose randomUUID but throw in insecure contexts; fall
    // through to the deterministic-shape fallback below.
  }

  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  const extra = Math.random().toString(36).slice(2, 6);
  return `id-${time}-${rand}${extra}`;
}
