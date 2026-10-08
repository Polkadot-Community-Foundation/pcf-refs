import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { ReportLog } from "../src/lib/report.ts";

/** Copies the app-onboarding proposal with fabricated report logs, and runs bundle on it. */
function bundleWith(outcomes: Record<string, ReportLog["outcome"] | undefined>) {
  const root = mkdtempSync(join(tmpdir(), "pcf-refs-test-"));
  const dir = join(root, "app-onboarding");
  cpSync("proposals/app-onboarding", dir, { recursive: true, filter: (src) => !src.includes("/reports") });
  mkdirSync(join(dir, "reports"));
  for (const [command, outcome] of Object.entries(outcomes)) {
    if (!outcome) continue;
    const log: ReportLog = {
      command,
      title: command,
      outcome,
      counts: { pass: 0, fail: 0, info: 0 },
      state: {},
      checks: [],
    };
    writeFileSync(join(dir, "reports", `${command}.json`), JSON.stringify(log));
  }
  return spawnSync(process.execPath, ["src/cli/bundle.ts", "--proposal", dir, "--out", join(root, "dist")], {
    encoding: "utf8",
  });
}

describe("bundle", () => {
  it("refuses a release when a report has failed checks", () => {
    const r = bundleWith({ preflight: "pass", "dry-run": "fail", rehearsal: "pass" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /dry-run has failed checks/);
  });

  it("refuses a release when a report is missing", () => {
    const r = bundleWith({ preflight: "pass", "dry-run": "pass", rehearsal: undefined });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /missing .*rehearsal\.json/);
  });

  it("bundles when every report passed", () => {
    const r = bundleWith({ preflight: "pass", "dry-run": "pass", rehearsal: "pass" });
    assert.equal(r.status, 0, r.stderr);
  });
});
