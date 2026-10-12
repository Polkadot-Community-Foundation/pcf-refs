/**
 * `npm run rehearse`: runs the whole governance sequence on a Chopsticks fork of live Asset Hub, People and Collectives,
 * connected over XCM. Writes reports/rehearsal.{md,json}.
 *
 * 1. The Fellowship referendum enacts on Collectives (scheduled with the Fellows origin) and whitelists the call on
 *    Asset Hub.
 * 2. The Whitelisted Caller referendum enacts on Asset Hub: the preimage is noted and the call is scheduled by Lookup
 *    with the WhitelistedCaller origin, as Referenda does at `At(enactAt)`. Asset Hub sends one XCM, to People.
 * 3. People receives and executes it.
 * 4. The post-enactment checks of `verify` run on the forked state.
 *
 * Voting is not simulated. Chopsticks runs each chain's real runtime on live state, but no collators and no relay
 * inclusion.
 *
 *   --port-base <n>   first local port (default 8100; three are used)
 *   --keep            leave the fork running afterwards
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Bytes } from "@polkadot-api/substrate-bindings";
import type { HexString } from "polkadot-api";
import { type Chain, type Chains, connect, PARA, stateOf } from "../lib/chains.ts";
import { devRpc, Fork } from "../lib/chopsticks.ts";
import { finish, main, parseCommand } from "../lib/cli.ts";
import { checkEnacted, checkTransition, readTargets } from "../lib/enacted.ts";
import { eventNames, findEvents, notableEvents, type RuntimeEvent } from "../lib/events.ts";
import { fromHex, toHex, toJson } from "../lib/format.ts";
import { type GovernancePackage, readPackage } from "../lib/package.ts";
import { Report } from "../lib/report.ts";
import { siblingLocation } from "../lib/xcm.ts";

const FORKED = ["assetHub", "people", "collectives"] as const;
type ForkedChains = Chains<(typeof FORKED)[number]>;
/** Blocks to wait for an XCM to be delivered and executed. */
const DELIVERY_BLOCKS = 3;

main(async () => {
  const { proposal, flags } = parseCommand({
    "port-base": { type: "string", default: "8100" },
    keep: { type: "boolean", default: false },
  });
  const p = proposal.params;
  const pkg = readPackage(proposal);
  const report = new Report();

  console.log("starting chopsticks (forking live state, takes a minute)…");
  mkdirSync(proposal.reports, { recursive: true });
  const fork = await Fork.start(
    p.endpoints,
    FORKED,
    Number(flags["port-base"]),
    join(proposal.reports, "chopsticks.log"),
  );
  const connections: ForkedChains[] = [];
  let forkedAt: Record<string, unknown> = {};
  try {
    const live = await connect(fork.endpoints, FORKED);
    connections.push(live);
    forkedAt = stateOf(live);
    // Chopsticks builds catch-up blocks right after connecting the chains, and storage set during one of them is
    // lost. newBlock queues behind them, so one block per chain settles the forks before anything is injected.
    await Promise.all(FORKED.map((k) => devRpc(live[k].client).newBlock()));

    const before = await readTargets(live, p);
    await enactFellowshipReferendum(live, pkg, report);
    const peopleBefore = await headNumber(live.people);
    await enactWhitelistedCallerReferendum(live, pkg, report);
    await expectDelivery(live.people, peopleBefore, "PeopleLite", "AttestationAllowanceIncreased", report);

    // A second connection pins every read to the post-enactment head. The first one stays open until the end: its
    // clients may still be fetching runtimes for the blocks just built.
    const enacted = await connect(fork.endpoints, FORKED);
    connections.push(enacted);
    checkTransition(before, await readTargets(enacted, p), p, report);
    await checkEnacted(enacted, p, report);
  } catch (error) {
    report.check(
      false,
      "rehearsal ran to completion",
      error instanceof Error ? error.message.split("\n")[0] : String(error),
    );
  } finally {
    for (const chains of connections) chains.close();
    if (!flags.keep) fork.stop();
  }

  return finish(report, proposal, "rehearsal", {
    command: "rehearse",
    title: `Rehearsal (Chopsticks): ${p.title}`,
    intro: [
      "End-to-end probe by `src/cli/rehearse.ts` on a local Chopsticks fork of live Asset Hub, People and Collectives; nothing reaches the live chains. The Fellowship referendum and the Whitelisted Caller referendum are enacted through the scheduler with their real origins; voting is not simulated.",
      `Inner call hash \`${pkg.rootBatchHash}\`, preimage hash \`${pkg.refPreimageHash}\`.`,
    ],
    state: forkedAt,
  });
});

/** Step 1: schedule the Fellowship proposal with the Fellows origin, then let Asset Hub receive the whitelist. */
async function enactFellowshipReferendum(chains: ForkedChains, pkg: GovernancePackage, report: Report): Promise<void> {
  const { collectives, assetHub } = chains;
  const dev = devRpc(collectives.client);
  await dev.setStorage({
    Scheduler: {
      Agenda: [
        [
          [await nextAgendaBlock(collectives)],
          [{ call: { Inline: pkg.fellowship.xcmToAssetHub }, origin: { FellowshipOrigins: "Fellows" } }],
        ],
      ],
    },
  });
  await dev.newBlock();
  const events = await eventsAt(collectives, await dev.blockHash());
  report.check(
    eventNames(events).includes("PolkadotXcm.Sent"),
    "Collectives: Fellowship proposal enacted, XCM sent to Asset Hub",
    notableEvents(events).join(", "),
  );

  const ahDev = devRpc(assetHub.client);
  let whitelisted = false;
  for (let i = 0; i < DELIVERY_BLOCKS && !whitelisted; i++) {
    await ahDev.newBlock();
    const at = await ahDev.blockHash();
    whitelisted =
      (await assetHub.api.query.Whitelist.WhitelistedCall.getValue(pkg.rootBatchHash, { at })) !== undefined;
  }
  report.check(whitelisted, "Asset Hub: inner call hash whitelisted", pkg.rootBatchHash);
}

/** Step 2: note the preimage and schedule it by Lookup with the WhitelistedCaller origin, as Referenda does. */
async function enactWhitelistedCallerReferendum(
  chains: ForkedChains,
  pkg: GovernancePackage,
  report: Report,
): Promise<void> {
  const { assetHub } = chains;
  const dev = devRpc(assetHub.client);
  const lookup = { hash: pkg.refPreimageHash, len: pkg.refPreimageLen };
  await dev.setStorage({
    Preimage: {
      PreimageFor: [[[[lookup.hash, lookup.len]], toHex(Bytes().enc(fromHex(pkg.refPreimage)))]],
      RequestStatusFor: [[[lookup.hash], { Requested: { maybeTicket: null, count: 1, maybeLen: lookup.len } }]],
    },
    Scheduler: {
      Agenda: [
        [[await nextAgendaBlock(assetHub)], [{ call: { Lookup: lookup }, origin: { Origins: "WhitelistedCaller" } }]],
      ],
    },
  });
  await dev.newBlock();
  const events = await eventsAt(assetHub, await dev.blockHash());
  const scheduled = findEvents<{ result: { success: boolean } }>(events, "Scheduler", "Dispatched")[0];
  report.check(
    Boolean(scheduled?.result.success),
    "Asset Hub: referendum enacted with WhitelistedCaller",
    toJson(scheduled?.result ?? eventNames(events)),
  );
  const dispatched = findEvents<{ result: { success: boolean } }>(events, "Whitelist", "WhitelistedCallDispatched")[0];
  report.check(Boolean(dispatched), "Asset Hub: Whitelist.WhitelistedCallDispatched");
  if (dispatched)
    report.check(
      dispatched.result.success,
      "Asset Hub: inner batch succeeded inside the whitelisted dispatch",
      toJson(dispatched.result),
    );
  const sent = findEvents<{ destination: unknown }>(events, "PolkadotXcm", "Sent").map((e) => e.destination);
  report.check(
    sent.length === 1 && isDeepStrictEqual(sent[0], siblingLocation(PARA.people).value),
    "Asset Hub: one XCM sent, to People",
    toJson(sent),
  );
  report.info("Asset Hub events", notableEvents(events).join(", "));
}

/** Step 3: build blocks on `chain` until `pallet.event` appears. Chopsticks may build the receiving block itself, so
 * every block after `since` is scanned. */
async function expectDelivery(
  chain: Chain<"people">,
  since: number,
  pallet: string,
  event: string,
  report: Report,
): Promise<void> {
  const dev = devRpc(chain.client);
  let seenAt: number | undefined;
  for (let i = 0; i < DELIVERY_BLOCKS && seenAt === undefined; i++) {
    await dev.newBlock();
    const head = await headNumber(chain);
    for (let n = since + 1; n <= head && seenAt === undefined; n++) {
      if (eventNames(await eventsAt(chain, await dev.blockHash(n))).includes(`${pallet}.${event}`)) seenAt = n;
    }
  }
  report.check(
    seenAt !== undefined,
    `${chain.key}: ${pallet}.${event} after XCM delivery`,
    seenAt === undefined ? "not seen" : `block #${seenAt}`,
  );
}

type AnyChain = Chain<(typeof FORKED)[number]>;

async function eventsAt(chain: AnyChain, at: HexString): Promise<RuntimeEvent[]> {
  const records: { event: RuntimeEvent }[] = await (chain as Chain<"assetHub">).api.query.System.Events.getValue({
    at,
  });
  return records.map((r) => r.event);
}

async function headNumber(chain: AnyChain): Promise<number> {
  const at = await devRpc(chain.client).blockHash();
  return (chain as Chain<"assetHub">).api.query.System.Number.getValue({ at });
}

/**
 * Next block the scheduler will service. Its agenda is keyed by the local block number on some runtimes and by the
 * relay block number on others (Asset Hub); `IncompleteSince` tells which.
 */
async function nextAgendaBlock(chain: Chain<"assetHub"> | Chain<"collectives">): Promise<number> {
  const at = await devRpc(chain.client).blockHash();
  const api = (chain as Chain<"assetHub">).api;
  const [since, relay, local] = await Promise.all([
    api.query.Scheduler.IncompleteSince.getValue({ at }),
    api.query.ParachainSystem.LastRelayChainBlockNumber.getValue({ at }),
    api.query.System.Number.getValue({ at }),
  ]);
  const relayBased = since !== undefined && Math.abs(since - relay) < Math.abs(since - local);
  return (relayBased ? relay : local) + 1;
}
