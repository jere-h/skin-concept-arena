# Skin Concept Arena: guided pitch creation + blind MaxDiff voting for game studios

Built by the Idea-Engine incubate pipeline as a static, GitHub Pages-ready web app.
Vanilla ES modules, no build step, no backend: everything persists in localStorage
(with an in-memory fallback when storage is unavailable).

Four views: **Submit** (the guided pitch wizard), **Arena** (blind head-to-head
voting), **Locker** (your private progression hub), and **Studio** (the
passphrase-gated exact-numbers leaderboard).

## Reusing this repo for another game

All game context (identity, cosmetic slots, tonality tags, tuning, AI-ideation
direction) is parameterized behind **`game-config.js`**, and every
game-specific site carries a greppable `GAME-ADAPT` marker. The ordered,
mechanically-verified adaptation checklist — written for LLM agents doing the
setup — is **`docs/adapt-to-a-new-game.md`** (Claude Code agents get pointed
there automatically via `CLAUDE.md`). Validate config edits with
`node scripts/validate-config.mjs`.

## The Scout pipeline (AI-developed concepts)

A steady, metered inflow of AI-developed skin concepts ("scouts") keeps the
Arena and the Studio review queue fresh between human submissions. Drops are
committed data (`scout-data.js`), authored by a recurring Claude routine
(`docs/scout-routine.md`) and merged as PRs — a human merge is the editorial
gate. At boot, newly activated drop concepts drip into the pool (idempotent
by id, staggered by `active_from`) and a rolling window retires all but the
newest `SCOUT_WINDOW_K` scouts from rotation (flagged, never deleted).

Metering and attribution (`scout.js`, pure and import-free):

- Scouts are capped to `SCOUT_POOL_SHARE` of any served Arena pool, and a
  served pair never holds two scouts while a human pitch exists; both rules
  stand down when scouts are all that remains (survival mode).
- Scouts carry `owner_id: null` — everyone's Arena, no one's Locker, zero
  effect on career points, badges, or ranks.
- The Arena stays blind (disclosed in the methodology tooltip); the Studio
  labels every scout row, offers a "hide scouted" toggle, and renders a Scout
  report per drop: the two real-world seeds each concept was developed from,
  the rationale, the honest cull ratio, and performance so far. An "Export
  feedback JSON" button produces the file a lead commits to `feedback/` to
  steer the next drop.
- The Submit view gains a "Need a spark?" panel — seed pairs + one-line hooks
  from the drops, inspiration jolts a human completes, never pre-written
  pitches.

Anti-slop is mechanical where possible: `node scripts/validate-drops.mjs`
enforces the drop contract (game-config.js vocabulary, length caps, a banned-cliché
lexicon, per-drop slot/tag spread, activation stagger, Jaccard dedupe against
samples + demo pitches + all prior drops). See
`docs/scout-pipeline-tech-spec.md` and the brainstorm it came from,
`docs/ai-scout-pipeline-plan.md`.

## The progression layer (the Locker)

The competitive add-on (see `../gamification-prd.md` / `../gamification-trd.md`)
gives submitters and voters a game to climb without breaking the product's
defining constraint: detailed results stay studio-only.

### Banded visibility, not blindness

v1 showed participants nothing. The add-on relaxes that to *coarse, private,
own-work-only* feedback:

- A submitter sees only their **own** pitch's tier medal (Bronze / Silver /
  Gold / Diamond), derived from banded win-rate (Diamond >= 75%, Gold >= 60%,
  Silver >= 40%, Bronze below). Never a number, never a position, never anyone
  else's tier.
- Tiers appear only after a pitch clears 5 comparisons; below that the Locker
  shows calibration progress ("3/5 battles fought") plus a "Prioritized for
  upcoming battles" marker while the pitch sits at the pool's minimum
  comparison count (the sampler serves fewest-compared pitches first, so the
  promise is kept).
- No numeric win-rate, win count, or comparative rank is rendered anywhere
  outside the Studio view. Structurally: `progression.js` (participant-facing)
  never returns a win-rate from its public API, and `ranking.js` (Studio-only)
  is never imported by a participant view. Tests assert both.

### The monotonic career ladder

Career points derive only from additive inputs, so points and rank can never
go down, by construction:

- **Peak tiers**, not live tiers: each pitch's best-ever tier is recorded
  permanently (Bronze 10 / Silver 20 / Gold 40 / Diamond 70 points). A pitch
  whose live tier drops keeps its peak points, and the Locker shows both
  ("Silver, Peak: Gold").
- **Badges**: 10 points per unlock, and unlocks are never revoked. Thirteen
  badges in four families: submission counts, coverage (all item slots, 6+
  distinct theme tags), performance (first medal, first Silver/Gold/Diamond
  peak), and voting (1 / 25 / 100 votes, 3 distinct voting days).
- **Votes cast**: +1 point each, capped at 100 (aligned with the Century
  badge), so voting pays immediately but grinding tops out mid-ladder.

Ladder: Recruit > Apprentice (10) > Artisan (40) > Virtuoso (90) > Master (160)
> Legend (250). Rank names deliberately never reuse the medal metals.

Celebrations (badge unlocks, peak tier-ups, rank-ups) each fire exactly one
toast, queued one at a time.

### Self-vote exclusion

Your own pitches are filtered out of your Arena pairs before sampling, so you
can neither judge nor inflate your own work. Sample pitches belong to no one
and appear for everyone.

## Storage keys

All device-local, all read/written through the same defensive layer (malformed
JSON discarded, in-memory mirror when localStorage is unavailable):

| Key | Contents |
| --- | --- |
| `sca.pitches.v1` | Pitch records; add-on pitches carry `owner_id` (absent/null on sample and pre-add-on pitches) |
| `sca.votes.v1` | Vote records; add-on votes carry `voter_id` (same tolerance) |
| `sca.profile.v1` | Device-local identity: `{ id, created_at }`. No accounts; clearing storage mints a new profile |
| `sca.progress.v1` | The additive ledger: badge-unlock timestamps, peak tier per pitch (ratchet-only), last-seen rank (toast dedup) |

Current tiers, career points, rank, and badge eligibility are always recomputed
from pitches + votes; only the never-revoked facts above are stored.

## Design

Dark "Emberhold Arena" theme per `../gamification-design-spec.md`: deep neutral
surfaces, one ember accent (`#f25c2a`) for everything interactive, and metallic
tier colors worn only by medal chips and placeholder art (each tier pairs its
color with a distinct glyph and a text label, never color alone). One radius
scale, one dark theme, motion within 150-220ms as transform/opacity only,
`prefers-reduced-motion` collapses motion to opacity. Single 720px breakpoint,
portrait-first. Zero external assets: system fonts and inline SVG throughout,
including the deterministic per-pitch placeholder art (hue hashed from the
pitch id, item-slot glyph).

## What done means

v1 criteria (all still hold):

- The pitch wizard's Submit button is disabled until title, description, and at least one theme tag are all filled (the live checklist and button label say what is missing); filling all three enables it, and clicking it shows a confirmation with no ranking or score displayed to the submitter.
- Submitting a pitch then reloading the page preserves it: the new pitch is still present in the pool (visible via the Arena, the Locker, or the dashboard).
- In the Arena view, tapping one of the two pitch cards records a choice and immediately replaces both cards with a new pair; the same pair is not shown twice in one voting session.
- When fewer than two other creators' pitches are available, the Arena view shows an explicit message instead of a blank area or two empty cards.
- Entering the correct studio passphrase reveals a leaderboard listing pitches ranked by win-rate, each row showing its comparison count and a 'needs more votes' flag when comparisons are below the threshold; an incorrect passphrase shows an inline error and keeps the dashboard hidden.
- The page loads and all four views render with no console errors.

Progression criteria (the add-on):

- The Locker renders the career rank card, the "My pitches" list, and the badge case, including a loop-teaching empty state for a brand-new profile (never a blank).
- An owned pitch shows calibration progress below the threshold and a tier medal at/above it; when its live tier is below its recorded peak, both are shown.
- Career points and rank never decrease under any sequence of votes; a pitch whose live tier drops keeps its peak-tier points (property-tested).
- Casting a vote pays a career point immediately and updates the Arena's progress-to-next-badge strip.
- The Locker lists only this profile's pitches; other profiles' pitches and tiers are never shown.
- A profile is never served its own pitch in an Arena pair.
- Each badge unlock, peak tier-up, and rank-up toasts exactly once, one toast at a time; unlocks and peaks persist across reload.

## Tests

```
node --test tests/logic.test.js tests/scout.test.js
```

Covers the store round-trip and fail-safe fallbacks, sampler pairing, ranking
order, the rev-2 tier bands and their edges, the monotonicity property, career
math and ladder edges, the peak ratchet, badge predicates, owner filtering and
calibration priority, unlock persistence, the celebration toast-once pass, and
the access-split guard (both a dynamic spy and static import-graph assertions,
extended over the scout modules). `tests/scout.test.js` adds the Scout
pipeline: drop merge idempotency and activation gating, the retirement window,
the share cap and pair quota, the bundled drops passing the full validator,
and the validator's anti-slop rules rejecting seeded violations.

## Hosting

Serve this directory as static files (GitHub Pages or any static host). No
build step required. The studio passphrase is a documented client-side
constant in `game-config.js` (`STUDIO_PASSPHRASE`), a convenience gate, not
security.
