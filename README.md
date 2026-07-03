# Skin Concept Arena

**Find out which cosmetic ideas your players actually want — before your art
team draws a single one.**

Skin Concept Arena is a small web app for game studios and their communities.
Players pitch skin/cosmetic concepts through a guided wizard, everyone votes
on them in blind head-to-head battles, and the design team reads a clean,
vote-backed leaderboard. An optional AI "scout" pipeline keeps fresh,
quality-controlled concepts flowing in between human submissions — optionally
with AI-generated concept art.

It runs anywhere static files run (GitHub Pages works out of the box), needs
**no backend, no build step, and no accounts** — everything lives in the
browser's localStorage.

## Why this exists

Studios drown in cosmetic ideas but starve for *signal*: forum threads and
like counts reward whoever posts loudest, not the concept players would
actually buy. This app replaces that with **blind pairwise voting** — "which
of these two would you rather see in-game?" — which is harder to game, kinder
to quiet submitters, and produces win-rates a design lead can defend in a
roadmap meeting.

The pitch quality problem is attacked at both ends:

- **Humans get a guided wizard** (structured slots, tonality tags, length
  caps, live checklist) plus rotating "Need a spark?" idea starters, so
  submissions arrive concrete instead of vague.
- **AI contributions are metered and honest**: scouted concepts battle blind
  like everyone else's, but are fully labeled for the design team, capped to
  a fraction of the pool, and pass a mechanical anti-slop gate plus a human
  PR review before they ever appear.

## What's inside

**Four views:**

| View | Who it's for | What it does |
|---|---|---|
| **Submit** | players | Guided pitch wizard + inspiration sparks |
| **Arena** | players | Blind head-to-head voting; every pick recorded |
| **Locker** | each player, privately | Career rank, badges, own-pitch medals (Bronze→Diamond) — coarse feedback only, never raw numbers |
| **Studio** | the design team (passphrase) | Exact win-rates, comparison counts, scout provenance and reports, feedback export |

**A progression game that can't sour:** career points and ranks only ever go
up (peak-tier ratchet, additive badges, capped vote points), so contributing
always feels rewarded. Detailed numbers stay studio-only by construction —
participant views literally cannot import the ranking code (tests enforce it).

**Built-in fairness guardrails:** you never vote on your own pitch, the same
pair isn't served twice in a session, under-voted pitches get priority, and
new pitches are flagged "needs more votes" until they've earned a stable
win-rate.

**The AI Scout pipeline:** a recurring Claude routine authors a small weekly
"drop" of AI-developed concepts as a pull request a human must approve. Every
concept must fuse two real-world reference seeds from a curated atlas (Edo
firefighter coats × smokejumper gear, kintsugi × damascus steel…), pass a
banned-cliché lexicon, dedupe checks, and house-voice rules — all enforced by
`node scripts/gate.mjs`, the same gate CI runs. The Studio's feedback export
closes the loop: what won last week steers what gets generated next week.

The pipeline draws a deliberate line about **what is left to chance and what
isn't**, so it's reliable without being repetitive:

- **The machine owns everything structural** — a drop's id, its release
  schedule, and which seeds are even eligible this week (no seed reused from
  recent drops) are all *computed* by `scripts/next-drop.mjs` and re-checked
  by the validator. The AI can't fumble these, and two runs on the same
  repo produce the same setup every time.
- **The AI owns the creative choices** — which eligible seeds to pair and
  the words on the page. This part is intentionally *not* made repeatable:
  the surprise is the point. It's kept honest by the mechanical gate, not by
  forcing the same answer twice.
- **A human owns taste** — the drop only ships if a person merges the PR.

**Optional AI concept images:** attach an image-generator MCP (e.g. Nano
Banana) to the routine and flip one config flag, and drops ship with concept
art too. Prompts are never freehand — a per-pitch template is filled from the
concept's two seeds and its cosmetic slot, images are committed to the repo
(never hotlinked), and full generation provenance ships with each pitch. Off
by default; runbook in `docs/image-generator-mcp-integration.md`.

## Try it

```
python3 -m http.server        # any static server works
```

Open the page, submit a pitch, vote a few battles. The Studio passphrase is a
documented constant in `game-config.js` (`STUDIO_PASSPHRASE` — a convenience
gate for keeping numbers off player screens, not security). Ships with sample
data and a one-click demo profile so every view has something to show.

To verify a checkout end to end:

```
node scripts/gate.mjs         # config → data → drop contract → full test suite
```

## Make it yours

All game context — name, cosmetic categories, tonality tags, tuning, the AI
ideation direction, and the image-prompt template — lives in **one file:
`game-config.js`**. Point an LLM agent (or yourself) at
`docs/adapt-to-a-new-game.md` for the ordered, mechanically-verified
checklist; every game-specific site in the repo carries a greppable
`GAME-ADAPT` marker.

## Docs

| Doc | What it covers |
|---|---|
| `docs/adapt-to-a-new-game.md` | Reskin the whole app for another game (LLM-optimized checklist) |
| `docs/scout-pipeline-tech-spec.md` | The Scout pipeline contract: data shapes, metering rules, validators |
| `docs/scout-routine.md` | The recurring drop-authoring routine + its exact prompt |
| `docs/image-generator-mcp-integration.md` | Enable/operate/debug AI concept images (step-by-step, gate-verified) |
| `docs/ai-scout-pipeline-plan.md` | Design rationale — why the anti-slop guardrails look the way they do |
| `docs/vote-backend-tech-spec.md` | Proposed shared vote backend (spec only; not yet built) |

## Tech notes

Vanilla ES modules, zero dependencies, zero external assets (system fonts,
inline SVG, deterministic per-pitch placeholder art). Votes and profiles are
device-local; the cross-device feedback loop runs through the Studio's JSON
export. Fail-safe by policy: storage reads/writes never throw, and decoration
(toasts, art, tour) can never break the action underneath it. Tests:
`node --test tests/logic.test.js tests/scout.test.js` (also run by the gate
and CI).
