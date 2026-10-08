/**
 * Collects the checks of a command, prints each as it happens, and writes them as a Markdown report and a JSON log.
 *
 * Every check states an expected outcome. PASS means the observed outcome is the expected one, which may be an
 * expected error (a referendum that must fail until its whitelist lands, for instance). FAIL means it is not.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toJson } from "./format.ts";

export type Outcome = "pass" | "fail" | "info";

export interface Row {
  outcome: Outcome;
  /** The expectation, phrased as what must hold. */
  check: string;
  /** What was observed. */
  detail: string;
}

/** Contents of a `<name>.json` log. */
export interface ReportLog {
  command: string;
  title: string;
  /** Overall result: pass when no check failed. */
  outcome: "pass" | "fail";
  counts: Record<Outcome, number>;
  /** Chain state the checks ran against, e.g. block numbers and hashes. */
  state: Record<string, unknown>;
  checks: Row[];
}

export interface ReportMeta {
  command: string;
  title: string;
  /** Paragraphs shown above the table in the Markdown report. */
  intro: string[];
  state?: Record<string, unknown>;
}

export class Report {
  readonly rows: Row[] = [];

  /** Records a check and returns whether it passed. */
  check(ok: boolean, check: string, detail = ""): boolean {
    this.add({ outcome: ok ? "pass" : "fail", check, detail });
    return ok;
  }

  info(check: string, detail = ""): void {
    this.add({ outcome: "info", check, detail });
  }

  get failed(): boolean {
    return this.rows.some((r) => r.outcome === "fail");
  }

  /** Writes `<dir>/<name>.md` and `<dir>/<name>.json`, and returns the Markdown path. */
  write(dir: string, name: string, meta: ReportMeta): string {
    mkdirSync(dir, { recursive: true });
    const counts: Record<Outcome, number> = { pass: 0, fail: 0, info: 0 };
    for (const r of this.rows) counts[r.outcome]++;
    const log: ReportLog = {
      command: meta.command,
      title: meta.title,
      outcome: this.failed ? "fail" : "pass",
      counts,
      state: meta.state ?? {},
      checks: this.rows,
    };
    writeFileSync(join(dir, `${name}.json`), `${toJson(log, 2)}\n`);

    const summary = `**Outcome: ${log.outcome.toUpperCase()}**, ${counts.pass} passed, ${counts.fail} failed, ${counts.info} informational.`;
    const md = [`# ${meta.title}`, "", ...meta.intro.flatMap((p) => [p, ""]), summary, "", this.table(), ""];
    const path = join(dir, `${name}.md`);
    writeFileSync(path, md.join("\n"));
    return path;
  }

  private add(row: Row): void {
    this.rows.push(row);
    const tag = row.outcome === "info" ? "info" : row.outcome.toUpperCase();
    console.log(`${tag}  ${row.check}${row.detail ? `  (${row.detail})` : ""}`);
  }

  private table(): string {
    const mark: Record<Outcome, string> = { pass: "✅", fail: "❌", info: "·" };
    const cell = (s: string) => s.replaceAll("|", "\\|");
    return [
      "| | Check | Observed |",
      "|---|---|---|",
      ...this.rows.map((r) => `| ${mark[r.outcome]} | ${cell(r.check)} | ${cell(r.detail)} |`),
    ].join("\n");
  }
}
