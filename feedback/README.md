# feedback/ — Arena performance exports that steer the next scout drop

This directory closes the quality loop between the Arena and the scout-drop
routine. Votes never leave a device (there is no backend), so Arena results
reach the generation side exactly one way:

1. A studio lead opens the **Studio** view, unlocks it, and clicks
   **Export feedback JSON** in the Scout report panel. That downloads
   `arena-feedback.json` from *their* device — the canonical review device
   in this deployment model.
2. The lead commits that file **here** (any filename ending in `.json`;
   date-stamped names like `arena-feedback-2026-07-10.json` keep history).
3. On its next run, the drop-authoring routine (`docs/scout-routine.md`
   STEP 1) reads every `*.json` in this directory: scouts with high
   `win_rate` and the `top_human` pitches become positive style exemplars;
   low-win-rate or fast-retired scouts become negative exemplars.

File shape (produced by `studio.js` `exportFeedback`):

```json
{
  "exported_at": "ISO timestamp",
  "comparison_threshold": 5,
  "scouts": [
    { "id": "scout-001-…", "title": "…", "comparisons": 0, "wins": 0,
      "win_rate": 0, "retired": false }
  ],
  "top_human": [
    { "title": "…", "description": "…", "item_slot": "…",
      "theme_tags": ["…"], "comparisons": 0, "win_rate": 0 }
  ]
}
```

No file here is required — with the directory empty, the routine falls back
to the bundled sample pitches as exemplars. Drops keep shipping either way;
they just don't get smarter.
