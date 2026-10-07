/**
 * `npm run verify`: after enactment, checks live state against params.json and reports allowance used, names
 * registered and the Bulletin budget, for the periodic updates. Read-only. Writes STATE.md.
 */
import { connect } from "../lib/chains.ts";
import { main, parseCommand } from "../lib/cli.ts";
import { checkEnacted } from "../lib/enacted.ts";
import { Report } from "../lib/report.ts";

main(async () => {
  const { proposal } = parseCommand({});
  const p = proposal.params;
  const chains = await connect(p.endpoints, ["assetHub", "people", "bulletin"]);
  const report = new Report();
  try {
    report.info(
      "state read at",
      `Asset Hub #${chains.assetHub.block}, People #${chains.people.block}, Bulletin #${chains.bulletin.block}`,
    );
    await checkEnacted(chains, p, report);
  } finally {
    chains.close();
  }
  report.write(proposal.path("STATE.md"), `State: ${p.title}`, "Live state read by `src/cli/verify.ts`.");
  console.log(
    `\n${report.failed ? "NOT (fully) ENACTED" : "enacted state matches params"}; wrote ${proposal.path("STATE.md")}`,
  );
  return report.failed ? 1 : 0;
});
