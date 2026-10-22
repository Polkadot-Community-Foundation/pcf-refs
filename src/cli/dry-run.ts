/**
 * `npm run dry-run`: executes every leg of the published package on live state with `DryRunApi`. Nothing is
 * submitted. Writes reports/dry-run.{md,json}.
 *
 * 1. Root: the inner batch with Root on Asset Hub, then its one XCM on People. No XCM may go anywhere else.
 * 2. Fellowship: the Fellowship proposal with the Fellows origin on Collectives, then its XCM on Asset Hub, which
 *    removes every superseded call hash from the whitelist and whitelists the inner call.
 * 3. Referendum: the preimage with the WhitelistedCaller origin on Asset Hub. Until the whitelist lands this fails
 *    with `CallIsNotWhitelisted`, which shows the origin is accepted.
 * 4. Submission (with a submitter): `note_preimage` + `Referenda.submit`, to show the deposits held.
 *
 *   --submitter <ss58>   account for leg 4; defaults to params.submitter
 */
import { Enum, type HexString } from "polkadot-api";
import { CHAIN_NAMES, type Chains, chainOfPara, connect, describeState, PARA, stateOf } from "../lib/chains.ts";
import { finish, main, parseCommand } from "../lib/cli.ts";
import { eventNames, findEvents, type RuntimeEvent } from "../lib/events.ts";
import { formatDot, fromHex, sameAccount, sameAddress, toJson, toSs58 } from "../lib/format.ts";
import { type GovernancePackage, readPackage } from "../lib/package.ts";
import type { Params } from "../lib/proposal.ts";
import { Report } from "../lib/report.ts";
import { paraOf, siblingLocation, XCM_VERSION } from "../lib/xcm.ts";

type DryRunChains = Chains<"assetHub" | "people" | "collectives">;

interface Context {
  chains: DryRunChains;
  pkg: GovernancePackage;
  params: Params;
  report: Report;
}

main(async () => {
  const { proposal, flags } = parseCommand({ submitter: { type: "string" } });
  const params = proposal.params;
  const pkg = readPackage(proposal);
  const chains = await connect(params.endpoints, ["assetHub", "people", "collectives"]);
  const report = new Report();
  const ctx: Context = { chains, pkg, params, report };

  try {
    report.info("package", `inner call ${pkg.rootBatchHash}, preimage ${pkg.refPreimageHash}`);
    await rootLeg(ctx);
    await fellowshipLeg(ctx);
    await referendumLeg(ctx);
    const submitter = flags.submitter ?? params.submitter;
    if (submitter) await submissionLeg(ctx, toSs58(submitter));
    else report.info("submission dry run skipped", "set params.submitter or pass --submitter <ss58>");
  } finally {
    chains.close();
  }

  return finish(report, proposal, "dry-run", {
    command: "dry-run",
    title: `Dry run: ${params.title}`,
    intro: [
      `DryRunApi against live Polkadot state by \`src/cli/dry-run.ts\`; nothing is submitted. State: ${describeState(chains)}.`,
      `Inner call hash \`${pkg.rootBatchHash}\`, preimage hash \`${pkg.refPreimageHash}\`.`,
    ],
    state: stateOf(chains),
  });
});

/** Leg 1: the batch with Root on Asset Hub, and its XCM on People. */
async function rootLeg({ chains, pkg, params, report }: Context): Promise<void> {
  const ah = chains.assetHub;
  const call = await ah.api.txFromCallData(fromHex(pkg.rootBatch));
  const result = await ah.api.apis.DryRunApi.dry_run_call(Enum("system", Enum("Root")), call.decodedCall, XCM_VERSION, {
    at: ah.at,
  });
  if (!result.success) {
    report.check(false, "Asset Hub: dry run of the inner batch with Root", toJson(result.value));
    return;
  }
  const { execution_result: execution, emitted_events, forwarded_xcms } = result.value;
  const events = emitted_events as RuntimeEvent[];
  report.check(
    execution.success,
    "Asset Hub: inner batch executes with Root",
    execution.success ? `${events.length} events` : toJson(execution.value),
  );

  const allowance = findEvents<{ account: string; count: number }>(
    events,
    "DotnsGateway",
    "AttestationAllowanceIncreased",
  )[0];
  report.check(
    Boolean(allowance && sameAccount(allowance.account, params.attester) && allowance.count >= params.count),
    "Asset Hub: DotnsGateway.AttestationAllowanceIncreased for the attester",
    toJson(allowance),
  );
  const dispatcher = findEvents<{ address: HexString }>(events, "DotnsGateway", "DispatcherAddressSet")[0];
  report.check(
    Boolean(dispatcher && sameAddress(dispatcher.address, params.dispatcher)),
    "Asset Hub: DotnsGateway.DispatcherAddressSet to the dispatcher",
    toJson(dispatcher),
  );
  const sent = findEvents(events, "PolkadotXcm", "Sent").length;
  report.check(sent === 1, "Asset Hub: one XCM sent", `${sent} sent`);
  report.info("Asset Hub events", eventNames(events).join(", "));

  // The only forwarded XCM goes to People and grants the allowance there.
  const toPeople: (typeof forwarded_xcms)[number][1] = [];
  const elsewhere: string[] = [];
  for (const [destination, messages] of forwarded_xcms) {
    if (paraOf(destination) === PARA.people) toPeople.push(...messages);
    else elsewhere.push(...messages.map(() => describeLocation(destination)));
  }
  report.check(toPeople.length === 1, "Asset Hub: one XCM forwarded to People", `${toPeople.length} forwarded`);
  report.check(
    elsewhere.length === 0,
    "Asset Hub: no XCM forwarded to any other destination",
    elsewhere.join(", ") || "none",
  );
  const people = chains.people;
  for (const message of toPeople) {
    const r = await people.api.apis.DryRunApi.dry_run_xcm(siblingLocation(PARA.assetHub), message, { at: people.at });
    if (!r.success) {
      report.check(false, "People: XCM dry run", toJson(r.value));
      continue;
    }
    const outcome = r.value.execution_result;
    report.check(outcome.type === "Complete", "People: XCM from Asset Hub executes", toJson(outcome));
    // A failed Transact still reports Complete, so the effect is asserted from events.
    const remoteEvents = r.value.emitted_events as RuntimeEvent[];
    const increased = findEvents<{ account: string; count: number }>(
      remoteEvents,
      "PeopleLite",
      "AttestationAllowanceIncreased",
    )[0];
    report.check(
      Boolean(increased && sameAccount(increased.account, params.attester) && increased.count >= params.count),
      "People: PeopleLite.AttestationAllowanceIncreased for the attester",
      toJson(increased),
    );
    report.info("People events", eventNames(remoteEvents).join(", "));
  }

  // The batch is enacted by the scheduler, so it must fit the scheduler's weight limit.
  const limit = await ah.api.constants.Scheduler.MaximumWeight();
  const info = await ah.api.apis.TransactionPaymentCallApi.query_call_info(call.decodedCall, pkg.rootBatchLen, {
    at: ah.at,
  });
  report.check(
    info.weight.ref_time <= limit.ref_time && info.weight.proof_size <= limit.proof_size,
    "inner batch declared weight fits the scheduler limit",
    `ref_time ${info.weight.ref_time} / ${limit.ref_time}, proof ${info.weight.proof_size} / ${limit.proof_size}`,
  );
  if (execution.success) report.info("inner batch actual weight", toJson(execution.value.actual_weight));
}

/** Leg 2: the Fellowship proposal with the Fellows origin, then its whitelist XCM on Asset Hub. */
async function fellowshipLeg({ chains, pkg, params, report }: Context): Promise<void> {
  const { collectives, assetHub: ah } = chains;
  const call = await collectives.api.txFromCallData(fromHex(pkg.fellowship.xcmToAssetHub));
  const result = await collectives.api.apis.DryRunApi.dry_run_call(
    Enum("FellowshipOrigins", Enum("Fellows")),
    call.decodedCall,
    XCM_VERSION,
    { at: collectives.at },
  );
  if (!result.success) {
    report.check(false, "Collectives: dry run of the Fellowship proposal", toJson(result.value));
    return;
  }
  const execution = result.value.execution_result;
  report.check(
    execution.success,
    "Collectives: Fellowship proposal executes with the Fellows origin",
    execution.success ? "ok" : toJson(execution.value),
  );
  const toAssetHub = [];
  let toElsewhere = 0;
  for (const [destination, messages] of result.value.forwarded_xcms) {
    if (paraOf(destination) === PARA.assetHub) toAssetHub.push(...messages);
    else toElsewhere += messages.length;
  }
  report.check(toAssetHub.length === 1 && toElsewhere === 0, "Collectives: one XCM forwarded, to Asset Hub");
  for (const message of toAssetHub) {
    const r = await ah.api.apis.DryRunApi.dry_run_xcm(siblingLocation(PARA.collectives), message, { at: ah.at });
    if (!r.success) {
      report.check(false, "Asset Hub: whitelist XCM dry run", toJson(r.value));
      continue;
    }
    const events = r.value.emitted_events as RuntimeEvent[];
    const whitelisted = findEvents<{ call_hash: HexString }>(events, "Whitelist", "CallWhitelisted")[0];
    report.check(
      r.value.execution_result.type === "Complete" && whitelisted?.call_hash === pkg.rootBatchHash,
      "Asset Hub: Whitelist.CallWhitelisted for the inner call hash",
      toJson(whitelisted ?? r.value.execution_result),
    );
    const removed = findEvents<{ call_hash: HexString }>(events, "Whitelist", "WhitelistedCallRemoved").map(
      (e) => e.call_hash,
    );
    for (const hash of params.supersedes) {
      report.check(
        removed.includes(hash),
        `Asset Hub: Whitelist.WhitelistedCallRemoved for superseded call ${hash}`,
        removed.join(", ") || "none removed",
      );
    }
  }
}

/** Leg 3: the referendum preimage with the WhitelistedCaller origin. */
async function referendumLeg({ chains, pkg, report }: Context): Promise<void> {
  const ah = chains.assetHub;
  const call = await ah.api.txFromCallData(fromHex(pkg.refPreimage));
  const result = await ah.api.apis.DryRunApi.dry_run_call(
    Enum("Origins", Enum("WhitelistedCaller")),
    call.decodedCall,
    XCM_VERSION,
    { at: ah.at },
  );
  if (!result.success) {
    report.check(false, "Asset Hub: dry run of the referendum preimage", toJson(result.value));
    return;
  }
  const execution = result.value.execution_result;
  const whitelisted =
    (await ah.api.query.Whitelist.WhitelistedCall.getValue(pkg.rootBatchHash, { at: ah.at })) !== undefined;
  if (whitelisted) {
    report.check(
      execution.success,
      "Asset Hub: referendum preimage executes with WhitelistedCaller (call is whitelisted)",
      execution.success ? "ok" : toJson(execution.value),
    );
    return;
  }
  const error = execution.success ? undefined : execution.value.error;
  const notWhitelisted =
    error?.type === "Module" && error.value.type === "Whitelist" && error.value.value.type === "CallIsNotWhitelisted";
  report.check(
    notWhitelisted,
    "Asset Hub: WhitelistedCaller origin accepted, fails only with CallIsNotWhitelisted until the whitelist lands",
    toJson(error ?? "unexpected success"),
  );
}

/** Leg 4: the submitter notes the preimage and opens the referendum; shows the deposits held. */
async function submissionLeg({ chains, pkg, report }: Context, submitter: string): Promise<void> {
  const ah = chains.assetHub;
  const [note, submit] = await Promise.all([
    ah.api.txFromCallData(fromHex(pkg.submission.notePreimage)),
    ah.api.txFromCallData(fromHex(pkg.submission.referendaSubmit)),
  ]);
  const batch = ah.api.tx.Utility.batch_all({ calls: [note.decodedCall, submit.decodedCall] });
  const result = await ah.api.apis.DryRunApi.dry_run_call(
    Enum("system", Enum("Signed", submitter)),
    batch.decodedCall,
    XCM_VERSION,
    { at: ah.at },
  );
  if (!result.success) {
    report.check(false, "Asset Hub: submission dry run", toJson(result.value));
    return;
  }
  const events = result.value.emitted_events as RuntimeEvent[];
  const execution = result.value.execution_result;
  report.check(
    execution.success,
    `Asset Hub: note_preimage + Referenda.submit signed by ${submitter}`,
    execution.success
      ? eventNames(events)
          .filter((n) => /^(Preimage|Referenda)\./.test(n))
          .join(", ")
      : toJson(execution.value),
  );
  const held = [
    ...findEvents<{ amount: bigint }>(events, "Balances", "Held"),
    ...findEvents<{ amount: bigint }>(events, "Balances", "Reserved"),
  ];
  if (held.length) report.info("deposits held at submission", held.map((h) => formatDot(h.amount)).join(" + "));
  const submitted = findEvents<{ index: number }>(events, "Referenda", "Submitted")[0];
  if (submitted) report.info("referendum index if submitted at this block", String(submitted.index));
}

/** Chain name of a sibling `VersionedLocation`, or the location itself. */
function describeLocation(location: { value: unknown }): string {
  const para = paraOf(location);
  const chain = para === undefined ? undefined : chainOfPara(para);
  return chain ? CHAIN_NAMES[chain] : toJson(location);
}
