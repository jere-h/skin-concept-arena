// progression.js — Pure, DOM-free progression logic for Skin Concept Arena.
//
// Owns every tuning constant of the competitive layer (tier bands, tier/badge/
// vote points, the career rank ladder, the badge catalogue) plus the pure
// functions the Locker and the Arena chip derive from: own-pitch tier status,
// the peak-tier ratchet helper, calibration priority, badge eligibility,
// career points, and rank lookup. Unit-tested via node:test (the sampler.js /
// ranking.js pattern).
//
// ACCESS SPLIT (see ranking.js): this module is participant-facing. It is
// imported by locker.js (and app.js, to inject) and MUST NOT be imported by
// wizard.js, arena.js, or studio.js — and it never imports ranking.js. The
// ~10-line comparison/win tally inside pitchStatus() below deliberately
// DUPLICATES the tally in ranking.js rather than importing it: pulling the
// Studio-only ranking module into a participant-facing module would breach the
// structural seam the access-split guard test protects. If the Vote shape
// ever changes, update BOTH tallies (ranking.js carries the twin comment).
//
// LEAKAGE CONTRACT: pitchStatus() never returns a numeric win-rate. Its two
// public shapes are exactly { state: 'calibrating', comparisons, threshold }
// and { state: 'tiered', tier } — the rate is computed internally and dropped
// at this boundary, so a rendering bug can't leak a number it never had.
//
// MONOTONICITY (PRD P0-1/P0-2): every careerPoints input is additive — peak
// tiers only ratchet up (maxTier), badge unlocks only accumulate, the vote
// count only grows — so careerPoints/rankFor are non-decreasing over any event
// sequence by construction. No runtime clamping is needed or wanted; a
// property test asserts it.

// Banded win-rate -> tier id, evaluated top-down at comparisons >= threshold.
// rev 2 bands: at the 5-comparison tiering moment the achievable rates are
// k/5, so 0-1/5 -> bronze, 2/5 -> silver, 3/5 -> gold, 4-5/5 -> diamond
// (every calibrated pitch medals).
export const TIER_BANDS = [
  { id: 'diamond', min: 0.75 },
  { id: 'gold', min: 0.6 },
  { id: 'silver', min: 0.4 }, // rev 2: 2/5 wins at first tiering = Silver
  { id: 'bronze', min: 0 }, // every calibrated pitch medals
];

// Ascending tier order for the peak ratchet (maxTier / recordPeaks).
export const TIER_ORDER = ['bronze', 'silver', 'gold', 'diamond'];

// Career points earned by a pitch's PEAK tier (never its live tier).
export const TIER_POINTS = { bronze: 10, silver: 20, gold: 40, diamond: 70 };

// Career points per unlocked badge.
export const BADGE_POINTS = 10;

// rev 2 (P0-2): immediate per-vote reward, so the first session always has a
// self-driven arc even while a pitch calibrates on other people's votes.
export const VOTE_POINT = 1;

// Grind ceiling for vote points, aligned with the Century badge: a voter-only
// profile can reach mid-ladder, the top ranks require pitching success.
export const VOTE_POINTS_CAP = 100;

// Career ladder — cumulative points, ascending. rev 2 names: the metals belong
// to pitches only (P1-4), so the ladder never collides with tier vocabulary.
export const RANK_LADDER = [
  { id: 'recruit', min: 0 },
  { id: 'apprentice', min: 10 },
  { id: 'artisan', min: 40 },
  { id: 'virtuoso', min: 90 },
  { id: 'master', min: 160 },
  { id: 'legend', min: 250 },
];

// The wizard's fixed ITEM_SLOTS list has 7 entries (see wizard.js). The Full
// Loadout badge needs that total without importing a DOM view module, so the
// count is duplicated here on purpose — keep the two in sync.
const FULL_LOADOUT_SLOT_COUNT = 7;

// Distinct-tag floor for Theme Explorer and distinct-vote-day floor for the
// retrospective streak badge (the whole daily-streak system was cut to this
// one badge — see the PRD filter table).
const THEME_EXPLORER_TAGS = 6;
const DEDICATED_VOTE_DAYS = 3;

// --- small defensive helpers -------------------------------------------------

function safeLength(value) {
  return Array.isArray(value) ? value.length : 0;
}

function safeCount(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

// True when any recorded PEAK tier reaches at least `floorTier`. Performance
// badges test peaks, not live tiers, so a live-tier drop can never strand an
// "earned" badge inconsistently (P0-1).
function anyPeakAtLeast(peakTiers, floorTier) {
  const floor = TIER_ORDER.indexOf(floorTier);
  if (!peakTiers || typeof peakTiers !== 'object') return false;
  return Object.values(peakTiers).some(
    (tier) => TIER_ORDER.indexOf(tier) >= floor
  );
}

// --- badge catalogue ----------------------------------------------------------
//
// Descriptors: { id, family, label, blurb, test(ctx) }. Voting COUNT badges
// additionally carry `votes` (their threshold) so nextVotingBadge can derive
// the Arena chip ladder from the catalogue instead of a second constant.
//
// Badge eligibility context (ctx), assembled by the caller from store data:
//   { ownedPitches,      // this profile's pitches (see ownedPitches())
//     statuses,          // pitchStatus() results for those pitches
//     peakTiers,         // { [pitch_id]: tier_id } — recorded PEAKS
//     votesByProfile,    // this profile's own votes (as voter)
//     distinctSlots,     // count of distinct item slots across own pitches
//     distinctTags,      // count of distinct theme tags across own pitches
//     distinctVoteDays } // count of distinct created_at days among own votes
//
// Every test is a pure predicate over ctx — derivable, idempotent,
// order-independent — and every ctx input above is monotone, so an earned
// badge can only stay earned.
export const BADGES = [
  // -- submission: the repeat-submission ladder --------------------------------
  {
    id: 'first-pitch',
    family: 'submission',
    label: 'First Pitch',
    blurb: 'Submit your first concept to the arena.',
    test: (ctx) => safeLength(ctx && ctx.ownedPitches) >= 1,
  },
  {
    id: 'three-pitches',
    family: 'submission',
    label: 'Three Pitches',
    blurb: 'Submit 3 concepts.',
    test: (ctx) => safeLength(ctx && ctx.ownedPitches) >= 3,
  },
  {
    id: 'six-pitches',
    family: 'submission',
    label: 'Six Pitches',
    blurb: 'Submit 6 concepts.',
    test: (ctx) => safeLength(ctx && ctx.ownedPitches) >= 6,
  },
  // -- coverage / collection: diversity the studio actually needs --------------
  {
    id: 'full-loadout',
    family: 'coverage',
    label: 'Full Loadout',
    blurb: 'Pitch a concept for every item slot.',
    test: (ctx) => safeCount(ctx && ctx.distinctSlots) >= FULL_LOADOUT_SLOT_COUNT,
  },
  {
    id: 'theme-explorer',
    family: 'coverage',
    label: 'Theme Explorer',
    blurb: 'Use 6 or more distinct theme tags across your pitches.',
    test: (ctx) => safeCount(ctx && ctx.distinctTags) >= THEME_EXPLORER_TAGS,
  },
  // -- performance: tests PEAK tiers (and calibration), never live tiers -------
  {
    id: 'battle-tested',
    family: 'performance',
    label: 'Battle-Tested',
    blurb: 'Have a pitch finish calibration and earn its first medal.',
    test: (ctx) =>
      Array.isArray(ctx && ctx.statuses) &&
      ctx.statuses.some((status) => status && status.state === 'tiered'),
  },
  {
    id: 'silver-standard',
    family: 'performance',
    label: 'Silver Standard',
    blurb: 'Reach a Silver peak with one of your pitches.',
    test: (ctx) => anyPeakAtLeast(ctx && ctx.peakTiers, 'silver'),
  },
  {
    id: 'gilded',
    family: 'performance',
    label: 'Gilded',
    blurb: 'Reach a Gold peak with one of your pitches.',
    test: (ctx) => anyPeakAtLeast(ctx && ctx.peakTiers, 'gold'),
  },
  {
    id: 'flawless',
    family: 'performance',
    label: 'Flawless',
    blurb: 'Reach a Diamond peak with one of your pitches.',
    test: (ctx) => anyPeakAtLeast(ctx && ctx.peakTiers, 'diamond'),
  },
  // -- voting: the voter's own ladder (count badges carry `votes`) -------------
  {
    id: 'first-verdict',
    family: 'voting',
    votes: 1,
    label: 'First Verdict',
    blurb: 'Cast your first vote.',
    test: (ctx) => safeLength(ctx && ctx.votesByProfile) >= 1,
  },
  {
    id: 'arena-regular',
    family: 'voting',
    votes: 25,
    label: 'Arena Regular',
    blurb: 'Cast 25 votes.',
    test: (ctx) => safeLength(ctx && ctx.votesByProfile) >= 25,
  },
  {
    id: 'century',
    family: 'voting',
    votes: 100,
    label: 'Century',
    blurb: 'Cast 100 votes.',
    test: (ctx) => safeLength(ctx && ctx.votesByProfile) >= 100,
  },
  {
    id: 'dedicated',
    family: 'voting',
    label: 'Dedicated',
    blurb: 'Vote on 3 distinct days.',
    test: (ctx) => safeCount(ctx && ctx.distinctVoteDays) >= DEDICATED_VOTE_DAYS,
  },
];

// --- pitch status --------------------------------------------------------------

// Map an internal win-rate onto a tier id via the top-down bands.
function tierForRate(rate) {
  for (const band of TIER_BANDS) {
    if (rate >= band.min) return band.id;
  }
  // The bronze floor is min 0, so this is unreachable for finite rates; keep a
  // hard floor anyway so a malformed band table can never return undefined.
  return TIER_BANDS[TIER_BANDS.length - 1].id;
}

/**
 * Own-pitch status for the Locker: calibration progress below the threshold,
 * a banded tier at/above it. NEVER returns a numeric win-rate (see the
 * leakage contract in the header).
 *
 * @param {{id: string}} pitch
 * @param {Array<{pitch_a_id:string,pitch_b_id:string,winner_id:string}>} votes
 * @param {number} threshold - comparisons required before a tier appears
 * @returns {{state:'calibrating',comparisons:number,threshold:number}
 *         | {state:'tiered',tier:string}}
 */
export function pitchStatus(pitch, votes, threshold) {
  const id = pitch && typeof pitch.id === 'string' ? pitch.id : null;
  const voteList = Array.isArray(votes) ? votes : [];
  const limit = Number.isFinite(threshold) ? threshold : 0;

  // Twin of the ranking.js tally (see the header note): comparisons where the
  // pitch appears as pitch_a_id / pitch_b_id, wins where it is the winner of a
  // vote it actually took part in.
  let comparisons = 0;
  let wins = 0;
  if (id !== null) {
    for (const vote of voteList) {
      if (!vote) continue;
      if (vote.pitch_a_id !== id && vote.pitch_b_id !== id) continue;
      comparisons += 1;
      if (vote.winner_id === id) wins += 1;
    }
  }

  if (comparisons < limit) {
    return { state: 'calibrating', comparisons, threshold: limit };
  }

  // The rate exists only inside this function; only the band id leaves it.
  const rate = comparisons > 0 ? wins / comparisons : 0;
  return { state: 'tiered', tier: tierForRate(rate) };
}

/**
 * Ratchet helper over TIER_ORDER: the higher of two tier ids. Unknown /
 * missing tiers lose to known ones; two unknowns yield null. Never throws.
 *
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 * @returns {string|null}
 */
export function maxTier(a, b) {
  const ia = TIER_ORDER.indexOf(a);
  const ib = TIER_ORDER.indexOf(b);
  if (ia === -1 && ib === -1) return null;
  return ia >= ib ? a : b;
}

/**
 * True when the pitch sits at the pool's MINIMUM comparison count — the same
 * fewest-votes-first fact the sampler acts on, so "Prioritized for upcoming
 * battles" (P1-3) is a promise the sampler actually keeps.
 *
 * @param {{id: string}} pitch
 * @param {Array<{id: string}>} pitches - the full pool
 * @param {Array<{pitch_a_id:string,pitch_b_id:string}>} votes
 * @returns {boolean}
 */
export function calibrationPriority(pitch, pitches, votes) {
  const id = pitch && typeof pitch.id === 'string' ? pitch.id : null;
  if (id === null) return false;
  const pool = Array.isArray(pitches)
    ? pitches.filter((p) => p && typeof p.id === 'string')
    : [];
  if (pool.length === 0) return false;

  // Comparison counts across the pool (appearances as either contestant).
  const counts = new Map();
  for (const p of pool) counts.set(p.id, 0);
  for (const vote of Array.isArray(votes) ? votes : []) {
    if (!vote) continue;
    if (counts.has(vote.pitch_a_id)) {
      counts.set(vote.pitch_a_id, counts.get(vote.pitch_a_id) + 1);
    }
    if (counts.has(vote.pitch_b_id)) {
      counts.set(vote.pitch_b_id, counts.get(vote.pitch_b_id) + 1);
    }
  }
  if (!counts.has(id)) return false; // pitch not in the pool

  let min = Infinity;
  for (const count of counts.values()) {
    if (count < min) min = count;
  }
  return counts.get(id) === min;
}

/**
 * The pitches belonging to a profile. Sample / pre-add-on pitches carry no
 * owner_id, so they belong to no one and are never listed in a Locker; a null
 * ownerId owns nothing.
 *
 * @param {Array<{owner_id?: string|null}>} pitches
 * @param {string|null} ownerId
 * @returns {Array<object>}
 */
export function ownedPitches(pitches, ownerId) {
  if (typeof ownerId !== 'string' || ownerId === '') return [];
  const list = Array.isArray(pitches) ? pitches : [];
  return list.filter((pitch) => pitch && pitch.owner_id === ownerId);
}

/**
 * Pure badge eligibility: the ids of every badge whose predicate holds for
 * ctx, in catalogue order. Deterministic and idempotent — recomputing on the
 * same ctx yields the same set. A predicate that throws counts as not earned
 * (fail safe), never as a crash.
 *
 * @param {object} ctx - see the BADGES comment for the shape
 * @returns {string[]}
 */
export function earnedBadges(ctx) {
  const context = ctx && typeof ctx === 'object' ? ctx : {};
  const earned = [];
  for (const badge of BADGES) {
    let eligible = false;
    try {
      eligible = badge.test(context) === true;
    } catch (_err) {
      eligible = false;
    }
    if (eligible) earned.push(badge.id);
  }
  return earned;
}

/**
 * Career points from monotonic inputs ONLY: recorded peak tiers (never live
 * tiers), the unlocked-badge count, and capped vote points. Because each
 * input is additive, the result is non-decreasing by construction (P0-1/P0-2).
 *
 * @param {{[pitchId: string]: string}} peakTiers
 * @param {number} unlockedCount
 * @param {number} votesCast
 * @returns {number}
 */
export function careerPoints(peakTiers, unlockedCount, votesCast) {
  let points = 0;

  const peaks =
    peakTiers && typeof peakTiers === 'object' ? Object.values(peakTiers) : [];
  for (const tier of peaks) {
    points += TIER_POINTS[tier] || 0; // unknown tier ids are worth nothing
  }

  const badges = Number.isFinite(unlockedCount)
    ? Math.max(0, Math.floor(unlockedCount))
    : 0;
  points += badges * BADGE_POINTS;

  const votes = Number.isFinite(votesCast)
    ? Math.max(0, Math.floor(votesCast))
    : 0;
  points += Math.min(votes * VOTE_POINT, VOTE_POINTS_CAP);

  return points;
}

/**
 * Rank lookup on the career ladder.
 *
 * @param {number} points
 * @returns {{rank:{id:string,min:number},
 *            next:{id:string,min:number}|null,
 *            progress01:number}}
 *          next is null (and progress01 is 1) at the max rank.
 */
export function rankFor(points) {
  const value = Number.isFinite(points) ? Math.max(0, points) : 0;

  let index = 0;
  for (let i = 0; i < RANK_LADDER.length; i++) {
    if (value >= RANK_LADDER[i].min) index = i;
  }

  const rank = RANK_LADDER[index];
  const next = index + 1 < RANK_LADDER.length ? RANK_LADDER[index + 1] : null;
  const progress01 = next
    ? Math.min(1, Math.max(0, (value - rank.min) / (next.min - rank.min)))
    : 1; // max-rank state at Legend
  return { rank, next, progress01 };
}

/**
 * The next voting COUNT badge for the Arena chip ("18/25 to Arena Regular").
 * Derived from the catalogue's voting badges that carry a `votes` threshold —
 * the retrospective day-streak badge is not a count target and is skipped.
 *
 * @param {number} votesCast
 * @returns {{badge: object, remaining: number}|null}
 *          null once every count badge is earned (the chip shows total votes).
 */
export function nextVotingBadge(votesCast) {
  const cast = Number.isFinite(votesCast) ? Math.max(0, Math.floor(votesCast)) : 0;
  for (const badge of BADGES) {
    if (badge.family !== 'voting' || !Number.isFinite(badge.votes)) continue;
    if (cast < badge.votes) {
      return { badge, remaining: badge.votes - cast };
    }
  }
  return null;
}
