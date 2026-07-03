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
import {
  ITEM_SLOTS,
  THEME_TAGS,
  SCOUT_IDEATION,
  SCOUT_IMAGES,
  PITCH_LIMITS,
} from '../game-config.js';
// The deterministic seed plan (scripts/seed-plan.mjs): seed ELIGIBILITY is
// recomputable from committed repo state, so the validator re-derives what
// the scaffolder printed and rejects pitches citing ineligible seeds
// (rev 6). Pairing within the eligible set stays a creative choice — see
// the determinism doctrine, docs/scout-pipeline-tech-spec.md §4.0.
import {
  recentSeedNames,
  normalizeSeedName,
  dropNumber,
  RECENCY_WINDOW,
} from './seed-plan.mjs';

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

// Rev 6 ("deterministic pipeline") rules apply to drops GENERATED on/after
// this date. Drops before it are grandfathered — they are append-only and
// can never be edited into compliance, so tightening a rule must never
// retroactively redden the gate. Everything from PLAN_RULES_SINCE on:
//   (a) seed ELIGIBILITY is mechanical (scripts/seed-plan.mjs): no seed
//       cited by pitches in the two most recent drops, no citing a seed
//       the same run just appended to the atlas (added_in stamp),
//   (b) intra-drop seed spread: no seed carries two pitches in one drop,
//   (c) stats.generated must be >= GENERATED_FLOOR_X x shipped (the spec's
//       overgenerate-and-cull ratio; older drops keep the original 2x floor),
//   (d) titles get Jaccard near-duplicate checking, not just exact-match.
export const PLAN_RULES_SINCE = '2026-07-04';
export const GENERATED_FLOOR_X = 4;
export const LEGACY_GENERATED_FLOOR_X = 2;
export const TITLE_SIMILARITY_LIMIT = 0.3; // titles are short; one shared token in three bites

/** True when a drop was generated under the rev-6 strict rules. */
export function underPlanRules(drop) {
  const date = drop && typeof drop.generated_at === 'string' ? drop.generated_at.slice(0, 10) : '';
  return date >= PLAN_RULES_SINCE;
}

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

/**
 * Banned-lexicon hits in a piece of copy. Matching is anchored at a WORD
 * START but open-ended on the right: "unleash" catches "unleashed" and
 * "unleashes" (morphological variants are the point of the lexicon) while
 * "nexus" no longer false-positives inside an unrelated word like
 * "annexus". Case-insensitive; phrases may contain spaces.
 */
const LEXICON_PATTERNS = new Map();
function lexiconPattern(phrase) {
  let pattern = LEXICON_PATTERNS.get(phrase);
  if (!pattern) {
    pattern = new RegExp(`(?<![a-z0-9])${escapeRegExp(phrase)}`);
    LEXICON_PATTERNS.set(phrase, pattern);
  }
  return pattern;
}

export function lexiconHits(text) {
  const hay = String(text == null ? '' : text).toLowerCase();
  return BANNED_LEXICON.filter((phrase) => lexiconPattern(phrase).test(hay));
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

/** Escape a literal string for use inside a RegExp source. */
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Image rules for one pitch, keyed off game-config SCOUT_IMAGES (`images`).
 * Disabled (the default): image_url must be '' — placeholder art only.
 * Enabled: image_url may ALSO be a committed file named
 * `<asset_dir><pitch-id>.<ext>` — one representation, no data-URI variant
 * (rev 6 simplification) — never an external http(s) URL (design lock:
 * zero external assets), and must carry image_gen provenance whose prompt
 * demonstrably came from the template: it cites both inspiration seeds and
 * the item_slot, and stays banned-lexicon-clean.
 */
function imageProblems(pitch, images, push) {
  const cfg = images && typeof images === 'object' ? images : {};
  const url = pitch.image_url;

  if (typeof url !== 'string') {
    push("image_url must be a string ('' or generated concept art)");
    return;
  }
  if (url === '') {
    if (pitch.image_gen !== undefined) {
      push("image_gen present but image_url is '' — drop the stray provenance");
    }
    return;
  }

  if (cfg.enabled !== true) {
    push(
      "image_url must be '' while game-config.js SCOUT_IMAGES.enabled is " +
        'false (placeholder art only)'
    );
    return;
  }
  if (/^(https?:)?\/\//i.test(url)) {
    push('image_url must not be an external URL (design lock: zero external assets)');
  }
  const assetDir = typeof cfg.asset_dir === 'string' && cfg.asset_dir ? cfg.asset_dir : 'assets/scout-art/';
  const fileShape = new RegExp(
    `^${escapeRegExp(assetDir)}${escapeRegExp(String(pitch.id))}\\.(png|jpe?g|webp|svg)$`
  );
  if (!fileShape.test(url)) {
    push(`image_url must be '' or ${assetDir}<pitch-id>.<png|jpg|jpeg|webp|svg>`);
  }

  const gen = pitch.image_gen;
  if (!gen || typeof gen !== 'object') {
    push('image_gen { prompt, generator } provenance required when image_url is set');
    return;
  }
  if (typeof gen.prompt !== 'string' || !gen.prompt.trim()) {
    push('image_gen.prompt (the filled prompt_template) required');
  } else {
    const hay = gen.prompt.toLowerCase();
    const sources =
      pitch.inspiration && Array.isArray(pitch.inspiration.sources)
        ? pitch.inspiration.sources.slice(0, 2)
        : [];
    for (const source of sources) {
      const needle = String(source == null ? '' : source).toLowerCase().trim();
      if (needle && !hay.includes(needle)) {
        push(`image_gen.prompt must cite seed "${source}" (the template fuses both seeds)`);
      }
    }
    if (
      typeof pitch.item_slot === 'string' &&
      !hay.includes(pitch.item_slot.toLowerCase())
    ) {
      push('image_gen.prompt must name the item_slot (the template is per-category)');
    }
    for (const hit of lexiconHits(gen.prompt)) {
      push(`image_gen.prompt banned lexicon: "${hit}"`);
    }
  }
  if (typeof gen.generator !== 'string' || !gen.generator.trim()) {
    push("image_gen.generator must name what produced the image (e.g. 'nanobanana')");
  }
  if (
    gen.generated_at !== undefined &&
    (typeof gen.generated_at !== 'string' || Number.isNaN(Date.parse(gen.generated_at)))
  ) {
    push('image_gen.generated_at, when present, must be a parseable ISO string');
  }
}

/**
 * Validate one scout pitch record. Returns an array of violation strings
 * (empty = clean). `vocab` carries { slots, tags } — the game-config lists.
 * `images` (optional) overrides game-config SCOUT_IMAGES for the image
 * rules; omit it to validate against the shipped config.
 */
export function validatePitch(pitch, vocab, images = SCOUT_IMAGES) {
  const problems = [];
  const where = pitch && pitch.id ? pitch.id : '(missing id)';
  const push = (msg) => problems.push(`${where}: ${msg}`);

  if (!pitch || typeof pitch !== 'object') return ['(non-object pitch entry)'];

  if (typeof pitch.id !== 'string' || !pitch.id.startsWith('scout-')) {
    push("id must be a string prefixed 'scout-'");
  }
  if (pitch.owner_id !== null) push('owner_id must be null (belongs to no one)');
  if (pitch.origin !== 'scout') push("origin must be 'scout'");
  imageProblems(pitch, images, push);
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
    // added_in stamps a seed with the drop whose run appended it (rev 6):
    // the seed-plan excludes such entries from that drop's own proposal
    // menu, so a run can never cite a seed it just invented.
    if (entry.added_in !== undefined && dropNumber(entry.added_in) === null) {
      problems.push(
        `seed-atlas "${name}": added_in must be a 'drop-NNN' id (the drop whose run appended it)`
      );
    }
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
 * made mechanical. `images` (optional) overrides game-config SCOUT_IMAGES
 * for the per-pitch image rules. Returns violation strings.
 */
export function validateDrop(drop, priorPitches, vocab, seedNames, images) {
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
  // Overgeneration floor: the spec's 4x for rev-6 drops; pre-existing drops
  // keep the 2x floor they were validated under (append-only grandfathering).
  const floorX = underPlanRules(drop) ? GENERATED_FLOOR_X : LEGACY_GENERATED_FLOOR_X;
  if (stats && Number.isFinite(stats.generated) && stats.generated < pitches.length * floorX) {
    push(`stats.generated under ${floorX}x shipped — overgenerate and cull, do not pad`);
  }

  // Per-pitch field checks.
  for (const pitch of pitches) problems.push(...validatePitch(pitch, vocab, images));

  // Drop-level spread: no repeated slot, >= tagSpreadFloor distinct tags.
  const slots = pitches.map((p) => p && p.item_slot);
  if (new Set(slots).size !== slots.length) push('two pitches share an item_slot');
  const spreadFloor = tagSpreadFloor(vocab);
  const tagSpread = new Set(pitches.flatMap((p) => (p && Array.isArray(p.theme_tags) ? p.theme_tags : [])));
  if (tagSpread.size < spreadFloor) {
    push(`only ${tagSpread.size} distinct theme tags; needs ${spreadFloor}+`);
  }

  // Seed spread within the drop (rev 6): no seed carries two pitches — a
  // drop of N concepts draws on 2N distinct seeds, so one seed can never
  // dominate a week. Objective, so mechanical; grandfathered like the
  // other plan rules.
  if (underPlanRules(drop)) {
    const seedUse = new Map();
    for (const pitch of pitches) {
      const sources =
        pitch && pitch.inspiration && Array.isArray(pitch.inspiration.sources)
          ? pitch.inspiration.sources
          : [];
      for (const source of sources) {
        const key = normalizeSeedName(source);
        if (!key) continue;
        if (seedUse.has(key)) {
          push(
            `${pitch.id}: seed "${source}" already carries ${seedUse.get(key)} ` +
              'in this drop — each pitch must draw on two seeds no sibling uses'
          );
        } else {
          seedUse.set(key, pitch.id);
        }
      }
    }
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
  // AND vs siblings within the drop. Rev-6 drops additionally get title
  // NEAR-duplicate checking ("Ashwalker Brigade" vs "Ashwalker Company"
  // must not both ship); grandfathered drops keep exact-match only.
  const strictTitles = underPlanRules(drop);
  const others = priorPitches.concat([]);
  for (const pitch of pitches) {
    for (const other of others) {
      if (!pitch || !other) continue;
      const titleA = String(pitch.title || '').toLowerCase().trim();
      const titleB = String(other.title || '').toLowerCase().trim();
      if (titleA && titleA === titleB) {
        push(`${pitch.id}: title duplicates "${other.title}" (${other.id || 'prior pitch'})`);
      } else if (strictTitles && titleA) {
        const titleScore = similarity(titleA, titleB);
        if (titleScore > TITLE_SIMILARITY_LIMIT) {
          push(
            `${pitch.id}: title too similar to "${other.title}" ` +
              `(${other.id || 'prior pitch'}; jaccard ${titleScore.toFixed(2)} > ${TITLE_SIMILARITY_LIMIT})`
          );
        }
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
 * and per-drop seed-citation checks; the CLI always passes it. `images`
 * (optional) overrides game-config SCOUT_IMAGES for the image rules.
 */
export function validateAll(drops, samplePitches, vocab, atlas, images) {
  const problems = [];
  const list = Array.isArray(drops) ? drops : [];

  let seedNames = null;
  if (atlas !== undefined && atlas !== null) {
    problems.push(...validateAtlas(atlas, vocab));
    seedNames = atlasSeedSet(atlas);
  }

  // Drop ids: unique, 'drop-NNN'-shaped, and CONSECUTIVE (the routine's
  // increment contract — the scaffolder computes max+1, and a gap means a
  // run misnumbered its drop).
  const seenDropIds = new Set();
  const numbers = [];
  for (const drop of list) {
    const dropId = drop && drop.drop_id;
    if (typeof dropId !== 'string') continue; // shape error reported per-drop below
    if (seenDropIds.has(dropId)) problems.push(`duplicate drop_id: ${dropId}`);
    seenDropIds.add(dropId);
    if (!/^drop-\d{3,}$/.test(dropId)) {
      problems.push(`drop_id "${dropId}" must match drop-NNN (zero-padded number, e.g. drop-002)`);
    } else {
      numbers.push(dropNumber(dropId));
    }
  }
  if (numbers.length > 0) {
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
    if (max - min + 1 !== numbers.length) {
      problems.push(
        `drop numbering has a gap (${min}..${max} over ${numbers.length} drops) — ` +
          'drop ids must be consecutive; use scripts/next-drop.mjs to number the next drop'
      );
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
    problems.push(...validateDrop(drop, prior, vocab, seedNames, images));
  }

  // SEED ELIGIBILITY (rev 6): for every drop generated under the plan
  // rules, recompute the deterministic eligibility rules the scaffolder
  // printed and reject citations outside them. Two objective rules —
  // pairing WITHIN the eligible set stays the model's creative call:
  //   - recency: no pitch seed that pitches in the two most recent prior
  //     drops already used (fresh combinations every week, mechanical)
  //   - no self-citation: a seed stamped added_in with THIS drop's id was
  //     appended by this same run and is only eligible from the next drop
  // Drops predating PLAN_RULES_SINCE are grandfathered (append-only).
  for (const drop of list) {
    if (!underPlanRules(drop)) continue;
    const number = dropNumber(drop && drop.drop_id);
    if (number === null) continue; // id shape error already reported
    const priorDrops = list.filter((other) => {
      const otherNumber = dropNumber(other && other.drop_id);
      return otherNumber !== null && otherNumber < number;
    });
    const recent = recentSeedNames(priorDrops);
    const selfAdded = new Set();
    if (atlas && Array.isArray(atlas.seeds)) {
      for (const entry of atlas.seeds) {
        if (entry && entry.added_in === drop.drop_id && typeof entry.seed === 'string') {
          selfAdded.add(normalizeSeedName(entry.seed));
        }
      }
    }
    for (const pitch of Array.isArray(drop.pitches) ? drop.pitches : []) {
      const sources =
        pitch && pitch.inspiration && Array.isArray(pitch.inspiration.sources)
          ? pitch.inspiration.sources
          : [];
      for (const source of sources) {
        const key = normalizeSeedName(source);
        if (recent.has(key)) {
          problems.push(
            `${drop.drop_id}: ${pitch.id}: seed "${source}" was already used by a ` +
              `pitch in one of the ${RECENCY_WINDOW} most recent drops — pick from ` +
              'the eligible seeds printed by `node scripts/next-drop.mjs`'
          );
        }
        if (selfAdded.has(key)) {
          problems.push(
            `${drop.drop_id}: ${pitch.id}: seed "${source}" was appended to the ` +
              'atlas by this same drop (added_in) — a run may not cite its own ' +
              'additions; the seed becomes eligible from the next drop'
          );
        }
      }
    }
  }

  return problems;
}

/**
 * Committed-file check for image_url values that point into the asset dir
 * (empty strings skipped; data:/external URLs are already violations
 * upstream and are skipped here to avoid double-reporting): the referenced file must
 * actually exist, or the Arena would render a broken image straight into a
 * blind vote. Kept out of validateAll so the check functions stay pure /
 * fs-free for browser-adjacent test use; the CLI (and gate) always runs it.
 * `exists` is injectable for tests: (repoRelativePath) -> boolean.
 */
export function validateImageAssets(drops, exists) {
  const problems = [];
  for (const drop of Array.isArray(drops) ? drops : []) {
    for (const pitch of Array.isArray(drop && drop.pitches) ? drop.pitches : []) {
      const url = pitch && pitch.image_url;
      if (typeof url !== 'string' || url === '' || /^data:/i.test(url)) continue;
      if (/^(https?:)?\/\//i.test(url)) continue; // already a violation upstream
      if (!exists(url)) {
        problems.push(`${pitch.id}: image_url "${url}" is not a committed file`);
      }
    }
  }
  return problems;
}

// --- CLI entry ---------------------------------------------------------------

import { pathToFileURL } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

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
  problems = problems.concat(
    validateImageAssets(SCOUT_DROPS, (path) =>
      existsSync(new URL(`../${path}`, import.meta.url))
    )
  );
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
