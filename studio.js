// studio.js
// Studio view controller: a passphrase gate, then the leaderboard.
//
// This is the ONLY view that imports/derives rank. The submitter (wizard.js) and
// voter (arena.js) views never compute or render any score or rank; that access
// split is structural, enforced by the import graph (finding 6). ranking.rank is
// called here and nowhere in those paths.
//
// checkPassphrase(input) compares the input against the STUDIO_PASSPHRASE constant
// (the single source of truth lives in app.js). A correct passphrase reveals the
// ranking.rank leaderboard: a table with tabular numeric columns (comparison
// count + win-rate, plus a thin decorative win-rate bar per row) and a neutral
// 'needs more votes' icon+label chip on each below-threshold row
// (acceptance criterion 5). An incorrect passphrase shows an inline error and
// keeps the dashboard hidden.
//
// The passphrase is a DOCUMENTED client-side constant, NOT a security boundary
// (explicit non-goal): anyone reading the bundle can find it. It only keeps rank
// out of the submitter/voter surface by default, matching the product's intent.

import { STUDIO_PASSPHRASE, GAME, COMPARISON_THRESHOLD } from './app.js';
// Pure bundled data for the scout report panel (drop provenance + cull
// stats). No logic crosses this import; studio.js remains the only caller of
// ranking.rank and still never imports progression.
import { SCOUT_DROPS } from './scout-data.js';

/**
 * True when `input` matches the studio passphrase constant.
 * Standalone export so the gate logic is testable and there is one comparison.
 * @param {string} input
 * @returns {boolean}
 */
export function checkPassphrase(input) {
  return String(input == null ? '' : input) === STUDIO_PASSPHRASE;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Render a win-rate as a whole-percent string for the tabular column.
function formatRate(rate) {
  const value = Number.isFinite(rate) ? rate : 0;
  return Math.round(value * 100) + '%';
}

// Reveal a `.fade-in` block we created ourselves. The shared IntersectionObserver
// in app.js may not observe nodes built after it ran, so we add `.is-visible`
// directly: under prefers-reduced-motion:no-preference the CSS animates the
// entrance, otherwise `.fade-in` is already fully visible. This guarantees the
// gate/board are never stuck invisible.
function reveal(el) {
  if (!el) return;
  const apply = function () { el.classList.add('is-visible'); };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(function () { requestAnimationFrame(apply); });
  } else {
    apply();
  }
}

function gameContext() {
  const name = GAME && GAME.name ? String(GAME.name) : 'the game';
  return 'Design-team results for ' + escapeHtml(name) +
    '. Voters and submitters never see rank or win-rate.';
}

// The Studio internal markup. Class names match the design system in styles.css
// (#studio-gate, .gate__*, #studio-board, table.leaderboard, .rank, .num,
// .is-below-threshold, .needs-more). No score/rank is present until unlock.
function templateMarkup() {
  return (
    '<header class="view-head fade-in">' +
      '<h1 class="view-title">Studio leaderboard</h1>' +
      '<p class="view-lede">' + gameContext() + '</p>' +
    '</header>' +
    '<form id="studio-gate" class="studio-gate fade-in" novalidate autocomplete="off">' +
      '<label class="gate__label" for="studio-pass">Studio passphrase</label>' +
      '<div class="gate__row">' +
        '<input id="studio-pass" name="passphrase" type="password" ' +
          'autocomplete="off" autocapitalize="off" spellcheck="false" ' +
          'placeholder="Enter the studio passphrase" ' +
          'aria-describedby="studio-error studio-note">' +
        '<button type="submit" class="gate__submit">Unlock</button>' +
      '</div>' +
      '<p id="studio-error" role="alert" aria-live="assertive"></p>' +
      '<p id="studio-note" class="gate-note">The passphrase is a shared, ' +
        'client-side constant, not a security boundary. It keeps rank off the ' +
        'submit and voting screens by default.</p>' +
    '</form>' +
    '<div id="studio-board" class="studio-board" hidden></div>'
  );
}

// The neutral "needs more votes" chip's icon: a small clock (votes pending),
// inline SVG in currentColor — no color semantics, so it never collides with
// tier metals or reads as an error state (design spec P1-8).
const NEEDS_MORE_ICON =
  '<svg class="needs-more__icon" viewBox="0 0 12 12" aria-hidden="true" ' +
    'focusable="false">' +
    '<path d="M6 1a5 5 0 1 0 0 10A5 5 0 0 0 6 1Zm.6 2.2v2.55l1.95 1.17-.62 1.03' +
    'L5.4 6.55V3.2h1.2Z" fill="currentColor"/>' +
  '</svg>';

// The scout attribution chips: text + border, never color alone. Provenance
// (the two real-world seeds) renders as a muted line under the title with the
// rationale note carried in the row's title attribute — the full story lives
// in the scout report panel below the board.
function scoutChipsMarkup(pitch) {
  if (!pitch || pitch.origin !== 'scout') return '';
  let chips = '<span class="scout-chip">Scout</span>';
  if (pitch.retired) chips += '<span class="retired-chip">retired</span>';
  return chips;
}

function scoutProvenanceMarkup(pitch) {
  if (!pitch || pitch.origin !== 'scout') return '';
  const insp = pitch.inspiration;
  const sources = insp && Array.isArray(insp.sources) ? insp.sources : [];
  if (!sources.length) return '';
  return (
    '<span class="scout-src">Scouted from: ' +
    escapeHtml(sources.join(' × ')) +
    '</span>'
  );
}

// Build the leaderboard table from RankRow[]. Numeric columns carry `.num`
// (ink text, tabular numerals); the win-rate cell adds a thin accent bar
// (decoration on top of the accessible table, never a replacement), and
// below-threshold rows get `.is-below-threshold` plus the neutral icon+label
// `.needs-more` chip. Titles are escaped since they are user-authored.
// pitchById attributes scout rows (chip + provenance) — the Studio is the ONE
// surface where scouts are labeled; the Arena stays blind.
function boardMarkup(rows, threshold, pitchById) {
  if (!rows.length) {
    return (
      '<p class="board-empty">No pitches yet. Add one from the ' +
      'Submit tab to populate the leaderboard.</p>'
    );
  }

  const lookup = pitchById instanceof Map ? pitchById : new Map();

  const bodyRows = rows.map(function (row, index) {
    const pitch = lookup.get(row.id);
    const isScout = !!(pitch && pitch.origin === 'scout');
    const belowThreshold = !!row.needs_more_votes;
    const classes = [];
    if (belowThreshold) classes.push('is-below-threshold');
    if (isScout) classes.push('is-scout');
    const rowClass = classes.length ? ' class="' + classes.join(' ') + '"' : '';
    // The rationale note as a plain tooltip; the report panel repeats it.
    const note =
      isScout && pitch.inspiration && typeof pitch.inspiration.note === 'string'
        ? ' title="' + escapeHtml(pitch.inspiration.note) + '"'
        : '';
    const flag = belowThreshold
      ? '<span class="needs-more">' + NEEDS_MORE_ICON +
        '<span>needs more votes</span></span>'
      : '';
    // Bar width: the win-rate as a whole percent, clamped so a malformed rate
    // can never overflow the track. The VALUE stays text in ink; only the bar
    // wears the accent (dataviz mark spec).
    const rate = Number.isFinite(row.win_rate) ? row.win_rate : 0;
    const pct = Math.max(0, Math.min(100, Math.round(rate * 100)));
    return (
      '<tr' + rowClass + note + '>' +
        '<td class="rank">' + (index + 1) + '</td>' +
        '<th scope="row" class="board-title">' + escapeHtml(row.title) +
          scoutChipsMarkup(pitch) + scoutProvenanceMarkup(pitch) + '</th>' +
        '<td class="num">' + (row.comparisons | 0) + '</td>' +
        '<td class="num">' + (row.wins | 0) + '</td>' +
        '<td class="num rate-cell">' +
          '<span class="rate-value">' + formatRate(row.win_rate) + '</span>' +
          '<span class="rate-bar" aria-hidden="true">' +
            '<span class="rate-bar__fill" style="width:' + pct + '%"></span>' +
          '</span>' +
        '</td>' +
        '<td class="board-status">' + flag + '</td>' +
      '</tr>'
    );
  }).join('');

  const caption =
    'Ranked by head-to-head win rate. Concepts with fewer than ' +
    (threshold | 0) + ' comparisons are flagged for more votes.';

  return (
    '<table class="leaderboard">' +
      '<caption>' + escapeHtml(caption) + '</caption>' +
      '<thead>' +
        '<tr>' +
          '<th scope="col" class="rank">#</th>' +
          '<th scope="col">Concept</th>' +
          '<th scope="col" class="num">Comparisons</th>' +
          '<th scope="col" class="num">Wins</th>' +
          '<th scope="col" class="num">Win rate</th>' +
          '<th scope="col">Status</th>' +
        '</tr>' +
      '</thead>' +
      '<tbody>' + bodyRows + '</tbody>' +
    '</table>'
  );
}

// --- Scout report (docs/scout-pipeline-tech-spec.md §3.3) --------------------
//
// One block per drop, newest first: provenance, the honest cull ratio, and
// each scout's rotation status + performance so far. Statuses: 'active'
// (in Arena rotation), 'retired' (rolled out of the freshness window), or
// 'arrives <date>' (shipped in the bundle, not yet merged by active_from).
// The Arena additionally caps scouts to a share of each served pool, so an
// active scout with few comparisons may simply be waiting for rotation.
function scoutReportMarkup(pitchById, rowById) {
  const drops = Array.isArray(SCOUT_DROPS) ? SCOUT_DROPS.slice().reverse() : [];
  if (!drops.length) return '';

  const blocks = drops.map(function (drop) {
    const stats = drop && drop.stats ? drop.stats : {};
    const cull =
      Number.isFinite(stats.shipped) && Number.isFinite(stats.generated)
        ? 'shipped ' + stats.shipped + ' of ' + stats.generated + ' generated'
        : '';
    const pitches = Array.isArray(drop.pitches) ? drop.pitches : [];
    const rows = pitches.map(function (dropPitch) {
      const stored = pitchById.get(dropPitch.id);
      const row = rowById.get(dropPitch.id);
      let status;
      if (!stored) {
        status = 'arrives ' + escapeHtml(dropPitch.active_from || 'soon');
      } else if (stored.retired) {
        status = 'retired';
      } else {
        status = 'active';
      }
      const perf = row
        ? (row.comparisons | 0) + ' battles · ' + formatRate(row.win_rate)
        : '—';
      const insp = dropPitch.inspiration || {};
      const sources = Array.isArray(insp.sources) ? insp.sources.join(' × ') : '';
      const note = typeof insp.note === 'string' ? insp.note : '';
      return (
        '<li class="scout-report__row">' +
          '<p class="scout-report__title">' + escapeHtml(dropPitch.title) +
            '<span class="scout-report__status">' + status + '</span>' +
            '<span class="scout-report__perf">' + perf + '</span></p>' +
          '<p class="scout-report__src">' + escapeHtml(sources) + '</p>' +
          (note ? '<p class="scout-report__note">' + escapeHtml(note) + '</p>' : '') +
        '</li>'
      );
    }).join('');

    return (
      '<section class="scout-report__drop">' +
        '<h3 class="scout-report__drop-title">' + escapeHtml(drop.drop_id || 'drop') +
          (cull ? '<span class="scout-report__cull">' + escapeHtml(cull) + '</span>' : '') +
        '</h3>' +
        '<ul class="scout-report__rows">' + rows + '</ul>' +
      '</section>'
    );
  }).join('');

  return (
    '<section class="scout-report" aria-labelledby="scout-report-heading">' +
      '<h2 id="scout-report-heading" class="scout-report__heading">Scout report</h2>' +
      '<p class="scout-report__lede">AI-scouted concepts in the pool — blind in ' +
        'the Arena like every pitch, fully attributed here. Each cites the two ' +
        'real-world seeds it was developed from; the cull ratio is what was ' +
        'discarded to ship it. Export the feedback file and commit it to the ' +
        'repo’s <code>feedback/</code> directory to steer the next drop.</p>' +
      '<button type="button" id="studio-export" class="export-btn">' +
        'Export feedback JSON</button>' +
      blocks +
    '</section>'
  );
}

// The board controls strip: the pure-human-taste toggle. Scout rows stay in
// by default (the board is the studio's full read); hiding is one click.
function boardControlsMarkup(hideScouts) {
  return (
    '<div class="studio-toggle">' +
      '<label class="studio-toggle__label">' +
        '<input type="checkbox" id="studio-hide-scouts"' +
          (hideScouts ? ' checked' : '') + '> ' +
        'Hide scouted concepts (human pitches only)' +
      '</label>' +
    '</div>'
  );
}

/**
 * Initialise the Studio view.
 * @param {HTMLElement} rootEl - the section#view-studio container.
 * @param {{ store: object, ranking: object, passphrase?: string, threshold?: number }} deps
 *   deps.store provides loadPitches/loadVotes; deps.ranking.rank derives the board.
 */
export function initStudio(rootEl, deps) {
  if (!rootEl) return;
  const store = deps && deps.store;
  const ranking = deps && deps.ranking;
  if (!store || typeof store.loadPitches !== 'function') return;
  if (!ranking || typeof ranking.rank !== 'function') return;

  // The injected passphrase is authoritative (one source of truth in app.js);
  // fall back to the imported constant so the gate still works if omitted.
  const expected =
    deps && typeof deps.passphrase === 'string' ? deps.passphrase : STUDIO_PASSPHRASE;
  const threshold =
    deps && Number.isFinite(deps.threshold) ? deps.threshold : COMPARISON_THRESHOLD;

  rootEl.innerHTML = templateMarkup();

  const gate = rootEl.querySelector('#studio-gate');
  const passEl = rootEl.querySelector('#studio-pass');
  const errorEl = rootEl.querySelector('#studio-error');
  const boardEl = rootEl.querySelector('#studio-board');

  // Reveal the header + gate entrance ourselves (see reveal()).
  const fadeBlocks = rootEl.querySelectorAll('.fade-in');
  Array.prototype.forEach.call(fadeBlocks, reveal);

  if (!gate || !boardEl) return;

  function showError(message) {
    if (errorEl) errorEl.textContent = message; // #studio-error:empty hides itself
  }

  function clearError() {
    if (errorEl) errorEl.textContent = '';
  }

  // "Hide scouted concepts": session-local toggle so leads can read pure
  // human taste on demand. Scout rows show by default.
  let hideScouts = false;

  function renderBoard() {
    // Re-read the store on each unlock so the board reflects the latest votes.
    const pitches = store.loadPitches();
    const votes = typeof store.loadVotes === 'function' ? store.loadVotes() : [];
    const allRows = ranking.rank(pitches, votes, threshold) || [];

    const pitchById = new Map();
    for (const pitch of Array.isArray(pitches) ? pitches : []) {
      if (pitch && typeof pitch.id === 'string') pitchById.set(pitch.id, pitch);
    }
    const rowById = new Map();
    for (const row of allRows) {
      if (row && typeof row.id === 'string') rowById.set(row.id, row);
    }

    const rows = hideScouts
      ? allRows.filter(function (row) {
          const pitch = pitchById.get(row.id);
          return !(pitch && pitch.origin === 'scout');
        })
      : allRows;

    boardEl.innerHTML =
      boardControlsMarkup(hideScouts) +
      boardMarkup(rows, threshold, pitchById) +
      scoutReportMarkup(pitchById, rowById);

    // Wire the controls fresh each render (innerHTML replaced the nodes).
    const toggleEl = boardEl.querySelector('#studio-hide-scouts');
    if (toggleEl) {
      toggleEl.addEventListener('change', function () {
        hideScouts = !!toggleEl.checked;
        renderBoard();
      });
    }
    const exportEl = boardEl.querySelector('#studio-export');
    if (exportEl) {
      exportEl.addEventListener('click', function () {
        exportFeedback(pitchById, allRows);
      });
    }
  }

  /**
   * Download arena-feedback.json: every scout's performance plus the
   * strongest calibrated human pitches (full copy — they are the next drop's
   * positive exemplars). A lead commits this to feedback/ in the repo; the
   * drop-authoring routine conditions on it. Fail-safe: an export fault
   * never breaks the board.
   */
  function exportFeedback(pitchById, allRows) {
    try {
      const scouts = [];
      const topHuman = [];
      for (const row of allRows) {
        const pitch = pitchById.get(row.id);
        if (pitch && pitch.origin === 'scout') {
          scouts.push({
            id: row.id,
            title: row.title,
            comparisons: row.comparisons,
            wins: row.wins,
            win_rate: row.win_rate,
            retired: !!pitch.retired,
          });
        } else if (pitch && !row.needs_more_votes && topHuman.length < 5) {
          // allRows is already win-rate-sorted; first five calibrated humans.
          topHuman.push({
            title: pitch.title,
            description: pitch.description,
            item_slot: pitch.item_slot,
            theme_tags: pitch.theme_tags,
            comparisons: row.comparisons,
            win_rate: row.win_rate,
          });
        }
      }
      const payload = {
        exported_at: new Date().toISOString(),
        comparison_threshold: threshold,
        scouts: scouts,
        top_human: topHuman,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'arena-feedback.json';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 0);
    } catch (err) {
      console.warn('Feedback export failed.', err);
    }
  }

  function unlock() {
    clearError();
    renderBoard();
    if (boardEl.hidden) {
      boardEl.hidden = false;
      boardEl.classList.add('fade-in');
      reveal(boardEl);
    }
    if (passEl) passEl.value = '';
  }

  gate.addEventListener('submit', function (event) {
    event.preventDefault();
    const entered = passEl ? passEl.value : '';
    // Honour the injected passphrase; equal to checkPassphrase's constant in
    // practice. Both agree, and checkPassphrase stays exported for tests.
    const ok = String(entered) === expected || checkPassphrase(entered);
    if (ok) {
      unlock();
    } else {
      // Incorrect passphrase: inline error, dashboard stays hidden (criterion 5).
      boardEl.hidden = true;
      boardEl.innerHTML = '';
      showError('That passphrase is not right. Check with the design team and try again.');
      if (passEl) {
        passEl.select();
        passEl.focus();
      }
    }
  });

  // Clear the error as soon as the operator edits the field again.
  if (passEl) {
    passEl.addEventListener('input', clearError);
  }
}

export default initStudio;
