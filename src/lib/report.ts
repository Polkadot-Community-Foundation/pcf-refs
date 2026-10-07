/**
 * Collects the checks of a command, prints each as it happens, and renders them as a Markdown report.
 */
import { writeFileSync } from "node:fs";

interface Row {
  /** true = pass, false = fail, null = information only. */
  ok: boolean | null;
  label: string;
  detail: string;
}

export class Report {
  readonly rows: Row[] = [];

  /** Records a check and returns its outcome. */
  check(ok: boolean, label: string, detail = ""): boolean {
    this.add({ ok, label, detail });
    return ok;
  }

  info(label: string, detail = ""): void {
    this.add({ ok: null, label, detail });
  }

  get failed(): boolean {
    return this.rows.some((r) => r.ok === false);
  }

  /** Writes `# title`, the intro paragraphs and the table of checks to `path`. */
  write(path: string, title: string, ...intro: string[]): void {
    const md = [`# ${title}`, "", ...intro.flatMap((p) => [p, ""]), this.table(), ""];
    writeFileSync(path, md.join("\n"));
  }

  private add(row: Row): void {
    this.rows.push(row);
    const tag = row.ok === null ? "info" : row.ok ? "PASS" : "FAIL";
    console.log(`${tag}  ${row.label}${row.detail ? `  (${row.detail})` : ""}`);
  }

  private table(): string {
    const mark = (ok: boolean | null) => (ok === null ? "·" : ok ? "✅" : "❌");
    const cell = (s: string) => s.replaceAll("|", "\\|");
    return [
      "| | Check | Detail |",
      "|---|---|---|",
      ...this.rows.map((r) => `| ${mark(r.ok)} | ${cell(r.label)} | ${cell(r.detail)} |`),
    ].join("\n");
  }
}
