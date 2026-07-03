// scripts/gate.mjs — THE canonical verification gate.
//
//   node scripts/gate.mjs
//
// Runs every mechanical check in order: game-config contract → bundled-data
// integrity → scout-drop contract (incl. the seed atlas) → the full test
// suite. Exit 0 iff everything passes.
//
// This is the ONE entrypoint every workflow cites — CLAUDE.md, the
// adaptation guide's acceptance step, the drop routine's STEP 5, and CI all
// invoke exactly this script — so the gate can never drift apart between
// them. Add a new check HERE and every workflow inherits it.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const STEPS = [
  ['game-config contract', ['scripts/validate-config.mjs']],
  ['bundled-data integrity', ['scripts/validate-data.mjs']],
  ['scout-drop contract', ['scripts/validate-drops.mjs']],
  ['test suite', ['--test', 'tests/logic.test.js', 'tests/scout.test.js']],
];

let failed = 0;
for (const [label, args] of STEPS) {
  console.log(`\n=== gate: ${label} ===`);
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    failed += 1;
    console.error(`gate step FAILED: ${label}`);
  }
}

if (failed > 0) {
  console.error(`\ngate FAILED — ${failed} step(s) failed`);
  process.exit(1);
}
console.log('\ngate OK — all steps passed');
