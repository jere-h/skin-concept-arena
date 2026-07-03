// arena.js — Arena view controller (blind forced-choice voting).
//
// On load and after every vote it asks sampler.pickPair for the next pair,
// biased toward the least-compared pitches and never repeating a pair already
// shown this page session (tracked in the in-memory `seenPairs` Set). The
// active profile's OWN pitches are filtered out of the pool BEFORE the sampler
// sees it (PRD MVP 6: self-vote exclusion — you are never served, and can
// never inflate, your own concept). The tapped card is recorded as the winning
// Vote via store.addVote — stamped with the profile's voter_id — the pair is
// marked seen, and the next pair is served after the flash. A session strip below
// the stage shows votes cast this session plus live progress to the next
// voting badge (PRD P0-2: immediate agency), fed by an app.js-provided
// callback so this view never touches the progression module itself.
//
// Edge states:
//   - 'insufficient' (<2 pitches AFTER the owner filter — covers both a truly
//     tiny pool and "only your own pitches remain"): show the explicit
//     "not enough pitches" note (acceptance criterion 4) and no cards.
//   - 'exhausted' (>=2 pitches but every pair already seen): clear seenPairs and
//     re-sample so voting keeps going instead of falsely reporting an empty pool
//     (finding 1).
//
// This is a voter-facing view: it renders NO score, rank, or win-rate. It
// never imports ranking or progression (the access-split guard asserts that
// statically, and its dynamic twin injects a spy ranking dependency that is
// deliberately never called here; finding 6). The only import is art.js, the
// pure presentational placeholder-art helper shared with the Locker.
//
// Duel staging (design spec): the pair renders as two cards with a VS
// medallion between them; the tapped card holds a brief accent flash (a CSS
// class, ~200ms, within the 150-220ms motion band) before the next pair is
// served — the vote itself is recorded synchronously, only the re-render is
// deferred, and further taps during the flash window are ignored so the same
// pair can never be double-voted.

import { makeArtZone } from './art.js';

// How long the resolved duel holds before the next pair renders. Long enough
// that the winner stamp / loser dim / medallion flip register as a moment,
// short enough that rapid voting never feels throttled. (The transitions
// inside the hold stay within the 150-220ms motion band; this is dwell time,
// not animation duration.)
const SWAP_DELAY_MS = 450;

// One copy covers both empty-pool cases: fewer than two pitches overall, and
// two-plus pitches of which fewer than two belong to OTHER creators once the
// self-vote exclusion has filtered the pool.
const INSUFFICIENT_MESSAGE =
  'Not enough pitches from other creators yet. Submit one or come back later.';

/**
 * Wire up the Arena view.
 * @param {HTMLElement} rootEl  the #view-arena section
 * @param {{ store: object, sampler: object, profileId?: string|null,
 *           votingProgress?: function, onVoteCast?: function }} deps
 *   store          — persistence (loadPitches/loadVotes/addVote)
 *   sampler        — pure pairing logic (pickPair/pairKey)
 *   profileId      — device-local voter identity; stamps voter_id and drives
 *                    the own-pitch exclusion (null: unfiltered, unstamped)
 *   votingProgress — app.js-derived session-strip data: () -> { votesCast,
 *                    next: { label, target, remaining } | null }
 *   onVoteCast     — app.js-owned celebration hook, fired after every recorded
 *                    vote (an opaque "a vote landed" signal; this view never
 *                    learns what it celebrates)
 */
export function initArena(rootEl, deps) {
  if (!rootEl || !deps) return;
  const { store, sampler } = deps;
  // Device-local voter identity; null (no profile) stamps voter_id null — the
  // same shape sample/pre-add-on votes carry — and disables the owner filter.
  const profileId =
    typeof deps.profileId === 'string' && deps.profileId ? deps.profileId : null;
  // App.js-provided callback for the session strip: this profile's total votes
  // cast plus its next voting-badge target. Only this tiny derived shape ever
  // crosses the seam — the progression module is never handed to (or imported
  // by) this view. A spy `ranking` dependency, if a test injects one, is
  // likewise never referenced (finding 6).
  const votingProgress =
    typeof deps.votingProgress === 'function' ? deps.votingProgress : null;
  // App.js-owned celebration hook: called once per recorded vote so the +1
  // career point (and any badge/rank it tips over) lands immediately (P0-2).
  // Optional, zero-argument, and treated as decoration — see vote().
  const onVoteCast =
    typeof deps.onVoteCast === 'function' ? deps.onVoteCast : null;

  const pairEl = rootEl.querySelector('#arena-pair');
  const messageEl = rootEl.querySelector('#arena-message');
  if (!pairEl || !store || !sampler) return;

  // Pairs shown during THIS page session. Keys are order-independent (pairKey).
  const seenPairs = new Set();

  // --- session strip (PRD P0-2: immediate agency) ---------------------------
  // Built from JS so the shell needs no markup change. The data hooks
  // ([data-session-votes] / [data-badge-progress]) carry the numbers, and a
  // thin shared meter (mark spec: accent fill, surface-2 track) shows the
  // march toward the next voting badge.
  let sessionVotes = 0;
  const stripEl = document.createElement('p');
  stripEl.className = 'session-strip';
  stripEl.setAttribute('data-arena-session', '');
  const stripVotesEl = document.createElement('span');
  stripVotesEl.className = 'session-strip__votes';
  stripVotesEl.setAttribute('data-session-votes', '');
  const stripBadgeEl = document.createElement('span');
  stripBadgeEl.className = 'session-strip__badge';
  stripBadgeEl.setAttribute('data-badge-progress', '');
  const stripMeterEl = document.createElement('progress');
  stripMeterEl.className = 'meter session-strip__meter';
  stripMeterEl.max = 1;
  stripMeterEl.value = 0;
  stripMeterEl.setAttribute('aria-label', 'Progress to the next voting badge');
  stripEl.append(stripVotesEl, stripBadgeEl, stripMeterEl);
  rootEl.appendChild(stripEl);

  // While the chosen-card flash is holding, further taps are ignored (the
  // vote for this pair is already recorded; see vote()).
  let swapPending = false;

  updateSessionStrip();
  render();

  /**
   * Ask the sampler for the next pair and paint the matching state. On an
   * exhausted pool, reset the session history once and re-sample so voting can
   * continue rather than dead-ending.
   */
  function render() {
    const pool = store.loadPitches();
    const votes = store.loadVotes();

    // Self-vote exclusion (PRD MVP 6): this profile's own pitches leave the
    // pool BEFORE the sampler sees it. Sample / pre-add-on pitches carry no
    // owner_id, so they stay in everyone's arena. The sampler signature is
    // untouched: comparison counts still derive from the FULL votes array,
    // and counts for excluded pitches are simply irrelevant to the filtered
    // list. The filtered pool can be 'insufficient' even when the raw pool is
    // >=2 (all remaining are yours) — the same message state covers it.
    const pitches =
      profileId && Array.isArray(pool)
        ? pool.filter((pitch) => !(pitch && pitch.owner_id === profileId))
        : pool;

    let result = sampler.pickPair(pitches, votes, seenPairs);

    if (result.status === 'exhausted') {
      // Every possible pair has been seen this session: forget the history and
      // start a fresh loop over the same pool (finding 1).
      seenPairs.clear();
      result = sampler.pickPair(pitches, votes, seenPairs);
    }

    if (result.status === 'ok' && Array.isArray(result.pair)) {
      renderPair(result.pair);
      return;
    }

    // 'insufficient' (or a defensive fallback if a cleared re-sample still can't
    // form a pair) — no cards, explicit note.
    showInsufficient();
  }

  /** Render the insufficient-pool message and clear any cards. */
  function showInsufficient() {
    pairEl.replaceChildren();
    pairEl.hidden = true;
    if (messageEl) {
      messageEl.textContent = INSUFFICIENT_MESSAGE;
      messageEl.hidden = false;
    }
  }

  /** The circular VS medallion between the two cards (decoration only). */
  function makeVsMedallion() {
    const vs = document.createElement('div');
    vs.className = 'vs-medallion';
    vs.setAttribute('aria-hidden', 'true');
    vs.textContent = 'VS';
    return vs;
  }

  /** Render the two forced-choice cards with the VS medallion between. */
  function renderPair(pair) {
    if (messageEl) messageEl.hidden = true;
    pairEl.hidden = false;
    pairEl.classList.remove('is-resolved'); // fresh duel: medallion back to neutral
    pairEl.replaceChildren(makeCard(pair, 0), makeVsMedallion(), makeCard(pair, 1));
  }

  /** The "✓ Your pick" stamp overlaid on the winning card during the hold. */
  function makePickStamp() {
    const stamp = document.createElement('span');
    stamp.className = 'pick-stamp';
    stamp.setAttribute('aria-hidden', 'true'); // the vote itself is the record
    stamp.textContent = '✓ Your pick';
    return stamp;
  }

  /**
   * Build one clickable pitch card. Clicking it records that pitch as the
   * winner of this pair, marks the pair seen, and serves the next pair.
   * @param {object[]} pair  the [a, b] pitch pair
   * @param {number} index   which of the pair this card represents (0 or 1)
   */
  function makeCard(pair, index) {
    const pitch = pair[index];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'pitch-card';
    card.dataset.id = pitch.id;
    card.setAttribute(
      'aria-label',
      `Choose ${pitch.title || 'this concept'}`
    );

    // Art zone: the real image when present (falling back on load error), else
    // the deterministic hue+slot-glyph placeholder — shared with the Locker so
    // a pitch wears the same art everywhere (art.js).
    card.appendChild(makeArtZone(pitch));

    const slot = document.createElement('p');
    slot.className = 'pitch-card__slot';
    slot.textContent = pitch.item_slot || 'Skin';
    card.appendChild(slot);

    const title = document.createElement('h2');
    title.className = 'pitch-card__title';
    title.textContent = pitch.title || 'Untitled concept';
    card.appendChild(title);

    const desc = document.createElement('p');
    desc.className = 'pitch-card__desc';
    desc.textContent = pitch.description || '';
    card.appendChild(desc);

    const tags = Array.isArray(pitch.theme_tags) ? pitch.theme_tags : [];
    if (tags.length) {
      const tagWrap = document.createElement('ul');
      tagWrap.className = 'pitch-card__tags';
      for (const tag of tags) {
        const li = document.createElement('li');
        li.className = 'pitch-card__tag';
        li.textContent = tag;
        tagWrap.appendChild(li);
      }
      card.appendChild(tagWrap);
    }

    card.addEventListener('click', () => vote(pair, pitch.id, card));
    return card;
  }

  /**
   * Record the chosen pitch as the winner of this pair (stamped with this
   * profile's voter_id), refresh the session strip so the +1 lands immediately
   * (P0-2), run the celebration pass, remember the pair so it is not shown
   * again this session, flash the chosen card, then serve the next pair.
   * Everything stateful happens synchronously; only the re-render waits out
   * the flash, and repeat taps inside that window are ignored.
   */
  function vote(pair, winnerId, cardEl) {
    if (swapPending) return; // this pair's vote is already in
    const aId = pair[0].id;
    const bId = pair[1].id;
    store.addVote({
      pitch_a_id: aId,
      pitch_b_id: bId,
      winner_id: winnerId,
      voter_id: profileId, // null when the device has no profile (fail-safe)
    });
    sessionVotes += 1;
    updateSessionStrip();
    // Pulse the tally so the +1 visibly lands (transform-only, behind the
    // reduced-motion gate in CSS). Restarting the animation needs the
    // remove -> reflow -> re-add dance; all of it is decoration.
    try {
      stripVotesEl.classList.remove('is-bumped');
      void stripVotesEl.offsetWidth; // restart the animation
      stripVotesEl.classList.add('is-bumped');
    } catch (_err) {
      /* the pulse is decoration */
    }
    // Celebration pass after the vote is committed and the strip reflects it.
    // Swallow any fault — celebration is decoration; the next pair must be
    // served no matter what happens on the other side of the seam.
    if (onVoteCast) {
      try {
        onVoteCast();
      } catch (_err) {
        /* never let a celebration fault block voting */
      }
    }
    seenPairs.add(sampler.pairKey(aId, bId));
    // The resolution beat: the chosen card wears the accent ring and the
    // "✓ Your pick" stamp, the passed-over card recedes, and the VS medallion
    // flips to the accent — a resolved duel, not a silent refresh. All of it
    // is decoration: a DOM fault here must never stop the next pair.
    swapPending = true;
    try {
      if (cardEl && cardEl.classList) {
        cardEl.classList.add('is-chosen');
        cardEl.appendChild(makePickStamp());
      }
      const passed = pairEl.querySelector('.pitch-card:not(.is-chosen)');
      if (passed) passed.classList.add('is-passed');
      pairEl.classList.add('is-resolved');
    } catch (_err) {
      /* the resolution beat is decoration */
    }
    setTimeout(() => {
      swapPending = false;
      render();
    }, SWAP_DELAY_MS);
  }

  /**
   * Refresh the session strip: votes cast this session, plus live progress to
   * the next voting badge ("18/25 to Arena Regular") or, once every count
   * badge is earned, the profile's total votes cast. Degrades to the session
   * count alone when no votingProgress callback was injected; a throwing
   * callback is swallowed — the strip is decoration and must never break
   * voting.
   */
  function updateSessionStrip() {
    stripVotesEl.textContent = 'Votes this session: ' + sessionVotes;
    let progressText = '';
    let meterMax = 0;
    let meterValue = 0;
    if (votingProgress) {
      try {
        const progress = votingProgress() || {};
        const cast = Number.isFinite(progress.votesCast) ? progress.votesCast : 0;
        const next = progress.next;
        if (next && next.label && Number.isFinite(next.target)) {
          progressText = ' · ' + cast + '/' + next.target + ' to ' + next.label;
          meterMax = Math.max(1, next.target);
          meterValue = Math.min(
            meterMax,
            Math.max(0, next.target - (Number.isFinite(next.remaining) ? next.remaining : 0))
          );
        } else {
          progressText = ' · ' + cast + ' votes cast';
        }
      } catch (_err) {
        progressText = '';
      }
    }
    stripBadgeEl.textContent = progressText;
    // The thin badge-progress meter shows only while there IS a next badge
    // target; past Century (or with no hook) the text carries the tally alone.
    if (meterMax > 0) {
      stripMeterEl.max = meterMax;
      stripMeterEl.value = meterValue;
      stripMeterEl.hidden = false;
    } else {
      stripMeterEl.hidden = true;
    }
  }
}
