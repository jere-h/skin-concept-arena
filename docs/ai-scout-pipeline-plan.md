# The Scout Pipeline: AI-developed skin concepts that don't read as slop

**Status:** implementation plan (synthesized from a 3-iteration brainstorm, below)

## Problem

The bottleneck is at the top of the funnel. Fresh human ideas are few, slow,
and inconsistent, so the Arena and the Studio leaderboard starve: studio leads
open the app and there is nothing new to review, voters see the same pairs,
and the tool stops jolting anyone's inspiration.

The fix is a steady, small inflow of AI-developed skin concepts ("scouts")
drawing on other games and other industries — enough that there is always
something new to review and vote on. The dominant risk is that AI-generated
concepts immediately read as underwhelming slop, which would poison trust in
the whole pool.

Two hard constraints from the existing architecture shape every solution:

1. **Static app, no backend.** GitHub Pages, vanilla ES modules, no build
   step. There is nowhere to run an LLM at page-load time, and committed data
   *is* the distribution channel (every push to `main` redeploys).
2. **All state is device-local.** Votes live in each device's localStorage
   and never leave it. There is no aggregated telemetry, so any "learn from
   the votes" loop is manual or per-device by construction.

---

## The brainstorm (3 iterations)

### Iteration 1 — widest net

Twelve candidate directions:

| # | Idea |
|---|------|
| 1 | **Runtime generation, BYO key** — a Studio-side panel where a lead pastes an Anthropic API key and generates concepts on demand, client-side. |
| 2 | **Scheduled GitHub Action generator** — a weekly cron calls the Claude API, writes a small "drop" of concepts into the repo; the deployed app picks them up. |
| 3 | **Pre-committed idea bank with date-gated drip** — generate a large bank once, ship it all, reveal a few per week by date arithmetic. Zero runtime infra. |
| 4 | **Cross-domain seed atlas** — a hand-curated file of concrete real-world references (Edo firefighter coats, F1 pit-crew livery, deep-sea bioluminescence, Soviet space-program graphics, netsuke carving, Alpine mountaineering kit…). The generator must fuse two seeds + an item slot + a tonality tag. Diversity comes from the seeds, not the model's priors. |
| 5 | **House-style contract + banned-cliché lexicon** — distill the style of the existing sample pitches (two sentences, concrete materials, silhouette-first, one restraint clause like "reads as guardian, not villain") into the prompt, few-shot from the best human pitches, and mechanically reject slop markers ("ethereal", "nexus", "glowing runes", "cosmic energy", adjective stacks). |
| 6 | **Overgenerate and cull** — generate ~40 candidates, dedupe against the whole existing pool, score with an LLM judge on a rubric (specificity, silhouette readability at gameplay distance, producibility, freshness), ship the top 3–5. |
| 7 | **Evolutionary loop** — treat the Arena as a fitness function: winning scouts breed variants, losers die, generation N+1 conditions on what survived. |
| 8 | **Sparks, not pitches** — AI emits *inspiration prompts* (a seed pair plus a one-line hook), surfaced inside the Submit wizard for humans to complete, instead of only finished pitches. |
| 9 | **Riff affordance** — every scout concept carries a "riff on this" action that pre-fills the wizard, converting AI output back into human input. |
| 10 | **Provenance display** — each scout carries its seed citation and a short design rationale, visible to studio leads. |
| 11 | **AI-generated thumbnail images** for scout pitches. |
| 12 | **Ratio governance** — cap the scout share of the pool and of served pairs; tie drip cadence inversely to human submission rate (a valve, not a firehose). |

**Review 1 (kill / keep / merge):**

- **Kill #11.** AI images are the fastest slop tell there is, they'd break the
  zero-external-assets design lock, and the app already has a good
  deterministic placeholder-art system. Scouts should wear exactly the same
  art treatment as human pitches.
- **Demote #1** to an optional Studio convenience later; as the *primary*
  pipeline it has key-handling friction and produces nothing when nobody is
  sitting in the Studio. The stated need is a *steady* inflow.
- **Merge #2 + #3.** The Action is the steady-inflow mechanism; the committed
  bank is what makes the app keep working if the Action never runs. Same
  artifact: drops are committed data either way.
- **Keep #4, #5, #6** — these three together are the anti-slop core. Slop is
  what a model produces when nothing constrains it; seeds force grounding,
  the style contract forces the house voice, the cull forces scarcity.
- **Flag #7** for scrutiny: it assumes a global fitness signal that may not
  exist (votes are device-local).
- **Elevate #8 + #9.** The stated bottleneck is *humans can't think of ideas
  and can't input them in a structured way*. Finished AI pitches feed the
  review pipeline; sparks and riffs feed human creativity. These are two
  different products and both should ship.
- **Keep #10, #12.** Provenance is what separates "researched reference" from
  "hallucinated vibe"; governance is what separates "steady inflow" from
  "machine flood".
- **New question raised:** are scouts labeled in the Arena (biases votes) or
  blind (feels deceptive)? And do scouts pollute the leaderboard signal leads
  use to read human taste?

### Iteration 2 — deepen the survivors, work out the mechanics

**The generation recipe** (one "drop"):

1. Sample seed pairs from the atlas with coverage constraints, so a drop
   spans item slots and tonality tags instead of clustering on Weapon/Badass.
2. Prompt = house-style contract + few-shot of the strongest existing pitches
   + the two seeds + slot + tags + the *entire current pool's titles and
   descriptions* with an explicit "do not resemble any of these" instruction.
3. Overgenerate ~8× the ship count.
4. **Mechanical lint** (code, not vibes): banned-lexicon scan, length caps
   (same 80-char title / 600-char description the wizard enforces), adjective
   density ceiling, no em-dash-spam, must name at least one concrete material
   or real-world referent.
5. Lexical-similarity dedupe against the full pool + all prior drops.
6. LLM-judge pass on a rubric: concrete visualizability, silhouette
   readability at gameplay distance, producibility by a real art team,
   freshness, house-voice fit. Kill anything an art director would eye-roll.
7. Ship the top 3–5 with cull stats recorded in the drop ("shipped 4 of 32").

**Distribution mechanics:**

- Pitch records gain `origin: 'scout'` plus `inspiration` provenance; both
  tolerated-absent everywhere, like `owner_id` already is.
- Drops ship as a committed ES module (`scout-data.js`), not a fetched JSON —
  no fetch, no CORS, works offline, zero build step, same pattern as
  `sample-data.js`.
- At boot, a merge pass appends drop pitches not yet in `sca.pitches.v1`
  (idempotent by id). Staggered `active_from` dates inside a drop trickle 1–2
  concepts per day instead of dumping five at once.
- **Rolling freshness window:** only the newest K scouts stay in the Arena
  pool; older ones are retired (flagged, not deleted — votes and Studio rows
  survive). Freshness by rotation needs no performance telemetry.
- **Pair quota:** at most one scout per served pair, and scouts capped to a
  share of the active pool (~40%), so the Arena never feels machine-flooded
  and scout-vs-scout pairs never burn human voting attention.

**The labeling decision:** the Arena stays blind — voters don't see human
authors either; that's the product's defining ethos — but the methodology
tooltip discloses that the pool includes AI-scouted concepts, and the Studio
labels every scout row with a chip plus expandable provenance. Blind at the
ballot, disclosed in the fine print, fully attributed to the decision-makers.

**Studio additions:** a "hide scouted" leaderboard toggle (so leads can read
pure human taste), and a **Scout Report** panel per drop: seeds used,
rationale, cull stats, win-rates so far, and an export button.

**Review 2 (the hard-nosed pass):**

- **The telemetry catch, confirmed.** Votes never leave the device, so the
  evolutionary loop (#7) cannot run automatically. Downgrade honestly:
  (a) the Studio export produces a JSON of scout performance + the strongest
  human pitches; a lead commits it to `feedback/` in the repo; the next
  generation run conditions on it as positive/negative exemplars.
  (b) In practice the studio lead's device is the canonical dataset in this
  deployment model — acceptable for v1, worth stating out loud.
- **Leaderboard pollution: solved** by the label chip + toggle.
- **A discovered feature, not a bug:** voting on scouts still pays voter
  career points and badges — exactly what keeps voters engaged during human
  droughts, which is the stated purpose.
- **New anti-slop filter found:** the Action should open a **PR**, not push
  to `main`. A human merging the drop is an editorial desk — curation gate,
  safety gate, and deploy trigger (Pages deploys on push to `main`) in one.
- **Sparks staleness:** generate a handful of sparks in the same drop file so
  the wizard's inspiration panel rotates with the pipeline.

### Iteration 3 — walk the loop end-to-end, converge

Full cycle: Action runs weekly → opens a drop PR → lead merges (editorial
gate) → Pages redeploys → app boots and merges newly-active scouts → Arena
serves mixed pairs under quota → Studio shows labeled scout report → lead
exports feedback → next Action run conditions on it. Failure probes:

- **Nobody merges the PR** → no new scouts, app keeps working on the existing
  window. The valve closes gracefully. ✅
- **Sampler monopoly:** `pickPair` serves fewest-compared first, so a 5-pitch
  drop would monopolize every pair until calibrated. The staggered
  `active_from` dates plus the one-scout-per-pair rule bound this to "each
  new scout appears in at most one card of each pair, a couple of new scouts
  per day." ✅
- **Progression integrity:** scouts carry `owner_id: null` like sample
  pitches — they appear in everyone's Arena, no one's Locker, and can't earn
  or distort career points. Monotonicity untouched. ✅
- **Access split:** the new `scout.js` must never import `ranking.js` or
  `progression.js`; extend the existing static import-graph guard test. ✅
- **Offline / no-Action deployments:** everything degrades to the committed
  bank; a fork with no API key still gets Drop 001. ✅
- **MVP boundary set:** plumbing + one hand-audited drop first; automation
  second; inspiration surfaces third. Slop risk is front-loaded into the
  hand-audited drop, where a human can verify the recipe produces quality
  before any automation amplifies it.

---

## Synthesis: the eight anti-slop guardrails

Slop is not one failure; it's eight, and each gets a specific mechanism:

| # | Slop failure mode | Guardrail |
|---|---|---|
| 1 | Generic free-association ("celestial dragon armor") | **Forced cross-domain grounding**: every concept fuses two concrete seeds from a curated atlas of real games/industries/crafts/nature |
| 2 | Purple prose, adjective soup | **House-style contract**: few-shot from the best existing pitches; concrete materials, silhouette-first, one restraint clause; same length caps as humans |
| 3 | Recognizable AI tics | **Mechanical cliché lint** in code — banned lexicon, adjective-density ceiling, must name a real material/referent |
| 4 | Mediocre median quality | **Overgenerate → dedupe → judge → cull**: ship 3–5 of ~40, publish the kill ratio |
| 5 | Unvetted machine output | **Human editorial gate**: drops arrive as PRs; a person merges |
| 6 | Flood and staleness | **Scarcity + rotation**: small weekly drops, staggered activation, rolling retirement window, ≤1 scout per pair, capped pool share |
| 7 | "Spot the AI" formatting tells | **Identical presentation**: same placeholder art system (no AI images), same caps, same card layout |
| 8 | Ideas that feel hallucinated | **Provenance on every concept**: real-world sources + one-line rationale, reviewable as research |

And the second product alongside finished concepts: **sparks** — seed pairs
with a one-line hook in the Submit wizard, plus "riff on this" on scout rows
in the Studio — so the pipeline attacks the human-ideation bottleneck
directly, not just the review-supply bottleneck.

---

## Implementation plan

### Data model (all fields tolerated-absent, like `owner_id` today)

```
Pitch additions:
  origin        'scout' | absent            // absent = human or sample
  inspiration   { sources: string[], note: string } | absent
  active_from   ISO date | absent           // scout drip-in date
  retired       true | absent               // rotation flag; never deleted

Drop (in scout-data.js):
  { drop_id, generated_at,
    stats: { generated, shipped },
    pitches: Pitch[],                        // owner_id: null, origin: 'scout'
    sparks: [{ id, sources: string[], hook }] }
```

### Phase 1 — app-side plumbing + hand-audited Drop 001 (ships value alone)

| File | Change |
|---|---|
| `scout-data.js` (new) | Committed drops module, same pattern as `sample-data.js`. Drop 001 is generated with the Phase-2 recipe run by hand and audited line-by-line — the recipe's proving ground. |
| `scout.js` (new) | Pure, DOM-free: `mergeDrops(pitches, drops, now)` (idempotent by id, honors `active_from`), `applyRetirement(pitches, windowK)` (rolling window by `created_at`), `composeArenaPool(pitches, caps)` (scout share cap), `constrainPair(pair)` helper (≤1 scout per pair). Never imports ranking/progression. |
| `store.js` | No signature changes. `app.js` boot calls the merge pass once and persists through the existing `savePitches`. |
| `app.js` | Boot: merge newly-active drop pitches, apply retirement window. Constants: `SCOUT_POOL_SHARE`, `SCOUT_WINDOW_K`. |
| `arena.js` | Filter `retired` from the pool; enforce the scout quota via `scout.composeArenaPool` before handing the pool to the (unchanged, pure) sampler; re-sample when a pair would hold two scouts. |
| `studio.js` | "Scout" chip + expandable provenance (sources, note, drop id) on scout rows; "hide scouted" toggle for a pure-human read of the leaderboard. |
| `index.html` | Methodology tooltip gains one disclosure line: the pool includes AI-scouted concepts, blind in the Arena, labeled here. |
| `tests/logic.test.js` | Merge idempotency (double-merge adds nothing), `active_from` gating, retirement window, pool-share cap, pair constraint, ranking unaffected by `retired`/`origin`, access-split guard extended to `scout.js`, progression untouched by scout pitches (owner-less). |

### Phase 2 — the generator + weekly automation

| File | Change |
|---|---|
| `scripts/seed-atlas.json` (new) | 100+ curated concrete references across other games' skin lines, fashion history, industrial design, crafts, subcultures, biology, sport, architecture — each tagged with affine slots/tonalities. Hand-built once, grows over time; this file is where "drawing from other games and industries" actually lives. |
| `scripts/lib/generate.mjs` (new) | Pure, testable pieces: seed sampling with coverage constraints, banned-lexicon lint, length/adjective checks, lexical dedupe vs pool + prior drops, judge-rubric parsing, drop assembly with cull stats. |
| `scripts/generate-drop.mjs` (new) | Orchestrator: builds the prompt (house-style contract + few-shot + full-pool "do not resemble" context + optional `feedback/` exemplars), calls the Claude API, overgenerates ~8×, runs lint → dedupe → judge → cull, emits the new drop into `scout-data.js` with staggered `active_from` dates, plus 3–5 sparks. Runnable locally with `ANTHROPIC_API_KEY` set. |
| `.github/workflows/scout-drop.yml` (new) | Weekly cron + `workflow_dispatch`; runs the script; **opens a PR** (the editorial gate). Merging deploys via the existing Pages workflow. Skips gracefully when the secret is absent. |
| `tests/` | Unit tests for the pure `scripts/lib` functions (lint catches the banned lexicon, dedupe catches near-copies, coverage sampler spans slots/tags). |

### Phase 3 — inspiration surfaces + the feedback loop

| File | Change |
|---|---|
| `wizard.js` | "Need a spark?" panel: draws a spark (seed pair + hook) from the bundled drops, shuffle button, one-tap apply of its suggested slot/tags to the form. Attacks the structured-input bottleneck directly. |
| `studio.js` | Scout Report panel per drop (seeds, rationale, cull stats, win-rates); "riff on this" on any row → jumps to Submit with slot/tags pre-filled; **Export feedback** button producing a JSON of scout win/loss records + top human pitches. |
| `feedback/` (new dir) | A lead commits the export here; `generate-drop.mjs` conditions the next drop on it (survivors as positive exemplars, casualties as negative). Closes the quality ratchet manually — honest about the device-local-votes constraint. |
| `demo.js` / `tutorial.js` | Demo profile gains a couple of scout votes; tour mentions sparks. |

### Risks and open questions

- **`ANTHROPIC_API_KEY` repo secret** is required for Phase 2; without it the
  pipeline stays manual (run the script locally, open the PR yourself).
- **Blind-vs-disclosed voting** defaults to blind-with-tooltip-disclosure;
  if voters should see a "scouted" chip on cards, it's a one-line change in
  `arena.js` — flagged as a product decision, not an architectural one.
- **Cross-device divergence** is inherent to the current architecture: drops
  converge on all devices (merged by id), votes remain per-device. The
  Studio lead's device is the canonical read in this deployment model.
- **Judge-model self-agreement**: an LLM judging an LLM inflates scores; the
  hand-audited Drop 001 and the PR gate are the calibration backstops, and
  the rubric scores ship inside the drop file so a human can audit them.
