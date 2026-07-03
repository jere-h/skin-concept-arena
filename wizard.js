// wizard.js
// Submit view controller: the completeness-gated pitch-creation flow.
//
// Flow: item slot (fixed-option select, pre-selected default so it is never
// empty) -> theme tags (toggle chips from a fixed palette, no free-text) ->
// title / description -> optional image URL. The form renders as numbered
// step blocks (01 Slot, 02 Theme, 03 Words, 04 Art) with a LIVE completeness
// checklist above Submit (design spec P0/P1-6): three rows flip from x to
// check as the user types, and the disabled button carries the requirements
// count ("2 of 3 requirements met") so the gate is always self-explanatory.
// Submit stays disabled until title, description, and at least one selected
// tag are all present. On submit
// it builds a Pitch via deps.store.addPitch — stamped with the device-local
// profile's owner_id so the Locker can find it — and shows a confirmation
// badge that deliberately carries NO score or rank (the submitter/voter
// access split is structural: this view never computes or renders ranking).
// The confirmation funnels to BOTH progression surfaces (PRD P0-2 dual
// funnel): the Locker for the pitch's battles, the Arena for self-driven rank.
//
// Dependencies are injected via `deps`: deps.store for persistence and
// deps.profileId (the device-local creator id from profile.ensureProfile) to
// stamp owner_id. This module never imports the ranking or progression
// modules — the access-split guard asserts that statically, and its dynamic
// twin injects a spy ranking dependency that MUST never be called here
// (finding 6). We touch deps.store only.

// Fixed item slots for the seeded game. A select needs a real default so
// item_slot is never empty (finding 3) — the first option is pre-selected.
const ITEM_SLOTS = [
  'Character Skin',
  'Weapon Skin',
  'Headgear',
  'Back Bling / Cape',
  'Emote',
  'Mount',
  'Loading Screen',
];

// Fixed theme palette: 7 distinct TONALITIES (how a skin feels, not what
// genre it borrows), so any concept — from any setting — can be tagged by
// vibe. Toggle chips only — no free-text entry (finding 4).
const THEME_TAGS = [
  'Cute',
  'Badass',
  'Elegant',
  'Creepy',
  'Goofy',
  'Gritty',
  'Dreamy',
];

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slotOptionsMarkup() {
  return ITEM_SLOTS.map(function (slot, index) {
    const selected = index === 0 ? ' selected' : '';
    return (
      '<option value="' + escapeHtml(slot) + '"' + selected + '>' +
      escapeHtml(slot) +
      '</option>'
    );
  }).join('');
}

function chipsMarkup() {
  return THEME_TAGS.map(function (tag) {
    return (
      '<button type="button" class="chip" data-tag="' +
      escapeHtml(tag) +
      '" aria-pressed="false">' +
      escapeHtml(tag) +
      '</button>'
    );
  }).join('');
}

// One row of the live completeness checklist. The mark span flips between
// '✗' (--ink-3) and '✓' (--accent) as refreshGate re-evaluates the form.
function checkRowMarkup(key, label) {
  return (
    '<li class="check" data-check="' + escapeHtml(key) + '">' +
      '<span class="check__mark" aria-hidden="true">✗</span>' +
      '<span class="check__label">' + escapeHtml(label) + '</span>' +
    '</li>'
  );
}

function templateMarkup() {
  return (
    '<header class="view-head fade-in">' +
      '<h1 class="view-title">Submit a skin concept</h1>' +
      '<p class="view-lede">Pitch a look for the game. Pick a slot, tag the ' +
      'vibe, and describe what players would see in-game.</p>' +
    '</header>' +
    '<form id="wizard-form" class="wizard-form fade-in" novalidate autocomplete="off">' +
      '<section class="step">' +
        '<p class="step-eyebrow">01 · Item slot</p>' +
        '<div class="field">' +
          '<label class="field-label" for="wizard-slot">Item slot</label>' +
          '<select id="wizard-slot" class="field-input" name="item_slot">' +
            slotOptionsMarkup() +
          '</select>' +
        '</div>' +
      '</section>' +
      '<section class="step">' +
        '<p class="step-eyebrow">02 · Theme</p>' +
        '<div class="field">' +
          '<span class="field-label" id="wizard-tags-label">Theme tags</span>' +
          '<p class="field-hint">Choose at least one.</p>' +
          '<div id="wizard-tags" class="chip-row" role="group" ' +
            'aria-labelledby="wizard-tags-label">' +
            chipsMarkup() +
          '</div>' +
        '</div>' +
      '</section>' +
      '<section class="step">' +
        '<p class="step-eyebrow">03 · Words</p>' +
        '<div class="field">' +
          '<label class="field-label" for="wizard-title">Title</label>' +
          '<input id="wizard-title" class="field-input" name="title" type="text" ' +
            'maxlength="80" placeholder="e.g. Tidebreaker Vanguard" required>' +
        '</div>' +
        '<div class="field">' +
          '<label class="field-label" for="wizard-desc">Description</label>' +
          '<textarea id="wizard-desc" class="field-input field-textarea" ' +
            'name="description" rows="4" maxlength="600" ' +
            'placeholder="What does it look like? Silhouette, palette, effects, ' +
            'the moment it shines." required></textarea>' +
        '</div>' +
      '</section>' +
      '<section class="step">' +
        '<p class="step-eyebrow">04 · Art</p>' +
        '<div class="field">' +
          '<label class="field-label" for="wizard-image">' +
            'Image URL <span class="field-optional">(optional)</span>' +
          '</label>' +
          '<input id="wizard-image" class="field-input" name="image_url" ' +
            'type="url" inputmode="url" placeholder="https://... (leave blank ' +
            'to use a generated thumbnail)">' +
        '</div>' +
      '</section>' +
      '<div class="wizard-gate">' +
        '<ul id="wizard-checklist" class="checklist" ' +
          'aria-label="Submission requirements">' +
          checkRowMarkup('title', 'Title written') +
          checkRowMarkup('desc', 'Description written') +
          checkRowMarkup('tag', 'At least one theme tag') +
        '</ul>' +
        '<div class="wizard-actions">' +
          '<button id="wizard-submit" class="btn btn-primary" type="submit" ' +
            'disabled>0 of 3 requirements met</button>' +
        '</div>' +
        '<p id="wizard-confirm" class="badge" role="status" aria-live="polite" ' +
          'hidden></p>' +
      '</div>' +
    '</form>'
  );
}

/**
 * Initialise the Submit view.
 * @param {HTMLElement} rootEl - the section#view-submit container.
 * @param {{ store: object, profileId?: string|null,
 *           onPitchSubmitted?: function }} deps - injected deps.
 *   deps.store persists the pitch; deps.profileId stamps owner_id on it;
 *   deps.onPitchSubmitted is the app.js-owned celebration hook, fired after
 *   every successful submit (this view never learns what it celebrates).
 */
export function initWizard(rootEl, deps) {
  if (!rootEl) return;
  const store = deps && deps.store;
  if (!store || typeof store.addPitch !== 'function') return;
  // Device-local creator identity. Absent/malformed degrades to null, which is
  // exactly the sample/pre-add-on pitch shape (owner_id null: belongs to no
  // one, appears in everyone's Arena, never in a Locker).
  const profileId =
    deps && typeof deps.profileId === 'string' && deps.profileId
      ? deps.profileId
      : null;
  // App.js-derived celebration hook — an opaque "a pitch landed" signal. Only
  // this zero-argument callback crosses the seam; what it celebrates (badges,
  // rank) is computed on the other side. Optional and fail-safe.
  const onPitchSubmitted =
    deps && typeof deps.onPitchSubmitted === 'function'
      ? deps.onPitchSubmitted
      : null;
  // NOTE: a ranking (or progression) dependency, if ever injected by a test,
  // MUST NOT be used in this view.

  rootEl.innerHTML = templateMarkup();

  const form = rootEl.querySelector('#wizard-form');
  const slotEl = rootEl.querySelector('#wizard-slot');
  const tagsEl = rootEl.querySelector('#wizard-tags');
  const titleEl = rootEl.querySelector('#wizard-title');
  const descEl = rootEl.querySelector('#wizard-desc');
  const imageEl = rootEl.querySelector('#wizard-image');
  const submitEl = rootEl.querySelector('#wizard-submit');
  const confirmEl = rootEl.querySelector('#wizard-confirm');
  const checklistEl = rootEl.querySelector('#wizard-checklist');

  if (!form || !submitEl) return;

  // The submit button's enabled label; while disabled it carries the live
  // requirements count instead, so the gate always explains itself.
  const SUBMIT_LABEL = 'Add to the arena';

  function selectedTags() {
    if (!tagsEl) return [];
    const chosen = tagsEl.querySelectorAll('.chip.is-selected');
    return Array.prototype.map.call(chosen, function (chip) {
      return chip.getAttribute('data-tag') || '';
    });
  }

  // The three completeness requirements, evaluated live. Keys match the
  // checklist rows' data-check attributes.
  function requirementsMet() {
    return {
      title: !!(titleEl && titleEl.value.trim()),
      desc: !!(descEl && descEl.value.trim()),
      tag: selectedTags().length >= 1,
    };
  }

  function isComplete() {
    const met = requirementsMet();
    return met.title && met.desc && met.tag;
  }

  // Flip each checklist row's mark/state to match the live requirements.
  // Purely presentational and fail-safe: a missing row never blocks the gate.
  function updateChecklist(met) {
    if (!checklistEl) return;
    for (const key of Object.keys(met)) {
      const row = checklistEl.querySelector('[data-check="' + key + '"]');
      if (!row) continue;
      row.classList.toggle('is-met', met[key]);
      const mark = row.querySelector('.check__mark');
      if (mark) mark.textContent = met[key] ? '✓' : '✗';
    }
  }

  function refreshGate() {
    const met = requirementsMet();
    const count = (met.title ? 1 : 0) + (met.desc ? 1 : 0) + (met.tag ? 1 : 0);
    submitEl.disabled = count < 3;
    // Disabled: the requirements count ("2 of 3 requirements met") converts
    // the mystery-gray button into a legible quest; complete: the action.
    submitEl.textContent =
      count < 3 ? count + ' of 3 requirements met' : SUBMIT_LABEL;
    updateChecklist(met);
  }

  function toggleChip(chip) {
    const selected = chip.classList.toggle('is-selected');
    chip.setAttribute('aria-pressed', selected ? 'true' : 'false');
    refreshGate();
  }

  // Toggle chips via delegation — fixed palette, no free-text (finding 4).
  if (tagsEl) {
    tagsEl.addEventListener('click', function (event) {
      const chip = event.target && event.target.closest
        ? event.target.closest('.chip')
        : null;
      if (chip && tagsEl.contains(chip)) {
        toggleChip(chip);
      }
    });
  }

  // Live completeness gate as the user types.
  if (titleEl) titleEl.addEventListener('input', refreshGate);
  if (descEl) descEl.addEventListener('input', refreshGate);

  function showConfirmation(pitch) {
    if (!confirmEl) return;
    const title = (pitch && pitch.title) || 'Your concept';
    // Confirmation carries NO score or rank — structural access split. It
    // funnels to BOTH progression surfaces instead (PRD P0-2 dual funnel):
    // the Locker tracks the pitch, the Arena pays rank while it calibrates.
    confirmEl.textContent =
      'Added "' + title + '" to the arena. Track its battles in your ' +
      'Locker, and earn rank in the Arena while it calibrates.';
    confirmEl.hidden = false;
    confirmEl.classList.add('is-visible');
  }

  function hideConfirmation() {
    if (!confirmEl) return;
    confirmEl.hidden = true;
    confirmEl.classList.remove('is-visible');
  }

  function resetForm() {
    if (titleEl) titleEl.value = '';
    if (descEl) descEl.value = '';
    if (imageEl) imageEl.value = '';
    // Slot keeps its pre-selected default so it is never empty (finding 3).
    if (slotEl && ITEM_SLOTS.length) slotEl.value = ITEM_SLOTS[0];
    // Clear tag selection.
    if (tagsEl) {
      const chips = tagsEl.querySelectorAll('.chip');
      Array.prototype.forEach.call(chips, function (chip) {
        chip.classList.remove('is-selected');
        chip.setAttribute('aria-pressed', 'false');
      });
    }
    refreshGate();
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!isComplete()) {
      refreshGate();
      return;
    }

    // item_slot always has a value (default option pre-selected); fall back to
    // the first slot defensively so it is never empty (finding 3).
    const slotValue =
      (slotEl && slotEl.value) || (ITEM_SLOTS.length ? ITEM_SLOTS[0] : '');

    const pitch = {
      item_slot: slotValue,
      theme_tags: selectedTags(),
      title: titleEl ? titleEl.value.trim() : '',
      description: descEl ? descEl.value.trim() : '',
      image_url: imageEl ? imageEl.value.trim() : '',
      // Ownership stamp so the Locker can find this pitch and the Arena can
      // exclude it from the owner's own pairs. null when the device has no
      // profile — the sample/pre-add-on shape, tolerated everywhere.
      owner_id: profileId,
    };

    // store.addPitch assigns id + created_at and persists; returns the record.
    // Ranking/progression are deliberately unreachable here (access split).
    let stored = pitch;
    try {
      stored = store.addPitch(pitch) || pitch;
    } catch (err) {
      // Persistence falls back to in-memory in store.js; never surface a crash.
      stored = pitch;
    }

    resetForm();
    showConfirmation(stored);

    // Celebration pass, last: the submit is already committed and confirmed.
    // Swallow any fault — celebration is decoration and must never break (or
    // appear to break) the submit itself.
    if (onPitchSubmitted) {
      try {
        onPitchSubmitted();
      } catch (_err) {
        /* never let a celebration fault surface here */
      }
    }
  });

  // A fresh confirmation should clear once the user starts a new pitch.
  form.addEventListener('input', function () {
    if (confirmEl && !confirmEl.hidden) hideConfirmation();
  });

  // Establish the initial disabled state.
  refreshGate();
}

export default initWizard;
