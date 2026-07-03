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

/** djb2-style string hash — the one source of per-pitch determinism here. */
function hashOf(id) {
  const key = String(id == null ? '' : id);
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Stable hue for a pitch id: the hash over the fixed hue set. The same id
 * always yields the same hue; a missing id degrades to the first hue rather
 * than throwing.
 * @param {string|null|undefined} id
 * @returns {string} a hex color from ART_HUES
 */
export function artHue(id) {
  return ART_HUES[hashOf(id) % ART_HUES.length];
}

/**
 * The companion hue for the duotone wash: a DIFFERENT entry from the same
 * fixed set, offset 1-3 by higher hash bits so it can never equal the primary
 * (offset < set length) and stays just as deterministic.
 */
function artHue2(id) {
  const hash = hashOf(id);
  const primary = hash % ART_HUES.length;
  const offset = 1 + ((hash >>> 4) % 3);
  return ART_HUES[(primary + offset) % ART_HUES.length];
}

// Item-slot glyphs as stroke path data (viewBox 0 0 64 40, drawn around the
// center). Keys are lowercase KEYWORDS matched per-word against the slot
// name (a keyword matches a whole word or a word's prefix — 'head' matches
// "Headgear" but NOT "Figurehead"), so both the configured slots ("Weapon
// Skin", "Headgear", ...) and the bundled sample slots resolve to a shape;
// anything unrecognized falls back to the diamond mark. Generic suffix words
// like 'skin' are deliberately NOT keywords — "Weapon Skin" must resolve by
// 'weapon', never by its suffix.
//
// GAME-ADAPT (optional): if the new game-config.js ITEM_SLOTS introduces
// categories these keywords don't cover, placeholder art still works —
// unmatched slots wear the neutral diamond — but adding a
// { match: [...keywords], paths: [...] } entry per new category keeps the
// art distinct. Two rules when you do: CHECK WHAT EACH NEW SLOT ACTUALLY
// MATCHES (a false match — the wrong glyph — is worse than the diamond;
// probe with: node -e "import('./art.js').then(a => console.log(a.slotGlyphPaths('Your Slot')))"),
// and keep keywords specific (no generic suffixes). Stroke paths only,
// viewBox 0 0 64 40.
const SLOT_GLYPHS = [
  // figure: head + shoulders (Character Skin / Outfit)
  {
    match: ['character', 'outfit'],
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

/**
 * Path data for a slot name. A keyword hits only when some WORD of the slot
 * name starts with it ('head' → "Headgear" ✓, "Figurehead" ✗; 'weapon' →
 * "Weapon Skin" ✓), which kills the substring false-matches the old
 * `includes` scan allowed. Exported for the glyph-resolution tests.
 */
export function slotGlyphPaths(slot) {
  const words = String(slot == null ? '' : slot)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  for (const glyph of SLOT_GLYPHS) {
    if (glyph.match.some((keyword) => words.some((word) => word.startsWith(keyword)))) {
      return glyph.paths;
    }
  }
  return DEFAULT_GLYPH;
}

// Monotonic counter for per-instance SVG gradient ids (defs ids are
// document-global, so every art node needs its own).
let artInstanceSeq = 0;

/**
 * Build the deterministic placeholder art node for a pitch: a 16:10 art zone
 * (`.pitch-art`) composed like a key-art frame — a duotone gradient wash, a
 * soft radial glow behind the slot glyph, quiet corner rings, and a ground
 * line. Everything derives from the pitch id hash; nothing is random.
 * Fail-safe: garbage pitches still yield a valid node.
 * @param {{id?: string, item_slot?: string}|null} pitch
 * @returns {HTMLElement}
 */
export function makePitchArt(pitch) {
  const NS = 'http://www.w3.org/2000/svg';
  const id = pitch && pitch.id;
  const hue = artHue(id);
  const hue2 = artHue2(id);
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

  // Duotone gradient wash: primary hue lighting the top-left, the companion
  // hue fading through the bottom-right — depth instead of a flat tint.
  const gradId = 'pitch-art-grad-' + ++artInstanceSeq;
  const defs = document.createElementNS(NS, 'defs');
  const grad = document.createElementNS(NS, 'linearGradient');
  grad.setAttribute('id', gradId);
  grad.setAttribute('x1', '0');
  grad.setAttribute('y1', '0');
  grad.setAttribute('x2', '1');
  grad.setAttribute('y2', '1');
  const stops = [
    ['0%', hue, '0.32'],
    ['55%', hue, '0.10'],
    ['100%', hue2, '0.22'],
  ];
  for (const [offset, color, opacity] of stops) {
    const stop = document.createElementNS(NS, 'stop');
    stop.setAttribute('offset', offset);
    stop.setAttribute('stop-color', color);
    stop.setAttribute('stop-opacity', opacity);
    grad.appendChild(stop);
  }
  defs.appendChild(grad);
  svg.appendChild(defs);

  const wash = document.createElementNS(NS, 'rect');
  wash.setAttribute('x', '0');
  wash.setAttribute('y', '0');
  wash.setAttribute('width', '64');
  wash.setAttribute('height', '40');
  wash.setAttribute('fill', 'url(#' + gradId + ')');
  svg.appendChild(wash);

  // Quiet composition rings: the big one offset to the corner (depth), a
  // small echo top-left in the companion hue.
  const ring = document.createElementNS(NS, 'circle');
  ring.setAttribute('cx', '53');
  ring.setAttribute('cy', '35');
  ring.setAttribute('r', '16');
  ring.setAttribute('fill', 'none');
  ring.setAttribute('stroke', hue2);
  ring.setAttribute('stroke-opacity', '0.28');
  ring.setAttribute('stroke-width', '2');
  svg.appendChild(ring);

  const echo = document.createElementNS(NS, 'circle');
  echo.setAttribute('cx', '9');
  echo.setAttribute('cy', '5');
  echo.setAttribute('r', '7');
  echo.setAttribute('fill', 'none');
  echo.setAttribute('stroke', hue);
  echo.setAttribute('stroke-opacity', '0.2');
  echo.setAttribute('stroke-width', '1.5');
  svg.appendChild(echo);

  // Soft two-layer glow disc behind the glyph so the mark sits on a stage
  // instead of floating on the wash.
  for (const [r, opacity] of [
    ['15', '0.10'],
    ['10.5', '0.12'],
  ]) {
    const glow = document.createElementNS(NS, 'circle');
    glow.setAttribute('cx', '32');
    glow.setAttribute('cy', '20');
    glow.setAttribute('r', r);
    glow.setAttribute('fill', hue);
    glow.setAttribute('fill-opacity', opacity);
    svg.appendChild(glow);
  }

  // A grounding baseline under the emblem: anchors the composition.
  const ground = document.createElementNS(NS, 'path');
  ground.setAttribute('d', 'M8 35h48');
  ground.setAttribute('fill', 'none');
  ground.setAttribute('stroke', hue);
  ground.setAttribute('stroke-opacity', '0.22');
  ground.setAttribute('stroke-width', '1.5');
  ground.setAttribute('stroke-linecap', 'round');
  svg.appendChild(ground);

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
