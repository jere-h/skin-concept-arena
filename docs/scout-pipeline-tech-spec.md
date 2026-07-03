# Scout Pipeline — Technical Specification

**Status:** implemented (rev 6 — see Review log at the bottom)
**Rev 6 note ("deterministic pipeline"):** the determinism doctrine (§4.0)
made explicit and mechanical. New: `scripts/next-drop.mjs` computes every
structural value of the next drop (id, schedule, timestamps, seed
eligibility); the validator re-derives the same values and enforces the
objective ideation rules (seed recency, no self-citation of same-run atlas
additions, intra-drop seed spread, consecutive drop numbering, the real 4x
overgeneration floor, title near-duplicates, feedback-file schema). Rules
tightened at rev 6 apply to drops generated on/after `PLAN_RULES_SINCE`
(2026-07-04) — earlier drops are append-only and grandfathered. Simplified:
the image path's data-URI variant is gone (committed files only) and the
routine prompt no longer restates validator-owned numbers.
**Rev 5 note:** optional AI **concept images** via an image-generator MCP
(e.g. Nano Banana), opt-in through `game-config.js` `SCOUT_IMAGES` and OFF
by default. The prompt is templatized and dynamic — filled per pitch from
its two inspiration seeds and its cosmetic category by
`scout.buildImagePrompt` — and shipped images carry `image_gen` provenance
the validator re-checks. See §1.1, §4.2.7, and §4.4.
**Rev 4 note:** all game-specific values (identity, vocabulary, tuning,
scout-ideation direction) moved to `game-config.js`, the single game-context
hub, as part of the multi-game parameterization
(`docs/adapt-to-a-new-game.md`). Where this spec says "wizard vocabulary",
read "game-config.js vocabulary".
**Parent:** `docs/ai-scout-pipeline-plan.md` (the 3-iteration brainstorm this
spec implements)

The Scout pipeline gives the Arena a steady, small inflow of AI-developed
skin concepts ("scouts") so studio leads always have fresh material to review,
without the pool ever reading as machine-flooded slop. Generation happens
*outside* the app (a recurring Claude routine authors drops and opens PRs);
the app's job is to merge, meter, label, and report.

---

## 1. Data contracts

### 1.1 Pitch (extended)

All new fields are **tolerated-absent** everywhere, exactly like `owner_id`
after the progression add-on. A pre-scout pitch is byte-for-byte valid.

```
Pitch {
  id            string          // scout ids are prefixed 'scout-'
  item_slot     string          // MUST be one of game-config.js ITEM_SLOTS for scouts
  theme_tags    string[]        // MUST be from game-config.js THEME_TAGS for scouts
  title         string          // <= 80 chars (wizard parity)
  description   string          // <= 600 chars (wizard parity)
  image_url     string          // '' (placeholder art) — or, ONLY when
                                // game-config SCOUT_IMAGES.enabled, generated
                                // concept art: '<asset_dir><pitch-id>.<ext>'
                                // (committed file; never http(s)) (§4.4)
  owner_id      null            // scouts belong to no one (sample-pitch shape)
  created_at    ISO string

  // Scout-only additions (absent on human/sample pitches):
  origin        'scout'
  inspiration   { sources: string[], note: string }   // 2+ real-world seeds
  active_from   ISO string      // merge gate: pitch enters the pool on/after this
  retired       true            // rotation flag, set by the app; never deleted
  image_gen     { prompt, generator, generated_at? }  // REQUIRED iff image_url
                                // is non-empty: the filled prompt_template
                                // (cites both seeds + the slot), the image
                                // MCP/model used, and when (§4.4)
}
```

`owner_id: null` is a load-bearing choice: scouts appear in everyone's Arena,
in no one's Locker, and cannot earn or distort career points — the whole
progression layer is untouched by construction.

### 1.2 Drop (`scout-data.js`)

Committed ES module, the same pattern as `sample-data.js` (no fetch, no CORS,
works offline, no build step):

```js
export const SCOUT_DROPS = [
  {
    drop_id: 'drop-001',
    generated_at: ISO string,
    stats: { generated: number, shipped: number },   // the cull ratio, honest
    pitches: Pitch[],       // origin:'scout', owner_id:null, image_url:''
    sparks: [ { id: string, sources: string[], hook: string } ],
  },
  // newest drop appended last; drops are append-only, never edited
];
```

### 1.3 Storage

No new localStorage keys. Activated scout pitches are appended into
`sca.pitches.v1` at boot and are ordinary pitch records from then on
(retirement mutates the stored record's `retired` flag). Clearing storage
re-seeds samples AND re-merges active scouts on next boot.

---

## 2. New module: `scout.js`

Pure, DOM-free, **zero imports** (the sampler is passed in as a parameter, the
same injection style `arena.js` already uses). Never imports `ranking.js` or
`progression.js` — enforced by the extended access-split guard test.

```js
/** True when a pitch is a scout record. Null-safe. */
isScout(pitch) -> boolean

/**
 * Append drop pitches that (a) are not already present by id and
 * (b) have active_from <= nowIso (missing active_from = active immediately).
 * Pure: returns a NEW array when anything is added; never mutates inputs;
 * drop pitches are deep-copied on the way in (JSON round-trip, the
 * seedCopy discipline from store.js).
 * Malformed drops/pitches are skipped, never thrown on.
 */
mergeDrops(pitches, drops, nowIso) -> { pitches, added }

/**
 * Rolling freshness window: among non-retired scouts, the newest `windowK`
 * by created_at (id tie-break) stay active; older ones get retired: true.
 * One-way (never un-retires). Humans/samples untouched. Pure; returns
 * { pitches, changed } with a new array only when something changed.
 */
applyRetirement(pitches, windowK) -> { pitches, changed }

/**
 * Cap the scout share of an arena pool. Given the already
 * retired-filtered + owner-filtered pool:
 *   - humans (non-scouts) < 2  -> return pool unchanged (survival mode:
 *     scouts keep the Arena alive when there is nothing else to pair)
 *   - else allowedScouts = max(1, floor(humans * share / (1 - share)));
 *     keep the NEWEST allowed scouts (created_at desc, id tie-break).
 * share is clamped to [0, 0.9]; pure, order-preserving for survivors.
 * Edge semantics are deliberate (rev 3, finding R3): share <= 0 removes
 * EVERY scout (the off switch), while any positive share keeps at least
 * one (minimum exposure — a tiny share meters the pipeline, it does not
 * silently disable it, even where the floor overshoots the exact ratio).
 */
composeArenaPool(pitches, share) -> pitches

/**
 * sampler.pickPair wrapper enforcing <= 1 scout per served pair.
 * Works on a COPY of seenPairs, adding scout-vs-scout pairKeys to the copy
 * until a mixed (or human-human) pair emerges. Exception: when the pool
 * holds zero humans, scout pairs are allowed (survival mode).
 * Terminates: each rejection permanently excludes one pair from the finite
 * pair set. Status passthrough: 'insufficient'/'exhausted' return AS-IS —
 * on 'exhausted', arena.js clears the session history and retries once, at
 * which point previously-seen mixed pairs are servable again. Whenever a
 * human and at least one other pitch coexist, a mixed pair exists, so the
 * retry always finds one; with zero humans the quota permits scout pairs.
 * Voting therefore never dead-ends behind the quota (rev 3, finding R1).
 */
pickPairWithQuota(sampler, pitches, votes, seenPairs) -> { status, pair }

/**
 * Fill game-config SCOUT_IMAGES.prompt_template for one pitch (rev 5, §4.4):
 * {seed_a}/{seed_b} from inspiration.sources, {slot} from item_slot, plus
 * {title}/{tags}/{description} and any string vars in `context` (e.g.
 * game_name, visual_direction — injected because this module imports
 * nothing). Returns '' ("make no image") on an empty template or a pitch
 * without two seeds; unknown {placeholders} stay verbatim so template typos
 * surface instead of vanishing. Pure.
 */
buildImagePrompt(pitch, template, context) -> string
```

## 3. Integration points (modified files)

### 3.1 `app.js`

- New constants (single source of truth, like `COMPARISON_THRESHOLD`):
  `SCOUT_POOL_SHARE = 0.4`, `SCOUT_WINDOW_K = 4`. The window equals the
  share cap's real capacity against the seeded 6-pitch human pool
  (`floor(6 * 0.4 / 0.6) = 4`), so an "active" scout is never share-capped
  into a limbo where it can neither battle nor retire (rev 3, finding R5).
- Boot, immediately after the store seed check, wrapped in its own
  try/catch (a scout fault must never break boot):
  1. `mergeDrops(store.loadPitches(), SCOUT_DROPS, new Date().toISOString())`
     → `savePitches` if `added > 0`.
  2. `applyRetirement(pitches, SCOUT_WINDOW_K)` → `savePitches` if `changed`.
- `initArena` deps gain `scout` (the module) and `scoutShare` (the constant).
  The access split is preserved: scout.js carries no rank/score surface.

### 3.2 `arena.js`

In `render()` only:

```
pool = store.loadPitches()
     -> filter out retired            (scout rotation)
     -> filter out own pitches        (existing self-vote exclusion, unchanged)
     -> scout.composeArenaPool(pool, scoutShare)
result = scout.pickPairWithQuota(sampler, pool, votes, seenPairs)
```

Fallback: if the injected `scout` dep is absent (old tests, defensive), use
`sampler.pickPair` directly on the retired-filtered pool. Cards render
unchanged — **blind stays blind**: no scout chip, no provenance in the Arena.
Vote recording, session strip, celebrations: untouched.

### 3.3 `studio.js`

The one view where scouts are fully attributed:

- Build `Map(id -> pitch)` from `store.loadPitches()` alongside the existing
  `ranking.rank` call.
- Leaderboard rows for scouts get a `Scout` chip after the title (plus a
  muted `retired` chip when retired) and a one-line provenance note under
  the title: `Scouted from: <sources joined ' × '>` with the rationale note
  as the row's `title` attribute.
- **"Hide scouted concepts" toggle** (checkbox above the table, default
  unchecked): re-renders the board without `origin === 'scout'` rows, so
  leads can read pure human taste on demand.
- **Scout report panel** below the leaderboard (revealed with the board,
  behind the same gate): one block per drop, newest first — drop id,
  generated date, cull ratio ("shipped 4 of 32 generated"), then each scout
  with status (`active` / `retired` / `arrives <date>` for not-yet-merged),
  comparisons, and win-rate pulled from the rank rows.
- **Export feedback** button: downloads `arena-feedback.json`
  (Blob + object URL, fail-safe): `{ exported_at, scouts: [{ id, title,
  comparisons, wins, win_rate, retired }], top_human: [{ title, description,
  theme_tags, item_slot, win_rate, comparisons }] }` (top 5 humans at/above
  the comparison threshold). A lead commits this to `feedback/` in the repo;
  the next generation run conditions on it.
- `studio.js` imports `scout-data.js` (data only) — it still never imports
  progression, and remains the only caller of `ranking.rank`.

### 3.3b `locker.js` (one line, load-bearing — rev 3, finding R2)

The Locker's "Prioritized for upcoming battles" marker promises the
pool-minimum comparison count the sampler acts on
(`progression.calibrationPriority`). Retired scouts are out of Arena rotation
and frozen at their final comparison count (often 0), so they must be
filtered out of the pool handed to `renderPitches` — otherwise one retired,
unvoted scout pins the pool minimum at 0 forever and the marker never shows
on any calibrating human pitch again. With `SCOUT_WINDOW_K` aligned to the
share cap (§3.1), *active* scouts are genuinely servable and legitimately
compete for the minimum, so they stay in the calibration pool.

### 3.4 `wizard.js`

The "Need a spark?" panel — attacks the human-ideation bottleneck directly:

- Renders between the view header and the form when at least one spark
  exists in `SCOUT_DROPS` (flattened); hidden otherwise. Not part of the
  submit gate; purely additive.
- Shows one spark: the seed pair ("Venetian glassblowing × storm-chaser
  vans") and its one-line hook, plus an **"Another spark"** button that
  cycles (random start index, then sequential — no repeat until wraparound).
- The cosmetic vocabulary (`ITEM_SLOTS` / `THEME_TAGS`) lives in
  `game-config.js` (rev 4) — the wizard, the validator, the coverage badges,
  and the routine all read the same lists from there.
- Still imports neither ranking nor progression (guard re-asserts).

### 3.5 `index.html`

One transparency line appended to the Arena methodology tooltip's foot:
match-ups may include AI-scouted concepts — blind here like every other
pitch, labeled with full provenance in the Studio.

### 3.6 `styles.css`

New classes on existing tokens (no new colors, radii, or motion): `.spark-box`
(surface-2 card, accent eyebrow), `.scout-chip` / `.retired-chip` (chip
pattern, text + border, never color alone), `.scout-src` (muted provenance
line), `.studio-toggle`, `.scout-report` (+ rows), `.export-btn`.

---

## 4. Drop authoring (the recurring routine's contract)

The generation recipe lives with the generator, not the app. A drop is valid
iff `node scripts/validate-drops.mjs` passes.

### 4.0 Determinism doctrine (rev 6)

The pipeline is engineered around a three-layer split; every rule below
belongs to exactly one layer, and the layers are never blurred:

| Layer | Owner | Determinism |
|---|---|---|
| **Structure** — drop ids/numbering, dates and stagger, seed *eligibility*, all validation, arena metering | code | Fully deterministic: `scripts/next-drop.mjs` computes it, `scripts/validate-drops.mjs` re-derives it, and the gate's verdict depends only on committed repo state (never wall clock, never model output) |
| **Creativity** — which eligible seeds to pair, the pitch copy, the cull, image prompts (templatized) | model | Stochastic **by design**: the variance is the product. Reliability comes from bounding (eligibility, lexicon, dedupe, house-voice caps) and auditing (sources, stats, provenance all recorded), not from reproducibility |
| **Taste** — the PR review, the feedback exports | human | Never automated |

Two corollaries the rest of this section follows: (1) any rule that can be
stated objectively moves to the structure layer and gets a validator check
— it must be *impossible or mechanical*, never "the prompt says so"; (2)
no rule may determinize the creativity layer — a seeded random pair menu,
an LLM judge in CI, or auto-merge would each trade product quality or gate
purity for a determinism nobody benefits from. Rules tightened after a
drop shipped apply only to later drops (`PLAN_RULES_SINCE` grandfathering):
drops are append-only, so retroactive rules would redden the gate on
history nobody may edit.

### 4.1 Seed atlas — `scripts/seed-atlas.json`

Curated, concrete, real-world references (other industries, crafts, nature,
history, sport, design culture — no borrowed game IP), each entry:

```json
{ "seed": "Edo hikeshi firefighter coats", "domain": "craft/history",
  "affinity": { "slots": ["Character Skin", "Back Bling / Cape"],
                 "tags": ["Gritty", "Badass"] } }
```

Starts at ~60 entries; the routine may append entries (append-only) as it
retires overused ones from rotation. Appended entries carry
`"added_in": "drop-NNN"` — the drop whose run added them. A run may never
cite its own additions (§4.0's no-self-dealing rule, mechanical via the
eligibility check): a new seed becomes citable from the NEXT drop.

### 4.2 Generation rules (enforced by validator where mechanical)

1. Every concept fuses **two atlas seeds**; `inspiration.sources` names them.
   Rev 6: the seeds must be **eligible** — not cited by pitches in the two
   most recent drops, not appended by this same run — and no seed carries
   two pitches within one drop. Eligibility is deterministic
   (`scripts/seed-plan.mjs`): `node scripts/next-drop.mjs` prints the exact
   set and the validator re-derives it. *Which* eligible seeds to pair is
   the model's creative call (§4.0).
2. Slot/tag vocabulary = the wizard's `ITEM_SLOTS` / `THEME_TAGS`, exactly.
3. A drop **spans** slots and tags: no two pitches in a drop share the same
   item_slot; >= 4 distinct theme tags across the drop.
4. House voice (wizard parity + the sample-pitch style): title <= 80 chars,
   description 80–600 chars, at most 3 sentences, names at least one
   concrete material or real-world referent, ends grounded (the "guardian,
   not villain" restraint move is the model, not a requirement).
5. **Banned lexicon** (case-insensitive substring, mechanical): ethereal,
   celestial, nexus, arcane, glowing runes, cosmic, mystical, otherworldly,
   pulsating, pulses with, imbued, infused, unleash, a testament to,
   tapestry, symphony of, whispers of, essence of, radiant aura, shimmering
   aura, crackling with energy, forged from pure, swirling vortex, ephemeral.
6. **Dedupe**: normalized-token Jaccard similarity < 0.4 against every other
   pitch (samples + demo pitches + all drops — demo pitches battle in the
   same Arena whenever the demo profile is active; rev 3, finding R6);
   unique titles (case-insensitive).
7. `image_url: ''` by default (deterministic placeholder art). When — and
   only when — `game-config.js` `SCOUT_IMAGES.enabled` is true, a pitch MAY
   instead ship AI concept art per §4.4: a committed file under
   `SCOUT_IMAGES.asset_dir` named after the pitch id, with `image_gen`
   provenance. External http(s) URLs are never valid (zero-external-assets
   lock); rev 6 removed the data-URI variant (one representation).
8. **Stagger**: at most 2 pitches per `active_from` date within a drop.
9. Ship 3–5 pitches per drop from >= 4x candidates (mechanical from rev 6;
   pre-rev-6 drops were validated at a 2x floor and stay grandfathered);
   record the honest cull ratio in `stats`. 3–5 sparks per drop, same
   seed-fusion + lexicon rules.
10. Drops are append-only; a merged drop is never edited (device stores have
    already copied it).
11. Rev 6: all structural values — drop id (consecutive numbering is
    validated), active_from schedule, timestamps — come from
    `node scripts/next-drop.mjs`, never invented by the model. Titles are
    deduped by Jaccard similarity (> 0.3 fails), not just exact match.

### 4.3 `scripts/validate-drops.mjs`

Node script, zero dependencies, importable functions + CLI entry:

- Schema/field checks per §1.1–1.2 (incl. `scout-` id prefix, id uniqueness
  across all drops, `drop-NNN` drop_id format + uniqueness, owner_id null,
  origin 'scout', empty image_url).
- Vocabulary checks against game-config.js's ITEM_SLOTS / THEME_TAGS; length
  caps from game-config.js PITCH_LIMITS (wizard parity by construction).
- Sentence cap, banned lexicon (base + the game's banned_lexicon_extra),
  per-drop slot/tag spread and ship counts (both derived from vocabulary
  size), stagger rule incl. `active_from >= generated_at`, spark count
  bounds, Jaccard dedupe vs samples + demo pitches + all drops.
- **Seed-atlas gate**: scripts/seed-atlas.json must parse, hold 40+ unique
  seeds with config-vocabulary affinities (plus well-formed `added_in`
  stamps where present), and every `inspiration.sources` / spark source
  must cite a real atlas seed by exact name — the "fuses two atlas seeds"
  invariant, mechanical.
- **Seed eligibility (rev 6, `PLAN_RULES_SINCE`-gated)**: recomputes the
  deterministic eligible set per drop (scripts/seed-plan.mjs) and rejects
  recency violations, self-citations of same-run atlas additions, and any
  seed carrying two pitches in one drop. Consecutive drop numbering; 4x
  overgeneration floor; title near-duplicate check. Feedback exports in
  `feedback/*.json` are schema-checked by validate-data.mjs.
- Exit 0 silent-ish on pass; exit 1 with a per-violation report on fail.
- Runs inside `scripts/gate.mjs` (config → data → drops → tests), the one
  canonical gate CLAUDE.md, the adaptation guide, the routine, and CI all
  invoke. `scripts/validate-data.mjs` (same pattern) covers the bundled
  sample/demo data: vote wiring, id collisions, vocabulary (fatal), and the
  demo ledger recomputed via progression.earnedBadges/pitchStatus.

---

### 4.4 Optional concept images (image-generator MCP) — rev 5

Off by default; the whole feature keys off one flag. The original "no AI
thumbnails" rule (`docs/ai-scout-pipeline-plan.md`, kill #11) was about
unmetered, unlabeled, externally-hosted AI art; this reintroduction keeps
each of those adjectives banned. **Operational runbook (step-by-step, for
the agent actually doing it): `docs/image-generator-mcp-integration.md`.**

- **Config (`game-config.js SCOUT_IMAGES`, GAME-ADAPT):** `enabled`
  (boolean, default false), `generator` (the MCP to look for, e.g.
  `'nanobanana'`), `asset_dir` (repo-relative, default
  `'assets/scout-art/'`), and `prompt_template` — the templatized image
  prompt. `{seed_a}`, `{seed_b}`, and `{slot}` are REQUIRED placeholders
  (validate-config enforces): the two inspiration seeds and the cosmetic
  category are what make each prompt dynamic. `{title}`, `{tags}`,
  `{description}`, `{game_name}`, `{visual_direction}` also available.
- **Prompt builder (`scout.buildImagePrompt(pitch, template, context)`):**
  pure, zero-import (template + game context injected as parameters, the
  same injection style as the sampler). Returns `''` — "make no image" —
  when the template is empty or the pitch lacks its two seeds; unknown
  placeholders stay verbatim so template typos are visible.
- **Generation (routine STEP 4b, `docs/scout-routine.md`):** only when
  `enabled` AND an image-generation MCP is attached to the routine's
  session. One image per shipped pitch at most; the routine fills the
  template, calls the MCP, commits the file as
  `<asset_dir><pitch-id>.<png|jpg|jpeg|webp|svg>`, sets `image_url`, and
  records `image_gen: { prompt, generator, generated_at }`. Any failure
  (MCP absent, generation error, off-direction result) degrades to
  `image_url: ''` — images never block a drop.
- **Validator:** with `enabled` false, non-empty scout `image_url` is a
  violation (the pre-rev-5 rule, unchanged). With it true: no external
  http(s) URLs ever; file paths must match the pitch-id naming; `image_gen`
  required, its `prompt` must cite both `inspiration.sources` and the
  `item_slot` (the template made mechanical) and passes the banned-lexicon
  scan; the CLI additionally checks referenced files exist on disk
  (`validateImageAssets`).
- **App:** zero code changes — `art.js makeArtZone` already renders any
  non-empty `image_url` with placeholder fallback on load error, and the
  Arena stays blind (an image renders the same whether a human linked it or
  an MCP generated it). The Studio's provenance surface (`Scout` chip +
  sources) already attributes the concept; `image_gen` rides along in the
  record for anyone exporting feedback.
- **Anti-slop posture:** the human PR gate now reviews images too — an
  off-direction image is grounds to strip the image (ship `''`), not to
  block the concept.

---

## 5. Tests

New file `tests/scout.test.js` (pure modules only, so no fake env needed;
README test command becomes
`node --test tests/logic.test.js tests/scout.test.js`):

1. `mergeDrops`: appends only activated pitches; idempotent (second merge
   adds 0); preserves existing/user pitches; input arrays not mutated;
   malformed drop entries skipped.
2. `applyRetirement`: newest K stay active; older scouts flagged; one-way;
   humans untouched; `changed` accurate (false on no-op).
3. `composeArenaPool`: cap math at share 0.4; survival mode below 2 humans;
   newest scouts survive; clamping.
4. `pickPairWithQuota`: never serves scout-vs-scout when a human exists in
   the pool; allows it with zero humans; passes through insufficient /
   exhausted; does not mutate the caller's seenPairs.
5. Drop 001 data: every pitch passes the full validator (imported functions);
   sparks well-formed.
6. Validator negatives: banned lexicon caught, near-duplicate caught, slot
   collision caught, bad vocabulary caught.
7. Access split: `scout.js` and `scout-data.js` import neither ranking nor
   progression (source scan, same technique as the existing guard).

`tests/logic.test.js` amendments (small): add `scout.js`, `scout-data.js` to
the ranking.rank caller-scan list; add `scout.js` to the never-import-ranking
assertion set.

## 6. Rollout

Single PR to `main` (Pages deploys on merge): spec + `scout.js` +
`scout-data.js` (hand-audited Drop 001) + integrations + validator + atlas +
tests + README + routine doc (`docs/scout-routine.md`). Subsequent drops
arrive as PRs from the recurring Claude routine; a human merge is the
editorial gate.

## 7. Out of scope (deliberate)

- No external assets of any kind. (AI thumbnails, banned outright through
  rev 4, are now the opt-in §4.4 path — committed same-origin files with
  provenance, still never external, still off by default.)
- No automatic cross-device vote aggregation (votes are device-local by
  architecture); the feedback loop runs through the Studio export.
- No auto-merge of drop PRs; the human editorial gate is an anti-slop
  guardrail, not a missing feature.
- No sampler.js changes — it stays pure and untouched; quota logic wraps it.

---

## Review log (rev 2 → rev 3)

Findings from the independent pre-implementation review (the spec was checked
against the real codebase, file-and-line), all applied above:

- **R1 (major).** Rev 2's `pickPairWithQuota` NOTE described an impossible
  state ("only unseen pairs are scout-vs-scout while a human exists") and
  prescribed the wrong outcome — implementing it literally would have painted
  the empty-pool message over a healthy Arena. Corrected in §2: statuses pass
  through unchanged; the arena's clear-and-retry always finds a mixed pair.
- **R2 (major).** "The progression layer is untouched by construction" was
  false for the Locker's calibration-priority marker: merged scouts at 0
  comparisons strip it from calibrating human pitches, and a scout retired at
  0 comparisons pins the pool minimum at 0 permanently. Fixed via §3.3b (the
  Locker filters retired pitches from its calibration pool) plus R5.
- **R3 (minor).** `composeArenaPool`'s `max(1, …)` floor contradicted the
  share-0 clamp. Resolved in §2: share <= 0 is the off switch; any positive
  share keeps at least one scout (deliberate minimum exposure).
- **R4 (minor).** Rev 2 credited "scouts sort after existing pitches" for
  no-starvation of human newcomers — inverted: the sampler tie-break is
  created_at ASCENDING, so 0-comparison scouts sort *before* a newer human at
  the same count. The real protection is the one-scout-per-pair quota, which
  forces every scout's pair partner to be the least-compared human.
- **R5 (minor).** `SCOUT_WINDOW_K = 8` exceeded the share cap's capacity (4)
  against the seeded pool, leaving scouts "active" but unservable and
  reported at 0 comparisons forever. Window lowered to 4 (§3.1).
- **R6 (minor).** The dedupe corpus omitted `DEMO_PITCHES`, which battle in
  the same Arena under the demo profile. Added (§4.2.6, validator CLI).

## Review log (rev 1 → rev 2)

Findings from the pre-implementation self-review, all applied above:

1. **Exhausted-retry loop risk (arena).** rev 1 let `pickPairWithQuota`
   interact badly with arena.js's clear-and-retry on 'exhausted': a pool
   whose only unseen pairs were scout-vs-scout could re-clear forever.
   Fixed: the quota works on a copy of seenPairs and the arena's existing
   single-retry-then-insufficient path is kept; documented in §2.
2. **Survival mode.** rev 1's flat 40% cap emptied the Arena when humans < 2
   (fresh device with cleared samples). Fixed: below 2 humans the cap and
   the pair quota both stand down (§2).
3. **`created_at` vs `active_from` sampler interaction.** Drop pitches enter
   with 0 comparisons and would monopolize fewest-compared-first pairing if
   they all landed at once; the stagger rule (§4.2.8) plus the
   one-scout-per-pair quota bound the blast radius. (Rev 3, R4 corrected the
   original rationale here: it is the quota, not timestamp ordering, that
   protects human newcomers — every scout's pair partner is the
   least-compared non-scout available.)
4. **Storage-clear semantics.** Clearing device storage re-merges all
   currently-active scouts on next boot (drops are in the bundle). This is
   correct and documented (§1.3) — scouts are pool content, not user data.
5. **Import-graph hygiene.** rev 1 had scout.js importing sampler.js;
   changed to parameter injection so scout.js has zero imports and the
   access-split guard extension is trivial (§2, §5.7).
6. **Studio provenance placement.** rev 1 put full provenance in the
   leaderboard rows (noisy); moved the rationale to a title attribute + the
   Scout Report panel (§3.3).
7. **Validator ownership of style rules.** Everything mechanical moved into
   the validator (§4.3) so the routine cannot "forget" a rule; only voice
   quality remains judgment, and that is what the human PR gate reviews.
