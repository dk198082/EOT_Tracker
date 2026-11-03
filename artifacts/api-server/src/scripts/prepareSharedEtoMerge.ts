/**
 * Offline preparation only. No database library/pool import or execute mode.
 * Raw snapshots may contain personal data: output is aggregate metadata only.
 */
import { readFile, stat } from "node:fs/promises";
import { logger } from "../lib/logger";
import { getMergeContracts, type Decisions, type Snapshot } from "../lib/shared-merge/contracts";
import { sharedMergeFixture } from "../lib/shared-merge/fixture";
import { prepareSharedMerge } from "../lib/shared-merge/planner";

async function readPrivateJson<T>(path: string): Promise<T> {
  if ((await stat(path)).size > 16 * 1024 * 1024) throw new Error("Snapshot size limit exceeded");
  const input = await readFile(path);
  if (input.length > 16 * 1024 * 1024) throw new Error("Snapshot size limit exceeded");
  return JSON.parse(input.toString("utf8")) as T;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--execute")) throw new Error("Live execution is not implemented or authorized");
  if (args.length === 1 && args[0] === "--fixture") {
    const { production, workspace, contracts, decisions } = sharedMergeFixture();
    const plan = prepareSharedMerge(production, workspace, contracts, decisions);
    logger.info({ syntheticDataOnly: true, ...plan.report }, "Shared ETO preparation verification");
    if (!plan.report.preparationValid) process.exitCode = 1;
    return;
  }
  if (args.length !== 6 || args[0] !== "--production" || args[2] !== "--workspace" || args[4] !== "--decisions") {
    throw new Error("Use --fixture or --production FILE --workspace FILE --decisions FILE");
  }
  const [production, workspace, decisions] = await Promise.all([
    readPrivateJson<Snapshot>(args[1]), readPrivateJson<Snapshot>(args[3]), readPrivateJson<Decisions>(args[5]),
  ]);
  const plan = prepareSharedMerge(production, workspace, getMergeContracts(), decisions);
  logger.info(plan.report, "Shared ETO offline preparation report");
  if (!plan.report.preparationValid) process.exitCode = 1;
}

void main().catch(() => {
  // Never log exception text, paths, snapshot rows, auth keys or token payloads.
  logger.error({ code: "SHARED_MERGE_PREPARATION_REJECTED" }, "Shared ETO preparation rejected");
  process.exitCode = 1;
});
