/**
 * `npm run bundle`: assembles the release assets of a proposal into `dist/<proposal>/`, with SHA-256 checksums and
 * generated release notes. Run it after `preflight`, `dry-run` and `rehearse`.
 *
 * It refuses to bundle unless calls.json re-encodes byte for byte from params.json and every report passed, so a
 * release can only carry a package whose dry runs all produced the expected outcomes.
 *
 *   --tag <tag>   release tag, shown in the notes
 *   --out <dir>   output folder (default dist)
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { HexString } from "polkadot-api";
import { main, parseCommand } from "../lib/cli.ts";
import { toJson } from "../lib/format.ts";
import { buildPackage, describeRuntimes, type GovernancePackage, readPackage } from "../lib/package.ts";
import { requirePinned } from "../lib/proposal.ts";
import type { ReportLog } from "../lib/report.ts";

/** Reports a release must carry, all with outcome pass. */
const REQUIRED_REPORTS = ["preflight", "dry-run", "rehearsal"] as const;

/** Repository the release notes tell reviewers to clone. */
const REPOSITORY = "https://github.com/Polkadot-Community-Foundation/pcf-refs";

/** Call data published as separate hex files, for pasting into a signer: file, calls.json field, content. */
const CALL_DATA = [
  ["preimage.hex", "refPreimage", "Referendum preimage: `Whitelist.dispatch_whitelisted_call_with_preimage(batch)`"],
  ["inner-call.hex", "rootBatch", "Inner call (`Utility.batch_all`), whose hash the Fellowship whitelists"],
  ["note-preimage.hex", "submission.notePreimage", "`Preimage.note_preimage(preimage)` on Asset Hub"],
  ["referenda-submit.hex", "submission.referendaSubmit", "`Referenda.submit` on Asset Hub, Whitelisted Caller track"],
  ["fellowship-submit.hex", "fellowship.submit", "`FellowshipReferenda.submit` on Collectives, Fellows track"],
] as const;

main(async () => {
  const { proposal, flags } = parseCommand({
    tag: { type: "string", default: "untagged" },
    out: { type: "string", default: "dist" },
  });
  const pkg = readPackage(proposal);
  const name = basename(proposal.dir);

  const fresh = `${toJson(await buildPackage(requirePinned(proposal.params)), 2)}\n`;
  if (fresh !== readFileSync(proposal.path("calls.json"), "utf8")) {
    throw new Error("calls.json does not re-encode from params.json; run npm run encode");
  }
  const logs = REQUIRED_REPORTS.map((report) => {
    const file = join(proposal.reports, `${report}.json`);
    if (!existsSync(file)) throw new Error(`missing ${file}; run the ${report} command first`);
    const log = JSON.parse(readFileSync(file, "utf8")) as ReportLog;
    if (log.outcome !== "pass") throw new Error(`${report} has failed checks; see ${file}`);
    return [report, log] as const;
  });

  const out = join(flags.out, name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "reports"), { recursive: true });
  for (const file of ["params.json", "calls.json", "BREAKDOWN.md"]) copyFileSync(proposal.path(file), join(out, file));
  for (const [file, field] of CALL_DATA) writeFileSync(join(out, file), `${fieldOf(pkg, field)}\n`);
  for (const file of readdirSync(proposal.reports))
    copyFileSync(join(proposal.reports, file), join(out, "reports", file));

  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  writeFileSync(join(out, "RELEASE_NOTES.md"), releaseNotes(flags.tag, name, commit, pkg, logs));
  writeFileSync(join(out, "SHA256SUMS"), checksums(out));
  console.log(`bundled ${name} (${flags.tag}) into ${out}`);
  return 0;
});

function releaseNotes(
  tag: string,
  name: string,
  commit: string,
  pkg: ReturnType<typeof readPackage>,
  logs: (readonly [string, ReportLog])[],
): string {
  const t = pkg.timing;
  const dir = `proposals/${name}`;
  const preflight = logs.find(([report]) => report === "preflight")?.[1].state;
  const utc = preflight?.timingUtc as Record<keyof typeof t, string> | undefined;
  const estimatedFrom = (preflight?.relay as { block?: number } | undefined)?.block;
  const outcomes = logs.map(([report, log]) => {
    const blocks = Object.entries(log.state)
      .filter(([, s]) => typeof (s as { block?: unknown }).block === "number")
      .map(([chain, s]) => `${chain} #${(s as { block: number }).block}`)
      .join(", ");
    return `| ${report} | ${log.outcome.toUpperCase()} | ${log.counts.pass} | ${log.counts.fail} | ${blocks} |`;
  });
  return [
    `# ${pkg.title} (${tag})`,
    "",
    "Call data and dry-run logs for this governance proposal. This repository never signs or dispatches anything on chain: it encodes the calls, dry-runs them against live Polkadot state and a local fork, and logs whether each outcome is the expected one.",
    "",
    `Built from commit \`${commit}\`.`,
    "",
    "## Hashes",
    "",
    "| | Hash | Length |",
    "|---|---|---|",
    `| Inner call, whitelisted by the Fellowship | \`${pkg.rootBatchHash}\` | ${pkg.rootBatchLen} bytes |`,
    `| Referendum preimage, looked up by the Whitelisted Caller referendum | \`${pkg.refPreimageHash}\` | ${pkg.refPreimageLen} bytes |`,
    "",
    ...(pkg.parameters.supersedes.length
      ? [
          `Supersedes ${pkg.parameters.supersedes.map((h) => `\`${h}\``).join(", ")}: the Fellowship referendum removes it from the Asset Hub whitelist in the same batch that whitelists the inner call above.`,
          "",
        ]
      : []),
    `Encoded for runtimes ${describeRuntimes(pkg.runtimes)}.`,
    "",
    "## Timing",
    "",
    `If the Fellowship referendum is proposed, with its decision deposit, before relay block ${t.fellowshipProposedBy}, its whitelist reaches Asset Hub before relay block ${t.enactAt}. The Whitelisted Caller referendum can then enact from relay block ${t.enactAt} until its decision period ends: at that block if it is approved by then, otherwise shortly after its approval.`,
    "",
    `Relay blocks are binding. Dates are estimates at 6 s per block from the preflight run${estimatedFrom ? ` at relay #${estimatedFrom}` : ""}.`,
    "",
    "| | Relay block | Estimated (UTC) |",
    "|---|---|---|",
    `| Fellowship referendum proposed before | ${t.fellowshipProposedBy} | ${utc?.fellowshipProposedBy ?? "n/a"} |`,
    `| Whitelisted Caller referendum can enact from | ${t.enactAt} | ${utc?.enactAt ?? "n/a"} |`,
    "",
    "## Dry-run outcomes",
    "",
    "| Report | Outcome | Passed | Failed | State |",
    "|---|---|---|---|---|",
    ...outcomes,
    "",
    "PASS means every observed outcome is the expected one, including expected errors. Full logs are in `reports/`.",
    "",
    "## Assets",
    "",
    "| File | Content |",
    "|---|---|",
    ...CALL_DATA.map(([file, , what]) => `| \`${file}\` | ${what} |`),
    "| `calls.json` | every encoded call, both hashes and the timing |",
    "| `params.json` | the inputs |",
    "| `BREAKDOWN.md` | the call data decoded against live metadata |",
    "| `reports/` | preflight, dry-run and rehearsal reports (`.md`), logs (`.json`) and console output (`.log`) |",
    "| `SHA256SUMS` | checksums of every file above |",
    "",
    "## Verify",
    "",
    "The published files, then the commit they were built from, then live Polkadot state:",
    "",
    "```sh",
    `tar xzf ${tag.replaceAll("/", "-")}.tar.gz && cd ${name}`,
    "sha256sum -c SHA256SUMS",
    ...CALL_DATA.map(
      ([file, field]) =>
        `test "$(cat ${file})" = "$(node -p 'require("./calls.json").${field}')" && echo "${file} matches calls.json" || echo "${file} DIFFERS from calls.json"`,
    ),
    `git clone ${REPOSITORY} && cd pcf-refs`,
    `git checkout ${commit} && npm ci`,
    `diff ../calls.json ${dir}/calls.json && echo "calls.json matches the commit"`,
    "npm test   # re-encodes calls.json offline and compares byte for byte",
    `npm run decode -- --proposal ${dir} && git diff --exit-code -- ${dir}/BREAKDOWN.md`,
    `npm run preflight -- --proposal ${dir}`,
    `npm run dry-run -- --proposal ${dir}`,
    "```",
    "",
  ].join("\n");
}

/** Value of a dotted `field` of the package, which must be call data. */
function fieldOf(pkg: GovernancePackage, field: string): HexString {
  const value = field.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], pkg);
  if (typeof value !== "string" || !value.startsWith("0x")) throw new Error(`calls.json has no call data at ${field}`);
  return value as HexString;
}

/** `sha256sum`-compatible checksums of every file under `dir`, sorted by path. */
function checksums(dir: string): string {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(dir.length + 1))
    .filter((f) => f !== "SHA256SUMS")
    .sort();
  return files
    .map(
      (f) =>
        `${createHash("sha256")
          .update(readFileSync(join(dir, f)))
          .digest("hex")}  ${f}\n`,
    )
    .join("");
}
