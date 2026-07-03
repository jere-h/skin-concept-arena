// sample-data.js
//
// GAME-ADAPT: these sample pitches/votes are Emberhold-flavored — REPLACE
// them when adapting to a new game (docs/adapt-to-a-new-game.md step 4).
// Keep the same shapes and roughly the same counts (6 pitches / 16 votes:
// enough that every view demos itself, two pitches deliberately under the
// comparison threshold). Write new samples using game-config.js ITEM_SLOTS /
// THEME_TAGS exactly — `node scripts/validate-data.mjs` checks vote wiring
// and warns on vocabulary drift.
//
// Bundled EXAMPLE data for Skin Concept Arena. store.js seeds these two arrays
// the first time the app loads (when the 'sca.pitches.v1' / 'sca.votes.v1'
// localStorage keys are absent) so all three views, including the Studio
// leaderboard, demonstrate themselves immediately instead of showing an empty
// shell. Everything here is illustrative sample content for the single seeded
// game; users can add their own pitches and votes afterward, and clearing
// storage restores this set.
//
// Data shapes (see the shared contract):
//   Pitch { id, item_slot, theme_tags[], title, description, image_url, created_at }
//   Vote  { id, pitch_a_id, pitch_b_id, winner_id, created_at }
//
// image_url is intentionally a MIX: some pitches ship a self-contained inline
// SVG data-URI thumbnail, others leave it '' so the CSS/inline-SVG placeholder
// path is exercised. No external/CDN URLs (they break offline and on Pages).

// Small, self-contained placeholder thumbnails. Neutrals + the single locked
// accent (#f25c2a) only, on the dark theme surfaces, so the Color and Theme Locks hold. Kept compact and inline.
const THUMB_THORNWARDEN =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20320%20200'%3E%3Crect%20width='320'%20height='200'%20fill='%2314161a'/%3E%3Cpath%20d='M160%2030%20C110%2090%20110%20150%20160%20182%20C210%20150%20210%2090%20160%2030%20Z'%20fill='%23f25c2a'%20opacity='0.85'/%3E%3Cpath%20d='M160%2058%20L160%20172'%20stroke='%23e8eaed'%20stroke-width='3'/%3E%3Cpath%20d='M160%20100%20L128%2082%20M160%20124%20L192%20106'%20stroke='%23e8eaed'%20stroke-width='3'/%3E%3C/svg%3E";

const THUMB_HALCYON =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20320%20200'%3E%3Crect%20width='320'%20height='200'%20fill='%2314161a'/%3E%3Ccircle%20cx='160'%20cy='100'%20r='60'%20fill='none'%20stroke='%23f25c2a'%20stroke-width='6'/%3E%3Ccircle%20cx='160'%20cy='100'%20r='16'%20fill='%23f25c2a'/%3E%3Ccircle%20cx='250'%20cy='48'%20r='5'%20fill='%23a7adb8'/%3E%3Ccircle%20cx='68'%20cy='150'%20r='4'%20fill='%23a7adb8'/%3E%3Ccircle%20cx='104'%20cy='44'%20r='3'%20fill='%23a7adb8'/%3E%3C/svg%3E";

const THUMB_GLASSWING =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20320%20200'%3E%3Crect%20width='320'%20height='200'%20fill='%2314161a'/%3E%3Crect%20x='58'%20y='56'%20width='204'%20height='88'%20rx='10'%20fill='none'%20stroke='%23f25c2a'%20stroke-width='5'/%3E%3Cline%20x1='58'%20y1='100'%20x2='262'%20y2='100'%20stroke='%23a7adb8'%20stroke-width='3'/%3E%3Cline%20x1='160'%20y1='56'%20x2='160'%20y2='144'%20stroke='%23a7adb8'%20stroke-width='3'/%3E%3C/svg%3E";

export const SAMPLE_PITCHES = [
  {
    id: "sample-thornwarden",
    item_slot: "Character Skin",
    theme_tags: ["Badass", "Gritty"],
    title: "Thornwarden Regalia",
    description:
      "A living-armor set grown from blackthorn and bark, with vine seams that tighten across the shoulders when the wearer sprints. Muted greens over dark iron so it reads as guardian, not villain.",
    image_url: THUMB_THORNWARDEN,
    created_at: "2026-06-12T09:15:00.000Z",
  },
  {
    id: "sample-tidecaller",
    item_slot: "Weapon Skin",
    theme_tags: ["Elegant", "Gritty"],
    title: "Tidecaller Longbow",
    description:
      "A bow carved from a single piece of driftwood, its string a taut thread of seafoam that leaves a brief wet shimmer on release. Barnacle detailing along the grip keeps it grounded and worn, not glossy.",
    image_url: "",
    created_at: "2026-06-13T14:22:00.000Z",
  },
  {
    id: "sample-halcyon",
    item_slot: "Back Bling / Cape",
    theme_tags: ["Dreamy", "Elegant"],
    title: "Halcyon Orbit",
    description:
      "A slow-turning ring of pale light that hovers behind the character, with a single small satellite tracing the loop. The glow is dim and steady so it works in dark maps without washing out the silhouette.",
    image_url: THUMB_HALCYON,
    created_at: "2026-06-15T11:05:00.000Z",
  },
  {
    id: "sample-emberforge",
    item_slot: "Weapon Skin",
    theme_tags: ["Badass", "Gritty"],
    title: "Emberforge Maul",
    description:
      "A heavy blacksmith hammer with a head that still glows at the cracks, cooling from orange to grey between swings. Soot on the haft and a leather wrap give it weight and use.",
    image_url: "",
    created_at: "2026-06-17T16:40:00.000Z",
  },
  {
    id: "sample-glasswing",
    item_slot: "Emote",
    theme_tags: ["Cute", "Dreamy"],
    title: "Glasswing Rest",
    description:
      "A short idle where a translucent moth lands on the character's outstretched hand, folds its wings once, and lifts off. Quiet and low-key, meant for lobby downtime rather than a taunt.",
    image_url: THUMB_GLASSWING,
    created_at: "2026-06-20T08:30:00.000Z",
  },
  {
    id: "sample-nocturne",
    item_slot: "Emote",
    theme_tags: ["Elegant", "Creepy"],
    title: "Nocturne Bow",
    description:
      "A slow, formal bow as the sky behind the character darkens to deep blue and a scatter of faint stars fades in. Restrained and theatrical without confetti or fireworks.",
    image_url: "",
    created_at: "2026-06-21T19:12:00.000Z",
  },
];

export const SAMPLE_VOTES = [
  // Glasswing and Nocturne each appear in only two comparisons, so they stay
  // under the default comparison threshold (5) and surface the leaderboard's
  // 'needs more votes' flag; the rest have enough comparisons to sort by win rate.
  {
    id: "sample-vote-01",
    pitch_a_id: "sample-glasswing",
    pitch_b_id: "sample-thornwarden",
    winner_id: "sample-glasswing",
    created_at: "2026-06-22T10:04:00.000Z",
  },
  {
    id: "sample-vote-02",
    pitch_a_id: "sample-glasswing",
    pitch_b_id: "sample-tidecaller",
    winner_id: "sample-tidecaller",
    created_at: "2026-06-22T13:41:00.000Z",
  },
  {
    id: "sample-vote-03",
    pitch_a_id: "sample-nocturne",
    pitch_b_id: "sample-thornwarden",
    winner_id: "sample-thornwarden",
    created_at: "2026-06-23T09:18:00.000Z",
  },
  {
    id: "sample-vote-04",
    pitch_a_id: "sample-nocturne",
    pitch_b_id: "sample-halcyon",
    winner_id: "sample-halcyon",
    created_at: "2026-06-23T18:55:00.000Z",
  },
  {
    id: "sample-vote-05",
    pitch_a_id: "sample-thornwarden",
    pitch_b_id: "sample-tidecaller",
    winner_id: "sample-thornwarden",
    created_at: "2026-06-24T08:12:00.000Z",
  },
  {
    id: "sample-vote-06",
    pitch_a_id: "sample-thornwarden",
    pitch_b_id: "sample-tidecaller",
    winner_id: "sample-thornwarden",
    created_at: "2026-06-24T15:37:00.000Z",
  },
  {
    id: "sample-vote-07",
    pitch_a_id: "sample-thornwarden",
    pitch_b_id: "sample-halcyon",
    winner_id: "sample-thornwarden",
    created_at: "2026-06-25T07:49:00.000Z",
  },
  {
    id: "sample-vote-08",
    pitch_a_id: "sample-thornwarden",
    pitch_b_id: "sample-halcyon",
    winner_id: "sample-thornwarden",
    created_at: "2026-06-25T12:26:00.000Z",
  },
  {
    id: "sample-vote-09",
    pitch_a_id: "sample-thornwarden",
    pitch_b_id: "sample-emberforge",
    winner_id: "sample-thornwarden",
    created_at: "2026-06-25T20:03:00.000Z",
  },
  {
    id: "sample-vote-10",
    pitch_a_id: "sample-thornwarden",
    pitch_b_id: "sample-emberforge",
    winner_id: "sample-emberforge",
    created_at: "2026-06-26T09:14:00.000Z",
  },
  {
    id: "sample-vote-11",
    pitch_a_id: "sample-tidecaller",
    pitch_b_id: "sample-halcyon",
    winner_id: "sample-tidecaller",
    created_at: "2026-06-26T14:58:00.000Z",
  },
  {
    id: "sample-vote-12",
    pitch_a_id: "sample-tidecaller",
    pitch_b_id: "sample-halcyon",
    winner_id: "sample-tidecaller",
    created_at: "2026-06-27T08:31:00.000Z",
  },
  {
    id: "sample-vote-13",
    pitch_a_id: "sample-tidecaller",
    pitch_b_id: "sample-emberforge",
    winner_id: "sample-tidecaller",
    created_at: "2026-06-27T16:12:00.000Z",
  },
  {
    id: "sample-vote-14",
    pitch_a_id: "sample-tidecaller",
    pitch_b_id: "sample-emberforge",
    winner_id: "sample-emberforge",
    created_at: "2026-06-28T10:47:00.000Z",
  },
  {
    id: "sample-vote-15",
    pitch_a_id: "sample-halcyon",
    pitch_b_id: "sample-emberforge",
    winner_id: "sample-halcyon",
    created_at: "2026-06-28T19:09:00.000Z",
  },
  {
    id: "sample-vote-16",
    pitch_a_id: "sample-halcyon",
    pitch_b_id: "sample-emberforge",
    winner_id: "sample-halcyon",
    created_at: "2026-06-29T11:33:00.000Z",
  },
];
