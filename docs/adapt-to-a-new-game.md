# Adapt this repo to a new game

**Audience: an LLM agent** that has cloned this repo and is repurposing it
for its operator's game. Humans welcome too, but the structure below —
explicit inputs, an ordered checklist with exact file paths, and mechanical
verification after every phase — is designed so an agent can execute it
end-to-end with minimal exploration and no guessing.

## Orientation in 30 seconds

Skin Concept Arena is a static, no-build, vanilla-ES-module web app (GitHub
Pages ready): players **Submit** skin concepts through a guided wizard, vote
in blind head-to-head **Arena** battles, climb a progression ladder in their
**Locker**, and the design team reads a passphrase-gated **Studio**
leaderboard. A "Scout pipeline" adds a metered inflow of AI-developed
concepts authored by a recurring agent (docs/scout-routine.md).

**All game context is parameterized.** Every game-specific site carries a
`GAME-ADAPT` marker comment. Your master list:

```
grep -rn "GAME-ADAPT" --include="*.js" --include="*.json" --include="*.html" --include="*.css" --include="*.md" .
```

One file is the hub: **`game-config.js`** — pure data, imported by the app,
the tests, the validators, and the drop routine. Most of the adaptation is
editing that one file plus replacing three bundled data sets.

## Inputs to collect from your operator first

Do not start editing until you have (ask for any that are missing):

1. **Game name** and a slug for it (e.g. "Voltage Drift" / `voltage-drift`).
2. **Cosmetic categories** — the list of slots players pitch for (2 minimum;
   e.g. Car Body, Wheels, Boost Trail, Goal Explosion, Banner). Order
   matters only for the first entry (the wizard's default).
3. **Tonality tags** — how concepts should *feel* (3 minimum, 4+ strongly
   recommended; reuse the shipped seven if the operator has no opinion).
4. **Art direction paragraph** — the game's visual identity, materials,
   what reads on-brand vs off-brand. This becomes the binding contract for
   all AI-generated concepts, so push the operator for specifics.
5. **Off-limits content** — themes the game must never ship.
6. **Studio passphrase** — any memorable string.
7. *(Optional)* 4–6 example concepts the operator likes, for the sample
   pool; otherwise you will write them yourself in step 4.

## The checklist

Work in this order; each phase ends with a command that must pass.

### Phase 1 — the config hub

| # | File | Action |
|---|------|--------|
| 1 | `game-config.js` | Edit every `GAME-ADAPT` block: `GAME`, `STUDIO_PASSPHRASE`, `ITEM_SLOTS`, `THEME_TAGS`, `SCOUT_IDEATION` (visual_direction, off_limits, seed_guidance, banned_lexicon_extra). Leave the tuning constants unless the operator asks. |

**Verify:** `node scripts/validate-config.mjs` → must print `game-config OK`.
Its violation messages tell you exactly which downstream system a bad value
would have broken.

### Phase 2 — the bundled data (three replacements)

| # | File | Action |
|---|------|--------|
| 2 | `scout-data.js` | Reset to `export const SCOUT_DROPS = [];` — drops are game-specific; the routine authors the new game's Drop 001 later. (Keep the file and its header comments.) |
| 3 | `scripts/seed-atlas.json` | Curate for the new game's visual direction: prune domains that can't fit, add domains that do (keep entries concrete and real-world, never borrowed game IP; update each entry's `affinity` slots/tags to the new vocabulary). Keep 40+ entries so the routine has room to combine. |
| 4 | `sample-data.js` | Replace `SAMPLE_PITCHES` (6 pitches: new-game flavored, using the new `ITEM_SLOTS`/`THEME_TAGS` exactly, 2 sentences each, concrete materials) and keep `SAMPLE_VOTES` wired to the new ids with the same shape: ~16 votes, two pitches deliberately left under the comparison threshold. Inline-SVG thumbnails optional — `image_url: ''` uses generated placeholder art. |
| 5 | `demo.js` | Rewrite the four `DEMO_PITCHES`' titles/descriptions/slots/tags for the new game (see the GAME-ADAPT comment there for what to preserve: ids, vote wiring, the Diamond/Gold/Silver/calibrating spread). |

**Verify:** `node scripts/validate-drops.mjs` → `scout drops OK — 0 drop(s)`
(empty is legal), and `node --test tests/logic.test.js tests/scout.test.js`
→ all pass. The tests derive their expectations from `game-config.js`, so
they pass for any valid vocabulary — a failure means a data file contradicts
the config (the message says where).

### Phase 3 — optional polish

| # | File | Action |
|---|------|--------|
| 6 | `art.js` | If new slot names match none of the existing `SLOT_GLYPHS` keywords, add glyph entries (see the GAME-ADAPT comment). Skippable: unmatched slots wear a neutral diamond. |
| 7 | `index.html` | Optionally update `<title>`, meta description, and the `.game-chip` fallback text (the live name injects from config at boot). |
| 8 | `styles.css` | Optionally swap `--accent`/`--accent-ink` (and surface neutrals) for the game's brand. Keep the contrast ratios and the design Locks (one accent, one radius scale, dark theme) — see the GAME-ADAPT note in the token block. |
| 9 | `tutorial.js` steps 3–7 copy | Already config-driven for name/passphrase/threshold; skim the remaining copy for tone fit. |
| 10 | `README.md` | Update the description for the new deployment. |

### Phase 4 — the scout routine

| # | File | Action |
|---|------|--------|
| 11 | `docs/scout-routine.md` | Give your operator the routine prompt with the new repo slug substituted (see the GAME-ADAPT note there). The prompt itself needs no other edits — it reads all game context from `game-config.js` at run time. The routine's first PR is the new game's Drop 001; tell the operator to review it word-by-word (it calibrates the pipeline). |

### Final acceptance

Run all three, in order — all must pass before you tell your operator the
adaptation is done:

```
node scripts/validate-config.mjs
node scripts/validate-drops.mjs
node --test tests/logic.test.js tests/scout.test.js
```

Then smoke-test the real app: serve the directory statically
(`python3 -m http.server`), open it, and confirm — no console errors; the
masthead chip and tour show the new game name; the wizard lists the new
slots and tags; the Arena serves pairs from your new samples; the Studio
unlocks with the new passphrase.

## What NOT to change

These are load-bearing and game-agnostic — changing them is development, not
adaptation:

- **`scout.js`, `sampler.js`, `ranking.js`, `progression.js` logic,
  `store.js`** — the pure engine. (Progression's badge thresholds already
  derive from your config.)
- **The access split** — wizard/arena never import ranking or progression;
  scout modules and `game-config.js` import nothing. Tests enforce this;
  don't fight them.
- **The anti-slop validator rules** (`scripts/validate-drops.mjs`) — extend
  the lexicon via `game-config.js` `banned_lexicon_extra`, never by editing
  the base list or loosening a rule.
- **Design Locks** in `styles.css` — one accent, one radius scale, dark
  theme, 150–220ms transform/opacity motion.
- **Storage keys** (`sca.*.v1`) — fine to keep for a new game on its own
  domain (localStorage is per-origin). Only bump if two deployments must
  share one origin.

## If something doesn't fit

If the operator's game genuinely can't express itself in these parameters
(e.g. needs pitch fields beyond slot/tags/title/description), that is a
schema change, not an adaptation — read `docs/scout-pipeline-tech-spec.md`
first, keep every new pitch field tolerated-absent, and extend
`tests/` accordingly.
