// app.js — Skin Concept Arena entry module.
//
// Defines the single source of truth for the run-wide constants (GAME,
// STUDIO_PASSPHRASE, COMPARISON_THRESHOLD), wires the quiet tab nav / view
// switcher, guarantees the shared store is seeded on first load, ensures the
// device-local creator profile exists, sets up the shared
// IntersectionObserver entrance animation, and boots the four view
// controllers with their injected dependencies.
//
// Access split (finding 6, extended by the progression add-on): ranking stays
// Studio-only and progression stays app/Locker-only. wizard.js and arena.js
// are handed NEITHER module — only the device-local profile id plus tiny
// app.js-derived callbacks cross that seam, so the submitter/voter views
// structurally cannot compute or render a score/rank. Only studio.js actually
// invokes ranking.rank. The guard test asserts the seam both statically (an
// import scan over the view sources) and dynamically (a spy ranking
// dependency that must never be called).

import * as store from './store.js';
import * as ranking from './ranking.js';
import * as sampler from './sampler.js';
import * as profile from './profile.js';
import * as progression from './progression.js';
import { initWizard } from './wizard.js';
import { initArena } from './arena.js';
import { initLocker, refreshLocker, checkCelebrations } from './locker.js';
import { initStudio } from './studio.js';
import * as demo from './demo.js';
import { initTutorial } from './tutorial.js';

// --- Run-wide constants (one source of truth) -----------------------------

// Fixed single-game context. Shown as context in the UI; NOT stored per pitch.
export const GAME = Object.freeze({
  id: 'emberhold',
  name: 'Emberhold',
});

// Documented client-side gate for the Studio leaderboard. This is convenience,
// NOT security (explicit non-goal): it lives in source and is trivially
// discoverable. studio.js reads this same constant.
export const STUDIO_PASSPHRASE = 'emberhold-studio';

// A pitch needs at least this many comparisons before its win-rate is treated
// as meaningful; below it the leaderboard flags the row as "needs more votes".
export const COMPARISON_THRESHOLD = 5;

// --- View / tab switching --------------------------------------------------

const VIEW_IDS = {
  submit: 'view-submit',
  arena: 'view-arena',
  locker: 'view-locker',
  studio: 'view-studio',
};

/**
 * Show exactly one view section and mark its tab active; hide the rest.
 * Fails safe on unknown/missing views so a stray click can never throw.
 */
function showView(view) {
  const tabs = document.querySelectorAll('nav.tabs [data-view]');
  tabs.forEach((btn) => {
    const isActive = btn.dataset.view === view;
    btn.classList.toggle('is-active', isActive);
    // The markup ships aria-pressed on these toggle buttons (index.html), so
    // keep that attribute live rather than introducing a second ARIA vocabulary.
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  Object.entries(VIEW_IDS).forEach(([name, sectionId]) => {
    const section = document.getElementById(sectionId);
    if (!section) return;
    const isActive = name === view;
    section.hidden = !isActive;
    section.classList.toggle('is-hidden', !isActive);
  });

  // The Locker re-derives everything from the store on entry, so a pitch
  // submitted or a vote cast since its last paint shows up immediately.
  // refreshLocker is already fail-safe, but guard here too: a refresh fault
  // must never break tab switching.
  if (view === 'locker') {
    try {
      refreshLocker();
    } catch (err) {
      console.warn('Locker refresh failed; showing the previous paint.', err);
    }
  }

  // A view can hold .fade-in blocks that were never intersected while hidden;
  // re-scan so they animate (or simply reveal) now that they are on screen.
  scanForEntrance();
}

function wireTabs() {
  const nav = document.querySelector('nav.tabs');
  if (!nav) return;
  nav.addEventListener('click', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest('[data-view]')
      : null;
    if (!target || !nav.contains(target)) return;
    const view = target.dataset.view;
    if (view && Object.prototype.hasOwnProperty.call(VIEW_IDS, view)) {
      showView(view);
    }
  });
}

// --- Shared entrance animation --------------------------------------------
//
// A gentle fade + small translateY as blocks enter the viewport (MOTION 3).
// Elements opt in with the `.fade-in` class; we add `.is-visible` when they
// intersect. Degrades safely: if IntersectionObserver is unavailable or the
// user prefers reduced motion, everything is revealed immediately so no
// content is ever left hidden.

const revealed = new WeakSet();
let entranceObserver = null;

// How long the boot-time reveal fallback waits before showing any .fade-in
// block the IntersectionObserver has not yet delivered (see setupEntrance).
const ENTRANCE_FALLBACK_MS = 400;

function reveal(el) {
  if (revealed.has(el)) return;
  revealed.add(el);
  el.classList.add('is-visible');
}

function setupEntrance() {
  const reduceMotion = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduceMotion || typeof IntersectionObserver === 'undefined') {
    // No animation: just make sure every entrance block is visible.
    document.querySelectorAll('.fade-in').forEach(reveal);
    return;
  }

  entranceObserver = new IntersectionObserver((entries, obs) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        reveal(entry.target);
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -5% 0px' });

  scanForEntrance();

  // Boot-time safety net: some renderers (e.g. headless screenshot runs under
  // a virtual-time budget) advance timers but never composite, so observer
  // callbacks never fire and the page would stay blank. First paint must never
  // depend on observer timing — after a short beat, reveal anything still
  // hidden. reveal() is idempotent, so blocks the observer already handled
  // (or handles later) are unaffected.
  window.setTimeout(() => {
    document.querySelectorAll('.fade-in').forEach(reveal);
  }, ENTRANCE_FALLBACK_MS);
}

const observedForEntrance = new WeakSet();

/** Observe any not-yet-tracked .fade-in blocks (incl. freshly rendered ones). */
function scanForEntrance() {
  const blocks = document.querySelectorAll('.fade-in');
  if (!entranceObserver) {
    // Fallback mode (no observer): reveal on sight.
    blocks.forEach(reveal);
    return;
  }
  blocks.forEach((el) => {
    if (observedForEntrance.has(el)) return;
    observedForEntrance.add(el);
    entranceObserver.observe(el);
  });
}

// --- Celebration toasts ------------------------------------------------------
//
// app.js owns the one toast pipeline (PRD MVP 5): the Locker's celebration
// pass returns the events (peak-tier-ups, badge unlocks, rank-ups — each at
// most once), and this queue renders them into #toast-region strictly one at
// a time, FIFO, ~3s each, so a first submit that unlocks a badge AND tips a
// rank-up never stacks or buries a moment. Motion is transform/opacity only
// (the MOTION lock) and lives in CSS — JS just toggles .is-visible on the
// queue's cadence, the only timers in the app (TRD determinism note).
// Everything here is decoration: a missing region or a render fault drops the
// toast, never the submit/vote that triggered it.

const TOAST_HOLD_MS = 3000; // how long each toast stays readable
const TOAST_EXIT_MS = 260;  // covers the CSS exit transition (220ms) + grace

const toastQueue = [];
let toastShowing = false;

/** One human line per celebration event; '' drops an unknown event shape. */
function toastMessage(event) {
  if (!event || typeof event.type !== 'string') return '';
  if (event.type === 'peak') {
    // Name the pitch so simultaneous tier-ups read as distinct moments. The
    // lookup is best-effort: a store fault degrades to a generic subject.
    let title = '';
    try {
      const pitch = store.loadPitches().find((p) => p && p.id === event.pitchId);
      if (pitch && typeof pitch.title === 'string') title = pitch.title;
    } catch (_err) {
      title = '';
    }
    const name = title ? '“' + title + '”' : 'Your pitch';
    return 'Tier up! ' + name + ' peaked at ' + titleCase(event.tier) + '.';
  }
  if (event.type === 'badge') {
    let label = '';
    try {
      const badge = progression.BADGES.find((b) => b && b.id === event.badgeId);
      if (badge && typeof badge.label === 'string') label = badge.label;
    } catch (_err) {
      label = '';
    }
    return 'Badge unlocked: ' + (label || String(event.badgeId));
  }
  if (event.type === 'rank') {
    return 'Rank up! You are now ' + titleCase(event.rankId) + '.';
  }
  return '';
}

/** Queue every celebration-worthy event as a toast and start the pump. */
function enqueueCelebrations(events) {
  for (const event of Array.isArray(events) ? events : []) {
    const message = toastMessage(event);
    if (message) toastQueue.push(message);
  }
  pumpToasts();
}

/**
 * Show the next queued toast, if none is showing: slide it in (CSS handles
 * the transform/opacity transition), hold ~3s, slide it out, then free the
 * slot and recurse for the next one. #toast-region is aria-live="polite", so
 * appending the text announces it without interrupting the current task.
 */
function pumpToasts() {
  if (toastShowing || toastQueue.length === 0) return;
  const region = document.getElementById('toast-region');
  if (!region) {
    toastQueue.length = 0; // no anchor in this shell: drop quietly
    return;
  }
  const message = toastQueue.shift();
  toastShowing = true;
  try {
    const toast = document.createElement('p');
    toast.className = 'toast';
    toast.textContent = message;
    region.appendChild(toast);
    // Double-rAF so the node paints once in its hidden state before
    // .is-visible flips it in — otherwise the entrance transition is skipped.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => toast.classList.add('is-visible'));
    });
    setTimeout(() => {
      toast.classList.remove('is-visible');
      // Let the exit transition finish before freeing the queue slot.
      setTimeout(() => {
        try {
          toast.remove();
        } catch (_err) {
          /* already detached */
        }
        toastShowing = false;
        pumpToasts();
      }, TOAST_EXIT_MS);
    }, TOAST_HOLD_MS);
  } catch (err) {
    // Toasts are decoration: a render fault drops this one and frees the slot.
    console.warn('Toast render failed; dropping it.', err);
    toastShowing = false;
  }
}

/**
 * The celebration hook handed to the wizard and arena (they call it after
 * every pitch submit / vote): run the Locker's derive -> record pass, then
 * toast whatever genuinely changed. Fail-safe end to end — a fault here can
 * never block the action that triggered it.
 */
function celebrate() {
  let events = [];
  try {
    events = checkCelebrations() || [];
  } catch (err) {
    console.warn('Celebration pass failed; skipping toasts.', err);
    events = [];
  }
  enqueueCelebrations(events);
}

/** Display-case a tier/rank id ('gold' -> 'Gold') for toast copy. */
function titleCase(id) {
  const value = String(id == null ? '' : id);
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

// --- Masthead actions: the demo-profile switch -------------------------------
//
// The toggle swaps the device between the visitor's own identity and the
// pre-populated demo profile (see demo.js). Both directions mutate the
// profile/ledger/store and then reload — a full reboot is the one
// guaranteed-consistent way to re-derive all four views on a new identity.
// Wiring is fail-safe: with no button in the shell, nothing happens.

function wireDemoToggle() {
  const button = document.getElementById('demo-toggle');
  if (!button) return;
  const active = demo.isDemoActive();
  button.textContent = active ? 'Exit demo profile' : 'Try a demo profile';
  button.classList.toggle('is-demo-active', active);
  button.setAttribute('aria-pressed', active ? 'true' : 'false');
  button.addEventListener('click', () => {
    try {
      if (demo.isDemoActive()) {
        demo.exitDemo();
      } else {
        demo.enterDemo();
      }
    } catch (err) {
      console.warn('Demo toggle failed; staying on the current profile.', err);
      return;
    }
    window.location.reload();
  });
}

// --- Boot ------------------------------------------------------------------

function bootViews(activeProfile) {
  // The shared dependency bundles. The participant views (wizard/arena) never
  // receive the ranking or progression modules — only the profile id and the
  // tiny votingProgress callback below, so the access split stays structural.
  const submitEl = document.getElementById(VIEW_IDS.submit);
  const arenaEl = document.getElementById(VIEW_IDS.arena);
  const lockerEl = document.getElementById(VIEW_IDS.locker);
  const studioEl = document.getElementById(VIEW_IDS.studio);

  const profileId =
    activeProfile && typeof activeProfile.id === 'string' && activeProfile.id
      ? activeProfile.id
      : null;

  // Arena session-strip hook: this profile's total votes cast plus the next
  // voting-badge target, derived HERE (app.js owns progression) so arena.js
  // only ever sees the { votesCast, next } shape, never the module. Fails safe
  // to zero/null — the strip is decoration and must never break voting.
  function votingProgress() {
    let votesCast = 0;
    try {
      if (profileId) {
        for (const vote of store.loadVotes()) {
          if (vote && vote.voter_id === profileId) votesCast += 1;
        }
      }
    } catch (_err) {
      votesCast = 0;
    }
    let next = null;
    try {
      const target = progression.nextVotingBadge(votesCast);
      if (target) {
        next = {
          label: target.badge.label,
          target: target.badge.votes,
          remaining: target.remaining,
        };
      }
    } catch (_err) {
      next = null;
    }
    return { votesCast, next };
  }

  // The celebration hooks: the wizard fires after every pitch submit and the
  // arena after every vote (PRD MVP 5). Both are the same app.js-owned pass —
  // the views never learn what a badge or rank is, they just report "something
  // happened" across the seam.
  if (submitEl) {
    initWizard(submitEl, { store, profileId, onPitchSubmitted: celebrate });
  }
  if (arenaEl) {
    initArena(arenaEl, {
      store,
      sampler,
      profileId,
      votingProgress,
      onVoteCast: celebrate,
    });
  }
  if (lockerEl) {
    // The Locker is the participant-facing progression surface: it receives
    // progression + profile (never ranking) and shows own-work-only, banded
    // state — tier chips and comparison counts, no numeric win-rate exists to
    // leak (pitchStatus's return contract).
    initLocker(lockerEl, {
      store,
      progression,
      profile,
      profileId,
      threshold: COMPARISON_THRESHOLD,
    });
  }
  if (studioEl) {
    initStudio(studioEl, {
      store,
      ranking,
      passphrase: STUDIO_PASSPHRASE,
      threshold: COMPARISON_THRESHOLD,
    });
  }
}

export function initApp() {
  // Ensure the store is materialized/seeded on first load. store.js seeds the
  // bundled SAMPLE_PITCHES/SAMPLE_VOTES when its keys are absent, so touching
  // both loaders here guarantees all three views (leaderboard included) have
  // real content on first paint rather than being an empty shell.
  try {
    store.loadPitches();
    store.loadVotes();
  } catch (err) {
    // store.js is designed to fail safe; never let seeding break the boot.
    console.warn('Store seed check failed; continuing with in-memory data.', err);
  }

  // Device-local creator identity (progression add-on): load-or-create the
  // profile before the views boot so new pitches/votes carry
  // owner_id/voter_id. profile.js already fails safe (memory-mirror fallback),
  // but guard the boot anyway: with no profile the views run unstamped and
  // unfiltered, exactly like v1.
  let activeProfile = null;
  try {
    activeProfile = profile.ensureProfile();
  } catch (err) {
    console.warn('Profile init failed; continuing without owner stamping.', err);
  }

  // Optionally surface the game name into any [data-game-name] slots the shell
  // exposes, so the fixed-game context stays in one place.
  document.querySelectorAll('[data-game-name]').forEach((el) => {
    el.textContent = GAME.name;
  });

  wireTabs();
  bootViews(activeProfile);
  setupEntrance();
  wireDemoToggle();

  // Land on the Submit view by default; all three remain reachable via nav.
  showView('submit');

  // First-visit onboarding tour (tutorial.js): auto-starts once per device,
  // replayable from the masthead's Tour button. Booted LAST — the views it
  // spotlights must already be rendered — and fail-safe: a tour fault must
  // never take down the app it introduces.
  try {
    const tour = initTutorial({ showView });
    const replay = document.getElementById('tour-replay');
    if (replay && tour) {
      replay.addEventListener('click', () => tour.start());
    }
  } catch (err) {
    console.warn('Tutorial init failed; skipping onboarding.', err);
  }
}

// Self-invoke on module load. type="module" scripts are deferred, so the DOM is
// already parsed by the time this runs; guard anyway for safety.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp, { once: true });
} else {
  initApp();
}
