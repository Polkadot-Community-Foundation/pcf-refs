/**
 * `npm run preflight`: read-only checks of live state before publishing or submitting. Writes PREFLIGHT.md.
 *
 * - the live runtimes are the ones calls.json was encoded for
 * - the targets are empty: allowances, dispatcher, Bulletin authorizer; the names are Open and unregistered
 * - the addresses are what params.json says: contracts deployed (with code hashes), names owner mapped to its account
 * - the XCM routes from Asset Hub to People and Bulletin are open
 * - the deadlines are still reachable, and the governance state of the package (whitelisted, preimage noted)
 *
 * It also lists the proxies and balances of every account involved, for the forum post.
 */
import type { SS58String } from "polkadot-api";
import { BLOCKS_PER_DAY, type Chain, connect, PARA } from "../lib/chains.ts";
import { main, parseCommand } from "../lib/cli.ts";
import {
  CONTROLLER_ABI,
  codeHashOf,
  implementationOf,
  NAME_STATUS,
  readContract,
  WHITELIST_ABI,
} from "../lib/dotns.ts";
import { formatDot, toJson, toSs58 } from "../lib/format.ts";
import { readPackage } from "../lib/package.ts";
import { Report } from "../lib/report.ts";

main(async () => {
  const { proposal } = parseCommand({});
  const p = proposal.params;
  const pkg = readPackage(proposal);
  const chains = await connect(p.endpoints, ["relay", "assetHub", "people", "bulletin", "collectives"]);
  const { relay, assetHub: ah, people, bulletin } = chains;
  const report = new Report();
  const attester = toSs58(p.attester);
  const authorizer = toSs58(p.bulletin.authorizer);
  const daysFromNow = (block: number, now: number) => `${((block - now) / BLOCKS_PER_DAY).toFixed(1)} days from now`;

  try {
    report.info(
      "state read at",
      `relay #${relay.block}, Asset Hub #${ah.block}, People #${people.block}, Bulletin #${bulletin.block}`,
    );

    // Runtimes: the published bytes are only valid for these.
    for (const key of ["assetHub", "people", "bulletin", "collectives"] as const) {
      const live = chains[key].spec;
      report.check(
        live === pkg.runtimes[key],
        `${key} runtime unchanged since encoding`,
        `live ${live}, encoded ${pkg.runtimes[key]}`,
      );
    }

    // Targets are empty.
    const ahAllowance = await ah.api.query.DotnsGateway.AttestationAllowance.getValue(attester, { at: ah.at });
    report.check(!ahAllowance, "Asset Hub attester allowance is empty", `${attester}: ${ahAllowance ?? 0}`);
    const peopleAllowance = await people.api.query.PeopleLite.AttestationAllowance.getValue(attester, {
      at: people.at,
    });
    report.check(!peopleAllowance, "People attester allowance is empty", `${peopleAllowance ?? 0}`);
    const dispatcherNow = await ah.api.query.DotnsGateway.DispatcherAddress.getValue({ at: ah.at });
    report.info("Asset Hub DotnsGateway dispatcher today", dispatcherNow ?? "unset");

    // Contracts are deployed; code hashes let anyone compare with the release.
    const dispatcherCode = await codeHashOf(ah, p.dispatcher);
    report.check(Boolean(dispatcherCode), "dispatcher is a contract", `${p.dispatcher} code hash ${dispatcherCode}`);
    const implementation = await implementationOf(ah, p.dispatcher);
    if (implementation) {
      report.info(
        "dispatcher ERC-1967 implementation",
        `${implementation} code hash ${await codeHashOf(ah, implementation)}`,
      );
    }
    report.check(
      Boolean(await codeHashOf(ah, p.dotns.nameWhitelist)),
      "DotnsNameWhitelist is a contract",
      p.dotns.nameWhitelist,
    );

    // Names: Open on the whitelist, unregistered, within one grant batch.
    const maxBatch = await readContract(ah, p.dotns.nameWhitelist, WHITELIST_ABI, "maxGrantBatch", []);
    report.check(p.names.length <= maxBatch, "grant batch within maxGrantBatch", `${p.names.length} ≤ ${maxBatch}`);
    for (const label of p.names) {
      const status = NAME_STATUS[await readContract(ah, p.dotns.nameWhitelist, WHITELIST_ABI, "statusOf", [label])];
      const available = await readContract(ah, p.dotns.registrarController, CONTROLLER_ABI, "available", [label]);
      report.check(
        status === "Open" && available,
        `${label}.dot is Open on the whitelist and unregistered`,
        `status ${status}, available ${available}`,
      );
    }

    // Accounts: who controls each of them.
    const namesOwnerAccount = await ah.api.query.Revive.OriginalAccount.getValue(p.namesOwner, { at: ah.at });
    report.check(
      Boolean(namesOwnerAccount),
      "names owner H160 is a mapped substrate account",
      namesOwnerAccount ? `${p.namesOwner} → ${namesOwnerAccount}` : `${p.namesOwner} unmapped`,
    );
    if (namesOwnerAccount) report.info("names owner proxies (Asset Hub)", await proxiesOf(ah, namesOwnerAccount));
    report.info("attester proxies (Asset Hub)", await proxiesOf(ah, attester));
    report.info("attester proxies (People)", await proxiesOf(people, attester));
    report.info("authorizer proxies (Asset Hub)", await proxiesOf(ah, authorizer));
    report.info(
      "attester free balance",
      `Asset Hub ${await freeOf(ah, attester)}, People ${await freeOf(people, attester)}`,
    );
    report.info(
      "authorizer free balance",
      `Asset Hub ${await freeOf(ah, authorizer)}, Bulletin ${await freeOf(bulletin, authorizer)}`,
    );

    // Bulletin: authorizer not registered yet, expiry ahead.
    const existing = await bulletin.api.query.TransactionStorage.AllowedAuthorizers.getValue(authorizer, {
      at: bulletin.at,
    });
    report.check(!existing, "Bulletin authorizer not yet registered", existing ? toJson(existing) : authorizer);
    const registered = await bulletin.api.query.TransactionStorage.AllowedAuthorizers.getEntries({ at: bulletin.at });
    report.info("Bulletin authorizers registered today", String(registered.length));
    const validUntil = pkg.parameters.bulletinBudget.validUntil;
    report.check(
      validUntil > bulletin.block,
      "Bulletin validUntil is in the future",
      `#${validUntil}, ${daysFromNow(validUntil, bulletin.block)}`,
    );

    // XCM routes.
    for (const [name, recipient] of [
      ["People", PARA.people],
      ["Bulletin", PARA.bulletin],
    ] as const) {
      const channel = await relay.api.query.Hrmp.HrmpChannels.getValue(
        { sender: PARA.assetHub, recipient },
        { at: relay.at },
      );
      report.check(
        Boolean(channel),
        `HRMP channel Asset Hub → ${name} open`,
        channel ? `max message ${channel.max_message_size} B` : "missing",
      );
    }

    // Governance state of this package, and deadlines.
    const whitelisted = await ah.api.query.Whitelist.WhitelistedCall.getValue(pkg.rootBatchHash, { at: ah.at });
    report.info("inner call whitelisted on Asset Hub", whitelisted === undefined ? "not yet" : "yes");
    const preimage = await ah.api.query.Preimage.RequestStatusFor.getValue(pkg.refPreimageHash, { at: ah.at });
    report.info("referendum preimage noted on Asset Hub", preimage ? preimage.type : "not yet");
    const d = pkg.deadlines;
    report.check(
      d.fellowshipSubmitBy > relay.block,
      "Fellowship submission deadline not passed",
      `relay #${d.fellowshipSubmitBy}, ${daysFromNow(d.fellowshipSubmitBy, relay.block)}`,
    );
    report.check(
      d.enactAt > relay.block,
      "enactment block in the future",
      `relay #${d.enactAt}, ${daysFromNow(d.enactAt, relay.block)}`,
    );

    // Deposits the submitter needs.
    const tracks: TrackInfo[] = await ah.api.constants.Referenda.Tracks();
    const track = tracks.find(([, t]) => t.name.replace(/\0+$/, "") === "whitelisted_caller");
    const submissionDeposit = await ah.api.constants.Referenda.SubmissionDeposit();
    if (track) {
      report.info(
        "Whitelisted Caller track",
        `id ${track[0]}, decision deposit ${formatDot(track[1].decision_deposit)}, submission deposit ${formatDot(submissionDeposit)}`,
      );
    }
  } finally {
    chains.close();
  }

  report.write(
    proposal.path("PREFLIGHT.md"),
    `Preflight: ${p.title}`,
    "Read-only checks by `src/cli/preflight.ts` against live Polkadot state.",
  );
  console.log(`\n${report.failed ? "PREFLIGHT FAILED" : "preflight green"}; wrote ${proposal.path("PREFLIGHT.md")}`);
  return report.failed ? 1 : 0;
});

type TrackInfo = [id: number, track: { name: string; decision_deposit: bigint }];
type ProxyDefinition = { delegate: SS58String; proxy_type: { type: string }; delay: number };

/** Delegates of `account`, as `delegate type delay` entries. */
async function proxiesOf(chain: Chain<"assetHub"> | Chain<"people">, account: SS58String): Promise<string> {
  // The two chains define different ProxyType enums; only the variant name is read.
  const [delegates]: [ProxyDefinition[], bigint] = await chain.api.query.Proxy.Proxies.getValue(account, {
    at: chain.at,
  });
  return delegates.map((d) => `${d.delegate} ${d.proxy_type.type} delay ${d.delay}`).join("; ") || "none";
}

async function freeOf(
  chain: Chain<"assetHub"> | Chain<"people"> | Chain<"bulletin">,
  account: SS58String,
): Promise<string> {
  const { data } = await chain.api.query.System.Account.getValue(account, { at: chain.at });
  return formatDot(data.free);
}
