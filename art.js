// art.js — deterministic placeholder concept art (pure presentational helper).
//
// Shared by the Arena duel cards and the Locker pitch rows so an image-less
// pitch wears the SAME art everywhere: the hue comes from a hash of the pitch
// id over a FIXED validated hue set (the four tier hues + the one accent from
// the styles.css token contract — see gamification-design-spec.md), and the
// glyph is the pitch's item slot drawn as inline SVG. Hash = stable identity:
// no per-render randomness, no external requests, ever.
//
// The hue reuse carries NO rank semantics (the design spec calls this out):
// placeholder art never shows a tier glyph, so the color+shape composition
// can never be confused with a medal chip — tier identity always pairs a tier
// color with a tier glyph AND a text label.
//
// ACCESS SPLIT NOTE: this module is DOM-building but pure presentation. It
// reads nothing from the store and imports nothing — in particular it never
// touches ranking or progression — so it is safe on either side of the seam
// (the guard test's ranking.rank scan covers it).

// The fixed hash set: --tier-bronze, --tier-silver, --tier-gold,
// --tier-diamond, --accent. Duplicated from the styles.css :root token block
// on purpose (SVG fills can't read CSS custom properties portably) — keep the
// two in sync with the design spec's token contract.
export const ART_HUES = ['#b07038', '#5f8ed0', '#b5851b', '#1f9db8', '#f25c2a'];

/**
 * Stable hue for a pitch id: a djb2-style string hash over the fixed hue set.
 * The same id always yields the same hue; a missing id degrades to the first
 * hue rather than throwing.
 * @param {string|null|undefined} id
 * @returns {string} a hex color from ART_HUES
 */
export function artHue(id) {
  const key = String(id == null ? '' : id);
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0;
  }
  return ART_HUES[hash % ART_HUES.length];
}

// Item-slot glyphs as stroke path data (viewBox 0 0 64 40, drawn around the
// center). Keys are lowercase KEYWORDS matched against the slot name, so both
// the wizard's fixed slots ("Weapon Skin", "Headgear", ...) and the bundled
// sample slots ("Weapon", "Outfit", "Back Accessory", ...) resolve to a shape;
// anything unrecognized falls back to the diamond mark.
const SLOT_GLYPHS = [
  // figure: head + shoulders (Character Skin / Outfit)
  {
    match: ['character', 'outfit', 'skin'],
    paths: [
      'M27.5 13a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0',
      'M23 31c1.5-7 4.5-10 9-10s7.5 3 9 10',
    ],
  },
  // sword: blade + crossguard + grip (Weapon Skin / Weapon)
  {
    match: ['weapon', 'sword', 'blade'],
    paths: ['M27 28 40 13', 'M24 25l8 8', 'M22 33l4-4'],
  },
  // helmet dome + visor slit (Headgear)
  {
    match: ['head', 'helm', 'hat'],
    paths: ['M23 29v-7a9 9 0 0 1 18 0v7H23Z', 'M27 24h10'],
  },
  // hanging banner / cape (Back Bling / Cape / Back Accessory)
  {
    match: ['back', 'cape', 'bling'],
    paths: ['M25 11h14v13l-7 7-7-7Z'],
  },
  // speech bubble with dots (Emote / Victory Pose)
  {
    match: ['emote', 'pose', 'victory'],
    paths: ['M22 12h20v13H31l-5 5v-5h-4Z', 'M28 18.5h.01', 'M32 18.5h.01', 'M36 18.5h.01'],
  },
  // horseshoe arch (Mount)
  {
    match: ['mount'],
    paths: ['M24 31v-9a8 8 0 0 1 16 0v9', 'M21 31h6', 'M37 31h6'],
  },
  // framed scene with a ridge line (Loading Screen)
  {
    match: ['loading', 'screen'],
    paths: ['M23 11h18v17H23Z', 'M26 24l4.5-6 3.5 4.5 4-5'],
  },
];

// Fallback mark: a plain diamond (deliberately NOT a tier glyph shape — the
// tier diamond is a filled 4-point spark; see locker.js).
const DEFAULT_GLYPH = ['M32 12l9 8-9 8-9-8Z'];

/** Path data for a slot name (keyword match, case-insensitive). */
function slotGlyphPaths(slot) {
  const name = String(slot == null ? '' : slot).toLowerCase();
  for (const glyph of SLOT_GLYPHS) {
    if (glyph.match.some((word) => name.includes(word))) return glyph.paths;
  }
  return DEFAULT_GLYPH;
}

/**
 * Build the deterministic placeholder art node for a pitch: a 16:10 art zone
 * (`.pitch-art`) with a hue wash, a decorative ring, and the slot glyph.
 * Fail-safe: garbage pitches still yield a valid node.
 * @param {{id?: string, item_slot?: string}|null} pitch
 * @returns {HTMLElement}
 */
export function makePitchArt(pitch) {
  const NS = 'http://www.w3.org/2000/svg';
  const hue = artHue(pitch && pitch.id);
  const slot =
    pitch && typeof pitch.item_slot === 'string' && pitch.item_slot
      ? pitch.item_slot
      : 'Skin';

  const wrap = document.createElement('div');
  wrap.className = 'pitch-art';
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', slot + ' concept placeholder art');

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 40');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  // Hue wash over the raised art-zone surface (the wrapper's CSS background).
  const wash = document.createElementNS(NS, 'rect');
  wash.setAttribute('x', '0');
  wash.setAttribute('y', '0');
  wash.setAttribute('width', '64');
  wash.setAttribute('height', '40');
  wash.setAttribute('fill', hue);
  wash.setAttribute('fill-opacity', '0.13');
  svg.appendChild(wash);

  // One quiet decorative ring, offset to the corner for depth.
  const ring = document.createElementNS(NS, 'circle');
  ring.setAttribute('cx', '51');
  ring.setAttribute('cy', '34');
  ring.setAttribute('r', '15');
  ring.setAttribute('fill', 'none');
  ring.setAttribute('stroke', hue);
  ring.setAttribute('stroke-opacity', '0.18');
  ring.setAttribute('stroke-width', '2');
  svg.appendChild(ring);

  // The slot glyph, stroked in the pitch's hue.
  const glyph = document.createElementNS(NS, 'g');
  glyph.setAttribute('fill', 'none');
  glyph.setAttribute('stroke', hue);
  glyph.setAttribute('stroke-width', '2.5');
  glyph.setAttribute('stroke-linecap', 'round');
  glyph.setAttribute('stroke-linejoin', 'round');
  for (const d of slotGlyphPaths(slot)) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    glyph.appendChild(path);
  }
  svg.appendChild(glyph);

  wrap.appendChild(svg);
  return wrap;
}

/**
 * The full art-zone builder the views share: the pitch's real image when it
 * has one (falling back to the placeholder if the URL fails to load, so no
 * broken-image icon ever shows), else the deterministic placeholder art.
 * @param {{id?: string, item_slot?: string, title?: string,
 *          image_url?: string}|null} pitch
 * @returns {HTMLElement}
 */
export function makeArtZone(pitch) {
  const hasImage =
    pitch && typeof pitch.image_url === 'string' && pitch.image_url.trim() !== '';
  if (!hasImage) return makePitchArt(pitch);

  const img = document.createElement('img');
  img.className = 'pitch-card__image';
  img.src = pitch.image_url;
  img.alt =
    pitch && pitch.title ? pitch.title + ' concept art' : 'Skin concept art';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.addEventListener('error', () => {
    try {
      img.replaceWith(makePitchArt(pitch));
    } catch (_err) {
      /* art is decoration; a swap fault leaves the broken image hidden by CSS */
    }
  });
  return img;
}
