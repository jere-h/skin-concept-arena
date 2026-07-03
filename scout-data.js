// scout-data.js
//
// GAME-ADAPT: drops are game-specific. When adapting to a new game, RESET
// this to `export const SCOUT_DROPS = [];` (the app, tests, and validator
// all tolerate an empty drops list) and let the scout-drop routine
// (docs/scout-routine.md) author the new game's Drop 001 under the new
// game-config.js SCOUT_IDEATION direction. Hand-audit that first drop.
//
// Committed Scout drops — AI-developed skin concepts merged into the pool at
// boot (scout.js), plus the wizard's inspiration sparks. Same bundled-data
// pattern as sample-data.js: an ES module, no fetch, no build step, works
// offline. See docs/scout-pipeline-tech-spec.md for the full contract.
//
// Rules that keep this file honest (validated by scripts/validate-drops.mjs):
//   - Every concept fuses TWO seeds from scripts/seed-atlas.json and cites
//     them in inspiration.sources, with a one-line rationale note.
//   - game-config.js vocabulary only (ITEM_SLOTS / THEME_TAGS), wizard
//     length caps.
//   - owner_id null (belongs to no one: everyone's Arena, no one's Locker),
//     image_url '' (deterministic placeholder art — never AI images).
//   - active_from staggers a drop into the pool a couple of concepts at a
//     time; created_at is generation time.
//   - Drops are APPEND-ONLY. A merged drop is never edited — device stores
//     have already copied it.
//
// Drop 001 was hand-authored and line-by-line audited against the recipe (the
// spec's proving ground for the recurring routine that generates later drops).
// stats records the honest cull: candidates drafted vs concepts shipped.

export const SCOUT_DROPS = [
  {
    drop_id: 'drop-001',
    generated_at: '2026-07-03T09:00:00.000Z',
    stats: { generated: 14, shipped: 5 },
    pitches: [
      {
        id: 'scout-001-ashwalker',
        item_slot: 'Character Skin',
        theme_tags: ['Gritty', 'Badass'],
        title: 'Ashwalker Brigade',
        description:
          'A heavy quilted fire coat in soot-grey sashiko stitching, cut like a modern smokejumper rig with rope tools and buckles at the hip. Its lining is painted with a single gold carp that only shows at the hem mid-sprint — quiet at rest, earned flash in motion.',
        image_url: '',
        owner_id: null,
        origin: 'scout',
        inspiration: {
          sources: [
            'Edo hikeshi firefighter coats (reversible painted linings)',
            'Smokejumper wildfire gear',
          ],
          note:
            'Hikeshi coats were reversible: plain toward the fire, painted lining for the walk home. A reveal that only shows in motion gives Emberhold a flex that stays humble at rest.',
        },
        active_from: '2026-07-03',
        created_at: '2026-07-03T09:01:00.000Z',
      },
      {
        id: 'scout-001-mended-oath',
        item_slot: 'Weapon Skin',
        theme_tags: ['Elegant', 'Gritty'],
        title: 'Mended Oath',
        description:
          'A cracked longsword rebuilt the kintsugi way: dull-gold lacquer seams tracing every old break across watered damascus steel. The blade stays matte and unpolished, so the repairs — not the shine — carry the story.',
        image_url: '',
        owner_id: null,
        origin: 'scout',
        inspiration: {
          sources: ['Kintsugi ceramic repair', 'Damascus steel water patterns'],
          note:
            'Kintsugi treats damage as history rather than shame; on a weapon it reads as veteran, not loot.',
        },
        active_from: '2026-07-03',
        created_at: '2026-07-03T09:02:00.000Z',
      },
      {
        id: 'scout-001-bathyal-courier',
        item_slot: 'Mount',
        theme_tags: ['Creepy', 'Dreamy'],
        title: 'Bathyal Courier',
        description:
          'A dented little submersible that swims through air the way it once swam the deep, one porthole lit the weak green of old instrument dials. A single lure-light dangles ahead of it on a cable; everything else is patched steel, rivets, and rust streaks.',
        image_url: '',
        owner_id: null,
        origin: 'scout',
        inspiration: {
          sources: ['Deep-sea anglerfish lures', 'Soviet-era Mir submersibles'],
          note:
            'The scariest deep-sea light is the small one you follow. A mount that glows less than the player expects reads eerie without VFX spam.',
        },
        active_from: '2026-07-05',
        created_at: '2026-07-03T09:03:00.000Z',
      },
      {
        id: 'scout-001-falconers-post',
        item_slot: 'Back Bling / Cape',
        theme_tags: ['Elegant', 'Gritty'],
        title: "Falconer's Post",
        description:
          'A weathered leather mail-satchel worn high between the shoulders, its flap stamped with old route marks, a hooded kestrel perched on top. Stand still a few seconds and the bird unhoods and stretches one wing; move, and it settles back to travel posture.',
        image_url: '',
        owner_id: null,
        origin: 'scout',
        inspiration: {
          sources: ['Falconry hoods and jesses', 'Bicycle courier satchel culture'],
          note:
            'Couriers and falconers both dress for the job, not the look — the bird is the ornament, the satchel is the work.',
        },
        active_from: '2026-07-07',
        created_at: '2026-07-03T09:04:00.000Z',
      },
      {
        id: 'scout-001-full-service',
        item_slot: 'Emote',
        theme_tags: ['Goofy'],
        title: 'Full Service',
        description:
          "The character drops to one knee and rattles an invisible wheel gun against their own boot like a three-second tire change, then pops up and taps a crisp Morse 'OK' on the side of their helmet. No props left behind — the joke lands harder the more urgent the moment.",
        image_url: '',
        owner_id: null,
        origin: 'scout',
        inspiration: {
          sources: ['F1 pit-crew livery and wheel guns', 'Telegraph keys and Morse code'],
          note:
            'Pit stops and telegraphy are both speed under pressure; compressing them into a taunt makes urgency itself the punchline.',
        },
        active_from: '2026-07-09',
        created_at: '2026-07-03T09:05:00.000Z',
      },
    ],
    sparks: [
      {
        id: 'spark-001-glass-storm',
        sources: ['Venetian glassblowing', 'Storm-chaser vans and weather balloons'],
        hook:
          'A skin that looks blown into shape an hour before the storm hit — and might not survive the next one.',
      },
      {
        id: 'spark-001-sledge-picado',
        sources: ['Antarctic expedition sledge flags', 'Papel picado cut-paper banners'],
        hook:
          'Victory decorations for a place that eats decorations: whatever survives the wind IS the design.',
      },
      {
        id: 'spark-001-prajioud-griptape',
        sources: ['Muay Thai prajioud armbands', 'Skateboard grip-tape art'],
        hook:
          'Gear that records every fight it has been through — the wear marks are the cosmetic.',
      },
      {
        id: 'spark-001-fresnel-lucha',
        sources: ['Lighthouse Fresnel lenses', 'Lucha libre mask lineages'],
        hook:
          'A mask that bends light like a lighthouse lens: the persona is brightest exactly when the wearer turns to face you.',
      },
      {
        id: 'spark-001-carousel-caparison',
        sources: ['Carousel horse carving', 'Jousting caparisons and heraldry'],
        hook:
          'A parade mount that takes itself completely seriously — the joke is that nobody around it laughs.',
      },
    ],
  },
];
