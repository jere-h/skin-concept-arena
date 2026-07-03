// scripts/validate-config.mjs
//
// Mechanical validation of game-config.js — run this FIRST after adapting
// the repo to a new game (docs/adapt-to-a-new-game.md). Zero dependencies;
// importable check function + CLI entry:
//
//   node scripts/validate-config.mjs
//
// Exit 0 on pass, exit 1 with a per-violation report. Everything asserted
// here is a constraint some other part of the system depends on; the
// messages say which, so a violation tells the adapting agent exactly what
// would have broken.

import {
  GAME,
  STUDIO_PASSPHRASE,
  ITEM_SLOTS,
  THEME_TAGS,
  COMPARISON_THRESHOLD,
  PITCH_LIMITS,
  SCOUT_POOL_SHARE,
  SCOUT_WINDOW_K,
  SCOUT_IDEATION,
} from '../game-config.js';
// Only for the operational capacity warning below (how many scouts the
// share cap can actually serve against the seeded human pool).
import { SAMPLE_PITCHES } from '../sample-data.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function checkVocabList(problems, name, list, min) {
  if (!Array.isArray(list)) {
    problems.push(`${name} must be an array`);
    return;
  }
  if (list.length < min) {
    problems.push(`${name} needs at least ${min} entries (has ${list.length})`);
  }
  if (!list.every(isNonEmptyString)) {
    problems.push(`${name} entries must all be non-empty strings`);
  }
  const lowered = list.map((s) => String(s).toLowerCase().trim());
  if (new Set(lowered).size !== lowered.length) {
    problems.push(`${name} entries must be unique (case-insensitive)`);
  }
}

/**
 * Validate a game-config shape. Returns violation strings (empty = clean).
 * Strings prefixed WARNING( are non-fatal advisories. `context` is optional
 * operational data: { samplePitchCount } enables the scout-capacity check
 * (the rev-3 R5 lesson from docs/scout-pipeline-tech-spec.md, made
 * mechanical: an "active" scout the share cap can never serve is a scout
 * that can neither battle nor retire).
 */
export function validateConfig(config, context = {}) {
  const problems = [];
  const c = config || {};

  // Identity — the UI masthead, Studio lede, and tour copy render these.
  if (!c.GAME || !isNonEmptyString(c.GAME.id) || !isNonEmptyString(c.GAME.name)) {
    problems.push('GAME needs non-empty id and name (rendered in the UI + tour)');
  } else if (!/^[a-z0-9-]+$/.test(c.GAME.id)) {
    problems.push('GAME.id must be a lowercase slug (a-z, 0-9, dashes)');
  }
  if (!isNonEmptyString(c.STUDIO_PASSPHRASE)) {
    problems.push('STUDIO_PASSPHRASE must be a non-empty string (the Studio gate)');
  }

  // Vocabulary — the wizard renders these; the drop validator and the
  // coverage badges derive their thresholds from the lengths.
  checkVocabList(problems, 'ITEM_SLOTS', c.ITEM_SLOTS, 2);
  checkVocabList(problems, 'THEME_TAGS', c.THEME_TAGS, 3);
  if (Array.isArray(c.THEME_TAGS) && c.THEME_TAGS.length === 3) {
    problems.push(
      'WARNING(non-fatal): only 3 THEME_TAGS — 4+ recommended so scout drops ' +
        'can spread across tags (the validator floor is min(4, tag count))'
    );
  }

  // Tuning — the sampler priority, tier bands, and scout metering read these.
  if (!Number.isFinite(c.COMPARISON_THRESHOLD) || c.COMPARISON_THRESHOLD < 1) {
    problems.push('COMPARISON_THRESHOLD must be a number >= 1 (tier calibration)');
  }
  if (
    !Number.isFinite(c.SCOUT_POOL_SHARE) ||
    c.SCOUT_POOL_SHARE <= 0 ||
    c.SCOUT_POOL_SHARE > 0.9
  ) {
    problems.push(
      'SCOUT_POOL_SHARE must be in (0, 0.9] — 0 would disable the pipeline; ' +
        'set it via composeArenaPool semantics, not by zeroing the share'
    );
  }
  if (!Number.isFinite(c.SCOUT_WINDOW_K) || c.SCOUT_WINDOW_K < 1) {
    problems.push('SCOUT_WINDOW_K must be a number >= 1 (rotation window)');
  }
  const limits = c.PITCH_LIMITS || {};
  if (
    !Number.isFinite(limits.title_max) || limits.title_max < 10 ||
    !Number.isFinite(limits.description_max) ||
    limits.description_max <= limits.title_max
  ) {
    problems.push(
      'PITCH_LIMITS needs title_max >= 10 and description_max > title_max ' +
        '(rendered as wizard maxlengths AND enforced on scout drops)'
    );
  }

  // Operational capacity (WARNING): with H seeded human pitches and share S,
  // the Arena serves at most floor(H * S / (1 - S)) scouts at once. A window
  // larger than that parks "active" scouts where they can neither battle nor
  // retire, and the Scout report shows them at 0 comparisons forever.
  const sampleCount = context.samplePitchCount;
  if (
    Number.isFinite(sampleCount) && sampleCount >= 2 &&
    Number.isFinite(c.SCOUT_POOL_SHARE) && c.SCOUT_POOL_SHARE > 0 &&
    c.SCOUT_POOL_SHARE < 1 && Number.isFinite(c.SCOUT_WINDOW_K)
  ) {
    const capacity = Math.max(
      1,
      Math.floor((sampleCount * c.SCOUT_POOL_SHARE) / (1 - c.SCOUT_POOL_SHARE))
    );
    if (c.SCOUT_WINDOW_K > capacity) {
      problems.push(
        `WARNING(non-fatal): SCOUT_WINDOW_K (${c.SCOUT_WINDOW_K}) exceeds the ` +
          `share cap's capacity against the ${sampleCount}-pitch seeded pool ` +
          `(${capacity}) — scouts beyond that stay "active" but are never ` +
          'served until humans submit more pitches'
      );
    }
  }

  // Scout ideation — the drop routine reads all of these; the drop validator
  // merges banned_lexicon_extra into its lexicon.
  const ideation = c.SCOUT_IDEATION || {};
  if (!isNonEmptyString(ideation.visual_direction)) {
    problems.push(
      'SCOUT_IDEATION.visual_direction must be non-empty free text — this is ' +
        'the art-direction contract every scout drop is generated under'
    );
  }
  if (!Array.isArray(ideation.off_limits)) {
    problems.push('SCOUT_IDEATION.off_limits must be an array (may be empty)');
  }
  if (!isNonEmptyString(ideation.seed_guidance)) {
    problems.push(
      'SCOUT_IDEATION.seed_guidance must be non-empty — it tells the routine ' +
        'how to use/curate scripts/seed-atlas.json for this game'
    );
  }
  if (!Array.isArray(ideation.banned_lexicon_extra)) {
    problems.push('SCOUT_IDEATION.banned_lexicon_extra must be an array (may be empty)');
  }

  return problems;
}

// --- CLI entry ---------------------------------------------------------------

import { pathToFileURL } from 'node:url';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = validateConfig(
    {
      GAME,
      STUDIO_PASSPHRASE,
      ITEM_SLOTS,
      THEME_TAGS,
      COMPARISON_THRESHOLD,
      PITCH_LIMITS,
      SCOUT_POOL_SHARE,
      SCOUT_WINDOW_K,
      SCOUT_IDEATION,
    },
    { samplePitchCount: Array.isArray(SAMPLE_PITCHES) ? SAMPLE_PITCHES.length : 0 }
  );
  const fatal = problems.filter((p) => !p.startsWith('WARNING'));
  const warnings = problems.filter((p) => p.startsWith('WARNING'));
  for (const warning of warnings) console.warn(`  ! ${warning}`);
  if (fatal.length === 0) {
    console.log(
      `game-config OK — "${GAME.name}" (${GAME.id}): ${ITEM_SLOTS.length} slots, ` +
        `${THEME_TAGS.length} tags, threshold ${COMPARISON_THRESHOLD}, ` +
        `scout share ${SCOUT_POOL_SHARE}, window ${SCOUT_WINDOW_K}`
    );
    process.exit(0);
  }
  console.error(`game-config FAILED — ${fatal.length} violation(s):`);
  for (const problem of fatal) console.error(`  - ${problem}`);
  process.exit(1);
}
