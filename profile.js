// profile.js — device-local identity + additive progression persistence.
//
// Thin layer over store.js's exported defensive readKey/writeKey helpers for
// the two progression keys:
//
//   sca.profile.v1   { id, created_at }                       // device-local identity
//   sca.progress.v1  { unlocked:   { [badge_id]: iso_ts },    // additive-only
//                      peak_tiers: { [pitch_id]: tier_id },   // ratchet-only (P0-1)
//                      last_rank_id: string | null }          // rank-up toast dedup
//
// Everything stored here is an additive, never-revoked fact: badge unlocks
// only accumulate (recordUnlocks unions, never removes), peak tiers only
// ratchet upward (recordPeaks merges via progression.maxTier), and
// last_rank_id exists solely to dedup the rank-up toast. Current tiers, rank,
// and badge eligibility are always recomputed from the store — nothing here
// is a denormalized counter that could drift.
//
// Every read sanitizes shape, so malformed or foreign data degrades to safe
// defaults; every path rides store.js's fail-safe storage (memory-mirror
// fallback when localStorage is unavailable — the profile then becomes
// session-ephemeral, but nothing throws and everything still renders).

import { newId } from './ids.js';
import { readKey, writeKey } from './store.js';
import { maxTier } from './progression.js';

const PROFILE_KEY = 'sca.profile.v1';
const PROGRESS_KEY = 'sca.progress.v1';

// Narrow an untrusted stored value to a plain object (arrays and primitives
// are treated as absent/corrupt).
function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null;
}

/**
 * Load-or-create the device-local creator profile. A usable stored record is
 * returned as-is; anything absent or malformed is replaced by a fresh
 * { id: newId(), created_at } that is persisted before returning.
 *
 * @returns {{id: string, created_at: string}}
 */
export function ensureProfile() {
  const stored = plainObject(readKey(PROFILE_KEY));
  if (stored && typeof stored.id === 'string' && stored.id) {
    return {
      id: stored.id,
      created_at:
        typeof stored.created_at === 'string' ? stored.created_at : '',
    };
  }
  const profile = { id: newId(), created_at: new Date().toISOString() };
  writeKey(PROFILE_KEY, profile);
  return profile;
}

/**
 * Load the progression record, sanitized field by field so a corrupt value
 * can never poison a caller. Absent/malformed -> the empty default.
 *
 * @returns {{unlocked: {[badgeId: string]: string},
 *            peak_tiers: {[pitchId: string]: string},
 *            last_rank_id: string|null}}
 */
export function loadProgress() {
  const stored = plainObject(readKey(PROGRESS_KEY));

  const unlocked = {};
  const unlockedIn = stored ? plainObject(stored.unlocked) : null;
  if (unlockedIn) {
    for (const badgeId of Object.keys(unlockedIn)) {
      if (typeof unlockedIn[badgeId] === 'string') {
        unlocked[badgeId] = unlockedIn[badgeId];
      }
    }
  }

  const peak_tiers = {};
  const peaksIn = stored ? plainObject(stored.peak_tiers) : null;
  if (peaksIn) {
    for (const pitchId of Object.keys(peaksIn)) {
      if (typeof peaksIn[pitchId] === 'string') {
        peak_tiers[pitchId] = peaksIn[pitchId];
      }
    }
  }

  const last_rank_id =
    stored && typeof stored.last_rank_id === 'string' && stored.last_rank_id
      ? stored.last_rank_id
      : null;

  return { unlocked, peak_tiers, last_rank_id };
}

function saveProgress(progress) {
  writeKey(PROGRESS_KEY, progress);
}

/**
 * Union-merge badge unlocks: stamp each genuinely new badge id with now and
 * persist. Already-unlocked ids keep their original timestamps (never
 * restamped, never removed). Returns ONLY the newly-added ids, so the caller
 * can toast each unlock exactly once.
 *
 * @param {string[]} ids - eligible badge ids (e.g. from earnedBadges)
 * @returns {string[]} the ids added by this call
 */
export function recordUnlocks(ids) {
  const progress = loadProgress();
  const added = [];
  const stamp = new Date().toISOString();
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id !== 'string' || !id) continue;
    if (Object.prototype.hasOwnProperty.call(progress.unlocked, id)) continue;
    progress.unlocked[id] = stamp;
    added.push(id);
  }
  if (added.length > 0) saveProgress(progress);
  return added;
}

/**
 * Ratchet-merge peak tiers via progression.maxTier: a recorded peak only ever
 * rises (P0-1). Returns the pitch ids whose peak rose — including a first
 * recording (the first medal IS a new peak) — so the caller can toast each
 * tier-up exactly once; downward or unknown live tiers change nothing.
 *
 * @param {{[pitchId: string]: string}} tiersById - live tiers by pitch id
 * @returns {string[]} the pitch ids whose recorded peak rose
 */
export function recordPeaks(tiersById) {
  const progress = loadProgress();
  const rose = [];
  const incoming = plainObject(tiersById);
  if (incoming) {
    for (const pitchId of Object.keys(incoming)) {
      if (!pitchId) continue;
      const previous = Object.prototype.hasOwnProperty.call(
        progress.peak_tiers,
        pitchId
      )
        ? progress.peak_tiers[pitchId]
        : undefined;
      const merged = maxTier(previous, incoming[pitchId]);
      // maxTier yields null when neither side is a known tier; equality with
      // the previous peak means no upward movement -> record nothing.
      if (typeof merged !== 'string' || merged === previous) continue;
      progress.peak_tiers[pitchId] = merged;
      rose.push(pitchId);
    }
  }
  if (rose.length > 0) saveProgress(progress);
  return rose;
}

/**
 * Record the current rank id for toast dedup. Returns true only when the
 * stored value actually changed (the caller's rank-up toast trigger); careers
 * are monotonic by construction, so a change is always an ascent.
 *
 * @param {string} rankId
 * @returns {boolean}
 */
export function recordRank(rankId) {
  if (typeof rankId !== 'string' || !rankId) return false;
  const progress = loadProgress();
  if (progress.last_rank_id === rankId) return false;
  progress.last_rank_id = rankId;
  saveProgress(progress);
  return true;
}
