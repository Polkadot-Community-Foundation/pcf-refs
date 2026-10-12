/**
 * Post-enactment checks: the state the package should leave behind. Shared by `verify` (live chains) and `rehearse`
 * (a fork). They also report consumption, for the periodic updates the proposal promises.
 */
import type { Chain } from "./chains.ts";
import { CONTROLLER_ABI, NAME_STATUS, REGISTRAR_ABI, readContract, tokenIdOf, WHITELIST_ABI } from "./dotns.ts";
import { formatCount, sameAddress, toSs58 } from "./format.ts";
import type { Params } from "./proposal.ts";
import type { Report } from "./report.ts";

export interface EnactedChains {
  assetHub: Chain<"assetHub">;
  people: Chain<"people">;
}

/** What the package changes, read at the chains' pinned blocks. */
export interface Targets {
  allowance: { assetHub: number; people: number };
  dispatcher: string | undefined;
  names: Record<string, { status: string; grantee: string; available: boolean }>;
}

export async function readTargets({ assetHub: ah, people }: EnactedChains, p: Params): Promise<Targets> {
  const attester = toSs58(p.attester);
  const names: Targets["names"] = {};
  for (const label of p.names) {
    names[label] = {
      status: nameStatus(await readContract(ah, p.dotns.nameWhitelist, WHITELIST_ABI, "statusOf", [label])),
      grantee: await readContract(ah, p.dotns.nameWhitelist, WHITELIST_ABI, "granteeOf", [label]),
      available: await readContract(ah, p.dotns.registrarController, CONTROLLER_ABI, "available", [label]),
    };
  }
  return {
    allowance: {
      assetHub: (await ah.api.query.DotnsGateway.AttestationAllowance.getValue(attester, { at: ah.at })) ?? 0,
      people: (await people.api.query.PeopleLite.AttestationAllowance.getValue(attester, { at: people.at })) ?? 0,
    },
    dispatcher: await ah.api.query.DotnsGateway.DispatcherAddress.getValue({ at: ah.at }),
    names,
  };
}

const nameStatus = (ordinal: number): string => NAME_STATUS[ordinal] ?? `unknown status ${ordinal}`;

/** Checks that enactment changed exactly what the package grants, from `before` to `after`. */
export function checkTransition(before: Targets, after: Targets, p: Params, report: Report): void {
  for (const [key, name] of [
    ["assetHub", "Asset Hub"],
    ["people", "People"],
  ] as const) {
    report.check(
      after.allowance[key] === before.allowance[key] + p.count,
      `${name} attester allowance increased by exactly ${formatCount(p.count)}`,
      `${formatCount(before.allowance[key])} → ${formatCount(after.allowance[key])}`,
    );
  }
  report.check(
    Boolean(after.dispatcher && sameAddress(after.dispatcher, p.dispatcher)),
    "dispatcher changed to the proposed address",
    `${before.dispatcher ?? "unset"} → ${after.dispatcher ?? "unset"}`,
  );
  for (const label of p.names) {
    const [b, a] = [before.names[label], after.names[label]];
    report.check(
      b?.status === "Open" &&
        b.available &&
        a?.status === "Claimed" &&
        sameAddress(a.grantee, p.namesOwner) &&
        a.available,
      `${label}.dot went from Open to granted to the names owner, still unregistered`,
      `status ${b?.status} → ${a?.status}, grantee ${b?.grantee} → ${a?.grantee}`,
    );
  }
}

export async function checkEnacted({ assetHub: ah, people }: EnactedChains, p: Params, report: Report): Promise<void> {
  const attester = toSs58(p.attester);

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
}
