/**
 * Shared command-line plumbing: flag parsing and a `main` wrapper that turns errors and failed checks into exit codes.
 */
import { type ParseArgsOptionsConfig, parseArgs } from "node:util";
import { DEFAULT_PROPOSAL, loadProposal, type Proposal } from "./proposal.ts";
import type { Report, ReportMeta } from "./report.ts";

const COMMON = { proposal: { type: "string", default: DEFAULT_PROPOSAL } } as const;

/** Parses `--proposal <dir>` plus the command's own flags, and loads the proposal. */
export function parseCommand<const O extends ParseArgsOptionsConfig>(options: O) {
  const config = {
    options: { ...COMMON, ...options } as typeof COMMON & O,
    strict: true,
    allowPositionals: false,
  } as const;
  const { values } = parseArgs(config);
  // Generic parse results stay unresolved inside this function; the common flag is always a string.
  const proposal: Proposal = loadProposal((values as { proposal: string }).proposal);
  return { proposal, flags: values };
}

/** Runs a command; its return value is the exit code. Uncaught errors exit with 1. */
export function main(command: () => Promise<number>): void {
  command().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}

/** Writes a command's report into the proposal's reports folder, prints the outcome and returns the exit code. */
export function finish(report: Report, proposal: Proposal, name: string, meta: ReportMeta): number {
  const path = report.write(proposal.reports, name, meta);
  console.log(`\n${meta.command}: ${report.failed ? "FAILED" : "all checks as expected"}; wrote ${path}`);
  return report.failed ? 1 : 0;
}
