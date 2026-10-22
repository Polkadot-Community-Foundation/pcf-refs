/**
 * `npm run preflight`: read-only checks of live state before publishing. Writes reports/preflight.{md,json}.
 *
 * - the live runtimes are the ones calls.json was encoded for
 * - the attester allowances are empty; the current dispatcher is reported
 * - the dispatcher is a contract (with code hashes), and its owner is reported with the account behind it
 * - the XCM route from Asset Hub to People is open
 * - the enactment block is ahead, how long remains to propose the Fellowship referendum, and the governance state of
 *   the package (whitelisted, preimage noted)
 * - every superseded call hash is still whitelisted, since the Fellowship batch removes it and fails otherwise
 *
 * It also lists the proxies and balances of every account involved, for the forum post.
 */
import type { SS58String } from "polkadot-api";
import { BLOCKS_PER_DAY, type Chain, connect, describeState, PARA, stateOf } from "../lib/chains.ts";
import { finish, main, parseCommand } from "../lib/cli.ts";
import { codeHashOf, implementationOf, OWNABLE_ABI, readContract } from "../lib/dotns.ts";
import { formatDot, toSs58 } from "../lib/format.ts";
import { type GovernancePackage, readPackage } from "../lib/package.ts";
import { Report } from "../lib/report.ts";

main(async () => {
  const { proposal } = parseCommand({});
  const p = proposal.params;
  const pkg = readPackage(proposal);
  const chains = await connect(p.endpoints, ["relay", "assetHub", "people", "collectives"]);
  const { relay, assetHub: ah, people } = chains;
  const report = new Report();
  const attester = toSs58(p.attester);
  const daysFromNow = (block: number, now: number) => `${((block - now) / BLOCKS_PER_DAY).toFixed(1)} days from now`;
  let timingUtc: Record<keyof GovernancePackage["timing"], string> | undefined;

  try {
    // Runtimes: the published bytes are only valid for these.
    for (const key of Object.keys(pkg.runtimes) as (keyof GovernancePackage["runtimes"])[]) {
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

    // Accounts: who controls each of them. The dispatcher owner can upgrade it.
    const owner = await readContract(ah, p.dispatcher, OWNABLE_ABI, "owner", []);
    const ownerAccount = await ah.api.query.Revive.OriginalAccount.getValue(owner, { at: ah.at });
    report.info("dispatcher owner", ownerAccount ? `${owner} → ${ownerAccount}` : `${owner} (unmapped)`);
    if (ownerAccount) report.info("dispatcher owner proxies (Asset Hub)", await proxiesOf(ah, ownerAccount));
    report.info("attester proxies (Asset Hub)", await proxiesOf(ah, attester));
    report.info("attester proxies (People)", await proxiesOf(people, attester));
    report.info(
      "attester free balance",
      `Asset Hub ${await freeOf(ah, attester)}, People ${await freeOf(people, attester)}`,
    );

    // XCM route.
    const channel = await relay.api.query.Hrmp.HrmpChannels.getValue(
      { sender: PARA.assetHub, recipient: PARA.people },
      { at: relay.at },
    );
    report.check(
      Boolean(channel),
      "HRMP channel Asset Hub → People open",
      channel ? `max message ${channel.max_message_size} B` : "missing",
    );

    // Governance state of this package, and timing.
    const whitelisted = await ah.api.query.Whitelist.WhitelistedCall.getValue(pkg.rootBatchHash, { at: ah.at });
    report.info("inner call whitelisted on Asset Hub", whitelisted === undefined ? "not yet" : "yes");
    for (const hash of p.supersedes) {
      const still = await ah.api.query.Whitelist.WhitelistedCall.getValue(hash, { at: ah.at });
      report.check(
        still !== undefined,
        `superseded call ${hash} still whitelisted on Asset Hub`,
        still === undefined ? "no" : "yes",
      );
    }
    const preimage = await ah.api.query.Preimage.RequestStatusFor.getValue(pkg.refPreimageHash, { at: ah.at });
    report.info("referendum preimage noted on Asset Hub", preimage ? preimage.type : "not yet");
    const t = pkg.timing;
    const now = Number(await relay.api.query.Timestamp.Now.getValue({ at: relay.at }));
    const utc = (block: number) => estimateUtc(now, block - relay.block);
    timingUtc = { fellowshipProposedBy: utc(t.fellowshipProposedBy), enactAt: utc(t.enactAt) };
    report.info(
      "Fellowship referendum proposed before this block whitelists the call before enactment",
      `relay #${t.fellowshipProposedBy}, ≈ ${timingUtc.fellowshipProposedBy}, ${daysFromNow(t.fellowshipProposedBy, relay.block)}`,
    );
    report.check(
      t.enactAt > relay.block,
      "enactment block in the future",
      `relay #${t.enactAt}, ≈ ${timingUtc.enactAt}, ${daysFromNow(t.enactAt, relay.block)}`,
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

  return finish(report, proposal, "preflight", {
    command: "preflight",
    title: `Preflight: ${p.title}`,
    intro: [
      `Read-only checks by \`src/cli/preflight.ts\` against live Polkadot state. State: ${describeState(chains)}.`,
    ],
    state: { ...stateOf(chains), ...(timingUtc && { timingUtc }) },
  });
});

/** UTC time `blocks` relay blocks after `nowMs`, at 6 s per block, to the minute. */
function estimateUtc(nowMs: number, blocks: number): string {
  return `${new Date(nowMs + blocks * 6_000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

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

async function freeOf(chain: Chain<"assetHub"> | Chain<"people">, account: SS58String): Promise<string> {
  const { data } = await chain.api.query.System.Account.getValue(account, { at: chain.at });
  return formatDot(data.free);
}
