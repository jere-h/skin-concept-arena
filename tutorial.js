// tutorial.js — the first-visit onboarding tour.
//
// A spotlight walkthrough that runs once per device (completion recorded
// under 'sca.tutorial.v1' via store.js's fail-safe readKey/writeKey) and is
// replayable from the masthead's Tour button. Each step optionally switches
// to a view (via the injected showView) and highlights one element: a
// rounded spotlight box whose oversized box-shadow dims everything else,
// with a card beside it explaining that stop of the loop — submit → battle
// → medal/badge/rank → studio — plus a final pointer at the demo-profile
// switch. Back/Next/Skip buttons, Esc to skip; finishing OR skipping marks
// the tour done, so it never nags twice.
//
// Deliberately dependency-light: the only inputs are showView and the two
// store helpers, all DOM is built here, and every phase is wrapped so a
// tour fault can only ever cancel the tour, never the app under it. When a
// step's target is missing (markup drift), the spotlight hides and the card
// centers — the copy still reads.

import { readKey, writeKey } from './store.js';
// Game identity, the documented demo passphrase, and the calibration
// threshold, so the tour copy follows game-config.js instead of hardcoding a
// game name or a number (GAME-ADAPT lives there, not here).
import { GAME, STUDIO_PASSPHRASE, COMPARISON_THRESHOLD } from './game-config.js';

const TUTORIAL_KEY = 'sca.tutorial.v1';

// How much air the spotlight leaves around its target, and the gap between
// the target and the explaining card.
const SPOTLIGHT_PAD = 8;
const CARD_GAP = 14;

const STEPS = [
  {
    view: null,
    target: '.masthead__brand',
    title: 'Welcome to the Arena',
    body:
      'Skin Concept Arena is a pitch-and-vote game for ' + GAME.name +
      ' cosmetics: submit skin concepts, battle them head-to-head, and ' +
      'climb a career ladder. Here is the loop, in four quick stops.',
  },
  {
    view: 'submit',
    target: '#wizard-form',
    title: 'Stop 1 · Pitch a concept',
    body:
      'Pick an item slot, tag the vibe with tonality chips, and write a ' +
      'title and description. The checklist gates the button: meet all ' +
      'three requirements and your concept enters the arena.',
  },
  {
    view: 'arena',
    target: '#view-arena',
    title: 'Stop 2 · Vote in battles',
    body:
      'Two concepts, one tap — pick the one you would rather see in-game. ' +
      'Every vote pays +1 career point on the spot, and you are never shown ' +
      'your own pitches, so results stay honest.',
  },
  {
    view: 'locker',
    target: '#locker-rank',
    title: 'Stop 3 · Watch it pay off',
    body:
      'After ' + COMPARISON_THRESHOLD + ' battles a pitch earns a tier ' +
      'medal — Bronze up to Diamond — and its best tier is remembered ' +
      'forever. Medals, badges, and votes all feed the career rank on this ' +
      'meter.',
  },
  {
    view: 'locker',
    target: '#locker-badges',
    title: 'The badge case',
    body:
      'Locked badges show exactly how to earn them, so there is always a ' +
      'next goal: pitch more concepts, vote more days, cover more slots ' +
      'and vibes.',
  },
  {
    view: 'studio',
    target: '#studio-gate',
    title: 'Stop 4 · The Studio',
    body:
      'A passphrase-gated leaderboard for the design team — voters and ' +
      'submitters never see rank or win-rate. (Demo passphrase: ' +
      STUDIO_PASSPHRASE + '.)',
  },
  {
    view: null,
    target: '#demo-toggle',
    title: 'See it lived-in',
    body:
      'Want the full picture before you pitch? Switch to the demo profile — ' +
      'a creator with four battle-tested concepts, medals up to Diamond, a ' +
      'deep badge case, and a Master rank. The Tour button replays this ' +
      'walkthrough any time.',
  },
];

function tourDone() {
  try {
    const record = readKey(TUTORIAL_KEY);
    return !!(record && typeof record === 'object' && record.done);
  } catch (_err) {
    return true; // unreadable storage: never risk nagging on every load
  }
}

function markDone() {
  try {
    writeKey(TUTORIAL_KEY, { done: new Date().toISOString() });
  } catch (_err) {
    /* fail-safe: worst case the tour offers itself again next load */
  }
}

/**
 * Initialise the tour. Auto-starts once per device (after a short beat so
 * first paint settles); returns { start } for the masthead replay button.
 *
 * @param {{ showView?: (view: string) => void }} deps
 * @returns {{ start: () => void }}
 */
export function initTutorial(deps) {
  const showView =
    deps && typeof deps.showView === 'function' ? deps.showView : null;

  let overlay = null;
  let spotlightEl = null;
  let cardEl = null;
  let titleEl = null;
  let bodyEl = null;
  let countEl = null;
  let backBtn = null;
  let nextBtn = null;
  let stepIndex = 0;
  let activeTarget = null;

  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'tutorial-overlay';

    spotlightEl = document.createElement('div');
    spotlightEl.className = 'tutorial-spotlight';
    spotlightEl.setAttribute('aria-hidden', 'true');

    cardEl = document.createElement('div');
    cardEl.className = 'tutorial-card';
    cardEl.setAttribute('role', 'dialog');
    cardEl.setAttribute('aria-modal', 'true');
    cardEl.setAttribute('aria-labelledby', 'tutorial-title');

    countEl = document.createElement('p');
    countEl.className = 'tutorial-card__count';

    titleEl = document.createElement('h2');
    titleEl.className = 'tutorial-card__title';
    titleEl.id = 'tutorial-title';

    bodyEl = document.createElement('p');
    bodyEl.className = 'tutorial-card__body';

    const actions = document.createElement('div');
    actions.className = 'tutorial-card__actions';

    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'tutorial-btn tutorial-btn--ghost';
    skipBtn.textContent = 'Skip tour';
    skipBtn.addEventListener('click', () => end());

    backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'tutorial-btn tutorial-btn--ghost';
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', () => goTo(stepIndex - 1));

    nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'tutorial-btn tutorial-btn--primary';
    nextBtn.textContent = 'Next';
    nextBtn.addEventListener('click', () => {
      if (stepIndex >= STEPS.length - 1) {
        end();
      } else {
        goTo(stepIndex + 1);
      }
    });

    actions.append(skipBtn, backBtn, nextBtn);
    cardEl.append(countEl, titleEl, bodyEl, actions);
    overlay.append(spotlightEl, cardEl);
    document.body.appendChild(overlay);
  }

  function onKeydown(event) {
    if (event.key === 'Escape') end();
  }

  /** Place the spotlight over the target and the card beside it. */
  function position() {
    if (!overlay) return;
    const target = activeTarget;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    if (!target || !target.getBoundingClientRect) {
      // No anchor: hide the spotlight (its shadow still dims via the
      // overlay fallback class) and center the card.
      spotlightEl.classList.add('is-anchorless');
      cardEl.style.left = '50%';
      cardEl.style.top = '50%';
      cardEl.style.transform = 'translate(-50%, -50%)';
      return;
    }

    const rect = target.getBoundingClientRect();
    spotlightEl.classList.remove('is-anchorless');
    const top = Math.max(rect.top - SPOTLIGHT_PAD, 4);
    const left = Math.max(rect.left - SPOTLIGHT_PAD, 4);
    const width = Math.min(rect.width + SPOTLIGHT_PAD * 2, viewportW - left - 4);
    const height = Math.min(rect.height + SPOTLIGHT_PAD * 2, viewportH - top - 4);
    spotlightEl.style.top = top + 'px';
    spotlightEl.style.left = left + 'px';
    spotlightEl.style.width = width + 'px';
    spotlightEl.style.height = height + 'px';

    // Card: below the spotlight when there is room, else above, else centered.
    cardEl.style.transform = 'none';
    const cardRect = cardEl.getBoundingClientRect();
    const cardW = Math.min(cardRect.width || 340, viewportW - 24);
    let cardTop = top + height + CARD_GAP;
    if (cardTop + cardRect.height > viewportH - 12) {
      cardTop = top - CARD_GAP - cardRect.height;
    }
    if (cardTop < 12) {
      cardTop = Math.max(12, (viewportH - cardRect.height) / 2);
    }
    let cardLeft = Math.min(Math.max(left, 12), viewportW - cardW - 12);
    cardEl.style.top = cardTop + 'px';
    cardEl.style.left = cardLeft + 'px';
  }

  function goTo(index) {
    stepIndex = Math.min(Math.max(index, 0), STEPS.length - 1);
    const step = STEPS[stepIndex];

    // Switch views first so the target exists and is visible.
    if (step.view && showView) {
      try {
        showView(step.view);
      } catch (_err) {
        /* the card still reads without the view switch */
      }
    }

    countEl.textContent = 'Step ' + (stepIndex + 1) + ' of ' + STEPS.length;
    titleEl.textContent = step.title;
    bodyEl.textContent = step.body;
    backBtn.hidden = stepIndex === 0;
    nextBtn.textContent = stepIndex >= STEPS.length - 1 ? 'Finish' : 'Next';

    activeTarget = null;
    try {
      activeTarget = step.target ? document.querySelector(step.target) : null;
    } catch (_err) {
      activeTarget = null;
    }
    if (activeTarget && typeof activeTarget.scrollIntoView === 'function') {
      try {
        activeTarget.scrollIntoView({ block: 'center' });
      } catch (_err) {
        /* positioning still clamps to the viewport */
      }
    }

    // Measure after this frame so the view switch / scroll has landed.
    requestAnimationFrame(() => position());
    try {
      nextBtn.focus({ preventScroll: true });
    } catch (_err) {
      /* focus is a nicety */
    }
  }

  function end() {
    markDone();
    if (overlay) {
      try {
        overlay.remove();
      } catch (_err) {
        /* already detached */
      }
    }
    overlay = null;
    activeTarget = null;
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
    document.removeEventListener('keydown', onKeydown);
    // Land back where new users start.
    if (showView) {
      try {
        showView('submit');
      } catch (_err) {
        /* nothing to recover */
      }
    }
  }

  function start() {
    if (overlay) return; // already running
    try {
      buildOverlay();
      window.addEventListener('resize', position);
      window.addEventListener('scroll', position, true);
      document.addEventListener('keydown', onKeydown);
      goTo(0);
    } catch (err) {
      console.warn('Tutorial failed to start.', err);
      end();
    }
  }

  // First visit: auto-start after a short beat so the first paint (and the
  // entrance animations) settle before the overlay dims them.
  if (!tourDone()) {
    window.setTimeout(() => {
      if (!tourDone()) start();
    }, 600);
  }

  return { start };
}
