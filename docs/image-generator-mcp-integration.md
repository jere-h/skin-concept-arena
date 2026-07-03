# Image-generator MCP integration — AI concept images for scout drops

**Audience:** an LLM agent asked to enable, operate, or debug AI-generated
concept images in the Scout pipeline (keywords you may have been given:
image MCP, nanobanana / Nano Banana, Gemini image, concept art, thumbnails,
`SCOUT_IMAGES`). This runbook is the complete ordered procedure; every step
ends in a mechanical verification, so follow it top to bottom and you cannot
silently drift from the contract.

**Contract authority:** `docs/scout-pipeline-tech-spec.md` §4.4. Enforced by
`scripts/validate-config.mjs` + `scripts/validate-drops.mjs`, both inside
`node scripts/gate.mjs` (THE gate — CI runs exactly it).

**Provenance of this runbook:** the full path below was exercised end to end
against this codebase (gate with images enabled, boot merge into
localStorage, same-origin asset fetch, blind Arena render via headless
Chromium) before being written down.

---

## 0. The 30-second model

```
seed atlas ──► drop pitches (text, image_url: '')          ← always happens
                    │
                    ▼
       SCOUT_IMAGES.enabled === true          ← gate 1: config flag (code-reviewed)
       AND image-gen MCP in session           ← gate 2: operator attached it
                    │ (either false → ship text-only; fully valid)
                    ▼
   node scripts/scout-image-prompts.mjs       ← emits {pitch_id, target_file, prompt}
                    │                            prompt = prompt_template filled from the
                    ▼                            pitch's TWO SEEDS + ITEM SLOT (+ mood,
       image MCP, one call per job               description, game art direction)
                    │
                    ▼
   assets/scout-art/<pitch-id>.png            ← committed same-origin file
   pitch.image_url + pitch.image_gen          ← provenance: prompt/generator/timestamp
                    │
                    ▼
       node scripts/gate.mjs                  ← rejects every deviation below
                    │
                    ▼
       PR → human reviews the IMAGES too      ← off-direction image: strip it, keep pitch
```

Load-bearing properties (each is validator- or review-enforced):
**off by default · double-gated · prompt always templatized, never freehand ·
files committed same-origin, never external URLs · provenance travels with
the pitch · any failure degrades to `image_url: ''`, never blocks a drop.**

---

## 1. Preconditions — check before touching anything

| # | Check | How | Proceed when |
|---|-------|-----|--------------|
| 1 | Repo healthy | `node scripts/gate.mjs` | exits 0 |
| 2 | Feature flag | `node scripts/validate-config.mjs` | summary line ends `images on` (if `images off`, step 2 below flips it) |
| 3 | Image MCP present | list your session's MCP tools; `SCOUT_IMAGES.generator` in `game-config.js` names the intended server (default `nanobanana`, i.e. Gemini-family image generation) | ANY MCP tool that accepts a text prompt and returns/saves an image file qualifies — the name is a hint, not an API contract |

**If check 3 fails (no image MCP in the session): STOP HERE.** Do not
simulate images, do not link placeholders, do not fetch stock art. Ship the
drop text-only with `image_url: ''` everywhere — that is a fully valid drop,
and this entire runbook becomes a no-op. (Attaching an MCP is an operator
action: they add an image-generation MCP server to the session/environment
config, e.g. via `claude mcp add` or claude.ai connector settings.)

## 2. Enable the flag (one line, code-reviewed)

In `game-config.js`, set `SCOUT_IMAGES.enabled: true`.
Verify: `node scripts/validate-config.mjs` → exits 0, summary ends `images on`.

Do NOT edit `prompt_template` casually: `{seed_a}`, `{seed_b}`, and `{slot}`
are required placeholders (validate-config fails without them), and shipped
`image_gen.prompt`s are re-checked to cite both seeds and the slot.

## 3. Get the prompts — never freehand them

```
node scripts/scout-image-prompts.mjs                 # jobs for the NEWEST drop
node scripts/scout-image-prompts.mjs drop-002        # one drop
node scripts/scout-image-prompts.mjs scout-002-xyz   # one pitch
```

Output is a single JSON object; each `jobs[]` entry is one image to make:

```json
{ "drop_id": "drop-002",
  "pitch_id": "scout-002-tidewarden",
  "target_file": "assets/scout-art/scout-002-tidewarden.png",
  "prompt": "Concept art for \"...\", a Character Skin cosmetic for ... Fuse two real-world references: <seed A> and <seed B>. ..." }
```

The `prompt` is `SCOUT_IMAGES.prompt_template` filled from the pitch's two
inspiration seeds, its item slot, tags, description, and the game's
visual direction. Use it **verbatim** — a hand-tweaked prompt will fail the
gate if it drops a seed citation or the slot, and defeats the anti-slop
guarantee even when it passes.

## 4. Generate — one MCP call per job

- Call the image MCP once per job with `prompt` exactly as emitted.
- Save the result at **exactly** `target_file`, swapping only the extension
  to match the actual returned format (`png|jpg|jpeg|webp|svg` are valid).
  Any other filename fails the gate (files must be `<asset_dir><pitch-id>.<ext>`).
- Generate images **only for shipped pitches of the drop you are authoring**
  — never for culled candidates, never retroactively for merged drops
  (drops are append-only; device stores already copied them).

## 5. Wire the data — `scout-data.js`

For each generated image, in that pitch's object:

1. **REPLACE the value of the existing `image_url: ''` line.** Do NOT add a
   second `image_url:` key — JavaScript silently keeps the last duplicate
   key, the gate cannot see source-level duplicates, and the file becomes
   misleading to every later reader.
2. Add `image_gen` provenance alongside it:

```js
image_url: 'assets/scout-art/scout-002-tidewarden.png',
image_gen: {
  prompt: '<the EXACT prompt string from step 3, verbatim>',
  generator: 'nanobanana',            // the MCP/model that actually ran
  generated_at: '2026-07-10T09:00:00.000Z',
},
```

## 6. Verify mechanically

`node scripts/gate.mjs` → must exit 0. Violation → fix table:

| Gate message contains | Cause | Fix |
|---|---|---|
| `SCOUT_IMAGES.enabled is false` | flag still off | step 2 |
| `must not be an external URL` | http(s):// image_url | commit the file locally; step 4 |
| `<pitch-id>.<png\|jpg\|jpeg\|webp\|svg>` | filename ≠ pitch id, or wrong dir | rename to `target_file` |
| `provenance required` | `image_gen` missing | step 5.2 |
| `must cite seed` / `must name the item_slot` | prompt was freehanded/edited | rerun step 3, use verbatim |
| `image_gen.prompt banned lexicon` | slop phrase in a hand-edited prompt | use the emitted prompt |
| `not a committed file` | image_url points at nothing on disk | save/`git add` the file at that exact path |
| `stray provenance` | `image_gen` present with `image_url: ''` | delete the `image_gen` block |

## 7. Verify visually (recommended)

`python3 -m http.server` → open the app → Arena. The pitch's card shows the
image once the pitch is active (`active_from` reached). Caveat: a broken
image path **falls back to placeholder art by design** (`art.js`), so a
rendering placeholder does not prove the path is right — that is what the
gate's committed-file check is for. Then eyeball the image itself against
`SCOUT_IDEATION.visual_direction` and `off_limits`: off-direction,
text-bearing, or watermarked output is **stripped, not shipped** — keep the
pitch, revert `image_url` to `''`, remove `image_gen`, delete the file.

## 8. Failure handling — degrade, never block

Any problem at any step (MCP missing, generation error, gate failure you
cannot resolve, uncertainty): revert that pitch to `image_url: ''`, remove
its `image_gen`, delete its file. A drop with zero images is a first-class
drop. Images are decoration on the pipeline, not a dependency of it.

---

## Hard rules (summary — each mapped to its enforcer)

| Rule | Enforced by |
|---|---|
| No images while `enabled: false` | validate-drops |
| Never external URLs | validate-drops + design lock |
| File named after the pitch id, under `asset_dir` | validate-drops |
| Prompt from the template; cites both seeds + slot; lexicon-clean | validate-config (template) + validate-drops (shipped prompt) |
| Referenced file exists on disk | validate-drops CLI (`validateImageAssets`) |
| Merged drops never edited (images included) | append-only rule, human PR gate |
| Images reviewed by a human before merge | PR gate (routine never merges its own PR) |

## Adapting to another game / another generator

- New game: rewrite `SCOUT_IMAGES.prompt_template` in the new art direction
  (keep `{seed_a}`/`{seed_b}`/`{slot}`), per `docs/adapt-to-a-new-game.md`
  Phase 1. Every future drop's images follow automatically.
- Different image MCP: update `SCOUT_IMAGES.generator` (a hint for the
  routine + honest provenance), attach the new server, done — nothing else
  in the pipeline names the generator.

## Module map (for code changes, not routine operation)

| Piece | Where |
|---|---|
| Config block (flag, template, asset dir, generator hint) | `game-config.js` `SCOUT_IMAGES` |
| Template filler (pure, zero-import) | `scout.js` `buildImagePrompt(pitch, template, context)` |
| Job emitter (CLI + pure `imageJobs`) | `scripts/scout-image-prompts.mjs` |
| Image rules | `scripts/validate-drops.mjs` (`imageProblems` inside `validatePitch`, `validateImageAssets`) |
| Config rules | `scripts/validate-config.mjs` |
| Tests | `tests/scout.test.js` (suites 6a: `buildImagePrompt`, image rules, image jobs) |
| Renderer (already image-capable; no changes needed) | `art.js` `makeArtZone` |
