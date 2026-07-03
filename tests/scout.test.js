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
//   6a. Concept images   — buildImagePrompt template fill + the image rules
//                          (SCOUT_IMAGES-gated, provenance, asset naming)
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
import { ITEM_SLOTS, THEME_TAGS } from '../game-config.js';
import * as gameConfig from '../game-config.js';
import {
  validateAll,
  validateDrop,
  validateImageAssets,
  lexiconHits,
  similarity,
  sentenceCount,
} from '../scripts/validate-drops.mjs';
import { validateConfig } from '../scripts/validate-config.mjs';
import { imageJobs } from '../scripts/scout-image-prompts.mjs';
import { validateAllData, validateVotes } from '../scripts/validate-data.mjs';
import { validateAtlas, atlasSeedSet, loadAtlas } from '../scripts/validate-drops.mjs';
import { SAMPLE_VOTES } from '../sample-data.js';
import { DEMO_VOTES, DEMO_PROFILE_ID, DEMO_PROGRESS } from '../demo.js';
import { slotGlyphPaths } from '../art.js';

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

  test('drops ship the documented shape (owner-less, sourced, image-honest)', () => {
    // An empty SCOUT_DROPS is legal (a freshly adapted game starts with no
    // drops); whatever IS bundled must carry the contract shape. image_url
    // is '' (placeholder art) unless SCOUT_IMAGES.enabled admits generated
    // concept art — in which case provenance must ride along.
    const images = gameConfig.SCOUT_IMAGES;
    for (const dropEntry of SCOUT_DROPS) {
      for (const pitch of dropEntry.pitches) {
        assert.equal(pitch.owner_id, null);
        assert.equal(pitch.origin, 'scout');
        assert.ok(pitch.inspiration.sources.length >= 2);
        if (pitch.image_url === '') continue;
        assert.equal(images.enabled, true, `${pitch.id} ships an image while images are disabled`);
        assert.ok(
          pitch.image_url.startsWith('data:image/') ||
            pitch.image_url.startsWith(images.asset_dir),
          `${pitch.id} image_url must be committed art or a data URI`
        );
        assert.ok(pitch.image_gen && pitch.image_gen.prompt, `${pitch.id} missing image_gen provenance`);
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
    assert.ok(problems.some((p) => p.includes('not in game-config.js')));
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
// 6a. Concept images — the templatized prompt and the validator's image rules
// ---------------------------------------------------------------------------

describe('scout.buildImagePrompt — templatized, dynamic, fail-safe', () => {
  const TEMPLATE =
    'Concept art for "{title}", a {slot} cosmetic for {game_name}. ' +
    'Fuse {seed_a} and {seed_b}. Mood: {tags}. Direction: {visual_direction}';
  const CONTEXT = { game_name: 'Emberhold', visual_direction: 'grounded, worn materials' };

  test('fills seeds, slot, tags, title, and injected context vars', () => {
    const prompt = scout.buildImagePrompt(validScout('img'), TEMPLATE, CONTEXT);
    assert.ok(prompt.includes('a Character Skin cosmetic for Emberhold'));
    assert.ok(prompt.includes('Fuse Dockworker canvas gear and Brass shipfitting hardware'));
    assert.ok(prompt.includes('Mood: Gritty'));
    assert.ok(prompt.includes('"Test Concept img"'));
    assert.ok(prompt.includes('Direction: grounded, worn materials'));
  });

  test("returns '' (make no image) without two seeds or a template", () => {
    const seedless = validScout('noseeds', { inspiration: { sources: ['only one'], note: 'n' } });
    assert.equal(scout.buildImagePrompt(seedless, TEMPLATE, CONTEXT), '');
    assert.equal(scout.buildImagePrompt(validScout('x'), '', CONTEXT), '');
    assert.equal(scout.buildImagePrompt(validScout('x'), '   ', CONTEXT), '');
    assert.equal(scout.buildImagePrompt(null, TEMPLATE, CONTEXT), '');
  });

  test('unknown placeholders survive verbatim; whitespace collapses; pure', () => {
    const pitch = validScout('typo');
    const before = JSON.stringify(pitch);
    const prompt = scout.buildImagePrompt(pitch, '{slot}   meets\n{not_a_var}', {});
    assert.equal(prompt, 'Character Skin meets {not_a_var}');
    assert.equal(JSON.stringify(pitch), before, 'pitch not mutated');
  });

  test('the SHIPPED template fills cleanly for a real drop pitch (no leftover required placeholders)', () => {
    const pitch = SCOUT_DROPS[0].pitches[0];
    const prompt = scout.buildImagePrompt(pitch, gameConfig.SCOUT_IMAGES.prompt_template, {
      game_name: gameConfig.GAME.name,
      visual_direction: gameConfig.SCOUT_IDEATION.visual_direction,
    });
    assert.ok(prompt.length > 0);
    for (const leftover of ['{seed_a}', '{seed_b}', '{slot}', '{title}', '{tags}', '{description}', '{game_name}', '{visual_direction}']) {
      assert.ok(!prompt.includes(leftover), `unfilled ${leftover} in: ${prompt}`);
    }
    assert.ok(prompt.includes(pitch.item_slot));
    assert.ok(prompt.includes(pitch.inspiration.sources[0]));
    assert.ok(prompt.includes(pitch.inspiration.sources[1]));
  });
});

describe('validate-drops — image rules (SCOUT_IMAGES-gated)', () => {
  const IMAGES_ON = {
    enabled: true,
    generator: 'nanobanana',
    asset_dir: 'assets/scout-art/',
    prompt_template: 'x {seed_a} {seed_b} {slot}',
  };
  const IMAGES_OFF = { ...IMAGES_ON, enabled: false };

  // A validator-clean scout carrying a well-formed generated image.
  function imagedScout(id, over = {}) {
    const base = validScout(id);
    return {
      ...base,
      image_url: `assets/scout-art/${base.id}.png`,
      image_gen: {
        prompt:
          `Concept art for a ${base.item_slot} cosmetic. Fuse Dockworker canvas ` +
          'gear and Brass shipfitting hardware. Plain backdrop, no text.',
        generator: 'nanobanana',
        generated_at: '2026-07-01T00:00:00.000Z',
      },
      ...over,
    };
  }

  const imageProblemsOf = (pitch, images) =>
    validateDrop(drop([pitch]), [], VOCAB, undefined, images).filter((p) =>
      p.includes('image')
    );

  test('a well-formed generated image passes when images are enabled', () => {
    assert.deepEqual(imageProblemsOf(imagedScout('ok'), IMAGES_ON), []);
  });

  test('any image while SCOUT_IMAGES.enabled is false is rejected (the default posture)', () => {
    const problems = imageProblemsOf(imagedScout('gated'), IMAGES_OFF);
    assert.ok(problems.some((p) => p.includes('SCOUT_IMAGES.enabled')), problems.join('\n'));
    // And the shipped config default keeps the pre-image contract intact.
    const shipped = imageProblemsOf(imagedScout('shipped'), undefined);
    assert.equal(shipped.length > 0, !gameConfig.SCOUT_IMAGES.enabled);
  });

  test('external URLs are rejected even when enabled (zero external assets)', () => {
    const bad = imagedScout('ext', { image_url: 'https://cdn.example.com/x.png' });
    const problems = imageProblemsOf(bad, IMAGES_ON);
    assert.ok(problems.some((p) => p.includes('external URL')), problems.join('\n'));
  });

  test('file naming is pitch-id-exact; data:image URIs are accepted', () => {
    const misnamed = imagedScout('name', { image_url: 'assets/scout-art/whatever.png' });
    assert.ok(imageProblemsOf(misnamed, IMAGES_ON).some((p) => p.includes('<pitch-id>')));
    const dataUri = imagedScout('data', { image_url: 'data:image/png;base64,AAAA' });
    assert.deepEqual(imageProblemsOf(dataUri, IMAGES_ON), []);
  });

  test('image_gen provenance is required and its prompt must cite both seeds + the slot', () => {
    const bare = imagedScout('bare');
    delete bare.image_gen;
    assert.ok(imageProblemsOf(bare, IMAGES_ON).some((p) => p.includes('provenance required')));

    const unseeded = imagedScout('unseeded');
    unseeded.image_gen = { ...unseeded.image_gen, prompt: 'A nice Character Skin painting.' };
    const problems = imageProblemsOf(unseeded, IMAGES_ON);
    assert.ok(problems.some((p) => p.includes('must cite seed')), problems.join('\n'));

    const slotless = imagedScout('slotless');
    slotless.image_gen = {
      ...slotless.image_gen,
      prompt: 'Fuse Dockworker canvas gear and Brass shipfitting hardware.',
    };
    assert.ok(imageProblemsOf(slotless, IMAGES_ON).some((p) => p.includes('item_slot')));
  });

  test('the banned lexicon bites image prompts too', () => {
    const sloppy = imagedScout('slop');
    sloppy.image_gen = {
      ...sloppy.image_gen,
      prompt: sloppy.image_gen.prompt + ' Make it ethereal.',
    };
    const problems = imageProblemsOf(sloppy, IMAGES_ON);
    assert.ok(problems.some((p) => p.includes('banned lexicon: "ethereal"')), problems.join('\n'));
  });

  test('imageJobs emits verbatim-usable jobs only for image-less pitches with two seeds', () => {
    const done = imagedScout('done'); // already has art — no job
    const pending = validScout('pending', {
      title: 'Second Test Concept',
      item_slot: 'Headgear',
      description:
        'A boiled-wool watch cap with a stamped brass badge over the brow, ' +
        'referenced from harbor pilot uniforms; the badge is worn to a shine.',
    });
    const seedless = validScout('seedless', {
      title: 'Third Test Concept',
      item_slot: 'Mount',
      inspiration: { sources: ['only one seed'], note: 'n' },
    });
    const jobs = imageJobs([drop([done, pending, seedless])], IMAGES_ON, {
      game_name: 'Emberhold',
    });
    assert.equal(jobs.length, 1, 'one job: not the imaged pitch, not the seedless one');
    assert.equal(jobs[0].pitch_id, 'scout-pending');
    assert.equal(jobs[0].target_file, 'assets/scout-art/scout-pending.png');
    // The emitted prompt satisfies the validator's citation rules by
    // construction — wire it into the pitch and the gate stays green.
    const shipped = {
      ...pending,
      image_url: jobs[0].target_file,
      image_gen: { prompt: jobs[0].prompt, generator: 'nanobanana' },
    };
    assert.deepEqual(imageProblemsOf(shipped, IMAGES_ON), []);
  });

  test("stray image_gen on an image-less pitch is rejected; missing files are caught by the CLI's asset check", () => {
    const stray = validScout('stray', { image_gen: { prompt: 'x', generator: 'y' } });
    assert.ok(imageProblemsOf(stray, IMAGES_ON).some((p) => p.includes('stray')));

    const ghost = imagedScout('ghost');
    const missing = validateImageAssets([drop([ghost])], () => false);
    assert.ok(missing.some((p) => p.includes('not a committed file')), missing.join('\n'));
    assert.deepEqual(validateImageAssets([drop([ghost])], () => true), []);
    // ''/data:/external URLs never hit the filesystem check.
    const skipped = validateImageAssets(
      [drop([validScout('plain'), imagedScout('durl', { image_url: 'data:image/png;base64,AA' })])],
      () => false
    );
    assert.deepEqual(skipped, []);
  });
});

// ---------------------------------------------------------------------------
// 6b. game-config — the bundled config passes its own validator
// ---------------------------------------------------------------------------

describe('game-config.js — the bundled config passes validate-config', () => {
  test('zero fatal violations for the shipped config', () => {
    const problems = validateConfig(gameConfig).filter(
      (p) => !p.startsWith('WARNING')
    );
    assert.deepEqual(problems, []);
  });

  test('capacity warning fires when the window exceeds the share cap (R5, mechanical)', () => {
    const oversized = { ...gameConfig, SCOUT_WINDOW_K: 40 };
    const problems = validateConfig(oversized, { samplePitchCount: 6 });
    assert.ok(
      problems.some((p) => p.startsWith('WARNING') && p.includes('SCOUT_WINDOW_K')),
      problems.join('\n')
    );
    // The shipped config is within capacity: no warning.
    const clean = validateConfig(gameConfig, { samplePitchCount: 6 });
    assert.ok(!clean.some((p) => p.includes('SCOUT_WINDOW_K')));
  });

  test('the validator has teeth: broken configs are rejected', () => {
    const broken = {
      ...gameConfig,
      GAME: { id: 'Bad Slug!', name: '' },
      ITEM_SLOTS: ['Only One'],
      THEME_TAGS: ['A', 'a', ''],
      SCOUT_POOL_SHARE: 0,
      SCOUT_IDEATION: {},
    };
    const problems = validateConfig(broken);
    assert.ok(problems.some((p) => p.includes('GAME')), 'identity checked');
    assert.ok(problems.some((p) => p.includes('ITEM_SLOTS')), 'slot floor checked');
    assert.ok(problems.some((p) => p.includes('unique')), 'tag uniqueness checked');
    assert.ok(problems.some((p) => p.includes('SCOUT_POOL_SHARE')), 'share range checked');
    assert.ok(problems.some((p) => p.includes('visual_direction')), 'ideation checked');
  });

  test('SCOUT_IMAGES contract: required placeholders, sane asset_dir, boolean gate', () => {
    const broken = {
      ...gameConfig,
      SCOUT_IMAGES: {
        enabled: 'yes',
        generator: '',
        asset_dir: '/absolute/../sketchy',
        prompt_template: 'a prompt with only {slot}',
      },
    };
    const problems = validateConfig(broken);
    assert.ok(problems.some((p) => p.includes('SCOUT_IMAGES.enabled')), 'boolean gate checked');
    assert.ok(problems.some((p) => p.includes('SCOUT_IMAGES.generator')), 'generator hint checked');
    assert.ok(problems.some((p) => p.includes('SCOUT_IMAGES.asset_dir')), 'asset dir checked');
    assert.ok(
      problems.some((p) => p.includes('{seed_a}')) && problems.some((p) => p.includes('{seed_b}')),
      'seed placeholders required'
    );
    // Missing block entirely is also loud (adaptation safety).
    const absent = { ...gameConfig, SCOUT_IMAGES: undefined };
    assert.ok(validateConfig(absent).some((p) => p.includes('SCOUT_IMAGES')));
  });
});

// ---------------------------------------------------------------------------
// 6c. Bundled data — the shipped samples/demo pass the integrity validator
// ---------------------------------------------------------------------------

describe('validate-data — bundled sample/demo integrity', () => {
  const shipped = {
    samplePitches: SAMPLE_PITCHES,
    sampleVotes: SAMPLE_VOTES,
    demoPitches: DEMO_PITCHES,
    demoVotes: DEMO_VOTES,
    demoProfileId: DEMO_PROFILE_ID,
    demoProgress: DEMO_PROGRESS,
    drops: SCOUT_DROPS,
    vocab: { slots: ITEM_SLOTS, tags: THEME_TAGS },
    threshold: 5,
  };

  test('the shipped data has zero fatal violations (ledger check included)', () => {
    const fatal = validateAllData(shipped).filter((p) => !p.startsWith('WARNING'));
    assert.deepEqual(fatal, []);
  });

  test('vocabulary drift in bundled data is FATAL, not a warning', () => {
    const drifted = {
      ...shipped,
      samplePitches: SAMPLE_PITCHES.map((p, i) =>
        i === 0 ? { ...p, item_slot: 'Bogus Slot' } : p
      ),
    };
    const fatal = validateAllData(drifted).filter((p) => !p.startsWith('WARNING'));
    assert.ok(
      fatal.some((p) => p.includes('Bogus Slot')),
      fatal.join('\n')
    );
  });

  test('a lying demo ledger is caught (unearned badge claim + missing earned badge)', () => {
    const lying = {
      ...shipped,
      demoProgress: {
        ...DEMO_PROGRESS,
        unlocked: { ...DEMO_PROGRESS.unlocked, 'full-loadout': '2026-06-17T00:00:00.000Z' },
      },
    };
    const problems = validateAllData(lying);
    assert.ok(problems.some((p) => p.includes('claims badge "full-loadout"')), problems.join('\n'));

    const omitting = {
      ...shipped,
      demoProgress: { ...DEMO_PROGRESS, unlocked: {} },
    };
    const omitted = validateAllData(omitting);
    assert.ok(omitted.some((p) => p.includes('toast storm')), omitted.join('\n'));
  });

  test('broken vote wiring is caught (winner not a participant, orphan id, self-battle)', () => {
    const known = new Set(['a', 'b']);
    const bad = [
      { id: 'v1', pitch_a_id: 'a', pitch_b_id: 'b', winner_id: 'c' },
      { id: 'v2', pitch_a_id: 'a', pitch_b_id: 'ghost', winner_id: 'a' },
      { id: 'v3', pitch_a_id: 'a', pitch_b_id: 'a', winner_id: 'a' },
      { id: 'v1', pitch_a_id: 'b', pitch_b_id: 'a', winner_id: 'b' },
    ];
    const problems = validateVotes(bad, known, 'test vote');
    assert.ok(problems.some((p) => p.includes('not one of the two participants')));
    assert.ok(problems.some((p) => p.includes('not a bundled pitch')));
    assert.ok(problems.some((p) => p.includes('cannot battle itself')));
    assert.ok(problems.some((p) => p.includes('duplicate vote id')));
  });

  test('id collisions across samples, demo, and drops are caught', () => {
    const clash = {
      ...shipped,
      demoPitches: DEMO_PITCHES.concat([
        { ...DEMO_PITCHES[0], id: SAMPLE_PITCHES[0].id },
      ]),
    };
    const problems = validateAllData(clash);
    assert.ok(problems.some((p) => p.includes('duplicate pitch id')), problems.join('\n'));
  });
});

// ---------------------------------------------------------------------------
// 6d. Seed atlas + citations + drop-shape additions
// ---------------------------------------------------------------------------

describe('validate-drops — atlas gate, seed citations, sparks, stagger', () => {
  const atlas = loadAtlas();

  test('the shipped atlas passes; the shipped drops cite only real seeds', () => {
    assert.deepEqual(validateAtlas(atlas, VOCAB), []);
    const corpus = SAMPLE_PITCHES.concat(DEMO_PITCHES);
    assert.deepEqual(validateAll(SCOUT_DROPS, corpus, VOCAB, atlas), []);
  });

  test('atlas violations are caught: off-vocab affinity, duplicates, thin atlas', () => {
    const bad = {
      seeds: [
        { seed: 'A thing', affinity: { slots: ['Not A Slot'], tags: ['Not A Tag'] } },
        { seed: 'A thing', affinity: {} },
      ],
    };
    const problems = validateAtlas(bad, VOCAB);
    assert.ok(problems.some((p) => p.includes('Not A Slot')));
    assert.ok(problems.some((p) => p.includes('duplicate seed')));
    assert.ok(problems.some((p) => p.includes('40+')));
  });

  test('a hallucinated inspiration source fails the citation check', () => {
    const seedNames = atlasSeedSet(atlas);
    const fake = validScout('fakecite', {
      inspiration: {
        sources: ['Kintsugi ceramic repair', 'A seed I just made up'],
        note: 'Real note.',
      },
    });
    const d = drop([fake]);
    d.sparks = [
      { id: 'sp-1', sources: ['Kintsugi ceramic repair', 'Carousel horse carving'], hook: 'A hook.' },
      { id: 'sp-2', sources: ['Venetian glassblowing', 'Carousel horse carving'], hook: 'A hook two.' },
      { id: 'sp-3', sources: ['Ukiyo-e wave prints', 'Carousel horse carving'], hook: 'A hook three.' },
    ];
    const problems = validateDrop(d, [], VOCAB, seedNames);
    assert.ok(
      problems.some((p) => p.includes('"A seed I just made up" is not a seed')),
      problems.join('\n')
    );
  });

  test('spark count bounds and pre-generation activation are enforced', () => {
    const early = validScout('early', { active_from: '2026-06-01' });
    const d = drop([early]); // drop() sets generated_at 2026-07-01; sparks []
    const problems = validateDrop(d, [], VOCAB);
    assert.ok(problems.some((p) => p.includes('sparks; must ship')), problems.join('\n'));
    assert.ok(problems.some((p) => p.includes('predates')), problems.join('\n'));
  });
});

// ---------------------------------------------------------------------------
// 6e. art.js glyph resolution — specific match or neutral fallback, never false
// ---------------------------------------------------------------------------

describe('art.slotGlyphPaths — word-prefix matching', () => {
  test('every configured slot resolves, and Weapon Skin gets the sword (not the figure)', () => {
    const figure = slotGlyphPaths('Character Skin');
    const sword = slotGlyphPaths('Weapon Skin');
    assert.notDeepEqual(sword, figure, 'the skin suffix must not hijack weapon slots');
    for (const slot of ITEM_SLOTS) {
      assert.ok(Array.isArray(slotGlyphPaths(slot)), `${slot} resolves`);
    }
  });

  test('substring traps fall back to the neutral diamond instead of a false glyph', () => {
    const diamond = slotGlyphPaths('Completely Unknown Slot');
    assert.deepEqual(slotGlyphPaths('Ship Figurehead'), diamond, "'head' inside figurehead");
    assert.deepEqual(slotGlyphPaths('Cutlass Skin'), diamond, "generic 'skin' suffix");
    assert.notDeepEqual(slotGlyphPaths('Headgear'), diamond, 'real prefix still matches');
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

  test('scout.js, scout-data.js, and game-config.js import nothing at all', () => {
    assert.deepEqual(importSpecifiers('scout.js'), []);
    assert.deepEqual(importSpecifiers('scout-data.js'), []);
    // game-config.js is pure data importable from ANY module (views, pure
    // logic, node scripts) precisely because it imports nothing itself.
    assert.deepEqual(importSpecifiers('game-config.js'), []);
  });

  test('wizard.js gained only the scout-data import (no ranking/progression)', () => {
    for (const spec of importSpecifiers('wizard.js')) {
      assert.ok(!/ranking|progression/.test(spec), `forbidden import "${spec}"`);
    }
  });
});
