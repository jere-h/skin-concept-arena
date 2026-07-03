// locker.js — Locker view controller (the creator hub).
//
// Renders three blocks into #view-locker (the studio.js controller shape:
// init(rootEl, deps) with everything injected):
//
//   1. Career-rank stat tile: current rank name, points, and a progress meter
//      to the next rung (or the max-rank state at Legend).
//   2. My pitches: every pitch OWNED by this profile, newest first, with
//      either a calibration meter ("3/5 battles fought", plus the
//      "Prioritized for upcoming battles" marker while the pitch sits at the
//      pool-minimum comparison count, P1-3) or its tier medal chip — and a
//      "Peak" chip alongside whenever the recorded peak exceeds the live tier
//      (P0-1). With no owned pitches, an empty state teaches the loop
//      (Submit -> Battle -> Medal -> Rank) and states the blindness rule.
//   3. Badge case: the full catalogue; unlocked badges show their unlock
//      date, locked ones show their condition text as the to-do list.
//
// ACCESS SPLIT (finding 6, extended): this is a participant-facing view. It
// receives store/progression/profile by dependency injection; its ONLY import
// is art.js, the pure presentational placeholder-art helper shared with the
// Arena (no data access), so it structurally cannot reach the Studio-only
// ranking module (the extended guard test scans this file's import
// specifiers).
// Everything rendered here is own-work-only and banded: tier chips, peak
// chips, and comparison counts — never a numeric win-rate, which
// progression.pitchStatus cannot even return (its leakage contract).
//
// All display state is a call-time recompute over the store (same as the
// other views). The stored ledger (peak tiers, badge unlocks, last rank) is
// READ via profile.loadProgress() when rendering and only ever WRITTEN by
// checkCelebrations(), the derive -> ratchet -> union -> record pass.

import { makeArtZone } from './art.js';

// The one live Locker instance on this page. initLocker captures the root +
// deps here so refreshLocker()/checkCelebrations() can run from app.js (tab
// switches, post-submit/post-vote hooks) without re-threading dependencies.
let active = null;

/**
 * Initialise the Locker view and paint it once.
 * @param {HTMLElement} rootEl - the section#view-locker container.
 * @param {{ store: object, progression: object, profile: object,
 *           profileId?: string|null, threshold?: number }} deps
 *   store       — persistence (loadPitches/loadVotes)
 *   progression — pure tier/badge/rank logic (participant-facing module)
 *   profile     — the additive ledger (loadProgress/recordPeaks/…)
 *   profileId   — device-local identity; null renders the empty/zero state
 *   threshold   — comparisons before a tier appears (COMPARISON_THRESHOLD)
 */
export function initLocker(rootEl, deps) {
  if (!rootEl || !deps) return;
  const store = deps.store;
  const progression = deps.progression;
  const profile = deps.profile;
  if (!store || typeof store.loadPitches !== 'function') return;
  if (!progression || typeof progression.pitchStatus !== 'function') return;
  if (!profile || typeof profile.loadProgress !== 'function') return;

  const profileId =
    typeof deps.profileId === 'string' && deps.profileId ? deps.profileId : null;
  const threshold = Number.isFinite(deps.threshold) ? deps.threshold : 5;

  active = { rootEl, store, progression, profile, profileId, threshold };
  refreshLocker();
}

/**
 * Re-render the Locker from the current store + ledger. Safe to call at any
 * time (app.js calls it on every switch to the Locker tab); a no-op before
 * initLocker, and a render fault never propagates — the Locker is a read-only
 * surface and must never take the app down.
 */
export function refreshLocker() {
  if (!active) return;
  try {
    render(active);
  } catch (err) {
    console.warn('Locker render failed; keeping the previous paint.', err);
  }
}

/**
 * The celebration pass (TRD): derive live statuses -> ratchet the peak ledger
 * (recordPeaks; only upward transitions return) -> badge eligibility ->
 * union-merge unlocks (recordUnlocks; only new ids return) -> careerPoints/
 * rankFor -> recordRank (true only on a change, and careers are monotonic by
 * construction, so a change is always an ascent). Returns the
 * celebration-worthy events, each exactly once, in toast order:
 *   { type: 'peak',  pitchId, tier }
 *   { type: 'badge', badgeId }
 *   { type: 'rank',  rankId }
 *
 * app.js consumes the events: it invokes this pass after every pitch submit
 * and every vote (via the onPitchSubmitted/onVoteCast hooks it hands the
 * wizard and arena) and feeds the result to its queued toast renderer —
 * strictly one toast at a time, FIFO, so simultaneous unlocks (e.g. a first
 * badge + a rank-up on the first submit) never stack or bury each other.
 */
export function checkCelebrations() {
  if (!active) return [];
  const events = [];
  try {
    const { store, progression, profile, profileId, threshold } = active;
    const pitches = safeArray(store.loadPitches());
    const votes = safeArray(
      typeof store.loadVotes === 'function' ? store.loadVotes() : []
    );
    const owned = progression.ownedPitches(pitches, profileId);
    const statuses = owned.map((pitch) =>
      progression.pitchStatus(pitch, votes, threshold)
    );

    // 1. Live tiers -> the peak ratchet. recordPeaks returns exactly the
    //    pitch ids whose recorded peak ROSE (a first medal included), so each
    //    tier-up celebrates once and a live-tier drop celebrates never.
    const liveTiers = {};
    owned.forEach((pitch, i) => {
      const status = statuses[i];
      if (status && status.state === 'tiered') liveTiers[pitch.id] = status.tier;
    });
    const rose = profile.recordPeaks(liveTiers);
    const peaks = profile.loadProgress().peak_tiers;
    for (const pitchId of rose) {
      events.push({ type: 'peak', pitchId, tier: peaks[pitchId] });
    }

    // 2. Badge eligibility -> the unlock union. Only genuinely new ids come
    //    back (toast-once guarantee lives in recordUnlocks).
    const ctx = badgeContext(profileId, owned, statuses, peaks, votes);
    for (const badgeId of profile.recordUnlocks(progression.earnedBadges(ctx))) {
      events.push({ type: 'badge', badgeId });
    }

    // 3. Points -> rank. Recompute AFTER the ledger writes above so a badge
    //    unlocked this pass counts toward the rank it may tip over.
    const progress = profile.loadProgress();
    const points = progression.careerPoints(
      progress.peak_tiers,
      Object.keys(progress.unlocked).length,
      countVotesCast(votes, profileId)
    );
    const ladder = progression.rankFor(points);
    if (ladder && ladder.rank && profile.recordRank(ladder.rank.id)) {
      events.push({ type: 'rank', rankId: ladder.rank.id });
    }
  } catch (err) {
    // Celebration is decoration: a fault here must never block a submit/vote.
    console.warn('Celebration pass failed; skipping.', err);
  }
  refreshLocker();
  return events;
}

// --- rendering ---------------------------------------------------------------

function render(view) {
  const { rootEl, store, progression, profile, profileId, threshold } = view;
  const rankEl = rootEl.querySelector('#locker-rank');
  const pitchesEl = rootEl.querySelector('#locker-pitches');
  const badgesEl = rootEl.querySelector('#locker-badges');
  if (!rankEl && !pitchesEl && !badgesEl) return;

  const pitches = safeArray(store.loadPitches());
  const votes = safeArray(
    typeof store.loadVotes === 'function' ? store.loadVotes() : []
  );
  // The additive ledger; profile.loadProgress already sanitizes, but guard the
  // shape anyway so a partial stub can never break the paint.
  let progress = { unlocked: {}, peak_tiers: {}, last_rank_id: null };
  try {
    progress = profile.loadProgress() || progress;
  } catch (_err) {
    /* keep the empty default */
  }
  const unlocked =
    progress.unlocked && typeof progress.unlocked === 'object'
      ? progress.unlocked
      : {};
  const peakTiers =
    progress.peak_tiers && typeof progress.peak_tiers === 'object'
      ? progress.peak_tiers
      : {};

  const owned = progression
    .ownedPitches(pitches, profileId)
    .slice()
    .sort(byNewestFirst);
  const statuses = owned.map((pitch) =>
    progression.pitchStatus(pitch, votes, threshold)
  );

  // Career points from monotonic inputs only: recorded peaks, recorded
  // unlocks, and votes cast (progression caps the vote contribution).
  const points = progression.careerPoints(
    peakTiers,
    Object.keys(unlocked).length,
    countVotesCast(votes, profileId)
  );
  const ladder = progression.rankFor(points);

  if (rankEl) renderRankTile(rankEl, ladder, points);
  if (pitchesEl) {
    renderPitches(pitchesEl, view, owned, statuses, peakTiers, pitches, votes);
  }
  if (badgesEl) renderBadgeCase(badgesEl, progression.BADGES, unlocked);
}

/** Block 1 — the career-rank stat tile. */
function renderRankTile(el, ladder, points) {
  el.replaceChildren();

  const eyebrow = document.createElement('p');
  eyebrow.className = 'locker-eyebrow';
  eyebrow.textContent = 'Career rank';
  el.appendChild(eyebrow);

  const name = document.createElement('h2');
  name.className = 'locker-rank__name';
  name.textContent = titleCase(
    ladder && ladder.rank && ladder.rank.id ? ladder.rank.id : 'recruit'
  );
  el.appendChild(name);

  const detail = document.createElement('p');
  detail.className = 'locker-rank__detail';
  const pts = Number.isFinite(points) ? points : 0;
  const ptsLabel = pts + (pts === 1 ? ' point' : ' points');
  detail.textContent =
    ladder && ladder.next
      ? ptsLabel + ' · next rank at ' + ladder.next.min
      : ptsLabel + ' · top of the ladder'; // max-rank state at Legend
  el.appendChild(detail);

  const meter = document.createElement('progress');
  meter.className = 'meter locker-meter';
  meter.max = 1;
  meter.value =
    ladder && Number.isFinite(ladder.progress01)
      ? Math.min(1, Math.max(0, ladder.progress01))
      : 0;
  meter.setAttribute('aria-label', 'Progress to the next rank');
  el.appendChild(meter);
}

/** Block 2 — the owned-pitch list (or the loop-teaching empty state). */
function renderPitches(el, view, owned, statuses, peakTiers, pool, votes) {
  el.replaceChildren();

  const heading = document.createElement('h2');
  heading.className = 'locker-block__title';
  heading.textContent = 'My pitches';
  el.appendChild(heading);

  if (owned.length === 0) {
    el.appendChild(makeEmptyState());
    return;
  }

  // Expectation-setting for stalled calibration meters (P1-3): progress is
  // driven by other people's votes, and that is working as designed.
  const note = document.createElement('p');
  note.className = 'locker-note';
  note.textContent = 'Battles happen as the community votes.';
  el.appendChild(note);

  const list = document.createElement('ul');
  list.className = 'locker-pitchlist';
  owned.forEach((pitch, i) => {
    list.appendChild(
      makePitchRow(view, pitch, statuses[i], peakTiers, pool, votes)
    );
  });
  el.appendChild(list);
}

/** One owned-pitch row: art + identity on the left, tier/calibration right. */
function makePitchRow(view, pitch, status, peakTiers, pool, votes) {
  const li = document.createElement('li');
  li.className = 'locker-pitch';

  const head = document.createElement('div');
  head.className = 'locker-pitch__head';

  // The pitch-card anatomy at row scale: the same deterministic art the Arena
  // shows (art.js), as a small thumb. Decoration only — an art fault must
  // never block the row.
  const art = document.createElement('div');
  art.className = 'locker-pitch__art';
  try {
    art.appendChild(makeArtZone(pitch));
    head.appendChild(art);
  } catch (_err) {
    /* row renders without a thumb */
  }

  const main = document.createElement('div');
  main.className = 'locker-pitch__main';

  const slot = document.createElement('p');
  slot.className = 'pitch-card__slot';
  slot.textContent = pitch.item_slot || 'Skin';
  main.appendChild(slot);

  const title = document.createElement('h3');
  title.className = 'locker-pitch__title';
  title.textContent = pitch.title || 'Untitled concept';
  main.appendChild(title);

  const tags = Array.isArray(pitch.theme_tags) ? pitch.theme_tags : [];
  if (tags.length) {
    const tagWrap = document.createElement('ul');
    tagWrap.className = 'pitch-card__tags';
    for (const tag of tags) {
      const item = document.createElement('li');
      item.className = 'pitch-card__tag';
      item.textContent = tag;
      tagWrap.appendChild(item);
    }
    main.appendChild(tagWrap);
  }
  head.appendChild(main);
  li.appendChild(head);

  const side = document.createElement('div');
  side.className = 'locker-pitch__status';
  if (status && status.state === 'tiered') {
    side.appendChild(makeMedalChip(status.tier));
    // The recorded peak rides alongside only when it EXCEEDS the live tier —
    // one pitch's story ("Silver, peaked at Gold"), never two scores.
    const peak =
      typeof peakTiers[pitch.id] === 'string' ? peakTiers[pitch.id] : null;
    if (
      peak &&
      peak !== status.tier &&
      view.progression.maxTier(peak, status.tier) === peak
    ) {
      side.appendChild(makePeakChip(peak));
    }
  } else if (status) {
    side.appendChild(makeCalibration(view, status, pitch, pool, votes));
  }
  li.appendChild(side);

  return li;
}

// Per-tier glyph shapes (inline SVG path data, viewBox 0 0 12 12): a shield
// for bronze, a diamond for silver, a star for gold, a 4-point spark for
// diamond. Tier identity is NEVER color-alone (design acceptance check 2):
// every chip pairs its tier color with one of these shapes AND a text label.
const TIER_GLYPH_PATHS = {
  bronze: 'M2 1h8v6L6 11 2 7Z',
  silver: 'M6 1l5 5-5 5-5-5Z',
  gold: 'M6 .8l1.5 3.2 3.5.4-2.6 2.4.7 3.5L6 8.6 2.9 10.3l.7-3.5L1 4.4l3.5-.4Z',
  diamond: 'M6 0l1.6 4.4L12 6 7.6 7.6 6 12 4.4 7.6 0 6l4.4-1.6Z',
};

/** The tier glyph as inline SVG (currentColor; the chip's CSS sets the hue). */
function tierGlyph(tier) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'tier-glyph');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute(
    'd',
    TIER_GLYPH_PATHS[tier] || TIER_GLYPH_PATHS.bronze // unknown tier: safe shape
  );
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

/** The tier medal chip: glyph + label; data-tier drives the chip's color. */
function makeMedalChip(tier) {
  const chip = document.createElement('span');
  chip.className = 'medal-chip';
  chip.dataset.tier = String(tier);
  chip.appendChild(tierGlyph(tier));
  const label = document.createElement('span');
  label.textContent = titleCase(tier);
  chip.appendChild(label);
  return chip;
}

/** The outline "Peak: <tier>" chip shown when the peak exceeds the live tier. */
function makePeakChip(peak) {
  const chip = document.createElement('span');
  chip.className = 'peak-chip';
  chip.dataset.tier = String(peak);
  chip.appendChild(tierGlyph(peak));
  const label = document.createElement('span');
  label.textContent = 'Peak: ' + titleCase(peak);
  chip.appendChild(label);
  return chip;
}

/**
 * The calibration block for a below-threshold pitch: "3/5 battles fought"
 * with a meter, plus the priority marker when the pitch sits at the pool's
 * minimum comparison count (the same fewest-votes-first fact the sampler acts
 * on, so the promise is one the sampler actually keeps).
 */
function makeCalibration(view, status, pitch, pool, votes) {
  const wrap = document.createElement('div');
  wrap.className = 'locker-calibration';

  const comparisons = Number.isFinite(status.comparisons)
    ? Math.max(0, status.comparisons)
    : 0;
  const threshold =
    Number.isFinite(status.threshold) && status.threshold > 0
      ? status.threshold
      : 1;

  const label = document.createElement('p');
  label.className = 'locker-calibration__label';
  label.textContent = comparisons + '/' + threshold + ' battles fought';
  wrap.appendChild(label);

  const meter = document.createElement('progress');
  meter.className = 'meter locker-meter';
  meter.max = threshold;
  meter.value = Math.min(comparisons, threshold);
  meter.setAttribute('aria-label', 'Calibration battles fought');
  wrap.appendChild(meter);

  let prioritized = false;
  try {
    prioritized =
      view.progression.calibrationPriority(pitch, pool, votes) === true;
  } catch (_err) {
    prioritized = false; // the marker is reassurance, never a blocker
  }
  if (prioritized) {
    const marker = document.createElement('p');
    marker.className = 'locker-priority';
    marker.textContent = 'Prioritized for upcoming battles';
    wrap.appendChild(marker);
  }

  return wrap;
}

/**
 * The no-pitches-yet empty state: teach the whole loop in one strip
 * (Submit -> Battle -> Medal -> Rank) and state the blindness rule in one
 * line so it reads as design, not a bug (PRD acceptance criterion 1).
 */
function makeEmptyState() {
  const wrap = document.createElement('div');
  wrap.className = 'locker-empty';

  // The large muted glyph (design spec P2 empty-state treatment): a simple
  // equipment-case outline in --ink-3, inline SVG, decoration only.
  const NS = 'http://www.w3.org/2000/svg';
  const glyph = document.createElementNS(NS, 'svg');
  glyph.setAttribute('class', 'locker-empty__glyph');
  glyph.setAttribute('viewBox', '0 0 20 20');
  glyph.setAttribute('aria-hidden', 'true');
  glyph.setAttribute('focusable', 'false');
  const casePath = document.createElementNS(NS, 'path');
  casePath.setAttribute(
    'd',
    'M7 5V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1h3.5a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H7Zm1.5 0h3V4a.5.5 0 0 0-.5-.5H9a.5.5 0 0 0-.5.5v1ZM4.5 6.5v9h11v-9h-11Zm4 3h3v1.5h-3V9.5Z'
  );
  casePath.setAttribute('fill', 'currentColor');
  glyph.appendChild(casePath);
  wrap.appendChild(glyph);

  const lead = document.createElement('p');
  lead.className = 'locker-empty__lead';
  lead.textContent = 'No pitches in your locker yet.';
  wrap.appendChild(lead);

  const loop = document.createElement('ol');
  loop.className = 'locker-empty__loop';
  for (const step of ['Submit', 'Battle', 'Medal', 'Rank']) {
    const item = document.createElement('li');
    item.textContent = step;
    loop.appendChild(item);
  }
  wrap.appendChild(loop);

  const how = document.createElement('p');
  how.className = 'locker-empty__how';
  how.textContent =
    'Submit a concept, let it battle in the Arena, earn a tier medal, ' +
    'and climb the career ranks. Exact results stay with the studio.';
  wrap.appendChild(how);

  return wrap;
}

// Per-family badge glyphs (inline SVG path data, viewBox 0 0 16 16). The same
// shape serves unlocked and locked tiles; the locked "silhouette" treatment is
// CSS (reduced opacity + muted ink), so no second asset is needed.
const BADGE_GLYPH_PATHS = {
  submission: 'M7 2h2v5h5v2H9v5H7V9H2V7h5Z', // plus: add to the arena
  coverage: 'M2 2h5v5H2Zm7 0h5v5H9ZM2 9h5v5H2Zm7 0h5v5H9Z', // grid: coverage
  performance:
    'M8 1.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9ZM5.4 9.9 4 15l4-2 4 2-1.4-5.1a5.5 5.5 0 0 1-5.2 0Z', // medal + ribbon
  voting: 'M6.4 11.4 2.6 7.6 4 6.2l2.4 2.4L12.5 3l1.4 1.4Z', // check: verdicts
};

/** A badge family's glyph as inline SVG (currentColor; CSS sets the ink). */
function badgeGlyph(family) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'badge-glyph');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute(
    'd',
    BADGE_GLYPH_PATHS[family] || BADGE_GLYPH_PATHS.submission
  );
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

/** Block 3 — the badge case: the full catalogue, unlocked or silhouetted. */
function renderBadgeCase(el, badges, unlocked) {
  el.replaceChildren();

  const heading = document.createElement('h2');
  heading.className = 'locker-block__title';
  heading.textContent = 'Badge case';
  el.appendChild(heading);

  const grid = document.createElement('ul');
  grid.className = 'badge-grid';
  for (const badge of Array.isArray(badges) ? badges : []) {
    if (!badge || typeof badge.id !== 'string') continue;
    const stamp = typeof unlocked[badge.id] === 'string' ? unlocked[badge.id] : null;

    const tile = document.createElement('li');
    tile.className = 'badge-tile ' + (stamp ? 'is-unlocked' : 'is-locked');
    tile.dataset.badge = badge.id;

    tile.appendChild(badgeGlyph(badge.family));

    const label = document.createElement('p');
    label.className = 'badge-tile__label';
    label.textContent = badge.label || badge.id;
    tile.appendChild(label);

    const detail = document.createElement('p');
    detail.className = 'badge-tile__detail';
    // Unlocked: the earned date. Locked: the condition text is the to-do list.
    detail.textContent = stamp
      ? 'Unlocked ' + dateLabel(stamp)
      : badge.blurb || 'Locked';
    tile.appendChild(detail);

    grid.appendChild(tile);
  }
  el.appendChild(grid);
}

// --- small defensive helpers -------------------------------------------------

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Assemble the badge-eligibility ctx (see progression.BADGES) from store data:
 * every input is monotone — pitch and vote counts only grow, slot/tag/day
 * coverage only widens, peaks only ratchet — so earned badges stay earned.
 */
function badgeContext(profileId, owned, statuses, peakTiers, votes) {
  const votesByProfile = profileId
    ? votes.filter((vote) => vote && vote.voter_id === profileId)
    : [];

  const slots = new Set();
  const tags = new Set();
  for (const pitch of owned) {
    if (pitch && typeof pitch.item_slot === 'string' && pitch.item_slot) {
      slots.add(pitch.item_slot);
    }
    const themeTags = Array.isArray(pitch && pitch.theme_tags)
      ? pitch.theme_tags
      : [];
    for (const tag of themeTags) {
      if (typeof tag === 'string' && tag) tags.add(tag);
    }
  }

  // Distinct created_at date prefixes of the profile's own votes — no new
  // clock authority; the streak badge is retrospective (TRD determinism note).
  const days = new Set();
  for (const vote of votesByProfile) {
    if (vote && typeof vote.created_at === 'string' && vote.created_at.length >= 10) {
      days.add(vote.created_at.slice(0, 10));
    }
  }

  return {
    ownedPitches: owned,
    statuses,
    peakTiers,
    votesByProfile,
    distinctSlots: slots.size,
    distinctTags: tags.size,
    distinctVoteDays: days.size,
  };
}

/** Votes this profile cast (as voter). Null profile has cast nothing. */
function countVotesCast(votes, profileId) {
  if (!profileId) return 0;
  let count = 0;
  for (const vote of votes) {
    if (vote && vote.voter_id === profileId) count += 1;
  }
  return count;
}

/** Newest first by created_at ISO string; unknown timestamps sink to the end. */
function byNewestFirst(a, b) {
  const ta = a && typeof a.created_at === 'string' ? a.created_at : '';
  const tb = b && typeof b.created_at === 'string' ? b.created_at : '';
  if (ta === tb) return 0;
  return ta < tb ? 1 : -1;
}

/** Display-case a tier/rank id ('gold' -> 'Gold'). */
function titleCase(id) {
  const value = String(id == null ? '' : id);
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/** The date part of an ISO timestamp for the badge tiles. */
function dateLabel(stamp) {
  const value = String(stamp == null ? '' : stamp);
  return value.length >= 10 ? value.slice(0, 10) : value;
}

export default initLocker;
