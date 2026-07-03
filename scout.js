// scout.js — Pure, DOM-free logic for the Scout pipeline.
//
// Scouts are AI-developed skin concepts shipped as committed drops
// (scout-data.js) and merged into the ordinary pitch pool at boot. This
// module owns the four mechanisms that keep that inflow steady-but-metered
// (docs/scout-pipeline-tech-spec.md):
//
//   mergeDrops        drip activated drop pitches into the pool, idempotently
//   applyRetirement   rolling freshness window — only the newest K scouts
//                     stay in the Arena; older ones are flagged, never deleted
//   composeArenaPool  cap the scout share of a served pool
//   pickPairWithQuota never serve scout-vs-scout while a human pitch exists
//   buildImagePrompt  fill the game-config SCOUT_IMAGES template for a pitch
//                     (the optional concept-image path — routine STEP 4b)
//
// ZERO imports, by design: the sampler is passed in as a parameter (the same
// injection style arena.js already uses for its deps), and this module never
// touches ranking or progression — scouts carry owner_id null, so the whole
// progression layer ignores them by construction. The access-split guard
// test asserts the import graph stays empty of both.

/** True when a pitch record is a scout concept. Null-safe. */
export function isScout(pitch) {
  return !!(pitch && pitch.origin === 'scout');
}

/** Deep copy via JSON round-trip (the seedCopy discipline from store.js). */
function copyRecord(record) {
  try {
    return JSON.parse(JSON.stringify(record));
  } catch (_err) {
    return null;
  }
}

/**
 * Append drop pitches that are not already present (by id) and whose
 * active_from has arrived. Missing/malformed active_from activates
 * immediately (fail-open: a typo must not strand a concept forever).
 * Pure: inputs are never mutated; drop pitches are deep-copied in. Returns
 * the original array untouched when nothing is added.
 *
 * @param {object[]} pitches  the current pool (store.loadPitches())
 * @param {object[]} drops    SCOUT_DROPS
 * @param {string} nowIso     comparison instant (new Date().toISOString())
 * @returns {{ pitches: object[], added: number }}
 */
export function mergeDrops(pitches, drops, nowIso) {
  const base = Array.isArray(pitches) ? pitches : [];
  const dropList = Array.isArray(drops) ? drops : [];
  const now = Date.parse(nowIso);
  const nowMs = Number.isNaN(now) ? Date.now() : now;

  const present = new Set();
  for (const pitch of base) {
    if (pitch && typeof pitch.id === 'string') present.add(pitch.id);
  }

  const additions = [];
  for (const drop of dropList) {
    const dropPitches = drop && Array.isArray(drop.pitches) ? drop.pitches : [];
    for (const pitch of dropPitches) {
      if (!pitch || typeof pitch.id !== 'string' || present.has(pitch.id)) continue;
      const activeMs = Date.parse(pitch.active_from);
      if (!Number.isNaN(activeMs) && activeMs > nowMs) continue; // not yet
      const copy = copyRecord(pitch);
      if (!copy) continue;
      additions.push(copy);
      present.add(copy.id);
    }
  }

  if (additions.length === 0) return { pitches: base, added: 0 };
  return { pitches: base.concat(additions), added: additions.length };
}

/** Newest-first ordering for scouts: created_at desc, id desc tie-break. */
function newnessDesc(a, b) {
  const ta = (a && a.created_at) || '';
  const tb = (b && b.created_at) || '';
  if (ta > tb) return -1;
  if (ta < tb) return 1;
  const ia = (a && a.id) || '';
  const ib = (b && b.id) || '';
  if (ia > ib) return -1;
  if (ia < ib) return 1;
  return 0;
}

/**
 * Rolling freshness window: the newest `windowK` non-retired scouts stay
 * active; any older non-retired scout gets `retired: true`. One-way — a
 * retired scout is never un-retired (its votes and Studio row survive; it
 * just leaves the Arena rotation). Humans and samples are never touched.
 * Pure: returns the original array when nothing changes, a rebuilt array
 * (with copied, flagged records) when something does.
 *
 * @param {object[]} pitches
 * @param {number} windowK
 * @returns {{ pitches: object[], changed: boolean }}
 */
export function applyRetirement(pitches, windowK) {
  const base = Array.isArray(pitches) ? pitches : [];
  const limit = Number.isFinite(windowK) && windowK >= 0 ? Math.floor(windowK) : 0;

  const activeScouts = base.filter((p) => isScout(p) && !p.retired);
  if (activeScouts.length <= limit) return { pitches: base, changed: false };

  const toRetire = new Set(
    activeScouts
      .slice()
      .sort(newnessDesc)
      .slice(limit)
      .map((p) => p.id)
  );

  const next = base.map((pitch) => {
    if (!pitch || !toRetire.has(pitch.id)) return pitch;
    const copy = copyRecord(pitch) || pitch;
    copy.retired = true;
    return copy;
  });
  return { pitches: next, changed: true };
}

/**
 * Cap the scout share of an Arena pool. Input is the pool AFTER the retired
 * filter and the self-vote (owner) filter. When fewer than two human pitches
 * remain, the cap stands down entirely — survival mode: scouts keep the
 * Arena alive when there is nothing else to pair. Otherwise scouts may be at
 * most `share` of the final pool: keep the NEWEST allowed scouts. Semantics
 * at the edges are deliberate: share <= 0 removes every scout, while any
 * positive share keeps at least one (minimum exposure — a tiny share should
 * meter scouts, not silently disable the pipeline). Pure and
 * order-preserving for the survivors.
 *
 * @param {object[]} pitches
 * @param {number} share  desired max scout fraction of the pool, clamped [0, 0.9]
 * @returns {object[]}
 */
export function composeArenaPool(pitches, share) {
  const pool = Array.isArray(pitches) ? pitches : [];
  const humans = pool.filter((p) => !isScout(p));
  const scouts = pool.filter(isScout);

  if (humans.length < 2) return pool; // survival mode
  if (scouts.length === 0) return pool;

  const clamped = Math.min(0.9, Math.max(0, Number.isFinite(share) ? share : 0));
  if (clamped === 0) return humans;

  // scouts <= share * (humans + scouts)  =>  scouts <= humans * share/(1-share)
  const allowed = Math.max(1, Math.floor((humans.length * clamped) / (1 - clamped)));
  if (scouts.length <= allowed) return pool;

  const keep = new Set(scouts.slice().sort(newnessDesc).slice(0, allowed).map((p) => p.id));
  return pool.filter((p) => !isScout(p) || keep.has(p.id));
}

/**
 * Fill a SCOUT_IMAGES.prompt_template for one pitch — the templatized,
 * dynamic image prompt the drop routine hands to its image-generator MCP
 * (docs/scout-routine.md STEP 4b). Per-pitch variables come from the pitch
 * itself: {seed_a} / {seed_b} are its two inspiration seeds, {slot} its
 * cosmetic category, plus {title}, {tags} (comma-joined theme tags), and
 * {description}. Game-level variables ({game_name}, {visual_direction}, or
 * anything else) are injected via `context` — this module imports nothing,
 * so game-config values arrive as parameters, same as the sampler does.
 *
 * Fail-safe by contract: returns '' (meaning "generate no image") when the
 * template is empty/non-string or the pitch lacks the two inspiration seeds
 * the template exists to fuse. Unknown {placeholders} are left verbatim so
 * a template typo is visible in the output instead of silently swallowed;
 * whitespace is collapsed. Pure — nothing is mutated.
 *
 * @param {object} pitch     a scout pitch (needs inspiration.sources[0..1])
 * @param {string} template  game-config SCOUT_IMAGES.prompt_template
 * @param {object} [context] extra vars, e.g. { game_name, visual_direction }
 * @returns {string} the filled prompt, or '' when no image should be made
 */
export function buildImagePrompt(pitch, template, context) {
  if (!pitch || typeof pitch !== 'object') return '';
  if (typeof template !== 'string' || !template.trim()) return '';
  const sources =
    pitch.inspiration && Array.isArray(pitch.inspiration.sources)
      ? pitch.inspiration.sources.filter((s) => typeof s === 'string' && s.trim())
      : [];
  if (sources.length < 2) return '';

  const vars = {
    seed_a: sources[0].trim(),
    seed_b: sources[1].trim(),
    slot: typeof pitch.item_slot === 'string' ? pitch.item_slot : '',
    title: typeof pitch.title === 'string' ? pitch.title : '',
    description: typeof pitch.description === 'string' ? pitch.description : '',
    tags: Array.isArray(pitch.theme_tags)
      ? pitch.theme_tags.filter((t) => typeof t === 'string').join(', ')
      : '',
  };
  if (context && typeof context === 'object') {
    for (const key of Object.keys(context)) {
      const value = context[key];
      if (typeof value === 'string') vars[key] = value;
    }
  }

  return template
    .replace(/\{([a-z0-9_]+)\}/gi, (match, key) =>
      Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * sampler.pickPair wrapper enforcing at most one scout per served pair.
 * Works on a COPY of seenPairs (the caller's session history is never
 * mutated here), marking scout-vs-scout pairs seen until a mixed or
 * human-human pair emerges. Exception: a pool with zero humans allows scout
 * pairs (survival mode). Terminates because each rejection permanently
 * excludes one pair from the finite pair set. 'insufficient' / 'exhausted'
 * pass through UNCHANGED: on 'exhausted' arena.js clears the session history
 * and retries, at which point previously-seen mixed pairs are servable again
 * — whenever a human and one other pitch coexist, a mixed pair exists, so
 * the retry always finds one and voting never dead-ends.
 *
 * @param {{ pickPair: function, pairKey: function }} sampler
 * @param {object[]} pitches
 * @param {object[]} votes
 * @param {Set<string>} seenPairs
 * @returns {{ status: 'ok'|'insufficient'|'exhausted', pair: [object, object]|null }}
 */
export function pickPairWithQuota(sampler, pitches, votes, seenPairs) {
  const pool = Array.isArray(pitches) ? pitches : [];
  const allowScoutPairs = !pool.some((p) => !isScout(p));

  const seen = new Set(seenPairs instanceof Set ? seenPairs : []);
  // The pair set is finite; each iteration either returns or permanently
  // excludes one more pair, so this loop is bounded by the pair count.
  for (;;) {
    const result = sampler.pickPair(pool, votes, seen);
    if (result.status !== 'ok' || !Array.isArray(result.pair)) return result;
    const [first, second] = result.pair;
    if (allowScoutPairs || !isScout(first) || !isScout(second)) return result;
    seen.add(sampler.pairKey(first.id, second.id));
  }
}
