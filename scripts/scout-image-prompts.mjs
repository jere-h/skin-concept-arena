// scripts/scout-image-prompts.mjs
//
// Emit ready-to-run IMAGE JOBS for the scout-drop routine's optional
// concept-image step (docs/scout-routine.md STEP 4b; full runbook:
// docs/image-generator-mcp-integration.md). One job per drop pitch that has
// no image yet: the pitch id, the exact file path the validator will accept,
// and the filled prompt_template — so the agent driving the image-generator
// MCP never freehands a prompt or a filename.
//
//   node scripts/scout-image-prompts.mjs              # jobs for the NEWEST drop
//   node scripts/scout-image-prompts.mjs drop-002     # jobs for one drop
//   node scripts/scout-image-prompts.mjs scout-002-x  # job for one pitch
//   node scripts/scout-image-prompts.mjs all          # jobs for every drop
//
// Prints one JSON object to stdout (machine-readable by design):
//   { enabled, generator, asset_dir, note, jobs: [
//       { drop_id, pitch_id, target_file, prompt } ] }
// `target_file` assumes .png; swap the extension to match what the MCP
// actually returned (png|jpg|jpeg|webp|svg are all valid). Informational
// tool: always exits 0 — the enforcement lives in scripts/gate.mjs.

import { SCOUT_DROPS } from '../scout-data.js';
import { GAME, SCOUT_IDEATION, SCOUT_IMAGES } from '../game-config.js';
import { buildImagePrompt } from '../scout.js';

/**
 * Compute image jobs for every pitch (in `drops`) that has no image yet.
 * Pure: `images` is a SCOUT_IMAGES-shaped config, `context` the template's
 * game-level vars ({ game_name, visual_direction }). Pitches whose prompt
 * cannot be built (no two seeds, empty template) are skipped — the same
 * "make no image" fail-safe as scout.buildImagePrompt.
 */
export function imageJobs(drops, images, context) {
  const cfg = images && typeof images === 'object' ? images : {};
  const assetDir =
    typeof cfg.asset_dir === 'string' && cfg.asset_dir ? cfg.asset_dir : 'assets/scout-art/';
  const jobs = [];
  for (const drop of Array.isArray(drops) ? drops : []) {
    const pitches = drop && Array.isArray(drop.pitches) ? drop.pitches : [];
    for (const pitch of pitches) {
      if (!pitch || typeof pitch.id !== 'string') continue;
      if (typeof pitch.image_url === 'string' && pitch.image_url !== '') continue;
      const prompt = buildImagePrompt(pitch, cfg.prompt_template, context);
      if (!prompt) continue;
      jobs.push({
        drop_id: drop.drop_id,
        pitch_id: pitch.id,
        target_file: `${assetDir}${pitch.id}.png`,
        prompt,
      });
    }
  }
  return jobs;
}

// --- CLI entry ---------------------------------------------------------------

import { pathToFileURL } from 'node:url';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const selector = process.argv[2] || '';
  let drops;
  if (!selector) {
    drops = SCOUT_DROPS.slice(-1); // the newest drop — the one being authored
  } else if (selector === 'all') {
    drops = SCOUT_DROPS;
  } else if (selector.startsWith('drop-')) {
    drops = SCOUT_DROPS.filter((d) => d && d.drop_id === selector);
  } else {
    // pitch-id selector: narrow each drop to the one pitch.
    drops = SCOUT_DROPS.map((d) => ({
      ...d,
      pitches: (Array.isArray(d.pitches) ? d.pitches : []).filter(
        (p) => p && p.id === selector
      ),
    })).filter((d) => d.pitches.length > 0);
  }

  const context = {
    game_name: GAME.name,
    visual_direction: SCOUT_IDEATION.visual_direction,
  };
  const jobs = imageJobs(drops, SCOUT_IMAGES, context);
  const note = !SCOUT_IMAGES.enabled
    ? 'SCOUT_IMAGES.enabled is false: the gate REJECTS scout images. Ship ' +
      "image_url '' everywhere, or flip the flag in game-config.js first."
    : jobs.length === 0
      ? 'No image-less pitches matched the selector — nothing to generate.'
      : 'Send each prompt VERBATIM to the image MCP; save the result at ' +
        'target_file (swap the extension to match the returned format); then ' +
        "REPLACE the pitch's image_url value and add image_gen provenance " +
        '(see docs/image-generator-mcp-integration.md).';

  console.log(
    JSON.stringify(
      {
        enabled: SCOUT_IMAGES.enabled,
        generator: SCOUT_IMAGES.generator,
        asset_dir: SCOUT_IMAGES.asset_dir,
        note,
        jobs,
      },
      null,
      2
    )
  );
}
