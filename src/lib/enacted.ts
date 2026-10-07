/**
 * Post-enactment checks: the state the package should leave behind. Shared by `verify` (live chains) and `rehearse`
 * (a fork). They also report consumption, for the periodic updates the proposal promises.
 */
import { BLOCKS_PER_DAY, type Chain } from "./chains.ts";
import { CONTROLLER_ABI, NAME_STATUS, REGISTRAR_ABI, readContract, tokenIdOf, WHITELIST_ABI } from "./dotns.ts";
import { formatCount, sameAddress, toJson, toSs58 } from "./format.ts";
import type { Params } from "./proposal.ts";
import type { Report } from "./report.ts";

export interface EnactedChains {
  assetHub: Chain<"assetHub">;
  people: Chain<"people">;
  bulletin: Chain<"bulletin">;
}

export async function checkEnacted(
  { assetHub: ah, people, bulletin }: EnactedChains,
  p: Params,
  report: Report,
): Promise<void> {
  const attester = toSs58(p.attester);
  const authorizer = toSs58(p.bulletin.authorizer);

  // Allowances: granted, and how much has been used.
  const allowances = [
    ["Asset Hub", await ah.api.query.DotnsGateway.AttestationAllowance.getValue(attester, { at: ah.at })],
    ["People", await people.api.query.PeopleLite.AttestationAllowance.getValue(attester, { at: people.at })],
  ] as const;
  for (const [name, left = 0] of allowances) {
    report.check(
      left > 0,
      `${name} attester allowance granted`,
      `${formatCount(left)} left of ${formatCount(p.count)}, ${formatCount(p.count - left)} used`,
    );
  }

  const dispatcher = await ah.api.query.DotnsGateway.DispatcherAddress.getValue({ at: ah.at });
  report.check(Boolean(dispatcher && sameAddress(dispatcher, p.dispatcher)), "dispatcher set", dispatcher ?? "unset");

  // Names: granted to the names owner, or already registered by it.
  for (const label of p.names) {
    const available = await readContract(ah, p.dotns.registrarController, CONTROLLER_ABI, "available", [label]);
    if (!available) {
      const owner = await readContract(ah, p.dotns.registrar, REGISTRAR_ABI, "ownerOf", [tokenIdOf(label)]);
      report.check(sameAddress(owner, p.namesOwner), `${label}.dot registered to the names owner`, `owner ${owner}`);
      continue;
    }
    const status = NAME_STATUS[await readContract(ah, p.dotns.nameWhitelist, WHITELIST_ABI, "statusOf", [label])];
    const grantee = await readContract(ah, p.dotns.nameWhitelist, WHITELIST_ABI, "granteeOf", [label]);
    report.check(
      status === "Claimed" && sameAddress(grantee, p.namesOwner),
      `${label}.dot granted to the names owner, not yet registered`,
      `status ${status}, grantee ${grantee}`,
    );
  }

  // Bulletin authorizer: registered with the proposed budget.
  const budget = await bulletin.api.query.TransactionStorage.AllowedAuthorizers.getValue(authorizer, {
    at: bulletin.at,
  });
  report.check(Boolean(budget), "Bulletin authorizer registered", budget ? toJson(budget) : authorizer);
  if (budget?.valid_until !== undefined) {
    report.check(
      budget.valid_until === p.bulletin.validUntil,
      "Bulletin authorizer expiry as proposed",
      `#${budget.valid_until}`,
    );
    report.info(
      "Bulletin authorizer expires in",
      `${((budget.valid_until - bulletin.block) / BLOCKS_PER_DAY).toFixed(1)} days`,
    );
  }
}
