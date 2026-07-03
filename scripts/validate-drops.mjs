// scripts/validate-drops.mjs
//
// Mechanical validation of scout-data.js against the drop contract in
// docs/scout-pipeline-tech-spec.md §4. Zero dependencies; runs under plain
// node. The recurring drop-authoring routine MUST run this (and the test
// suite) before opening a drop PR; tests/scout.test.js also imports the
// check functions directly so Drop 001 is validated in CI/test runs.
//
//   node scripts/validate-drops.mjs
//
// Exit 0 on pass, exit 1 with a per-violation report on fail. Everything
// mechanical about the anti-slop recipe lives HERE, so the generator cannot
// "forget" a rule — only voice quality remains judgment, and that is what
// the human PR review is for.

import { SCOUT_DROPS } from '../scout-data.js';
import { SAMPLE_PITCHES } from '../sample-data.js';
// Demo pitches battle in the same Arena whenever the demo profile is active,
// so they belong in the dedupe corpus too. demo.js is safe under plain node:
// its store/profile imports only touch window inside functions.
import { DEMO_PITCHES } from '../demo.js';
// The game's cosmetic vocabulary and per-game lexicon additions come from
// game-config.js — the single game-context source (GAME-ADAPT lives there).
import { ITEM_SLOTS, THEME_TAGS, SCOUT_IDEATION, PITCH_LIMITS } from '../game-config.js';

// --- The mechanical style rules --------------------------------------------

// Case-insensitive substring matches; the recognizable-AI-tell lexicon.
// Curated, append-only, GAME-AGNOSTIC — per-game additions go in
// game-config.js SCOUT_IDEATION.banned_lexicon_extra (merged below), never
// here. Matching is on title + description only (inspiration notes cite
// real references and may legitimately name, say, a "mystical" tradition —
// the pitch copy itself may not).
export const BANNED_LEXICON_BASE = [
  'ethereal',
  'celestial',
  'nexus',
  'arcane',
  'glowing runes',
  'cosmic',
  'mystical',
  'otherworldly',
  'pulsating',
  'pulses with',
  'imbued',
  'infused',
  'unleash',
  'a testament to',
  'tapestry',
  'symphony of',
  'whispers of',
  'essence of',
  'radiant aura',
  'shimmering aura',
  'crackling with energy',
  'forged from pure',
  'swirling vortex',
  'ephemeral',
];

// The effective lexicon: base + the game's own additions (normalized to
// lowercase; malformed config degrades to the base list, never throws).
export const BANNED_LEXICON = BANNED_LEXICON_BASE.concat(
  (SCOUT_IDEATION && Array.isArray(SCOUT_IDEATION.banned_lexicon_extra)
    ? SCOUT_IDEATION.banned_lexicon_extra
    : []
  )
    .filter((phrase) => typeof phrase === 'string' && phrase.trim())
    .map((phrase) => phrase.toLowerCase())
);

// Length caps come from game-config.js PITCH_LIMITS — the same constants the
// wizard renders as input maxlengths, so human and AI text share one cap.
export const TITLE_MAX = PITCH_LIMITS.title_max;
export const DESC_MAX = PITCH_LIMITS.description_max;
export const DESC_MIN = 80; // substance floor: no one-liner slop (anti-slop, not game pref)
export const MAX_SENTENCES = 3;
export const MAX_PER_ACTIVE_DATE = 2; // stagger rule within a drop
export const SIMILARITY_LIMIT = 0.4; // token-Jaccard ceiling vs any other pitch
export const SPARKS_MIN = 3; // every drop carries inspiration sparks
export const SPARKS_MAX = 5;
export const ATLAS_MIN_SEEDS = 40; // the routine needs room to combine

// Drop-shape bounds DERIVE from the configured vocabulary so a game with a
// small slot or tag list still has a satisfiable contract: the tag-spread
// floor is 4 distinct tags (or the whole palette when fewer are configured),
// and the ship count is 3-5 bounded by the slot count (no two pitches in a
// drop may share a slot).
export function tagSpreadFloor(vocab) {
  const tags = vocab && Array.isArray(vocab.tags) ? vocab.tags.length : 0;
  return Math.max(1, Math.min(4, tags));
}

export function shipBounds(vocab) {
  const slots = vocab && Array.isArray(vocab.slots) ? vocab.slots.length : 0;
  return {
    min: Math.max(1, Math.min(3, slots)),
    max: Math.max(1, Math.min(5, slots)),
  };
}

/** Banned-lexicon hits (lowercased substring scan) in a piece of copy. */
export function lexiconHits(text) {
  const hay = String(text == null ? '' : text).toLowerCase();
  return BANNED_LEXICON.filter((phrase) => hay.includes(phrase));
}

/** Sentence count: naive terminal-punctuation split, good enough for caps. */
export function sentenceCount(text) {
  const parts = String(text == null ? '' : text)
    .split(/[.!?]+(?:\s|$)/)
    .filter((part) => part.trim().length > 0);
  return parts.length;
}

/** Normalized word-token set for similarity checks. */
function tokenSet(text) {
  return new Set(
    String(text == null ? '' : text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2)
  );
}

/** Jaccard similarity of the two texts' token sets (0..1). */
export function similarity(textA, textB) {
  const a = tokenSet(textA);
  const b = tokenSet(textB);
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / (a.size + b.size - overlap);
}

// --- Per-pitch and per-drop checks ------------------------------------------

/**
 * Validate one scout pitch record. Returns an array of violation strings
 * (empty = clean). `vocab` carries { slots, tags } — the game-config lists.
 */
export function validatePitch(pitch, vocab) {
  const problems = [];
  const where = pitch && pitch.id ? pitch.id : '(missing id)';
  const push = (msg) => problems.push(`${where}: ${msg}`);

  if (!pitch || typeof pitch !== 'object') return ['(non-object pitch entry)'];

  if (typeof pitch.id !== 'string' || !pitch.id.startsWith('scout-')) {
    push("id must be a string prefixed 'scout-'");
  }
  if (pitch.owner_id !== null) push('owner_id must be null (belongs to no one)');
  if (pitch.origin !== 'scout') push("origin must be 'scout'");
  if (pitch.image_url !== '') push("image_url must be '' (placeholder art only)");
  if (typeof pitch.created_at !== 'string' || Number.isNaN(Date.parse(pitch.created_at))) {
    push('created_at must be a parseable ISO string');
  }
  if (typeof pitch.active_from !== 'string' || Number.isNaN(Date.parse(pitch.active_from))) {
    push('active_from must be a parseable ISO date');
  }

  if (!vocab.slots.includes(pitch.item_slot)) {
    push(`item_slot "${pitch.item_slot}" is not in game-config.js ITEM_SLOTS`);
  }
  const tags = Array.isArray(pitch.theme_tags) ? pitch.theme_tags : [];
  if (tags.length < 1) push('at least one theme tag required');
  for (const tag of tags) {
    if (!vocab.tags.includes(tag)) push(`theme tag "${tag}" is not in game-config.js THEME_TAGS`);
  }

  const title = typeof pitch.title === 'string' ? pitch.title : '';
  const desc = typeof pitch.description === 'string' ? pitch.description : '';
  if (!title.trim()) push('title required');
  if (title.length > TITLE_MAX) push(`title exceeds ${TITLE_MAX} chars`);
  if (desc.length < DESC_MIN) push(`description under the ${DESC_MIN}-char substance floor`);
  if (desc.length > DESC_MAX) push(`description exceeds ${DESC_MAX} chars`);
  if (sentenceCount(desc) > MAX_SENTENCES) push(`description exceeds ${MAX_SENTENCES} sentences`);

  for (const hit of lexiconHits(`${title} ${desc}`)) {
    push(`banned lexicon: "${hit}"`);
  }

  const insp = pitch.inspiration;
  if (!insp || !Array.isArray(insp.sources) || insp.sources.length < 2) {
    push('inspiration.sources must cite at least two seeds');
  }
  if (!insp || typeof insp.note !== 'string' || !insp.note.trim()) {
    push('inspiration.note (one-line rationale) required');
  }

  return problems;
}

/**
 * Validate the seed atlas itself. The atlas is the routine's ONLY source of
 * inspiration AND the routine has append rights to it, so a malformed or
 * off-vocabulary entry committed this week silently breaks NEXT week's run
 * — this check keeps that failure at the gate instead. Returns violations.
 */
export function validateAtlas(atlas, vocab) {
  const problems = [];
  if (!atlas || !Array.isArray(atlas.seeds)) {
    return ['seed-atlas: must be an object with a seeds[] array'];
  }
  if (atlas.seeds.length < ATLAS_MIN_SEEDS) {
    problems.push(
      `seed-atlas: only ${atlas.seeds.length} seeds; keep ${ATLAS_MIN_SEEDS}+ ` +
        'so the routine has room to combine'
    );
  }
  const seen = new Set();
  for (const entry of atlas.seeds) {
    const name = entry && entry.seed;
    if (typeof name !== 'string' || !name.trim()) {
      problems.push('seed-atlas: entry with missing/empty seed name');
      continue;
    }
    const key = name.toLowerCase().trim();
    if (seen.has(key)) problems.push(`seed-atlas: duplicate seed "${name}"`);
    seen.add(key);
    const affinity = entry.affinity || {};
    for (const slot of Array.isArray(affinity.slots) ? affinity.slots : []) {
      if (!vocab.slots.includes(slot)) {
        problems.push(`seed-atlas "${name}": affinity slot "${slot}" is not in game-config.js ITEM_SLOTS`);
      }
    }
    for (const tag of Array.isArray(affinity.tags) ? affinity.tags : []) {
      if (!vocab.tags.includes(tag)) {
        problems.push(`seed-atlas "${name}": affinity tag "${tag}" is not in game-config.js THEME_TAGS`);
      }
    }
  }
  return problems;
}

/** Case-insensitive set of atlas seed names, for citation checks. */
export function atlasSeedSet(atlas) {
  const names = new Set();
  for (const entry of atlas && Array.isArray(atlas.seeds) ? atlas.seeds : []) {
    if (entry && typeof entry.seed === 'string') {
      names.add(entry.seed.toLowerCase().trim());
    }
  }
  return names;
}

/**
 * Validate a whole drop (shape, spread, stagger, ship count) plus each pitch.
 * `priorPitches` is every pitch this drop must not resemble (samples + all
 * other drops' pitches). `seedNames` (optional Set from atlasSeedSet) turns
 * on citation checking: every inspiration source and spark source must name
 * a real atlas seed — the "every concept fuses two atlas seeds" invariant,
 * made mechanical. Returns violation strings.
 */
export function validateDrop(drop, priorPitches, vocab, seedNames) {
  const problems = [];
  const where = drop && drop.drop_id ? drop.drop_id : '(missing drop_id)';
  const push = (msg) => problems.push(`${where}: ${msg}`);

  if (!drop || typeof drop !== 'object') return ['(non-object drop entry)'];
  if (typeof drop.drop_id !== 'string' || !drop.drop_id) push('drop_id required');
  if (typeof drop.generated_at !== 'string' || Number.isNaN(Date.parse(drop.generated_at))) {
    push('generated_at must be a parseable ISO string');
  }
  const stats = drop.stats;
  if (!stats || !Number.isFinite(stats.generated) || !Number.isFinite(stats.shipped)) {
    push('stats.generated / stats.shipped required (the honest cull ratio)');
  }

  const pitches = Array.isArray(drop.pitches) ? drop.pitches : [];
  const ship = shipBounds(vocab);
  if (pitches.length < ship.min || pitches.length > ship.max) {
    push(`ships ${pitches.length} pitches; must ship ${ship.min}-${ship.max}`);
  }
  if (stats && Number.isFinite(stats.shipped) && stats.shipped !== pitches.length) {
    push(`stats.shipped (${stats.shipped}) does not match pitches shipped (${pitches.length})`);
  }
  if (stats && Number.isFinite(stats.generated) && stats.generated < pitches.length * 2) {
    push('stats.generated under 2x shipped — overgenerate and cull, do not pad');
  }

  // Per-pitch field checks.
  for (const pitch of pitches) problems.push(...validatePitch(pitch, vocab));

  // Drop-level spread: no repeated slot, >= tagSpreadFloor distinct tags.
  const slots = pitches.map((p) => p && p.item_slot);
  if (new Set(slots).size !== slots.length) push('two pitches share an item_slot');
  const spreadFloor = tagSpreadFloor(vocab);
  const tagSpread = new Set(pitches.flatMap((p) => (p && Array.isArray(p.theme_tags) ? p.theme_tags : [])));
  if (tagSpread.size < spreadFloor) {
    push(`only ${tagSpread.size} distinct theme tags; needs ${spreadFloor}+`);
  }

  // Stagger: at most MAX_PER_ACTIVE_DATE pitches per active_from date, and
  // nothing activates before the drop was generated (day granularity —
  // activating ON the generation date is the fastest legal start).
  const generatedDate =
    typeof drop.generated_at === 'string' ? drop.generated_at.slice(0, 10) : '';
  const perDate = new Map();
  for (const pitch of pitches) {
    const date = pitch && pitch.active_from;
    if (typeof date !== 'string') continue;
    perDate.set(date, (perDate.get(date) || 0) + 1);
    if (generatedDate && date.slice(0, 10) < generatedDate) {
      push(`${pitch.id}: active_from ${date} predates the drop's generated_at date`);
    }
  }
  for (const [date, count] of perDate) {
    if (count > MAX_PER_ACTIVE_DATE) {
      push(`${count} pitches activate on ${date}; stagger to <= ${MAX_PER_ACTIVE_DATE} per date`);
    }
  }

  // Seed citations (when an atlas seed set is provided): every inspiration
  // source and every spark source must name a REAL atlas seed — "each
  // concept fuses two atlas seeds" is the core anti-slop invariant, so a
  // hallucinated citation is a gate failure, not a style nit.
  function checkSources(sources, where) {
    if (!(seedNames instanceof Set) || seedNames.size === 0) return;
    for (const source of Array.isArray(sources) ? sources : []) {
      const key = String(source == null ? '' : source).toLowerCase().trim();
      if (!seedNames.has(key)) {
        push(`${where}: source "${source}" is not a seed in scripts/seed-atlas.json`);
      }
    }
  }
  for (const pitch of pitches) {
    if (pitch && pitch.inspiration) checkSources(pitch.inspiration.sources, pitch.id);
  }

  // Dedupe: title uniqueness and description similarity vs everything prior
  // AND vs siblings within the drop.
  const others = priorPitches.concat([]);
  for (const pitch of pitches) {
    for (const other of others) {
      if (!pitch || !other) continue;
      const titleA = String(pitch.title || '').toLowerCase().trim();
      const titleB = String(other.title || '').toLowerCase().trim();
      if (titleA && titleA === titleB) {
        push(`${pitch.id}: title duplicates "${other.title}" (${other.id || 'prior pitch'})`);
      }
      const score = similarity(pitch.description, other.description);
      if (score >= SIMILARITY_LIMIT) {
        push(
          `${pitch.id}: description too similar to ${other.id || 'a prior pitch'} ` +
            `(jaccard ${score.toFixed(2)} >= ${SIMILARITY_LIMIT})`
        );
      }
    }
    others.push(pitch); // siblings check each other, each pair once
  }

  // Sparks: count-bounded, well-formed, two REAL seeds, lexicon-clean hooks.
  const sparks = Array.isArray(drop.sparks) ? drop.sparks : [];
  if (sparks.length < SPARKS_MIN || sparks.length > SPARKS_MAX) {
    push(`ships ${sparks.length} sparks; must ship ${SPARKS_MIN}-${SPARKS_MAX}`);
  }
  for (const spark of sparks) {
    const sid = spark && spark.id ? spark.id : '(missing spark id)';
    if (!spark || typeof spark.id !== 'string') push(`${sid}: spark id required`);
    if (!spark || !Array.isArray(spark.sources) || spark.sources.length < 2) {
      push(`${sid}: spark must cite at least two seeds`);
    }
    if (!spark || typeof spark.hook !== 'string' || !spark.hook.trim()) {
      push(`${sid}: spark hook required`);
    }
    if (spark) checkSources(spark.sources, sid);
    for (const hit of lexiconHits(spark && spark.hook)) push(`${sid}: banned lexicon: "${hit}"`);
  }

  return problems;
}

/**
 * Validate the full SCOUT_DROPS export against the samples + each other.
 * `atlas` (optional, parsed seed-atlas.json) turns on atlas structure checks
 * and per-drop seed-citation checks; the CLI always passes it.
 */
export function validateAll(drops, samplePitches, vocab, atlas) {
  const problems = [];
  const list = Array.isArray(drops) ? drops : [];

  let seedNames = null;
  if (atlas !== undefined && atlas !== null) {
    problems.push(...validateAtlas(atlas, vocab));
    seedNames = atlasSeedSet(atlas);
  }

  // Drop ids: unique and 'drop-NNN'-shaped (the routine's increment contract
  // — docs/scout-routine.md STEP 4 — made mechanical).
  const seenDropIds = new Set();
  for (const drop of list) {
    const dropId = drop && drop.drop_id;
    if (typeof dropId !== 'string') continue; // shape error reported per-drop below
    if (seenDropIds.has(dropId)) problems.push(`duplicate drop_id: ${dropId}`);
    seenDropIds.add(dropId);
    if (!/^drop-\d{3,}$/.test(dropId)) {
      problems.push(`drop_id "${dropId}" must match drop-NNN (zero-padded number, e.g. drop-002)`);
    }
  }

  // Global id uniqueness across every drop.
  const seenIds = new Set();
  for (const drop of list) {
    for (const pitch of Array.isArray(drop && drop.pitches) ? drop.pitches : []) {
      const id = pitch && pitch.id;
      if (typeof id !== 'string') continue;
      if (seenIds.has(id)) problems.push(`duplicate pitch id across drops: ${id}`);
      seenIds.add(id);
    }
  }

  // Each drop validates against samples + all OTHER drops' pitches.
  for (const drop of list) {
    const prior = [];
    for (const other of list) {
      if (other === drop) continue;
      prior.push(...(Array.isArray(other.pitches) ? other.pitches : []));
    }
    prior.push(...(Array.isArray(samplePitches) ? samplePitches : []));
    problems.push(...validateDrop(drop, prior, vocab, seedNames));
  }

  return problems;
}

// --- CLI entry ---------------------------------------------------------------

import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

/** Load and parse scripts/seed-atlas.json; a parse failure is a violation. */
export function loadAtlas() {
  const raw = readFileSync(new URL('./seed-atlas.json', import.meta.url), 'utf8');
  return JSON.parse(raw);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const vocab = { slots: ITEM_SLOTS, tags: THEME_TAGS };
  const corpus = SAMPLE_PITCHES.concat(DEMO_PITCHES);
  let atlas = null;
  let problems = [];
  try {
    atlas = loadAtlas();
  } catch (err) {
    problems.push(`seed-atlas: failed to load/parse scripts/seed-atlas.json (${err.message})`);
  }
  problems = problems.concat(validateAll(SCOUT_DROPS, corpus, vocab, atlas));
  if (problems.length === 0) {
    const shipped = SCOUT_DROPS.reduce(
      (sum, drop) => sum + (Array.isArray(drop.pitches) ? drop.pitches.length : 0),
      0
    );
    const seeds = atlas && Array.isArray(atlas.seeds) ? atlas.seeds.length : 0;
    console.log(
      `scout drops OK — ${SCOUT_DROPS.length} drop(s), ${shipped} pitches, ` +
        `${seeds}-seed atlas, 0 violations`
    );
    process.exit(0);
  }
  console.error(`scout drops FAILED — ${problems.length} violation(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
