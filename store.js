// store.js
// Persistence layer for Skin Concept Arena.
//
// Wraps localStorage under the two fixed keys 'sca.pitches.v1' and
// 'sca.votes.v1'. Every path fails safe: a missing key seeds the bundled
// sample data (so the app is pre-populated on first load), malformed JSON is
// discarded, and if localStorage is unavailable or disabled we transparently
// fall back to in-memory arrays so all three views still render with no
// console errors. Data written through here survives reload.
//
// The defensive readKey/writeKey pair is exported so profile.js can persist
// the progression keys ('sca.profile.v1' / 'sca.progress.v1') under the same
// discipline (memory-mirror fallback, malformed JSON discarded, never throws).

import { newId } from './ids.js';
import { SAMPLE_PITCHES, SAMPLE_VOTES } from './sample-data.js';

const PITCHES_KEY = 'sca.pitches.v1';
const VOTES_KEY = 'sca.votes.v1';

// In-memory fallback store. Used both when localStorage is unavailable and as
// a last-resort mirror so reads/writes never throw for callers.
const memory = {
  available: null, // lazily probed: true/false once determined
  [PITCHES_KEY]: null,
  [VOTES_KEY]: null,
};

// Probe whether localStorage is usable (present, and not blocked by privacy
// settings / storage quota / sandbox). Cached after first call.
function storageAvailable() {
  if (memory.available !== null) return memory.available;
  try {
    const ls = window.localStorage;
    const probe = '__sca_probe__';
    ls.setItem(probe, probe);
    ls.removeItem(probe);
    memory.available = true;
  } catch (_err) {
    // SecurityError, QuotaExceededError, ReferenceError under some sandboxes.
    memory.available = false;
  }
  return memory.available;
}

// Sentinel so readArrayKey can tell "present but malformed" (fail safe to [])
// apart from "absent" (caller seeds) without exposing that split to callers of
// the generic readKey below.
const MALFORMED = Symbol('sca.malformed');

// Read + parse a key defensively. Returns the parsed JSON value, or null when
// the key is absent/unreadable, or `malformed` (default null) when the raw
// string is present but not valid JSON. Exported (non-breaking) so profile.js
// can persist the progression keys ('sca.profile.v1' / 'sca.progress.v1')
// with the same fail-safe discipline. Never throws.
export function readKey(key, malformed = null) {
  // No real storage: use the in-memory mirror.
  if (!storageAvailable()) {
    return memory[key] === undefined || memory[key] === null ? null : memory[key];
  }
  let raw;
  try {
    raw = window.localStorage.getItem(key);
  } catch (_err) {
    return memory[key] === undefined || memory[key] === null ? null : memory[key];
  }
  if (raw === null || raw === undefined) return null; // absent -> caller defaults
  try {
    return JSON.parse(raw);
  } catch (_err) {
    // Malformed JSON -> fail safe with the caller's fallback (never throw).
    return malformed;
  }
}

// Array-shaped read for the pitches/votes keys, preserving the v1 semantics:
// a truly-absent key stays null (so loadWithSeed seeds the samples), while a
// present-but-malformed or wrong-shaped value fails safe to [] without
// re-seeding over whatever the user had.
function readArrayKey(key) {
  const parsed = readKey(key, MALFORMED);
  if (parsed === MALFORMED) return [];
  if (parsed === null) return null; // absent -> caller seeds
  return Array.isArray(parsed) ? parsed : [];
}

// Write a JSON-serialisable value to a key. Always mirrors into memory; only
// touches localStorage when it is available. Never throws. Exported
// (non-breaking) for profile.js — see readKey above.
export function writeKey(key, value) {
  // JSON.stringify(undefined) is undefined and would store the string
  // "undefined"; normalise to null so a later read parses cleanly.
  const safe = value === undefined ? null : value;
  memory[key] = safe;
  if (!storageAvailable()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(safe));
  } catch (_err) {
    // Quota exceeded or write blocked mid-session: keep the memory mirror so
    // the session stays consistent, but don't surface an error.
    memory.available = false;
  }
}

// Array-shaped write for the pitches/votes keys (v1 coercion preserved).
function writeArrayKey(key, arr) {
  writeKey(key, Array.isArray(arr) ? arr : []);
}

// Return a fresh deep-ish copy of the bundled samples so seeding never lets a
// caller mutate the imported constants.
function seedCopy(samples) {
  try {
    return JSON.parse(JSON.stringify(samples));
  } catch (_err) {
    return Array.isArray(samples) ? samples.slice() : [];
  }
}

// Generic load: seed the sample set on a truly-absent key (first load),
// otherwise return whatever survived the defensive parse.
function loadWithSeed(key, samples) {
  const existing = readArrayKey(key);
  if (existing === null) {
    const seeded = seedCopy(samples);
    writeArrayKey(key, seeded);
    return seeded;
  }
  return existing;
}

export function loadPitches() {
  return loadWithSeed(PITCHES_KEY, SAMPLE_PITCHES);
}

export function savePitches(pitches) {
  writeArrayKey(PITCHES_KEY, pitches);
}

export function loadVotes() {
  return loadWithSeed(VOTES_KEY, SAMPLE_VOTES);
}

export function saveVotes(votes) {
  writeArrayKey(VOTES_KEY, votes);
}

// Append a pitch and persist. Assigns id + created_at when absent and returns
// the stored record.
export function addPitch(pitch) {
  const record = {
    ...pitch,
    id: (pitch && pitch.id) || newId(),
    created_at: (pitch && pitch.created_at) || new Date().toISOString(),
  };
  const pitches = loadPitches();
  pitches.push(record);
  savePitches(pitches);
  return record;
}

// Append a vote and persist. Assigns id + created_at when absent and returns
// the stored record.
export function addVote(vote) {
  const record = {
    ...vote,
    id: (vote && vote.id) || newId(),
    created_at: (vote && vote.created_at) || new Date().toISOString(),
  };
  const votes = loadVotes();
  votes.push(record);
  saveVotes(votes);
  return record;
}
