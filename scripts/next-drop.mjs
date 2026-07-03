// scripts/next-drop.mjs
//
// The drop SCAFFOLDER: computes every STRUCTURAL value of the next scout
// drop so the authoring routine (docs/scout-routine.md) never invents ids,
// dates, or eligibility — it pairs seeds and writes copy, nothing else.
// One JSON object to stdout:
//
//   node scripts/next-drop.mjs                # scaffold for the next drop
//   node scripts/next-drop.mjs --date=<ISO>   # pin generated_at (repro runs)
//
// Everything printed is computed from committed repo state (plus the
// pinned/current time), and the validator re-derives the same values —
// this is the determinism doctrine's structure layer
// (docs/scout-pipeline-tech-spec.md §4.0):
//   drop_id           max existing drop number + 1 (validator: consecutive)
//   id_prefix         'scout-NNN-' (append a short slug per pitch)
//   generated_at      now (or --date), ISO
//   ship              min/max pitches (derived from the slot vocabulary)
//   candidate_floor   stats.generated must be >= 4x shipped (validated)
//   active_from_schedule  stagger-legal dates, oldest first (<=2 per date,
//                     starting on the generation date, ~2 days apart)
//   created_at_suggestion generated_at + 1 minute per pitch index
//   eligible_seeds    the seeds this drop's pitches MAY cite (atlas minus
//                     recency window minus same-run additions) — the
//                     validator recomputes this set and rejects citations
//                     outside it. PAIRING within it is yours: pick the two
//                     seeds per concept whose fusion actually sparks.
//   excluded_recent_seeds  what recency ruled out, for transparency

import { SCOUT_DROPS } from '../scout-data.js';
import { ITEM_SLOTS, THEME_TAGS, SCOUT_IMAGES } from '../game-config.js';
import { shipBounds, MAX_PER_ACTIVE_DATE, GENERATED_FLOOR_X, loadAtlas } from './validate-drops.mjs';
import { eligibleSeeds, dropNumber } from './seed-plan.mjs';

/** Next 'drop-NNN' id: max existing number + 1 (001 for a fresh game). */
export function nextDropId(drops) {
  let max = 0;
  for (const drop of Array.isArray(drops) ? drops : []) {
    const n = dropNumber(drop && drop.drop_id);
    if (n !== null && n > max) max = n;
  }
  return `drop-${String(max + 1).padStart(3, '0')}`;
}

/**
 * Stagger-legal active_from dates for `count` pitches, oldest first:
 * at most MAX_PER_ACTIVE_DATE per date, first date = the generation date
 * (the fastest legal start), successive dates 2 days apart.
 */
export function activeFromSchedule(generatedAtIso, count, perDate = MAX_PER_ACTIVE_DATE) {
  const base = new Date(generatedAtIso);
  if (Number.isNaN(base.getTime())) return [];
  const dates = [];
  for (let i = 0; i < count; i++) {
    const step = Math.floor(i / Math.max(1, perDate));
    const date = new Date(base.getTime() + step * 2 * 24 * 60 * 60 * 1000);
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

// --- CLI entry ---------------------------------------------------------------

import { pathToFileURL } from 'node:url';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dateArg = process.argv.find((arg) => arg.startsWith('--date='));
  const generatedAt = dateArg
    ? new Date(dateArg.slice('--date='.length)).toISOString()
    : new Date().toISOString();

  const dropId = nextDropId(SCOUT_DROPS);
  const ship = shipBounds({ slots: ITEM_SLOTS, tags: THEME_TAGS });
  const atlas = loadAtlas();
  const plan = eligibleSeeds(dropId, atlas, SCOUT_DROPS);

  const createdAt = [];
  for (let i = 0; i < ship.max; i++) {
    createdAt.push(new Date(Date.parse(generatedAt) + (i + 1) * 60000).toISOString());
  }

  console.log(
    JSON.stringify(
      {
        drop_id: dropId,
        id_prefix: `scout-${dropId.slice('drop-'.length)}-`,
        generated_at: generatedAt,
        ship,
        candidate_floor: `stats.generated must be >= ${GENERATED_FLOOR_X}x shipped`,
        active_from_schedule: activeFromSchedule(generatedAt, ship.max),
        created_at_suggestion: createdAt,
        images: SCOUT_IMAGES.enabled
          ? 'SCOUT_IMAGES.enabled: run scripts/scout-image-prompts.mjs after STEP 4'
          : "images off (SCOUT_IMAGES.enabled: false) — ship image_url '' everywhere",
        eligible_seeds: plan.eligible.map((entry) => ({
          seed: entry.seed,
          domain: entry.domain,
          affinity: entry.affinity,
        })),
        excluded_recent_seeds: plan.excludedRecent,
        note:
          'Cite ONLY eligible_seeds (two per concept; no seed twice in the ' +
          'drop) — the validator recomputes this exact set and rejects ' +
          'anything outside it. WHICH pairs to fuse is your call: pick ' +
          'combinations that spark, per game-config SCOUT_IDEATION. Atlas ' +
          `seeds you append this run must carry added_in: '${dropId}' and ` +
          "cannot be cited by this drop's pitches.",
      },
      null,
      2
    )
  );
}
