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
// Vocabulary drift (slots/tags not in game-config.js) is a WARNING, not a
// failure: the shipped Emberhold samples predate the canonical slot list and
// art.js keyword-matches them fine — but replacement data for a NEW game
// should use the config vocabulary exactly, so the warning names each drift.

import { SAMPLE_PITCHES, SAMPLE_VOTES } from '../sample-data.js';
import { DEMO_PITCHES, DEMO_VOTES, DEMO_PROFILE_ID } from '../demo.js';
import { SCOUT_DROPS } from '../scout-data.js';
import { ITEM_SLOTS, THEME_TAGS } from '../game-config.js';

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
 * Vocabulary drift report (WARNINGS): slots/tags used by a dataset that are
 * not in the configured vocabulary. Tolerated at runtime (art.js falls back,
 * the Arena serves them fine) but replacement data for a new game should
 * match game-config.js exactly.
 */
export function vocabularyWarnings(pitches, vocab, label) {
  const warnings = [];
  for (const pitch of Array.isArray(pitches) ? pitches : []) {
    if (!pitch) continue;
    if (isNonEmptyString(pitch.item_slot) && !vocab.slots.includes(pitch.item_slot)) {
      warnings.push(
        `WARNING(non-fatal): ${label} ${pitch.id}: item_slot "${pitch.item_slot}" ` +
          'is not in game-config.js ITEM_SLOTS (legacy data tolerated; new games should match)'
      );
    }
    for (const tag of Array.isArray(pitch.theme_tags) ? pitch.theme_tags : []) {
      if (!vocab.tags.includes(tag)) {
        warnings.push(
          `WARNING(non-fatal): ${label} ${pitch.id}: theme tag "${tag}" ` +
            'is not in game-config.js THEME_TAGS (legacy data tolerated; new games should match)'
        );
      }
    }
  }
  return warnings;
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

  // Vocabulary drift — warnings only.
  problems.push(...vocabularyWarnings(samples, data.vocab, 'sample'));
  problems.push(...vocabularyWarnings(demos, data.vocab, 'demo'));

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
    drops: SCOUT_DROPS,
    vocab: { slots: ITEM_SLOTS, tags: THEME_TAGS },
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
