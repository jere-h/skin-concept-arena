# Skin Concept Arena — agent orientation

Static, no-build, vanilla-ES-module web app (GitHub Pages ready; everything
persists in localStorage). Players **Submit** skin concepts via a guided
wizard, vote in blind head-to-head **Arena** battles, track private
progression in the **Locker**, and the design team reads the
passphrase-gated **Studio** leaderboard. A **Scout pipeline** drips in
AI-developed concepts authored by a recurring routine
(`docs/scout-routine.md`) as human-reviewed PRs.

## Adapting this repo to a different game?

Follow **`docs/adapt-to-a-new-game.md`** — an ordered, mechanically-verified
checklist written for LLM agents. The short version:

- **`game-config.js` is the single game-context hub** (identity, cosmetic
  slots, tonality tags, tuning, AI-ideation direction). Most adaptation is
  that one file plus replacing the bundled sample/demo/drop data.
- Every game-specific site is marked. Enumerate them all with:
  `grep -rn "GAME-ADAPT" --include="*.js" --include="*.json" --include="*.html" --include="*.css" --include="*.md" .`
- Verify with `node scripts/validate-config.mjs` after config edits.

## Commands

```
node scripts/gate.mjs             # THE canonical gate: config → data → drops → tests
python3 -m http.server            # run the app (any static server)
```

The gate is what CI, the adaptation guide, and the drop routine all run —
one entrypoint, no drift. Its individual steps, when you need just one:

```
node scripts/validate-config.mjs  # game-config contract
node scripts/validate-data.mjs    # sample/demo integrity (votes, ledger, vocabulary)
node scripts/validate-drops.mjs   # scout-drop + seed-atlas contract
node --test tests/logic.test.js tests/scout.test.js
```

## Architecture invariants (do not break; tests enforce them)

- **Access split:** `wizard.js`/`arena.js` (participant views) never import
  `ranking.js` or `progression.js`; only `studio.js` calls `ranking.rank`.
  Tiny app.js-derived callbacks cross the seam instead.
- **Pure-data modules import nothing:** `game-config.js`, `scout.js`,
  `scout-data.js` — that is what makes them safe to import from anywhere
  (views, node scripts, tests).
- **Monotonic progression:** career points/ranks never decrease; peaks
  ratchet up only (property-tested).
- **Scouts are owner-less** (`owner_id: null`): everyone's Arena, no one's
  Locker, zero progression impact. Blind in the Arena, fully attributed in
  the Studio.
- **Fail-safe everywhere:** store reads/writes never throw; decoration
  (toasts, art, sparks, tour) can never break the action underneath it.
- **Design Locks** (`styles.css` token block): one accent, one radius scale,
  one dark theme, 150–220ms transform/opacity motion, zero external assets.

## Key docs

- `docs/adapt-to-a-new-game.md` — repurpose the repo for another game (LLM-optimized)
- `docs/scout-pipeline-tech-spec.md` — the Scout pipeline contract (data shapes, module APIs, drop rules)
- `docs/scout-routine.md` — the recurring drop-authoring routine + its prompt
- `docs/ai-scout-pipeline-plan.md` — the design rationale (anti-slop guardrails)
- `docs/vote-backend-tech-spec.md` — proposed shared vote/pitch backend (LLM-implementable spec; not yet built)
