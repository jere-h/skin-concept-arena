// tests/logic.test.js
//
// node:test unit tests (NO DOM required for the pure modules) covering the
// four pure/logic surfaces of Skin Concept Arena plus the structural
// access-split guard:
//
//   1. store.js round-trip + fail-safe fallbacks (seeding, save/load, malformed
//      JSON, unavailable/disabled localStorage).
//   2. sampler.pickPair — 'insufficient' with <2 pitches, bias toward the
//      fewest-comparison pitches, never returns a seen pair, 'exhausted' on
//      pair exhaustion; pairKey order-independence.
//   3. ranking.rank — ordering (win_rate desc, comparisons desc, created_at asc)
//      and needs_more_votes exactly when comparisons < threshold.
//   4. Access-split guard (finding 6) — drive the wizard and arena controllers
//      with a spy `ranking` dependency and assert it is NEVER called.
//
// The progression add-on extends this with the TRD test-plan suites:
//
//   5. store.js readKey/writeKey exports — the generic defensive helpers that
//      profile.js persists the progression keys through.
//   6. progression.pitchStatus — rev 2 tier bands, k/5 quantization, band
//      edges, and the no-win_rate own-key leakage assertion.
//   7. Monotonicity property (P0-1/P0-2) — careerPoints/rankFor never step
//      down over a randomized event sequence; peaks outlive live-tier drops;
//      vote points stop exactly at VOTE_POINTS_CAP.
//   8. Career math — careerPoints sums, rank ladder edges, progress01 bounds,
//      nextVotingBadge targets.
//   9. Peak ratchet — maxTier / profile.recordPeaks rise-only semantics;
//      performance badges test peaks, not live tiers.
//  10. Badges — every family's predicate on synthetic ctx; idempotence.
//  11. Owner filtering & calibration priority (TRD suite 7) — ownedPitches
//      with null/absent owner ids, the arena's own-pitch exclusion (own
//      pitches leave the pool BEFORE pickPair, null-owner samples stay for
//      everyone), voter_id stamping + the session-strip hook, and
//      calibrationPriority exactly at the pool-minimum comparison count.
//  12. Access-split guard, extended (TRD suite 8) — static import-graph
//      assertions: wizard.js/arena.js never import ranking OR progression;
//      progression.js/profile.js (and locker.js, once it exists) never import
//      ranking; only studio.js calls ranking.rank.
//  13. Unlock persistence — profile.recordUnlocks union-merge / toast-once,
//      ensureProfile identity, recordRank change detection, fail-safe storage.
//  14. Celebrations — the wizard/arena fire their injected celebration hooks
//      after every submit/vote (and a throwing hook never breaks the action),
//      and locker.checkCelebrations emits each peak/badge/rank event exactly
//      once (the toast-once guarantee, PRD acceptance criterion 8).
//
// These are ES modules; the app modules under test are imported dynamically so
// store.js can be re-evaluated per localStorage scenario (query-string cache
// busting yields a fresh module instance in Node's ESM loader).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Test doubles / minimal environment
// ---------------------------------------------------------------------------

// A localStorage double backed by a Map. Mirrors the Web Storage surface that
// store.js relies on (getItem / setItem / removeItem / clear).
function mockStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    get length() {
      return map.size;
    },
    key(i) {
      return Array.from(map.keys())[i] ?? null;
    },
    _map: map,
  };
}

// A localStorage double that throws on every access (Safari private mode /
// storage-disabled). store.js must fall back to in-memory arrays, not throw.
function throwingStorage() {
  return {
    getItem() {
      throw new Error('storage disabled');
    },
    setItem() {
      throw new Error('storage disabled');
    },
    removeItem() {
      throw new Error('storage disabled');
    },
    clear() {
      throw new Error('storage disabled');
    },
  };
}

// ---- A tiny, forgiving fake DOM for driving the view controllers ----------
//
// The controllers only ever touch the DOM inside their init functions. We do
// not assert anything about what they render; the fake DOM only needs to keep
// them from throwing so we can prove they never reach the injected `ranking`
// dependency. Every listener registered anywhere is captured in LISTENERS so
// the guard test can "drive" the controllers by firing them, and DOM_TOUCHES
// records that the controller actually engaged the DOM (did real work).

let LISTENERS = [];
let DOM_TOUCHES = 0;

function fakeClassList() {
  const set = new Set();
  return {
    add: (...cls) => cls.forEach((c) => set.add(c)),
    remove: (...cls) => cls.forEach((c) => set.delete(c)),
    toggle: (c, force) => {
      if (force === undefined) {
        set.has(c) ? set.delete(c) : set.add(c);
      } else {
        force ? set.add(c) : set.delete(c);
      }
      return set.has(c);
    },
    contains: (c) => set.has(c),
  };
}

class FakeNode {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.classList = fakeClassList();
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
  }
  querySelector() {
    DOM_TOUCHES += 1;
    return new FakeNode();
  }
  querySelectorAll() {
    DOM_TOUCHES += 1;
    return [];
  }
  getElementById() {
    DOM_TOUCHES += 1;
    return new FakeNode();
  }
  addEventListener(type, fn) {
    LISTENERS.push({ type, fn });
  }
  removeEventListener() {}
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  prepend(...nodes) {
    this.children.unshift(...nodes);
  }
  insertBefore(node) {
    this.children.push(node);
    return node;
  }
  removeChild() {}
  remove() {}
  replaceChildren(...nodes) {
    this.children = nodes;
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }
  getAttribute(k) {
    return k in this.attributes ? this.attributes[k] : null;
  }
  removeAttribute(k) {
    delete this.attributes[k];
  }
  hasAttribute(k) {
    return k in this.attributes;
  }
  matches() {
    return false;
  }
  closest() {
    return null;
  }
  contains() {
    return false;
  }
  focus() {}
  blur() {}
  cloneNode() {
    return new FakeNode(this.tagName);
  }
}

function makeDocument() {
  const doc = new FakeNode('#document');
  doc.body = new FakeNode('body');
  doc.head = new FakeNode('head');
  doc.documentElement = new FakeNode('html');
  doc.createElement = (t) => new FakeNode(t);
  doc.createElementNS = (_ns, t) => new FakeNode(t);
  doc.createTextNode = (txt) => {
    const n = new FakeNode('#text');
    n.textContent = txt;
    return n;
  };
  doc.createDocumentFragment = () => new FakeNode('#fragment');
  doc.addEventListener = (type, fn) => LISTENERS.push({ type, fn });
  doc.removeEventListener = () => {};
  return doc;
}

function installFakeEnv() {
  globalThis.window = globalThis;
  globalThis.document = makeDocument();
  globalThis.IntersectionObserver = class {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
}

function resetDomCapture() {
  LISTENERS = [];
  DOM_TOUCHES = 0;
}

function fakeEvent() {
  const node = new FakeNode();
  node.dataset = { id: 'p1', tag: 'frost', view: 'submit' };
  node.value = 'sample text';
  return {
    preventDefault() {},
    stopPropagation() {},
    target: node,
    currentTarget: node,
  };
}

// Fire a snapshot of the captured listeners so re-renders that register new
// listeners mid-iteration don't cause an unbounded loop. Individual handler
// throws are swallowed: this test only cares whether `ranking` gets called.
function driveListeners() {
  const snapshot = LISTENERS.slice();
  for (const { fn } of snapshot) {
    try {
      fn(fakeEvent());
    } catch {
      /* controller behavior under a stub DOM is not under test here */
    }
  }
}

// Install the fake browser environment once, before any app module is imported.
installFakeEnv();
globalThis.localStorage = mockStorage();

// ---------------------------------------------------------------------------
// Data-shape helpers (Pitch / Vote per the contract)
// ---------------------------------------------------------------------------

function makePitch(id, created_at = '2021-01-01T00:00:00.000Z', over = {}) {
  return {
    id,
    item_slot: 'helmet',
    theme_tags: ['frost'],
    title: `Pitch ${id}`,
    description: 'A skin concept description.',
    image_url: '',
    created_at,
    ...over,
  };
}

function makeVote(id, aId, bId, winnerId, created_at = '2021-01-01T00:00:00.000Z') {
  return {
    id,
    pitch_a_id: aId,
    pitch_b_id: bId,
    winner_id: winnerId,
    created_at,
  };
}

// Fresh store module per scenario so it re-reads globalThis.localStorage on
// evaluation and does not share seeded state across tests.
let storeCounter = 0;
async function freshStore() {
  storeCounter += 1;
  return import(`../store.js?case=${storeCounter}`);
}

// ---------------------------------------------------------------------------
// store.js
// ---------------------------------------------------------------------------

describe('store.js — round-trip and fail-safe fallbacks', () => {
  test('seeds the bundled sample data when the keys are absent', async () => {
    globalThis.localStorage = mockStorage();
    const store = await freshStore();
    const { SAMPLE_PITCHES, SAMPLE_VOTES } = await import('../sample-data.js');

    assert.deepEqual(store.loadPitches(), SAMPLE_PITCHES);
    assert.deepEqual(store.loadVotes(), SAMPLE_VOTES);
    assert.ok(SAMPLE_PITCHES.length >= 2, 'sample set has enough pitches to demo');
    assert.ok(SAMPLE_VOTES.length >= 1, 'sample votes present for the leaderboard');
  });

  test('save-then-load returns the same array', async () => {
    globalThis.localStorage = mockStorage();
    const store = await freshStore();

    const pitches = [
      makePitch('p1', '2021-02-01T00:00:00.000Z'),
      makePitch('p2', '2021-02-02T00:00:00.000Z'),
    ];
    store.savePitches(pitches);
    assert.deepEqual(store.loadPitches(), pitches);

    const votes = [makeVote('v1', 'p1', 'p2', 'p1')];
    store.saveVotes(votes);
    assert.deepEqual(store.loadVotes(), votes);
  });

  test('addPitch / addVote append, persist, and return the stored record', async () => {
    globalThis.localStorage = mockStorage();
    const store = await freshStore();

    // Persist explicit empty arrays first so the keys exist and seeding is off.
    store.savePitches([]);
    store.saveVotes([]);

    const storedPitch = store.addPitch(makePitch(undefined, undefined, { id: undefined }));
    assert.ok(storedPitch.id, 'addPitch assigns an id');
    assert.ok(storedPitch.created_at, 'addPitch assigns created_at when absent');
    const pitches = store.loadPitches();
    assert.equal(pitches.length, 1);
    assert.equal(pitches[0].id, storedPitch.id);

    const storedVote = store.addVote(makeVote(undefined, storedPitch.id, storedPitch.id, storedPitch.id));
    assert.ok(storedVote.id, 'addVote assigns an id');
    const votes = store.loadVotes();
    assert.equal(votes.length, 1);
    assert.equal(votes[0].id, storedVote.id);
  });

  test('malformed JSON falls back safely to an array without throwing', async () => {
    const ls = mockStorage();
    ls.setItem('sca.pitches.v1', '{not valid json');
    ls.setItem('sca.votes.v1', '<<<broken>>>');
    globalThis.localStorage = ls;
    const store = await freshStore();

    let pitches;
    let votes;
    assert.doesNotThrow(() => {
      pitches = store.loadPitches();
      votes = store.loadVotes();
    });
    assert.ok(Array.isArray(pitches), 'malformed pitches JSON yields an array');
    assert.ok(Array.isArray(votes), 'malformed votes JSON yields an array');
  });

  test('unavailable localStorage falls back to in-memory arrays', async () => {
    delete globalThis.localStorage;
    const store = await freshStore();

    let pitches;
    assert.doesNotThrow(() => {
      pitches = store.loadPitches();
      store.loadVotes();
    });
    assert.ok(Array.isArray(pitches), 'reads return an array with no storage');

    // Writes and appends must not throw and should return a usable record.
    let rec;
    assert.doesNotThrow(() => {
      store.savePitches([]);
      rec = store.addPitch(makePitch('mem1'));
    });
    assert.ok(rec && rec.id, 'addPitch returns the stored record in-memory');

    // Restore a working double for later tests.
    globalThis.localStorage = mockStorage();
  });

  test('disabled/throwing localStorage never propagates an error', async () => {
    globalThis.localStorage = throwingStorage();
    const store = await freshStore();

    assert.doesNotThrow(() => {
      store.loadPitches();
      store.loadVotes();
      store.savePitches([makePitch('x')]);
      store.saveVotes([]);
      store.addPitch(makePitch('y'));
      store.addVote(makeVote('z', 'a', 'b', 'a'));
    });

    globalThis.localStorage = mockStorage();
  });
});

// ---------------------------------------------------------------------------
// sampler.js
// ---------------------------------------------------------------------------

describe('sampler.pickPair — pairing logic', () => {
  test('pairKey is order-independent', async () => {
    const sampler = await import('../sampler.js');
    assert.equal(sampler.pairKey('a', 'b'), sampler.pairKey('b', 'a'));
    assert.notEqual(sampler.pairKey('a', 'b'), sampler.pairKey('a', 'c'));
  });

  test("returns 'insufficient' with fewer than 2 pitches", async () => {
    const sampler = await import('../sampler.js');

    const empty = sampler.pickPair([], [], new Set());
    assert.equal(empty.status, 'insufficient');
    assert.equal(empty.pair, null);

    const one = sampler.pickPair([makePitch('only')], [], new Set());
    assert.equal(one.status, 'insufficient');
    assert.equal(one.pair, null);
  });

  test('biases toward the fewest-comparison pitches', async () => {
    const sampler = await import('../sampler.js');

    const A = makePitch('A', '2021-01-01T00:00:00.000Z');
    const B = makePitch('B', '2021-01-02T00:00:00.000Z');
    const C = makePitch('C', '2021-01-03T00:00:00.000Z');
    const D = makePitch('D', '2021-01-04T00:00:00.000Z');
    // A and D each accrue 3 comparisons; B and C have zero.
    const votes = [
      makeVote('v1', 'A', 'D', 'A'),
      makeVote('v2', 'A', 'D', 'A'),
      makeVote('v3', 'A', 'D', 'A'),
    ];

    const res = sampler.pickPair([A, B, C, D], votes, new Set());
    assert.equal(res.status, 'ok');
    const ids = res.pair.map((p) => p.id).sort();
    assert.deepEqual(ids, ['B', 'C'], 'the two zero-comparison pitches are chosen');
  });

  test('never returns a pair already in seenPairs', async () => {
    const sampler = await import('../sampler.js');

    const A = makePitch('A', '2021-01-01T00:00:00.000Z');
    const B = makePitch('B', '2021-01-02T00:00:00.000Z');
    const C = makePitch('C', '2021-01-03T00:00:00.000Z');
    const seen = new Set([sampler.pairKey('A', 'B')]);

    const res = sampler.pickPair([A, B, C], [], seen);
    assert.equal(res.status, 'ok');
    const key = sampler.pairKey(res.pair[0].id, res.pair[1].id);
    assert.ok(!seen.has(key), 'the returned pair is not one already seen');
  });

  test("reports 'exhausted' when the only possible pair is already seen", async () => {
    const sampler = await import('../sampler.js');

    const A = makePitch('A', '2021-01-01T00:00:00.000Z');
    const B = makePitch('B', '2021-01-02T00:00:00.000Z');
    const seen = new Set([sampler.pairKey('A', 'B')]);

    const res = sampler.pickPair([A, B], [], seen);
    assert.equal(res.status, 'exhausted');
    assert.equal(res.pair, null);
  });
});

// ---------------------------------------------------------------------------
// ranking.js
// ---------------------------------------------------------------------------

describe('ranking.rank — ordering and needs_more_votes', () => {
  function rowById(rows, id) {
    return rows.find((r) => r.id === id);
  }

  test('orders primarily by win_rate descending', async () => {
    const ranking = await import('../ranking.js');

    const P1 = makePitch('P1', '2021-01-01T00:00:00.000Z');
    const P2 = makePitch('P2', '2021-01-02T00:00:00.000Z');
    const P3 = makePitch('P3', '2021-01-03T00:00:00.000Z');
    const votes = [
      makeVote('v1', 'P1', 'P3', 'P1'),
      makeVote('v2', 'P1', 'P3', 'P1'),
      makeVote('v3', 'P1', 'P2', 'P1'),
      makeVote('v4', 'P2', 'P3', 'P2'),
    ];

    const rows = ranking.rank([P1, P2, P3], votes, 5);
    assert.deepEqual(rows.map((r) => r.id), ['P1', 'P2', 'P3']);

    const r1 = rowById(rows, 'P1');
    assert.equal(r1.comparisons, 3);
    assert.equal(r1.wins, 3);
    assert.ok(Math.abs(r1.win_rate - 1) < 1e-9);

    const r2 = rowById(rows, 'P2');
    assert.ok(Math.abs(r2.win_rate - 0.5) < 1e-9);

    const r3 = rowById(rows, 'P3');
    assert.ok(Math.abs(r3.win_rate - 0) < 1e-9);
  });

  test('breaks a win_rate tie by comparisons descending (over created_at)', async () => {
    const ranking = await import('../ranking.js');

    // A is created LATER than B, so a created_at-only tiebreak would rank B
    // first; comparisons-descending must put the busier A first.
    const A = makePitch('A', '2021-12-31T00:00:00.000Z');
    const B = makePitch('B', '2021-01-01T00:00:00.000Z');
    const C = makePitch('C', '2021-06-01T00:00:00.000Z');
    const votes = [
      makeVote('v1', 'A', 'C', 'A'),
      makeVote('v2', 'A', 'C', 'A'),
      makeVote('v3', 'B', 'C', 'B'),
    ];

    const rows = ranking.rank([A, B, C], votes, 5);
    // A and B both win_rate 1.0; A has 2 comparisons, B has 1.
    assert.equal(rows[0].id, 'A');
    assert.equal(rows[1].id, 'B');
    assert.equal(rows[2].id, 'C');
  });

  test('breaks a win_rate + comparisons tie by created_at ascending', async () => {
    const ranking = await import('../ranking.js');

    const A = makePitch('A', '2021-01-01T00:00:00.000Z');
    const B = makePitch('B', '2021-01-02T00:00:00.000Z');
    const X = makePitch('X', '2021-01-03T00:00:00.000Z');
    const votes = [
      makeVote('v1', 'A', 'X', 'A'),
      makeVote('v2', 'B', 'X', 'B'),
    ];

    const rows = ranking.rank([A, B, X], votes, 5);
    // A and B: win_rate 1.0, comparisons 1 each. A created first -> first.
    assert.equal(rows[0].id, 'A');
    assert.equal(rows[1].id, 'B');
  });

  test('sets needs_more_votes exactly when comparisons < threshold', async () => {
    const ranking = await import('../ranking.js');

    const H = makePitch('H', '2021-01-01T00:00:00.000Z');
    const L = makePitch('L', '2021-01-02T00:00:00.000Z');
    const M = makePitch('M', '2021-01-03T00:00:00.000Z');
    const votes = [
      makeVote('v1', 'H', 'L', 'H'),
      makeVote('v2', 'H', 'M', 'H'),
      makeVote('v3', 'H', 'L', 'H'),
    ];
    const threshold = 3;

    const rows = ranking.rank([H, L, M], votes, threshold);
    const h = rowById(rows, 'H'); // 3 comparisons -> NOT < 3
    const l = rowById(rows, 'L'); // 2 comparisons -> < 3
    const m = rowById(rows, 'M'); // 1 comparison  -> < 3

    assert.equal(h.comparisons, 3);
    assert.equal(h.needs_more_votes, false);
    assert.equal(l.comparisons, 2);
    assert.equal(l.needs_more_votes, true);
    assert.equal(m.comparisons, 1);
    assert.equal(m.needs_more_votes, true);
  });

  test('a pitch with zero comparisons has win_rate 0 and needs_more_votes true', async () => {
    const ranking = await import('../ranking.js');

    const lonely = makePitch('L0', '2021-01-01T00:00:00.000Z');
    const rows = ranking.rank([lonely], [], 5);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].comparisons, 0);
    assert.equal(rows[0].wins, 0);
    assert.ok(Math.abs(rows[0].win_rate - 0) < 1e-9);
    assert.equal(rows[0].needs_more_votes, true);
  });
});

// ---------------------------------------------------------------------------
// Access-split guard (finding 6)
// ---------------------------------------------------------------------------
//
// The submitter (wizard) and voter (arena) views must NEVER compute or render a
// score/rank. The seam is structural: both receive a `ranking` dependency by
// injection but must never call it. We drive each controller through a stub DOM
// with a spy `ranking` and assert `ranking.rank` is never invoked.

describe('access-split guard — wizard and arena never call ranking (finding 6)', () => {
  function makeStoreStub() {
    return {
      loadPitches: () => [
        makePitch('p1', '2021-01-01T00:00:00.000Z'),
        makePitch('p2', '2021-01-02T00:00:00.000Z'),
      ],
      loadVotes: () => [],
      savePitches: () => {},
      saveVotes: () => {},
      addPitch: (p) => ({ id: 'new-pitch', created_at: '2021-01-03T00:00:00.000Z', ...p }),
      addVote: (v) => ({ id: 'new-vote', created_at: '2021-01-03T00:00:00.000Z', ...v }),
    };
  }

  function makeRankingSpy() {
    const spy = { calls: 0 };
    spy.rank = (...args) => {
      spy.calls += 1;
      spy.lastArgs = args;
      return [];
    };
    return spy;
  }

  test('initWizard never calls the injected ranking dependency', async () => {
    const { initWizard } = await import('../wizard.js');
    const store = makeStoreStub();
    const ranking = makeRankingSpy();

    resetDomCapture();
    const root = new FakeNode('section');
    try {
      initWizard(root, { store, ranking });
    } catch {
      /* controller wiring under a stub DOM may be imperfect; ranking is the assertion */
    }
    // "Drive" the wizard: fire every registered handler (submit, chip clicks,
    // input changes) to exercise the completeness gate and submit path.
    driveListeners();

    assert.equal(ranking.calls, 0, 'wizard must never derive a score/rank');
    assert.ok(DOM_TOUCHES > 0, 'wizard actually engaged the DOM (did real work)');
  });

  test('initArena never calls the injected ranking dependency', async () => {
    const { initArena } = await import('../arena.js');
    const store = makeStoreStub();
    const ranking = makeRankingSpy();

    // A sampler stub that keeps returning a valid pair so the arena renders
    // cards and wires vote handlers (exercising the vote -> re-sample loop).
    const sampler = {
      pickPair: () => ({
        status: 'ok',
        pair: [
          makePitch('p1', '2021-01-01T00:00:00.000Z'),
          makePitch('p2', '2021-01-02T00:00:00.000Z'),
        ],
      }),
      pairKey: (a, b) => [a, b].sort().join('::'),
    };

    resetDomCapture();
    const root = new FakeNode('section');
    try {
      initArena(root, { store, sampler, ranking });
    } catch {
      /* ditto */
    }
    driveListeners();

    assert.equal(ranking.calls, 0, 'arena must never derive a score/rank');
    assert.ok(DOM_TOUCHES > 0, 'arena actually engaged the DOM (did real work)');
  });

  test('the insufficient-pool path also never touches ranking', async () => {
    const { initArena } = await import('../arena.js');
    const store = {
      loadPitches: () => [makePitch('solo', '2021-01-01T00:00:00.000Z')],
      loadVotes: () => [],
      addVote: (v) => ({ id: 'v', ...v }),
    };
    const ranking = makeRankingSpy();
    const sampler = {
      pickPair: () => ({ status: 'insufficient', pair: null }),
      pairKey: (a, b) => [a, b].sort().join('::'),
    };

    resetDomCapture();
    const root = new FakeNode('section');
    try {
      initArena(root, { store, sampler, ranking });
    } catch {
      /* the 'Not enough pitches yet' branch */
    }
    driveListeners();

    assert.equal(ranking.calls, 0, 'the empty-pool message never derives a rank');
  });
});

// ---------------------------------------------------------------------------
// store.js — exported readKey/writeKey (the profile.js persistence seam)
// ---------------------------------------------------------------------------

describe('store.js — exported readKey/writeKey handle generic JSON values', () => {
  test('round-trips a plain object (not just arrays)', async () => {
    globalThis.localStorage = mockStorage();
    const store = await freshStore();

    const record = { id: 'profile-1', created_at: '2026-07-01T00:00:00.000Z' };
    store.writeKey('sca.profile.v1', record);
    assert.deepEqual(store.readKey('sca.profile.v1'), record);

    const progress = { unlocked: { 'first-pitch': '2026-07-01T00:00:00.000Z' }, peak_tiers: { p1: 'gold' }, last_rank_id: null };
    store.writeKey('sca.progress.v1', progress);
    assert.deepEqual(store.readKey('sca.progress.v1'), progress);
  });

  test('absent key reads as null; malformed JSON yields the fallback', async () => {
    const ls = mockStorage();
    ls.setItem('sca.progress.v1', '{not valid json');
    globalThis.localStorage = ls;
    const store = await freshStore();

    assert.equal(store.readKey('sca.never-written.v1'), null);
    assert.equal(store.readKey('sca.progress.v1'), null, 'malformed defaults to null');
    assert.equal(store.readKey('sca.progress.v1', 'FALLBACK'), 'FALLBACK');
  });

  test('array keys keep their v1 semantics through the refactor', async () => {
    const ls = mockStorage();
    // Present but wrong shape -> [] (corrupt), NOT a sample re-seed.
    ls.setItem('sca.pitches.v1', '{"a":1}');
    globalThis.localStorage = ls;
    const store = await freshStore();
    assert.deepEqual(store.loadPitches(), []);
  });

  test('throwing storage never propagates; the memory mirror keeps the session consistent', async () => {
    globalThis.localStorage = throwingStorage();
    const store = await freshStore();

    let read;
    assert.doesNotThrow(() => {
      store.writeKey('sca.profile.v1', { id: 'ephemeral' });
      read = store.readKey('sca.profile.v1');
    });
    assert.deepEqual(read, { id: 'ephemeral' }, 'mirror serves the session-ephemeral value');

    globalThis.localStorage = mockStorage();
  });
});

// ---------------------------------------------------------------------------
// progression.pitchStatus — rev 2 tier bands (TRD suite 1)
// ---------------------------------------------------------------------------

// Build `comparisons` votes for pitch `id` against a fixed rival, the first
// `wins` of them won by the pitch.
function votesAgainst(id, comparisons, wins) {
  const votes = [];
  for (let i = 0; i < comparisons; i++) {
    votes.push(makeVote(`tb-${id}-${i}`, id, 'rival', i < wins ? id : 'rival'));
  }
  return votes;
}

describe('progression.pitchStatus — rev 2 tier bands', () => {
  test('below the threshold it reports calibrating with the exact counts', async () => {
    const progression = await import('../progression.js');
    const pitch = makePitch('cal');

    const none = progression.pitchStatus(pitch, [], 5);
    assert.deepEqual(none, { state: 'calibrating', comparisons: 0, threshold: 5 });

    const three = progression.pitchStatus(pitch, votesAgainst('cal', 3, 1), 5);
    assert.deepEqual(three, { state: 'calibrating', comparisons: 3, threshold: 5 });
  });

  test('at the threshold the k/5 quantization maps onto the rev 2 bands', async () => {
    const progression = await import('../progression.js');
    const pitch = makePitch('q');
    const expected = ['bronze', 'bronze', 'silver', 'gold', 'diamond', 'diamond'];
    for (let wins = 0; wins <= 5; wins++) {
      const status = progression.pitchStatus(pitch, votesAgainst('q', 5, wins), 5);
      assert.equal(status.state, 'tiered', `${wins}/5 is tiered`);
      assert.equal(status.tier, expected[wins], `${wins}/5 wins -> ${expected[wins]}`);
    }
  });

  test('band edges: 0.39/0.40 and 0.59/0.60 and 0.74/0.75 split exactly', async () => {
    const progression = await import('../progression.js');
    const pitch = makePitch('edge');
    const cases = [
      [39, 'bronze'],
      [40, 'silver'],
      [59, 'silver'],
      [60, 'gold'],
      [74, 'gold'],
      [75, 'diamond'],
    ];
    for (const [wins, tier] of cases) {
      const status = progression.pitchStatus(pitch, votesAgainst('edge', 100, wins), 5);
      assert.equal(status.tier, tier, `${wins}/100 -> ${tier}`);
    }
  });

  test('the return shape never contains win_rate (own-key assertion)', async () => {
    const progression = await import('../progression.js');
    const pitch = makePitch('leak');

    const calibrating = progression.pitchStatus(pitch, votesAgainst('leak', 2, 2), 5);
    assert.ok(!('win_rate' in calibrating), 'calibrating shape carries no win_rate');
    assert.deepEqual(Object.keys(calibrating).sort(), ['comparisons', 'state', 'threshold']);

    const tiered = progression.pitchStatus(pitch, votesAgainst('leak', 5, 4), 5);
    assert.ok(!('win_rate' in tiered), 'tiered shape carries no win_rate');
    assert.deepEqual(Object.keys(tiered).sort(), ['state', 'tier'], 'tiered shape is exactly { state, tier }');
  });

  test('only votes the pitch took part in count (twin of the ranking tally)', async () => {
    const progression = await import('../progression.js');
    const pitch = makePitch('mine');
    const votes = [
      makeVote('o1', 'other-a', 'other-b', 'other-a'), // unrelated vote
      ...votesAgainst('mine', 5, 3),
    ];
    const status = progression.pitchStatus(pitch, votes, 5);
    assert.deepEqual(status, { state: 'tiered', tier: 'gold' });
  });
});

// ---------------------------------------------------------------------------
// progression — monotonicity property (TRD suite 2, PRD P0-1/P0-2)
// ---------------------------------------------------------------------------

// Tiny deterministic PRNG so the randomized property is reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('progression — careerPoints/rankFor are monotonic by construction', () => {
  test('no randomized event sequence ever lowers points or rank', async () => {
    const progression = await import('../progression.js');
    const rand = mulberry32(0xc0ffee);
    const threshold = 5;
    const slots = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];
    const tags = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];

    const pitches = [];
    const votes = []; // votes my pitches took part in (any win/loss pattern)
    const peaks = {}; // ratchet-merged, recordPeaks-style
    const unlockedEver = new Set(); // union-merged, recordUnlocks-style
    const voteDays = new Set();
    let votesCast = 0;
    let pitchSeq = 0;
    let prevPoints = -1;
    let prevRankIndex = -1;

    for (let step = 0; step < 300; step++) {
      const roll = rand();
      if (roll < 0.25) {
        // Event: submit a pitch.
        pitchSeq += 1;
        pitches.push(
          makePitch(`p${pitchSeq}`, '2026-07-01T00:00:00.000Z', {
            owner_id: 'me',
            item_slot: slots[Math.floor(rand() * slots.length)],
            theme_tags: [tags[Math.floor(rand() * tags.length)]],
          })
        );
      } else if (roll < 0.55 || pitches.length === 0) {
        // Event: cast a vote in the Arena (immediate agency, P0-2).
        votesCast += 1;
        voteDays.add(`2026-07-0${1 + Math.floor(rand() * 5)}`);
      } else {
        // Event: one of my pitches gets compared — win or lose.
        const mine = pitches[Math.floor(rand() * pitches.length)];
        const won = rand() < 0.5;
        votes.push(makeVote(`ev${step}`, mine.id, 'rival', won ? mine.id : 'rival'));
      }

      // Derive -> ratchet peaks -> badge union -> points, as the celebration
      // pass will (statuses and unlocks are recomputed, peaks only rise).
      const statuses = pitches.map((p) => progression.pitchStatus(p, votes, threshold));
      statuses.forEach((status, i) => {
        if (status.state !== 'tiered') return;
        const merged = progression.maxTier(peaks[pitches[i].id], status.tier);
        if (typeof merged === 'string') peaks[pitches[i].id] = merged;
      });
      const ctx = {
        ownedPitches: pitches,
        statuses,
        peakTiers: peaks,
        votesByProfile: Array.from({ length: votesCast }, (_, i) => ({ id: `mv${i}` })),
        distinctSlots: new Set(pitches.map((p) => p.item_slot)).size,
        distinctTags: new Set(pitches.flatMap((p) => p.theme_tags)).size,
        distinctVoteDays: voteDays.size,
      };
      for (const id of progression.earnedBadges(ctx)) unlockedEver.add(id);

      const points = progression.careerPoints(peaks, unlockedEver.size, votesCast);
      assert.ok(
        points >= prevPoints,
        `career points must never drop (step ${step}: ${prevPoints} -> ${points})`
      );
      const rankIndex = progression.RANK_LADDER.findIndex(
        (rung) => rung.id === progression.rankFor(points).rank.id
      );
      assert.ok(
        rankIndex >= prevRankIndex,
        `rank must never step down (step ${step}: ${prevRankIndex} -> ${rankIndex})`
      );
      prevPoints = points;
      prevRankIndex = rankIndex;
    }
  });

  test('a pitch driven Gold -> Silver by later votes keeps its Gold peak points', async () => {
    const progression = await import('../progression.js');
    const pitch = makePitch('drift');
    const peaks = {};

    // 3/5 wins -> Gold at first tiering.
    let votes = votesAgainst('drift', 5, 3);
    let status = progression.pitchStatus(pitch, votes, 5);
    assert.deepEqual(status, { state: 'tiered', tier: 'gold' });
    peaks[pitch.id] = progression.maxTier(peaks[pitch.id], status.tier);
    assert.equal(progression.careerPoints(peaks, 0, 0), progression.TIER_POINTS.gold);

    // Two more losses -> 3/7 ~ 0.43 -> live Silver; the peak stays Gold.
    votes = votes.concat([
      makeVote('loss-1', 'drift', 'rival', 'rival'),
      makeVote('loss-2', 'drift', 'rival', 'rival'),
    ]);
    status = progression.pitchStatus(pitch, votes, 5);
    assert.deepEqual(status, { state: 'tiered', tier: 'silver' }, 'live tier drops honestly');
    peaks[pitch.id] = progression.maxTier(peaks[pitch.id], status.tier);
    assert.equal(peaks[pitch.id], 'gold', 'the ratchet never lets the peak fall');
    assert.equal(progression.careerPoints(peaks, 0, 0), progression.TIER_POINTS.gold);
  });

  test('vote points stop growing exactly at VOTE_POINTS_CAP', async () => {
    const progression = await import('../progression.js');
    const cap = progression.VOTE_POINTS_CAP;
    assert.equal(progression.careerPoints({}, 0, cap - 1), cap - 1);
    assert.equal(progression.careerPoints({}, 0, cap), cap);
    assert.equal(progression.careerPoints({}, 0, cap + 1), cap, 'one vote past the cap adds nothing');
    assert.equal(progression.careerPoints({}, 0, cap * 5), cap);
  });
});

// ---------------------------------------------------------------------------
// progression — career math (TRD suite 3)
// ---------------------------------------------------------------------------

describe('progression — careerPoints, rankFor, nextVotingBadge', () => {
  test('careerPoints sums peak-tier points + badge points + capped vote points', async () => {
    const progression = await import('../progression.js');
    const peaks = { a: 'bronze', b: 'silver', c: 'gold', d: 'diamond' };
    // 10 + 20 + 40 + 70 = 140 peak points, 3 badges = 30, 7 votes = 7.
    assert.equal(progression.careerPoints(peaks, 3, 7), 177);
    // Unknown tier ids are worth nothing; garbage inputs degrade to zero.
    assert.equal(progression.careerPoints({ x: 'mystery' }, 0, 0), 0);
    assert.equal(progression.careerPoints(null, NaN, undefined), 0);
  });

  test('rankFor hits the ladder edges with the rev-2 rank ids', async () => {
    const progression = await import('../progression.js');

    const zero = progression.rankFor(0);
    assert.equal(zero.rank.id, 'recruit');
    assert.equal(zero.next.id, 'apprentice');
    assert.equal(zero.progress01, 0);

    assert.equal(progression.rankFor(9).rank.id, 'recruit');
    assert.equal(progression.rankFor(10).rank.id, 'apprentice');
    assert.equal(progression.rankFor(39).rank.id, 'apprentice');
    assert.equal(progression.rankFor(40).rank.id, 'artisan');
    assert.equal(progression.rankFor(90).rank.id, 'virtuoso');
    assert.equal(progression.rankFor(160).rank.id, 'master');

    const almost = progression.rankFor(249);
    assert.equal(almost.rank.id, 'master');
    assert.equal(almost.next.id, 'legend');
    assert.ok(Math.abs(almost.progress01 - 89 / 90) < 1e-9);

    const max = progression.rankFor(250);
    assert.equal(max.rank.id, 'legend');
    assert.equal(max.next, null, 'max rank has no next rung');
    assert.equal(max.progress01, 1, 'max-rank state reads as complete');
    assert.equal(progression.rankFor(10000).rank.id, 'legend');
  });

  test('progress01 stays within [0, 1] across the whole ladder', async () => {
    const progression = await import('../progression.js');
    for (let points = 0; points <= 300; points += 1) {
      const { progress01 } = progression.rankFor(points);
      assert.ok(progress01 >= 0 && progress01 <= 1, `progress01 in range at ${points}`);
    }
  });

  test('nextVotingBadge reports the right target and remaining at each count', async () => {
    const progression = await import('../progression.js');
    const expectations = [
      [0, 'first-verdict', 1],
      [1, 'arena-regular', 24],
      [24, 'arena-regular', 1],
      [25, 'century', 75],
      [99, 'century', 1],
    ];
    for (const [cast, badgeId, remaining] of expectations) {
      const next = progression.nextVotingBadge(cast);
      assert.equal(next.badge.id, badgeId, `${cast} votes -> ${badgeId}`);
      assert.equal(next.remaining, remaining, `${cast} votes -> ${remaining} remaining`);
    }
    assert.equal(progression.nextVotingBadge(100), null, 'past Century there is no count target');
    assert.equal(progression.nextVotingBadge(250), null);
  });
});

// ---------------------------------------------------------------------------
// Peak ratchet — maxTier + profile.recordPeaks (TRD suite 4)
// ---------------------------------------------------------------------------

describe('peak ratchet — maxTier and profile.recordPeaks only ever rise', () => {
  test('maxTier picks the higher tier and tolerates unknowns', async () => {
    const progression = await import('../progression.js');
    assert.equal(progression.maxTier('bronze', 'gold'), 'gold');
    assert.equal(progression.maxTier('diamond', 'bronze'), 'diamond');
    assert.equal(progression.maxTier('silver', 'silver'), 'silver');
    assert.equal(progression.maxTier(undefined, 'silver'), 'silver');
    assert.equal(progression.maxTier('gold', null), 'gold');
    assert.equal(progression.maxTier('gold', 'nonsense'), 'gold');
    assert.equal(progression.maxTier(null, undefined), null);
  });

  test('recordPeaks returns exactly the pitch ids whose peak rose (toast-once)', async () => {
    globalThis.localStorage = mockStorage();
    const profile = await import('../profile.js');

    // First recording IS a rise (the first medal toasts).
    assert.deepEqual(profile.recordPeaks({ p1: 'silver' }), ['p1']);
    assert.deepEqual(profile.loadProgress().peak_tiers, { p1: 'silver' });

    // A genuine tier-up and a new pitch both rise; re-reporting doesn't.
    assert.deepEqual(profile.recordPeaks({ p1: 'gold', p2: 'bronze' }).sort(), ['p1', 'p2']);
    assert.deepEqual(profile.recordPeaks({ p1: 'gold', p2: 'bronze' }), []);

    // A live-tier drop never lowers the recorded peak and never "rises".
    assert.deepEqual(profile.recordPeaks({ p1: 'silver', p2: 'bronze' }), []);
    assert.deepEqual(profile.loadProgress().peak_tiers, { p1: 'gold', p2: 'bronze' });

    // Unknown tier ids and garbage inputs are ignored, never recorded.
    assert.deepEqual(profile.recordPeaks({ p3: 'mystery' }), []);
    assert.deepEqual(profile.recordPeaks(null), []);
    assert.deepEqual(profile.recordPeaks([]), []);
    assert.deepEqual(profile.loadProgress().peak_tiers, { p1: 'gold', p2: 'bronze' });
  });

  test('performance badges test recorded peaks, not live tiers', async () => {
    const progression = await import('../progression.js');
    // Live tier has dropped to silver, but the recorded peak is gold.
    const ctx = {
      ownedPitches: [makePitch('p1', '2026-07-01T00:00:00.000Z', { owner_id: 'me' })],
      statuses: [{ state: 'tiered', tier: 'silver' }],
      peakTiers: { p1: 'gold' },
      votesByProfile: [],
      distinctSlots: 1,
      distinctTags: 1,
      distinctVoteDays: 0,
    };
    const earned = progression.earnedBadges(ctx);
    assert.ok(earned.includes('gilded'), 'the gold PEAK keeps Gilded earned');
    assert.ok(earned.includes('silver-standard'), 'a gold peak implies the silver floor');
    assert.ok(!earned.includes('flawless'), 'no diamond peak, no Flawless');
  });
});

// ---------------------------------------------------------------------------
// Badges (TRD suite 5)
// ---------------------------------------------------------------------------

// Synthetic badge-eligibility ctx with safe empty defaults.
function makeCtx(over = {}) {
  return {
    ownedPitches: [],
    statuses: [],
    peakTiers: {},
    votesByProfile: [],
    distinctSlots: 0,
    distinctTags: 0,
    distinctVoteDays: 0,
    ...over,
  };
}

function ownedList(count) {
  return Array.from({ length: count }, (_, i) =>
    makePitch(`own-${i}`, '2026-07-01T00:00:00.000Z', { owner_id: 'me' })
  );
}

describe('progression.earnedBadges — family predicates on synthetic ctx', () => {
  test('the catalogue is well-formed: descriptor shape and the four families', async () => {
    const progression = await import('../progression.js');
    for (const badge of progression.BADGES) {
      assert.ok(badge.id && typeof badge.id === 'string');
      assert.ok(['submission', 'coverage', 'performance', 'voting'].includes(badge.family));
      assert.ok(badge.label && typeof badge.label === 'string');
      assert.ok(badge.blurb && typeof badge.blurb === 'string', 'locked silhouettes need condition text');
      assert.equal(typeof badge.test, 'function');
    }
    const ids = progression.BADGES.map((b) => b.id);
    assert.equal(new Set(ids).size, ids.length, 'badge ids are unique');
  });

  test('submission counts unlock at 1 / 3 / 6 pitches', async () => {
    const progression = await import('../progression.js');
    const at = (n) => progression.earnedBadges(makeCtx({ ownedPitches: ownedList(n) }));
    assert.deepEqual(at(0), []);
    assert.deepEqual(at(1), ['first-pitch']);
    assert.deepEqual(at(3), ['first-pitch', 'three-pitches']);
    assert.deepEqual(at(6), ['first-pitch', 'three-pitches', 'six-pitches']);
  });

  test('coverage: Full Loadout needs every item slot, Theme Explorer 6 distinct tags', async () => {
    const progression = await import('../progression.js');
    // The wizard's fixed ITEM_SLOTS list has 7 entries (cross-referenced in
    // progression.js); 6 of 7 slots is not a full loadout.
    assert.ok(!progression.earnedBadges(makeCtx({ distinctSlots: 6 })).includes('full-loadout'));
    assert.ok(progression.earnedBadges(makeCtx({ distinctSlots: 7 })).includes('full-loadout'));

    assert.ok(!progression.earnedBadges(makeCtx({ distinctTags: 5 })).includes('theme-explorer'));
    assert.ok(progression.earnedBadges(makeCtx({ distinctTags: 6 })).includes('theme-explorer'));
  });

  test('performance: Battle-Tested on the first calibrated pitch; medals on peaks', async () => {
    const progression = await import('../progression.js');

    const calibrating = makeCtx({ statuses: [{ state: 'calibrating', comparisons: 3, threshold: 5 }] });
    assert.ok(!progression.earnedBadges(calibrating).includes('battle-tested'));

    const tiered = makeCtx({ statuses: [{ state: 'tiered', tier: 'bronze' }], peakTiers: { p: 'bronze' } });
    const earned = progression.earnedBadges(tiered);
    assert.ok(earned.includes('battle-tested'));
    assert.ok(!earned.includes('silver-standard'), 'a bronze peak is below the silver floor');

    const flawless = progression.earnedBadges(makeCtx({ peakTiers: { p: 'diamond' } }));
    assert.ok(flawless.includes('silver-standard'));
    assert.ok(flawless.includes('gilded'));
    assert.ok(flawless.includes('flawless'));
  });

  test('voting: count thresholds at 1 / 25 / 100 and the 3-distinct-day streak badge', async () => {
    const progression = await import('../progression.js');
    const votes = (n) => Array.from({ length: n }, (_, i) => ({ id: `v${i}` }));

    assert.deepEqual(progression.earnedBadges(makeCtx({ votesByProfile: votes(1) })), ['first-verdict']);
    assert.deepEqual(
      progression.earnedBadges(makeCtx({ votesByProfile: votes(25) })),
      ['first-verdict', 'arena-regular']
    );
    assert.deepEqual(
      progression.earnedBadges(makeCtx({ votesByProfile: votes(100) })),
      ['first-verdict', 'arena-regular', 'century']
    );

    assert.ok(!progression.earnedBadges(makeCtx({ distinctVoteDays: 2 })).includes('dedicated'));
    assert.ok(progression.earnedBadges(makeCtx({ distinctVoteDays: 3 })).includes('dedicated'));
  });

  test('eligibility is idempotent and order-independent (recompute -> same set)', async () => {
    const progression = await import('../progression.js');
    const ctx = makeCtx({
      ownedPitches: ownedList(6),
      statuses: [{ state: 'tiered', tier: 'gold' }],
      peakTiers: { 'own-0': 'diamond' },
      votesByProfile: Array.from({ length: 100 }, (_, i) => ({ id: `v${i}` })),
      distinctSlots: 7,
      distinctTags: 6,
      distinctVoteDays: 3,
    });
    const first = progression.earnedBadges(ctx);
    const second = progression.earnedBadges(ctx);
    assert.deepEqual(first, second, 'same ctx -> same set');
    // This maximal ctx earns the whole case, in catalogue order.
    assert.deepEqual(first, progression.BADGES.map((b) => b.id));
    // Malformed ctx degrades to "nothing earned", never a throw.
    assert.deepEqual(progression.earnedBadges(null), []);
    assert.deepEqual(progression.earnedBadges({}), []);
  });
});

// ---------------------------------------------------------------------------
// Owner filtering & calibration priority (TRD suite 7)
// ---------------------------------------------------------------------------

// A mixed-ownership pool: one pitch owned by 'me', one by another profile, and
// two ownerless sample/pre-add-on pitches (absent owner_id and explicit null —
// both shapes must be tolerated and belong to no one).
function mixedPitches() {
  return [
    makePitch('mine-1', '2021-01-01T00:00:00.000Z', { owner_id: 'me' }),
    makePitch('theirs-1', '2021-01-02T00:00:00.000Z', { owner_id: 'them' }),
    makePitch('sample-1', '2021-01-03T00:00:00.000Z'),
    makePitch('sample-2', '2021-01-04T00:00:00.000Z', { owner_id: null }),
  ];
}

describe('progression.ownedPitches — ownership incl. null-owner samples', () => {
  test('keeps exactly the pitches whose owner_id matches the profile', async () => {
    const progression = await import('../progression.js');
    const pool = mixedPitches();

    assert.deepEqual(
      progression.ownedPitches(pool, 'me').map((p) => p.id),
      ['mine-1']
    );
    assert.deepEqual(
      progression.ownedPitches(pool, 'them').map((p) => p.id),
      ['theirs-1']
    );
  });

  test('null/absent-owner sample pitches belong to no one; a null owner owns nothing', async () => {
    const progression = await import('../progression.js');
    const pool = mixedPitches();

    // No profile string ever claims the ownerless samples.
    for (const ownerId of ['me', 'them', 'stranger']) {
      const ids = progression.ownedPitches(pool, ownerId).map((p) => p.id);
      assert.ok(!ids.includes('sample-1'), `${ownerId} does not own sample-1`);
      assert.ok(!ids.includes('sample-2'), `${ownerId} does not own sample-2`);
    }

    // A null/empty/garbage ownerId owns nothing (never "matches" null owners).
    assert.deepEqual(progression.ownedPitches(pool, null), []);
    assert.deepEqual(progression.ownedPitches(pool, undefined), []);
    assert.deepEqual(progression.ownedPitches(pool, ''), []);
    // Garbage pitch lists degrade to empty, never a throw.
    assert.deepEqual(progression.ownedPitches(null, 'me'), []);
    assert.deepEqual(progression.ownedPitches([null, 42], 'me'), []);
  });
});

describe('arena wiring — own-pitch exclusion, voter stamping, session strip', () => {
  test('own pitches leave the pool BEFORE pickPair; samples stay; full votes pass through', async () => {
    const { initArena } = await import('../arena.js');
    const votes = [makeVote('v1', 'mine-1', 'theirs-1', 'mine-1')];
    const store = {
      loadPitches: () => mixedPitches(),
      loadVotes: () => votes,
      addVote: (v) => ({ id: 'nv', created_at: '2021-01-05T00:00:00.000Z', ...v }),
    };
    const calls = [];
    const sampler = {
      pickPair: (pitches, votesArg) => {
        calls.push({ pitches, votes: votesArg });
        return { status: 'ok', pair: [pitches[0], pitches[1]] };
      },
      pairKey: (a, b) => [a, b].sort().join('::'),
    };

    resetDomCapture();
    const root = new FakeNode('section');
    initArena(root, { store, sampler, profileId: 'me' });

    assert.ok(calls.length >= 1, 'the arena sampled a pair');
    const ids = calls[0].pitches.map((p) => p.id);
    assert.ok(!ids.includes('mine-1'), 'own pitch never reaches the sampler');
    assert.deepEqual(
      ids,
      ['theirs-1', 'sample-1', 'sample-2'],
      'other creators AND ownerless samples stay in the pool'
    );
    assert.equal(
      calls[0].votes,
      votes,
      'comparison counts still come from the FULL votes array'
    );
  });

  test('with no profile the pool is unfiltered and votes carry voter_id null', async () => {
    const { initArena } = await import('../arena.js');
    const recorded = [];
    const store = {
      loadPitches: () => mixedPitches(),
      loadVotes: () => [],
      addVote: (v) => {
        recorded.push(v);
        return { id: 'nv', ...v };
      },
    };
    const calls = [];
    const sampler = {
      pickPair: (pitches) => {
        calls.push(pitches);
        return { status: 'ok', pair: [pitches[0], pitches[1]] };
      },
      pairKey: (a, b) => [a, b].sort().join('::'),
    };

    resetDomCapture();
    const root = new FakeNode('section');
    initArena(root, { store, sampler });
    driveListeners(); // click the rendered cards -> vote()

    assert.equal(calls[0].length, 4, 'no profile -> nothing is filtered out');
    assert.ok(recorded.length >= 1, 'clicking a card still records a vote');
    for (const vote of recorded) {
      assert.ok('voter_id' in vote, 'the stamp field is always present');
      assert.equal(vote.voter_id, null, 'no profile -> the sample-vote shape');
    }
  });

  test('votes are stamped with voter_id and the session strip consults votingProgress', async () => {
    const { initArena } = await import('../arena.js');
    const recorded = [];
    const store = {
      loadPitches: () => mixedPitches(),
      loadVotes: () => recorded,
      addVote: (v) => {
        recorded.push(v);
        return { id: `nv${recorded.length}`, ...v };
      },
    };
    const sampler = {
      pickPair: (pitches) => ({ status: 'ok', pair: [pitches[0], pitches[1]] }),
      pairKey: (a, b) => [a, b].sort().join('::'),
    };
    let progressCalls = 0;
    const votingProgress = () => {
      progressCalls += 1;
      return {
        votesCast: recorded.length,
        next: { label: 'Arena Regular', target: 25, remaining: 25 - recorded.length },
      };
    };

    resetDomCapture();
    const root = new FakeNode('section');
    initArena(root, { store, sampler, profileId: 'me', votingProgress });
    const callsAtInit = progressCalls;
    assert.ok(callsAtInit >= 1, 'the strip renders its data hook at init');
    driveListeners(); // click the rendered cards -> vote()

    assert.ok(recorded.length >= 1, 'clicking a card records a vote');
    for (const vote of recorded) {
      assert.equal(vote.voter_id, 'me', 'every vote carries the voter stamp');
    }
    assert.ok(
      progressCalls > callsAtInit,
      'each vote refreshes the next-voting-badge progress hook'
    );
  });

  test('every vote fires the celebration hook, after the vote has been recorded', async () => {
    const { initArena } = await import('../arena.js');
    const recorded = [];
    const store = {
      loadPitches: () => mixedPitches(),
      loadVotes: () => recorded,
      addVote: (v) => {
        recorded.push(v);
        return { id: `nv${recorded.length}`, ...v };
      },
    };
    const sampler = {
      pickPair: (pitches) => ({ status: 'ok', pair: [pitches[0], pitches[1]] }),
      pairKey: (a, b) => [a, b].sort().join('::'),
    };
    // The hook records how many votes had landed when it fired, then throws —
    // a celebration fault must never break voting (it is decoration).
    const votesWhenCelebrated = [];
    const onVoteCast = () => {
      votesWhenCelebrated.push(recorded.length);
      throw new Error('celebration fault (must be swallowed)');
    };

    resetDomCapture();
    const root = new FakeNode('section');
    initArena(root, { store, sampler, profileId: 'me', onVoteCast });
    driveListeners(); // click the rendered cards -> vote()

    assert.ok(recorded.length >= 1, 'votes were recorded despite the throwing hook');
    assert.equal(
      votesWhenCelebrated.length,
      recorded.length,
      'exactly one celebration pass per vote'
    );
    votesWhenCelebrated.forEach((count, i) => {
      assert.equal(count, i + 1, 'the pass runs AFTER the vote landed in the store');
    });
  });

  test('a profile\'s own pitch never appears in any pair drawn from the filtered list', async () => {
    const sampler = await import('../sampler.js');
    const pool = mixedPitches();

    // Exhaust every pair the arena could draw for BOTH profiles: the owner
    // filter (the arena's pre-pickPair step) keeps 'me' out of my pairs and
    // 'them' out of theirs, while the ownerless samples appear for everyone.
    for (const me of ['me', 'them']) {
      const filtered = pool.filter((p) => !(p && p.owner_id === me));
      const seen = new Set();
      const served = new Set();
      for (;;) {
        const res = sampler.pickPair(filtered, [], seen);
        if (res.status !== 'ok') break;
        const [a, b] = res.pair;
        for (const pitch of res.pair) {
          assert.notEqual(pitch.owner_id, me, `${me} is never served their own pitch`);
          served.add(pitch.id);
        }
        seen.add(sampler.pairKey(a.id, b.id));
      }
      const pairCount = (filtered.length * (filtered.length - 1)) / 2;
      assert.equal(seen.size, pairCount, 'every non-own pair was drawable');
      assert.ok(served.has('sample-1'), 'ownerless samples appear for everyone');
      assert.ok(served.has('sample-2'), 'explicit-null samples appear for everyone');
    }
  });
});

describe('wizard wiring — pitches are stamped with owner_id', () => {
  // A fake root whose querySelector memoizes per selector, so the test can
  // reach the same field nodes the controller captured and fill them in.
  class MemoRoot extends FakeNode {
    constructor() {
      super('section');
      this.memo = new Map();
    }
    querySelector(sel) {
      DOM_TOUCHES += 1;
      if (!this.memo.has(sel)) this.memo.set(sel, new FakeNode());
      return this.memo.get(sel);
    }
  }

  test('a completed submit reaches addPitch with owner_id = profileId', async () => {
    const { initWizard } = await import('../wizard.js');
    const added = [];
    const store = {
      addPitch: (p) => {
        added.push(p);
        return { id: 'new-pitch', created_at: '2021-01-05T00:00:00.000Z', ...p };
      },
    };

    resetDomCapture();
    const root = new MemoRoot();
    initWizard(root, { store, profileId: 'me' });

    // Complete the form: title + description text, one selected theme chip.
    root.querySelector('#wizard-title').value = 'Tidebreaker Vanguard';
    root.querySelector('#wizard-desc').value = 'Storm-glass plate with a tidal wake.';
    const chip = new FakeNode('button');
    chip.setAttribute('data-tag', 'frost');
    root.querySelector('#wizard-tags').querySelectorAll = () => {
      DOM_TOUCHES += 1;
      return [chip];
    };

    driveListeners(); // fires the captured form submit handler

    assert.ok(added.length >= 1, 'the completed form reached store.addPitch');
    for (const pitch of added) {
      assert.equal(pitch.owner_id, 'me', 'submitted pitches carry the owner stamp');
    }
  });

  test('with no profile the pitch is stamped owner_id null (the sample shape)', async () => {
    const { initWizard } = await import('../wizard.js');
    const added = [];
    const store = { addPitch: (p) => (added.push(p), { id: 'np', ...p }) };

    resetDomCapture();
    const root = new MemoRoot();
    initWizard(root, { store });

    root.querySelector('#wizard-title').value = 'Ashen Warden';
    root.querySelector('#wizard-desc').value = 'Charcoal armor that embers at dusk.';
    const chip = new FakeNode('button');
    chip.setAttribute('data-tag', 'mythic');
    root.querySelector('#wizard-tags').querySelectorAll = () => [chip];

    driveListeners();

    assert.ok(added.length >= 1);
    for (const pitch of added) {
      assert.ok('owner_id' in pitch, 'the stamp field is always present');
      assert.equal(pitch.owner_id, null, 'no profile -> the sample-pitch shape');
    }
  });

  test('a completed submit fires the celebration hook; a throwing hook never blocks it', async () => {
    const { initWizard } = await import('../wizard.js');
    const added = [];
    const store = {
      addPitch: (p) => {
        added.push(p);
        return { id: 'np', created_at: '2021-01-05T00:00:00.000Z', ...p };
      },
    };
    // Count firings, then throw — celebration is decoration and the wizard
    // must swallow the fault (the submit is already committed by then).
    let celebrations = 0;
    const onPitchSubmitted = () => {
      celebrations += 1;
      throw new Error('celebration fault (must be swallowed)');
    };

    resetDomCapture();
    const root = new MemoRoot();
    initWizard(root, { store, profileId: 'me', onPitchSubmitted });

    root.querySelector('#wizard-title').value = 'Emberplate Sentinel';
    root.querySelector('#wizard-desc').value = 'Molten seams over blackened steel.';
    const chip = new FakeNode('button');
    chip.setAttribute('data-tag', 'neon');
    root.querySelector('#wizard-tags').querySelectorAll = () => [chip];

    driveListeners(); // fires the captured form submit handler

    assert.ok(added.length >= 1, 'the submit succeeded despite the throwing hook');
    assert.equal(celebrations, added.length, 'exactly one celebration pass per submit');
  });
});

describe('progression.calibrationPriority — true exactly at the pool minimum', () => {
  test('the least-compared pitch is prioritized; busier pitches are not', async () => {
    const progression = await import('../progression.js');
    const A = makePitch('A');
    const B = makePitch('B');
    const C = makePitch('C');
    // Counts: A 0, B 2, C 2.
    const votes = [makeVote('v1', 'B', 'C', 'B'), makeVote('v2', 'B', 'C', 'C')];

    assert.equal(progression.calibrationPriority(A, [A, B, C], votes), true);
    assert.equal(progression.calibrationPriority(B, [A, B, C], votes), false);
    assert.equal(progression.calibrationPriority(C, [A, B, C], votes), false);
  });

  test('when the whole pool is level, every pitch sits at the minimum', async () => {
    const progression = await import('../progression.js');
    const B = makePitch('B');
    const C = makePitch('C');
    const votes = [makeVote('v1', 'B', 'C', 'B')]; // both at 1 comparison

    assert.equal(progression.calibrationPriority(B, [B, C], votes), true);
    assert.equal(progression.calibrationPriority(C, [B, C], votes), true);
    // A fresh pool with zero votes: everything is "next in line".
    assert.equal(progression.calibrationPriority(B, [B, C], []), true);
  });

  test('a pitch outside the pool, or garbage input, is never prioritized', async () => {
    const progression = await import('../progression.js');
    const A = makePitch('A');
    const B = makePitch('B');

    assert.equal(progression.calibrationPriority(makePitch('Z'), [A, B], []), false);
    assert.equal(progression.calibrationPriority(null, [A, B], []), false);
    assert.equal(progression.calibrationPriority(A, [], []), false);
    assert.equal(progression.calibrationPriority(A, null, null), false);
  });
});

// ---------------------------------------------------------------------------
// Access-split guard, extended — static import assertions (TRD suite 8)
// ---------------------------------------------------------------------------
//
// The dynamic spy tests above prove the controllers never CALL an injected
// ranking dependency; these prove the modules cannot even reach the forbidden
// modules: the import graph is scanned at the source level. Comments may
// legitimately MENTION ranking/progression (the twin-tally cross-references),
// so sources are stripped of comments and asserted on import specifiers and
// call sites only. locker.js does not exist yet — the assertions pick it up
// automatically the day it lands (it may import progression/profile, never
// ranking).

describe('access-split guard, extended — static import-graph assertions', () => {
  const appUrl = (name) => new URL(`../${name}`, import.meta.url);
  const sourceOf = (name) => readFileSync(appUrl(name), 'utf8');

  // Drop block and line comments (://... in string literals survives).
  function stripComments(source) {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  }

  // Every static or dynamic import specifier in a module's (comment-stripped)
  // source. These modules use plain string specifiers only.
  function importSpecifiers(name) {
    const source = stripComments(sourceOf(name));
    const specs = [];
    const re = /\bimport\b[^'"]*['"]([^'"]+)['"]/g;
    let match;
    while ((match = re.exec(source))) specs.push(match[1]);
    return specs;
  }

  test('wizard.js and arena.js import neither ranking nor progression', () => {
    // scout.js / scout-data.js feed the participant-facing Arena and Submit
    // views, so they are held to the same bar as the views themselves.
    for (const name of ['wizard.js', 'arena.js', 'scout.js', 'scout-data.js']) {
      for (const spec of importSpecifiers(name)) {
        assert.ok(
          !/ranking/.test(spec),
          `${name} must never import ranking (found "${spec}")`
        );
        assert.ok(
          !/progression/.test(spec),
          `${name} must never import progression (found "${spec}")`
        );
      }
    }
  });

  test('progression.js, profile.js (and locker.js, once present) never import ranking', () => {
    const names = ['progression.js', 'profile.js'];
    if (existsSync(appUrl('locker.js'))) names.push('locker.js');
    for (const name of names) {
      for (const spec of importSpecifiers(name)) {
        assert.ok(
          !/ranking/.test(spec),
          `${name} must never import ranking (found "${spec}")`
        );
      }
    }
  });

  test('studio.js does not import progression (one-direction flow)', () => {
    for (const spec of importSpecifiers('studio.js')) {
      assert.ok(
        !/progression/.test(spec),
        `studio.js does not need progression (found "${spec}")`
      );
    }
  });

  test('only studio.js calls ranking.rank (the v1 spy seam, re-asserted)', () => {
    const names = [
      'app.js',
      'wizard.js',
      'arena.js',
      'studio.js',
      'progression.js',
      'profile.js',
      'sampler.js',
      'store.js',
      'sample-data.js',
      'scout.js',
      'scout-data.js',
      'ids.js',
      'art.js',
    ];
    if (existsSync(appUrl('locker.js'))) names.push('locker.js');
    const callers = names.filter((name) =>
      /\branking\s*\.\s*rank\s*\(/.test(stripComments(sourceOf(name)))
    );
    assert.deepEqual(callers, ['studio.js'], 'ranking.rank is Studio-only');
  });
});

// ---------------------------------------------------------------------------
// Celebration pass — locker.checkCelebrations fires each event exactly once
// (PRD acceptance criterion 8: toast-once, from any view)
// ---------------------------------------------------------------------------
//
// End-to-end over the real progression + profile modules (fresh storage),
// with only the store stubbed: the first pass after a pitch tiers must emit
// its peak, every newly-eligible badge, and the rank change — each once, in
// toast order — and an immediate re-run must emit nothing (the additive
// ledger already recorded the facts). NOTE: keep this ABOVE the profile.js
// suite whose final scenario kills storage for the rest of the process.

describe('locker.checkCelebrations — each celebration fires exactly once', () => {
  test('first pass emits peak -> badges -> rank; a re-run emits nothing', async () => {
    globalThis.localStorage = mockStorage(); // fresh, empty ledger
    const progression = await import('../progression.js');
    const profile = await import('../profile.js');
    const { initLocker, checkCelebrations } = await import('../locker.js');

    // One owned pitch at exactly the threshold with 3/5 wins -> Gold.
    const pitch = makePitch('mine', '2026-07-01T00:00:00.000Z', { owner_id: 'me' });
    const votes = votesAgainst('mine', 5, 3);
    const store = {
      loadPitches: () => [pitch],
      loadVotes: () => votes,
    };

    resetDomCapture();
    initLocker(new FakeNode('section'), {
      store,
      progression,
      profile,
      profileId: 'me',
      threshold: 5,
    });

    const events = checkCelebrations();
    const ofType = (type) => events.filter((e) => e.type === type);

    // The first medal IS a peak rise -> exactly one peak event.
    assert.deepEqual(ofType('peak'), [{ type: 'peak', pitchId: 'mine', tier: 'gold' }]);
    // Newly-eligible badges: submission count + calibration + the peak medals.
    assert.deepEqual(
      ofType('badge').map((e) => e.badgeId).sort(),
      ['battle-tested', 'first-pitch', 'gilded', 'silver-standard']
    );
    // Gold peak (40) + 4 badges (40) = 80 points -> Artisan, first recording.
    assert.deepEqual(ofType('rank'), [{ type: 'rank', rankId: 'artisan' }]);
    assert.equal(events.length, 6, 'each celebration-worthy event appears exactly once');
    // Toast order per the TRD pass: peaks, then badges, then the rank change.
    assert.deepEqual(
      events.map((e) => e.type),
      ['peak', 'badge', 'badge', 'badge', 'badge', 'rank']
    );

    // The additive facts landed in the ledger, so nothing re-celebrates.
    assert.deepEqual(checkCelebrations(), []);
    // ... and the recorded state matches what was toasted.
    const progress = profile.loadProgress();
    assert.deepEqual(progress.peak_tiers, { mine: 'gold' });
    assert.deepEqual(
      Object.keys(progress.unlocked).sort(),
      ['battle-tested', 'first-pitch', 'gilded', 'silver-standard']
    );
    assert.equal(progress.last_rank_id, 'artisan');
  });

  test('before initLocker the pass is a safe no-op, and a store fault emits nothing', async () => {
    globalThis.localStorage = mockStorage();
    const progression = await import('../progression.js');
    const profile = await import('../profile.js');
    const { initLocker, checkCelebrations } = await import('../locker.js?case=celebrate-fault');

    // Never initialised in THIS module instance -> [] without touching deps.
    assert.deepEqual(checkCelebrations(), []);

    // A throwing store must be swallowed (celebration is decoration).
    const store = {
      loadPitches: () => {
        throw new Error('store fault');
      },
      loadVotes: () => [],
    };
    resetDomCapture();
    initLocker(new FakeNode('section'), {
      store,
      progression,
      profile,
      profileId: 'me',
      threshold: 5,
    });
    let events;
    assert.doesNotThrow(() => {
      events = checkCelebrations();
    });
    assert.deepEqual(events, [], 'a faulting pass celebrates nothing');
  });
});

// ---------------------------------------------------------------------------
// Unlock persistence — profile.js over sca.profile.v1 / sca.progress.v1
// (TRD suite 6)
// ---------------------------------------------------------------------------

describe('profile.js — unlock persistence, identity, and rank dedup', () => {
  test('recordUnlocks unions, never removes, and returns only newly-added ids', async () => {
    globalThis.localStorage = mockStorage();
    const profile = await import('../profile.js');

    assert.deepEqual(profile.loadProgress(), { unlocked: {}, peak_tiers: {}, last_rank_id: null });

    assert.deepEqual(profile.recordUnlocks(['first-pitch', 'first-verdict']), ['first-pitch', 'first-verdict']);
    const stamp = profile.loadProgress().unlocked['first-pitch'];
    assert.ok(typeof stamp === 'string' && stamp.length > 0, 'unlocks are stamped');

    // Re-reporting an earned badge adds nothing (toast-once guarantee).
    assert.deepEqual(profile.recordUnlocks(['first-verdict', 'century']), ['century']);
    assert.deepEqual(profile.recordUnlocks(['first-pitch']), []);

    const progress = profile.loadProgress();
    assert.deepEqual(Object.keys(progress.unlocked).sort(), ['century', 'first-pitch', 'first-verdict']);
    assert.equal(progress.unlocked['first-pitch'], stamp, 'original timestamps are never restamped');

    // Garbage in -> nothing added, nothing removed, nothing thrown.
    assert.deepEqual(profile.recordUnlocks([]), []);
    assert.deepEqual(profile.recordUnlocks(null), []);
    assert.deepEqual(profile.recordUnlocks([42, '', null]), []);
    assert.equal(Object.keys(profile.loadProgress().unlocked).length, 3);
  });

  test('unlocks and peaks persist across a module reload on the same storage', async () => {
    globalThis.localStorage = mockStorage();
    const profile = await import('../profile.js');
    profile.recordUnlocks(['gilded']);
    profile.recordPeaks({ p1: 'gold' });

    // Fresh module instance, same storage: the additive facts survive.
    const reloaded = await import('../profile.js?case=reload');
    const progress = reloaded.loadProgress();
    assert.deepEqual(Object.keys(progress.unlocked), ['gilded']);
    assert.deepEqual(progress.peak_tiers, { p1: 'gold' });
  });

  test('ensureProfile creates once and then returns the same identity', async () => {
    globalThis.localStorage = mockStorage();
    const profile = await import('../profile.js');

    const created = profile.ensureProfile();
    assert.ok(created.id && typeof created.id === 'string');
    assert.ok(created.created_at && typeof created.created_at === 'string');
    assert.deepEqual(profile.ensureProfile(), created, 'stable across calls');

    // A malformed profile record is replaced with a fresh one, never thrown on.
    globalThis.localStorage.setItem('sca.profile.v1', '{broken json');
    const replaced = profile.ensureProfile();
    assert.ok(replaced.id && typeof replaced.id === 'string');
    assert.deepEqual(profile.ensureProfile(), replaced, 'the replacement persists');
  });

  test('recordRank reports true only when the stored rank actually changed', async () => {
    globalThis.localStorage = mockStorage();
    const profile = await import('../profile.js');

    assert.equal(profile.recordRank('recruit'), true, 'first record is a change');
    assert.equal(profile.recordRank('recruit'), false, 'same rank -> no toast');
    assert.equal(profile.recordRank('apprentice'), true, 'rank-up -> toast');
    assert.equal(profile.loadProgress().last_rank_id, 'apprentice');
    assert.equal(profile.recordRank(''), false);
    assert.equal(profile.recordRank(null), false);
  });

  test('disabled/throwing storage never propagates; the session stays consistent', async () => {
    // Keep this scenario LAST: it flips the shared store module onto its
    // in-memory mirror for the remainder of the process (matching a real
    // storage-death mid-session).
    globalThis.localStorage = throwingStorage();
    const profile = await import('../profile.js');

    assert.doesNotThrow(() => {
      const identity = profile.ensureProfile();
      assert.ok(identity.id, 'a session-ephemeral profile still exists');
      profile.recordUnlocks(['first-pitch']);
      profile.recordPeaks({ p1: 'silver' });
      profile.recordRank('recruit');
    });
    // The memory mirror keeps the additive facts for this session.
    const progress = profile.loadProgress();
    assert.ok('first-pitch' in progress.unlocked);
    assert.deepEqual(progress.peak_tiers, { p1: 'silver' });
    assert.equal(progress.last_rank_id, 'recruit');

    globalThis.localStorage = mockStorage();
  });
});
