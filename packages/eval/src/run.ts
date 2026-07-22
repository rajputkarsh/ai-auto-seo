/**
 * CLI entry: run the golden-set eval and enforce the precision gate.
 *   pnpm eval
 * Exits non-zero when any rule falls below threshold, so CI blocks the build.
 */
import { loadCases, runEval } from "./harness";
import { checkGates, formatReport } from "./report";

const cases = loadCases();
const report = runEval(cases);
const gate = checkGates(report);

console.log(formatReport(report, gate));

if (!gate.passed) process.exit(1);
