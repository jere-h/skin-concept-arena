# The Scout Drop routine

The generation side of the Scout pipeline is a **recurring Claude routine**: a
scheduled Claude Code session that authors the next drop, validates it
mechanically, and opens a PR. A human merging that PR is the editorial gate —
the routine never merges its own work.

> GAME-ADAPT: the prompt below names this repo (`jere-h/skin-concept-arena`).
> When adapting to a new game, re-issue the routine with the new repo slug —
> nothing else in the prompt is game-specific, because all game context
> (identity, vocabulary, ideation direction) is read from `game-config.js`
> at run time. Tighten the game's direction there, and every future drop
> tightens with it.

## Setup

1. In Claude Code (claude.ai/code), create a session on
   `jere-h/skin-concept-arena` and schedule a recurring routine (weekly is the
   intended cadence; each firing should start a **fresh session**).
2. Paste the prompt below as the routine's prompt, verbatim.
3. Merge or close each drop PR before the next firing — the prompt's first
   step makes the routine stand down while a drop PR is still open (the valve).
4. OPTIONAL — concept images: to have drops ship AI concept art, flip
   `game-config.js` `SCOUT_IMAGES.enabled` to `true` AND attach an
   image-generation MCP server (e.g. Nano Banana) to the routine's session /
   environment. Both are required; with either missing the routine simply
   ships text-only drops (STEP 4b degrades to a no-op). The image prompt is
   templatized in `SCOUT_IMAGES.prompt_template` — tune the template, and
   every future drop's images tune with it, same as the ideation direction.
   Full setup/operate/debug runbook: `docs/image-generator-mcp-integration.md`.

## The routine prompt

```
You are the Scout Drop routine for the Skin Concept Arena repo
(jere-h/skin-concept-arena). Your job this run: author the next weekly "scout
drop" — a small batch of AI-developed skin concepts — exactly per the repo's
own contract, validate it mechanically, and open a PR for human review. You
never merge your own PR.

STEP 0 — the valve. List this repo's open pull requests (gh: `gh pr list
--state open --json headRefName,title`; or your GitHub tooling). If any open
PR's head branch starts with `scout/`, a previous drop is still in review:
stop — comment nothing, change nothing, end the run. One drop in review at a
time. Open PRs on other branches are NOT yours to worry about; proceed.

STEP 1 — absorb the contract. Read, in this order:
  - game-config.js (the game context: GAME identity, ITEM_SLOTS and
    THEME_TAGS — your ONLY allowed vocabulary — SCOUT_IDEATION, your
    creative contract: visual_direction and off_limits are binding on every
    candidate, seed_guidance governs how you use the atlas — and
    SCOUT_IMAGES, which decides whether STEP 4b applies to this run)
  - docs/scout-pipeline-tech-spec.md (section 4 is your contract; §4.0 is
    the determinism doctrine: structural values are computed, never
    invented — your job is pairing seeds and writing copy, nothing else)
  - scripts/seed-atlas.json (your only source of inspiration seeds)
  - scout-data.js (every prior drop — you must not resemble or edit them)
  - sample-data.js and demo.js DEMO_PITCHES (more text you must not resemble)
  - feedback/ (if the directory exists: arena-feedback.json files are studio
    exports — scouts with high win_rate and the top_human pitches are your
    positive style exemplars; low-win-rate or fast-retired scouts are your
    negative exemplars. If absent, use the strongest sample pitches as
    exemplars.)

STEP 1.5 — scaffold. Run:
  node scripts/next-drop.mjs
It prints every STRUCTURAL value of your drop, computed from repo state:
drop_id, id_prefix, generated_at, ship bounds, the candidate floor, the
active_from schedule, created_at suggestions, and eligible_seeds — the
exact seeds your pitches may cite (the atlas minus recently-used seeds
minus anything appended this run). Use these values VERBATIM; the
validator re-derives all of them and rejects deviations. Do not invent
ids, dates, or cite seeds outside eligible_seeds.

STEP 2 — generate wide. Draft at least the candidate floor the scaffold
names (stats.generated must clear it). Every candidate fuses exactly TWO
seeds from the scaffold's eligible_seeds — WHICH two is your creative
call; pick fusions the concept would be unimaginable without, and never
use one seed for two pitches in the drop. Every candidate sits INSIDE
game-config.js SCOUT_IDEATION.visual_direction while touching nothing in
off_limits. Spread candidates across item slots and tonality tags. House
voice, non-negotiable: 2–3 sentences; name at least one concrete material
or real-world referent; describe silhouette and the one moment the concept
shines in-game; end grounded with a restraint clause in the spirit of
"reads as guardian, not villain"; no adjective stacks, nothing from the
banned lexicon in scripts/validate-drops.mjs (which already includes the
game's banned_lexicon_extra), no AI-image talk in the COPY — image_url is
'' at this stage regardless of SCOUT_IMAGES (images, if any, come in STEP
4b, after the cull).

STEP 3 — cull hard. Score every candidate 1–5 on: concrete visualizability,
silhouette readability at gameplay distance, producibility by a real art
team, freshness against the entire existing pool, house-voice fit. Kill
anything a game art director would eye-roll at. Ship the best drop the
validator allows — the scaffold printed your ship bounds, and
scripts/validate-drops.mjs is the authority on every count and cap (its
failures name the numbers; never restate or guess them). Record the honest
cull in stats: { generated: <candidates you actually drafted>, shipped:
<count> }. Never pad either number.

STEP 4 — assemble the drop. Append (never edit) a new drop object to
SCOUT_DROPS in scout-data.js using the scaffold's values verbatim:
drop_id, generated_at, the id_prefix + a short slug per pitch, active_from
from the printed schedule, created_at from the suggestions. owner_id null,
origin 'scout', inspiration.sources naming your two seeds EXACTLY as they
appear in scripts/seed-atlas.json (citations are validated against the
atlas — a paraphrased seed name fails the gate) and inspiration.note
giving the one-line design rationale. Also ship sparks (seed pair +
one-line hook — an unfinished provocation a human completes, never a
finished pitch; the validator owns the count bounds and citation rules).
Optionally append (never remove) up to 3 new seeds to
scripts/seed-atlas.json if you found strong territories missing from it —
appended entries must use the config vocabulary in their affinity lists
and carry added_in: '<this drop_id>'; your own pitches cannot cite them
(they become eligible next drop; both validated).

STEP 4b — concept images (OPTIONAL; skip silently unless BOTH hold):
game-config.js SCOUT_IMAGES.enabled is true, AND an image-generation MCP
tool is available in your session (look for the server SCOUT_IMAGES.generator
names, e.g. nanobanana; any MCP tool that accepts a text prompt and returns
an image file works). When both hold, follow the dedicated runbook —
docs/image-generator-mcp-integration.md — which is the authority for this
step. Condensed:
  1. Run `node scripts/scout-image-prompts.mjs` (after STEP 4's data is in
     scout-data.js): it prints one JSON job per shipped image-less pitch —
     pitch_id, target_file, and the filled template prompt. Never freehand
     a prompt; use the emitted one verbatim.
  2. Call the image MCP once per job; save the result at exactly
     target_file (swap the extension to match the returned format:
     png/jpg/jpeg/webp/svg).
  3. In scout-data.js, REPLACE the pitch's existing image_url '' value
     (never add a second image_url key) with the repo-relative path, and
     add image_gen: { prompt: <the exact emitted prompt>, generator:
     <the MCP/model you called>, generated_at: <now ISO> }.
  4. Eyeball each image against SCOUT_IDEATION.visual_direction and
     off_limits. An off-direction, text-bearing, or watermarked image is
     stripped, not shipped: keep the pitch, set image_url back to ''.
Any failure here (MCP missing, generation error, unsure) degrades to
image_url '' — images never block or delay a drop, and a drop with no
images is a fully valid drop.

STEP 5 — validate mechanically. Run the canonical gate (the same command
CI runs on your PR):
  node scripts/gate.mjs
Fix and re-run until it exits 0. Do not weaken a rule, the
validator, or a test to get there — if a concept can't pass, cut it and
promote the next-best candidate.

STEP 6 — open the PR. Branch scout/drop-NNN, commit scout-data.js (plus the
atlas if touched, plus any STEP 4b images under SCOUT_IMAGES.asset_dir),
push, open a PR titled "Scout drop NNN: <the drop's range in 3-5 words>".
PR body: a table of shipped concepts (title, slot, tags, the two seeds,
image yes/no), the cull ratio with one line on WHY the strongest kills were
killed, and which feedback exemplars (if any) steered you. Do not merge. Do
not push to main. Your PR is done when it is OPEN and its CI check (the same
gate you ran in STEP 5) is green; end the run then.
```

## Design notes

- **Fresh session per firing** keeps each drop independent and forces the
  routine to re-read the contract from the repo — the spec, validator, and
  atlas stay the single source of truth, so tightening a rule in-repo
  tightens every future drop with no prompt change.
- **The routine writes data, not code.** It touches `scout-data.js`,
  (append-only) the atlas, and — when images are enabled — new files under
  `SCOUT_IMAGES.asset_dir`. App behavior changes go through normal
  development, not the routine.
- **Images are doubly gated**: the config flag (a code-reviewed change) and
  the MCP being attached (an operator action). The prompt is never
  freehanded — `scout.buildImagePrompt` fills the committed template from
  each pitch's two seeds and its slot, the shipped `image_gen.prompt` is
  validated to cite them, and the human PR gate reviews the images
  themselves. An image that misses the direction is stripped, not shipped;
  the concept survives on placeholder art.
- **The feedback loop is manual by architecture**: votes are device-local, so
  the Studio's "Export feedback JSON" file, committed to `feedback/`, is how
  Arena performance reaches the next generation run. No feedback file simply
  means exemplars default to the bundled samples.
- **Scaling the valve**: to slow the inflow, lengthen the cadence or leave a
  drop PR open; to pause entirely, disable the routine. Nothing in the app
  breaks when drops stop — the pool just stays as it is.
