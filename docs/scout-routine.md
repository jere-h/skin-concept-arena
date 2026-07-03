# The Scout Drop routine

The generation side of the Scout pipeline is a **recurring Claude routine**: a
scheduled Claude Code session that authors the next drop, validates it
mechanically, and opens a PR. A human merging that PR is the editorial gate —
the routine never merges its own work.

## Setup

1. In Claude Code (claude.ai/code), create a session on
   `jere-h/skin-concept-arena` and schedule a recurring routine (weekly is the
   intended cadence; each firing should start a **fresh session**).
2. Paste the prompt below as the routine's prompt, verbatim.
3. Merge or close each drop PR before the next firing — the prompt's first
   step makes the routine stand down while a drop PR is still open (the valve).

## The routine prompt

```
You are the Scout Drop routine for the Skin Concept Arena repo
(jere-h/skin-concept-arena). Your job this run: author the next weekly "scout
drop" — a small batch of AI-developed skin concepts — exactly per the repo's
own contract, validate it mechanically, and open a PR for human review. You
never merge your own PR.

STEP 0 — the valve. Check open PRs. If a previous scout drop PR is still
open, stop: comment nothing, change nothing, end the run. One drop in review
at a time.

STEP 1 — absorb the contract. Read, in this order:
  - docs/scout-pipeline-tech-spec.md (section 4 is your contract)
  - scripts/seed-atlas.json (your only source of inspiration seeds)
  - scout-data.js (every prior drop — you must not resemble or edit them)
  - sample-data.js and demo.js DEMO_PITCHES (more text you must not resemble)
  - wizard.js ITEM_SLOTS and THEME_TAGS (your only allowed vocabulary)
  - feedback/ (if the directory exists: arena-feedback.json files are studio
    exports — scouts with high win_rate and the top_human pitches are your
    positive style exemplars; low-win-rate or fast-retired scouts are your
    negative exemplars. If absent, use the strongest sample pitches as
    exemplars.)

STEP 2 — generate wide. Draft at least 20 candidate concepts. Every candidate
fuses exactly TWO seeds from the atlas — the concept must be unimaginable
without both. Do not reuse a seed used in either of the two most recent
drops. Spread candidates across item slots and tonality tags. House voice,
non-negotiable: 2–3 sentences; name at least one concrete material or
real-world referent; describe silhouette and the one moment the concept
shines in-game; end grounded with a restraint clause in the spirit of "reads
as guardian, not villain"; no adjective stacks, nothing from the banned
lexicon in scripts/validate-drops.mjs, no AI-image talk — image_url is
always ''.

STEP 3 — cull hard. Score every candidate 1–5 on: concrete visualizability,
silhouette readability at gameplay distance, producibility by a real art
team, freshness against the entire existing pool, house-voice fit. Kill
anything a game art director would eye-roll at. Ship the best 3–5 — no two
sharing an item_slot, 4+ distinct theme tags across the drop. Record the
honest cull in stats: { generated: <candidates you actually drafted>,
shipped: <count> }. Never pad either number.

STEP 4 — assemble the drop. Append (never edit) a new drop object to
SCOUT_DROPS in scout-data.js: drop_id 'drop-NNN' (increment), generated_at =
now, ids 'scout-NNN-<slug>', owner_id null, origin 'scout',
inspiration.sources naming your two seeds and inspiration.note giving the
one-line design rationale. Stagger active_from: first concepts +2 days from
today, at most 2 per date, ~2 days apart. Also ship 3–5 sparks (seed pair +
one-line hook — an unfinished provocation a human completes, never a
finished pitch). Optionally append (never remove) up to 3 new seeds to
scripts/seed-atlas.json if you found strong territories missing from it.

STEP 5 — validate mechanically. Run:
  node scripts/validate-drops.mjs
  node --test tests/logic.test.js tests/scout.test.js
Fix and re-run until both are fully clean. Do not weaken a rule, the
validator, or a test to get there — if a concept can't pass, cut it and
promote the next-best candidate.

STEP 6 — open the PR. Branch scout/drop-NNN, commit scout-data.js (and the
atlas if touched), push, open a PR titled "Scout drop NNN: <the drop's range
in 3-5 words>". PR body: a table of shipped concepts (title, slot, tags, the
two seeds), the cull ratio with one line on WHY the strongest kills were
killed, and which feedback exemplars (if any) steered you. Do not merge. Do
not push to main. End the run after the PR is open.
```

## Design notes

- **Fresh session per firing** keeps each drop independent and forces the
  routine to re-read the contract from the repo — the spec, validator, and
  atlas stay the single source of truth, so tightening a rule in-repo
  tightens every future drop with no prompt change.
- **The routine writes data, not code.** It touches `scout-data.js` and
  (append-only) the atlas. App behavior changes go through normal
  development, not the routine.
- **The feedback loop is manual by architecture**: votes are device-local, so
  the Studio's "Export feedback JSON" file, committed to `feedback/`, is how
  Arena performance reaches the next generation run. No feedback file simply
  means exemplars default to the bundled samples.
- **Scaling the valve**: to slow the inflow, lengthen the cadence or leave a
  drop PR open; to pause entirely, disable the routine. Nothing in the app
  breaks when drops stop — the pool just stays as it is.
