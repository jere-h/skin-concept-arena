// sampler.js — Pure, DOM-free pairing logic for the Arena view.
//
// Picks the next forced-choice pair of pitches for blind voting. The bias is
// toward pitches that have been compared the fewest times, so coverage stays
// even, and it never re-serves a pair already seen this session. Fully
// deterministic given the same inputs; unit-tested via node:test.

/**
 * Order-independent key for a pair of pitch ids. pairKey(a, b) === pairKey(b, a).
 * @param {string} aId
 * @param {string} bId
 * @returns {string}
 */
export function pairKey(aId, bId) {
  return aId < bId ? `${aId}::${bId}` : `${bId}::${aId}`;
}

/**
 * Count how many comparisons (votes) each pitch has taken part in.
 * A pitch appears in a Vote as either pitch_a_id or pitch_b_id.
 * @param {{id: string}[]} pitches
 * @param {{pitch_a_id: string, pitch_b_id: string}[]} votes
 * @returns {Map<string, number>}
 */
function comparisonCounts(pitches, votes) {
  const counts = new Map();
  for (const p of pitches) counts.set(p.id, 0);
  for (const v of votes || []) {
    if (counts.has(v.pitch_a_id)) counts.set(v.pitch_a_id, counts.get(v.pitch_a_id) + 1);
    if (counts.has(v.pitch_b_id)) counts.set(v.pitch_b_id, counts.get(v.pitch_b_id) + 1);
  }
  return counts;
}

/**
 * Stable comparison-ascending sort: fewest comparisons first, then oldest
 * created_at first as a deterministic tie-break.
 * @param {{id: string, created_at?: string}[]} pitches
 * @param {Map<string, number>} counts
 * @returns {{id: string, created_at?: string}[]}
 */
function sortByComparisons(pitches, counts) {
  return pitches.slice().sort((a, b) => {
    const ca = counts.get(a.id) || 0;
    const cb = counts.get(b.id) || 0;
    if (ca !== cb) return ca - cb;
    const ta = a.created_at || '';
    const tb = b.created_at || '';
    if (ta < tb) return -1;
    if (ta > tb) return 1;
    return 0;
  });
}

/**
 * Choose the next pair of pitches for the Arena.
 *
 * Sorts pitches by comparison count ascending (created_at asc tie-break), takes
 * the lowest-comparison pitch as the first card, then scans the
 * comparison-ascending remainder for the lowest-comparison partner that does not
 * form a pair already present in seenPairs.
 *
 * @param {{id: string, created_at?: string}[]} pitches
 * @param {{pitch_a_id: string, pitch_b_id: string}[]} votes
 * @param {Set<string>} seenPairs  keys produced by pairKey()
 * @returns {{ status: 'ok'|'insufficient'|'exhausted', pair: [object, object]|null }}
 */
export function pickPair(pitches, votes, seenPairs) {
  const list = Array.isArray(pitches) ? pitches : [];
  if (list.length < 2) {
    return { status: 'insufficient', pair: null };
  }

  const seen = seenPairs instanceof Set ? seenPairs : new Set();
  const counts = comparisonCounts(list, votes);
  const ordered = sortByComparisons(list, counts);

  // Try each candidate as the first card in comparison-ascending order; the
  // first card is normally ordered[0], but if it has no unseen partner we fall
  // through to the next-lowest-comparison pitch so a genuinely available pair is
  // still found before declaring the pool exhausted.
  for (let i = 0; i < ordered.length; i++) {
    const first = ordered[i];
    for (let j = 0; j < ordered.length; j++) {
      if (j === i) continue;
      const partner = ordered[j];
      if (!seen.has(pairKey(first.id, partner.id))) {
        return { status: 'ok', pair: [first, partner] };
      }
    }
  }

  // Two or more pitches, but every possible pair has already been seen.
  return { status: 'exhausted', pair: null };
}
