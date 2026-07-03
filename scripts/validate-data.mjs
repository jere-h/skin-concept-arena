// scripts/validate-data.mjs
//
// Mechanical integrity validation of the BUNDLED data sets — sample-data.js
// and demo.js — the two files an adapting agent REPLACES when repurposing
// the repo for a new game (docs/adapt-to-a-new-game.md Phase 2). The drop
// validator covers scout-data.js; before this file existed, nothing checked
// that replacement samples/demo data were internally consistent, so a broken
// vote (winner not one of the two participants, an orphaned pitch id, a
// duplicated id) shipped silently and surfaced only as weird leaderboard
// math. Zero dependencies; importable check functions + CLI entry:
//
//   node scripts/validate-data.mjs
//
// Exit 0 on pass (warnings allowed), exit 1 with a per-violation report.
// Vocabulary drift (slots/tags not in game-config.js) is FATAL: bundled data
// is the exemplar every agent and every player copies from, so it must
// match the configured vocabulary exactly. (The app itself tolerates stray
// slots at runtime — art.js falls back to a neutral glyph — but tolerated
// at runtime is not the same as acceptable to ship.)

import { SAMPLE_PITCHES, SAMPLE_VOTES } from '../sample-data.js';
import { DEMO_PITCHES, DEMO_VOTES, DEMO_PROFILE_ID, DEMO_PROGRESS } from '../demo.js';
import { SCOUT_DROPS } from '../scout-data.js';
import { ITEM_SLOTS, THEME_TAGS, COMPARISON_THRESHOLD } from '../game-config.js';
// Pure, DOM-free progression logic — used to RECOMPUTE what the hand-written
// demo ledger claims (badges, tiers) and fail the gate on drift.
import { pitchStatus, earnedBadges } from '../progression.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Structural checks for one bundled pitch. `label` names the dataset in
 * messages; `expectOwner` is the exact owner_id the dataset requires
 * (undefined = must be absent or null: the owner-less sample shape).
 */
export function validateBundledPitch(pitch, label, expectOwner) {
  const problems = [];
  const where = `${label} ${pitch && pitch.id ? pitch.id : '(missing id)'}`;
  const push = (msg) => problems.push(`${where}: ${msg}`);

  if (!pitch || typeof pitch !== 'object') return [`${label}: non-object pitch entry`];
  if (!isNonEmptyString(pitch.id)) push('id required');
  if (!isNonEmptyString(pitch.title)) push('title required');
  if (!isNonEmptyString(pitch.description)) push('description required');
  if (!isNonEmptyString(pitch.item_slot)) push('item_slot required');
  if (!Array.isArray(pitch.theme_tags) || pitch.theme_tags.length < 1) {
    push('at least one theme tag required');
  }
  if (typeof pitch.created_at !== 'string' || Number.isNaN(Date.parse(pitch.created_at))) {
    push('created_at must be a parseable ISO string');
  }
  if (expectOwner !== undefined) {
    if (pitch.owner_id !== expectOwner) push(`owner_id must be ${JSON.stringify(expectOwner)}`);
  } else if (pitch.owner_id !== undefined && pitch.owner_id !== null) {
    push('owner_id must be absent or null (bundled samples belong to no one)');
  }
  return problems;
}

/**
 * Integrity checks for one vote list against the set of known pitch ids:
 * distinct participants, both known, winner one of the two, unique vote ids.
 */
export function validateVotes(votes, knownIds, label) {
  const problems = [];
  const seen = new Set();
  for (const vote of Array.isArray(votes) ? votes : []) {
    const where = `${label} ${vote && vote.id ? vote.id : '(missing id)'}`;
    const push = (msg) => problems.push(`${where}: ${msg}`);
    if (!vote || typeof vote !== 'object') {
      problems.push(`${label}: non-object vote entry`);
      continue;
    }
    if (!isNonEmptyString(vote.id)) push('vote id required');
    else if (seen.has(vote.id)) push('duplicate vote id');
    else seen.add(vote.id);
    const { pitch_a_id, pitch_b_id, winner_id } = vote;
    if (pitch_a_id === pitch_b_id) push('a pitch cannot battle itself');
    if (!knownIds.has(pitch_a_id)) push(`pitch_a_id "${pitch_a_id}" is not a bundled pitch`);
    if (!knownIds.has(pitch_b_id)) push(`pitch_b_id "${pitch_b_id}" is not a bundled pitch`);
    if (winner_id !== pitch_a_id && winner_id !== pitch_b_id) {
      push(`winner_id "${winner_id}" is not one of the two participants`);
    }
  }
  return problems;
}

/**
 * Vocabulary drift (FATAL): slots/tags used by a dataset that are not in
 * the configured vocabulary. Bundled data is the exemplar everything else
 * copies from, so it must match game-config.js exactly — this is the check
 * that turns a botched or skipped Phase 2 replacement (adaptation guide,
 * steps 4-5) into a red gate instead of a silent green.
 */
export function vocabularyViolations(pitches, vocab, label) {
  const problems = [];
  for (const pitch of Array.isArray(pitches) ? pitches : []) {
    if (!pitch) continue;
    if (isNonEmptyString(pitch.item_slot) && !vocab.slots.includes(pitch.item_slot)) {
      problems.push(
        `${label} ${pitch.id}: item_slot "${pitch.item_slot}" is not in ` +
          'game-config.js ITEM_SLOTS — bundled data must match the configured vocabulary'
      );
    }
    for (const tag of Array.isArray(pitch.theme_tags) ? pitch.theme_tags : []) {
      if (!vocab.tags.includes(tag)) {
        problems.push(
          `${label} ${pitch.id}: theme tag "${tag}" is not in ` +
            'game-config.js THEME_TAGS — bundled data must match the configured vocabulary'
        );
      }
    }
  }
  return problems;
}

/**
 * Threshold-coupling advisories (WARNINGS): the bundled data is hand-tuned
 * to demonstrate specific states at the configured COMPARISON_THRESHOLD —
 * the sample leaderboard shows both ranked and "needs more votes" rows, and
 * the demo Locker shows a tier spread plus one calibrating pitch. Changing
 * the threshold (or mis-wiring replacement votes) silently collapses those
 * demos; this makes the collapse visible.
 */
export function thresholdWarnings(data, threshold) {
  const warnings = [];
  const samples = Array.isArray(data.samplePitches) ? data.samplePitches : [];
  const demos = Array.isArray(data.demoPitches) ? data.demoPitches : [];
  const sampleVotes = Array.isArray(data.sampleVotes) ? data.sampleVotes : [];
  const demoVotes = Array.isArray(data.demoVotes) ? data.demoVotes : [];

  try {
    const sampleStates = samples.map((p) => pitchStatus(p, sampleVotes, threshold));
    const under = sampleStates.filter((s) => s && s.state === 'calibrating').length;
    const over = sampleStates.filter((s) => s && s.state === 'tiered').length;
    if (under < 1 || over < 1) {
      warnings.push(
        `WARNING(non-fatal): at threshold ${threshold} the sample pool no longer ` +
          `demos both leaderboard states (${over} ranked, ${under} needs-more-votes) — ` +
          'retune sample votes or the threshold'
      );
    }

    // Demo votes battle demo AND sample pitches; tier status counts all of them.
    const allVotes = sampleVotes.concat(demoVotes);
    const demoStates = demos.map((p) => pitchStatus(p, allVotes, threshold));
    const tiers = new Set(
      demoStates.filter((s) => s && s.state === 'tiered').map((s) => s.tier)
    );
    const calibrating = demoStates.filter((s) => s && s.state === 'calibrating').length;
    if (tiers.size < 3 || calibrating < 1) {
      warnings.push(
        `WARNING(non-fatal): at threshold ${threshold} the demo profile no longer ` +
          `shows its promised Locker spread (${tiers.size} distinct tiers, ` +
          `${calibrating} calibrating; wants 3+ tiers and 1+ calibrating) — ` +
          'retune demo votes or the threshold'
      );
    }
  } catch (_err) {
    warnings.push('WARNING(non-fatal): threshold-coupling check failed to run');
  }
  return warnings;
}

/**
 * Demo-ledger consistency (FATAL): recompute badge eligibility and live
 * tiers from the bundled pitches/votes and compare against the hand-written
 * DEMO_PROGRESS ledger. demo.js promises the ledger is "kept exactly
 * consistent" so the demo profile never opens on unearned badges or a
 * post-entry toast storm; an adapting agent rewriting the demo data is the
 * likeliest way that promise silently breaks.
 */
export function demoLedgerViolations(data, threshold) {
  const problems = [];
  const demos = Array.isArray(data.demoPitches) ? data.demoPitches : [];
  const ledger = data.demoProgress;
  if (!ledger || typeof ledger !== 'object') return problems; // nothing claimed
  try {
    const allVotes = (Array.isArray(data.sampleVotes) ? data.sampleVotes : []).concat(
      Array.isArray(data.demoVotes) ? data.demoVotes : []
    );
    const statuses = demos.map((p) => pitchStatus(p, allVotes, threshold));
    const votesByProfile = allVotes.filter(
      (v) => v && v.voter_id === data.demoProfileId
    );
    const ctx = {
      ownedPitches: demos,
      statuses,
      peakTiers: ledger.peak_tiers || {},
      votesByProfile,
      distinctSlots: new Set(demos.map((p) => p && p.item_slot)).size,
      distinctTags: new Set(
        demos.flatMap((p) => (p && Array.isArray(p.theme_tags) ? p.theme_tags : []))
      ).size,
      distinctVoteDays: new Set(
        votesByProfile.map((v) => String(v.created_at || '').slice(0, 10))
      ).size,
    };

    const recomputed = new Set(earnedBadges(ctx));
    const claimed = new Set(Object.keys(ledger.unlocked || {}));
    for (const id of claimed) {
      if (!recomputed.has(id)) {
        problems.push(
          `demo ledger claims badge "${id}" but the bundled data does not earn it`
        );
      }
    }
    for (const id of recomputed) {
      if (!claimed.has(id)) {
        problems.push(
          `demo data earns badge "${id}" but the ledger omits it (the demo would ` +
            'open on a toast storm)'
        );
      }
    }

    // Peaks must exactly match the live tiers computed from the votes.
    const liveTiers = new Map();
    demos.forEach((pitch, index) => {
      const status = statuses[index];
      if (pitch && status && status.state === 'tiered') liveTiers.set(pitch.id, status.tier);
    });
    const peaks = ledger.peak_tiers || {};
    for (const [id, tier] of liveTiers) {
      if (peaks[id] !== tier) {
        problems.push(
          `demo pitch ${id} computes live tier "${tier}" but the ledger records ` +
            `peak "${peaks[id] || '(none)'}" — keep them equal in bundled data`
        );
      }
    }
    for (const id of Object.keys(peaks)) {
      if (!liveTiers.has(id)) {
        problems.push(
          `demo ledger records a peak for "${id}" which is not a tiered demo pitch`
        );
      }
    }
  } catch (err) {
    problems.push(`demo ledger check failed to run: ${err.message}`);
  }
  return problems;
}

/** Validate all bundled data sets together. Returns problem strings. */
export function validateAllData(data) {
  const problems = [];
  const samples = Array.isArray(data.samplePitches) ? data.samplePitches : [];
  const demos = Array.isArray(data.demoPitches) ? data.demoPitches : [];
  const drops = Array.isArray(data.drops) ? data.drops : [];

  for (const pitch of samples) {
    problems.push(...validateBundledPitch(pitch, 'sample', undefined));
  }
  for (const pitch of demos) {
    problems.push(...validateBundledPitch(pitch, 'demo', data.demoProfileId));
  }

  // Id uniqueness across EVERY bundled source that merges into one pool:
  // samples, demo pitches, and all drop pitches.
  const all = samples
    .concat(demos)
    .concat(drops.flatMap((d) => (d && Array.isArray(d.pitches) ? d.pitches : [])));
  const ids = new Set();
  for (const pitch of all) {
    const id = pitch && pitch.id;
    if (!isNonEmptyString(id)) continue;
    if (ids.has(id)) problems.push(`duplicate pitch id across bundled data: ${id}`);
    ids.add(id);
  }

  // Vote wiring: sample votes battle sample pitches; demo votes may involve
  // demo AND sample pitches (the demo profile votes on others' pitches).
  const sampleIds = new Set(samples.map((p) => p && p.id));
  problems.push(...validateVotes(data.sampleVotes, sampleIds, 'sample vote'));
  problems.push(...validateVotes(data.demoVotes, ids, 'demo vote'));

  // Vocabulary drift — fatal (bundled data is the exemplar).
  problems.push(...vocabularyViolations(samples, data.vocab, 'sample'));
  problems.push(...vocabularyViolations(demos, data.vocab, 'demo'));

  // Threshold-coupled demo promises — warnings.
  if (Number.isFinite(data.threshold)) {
    problems.push(...thresholdWarnings(data, data.threshold));
    // Demo ledger honesty — fatal.
    problems.push(...demoLedgerViolations(data, data.threshold));
  }

  return problems;
}

// --- CLI entry ---------------------------------------------------------------

import { pathToFileURL } from 'node:url';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = validateAllData({
    samplePitches: SAMPLE_PITCHES,
    sampleVotes: SAMPLE_VOTES,
    demoPitches: DEMO_PITCHES,
    demoVotes: DEMO_VOTES,
    demoProfileId: DEMO_PROFILE_ID,
    demoProgress: DEMO_PROGRESS,
    drops: SCOUT_DROPS,
    vocab: { slots: ITEM_SLOTS, tags: THEME_TAGS },
    threshold: COMPARISON_THRESHOLD,
  });
  const fatal = problems.filter((p) => !p.startsWith('WARNING'));
  const warnings = problems.filter((p) => p.startsWith('WARNING'));
  for (const warning of warnings) console.warn(`  ! ${warning}`);
  if (fatal.length === 0) {
    console.log(
      `bundled data OK — ${SAMPLE_PITCHES.length} sample pitches / ` +
        `${SAMPLE_VOTES.length} sample votes / ${DEMO_PITCHES.length} demo pitches / ` +
        `${DEMO_VOTES.length} demo votes, 0 violations` +
        (warnings.length ? ` (${warnings.length} vocabulary warnings)` : '')
    );
    process.exit(0);
  }
  console.error(`bundled data FAILED — ${fatal.length} violation(s):`);
  for (const problem of fatal) console.error(`  - ${problem}`);
  process.exit(1);
}
