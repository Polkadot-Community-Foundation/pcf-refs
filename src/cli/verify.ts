/**
 * `npm run verify`: after enactment, checks live state against params.json and reports allowance used, names
 * registered and the Bulletin budget, for the periodic updates. Read-only. Writes reports/state.{md,json}.
 */
import { connect, describeState, stateOf } from "../lib/chains.ts";
import { finish, main, parseCommand } from "../lib/cli.ts";
import { checkEnacted } from "../lib/enacted.ts";
import { Report } from "../lib/report.ts";

main(async () => {
  const { proposal } = parseCommand({});
  const p = proposal.params;
  const chains = await connect(p.endpoints, ["assetHub", "people", "bulletin"]);
  const report = new Report();
  try {
    await checkEnacted(chains, p, report);
  } finally {
    chains.close();
  }
  return finish(report, proposal, "state", {
    command: "verify",
    title: `State after enactment: ${p.title}`,
    intro: [`Live state read by \`src/cli/verify.ts\`. State: ${describeState(chains)}.`],
    state: stateOf(chains),
  });
});
