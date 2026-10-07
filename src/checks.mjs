// State checks shared by verify (live chain, after enactment) and rehearse (forked chain).
import { decodeFunctionResult, encodeFunctionData, namehash } from "viem";
import { ethCall, json, hex, ss58, WHITELIST_ABI, CONTROLLER_ABI, REGISTRAR_ABI, NAME_STATUS, DAY } from "./lib.mjs";

export async function enactedChecks({ assetHub: ah, people, bulletin }, p, { check, info }) {
  const q = (chain, pallet, item, ...keys) => chain.api.query[pallet][item].getValue(...keys, { at: chain.at });
  const call = async (to, abi, functionName, args = []) =>
    decodeFunctionResult({ abi, functionName, data: await ethCall(ah, to, encodeFunctionData({ abi, functionName, args })) });
  const attester = ss58(p.attester), authorizer = ss58(p.bulletin.authorizer);

  for (const [name, chain, pallet] of [["Asset Hub", ah, "DotnsGateway"], ["People", people, "PeopleLite"]]) {
    const left = Number(await q(chain, pallet, "AttestationAllowance", attester) ?? 0);
    check(left > 0, `${name} attester allowance granted`,
      `${left.toLocaleString("en-US")} left of ${p.count.toLocaleString("en-US")}, ${(p.count - left).toLocaleString("en-US")} used`);
  }

  const dispatcher = await q(ah, "DotnsGateway", "DispatcherAddress");
  check(Boolean(dispatcher) && hex(dispatcher).toLowerCase() === p.dispatcher.toLowerCase(), "dispatcher set", dispatcher ? hex(dispatcher) : "unset");

  for (const label of p.names) {
    const status = NAME_STATUS[await call(p.dotns.nameWhitelist, WHITELIST_ABI, "statusOf", [label])];
    const available = await call(p.dotns.registrarController, CONTROLLER_ABI, "available", [label]);
    if (!available) {
      const owner = await call(p.dotns.registrar, REGISTRAR_ABI, "ownerOf", [BigInt(namehash(`${label}.dot`))]);
      check(owner.toLowerCase() === p.namesOwner.toLowerCase(), `${label}.dot registered to the names owner`, `owner ${owner}`);
      continue;
    }
    const grantee = await call(p.dotns.nameWhitelist, WHITELIST_ABI, "granteeOf", [label]);
    check(status === "Claimed" && grantee.toLowerCase() === p.namesOwner.toLowerCase(),
      `${label}.dot granted to the names owner, not yet registered`, `status ${status}, grantee ${grantee}`);
  }

  const budget = await q(bulletin, "TransactionStorage", "AllowedAuthorizers", authorizer);
  check(Boolean(budget), "Bulletin authorizer registered", budget ? json(budget) : authorizer);
  if (budget?.valid_until != null) {
    check(budget.valid_until === p.bulletin.validUntil, "Bulletin authorizer expiry as proposed", `#${budget.valid_until}`);
    info("Bulletin authorizer expires in", `${((budget.valid_until - bulletin.block) / DAY).toFixed(1)} days`);
  }
}
