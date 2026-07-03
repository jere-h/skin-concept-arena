// tests/scout.test.js — the Scout pipeline (docs/scout-pipeline-tech-spec.md).
//
// Everything under test here is pure and DOM-free (scout.js, the drop
// validator's check functions, and the bundled drop data), so no fake
// browser environment is installed. Suites:
//
//   1. mergeDrops        — activation gating, idempotency, non-mutation
//   2. applyRetirement   — the rolling freshness window, one-way
//   3. composeArenaPool  — share-cap math, survival mode, edge semantics
//   4. pickPairWithQuota — one scout per pair, passthrough statuses
//   5. Drop data         — Drop 001 (and all future drops) pass the validator
//   6. Validator teeth   — the mechanical anti-slop rules actually bite
//   7. Access split      — scout.js / scout-data.js reach neither ranking
//                          nor progression (static import scan)
//
// Run: node --test tests/

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as scout from '../scout.js';
import * as sampler from '../sampler.js';
import { SCOUT_DROPS } from '../scout-data.js';
import { SAMPLE_PITCHES } from '../sample-data.js';
import { DEMO_PITCHES } from '../demo.js';
import { ITEM_SLOTS, THEME_TAGS } from '../wizard.js';
import {
  validateAll,
  validateDrop,
  lexiconHits,
  similarity,
  sentenceCount,
} from '../scripts/validate-drops.mjs';

const VOCAB = { slots: ITEM_SLOTS, tags: THEME_TAGS };
const NOW = '2026-07-10T12:00:00.000Z';

// --- Data-shape helpers -------------------------------------------------------

function human(id, created_at = '2026-01-01T00:00:00.000Z', over = {}) {
  return {
    id,
    item_slot: 'Character Skin',
    theme_tags: ['Gritty'],
    title: `Pitch ${id}`,
    description: 'A human-authored concept description.',
    image_url: '',
    created_at,
    ...over,
  };
}

function scoutPitch(id, created_at = '2026-02-01T00:00:00.000Z', over = {}) {
  return human(id, created_at, { origin: 'scout', owner_id: null, ...over });
}

function drop(pitches, over = {}) {
  return {
    drop_id: 'drop-test',
    generated_at: '2026-07-01T00:00:00.000Z',
    stats: { generated: pitches.length * 3, shipped: pitches.length },
    pitches,
    sparks: [],
    ...over,
  };
}

// A validator-clean scout pitch factory for suite 6's mutations.
function validScout(id, over = {}) {
  return {
    id: `scout-${id}`,
    item_slot: 'Character Skin',
    theme_tags: ['Gritty'],
    title: `Test Concept ${id}`,
    description:
      'A canvas work coat with brass grommets along the seams and a rope tool ' +
      `looped at the hip, referenced from dockworker gear (${id}). Reads as a ` +
      'professional at work, not a costume.',
    image_url: '',
    owner_id: null,
    origin: 'scout',
    inspiration: {
      sources: ['Dockworker canvas gear', 'Brass shipfitting hardware'],
      note: 'Workwear reads earned rather than decorated.',
    },
    active_from: '2026-07-01',
    created_at: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. mergeDrops
// ---------------------------------------------------------------------------

describe('scout.mergeDrops — activation gating and idempotency', () => {
  test('adds only activated pitches; a second merge adds nothing', () => {
    const pool = [human('h1')];
    const drops = [
      drop([
        scoutPitch('scout-live', '2026-07-01T00:00:00.000Z', { active_from: '2026-07-01' }),
        scoutPitch('scout-later', '2026-07-01T00:00:00.000Z', { active_from: '2026-08-01' }),
      ]),
    ];

    const first = scout.mergeDrops(pool, drops, NOW);
    assert.equal(first.added, 1);
    assert.deepEqual(
      first.pitches.map((p) => p.id),
      ['h1', 'scout-live']
    );

    const second = scout.mergeDrops(first.pitches, drops, NOW);
    assert.equal(second.added, 0);
    assert.equal(second.pitches, first.pitches, 'no-op merge returns the same array');
  });

  test('missing active_from activates immediately (fail-open)', () => {
    const drops = [drop([scoutPitch('scout-nodate', '2026-07-01T00:00:00.000Z')])];
    const result = scout.mergeDrops([], drops, NOW);
    assert.equal(result.added, 1);
  });

  test('never mutates inputs and deep-copies drop records in', () => {
    const pool = [human('h1')];
    const dropPitch = scoutPitch('scout-a', '2026-07-01T00:00:00.000Z', {
      active_from: '2026-07-01',
    });
    const drops = [drop([dropPitch])];
    const poolBefore = JSON.stringify(pool);
    const dropsBefore = JSON.stringify(drops);

    const result = scout.mergeDrops(pool, drops, NOW);
    assert.equal(JSON.stringify(pool), poolBefore, 'input pool untouched');
    assert.equal(JSON.stringify(drops), dropsBefore, 'input drops untouched');

    const merged = result.pitches.find((p) => p.id === 'scout-a');
    merged.title = 'mutated downstream';
    assert.equal(dropPitch.title, 'Pitch scout-a', 'drop record was copied, not shared');
  });

  test('skips malformed entries without throwing', () => {
    const drops = [
      null,
      { pitches: 'not-an-array' },
      drop([null, { title: 'no id' }, scoutPitch('scout-ok', '2026-07-01T00:00:00.000Z', { active_from: '2026-07-01' })]),
    ];
    const result = scout.mergeDrops([human('h1')], drops, NOW);
    assert.equal(result.added, 1);
    assert.ok(result.pitches.some((p) => p && p.id === 'scout-ok'));
  });
});

// ---------------------------------------------------------------------------
// 2. applyRetirement
// ---------------------------------------------------------------------------

describe('scout.applyRetirement — the rolling freshness window', () => {
  test('newest K scouts stay active; older ones retire; humans untouched', () => {
    const pool = [
      human('h1'),
      scoutPitch('s1', '2026-02-01T00:00:00.000Z'),
      scoutPitch('s2', '2026-02-02T00:00:00.000Z'),
      scoutPitch('s3', '2026-02-03T00:00:00.000Z'),
    ];
    const { pitches, changed } = scout.applyRetirement(pool, 2);
    assert.equal(changed, true);
    const byId = new Map(pitches.map((p) => [p.id, p]));
    assert.equal(byId.get('s1').retired, true, 'oldest scout retires');
    assert.ok(!byId.get('s2').retired);
    assert.ok(!byId.get('s3').retired);
    assert.ok(!byId.get('h1').retired, 'humans never carry the flag');
  });

  test('no-op below the window returns the same array, changed false', () => {
    const pool = [scoutPitch('s1'), scoutPitch('s2')];
    const result = scout.applyRetirement(pool, 4);
    assert.equal(result.changed, false);
    assert.equal(result.pitches, pool);
  });

  test('one-way: already-retired scouts stay retired and do not fill the window', () => {
    const pool = [
      scoutPitch('s1', '2026-02-01T00:00:00.000Z', { retired: true }),
      scoutPitch('s2', '2026-02-02T00:00:00.000Z'),
      scoutPitch('s3', '2026-02-03T00:00:00.000Z'),
    ];
    const { pitches, changed } = scout.applyRetirement(pool, 2);
    assert.equal(changed, false, 'two active scouts fit a window of two');
    const byId = new Map(pitches.map((p) => [p.id, p]));
    assert.equal(byId.get('s1').retired, true);
  });
});

// ---------------------------------------------------------------------------
// 3. composeArenaPool
// ---------------------------------------------------------------------------

describe('scout.composeArenaPool — the share cap', () => {
  const humans6 = Array.from({ length: 6 }, (_, i) => human(`h${i}`));

  test('caps scouts to share of the final pool, keeping the newest', () => {
    const scouts = Array.from({ length: 6 }, (_, i) =>
      scoutPitch(`s${i}`, `2026-02-0${i + 1}T00:00:00.000Z`)
    );
    const pool = scout.composeArenaPool(humans6.concat(scouts), 0.4);
    const kept = pool.filter(scout.isScout).map((p) => p.id);
    // floor(6 * 0.4 / 0.6) = 4 scouts allowed; newest four are s5..s2.
    assert.deepEqual(kept.sort(), ['s2', 's3', 's4', 's5']);
    assert.equal(pool.filter((p) => !scout.isScout(p)).length, 6, 'humans all kept');
  });

  test('survival mode: fewer than two humans means no cap at all', () => {
    const pool = [human('h1'), scoutPitch('s1'), scoutPitch('s2'), scoutPitch('s3')];
    assert.equal(scout.composeArenaPool(pool, 0.4), pool);
  });

  test('share <= 0 removes every scout; a tiny positive share keeps one', () => {
    const pool = humans6.slice(0, 2).concat([scoutPitch('s1'), scoutPitch('s2')]);
    assert.equal(scout.composeArenaPool(pool, 0).filter(scout.isScout).length, 0);
    assert.equal(scout.composeArenaPool(pool, 0.05).filter(scout.isScout).length, 1);
  });

  test('under-cap pools pass through unchanged (same array)', () => {
    const pool = humans6.concat([scoutPitch('s1')]);
    assert.equal(scout.composeArenaPool(pool, 0.4), pool);
  });
});

// ---------------------------------------------------------------------------
// 4. pickPairWithQuota
// ---------------------------------------------------------------------------

describe('scout.pickPairWithQuota — one scout per served pair', () => {
  test('re-picks past a scout-vs-scout pair without touching session history', () => {
    // Scouts sort first (0 comparisons everywhere, oldest created_at), so the
    // raw sampler would serve s1 vs s2; the quota must skip to a mixed pair.
    const pool = [
      scoutPitch('s1', '2026-01-01T00:00:00.000Z'),
      scoutPitch('s2', '2026-01-02T00:00:00.000Z'),
      human('h1', '2026-03-01T00:00:00.000Z'),
    ];
    const seen = new Set();
    const raw = sampler.pickPair(pool, [], new Set());
    assert.ok(
      scout.isScout(raw.pair[0]) && scout.isScout(raw.pair[1]),
      'precondition: the unwrapped sampler WOULD serve scout-vs-scout here'
    );

    const result = scout.pickPairWithQuota(sampler, pool, [], seen);
    assert.equal(result.status, 'ok');
    const scoutCount = result.pair.filter(scout.isScout).length;
    assert.equal(scoutCount, 1, 'served pair holds at most one scout');
    assert.equal(seen.size, 0, "the caller's seenPairs was not mutated");
  });

  test('zero humans: scout-vs-scout is allowed (survival mode)', () => {
    const pool = [scoutPitch('s1'), scoutPitch('s2')];
    const result = scout.pickPairWithQuota(sampler, pool, [], new Set());
    assert.equal(result.status, 'ok');
  });

  test("passes through the sampler's insufficient and exhausted statuses", () => {
    assert.equal(
      scout.pickPairWithQuota(sampler, [human('h1')], [], new Set()).status,
      'insufficient'
    );
    const pool = [human('h1'), scoutPitch('s1')];
    const seen = new Set([sampler.pairKey('h1', 's1')]);
    assert.equal(scout.pickPairWithQuota(sampler, pool, [], seen).status, 'exhausted');
  });
});

// ---------------------------------------------------------------------------
// 5. The bundled drops pass the validator
// ---------------------------------------------------------------------------

describe('scout-data.js — every bundled drop passes the full validator', () => {
  test('validateAll reports zero violations against samples + demo pitches', () => {
    const corpus = SAMPLE_PITCHES.concat(DEMO_PITCHES);
    assert.deepEqual(validateAll(SCOUT_DROPS, corpus, VOCAB), []);
  });

  test('drops ship the documented shape (owner-less, art-less, sourced)', () => {
    assert.ok(SCOUT_DROPS.length >= 1, 'at least Drop 001 ships');
    for (const dropEntry of SCOUT_DROPS) {
      for (const pitch of dropEntry.pitches) {
        assert.equal(pitch.owner_id, null);
        assert.equal(pitch.origin, 'scout');
        assert.equal(pitch.image_url, '');
        assert.ok(pitch.inspiration.sources.length >= 2);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Validator teeth — the mechanical rules actually bite
// ---------------------------------------------------------------------------

describe('validate-drops — the anti-slop rules reject what they must', () => {
  test('banned lexicon is caught (title or description)', () => {
    assert.deepEqual(lexiconHits('An ethereal blade of cosmic energy'), [
      'ethereal',
      'cosmic',
    ]);
    const bad = validScout('lex', {
      description:
        'A blade imbued with ancient light, its edge glowing softly along the ' +
        'fuller, carried by those who remember the old forges of the coast.',
    });
    const problems = validateDrop(drop([bad]), [], VOCAB);
    assert.ok(problems.some((p) => p.includes('banned lexicon: "imbued"')), problems.join('\n'));
  });

  test('near-duplicates of any prior pitch are rejected', () => {
    const prior = validScout('prior');
    const copy = validScout('copy', {
      title: 'A Different Title',
      description: prior.description.replace('dockworker', 'harbor'),
    });
    assert.ok(similarity(prior.description, copy.description) >= 0.4);
    const problems = validateDrop(drop([copy]), [prior], VOCAB);
    assert.ok(problems.some((p) => p.includes('too similar')), problems.join('\n'));
  });

  test('vocabulary, slot collisions, and stagger violations are rejected', () => {
    const a = validScout('a', { item_slot: 'Character Skin', active_from: '2026-07-01' });
    const b = validScout('b', {
      item_slot: 'Character Skin', // collides with a
      theme_tags: ['Rad'], // not a wizard tag
      active_from: '2026-07-01',
      title: 'Second Concept',
      description:
        'A varnished oak buckler rimmed in rope splice work, referenced from ' +
        'lifeboat fittings; the paint is worn exactly where a forearm rests.',
    });
    const c = validScout('c', {
      item_slot: 'Headgear',
      active_from: '2026-07-01', // third on one date: breaks the <=2 stagger
      title: 'Third Concept',
      description:
        'A watch cap knitted from tarred marline with a bone toggle at the ' +
        'brow, referenced from harbor pilots; it darkens when rain soaks it.',
    });
    const problems = validateDrop(drop([a, b, c]), [], VOCAB);
    assert.ok(problems.some((p) => p.includes('share an item_slot')));
    assert.ok(problems.some((p) => p.includes('not in the wizard')));
    assert.ok(problems.some((p) => p.includes('stagger')));
  });

  test('sentence cap and substance floor hold', () => {
    assert.equal(sentenceCount('One. Two! Three? Four.'), 4);
    const thin = validScout('thin', { description: 'Too short to mean anything.' });
    const problems = validateDrop(drop([thin]), [], VOCAB);
    assert.ok(problems.some((p) => p.includes('substance floor')));
  });
});

// ---------------------------------------------------------------------------
// 7. Access split — the scout modules reach neither ranking nor progression
// ---------------------------------------------------------------------------

describe('access split — scout modules stay score-free (static scan)', () => {
  const sourceOf = (name) =>
    readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

  function importSpecifiers(name) {
    const source = sourceOf(name)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const specs = [];
    const re = /\bimport\b[^'"]*['"]([^'"]+)['"]/g;
    let match;
    while ((match = re.exec(source))) specs.push(match[1]);
    return specs;
  }

  test('scout.js imports nothing at all; scout-data.js imports nothing', () => {
    assert.deepEqual(importSpecifiers('scout.js'), []);
    assert.deepEqual(importSpecifiers('scout-data.js'), []);
  });

  test('wizard.js gained only the scout-data import (no ranking/progression)', () => {
    for (const spec of importSpecifiers('wizard.js')) {
      assert.ok(!/ranking|progression/.test(spec), `forbidden import "${spec}"`);
    }
  });
});
