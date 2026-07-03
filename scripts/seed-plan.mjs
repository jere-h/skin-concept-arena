// scripts/seed-plan.mjs
//
// The DETERMINISTIC part of seed selection: which atlas seeds are ELIGIBLE
// for the drop being authored. Both sides of the pipeline run the same
// functions —
//
//   scripts/next-drop.mjs      prints the eligible set for the routine
//   scripts/validate-drops.mjs recomputes it and rejects pitches citing
//                              ineligible seeds
//
// — so eligibility is reproducible bit-for-bit from committed repo state.
// Deliberately NOT here: the pairing itself. Which two eligible seeds fuse
// into a coherent concept is a creative judgment (the model's, then the
// human PR reviewer's); determinizing it (e.g. a seeded random pair menu)
// would trade product quality for process determinism. The determinism
// doctrine lives in docs/scout-pipeline-tech-spec.md §4.0: structure is
// machine-owned and deterministic, creativity is model-owned and bounded,
// taste is human-owned.
//
// Eligibility rules (each objective, each validator-enforced):
//   - recency: seeds cited by PITCHES in the RECENCY_WINDOW most recent
//     prior drops are out (sparks don't burn seeds — they are provocations
//     for humans, not concepts)
//   - no self-citation: atlas entries stamped `added_in: '<this drop id>'`
//     were appended by this same run and become eligible only from the
//     NEXT drop — a run can never cite a seed it just invented
//
// Zero dependencies; pure functions only (no Date, no Math.random).

/** Canonical form for seed-name comparison everywhere in the plan. */
export function normalizeSeedName(name) {
  return String(name == null ? '' : name).toLowerCase().trim();
}

/** How many most-recent prior drops lock their pitch seeds out of reuse. */
export const RECENCY_WINDOW = 2;

/** Numeric part of a 'drop-NNN' id, or null when the id is malformed. */
export function dropNumber(dropId) {
  const match = /^drop-(\d{3,})$/.exec(String(dropId == null ? '' : dropId));
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Normalized seed names cited by PITCHES in the RECENCY_WINDOW most recent
 * drops of `priorDrops` (by drop number).
 */
export function recentSeedNames(priorDrops, windowSize = RECENCY_WINDOW) {
  const sorted = (Array.isArray(priorDrops) ? priorDrops : [])
    .filter((d) => d && dropNumber(d.drop_id) !== null)
    .slice()
    .sort((a, b) => dropNumber(a.drop_id) - dropNumber(b.drop_id));
  const recent = new Set();
  for (const drop of sorted.slice(-Math.max(0, windowSize))) {
    for (const pitch of Array.isArray(drop.pitches) ? drop.pitches : []) {
      const sources =
        pitch && pitch.inspiration && Array.isArray(pitch.inspiration.sources)
          ? pitch.inspiration.sources
          : [];
      for (const source of sources) recent.add(normalizeSeedName(source));
    }
  }
  return recent;
}

/**
 * The eligible seed set for `dropId`: every well-formed atlas entry except
 * duplicates, recently-used seeds, and same-run additions. Returns
 * { eligible, excludedRecent } — `eligible` is the atlas entries the drop's
 * pitches may cite (name-sorted, canonical regardless of atlas array
 * order), `excludedRecent` the normalized names ruled out by recency (for
 * scaffold transparency: the routine sees WHY a seed is off the table).
 *
 * @param {string} dropId       e.g. 'drop-002' — the drop being authored
 * @param {object} atlas        parsed scripts/seed-atlas.json
 * @param {object[]} priorDrops every drop that precedes this one
 * @returns {{ eligible: object[], excludedRecent: string[] }}
 */
export function eligibleSeeds(dropId, atlas, priorDrops) {
  const entries = atlas && Array.isArray(atlas.seeds) ? atlas.seeds : [];
  const recent = recentSeedNames(priorDrops);
  const id = String(dropId == null ? '' : dropId);

  const seen = new Set();
  const eligible = [];
  const excludedRecent = [];
  for (const entry of entries) {
    if (!entry || typeof entry.seed !== 'string' || !entry.seed.trim()) continue;
    const key = normalizeSeedName(entry.seed);
    if (seen.has(key)) continue;
    seen.add(key);
    if (recent.has(key)) {
      excludedRecent.push(key);
      continue;
    }
    if (typeof entry.added_in === 'string' && entry.added_in === id) continue;
    eligible.push(entry);
  }
  const byName = (a, b) => {
    const ka = normalizeSeedName(a.seed);
    const kb = normalizeSeedName(b.seed);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
  eligible.sort(byName);
  excludedRecent.sort();
  return { eligible, excludedRecent };
}
