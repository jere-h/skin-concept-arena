// ranking.js — Pure, DOM-free leaderboard logic for Skin Concept Arena.
//
// rank(pitches, votes, threshold) derives a RankRow[] for the Studio view.
// This module is imported ONLY by app.js (to inject) and studio.js. It is
// deliberately never imported by wizard.js or arena.js: the submitter/voter
// views cannot compute or render any score/rank, and that access split is
// enforced structurally by the import graph (finding 6).
//
// A RankRow is:
//   { id, title, comparisons, wins, win_rate, needs_more_votes }
// where
//   comparisons     = number of votes the pitch took part in
//   wins            = number of those votes the pitch won
//   win_rate        = comparisons > 0 ? wins / comparisons : 0
//   needs_more_votes= comparisons < threshold  (exactly)
//
// Rows are sorted by win_rate desc, then comparisons desc, then created_at asc
// for a stable, deterministic order (finding 5).

/**
 * Rank pitches by head-to-head win rate.
 *
 * @param {Array<{id:string,title:string,created_at:string}>} pitches
 * @param {Array<{pitch_a_id:string,pitch_b_id:string,winner_id:string}>} votes
 * @param {number} threshold - comparisons below this flag needs_more_votes
 * @returns {Array<{id:string,title:string,comparisons:number,wins:number,win_rate:number,needs_more_votes:boolean}>}
 */
export function rank(pitches, votes, threshold) {
  const pitchList = Array.isArray(pitches) ? pitches : [];
  const voteList = Array.isArray(votes) ? votes : [];
  const limit = Number.isFinite(threshold) ? threshold : 0;

  // Tally comparisons + wins per pitch id in a single pass over the votes.
  // NOTE: progression.js::pitchStatus duplicates this small tally on purpose
  // (importing this Studio-only module there would breach the access-split
  // seam) — if the Vote shape changes, update the twin there too.
  const stats = new Map();
  for (const pitch of pitchList) {
    if (pitch && typeof pitch.id === 'string') {
      stats.set(pitch.id, { comparisons: 0, wins: 0 });
    }
  }

  for (const vote of voteList) {
    if (!vote) continue;
    const { pitch_a_id, pitch_b_id, winner_id } = vote;
    // Only count votes whose participants are known pitches, so orphaned
    // votes (e.g. a deleted pitch) never inflate anyone's totals.
    const a = stats.get(pitch_a_id);
    const b = stats.get(pitch_b_id);
    if (a) a.comparisons += 1;
    if (b) b.comparisons += 1;
    const winner = stats.get(winner_id);
    // A winner only earns a win if it was actually one of the two contestants.
    if (winner && (winner_id === pitch_a_id || winner_id === pitch_b_id)) {
      winner.wins += 1;
    }
  }

  const rows = pitchList
    .filter((pitch) => pitch && typeof pitch.id === 'string')
    .map((pitch) => {
      const { comparisons, wins } = stats.get(pitch.id) || { comparisons: 0, wins: 0 };
      return {
        id: pitch.id,
        title: pitch.title || '',
        comparisons,
        wins,
        win_rate: comparisons > 0 ? wins / comparisons : 0,
        needs_more_votes: comparisons < limit,
        created_at: pitch.created_at || '',
      };
    });

  rows.sort((x, y) => {
    // Primary: win rate, high to low.
    if (y.win_rate !== x.win_rate) return y.win_rate - x.win_rate;
    // Secondary: more comparisons first (more evidence outranks less).
    if (y.comparisons !== x.comparisons) return y.comparisons - x.comparisons;
    // Tertiary: oldest pitch first, for a stable deterministic order.
    if (x.created_at < y.created_at) return -1;
    if (x.created_at > y.created_at) return 1;
    return 0;
  });

  // created_at was a sort key only; the RankRow contract does not include it.
  return rows.map(({ created_at, ...row }) => row);
}
