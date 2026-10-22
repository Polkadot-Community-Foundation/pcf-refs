/**
 * Post-enactment checks: the state the package should leave behind. Shared by `verify` (live chains) and `rehearse`
 * (a fork). They also report consumption, for the periodic updates the proposal promises.
 */
import type { HexString } from "polkadot-api";
import type { Chain } from "./chains.ts";
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
  /** Whether each superseded call hash is whitelisted on Asset Hub. */
  superseded: Record<string, boolean>;
}

export async function readTargets({ assetHub: ah, people }: EnactedChains, p: Params): Promise<Targets> {
  const attester = toSs58(p.attester);
  const superseded: Targets["superseded"] = {};
  for (const hash of p.supersedes) superseded[hash] = await isWhitelisted(ah, hash);
  return {
    allowance: {
      assetHub: (await ah.api.query.DotnsGateway.AttestationAllowance.getValue(attester, { at: ah.at })) ?? 0,
      people: (await people.api.query.PeopleLite.AttestationAllowance.getValue(attester, { at: people.at })) ?? 0,
    },
    dispatcher: await ah.api.query.DotnsGateway.DispatcherAddress.getValue({ at: ah.at }),
    superseded,
  };
}

const isWhitelisted = async (ah: Chain<"assetHub">, hash: HexString): Promise<boolean> =>
  (await ah.api.query.Whitelist.WhitelistedCall.getValue(hash, { at: ah.at })) !== undefined;

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
  for (const hash of p.supersedes) {
    report.check(
      before.superseded[hash] === true && after.superseded[hash] === false,
      `superseded call ${hash} went from whitelisted to removed`,
      `${before.superseded[hash]} → ${after.superseded[hash]}`,
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

  for (const hash of p.supersedes) {
    report.check(!(await isWhitelisted(ah, hash)), `superseded call ${hash} no longer whitelisted`);
  }
}
