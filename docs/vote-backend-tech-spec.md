# Vote Backend — Technical Specification

**Status:** proposed (not yet implemented)
**Audience:** an LLM agent (or human) implementing a shared backend layer for
this repo. This document is self-contained: every contract, invariant, file
touchpoint, and acceptance criterion needed to build and integrate the backend
is stated explicitly. Where a choice is left open, it is marked
**DECISION-POINT** with a stated default — take the default unless the
operator says otherwise.
**Sibling specs:** `docs/scout-pipeline-tech-spec.md` (drop pipeline),
`CLAUDE.md` (architecture invariants — read it first; this spec must not
break any invariant listed there).

---

## 0. Problem statement

Today every player's pitches and votes live only in that player's browser
(`localStorage` keys `sca.pitches.v1` / `sca.votes.v1`, written through
`store.js`). Two players never see each other's submissions, and the Studio
leaderboard ranks only the local device's data. The app needs a **shared
persistence backend** so that:

1. Votes cast by all users aggregate into one global dataset.
2. Pitches submitted by any user appear in every user's Arena.
3. The Studio leaderboard ranks the global dataset.
4. The design team can analyze votes with real tooling (SQL, dashboards).

The frontend must remain a **static, no-build, vanilla-ES-module site**
(GitHub Pages compatible). The backend is therefore a separate HTTP JSON API
plus a database, deployed independently (the reference deployment in §8 is
Databricks, but §§1–7 are backend-agnostic and MUST be implementable on any
stack: Supabase, Cloudflare Workers + D1, Fly.io + Postgres, etc.).

### 0.1 Non-negotiable invariants (inherited from CLAUDE.md)

The backend integration MUST preserve all of these; tests enforce most:

- **I1 — Fail-safe everywhere.** No store read/write ever throws into a view.
  If the backend is unreachable, misconfigured, slow, or absent, the app
  behaves *exactly* as it does today (local-only). Network is decoration on
  top of localStorage, never a dependency of it.
- **I2 — Access split.** `wizard.js` / `arena.js` never import `ranking.js`
  or `progression.js`. New sync modules must not create a back-channel
  (e.g. a sync module that imports `ranking.js` and is imported by
  `arena.js` is a violation). The static + dynamic guard tests in
  `tests/logic.test.js` must be extended to cover new modules.
- **I3 — Sync store API is frozen.** Views receive `store` by dependency
  injection (`deps.store` with `loadPitches / savePitches / loadVotes /
  saveVotes / addPitch / addVote`, all **synchronous**). Do not make these
  async and do not change view code to `await` them. The backend attaches
  *around* this API (§3), not by rewriting it.
- **I4 — Scouts are owner-less** (`owner_id: null`) and progression is
  device-local and monotonic. The backend stores and serves scout pitches
  like any pitch; it never stores progression (§7.4).
- **I5 — No build step, no bundler, no framework.** New frontend code is
  plain ES modules committed to the repo root, matching existing style.
- **I6 — Static hosting.** The frontend never requires same-origin backend;
  all API calls are cross-origin `fetch` with CORS.

---

## 1. Data contracts

Client-side shapes are already fixed by the repo; the backend adopts them.
IDs are **client-generated** (`ids.js newId()` — `crypto.randomUUID()` with a
timestamp+random fallback), which makes every write **idempotent by id**
(§4.3). Timestamps are ISO-8601 UTC strings.

### 1.1 Pitch (canonical wire shape)

```jsonc
{
  "id": "string, required, unique, client-generated",
  "item_slot": "string, required — one of game-config.js ITEM_SLOTS (server validates against a configured list)",
  "theme_tags": ["string", "… 1–3 entries from game-config.js THEME_TAGS"],
  "title": "string, required, 1–80 chars",
  "description": "string, required, 1–600 chars",
  "image_url": "string — '' or a data: URI; server MUST reject http(s) URLs (design lock: zero external assets) and MAY cap length (default 200_000 chars)",
  "owner_id": "string | null — device-local profile id; null for samples and scouts",
  "created_at": "ISO string, required",

  // Scout-only optional fields (docs/scout-pipeline-tech-spec.md §1.1) —
  // tolerated-absent, passed through verbatim when present:
  "origin": "'scout' (optional)",
  "inspiration": { "sources": ["string"], "note": "string" },
  "active_from": "ISO string (optional)",
  "retired": "boolean (optional; one-way: false→true only, server enforces)"
}
```

### 1.2 Vote (canonical wire shape) — **append-only event, never updated or deleted**

```jsonc
{
  "id": "string, required, unique, client-generated",
  "pitch_a_id": "string, required",
  "pitch_b_id": "string, required",
  "winner_id": "string, required — MUST equal pitch_a_id or pitch_b_id",
  "voter_id": "string | null — device-local profile id; null when the device had no profile",
  "created_at": "ISO string, required (client clock — untrusted; see server_received_at)"
}
```

### 1.3 Server-added fields (server-side only, never required by the client)

On ingest the server stamps each row with:

- `server_received_at` — server clock ISO string. Use THIS, not
  `created_at`, for any server-side time ordering or windowing.
- `client_id` (optional) — opaque request attribution for abuse analysis.

These fields MAY be echoed in GET responses; the client MUST ignore unknown
fields (it already does — records pass through `JSON.parse` untouched).

### 1.4 Validation rules (server MUST enforce on write)

1. Shape/required fields per §1.1–1.2; reject with `400` + machine-readable
   `{ "error": { "code": "...", "field": "...", "message": "..." } }`.
2. `winner_id ∈ {pitch_a_id, pitch_b_id}`; `pitch_a_id !== pitch_b_id`.
3. **Self-vote rejection** (server-side mirror of the client's PRD MVP 6
   filter): if `voter_id` is non-null and equals the `owner_id` of either
   pitch in the pair, reject the vote with code `self_vote`.
4. Vote pitch ids SHOULD reference known pitches; unknown ids are accepted
   but flagged (`orphan: true` server-side) rather than rejected — client
   and server pools can be momentarily out of sync and votes must not be
   lost to a race. **DECISION-POINT** (default: accept-and-flag).
5. Duplicate `id` on POST → treat as idempotent replay: `200` with the
   existing record, never a second row (§4.3).
6. Rate limits (§6.2) checked before insert.

---

## 2. Architecture overview

```
 browser (static site, GitHub Pages)                    backend (any host)
┌──────────────────────────────────────┐           ┌──────────────────────────┐
│ views (wizard/arena/locker/studio)   │           │  HTTP JSON API  (§4)     │
│   │  synchronous deps.store calls    │           │   validation · idempotent │
│   ▼                                  │   fetch   │   upsert · rate limiting  │
│ store.js  (UNCHANGED sync API,       │◄─────────►│           │              │
│   localStorage = cache + WAL)        │   CORS    │           ▼              │
│   ▲ hydrate      │ outbox drain      │           │  database (§5)           │
│ remote.js (NEW: sync engine)         │           │   pitches · votes tables │
│ backend-config.js (NEW: pure data)   │           │   (+ analytics views)    │
└──────────────────────────────────────┘           └──────────────────────────┘
```

**Core pattern: local-first cache + write-ahead outbox.** localStorage stays
the synchronous source of truth the views read. A new `remote.js` module:

- **Hydrates** at boot and periodically: fetches the global pitch pool and
  vote set, merges them into localStorage (union by id, §3.4).
- **Drains an outbox**: every local `addPitch`/`addVote` is also appended to
  a persistent outbox key; `remote.js` POSTs outbox entries to the API in
  the background with retry, removing each entry only after the server
  acknowledges it. A device that is offline for a week uploads its queued
  votes the next time it loads the page.

With `backend-config.js` `API_BASE_URL = null`, `remote.js` does nothing and
the app is byte-for-byte today's behavior. This is invariant I1 made
mechanical.

---

## 3. Frontend changes (file by file)

### 3.1 NEW `backend-config.js` — pure data, zero imports

Follows the `game-config.js` pattern (importable from anywhere, node-safe,
marked `GAME-ADAPT`):

```js
// backend-config.js
// GAME-ADAPT: point API_BASE_URL at your deployed vote backend, or leave
// null to run fully local (localStorage only), exactly as before.
export const API_BASE_URL = null;      // e.g. 'https://<app>.databricksapps.com'
export const API_VERSION = 'v1';
export const SYNC_INTERVAL_MS = 60_000;   // periodic re-hydrate cadence
export const OUTBOX_KEY = 'sca.outbox.v1';
export const SYNC_META_KEY = 'sca.sync.v1'; // { last_pitch_cursor, last_vote_cursor }
export const FETCH_TIMEOUT_MS = 8_000;
export const MAX_OUTBOX_BATCH = 50;
```

### 3.2 NEW `remote.js` — the sync engine

Responsibilities and constraints:

- Imports allowed: `backend-config.js`, `store.js` (its exported
  `readKey`/`writeKey` for outbox + sync-meta persistence). MUST NOT import
  `ranking.js`, `progression.js`, or any view module.
- Every public function is **async, never throws**, and resolves to a status
  object (`{ ok, changed, error? }`) — the caller treats sync as decoration.
- All `fetch` calls carry `AbortController` timeouts (`FETCH_TIMEOUT_MS`)
  and exponential backoff on retry (base 2 s, cap 60 s, jittered).
- Public API:

```js
isEnabled() -> boolean                  // API_BASE_URL is a non-empty string
enqueue(kind, record) -> void           // kind: 'pitch' | 'vote'; appends to outbox (sync, fail-safe)
drainOutbox() -> Promise<{ok, sent}>    // POST queued records, batched, idempotent
hydrate() -> Promise<{ok, changed}>     // GET remote pitches+votes, merge into localStorage (§3.4)
startSync(onChange) -> void             // hydrate + drain now, then on an interval and on
                                        // 'online' events; onChange() fires after any merge
                                        // that changed local data (app.js refreshes views)
```

### 3.3 `store.js` — one additive change

`addPitch` and `addVote` gain an optional, injected post-write hook so the
outbox enqueue rides every write without store.js importing remote.js
(keeps store.js dependency-light and node-testable):

```js
// NEW export; app.js calls setWriteObserver(remote.enqueue) at boot.
export function setWriteObserver(fn)   // fn(kind, record); wrapped in try/catch — observer faults never break the write
```

No other store.js change. `loadPitches`/`loadVotes` stay synchronous reads of
localStorage; hydration writes through the existing `savePitches`/`saveVotes`.

### 3.4 Merge semantics (client-side, inside `remote.hydrate`)

- **Pitches:** union by `id`. For an id present both locally and remotely,
  take the remote record but keep `retired: true` if either side has it
  (retirement is one-way). Local-only pitches (not yet uploaded) are kept.
- **Votes:** pure union by `id` (votes are immutable events; no field-level
  merge ever needed).
- Merged arrays are written back via `savePitches`/`saveVotes` only when
  something actually changed (avoid churning localStorage every interval).
- Cursors: persist the server-returned `next_cursor` per collection in
  `SYNC_META_KEY`; pass it as `?since=` on the next hydrate so payloads stay
  incremental (§4.2).

### 3.5 `app.js` — wiring only

At the end of `initApp()` boot (after seeding + scout merge):

```js
import * as remote from './remote.js';
store.setWriteObserver(remote.enqueue);
remote.startSync(() => { /* refresh views the way demo.js reset already does */ });
```

Plus a small "sync" status affordance is **optional** (a footer dot:
`synced / syncing / offline`). **DECISION-POINT** (default: skip UI; logs
via `console.warn` only, matching the scout-merge failure style).

### 3.6 Views — **zero changes**

`wizard.js`, `arena.js`, `locker.js`, `studio.js` are untouched. They keep
calling the synchronous store; global data appears because hydration wrote it
into the same localStorage keys they already read.

### 3.7 Payload growth guard

Votes grow without bound globally, and localStorage is ~5 MB. A vote row is
~200 bytes; 10k votes ≈ 2 MB — fine for MVP. Phase 3 (§9) moves the client
to the aggregate endpoint (§4.2.5) and stops mirroring the full global vote
log locally; until then the server caps `GET /votes` responses at
`MAX_VOTES_SERVED` (default 20 000, newest first) and the client treats the
truncated set as the working set. **DECISION-POINT** (default: raw mirror
with cap for Phases 1–2, aggregates in Phase 3).

---

## 4. HTTP API contract

Base path: `{API_BASE_URL}/api/{API_VERSION}` (e.g. `https://host/api/v1`).
All bodies are `application/json; charset=utf-8`. All endpoints return the
error envelope of §1.4(1) on failure. CORS: `Access-Control-Allow-Origin`
must include the GitHub Pages origin (or `*` — the API is public-read,
token-gated only for admin routes), plus `Content-Type` in allowed headers
and `GET, POST, OPTIONS` methods.

### 4.1 Health

`GET /health` → `200 { "ok": true, "server_time": "<ISO>" }`

### 4.2 Read endpoints (public, no auth)

1. `GET /pitches?since=<cursor>&limit=<n≤500>` →
   `200 { "pitches": [Pitch…], "next_cursor": "<opaque>", "server_time": "<ISO>" }`
   Ordered by `server_received_at` ascending. Absent `since` = from the
   beginning. `next_cursor` is opaque (implementation may encode
   `server_received_at + id`); the client stores and replays it verbatim.
2. `GET /votes?since=<cursor>&limit=<n≤1000>` → same envelope with
   `"votes": [Vote…]`.
3. `GET /pitches/{id}` → `200 Pitch` | `404`.
4. `POST /votes/query` — **not needed**; do not build speculative endpoints.
5. `GET /aggregates/pitch-stats` (Phase 3) →
   `200 { "stats": [ { "pitch_id", "wins", "comparisons" } ], "computed_at" }`
   — exactly the inputs `ranking.rank` and `sampler.pickPair` derive from raw
   votes today, so a future client mode can rank/sample without the raw log.

### 4.3 Write endpoints (public, rate-limited, idempotent)

1. `POST /pitches` — body `Pitch` or `{ "pitches": [Pitch…] }` (≤ `MAX_OUTBOX_BATCH`).
   Per record: insert if `id` unseen, else no-op. →
   `200 { "results": [ { "id", "status": "created" | "exists" | "rejected", "error"? } ] }`
   A batch is never all-or-nothing; each record succeeds or fails alone.
2. `POST /votes` — same envelope with Vote records; validation per §1.4.

### 4.4 Admin endpoints (token-gated)

Auth: `Authorization: Bearer <ADMIN_TOKEN>` (a server-side secret; the
static frontend NEVER embeds it — admin actions happen via curl/dashboards,
not the app; the Studio passphrase in `studio.js` remains a purely
client-side soft gate and is unrelated to this token).

1. `POST /admin/pitches/{id}/retire` → sets `retired: true` (one-way).
2. `DELETE /admin/votes/{id}` → moderation-only tombstone (row moves to a
   `votes_removed` table, keeping the main table append-only).
3. `GET /admin/export?collection=votes&format=jsonl` → full dump.

### 4.5 Explicitly out of scope (do not build)

WebSockets/SSE realtime push, user accounts/OAuth, server-side rendering of
any view, image upload/storage (image_url stays inline-data-URI or empty),
server-side progression (§7.4), and pagination UIs.

---

## 5. Database schema (logical — map to your engine's types)

Two tables; both keep the full client record in a JSON column so the wire
shape survives round-trips even as columns evolve. Extracted columns exist
for indexing/analytics only.

```sql
CREATE TABLE pitches (
  id                 STRING  PRIMARY KEY,      -- client-generated
  owner_id           STRING,                   -- nullable
  item_slot          STRING  NOT NULL,
  title              STRING  NOT NULL,
  origin             STRING,                   -- 'scout' | NULL
  retired            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMP NOT NULL,       -- client clock, untrusted
  server_received_at TIMESTAMP NOT NULL,       -- server clock, authoritative
  record             STRING  NOT NULL          -- full canonical JSON (§1.1)
);

CREATE TABLE votes (
  id                 STRING  PRIMARY KEY,
  pitch_a_id         STRING  NOT NULL,
  pitch_b_id         STRING  NOT NULL,
  winner_id          STRING  NOT NULL,
  voter_id           STRING,                   -- nullable
  orphan             BOOLEAN NOT NULL DEFAULT FALSE,  -- §1.4(4)
  created_at         TIMESTAMP NOT NULL,
  server_received_at TIMESTAMP NOT NULL,
  record             STRING  NOT NULL          -- full canonical JSON (§1.2)
);
-- votes is APPEND-ONLY: no UPDATE; moderation deletes move rows to
-- votes_removed (same schema + removed_at, removed_reason).

CREATE VIEW pitch_stats AS               -- feeds §4.2(5)
SELECT p.id AS pitch_id,
       COUNT(v.id) FILTER (WHERE v.winner_id = p.id)              AS wins,
       COUNT(v.id)                                                AS comparisons
FROM pitches p
LEFT JOIN votes v ON p.id IN (v.pitch_a_id, v.pitch_b_id)
GROUP BY p.id;
```

Cursor pagination key: `(server_received_at, id)` — add an index on it in
engines that need one.

---

## 6. Identity, trust, and abuse

### 6.1 Identity model (unchanged: anonymous device profiles)

`voter_id`/`owner_id` are self-issued device-local UUIDs (`profile.js`).
There is no authentication; a voter_id proves continuity, not identity. The
backend MUST treat all client fields as untrusted input and MUST NOT expose
any endpoint keyed by voter_id that returns another device's private state
(there is none — progression stays local, §7.4).

### 6.2 Abuse controls (server-side, all Phase 2)

- **Rate limits** per client IP: default 60 votes/min and 10 pitches/hour;
  return `429` with `Retry-After`. The client outbox already retries with
  backoff, so a `429` is absorbed silently.
- **Self-vote rejection** — §1.4(3).
- **Anomaly quarantine (optional):** a vote accepted but from a voter_id
  exceeding N votes/day (default 2 000) gets `flagged: true` server-side;
  flagged votes are excluded from `pitch_stats` and admin export can review
  them. Never delete on suspicion. **DECISION-POINT** (default: build it).
- **Ballot-stuffing note for the design team:** because identity is
  anonymous, global rankings are directional, not tamper-proof. The Studio
  view already frames scores as signals; keep it that way.

### 6.3 Privacy

Stored data is: concept text, anonymous UUIDs, timestamps, and (server logs
only) IP addresses for rate limiting. No emails, no names. Retain raw IPs
≤ 30 days. Publish nothing per-voter; only per-pitch aggregates ever reach
other users' screens.

---

## 7. Semantics decisions (spelled out so nobody re-derives them)

1. **Votes are immutable events.** No editing, no client-side deletion, no
   idempotency window — a replayed id is simply already-exists.
2. **Pitch conflicts:** the same id can only originate from one device
   (UUIDs), so true conflicts don't occur; the merge rule in §3.4 exists for
   the `retired` flag racing between server rotation and local scout
   rotation. `retired` is a one-way OR.
3. **Scout drops keep their PR pipeline.** `scout-data.js` remains the
   source of truth for scout pitches; the app merges drops into localStorage
   at boot exactly as today, and the outbox then uploads them like any local
   pitch (idempotent by their `scout-…` ids, so every client uploading the
   same drop is harmless). The server needs no special scout path.
4. **Progression stays device-local.** Career points, badges, peaks
   (`sca.profile.v1`/`sca.progress.v1`) never leave the device. Global vote
   counts flowing IN via hydration will raise a device's "votes on my
   pitches" derived stats — that is the intended effect (your concept
   really did win those duels) and monotonicity is preserved because peaks
   ratchet client-side as before. **The one guardrail:** `votesCast` (the
   voting-badge counter) must keep counting only votes with
   `voter_id === this profile id`, which it already does by construction.
5. **Sample data:** seeded sample pitches/votes (`sample-*` ids) are demo
   scaffolding. The client MUST NOT enqueue records whose id starts with
   `sample-` to the outbox, and the server SHOULD reject them; otherwise
   every fresh browser re-uploads the same six pitches. (Scout ids ARE
   uploaded — see (3).)
6. **Demo profiles (`demo.js`)** are local fixtures; their writes flow
   through the same store and thus the same outbox. Acceptable for MVP
   (they're indistinguishable from real anonymous users). **DECISION-POINT**
   (default: allow; alternative: skip enqueue when a demo profile is
   active).

---

## 8. Reference deployment: Databricks

Any component here can be swapped; the API contract (§4) is the boundary.

| Concern | Databricks piece | Notes |
|---|---|---|
| API host | **Databricks Apps** (Python FastAPI or Flask app) | Serves `/api/v1/*`; Apps gives HTTPS + a stable `*.databricksapps.com` URL. Configure CORS for the Pages origin. If the workspace requires end-user SSO for Apps, front it with a service principal + an API-token check instead, or host the thin API on any public serverless (Cloud Run/Workers) writing to Databricks via SQL — the contract does not change. |
| OLTP writes | **Lakebase (managed Postgres)** — tables of §5 | Low-latency single-row upserts; the idempotent insert is `INSERT … ON CONFLICT (id) DO NOTHING`. |
| Analytics | Sync/CDC Lakebase → **Unity Catalog Delta tables**; query via **SQL Warehouse**; dashboards in **Databricks SQL / AI-BI** | `pitch_stats` becomes a Delta materialized view; a scheduled **Job** refreshes aggregates for §4.2(5). |
| Secrets | Databricks **secret scopes** | `ADMIN_TOKEN`, DB credentials. Never in the repo, never in the frontend. |
| Alternative (simpler MVP) | Skip Lakebase: FastAPI app writes straight to Delta via `databricks-sql-connector` | Fine at this traffic (tens of writes/min); accept ~seconds of write latency and batch the outbox inserts. |

Deployment artifacts the implementing agent should produce (in a new
`backend/` directory — the frontend's no-build rule applies to the site
root, not to this server-only subtree):

```
backend/
  app.py             # FastAPI: routes of §4, validation of §1.4
  schema.sql         # §5 DDL
  requirements.txt
  app.yaml           # Databricks Apps config
  README.md          # deploy steps: databricks apps deploy, secret setup, CORS origins
  tests/test_api.py  # contract tests: idempotency, validation, self-vote, rate limit
```

---

## 9. Rollout phases (implement in order; each phase ships alone)

**Phase 1 — Backend MVP + read/write sync.**
Deliver: `backend/` (health, GET/POST pitches+votes, idempotency, §1.4
validation 1–2 & 5), `backend-config.js`, `remote.js` (enqueue, drainOutbox,
hydrate, startSync), `store.setWriteObserver`, `app.js` wiring, tests (§10).
Exit criteria: two different browsers against one backend see each other's
pitches within `SYNC_INTERVAL_MS`, and a vote cast offline uploads on next
load. With `API_BASE_URL = null`, `node --test` passes untouched and the app
is behaviorally identical to today.

**Phase 2 — Trust & operations.** Self-vote rejection, rate limits,
sample-id rejection, anomaly quarantine, admin endpoints + token, IP-log
retention, `votes_removed`.

**Phase 3 — Scale path.** `GET /aggregates/pitch-stats` + scheduled refresh;
client `MAX_VOTES_SERVED` handling; optional client mode that ranks from
aggregates. Only build when real vote volume approaches the localStorage
budget (§3.7).

---

## 10. Test plan (extends the existing `node --test` suite)

New file `tests/remote.test.js`, plus additions to `tests/logic.test.js`:

1. **Disabled = inert:** with `API_BASE_URL null`, `remote.isEnabled()` is
   false, `startSync` never calls fetch (inject a throwing fetch spy),
   `enqueue` is a no-op, and every existing test passes unchanged.
2. **Never throws (I1):** hydrate/drainOutbox with a fetch that rejects,
   times out, returns 500, returns malformed JSON → all resolve
   `{ ok: false }`; localStorage keys untouched.
3. **Outbox durability:** enqueue N votes with fetch failing → outbox key
   holds N; fetch recovers → drain empties it exactly once (idempotent ids
   asserted in the request bodies); acknowledged entries never re-send.
4. **Merge semantics (§3.4):** union by id; remote-wins for pitch fields;
   `retired` one-way OR; vote arrays deduplicate by id; no write when
   nothing changed.
5. **Sample-id fence (§7.5):** `sample-*` records never enqueue.
6. **Access split (I2):** extend the static import-scan guard so
   `remote.js` and `backend-config.js` import neither `ranking.js` nor
   `progression.js`, and no view imports `remote.js`.
7. **Write observer:** a throwing observer never breaks `addVote`/`addPitch`.
8. **Backend contract tests** (`backend/tests`): §1.4 validation matrix,
   duplicate-id replay returns `exists`, batch partial failure, self-vote
   rejection, cursor pagination returns every row exactly once across pages.

Verification commands (must all pass before merge):

```
node --test tests/logic.test.js tests/scout.test.js tests/remote.test.js
node scripts/validate-config.mjs
python3 -m http.server   # manual: app boots with API_BASE_URL null, no console errors
```

---

## 11. Implementation checklist for the executing agent

Ordered; commit after each numbered step with the step name in the message.

1. Read `CLAUDE.md`, this spec, `store.js`, `app.js`, `profile.js`.
2. Create `backend-config.js` (§3.1) with `API_BASE_URL = null`.
3. Create `remote.js` (§3.2) with the outbox + hydrate + merge logic.
4. Add `setWriteObserver` to `store.js` (§3.3) and wire `app.js` (§3.5).
5. Write `tests/remote.test.js` (§10.1–10.7); extend the access-split guard.
6. Run the verification commands (§10) — all green with backend disabled.
7. Build `backend/` (§8 artifacts) implementing §4 Phase-1 endpoints against
   §5 schema; write `backend/tests/test_api.py` (§10.8).
8. Deploy per `backend/README.md`; set `API_BASE_URL` in
   `backend-config.js`; verify the Phase-1 exit criteria with two browsers.
9. Phases 2–3 as separately reviewed changes.

Anything ambiguous during implementation: prefer the smallest change that
keeps every invariant in §0.1, and record the choice in this file's Review
log below.

---

## Review log

- rev 1 (2026-07-03): initial spec — local-first cache + outbox architecture,
  backend-agnostic API contract, Databricks reference deployment.
