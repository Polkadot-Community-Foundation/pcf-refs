import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Report, type ReportLog } from "../src/lib/report.ts";

describe("Report", () => {
  it("writes a Markdown report and a JSON log with the overall outcome", () => {
    const report = new Report();
    report.check(true, "expected success", "ok");
    report.check(false, "expected error", "got success");
    report.info("context", "a | b");
    const dir = mkdtempSync(join(tmpdir(), "pcf-refs-test-"));
    report.write(dir, "dry-run", { command: "dry-run", title: "Dry run", intro: ["Intro."], state: { assetHub: 1 } });

    const log = JSON.parse(readFileSync(join(dir, "dry-run.json"), "utf8")) as ReportLog;
    assert.equal(log.outcome, "fail");
    assert.deepEqual(log.counts, { pass: 1, fail: 1, info: 1 });
    assert.deepEqual(log.state, { assetHub: 1 });
    assert.equal(log.checks[1]?.outcome, "fail");

    const md = readFileSync(join(dir, "dry-run.md"), "utf8");
    assert.match(md, /\*\*Outcome: FAIL\*\*, 1 passed, 1 failed, 1 informational\./);
    assert.match(md, /\| ❌ \| expected error \| got success \|/);
    assert.match(md, /a \\\| b/, "pipes in cells are escaped");
  });
});
