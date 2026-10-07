/**
 * Shared command-line plumbing: flag parsing and a `main` wrapper that turns errors and failed checks into exit codes.
 */
import { type ParseArgsOptionsConfig, parseArgs } from "node:util";
import { DEFAULT_PROPOSAL, loadProposal, type Proposal } from "./proposal.ts";

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
