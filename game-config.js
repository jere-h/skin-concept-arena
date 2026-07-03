// game-config.js — THE game-context file. Single source of truth for every
// game-specific parameter in Skin Concept Arena.
//
// GAME-ADAPT: this is the FIRST file to edit when repurposing this repo for
// a new game. Every value here is consumed by the app, the tests, the drop
// validator, and the scout-drop routine — change it here and it changes
// everywhere. The full adaptation checklist (including the data files that
// cannot live here, like sample pitches) is docs/adapt-to-a-new-game.md;
// `grep -rn "GAME-ADAPT" --include="*.js" --include="*.json" --include="*.html" --include="*.css" --include="*.md" .`
// lists every site.
//
// Rules for this file:
//   - Pure data. It imports NOTHING and exports only frozen values, so any
//     module (views, pure logic, node scripts, tests) may import it without
//     touching the access-split seams.
//   - After editing, run `node scripts/validate-config.mjs` — it mechanically
//     checks every constraint documented below.

// --- Identity ----------------------------------------------------------------

// GAME-ADAPT: the game this deployment serves. `name` appears in the UI
// masthead chip, the Studio lede, and the onboarding tour; `id` is a stable
// slug (lowercase, no spaces).
export const GAME = Object.freeze({
  id: 'emberhold',
  name: 'Emberhold',
});

// GAME-ADAPT: the Studio gate. A documented client-side constant — a
// convenience gate keeping rank off participant screens, NOT security (it is
// readable in source). Pick something your design team will remember.
export const STUDIO_PASSPHRASE = 'emberhold-studio';

// --- Cosmetic vocabulary -------------------------------------------------------

// GAME-ADAPT: the cosmetic categories players can pitch for. This is THE
// slot list: the Submit wizard's dropdown, the scout-drop validator's
// vocabulary, and the "Full Loadout" coverage badge (which requires one
// pitch per slot — its threshold derives from this array's length) all read
// it from here. Constraints (checked by scripts/validate-config.mjs):
//   - at least 2 entries, all unique, all non-empty strings
//   - the FIRST entry is the wizard's pre-selected default
//   - optional: extend art.js SLOT_GLYPHS with keywords for new slots so
//     placeholder art gets a matching glyph (unknown slots fall back to a
//     neutral diamond — nothing breaks, it is just less charming).
export const ITEM_SLOTS = Object.freeze([
  'Character Skin',
  'Weapon Skin',
  'Headgear',
  'Back Bling / Cape',
  'Emote',
  'Mount',
  'Loading Screen',
]);

// GAME-ADAPT: the tonality palette — how a concept FEELS, deliberately not
// genre labels, so any pitch from any inspiration can be tagged by vibe.
// Constraints: at least 3 entries (4+ recommended: the drop validator's
// per-drop tag-spread requirement is min(4, this length)), unique, non-empty.
// The "Theme Explorer" badge threshold derives from this array's length.
export const THEME_TAGS = Object.freeze([
  'Cute',
  'Badass',
  'Elegant',
  'Creepy',
  'Goofy',
  'Gritty',
  'Dreamy',
]);

// --- Arena / progression tuning ------------------------------------------------

// A pitch needs this many comparisons before its win-rate is treated as
// meaningful: below it, the leaderboard flags "needs more votes" and the
// Locker shows calibration progress instead of a medal. Rarely needs
// changing per game; raise it for high-traffic deployments.
export const COMPARISON_THRESHOLD = 5;

// Length caps for pitch text, enforced identically on humans (the Submit
// wizard's input maxlengths) and on AI scouts (the drop validator) — one
// constant so the two can never drift apart.
export const PITCH_LIMITS = Object.freeze({
  title_max: 80,
  description_max: 600,
});

// --- Scout pipeline tuning -------------------------------------------------------

// Max fraction of a served Arena pool that may be AI-scouted concepts. The
// cap (and the one-scout-per-pair rule) stands down when fewer than two
// human pitches remain, so scouts keep the Arena alive rather than letting
// it empty.
export const SCOUT_POOL_SHARE = 0.4;

// Rolling freshness window: only the newest K scouts stay in Arena rotation;
// older ones are flagged retired (never deleted) at boot. Keep K at or below
// the share cap's real capacity against your seeded human pool:
// floor(humanPitches * SHARE / (1 - SHARE)) — with 6 sample pitches and a
// 0.4 share, that is 4 — so an "active" scout is never share-capped into a
// limbo where it can neither battle nor retire.
export const SCOUT_WINDOW_K = 4;

// --- Scout ideation direction ---------------------------------------------------

// GAME-ADAPT: the creative contract for the scout-drop routine (the
// recurring agent that authors AI concepts — docs/scout-routine.md). The
// routine reads this file on every run, so tightening these strings
// tightens every future drop with no prompt change. This is where a game
// with a NARROW visual direction constrains ideation.
export const SCOUT_IDEATION = Object.freeze({
  // Free text the routine must honor: art style, materials, palette,
  // silhouette rules, rendering constraints, the game's fantasy.
  visual_direction:
    'Emberhold is a grounded dark-fantasy arena game: worn materials, ' +
    'believable craftsmanship, restrained VFX. Concepts should read at ' +
    'gameplay distance by silhouette and material first; one quiet moment ' +
    'of motion or light beats constant spectacle. Nothing glossy, nothing ' +
    'neon, no sci-fi hardware.',

  // Hard exclusions: themes/content that must never ship in a drop, checked
  // by a human at the PR gate and honored by the routine.
  off_limits: Object.freeze([
    'real-world brands or borrowed game IP',
    'firearms (Emberhold is a pre-gunpowder setting)',
    'gore or horror beyond "Creepy"-tag eeriness',
  ]),

  // How to curate scripts/seed-atlas.json for THIS game: which domains to
  // favor, which to prune. Games with a tight visual direction should prune
  // hard and say so here — the atlas is the routine's ONLY seed source, so
  // curating it IS curating the pipeline's imagination.
  seed_guidance:
    'Favor crafts, trades, natural history, and pre-industrial or early-' +
    'industrial domains; treat the aerospace/electronic entries as stretch ' +
    'seeds to pair with a grounded one, never with each other.',

  // Extra banned phrases appended to the drop validator's built-in
  // anti-slop lexicon (scripts/validate-drops.mjs BANNED_LEXICON). Use for
  // per-game cliches ("dragon-forged", a competitor's tagline, etc.).
  banned_lexicon_extra: Object.freeze([]),
});
