// After enactment: checks that live state matches params.json, and reports consumption for the periodic updates
// promised in the proposal (allowance used, names registered, Bulletin budget left). Read-only. Writes STATE.md.
// Usage: node src/verify.mjs [--proposal <dir>]
import { writeFileSync } from "node:fs";
import { loadProposal, connect, checklist, markdownRows } from "./lib.mjs";
import { enactedChecks } from "./checks.mjs";

const { p, out } = loadProposal();
const c = await connect(p.endpoints, ["assetHub", "people", "bulletin"]);
const list = checklist();
list.info("state read at", `Asset Hub #${c.assetHub.block}, People #${c.people.block}, Bulletin #${c.bulletin.block}`);
await enactedChecks(c, p, list);

const md = [`# State: ${p.title}`, "", "Live state read by `src/verify.mjs`.", "", markdownRows(list.rows), ""];
writeFileSync(out("STATE.md"), md.join("\n"));
console.log(`\n${list.failed() ? "NOT (fully) ENACTED" : "enacted state matches params"}; wrote ${out("STATE.md")}`);
c.close(); process.exit(list.failed() ? 1 : 0);
