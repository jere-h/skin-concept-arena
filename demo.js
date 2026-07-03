// demo.js — the switchable "demo profile", a simulated creator who has
// already lived the whole loop: four submitted concepts (one Diamond, one
// Gold, one Silver, one still calibrating), a badge case nine deep, votes
// cast on three distinct days, and a Master career rank.
//
// Why it exists: a brand-new visitor's Locker is empty by design (sample
// pitches belong to no one), so the progression surfaces — medals, peak
// chips, badges, the rank meter — are invisible exactly when someone is
// deciding whether the app is interesting. The masthead's demo toggle swaps
// the device onto this pre-populated identity so every surface demonstrates
// itself, then swaps back without losing the visitor's own profile.
//
// Mechanics: entering the demo STASHES the real profile + progress ledger
// under 'sca.demo.stash.v1', installs the demo identity/ledger, and merges
// the demo pitches/votes into the store (append-only, by id, so re-entering
// never duplicates). Exiting restores the stash and strips every demo record
// (pitches owned by the demo id, votes involving them or cast by it) so the
// visitor's arena/studio return to their pre-demo state. Callers reload the
// page after either switch — a full reboot is the one guaranteed-consistent
// way to re-derive all four views on a new identity.
//
// DEMO_PROGRESS is a hand-written ledger kept exactly consistent with the
// demo pitches/votes below (peaks match the live tiers, unlocked matches
// earnedBadges' verdict on this data), so the first celebration pass after
// entering finds nothing new to record — the demo never opens on a stack of
// unearned-feeling toasts.
//
// ACCESS SPLIT: like the participant views, this module never imports
// ranking or progression — the ledger is static data, not a computation.

import { readKey, writeKey, loadPitches, savePitches, loadVotes, saveVotes } from './store.js';

export const DEMO_PROFILE_ID = 'demo-profile-v1';

const PROFILE_KEY = 'sca.profile.v1';
const PROGRESS_KEY = 'sca.progress.v1';
const STASH_KEY = 'sca.demo.stash.v1';

const DEMO_PROFILE = Object.freeze({
  id: DEMO_PROFILE_ID,
  created_at: '2026-06-10T08:00:00.000Z',
});

// Compact inline-SVG thumbnails (same discipline as sample-data.js: neutrals
// + the single ember accent only, no external URLs).
const THUMB_REAPER =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20320%20200'%3E%3Crect%20width='320'%20height='200'%20fill='%2314161a'/%3E%3Ccircle%20cx='160'%20cy='86'%20r='44'%20fill='%23f25c2a'%20opacity='0.9'/%3E%3Ccircle%20cx='144'%20cy='78'%20r='7'%20fill='%2314161a'/%3E%3Ccircle%20cx='176'%20cy='78'%20r='7'%20fill='%2314161a'/%3E%3Cpath%20d='M118%20150%20Q160%20120%20202%20150%20L202%20176%20L118%20176%20Z'%20fill='%23a7adb8'%20opacity='0.5'/%3E%3Cpath%20d='M214%2044%20L236%2028%20L232%2058%20Z'%20fill='%23e8eaed'/%3E%3C/svg%3E";

const THUMB_WALTZ =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20320%20200'%3E%3Crect%20width='320'%20height='200'%20fill='%2314161a'/%3E%3Cpath%20d='M100%20170%20C120%20100%20150%2050%20160%2030%20C170%2050%20200%20100%20220%20170'%20fill='none'%20stroke='%23f25c2a'%20stroke-width='4'/%3E%3Ccircle%20cx='160'%20cy='30'%20r='8'%20fill='%23e8eaed'/%3E%3Cpath%20d='M120%20170%20Q160%20140%20200%20170'%20fill='none'%20stroke='%23a7adb8'%20stroke-width='3'/%3E%3C/svg%3E";

export const DEMO_PITCHES = [
  {
    id: 'demo-bubblegum-reaper',
    owner_id: DEMO_PROFILE_ID,
    item_slot: 'Character Skin',
    theme_tags: ['Cute', 'Creepy'],
    title: 'Bubblegum Reaper',
    description:
      'Death, but adorable: a round-cheeked reaper in soft pastel robes whose scythe blows a slow bubble on idle. The cuteness makes the creepy land harder when the hood tilts.',
    image_url: THUMB_REAPER,
    created_at: '2026-06-11T09:30:00.000Z',
  },
  {
    id: 'demo-widowmakers-waltz',
    owner_id: DEMO_PROFILE_ID,
    item_slot: 'Emote',
    theme_tags: ['Elegant', 'Creepy'],
    title: "Widowmaker's Waltz",
    description:
      'A slow three-step waltz danced with an invisible partner, ending in a bow to the empty air. Graceful, formal, and just unsettling enough that opponents hesitate.',
    image_url: THUMB_WALTZ,
    created_at: '2026-06-12T14:10:00.000Z',
  },
  {
    id: 'demo-sir-quackington',
    owner_id: DEMO_PROFILE_ID,
    item_slot: 'Headgear',
    theme_tags: ['Goofy', 'Cute'],
    title: 'Sir Quackington',
    description:
      'A tiny rubber duck wearing a knight helm, perched dead-center on the head like it earned the spot. It squeaks once on a landed headshot. That is the whole joke, and it works.',
    image_url: '',
    created_at: '2026-06-14T11:45:00.000Z',
  },
  {
    id: 'demo-scrapyard-sovereign',
    owner_id: DEMO_PROFILE_ID,
    item_slot: 'Back Bling / Cape',
    theme_tags: ['Gritty', 'Badass'],
    title: 'Scrapyard Sovereign',
    description:
      'A cape of welded scrap plates and chain link that drags a faint spark trail on sprint. Rust and bare weld seams — royalty that built its own crown.',
    image_url: '',
    created_at: '2026-06-28T16:20:00.000Z',
  },
];

// Battles the demo pitches have fought (against the ownerless sample pool).
// Tuned to land exact tiers at the 5-comparison threshold:
//   Bubblegum Reaper    5 comparisons, 4 wins -> Diamond (0.8)
//   Widowmaker's Waltz  5 comparisons, 3 wins -> Gold    (0.6)
//   Sir Quackington     5 comparisons, 2 wins -> Silver  (0.4)
//   Scrapyard Sovereign 2 comparisons, 1 win  -> calibrating (2/5)
// Plus eight votes CAST BY the demo profile across three distinct days
// (voter_id stamped), which earn First Verdict + Dedicated and 8 vote points.
export const DEMO_VOTES = [
  // Bubblegum Reaper's five battles (4 wins).
  { id: 'demo-vote-01', pitch_a_id: 'demo-bubblegum-reaper', pitch_b_id: 'sample-thornwarden', winner_id: 'demo-bubblegum-reaper', created_at: '2026-06-15T10:00:00.000Z' },
  { id: 'demo-vote-02', pitch_a_id: 'demo-bubblegum-reaper', pitch_b_id: 'sample-tidecaller', winner_id: 'demo-bubblegum-reaper', created_at: '2026-06-15T12:30:00.000Z' },
  { id: 'demo-vote-03', pitch_a_id: 'sample-halcyon', pitch_b_id: 'demo-bubblegum-reaper', winner_id: 'demo-bubblegum-reaper', created_at: '2026-06-16T09:15:00.000Z' },
  { id: 'demo-vote-04', pitch_a_id: 'demo-bubblegum-reaper', pitch_b_id: 'sample-emberforge', winner_id: 'sample-emberforge', created_at: '2026-06-16T17:40:00.000Z' },
  { id: 'demo-vote-05', pitch_a_id: 'sample-nocturne', pitch_b_id: 'demo-bubblegum-reaper', winner_id: 'demo-bubblegum-reaper', created_at: '2026-06-17T08:05:00.000Z' },
  // Widowmaker's Waltz's five battles (3 wins).
  { id: 'demo-vote-06', pitch_a_id: 'demo-widowmakers-waltz', pitch_b_id: 'sample-glasswing', winner_id: 'demo-widowmakers-waltz', created_at: '2026-06-17T13:20:00.000Z' },
  { id: 'demo-vote-07', pitch_a_id: 'demo-widowmakers-waltz', pitch_b_id: 'sample-thornwarden', winner_id: 'sample-thornwarden', created_at: '2026-06-18T10:50:00.000Z' },
  { id: 'demo-vote-08', pitch_a_id: 'sample-tidecaller', pitch_b_id: 'demo-widowmakers-waltz', winner_id: 'demo-widowmakers-waltz', created_at: '2026-06-18T15:35:00.000Z' },
  { id: 'demo-vote-09', pitch_a_id: 'demo-widowmakers-waltz', pitch_b_id: 'sample-halcyon', winner_id: 'demo-widowmakers-waltz', created_at: '2026-06-19T09:10:00.000Z' },
  { id: 'demo-vote-10', pitch_a_id: 'sample-emberforge', pitch_b_id: 'demo-widowmakers-waltz', winner_id: 'sample-emberforge', created_at: '2026-06-19T18:25:00.000Z' },
  // Sir Quackington's five battles (2 wins).
  { id: 'demo-vote-11', pitch_a_id: 'demo-sir-quackington', pitch_b_id: 'sample-nocturne', winner_id: 'demo-sir-quackington', created_at: '2026-06-20T11:00:00.000Z' },
  { id: 'demo-vote-12', pitch_a_id: 'demo-sir-quackington', pitch_b_id: 'sample-thornwarden', winner_id: 'sample-thornwarden', created_at: '2026-06-20T16:45:00.000Z' },
  { id: 'demo-vote-13', pitch_a_id: 'sample-glasswing', pitch_b_id: 'demo-sir-quackington', winner_id: 'demo-sir-quackington', created_at: '2026-06-21T10:30:00.000Z' },
  { id: 'demo-vote-14', pitch_a_id: 'demo-sir-quackington', pitch_b_id: 'sample-tidecaller', winner_id: 'sample-tidecaller', created_at: '2026-06-21T14:15:00.000Z' },
  { id: 'demo-vote-15', pitch_a_id: 'sample-halcyon', pitch_b_id: 'demo-sir-quackington', winner_id: 'sample-halcyon', created_at: '2026-06-22T09:50:00.000Z' },
  // Scrapyard Sovereign is mid-calibration (2 of 5, 1 win).
  { id: 'demo-vote-16', pitch_a_id: 'demo-scrapyard-sovereign', pitch_b_id: 'sample-emberforge', winner_id: 'demo-scrapyard-sovereign', created_at: '2026-06-29T12:00:00.000Z' },
  { id: 'demo-vote-17', pitch_a_id: 'sample-nocturne', pitch_b_id: 'demo-scrapyard-sovereign', winner_id: 'sample-nocturne', created_at: '2026-06-30T10:20:00.000Z' },
  // Votes the demo profile CAST, across three distinct days (Dedicated badge).
  { id: 'demo-cast-01', pitch_a_id: 'sample-thornwarden', pitch_b_id: 'sample-halcyon', winner_id: 'sample-thornwarden', voter_id: DEMO_PROFILE_ID, created_at: '2026-06-24T09:00:00.000Z' },
  { id: 'demo-cast-02', pitch_a_id: 'sample-tidecaller', pitch_b_id: 'sample-glasswing', winner_id: 'sample-tidecaller', voter_id: DEMO_PROFILE_ID, created_at: '2026-06-24T09:02:00.000Z' },
  { id: 'demo-cast-03', pitch_a_id: 'sample-emberforge', pitch_b_id: 'sample-nocturne', winner_id: 'sample-emberforge', voter_id: DEMO_PROFILE_ID, created_at: '2026-06-24T09:04:00.000Z' },
  { id: 'demo-cast-04', pitch_a_id: 'sample-halcyon', pitch_b_id: 'sample-glasswing', winner_id: 'sample-halcyon', voter_id: DEMO_PROFILE_ID, created_at: '2026-06-25T19:30:00.000Z' },
  { id: 'demo-cast-05', pitch_a_id: 'sample-thornwarden', pitch_b_id: 'sample-nocturne', winner_id: 'sample-thornwarden', voter_id: DEMO_PROFILE_ID, created_at: '2026-06-25T19:32:00.000Z' },
  { id: 'demo-cast-06', pitch_a_id: 'sample-tidecaller', pitch_b_id: 'sample-emberforge', winner_id: 'sample-tidecaller', voter_id: DEMO_PROFILE_ID, created_at: '2026-06-26T08:45:00.000Z' },
  { id: 'demo-cast-07', pitch_a_id: 'sample-glasswing', pitch_b_id: 'sample-nocturne', winner_id: 'sample-glasswing', voter_id: DEMO_PROFILE_ID, created_at: '2026-06-26T08:47:00.000Z' },
  { id: 'demo-cast-08', pitch_a_id: 'sample-halcyon', pitch_b_id: 'sample-emberforge', winner_id: 'sample-halcyon', voter_id: DEMO_PROFILE_ID, created_at: '2026-06-26T08:49:00.000Z' },
];

// The ledger, pre-recorded to match the data above EXACTLY (see the header):
// peaks = the three live tiers; unlocked = earnedBadges' verdict — First
// Pitch/Three Pitches (4 pitches), Theme Explorer (6 distinct tags),
// Battle-Tested + Silver Standard + Gilded + Flawless (peaks), First Verdict
// (8 votes cast), Dedicated (3 distinct vote days). Career points: peaks
// 70+40+20 = 130, badges 9x10 = 90, votes 8 -> 228 -> Master (160-249).
const DEMO_PROGRESS = Object.freeze({
  unlocked: {
    'first-pitch': '2026-06-11T09:30:01.000Z',
    'three-pitches': '2026-06-14T11:45:01.000Z',
    'theme-explorer': '2026-06-14T11:45:01.000Z',
    'battle-tested': '2026-06-17T08:05:01.000Z',
    'silver-standard': '2026-06-17T08:05:01.000Z',
    'gilded': '2026-06-17T08:05:01.000Z',
    'flawless': '2026-06-17T08:05:01.000Z',
    'first-verdict': '2026-06-24T09:00:01.000Z',
    'dedicated': '2026-06-26T08:45:01.000Z',
  },
  peak_tiers: {
    'demo-bubblegum-reaper': 'diamond',
    'demo-widowmakers-waltz': 'gold',
    'demo-sir-quackington': 'silver',
  },
  last_rank_id: 'master',
});

/** True when the device is currently on the demo identity. Never throws. */
export function isDemoActive() {
  try {
    const profile = readKey(PROFILE_KEY);
    return !!(profile && typeof profile === 'object' && profile.id === DEMO_PROFILE_ID);
  } catch (_err) {
    return false;
  }
}

/**
 * Switch onto the demo profile: stash the visitor's identity + ledger, install
 * the demo pair, and merge the demo pitches/votes into the store (append-only
 * by id — re-entering after an exit that somehow left records never
 * duplicates). Caller reloads the page afterwards. Never throws.
 */
export function enterDemo() {
  if (isDemoActive()) return;
  try {
    // Stash whatever the visitor had — including "nothing" (null), which on
    // exit simply lets ensureProfile mint a fresh identity again.
    writeKey(STASH_KEY, {
      profile: readKey(PROFILE_KEY),
      progress: readKey(PROGRESS_KEY),
    });
    writeKey(PROFILE_KEY, DEMO_PROFILE);
    writeKey(PROGRESS_KEY, DEMO_PROGRESS);

    const pitches = loadPitches();
    const pitchIds = new Set(pitches.map((p) => p && p.id));
    for (const pitch of DEMO_PITCHES) {
      if (!pitchIds.has(pitch.id)) pitches.push({ ...pitch });
    }
    savePitches(pitches);

    const votes = loadVotes();
    const voteIds = new Set(votes.map((v) => v && v.id));
    for (const vote of DEMO_VOTES) {
      if (!voteIds.has(vote.id)) votes.push({ ...vote });
    }
    saveVotes(votes);
  } catch (err) {
    console.warn('Demo switch failed; staying on the current profile.', err);
  }
}

/**
 * Leave the demo: restore the stashed identity + ledger and strip every demo
 * record from the store — pitches owned by the demo id, and votes that involve
 * a demo pitch or were cast by the demo profile — so the visitor's arena and
 * studio return to their pre-demo state. Caller reloads afterwards.
 */
export function exitDemo() {
  if (!isDemoActive()) return;
  try {
    const stash = readKey(STASH_KEY);
    const stashed = stash && typeof stash === 'object' ? stash : {};
    writeKey(PROFILE_KEY, stashed.profile || null);
    writeKey(PROGRESS_KEY, stashed.progress || null);
    writeKey(STASH_KEY, null);

    const demoPitchIds = new Set(DEMO_PITCHES.map((p) => p.id));
    const pitches = loadPitches().filter(
      (p) => p && p.owner_id !== DEMO_PROFILE_ID && !demoPitchIds.has(p.id)
    );
    savePitches(pitches);

    const votes = loadVotes().filter(
      (v) =>
        v &&
        v.voter_id !== DEMO_PROFILE_ID &&
        !demoPitchIds.has(v.pitch_a_id) &&
        !demoPitchIds.has(v.pitch_b_id)
    );
    saveVotes(votes);
  } catch (err) {
    console.warn('Demo exit failed; reload to retry.', err);
  }
}
