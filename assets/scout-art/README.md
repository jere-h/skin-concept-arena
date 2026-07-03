# assets/scout-art/

Committed home for **optional AI-generated scout concept images** — the
image-generator-MCP integration described in
`docs/scout-pipeline-tech-spec.md` §4.4 and authored by the drop routine's
STEP 4b (`docs/scout-routine.md`). **Implementing or debugging the
integration? Follow `docs/image-generator-mcp-integration.md`** — the
ordered, gate-verified runbook (prompts come from
`node scripts/scout-image-prompts.mjs`, never freehand).

The contract (enforced by `scripts/validate-drops.mjs`):

- Images exist here **only** while `game-config.js` `SCOUT_IMAGES.enabled`
  is `true`; with it `false` (the default) every scout ships `image_url: ''`
  and the app renders its deterministic placeholder art.
- One file per pitch, named after it exactly:
  `<pitch-id>.<png|jpg|jpeg|webp|svg>` (e.g. `scout-002-tidewarden.png`),
  referenced from the pitch as `image_url: 'assets/scout-art/<file>'`.
- Every referenced pitch carries `image_gen` provenance — the filled
  `SCOUT_IMAGES.prompt_template` (built by `scout.buildImagePrompt`, citing
  both inspiration seeds and the item slot), the generator name, and a
  timestamp.
- Never external URLs (design lock: zero external assets); files here are
  same-origin static assets, served by GitHub Pages like everything else.
- Like drops, files are append-only: a merged drop's image is never edited
  or deleted (device stores already reference it).
