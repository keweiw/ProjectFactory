/**
 * Command-line test entry point: `node dist/tests/run.js`.
 * The browser entry point is `tests/index.html`, which imports this same module.
 */

import { runAll, summarise } from "./harness.js";

import "./stats.test.js";
import "./persona.test.js";
import "./session.test.js";
import "./storage.test.js";
import "./deck.test.js";
import "./chart.test.js";
import "./advice.test.js";
import "./app.test.js";

async function main(): Promise<void> {
  const results = await runAll();
  const { passed, failed } = summarise(results);

  for (const r of results) {
    if (!r.passed) console.log(`FAIL  ${r.name}\n      ${r.error}`);
  }
  console.log(`\n${passed} passed, ${failed} failed, ${results.length} total`);

  const proc = (globalThis as { process?: { exitCode?: number } }).process;
  if (proc && failed > 0) proc.exitCode = 1;
}

void main();
