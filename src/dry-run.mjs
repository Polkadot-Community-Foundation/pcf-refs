// Dry-runs every leg of the published package against live Polkadot state with DryRunApi (nothing is submitted):
//   1. the inner batch with Root on Asset Hub, then each forwarded XCM on People and Bulletin;
//   2. the Fellowship referendum's proposal with the Fellows origin on Collectives, then its XCM on Asset Hub;
//   3. the referendum's preimage with the WhitelistedCaller origin on Asset Hub (fails with CallIsNotWhitelisted
//      until the whitelist lands, which proves the origin is accepted);
//   4. note_preimage + Referenda.submit signed by the submitter, to show the deposits.
// Asserts the expected events, compares the batch weight with the scheduler limit, and writes DRY_RUN.md.
// Usage: node src/dry-run.mjs [--proposal <dir>] [--submitter <ss58>]
import { writeFileSync } from "node:fs";
import { decodeEventLog } from "viem";
import {
  loadProposal, connect, readJson, checklist, markdownRows, json, hex, ss58, fmtDot, arg, Enum, Binary,
  pickEvents, eventNames, siblingLocation, WHITELIST_ABI, PARA,
} from "./lib.mjs";

const { p, out } = loadProposal();
const calls = readJson(out("calls.json"));
const c = await connect(p.endpoints, ["assetHub", "people", "bulletin", "collectives"]);
const { assetHub: ah, people, bulletin, collectives } = c;
const { check, info, rows, failed } = checklist();
const XCM_VERSION = 5;
const attester = ss58(p.attester), authorizer = ss58(p.bulletin.authorizer);
const sameAccount = (a, b) => ss58(a) === ss58(b);
const dryRunCall = async (chain, origin, callHex) => {
  const tx = await chain.api.txFromCallData(Binary.fromHex(callHex));
  return chain.api.apis.DryRunApi.dry_run_call(origin, tx.decodedCall, XCM_VERSION, { at: chain.at });
};
const dryRunXcm = (chain, fromPara, msg) => chain.api.apis.DryRunApi.dry_run_xcm(siblingLocation(fromPara), msg, { at: chain.at });
const dispatchError = (r) => r.execution_result.success ? null : json(r.execution_result.value.error);

info("state", `Asset Hub #${ah.block} ${ah.at}, People #${people.block}, Bulletin #${bulletin.block}, Collectives #${collectives.block}`);
info("package", `inner call ${calls.rootBatchHash}, preimage ${calls.refPreimageHash}`);

// 1. Root leg.
const root = await dryRunCall(ah, Enum("system", Enum("Root")), calls.rootBatch);
if (!root.success) { check(false, "Asset Hub dry run of the inner batch with Root", json(root.value)); }
else {
  const r = root.value, ev = r.emitted_events;
  check(r.execution_result.success, "Asset Hub: inner batch executes with Root", dispatchError(r) ?? `${ev.length} events`);
  const allow = pickEvents(ev, "DotnsGateway", "AttestationAllowanceIncreased")[0];
  check(allow && sameAccount(allow.account, attester) && Number(allow.count ?? allow.new_allowance) >= p.count,
    "Asset Hub: DotnsGateway.AttestationAllowanceIncreased for the attester", json(allow));
  const disp = pickEvents(ev, "DotnsGateway", "DispatcherAddressSet")[0];
  check(disp && json(disp).toLowerCase().includes(p.dispatcher.slice(2).toLowerCase()), "Asset Hub: DotnsGateway.DispatcherAddressSet to the dispatcher", json(disp));
  const accepted = pickEvents(ev, "Revive", "ContractEmitted")
    .filter((e) => hex(e.contract).toLowerCase() === p.dotns.nameWhitelist.toLowerCase())
    .map((e) => { try { return decodeEventLog({ abi: WHITELIST_ABI, data: hex(e.data), topics: e.topics.map(hex) }); } catch { return null; } })
    .filter((e) => e?.eventName === "NameAccepted");
  const granted = accepted.map((e) => `${e.args.label}→${e.args.user}`);
  check(p.names.every((n) => accepted.some((e) => e.args.label === n && e.args.user.toLowerCase() === p.namesOwner.toLowerCase())),
    "Asset Hub: DotnsNameWhitelist NameAccepted for every name, to the names owner", granted.join(", "));
  check(pickEvents(ev, "PolkadotXcm", "Sent").length === 2, "Asset Hub: two XCMs sent", eventNames(ev).filter((e) => e.startsWith("PolkadotXcm")).join(", "));
  info("Asset Hub events", eventNames(ev).join(", "));

  // Forwarded XCMs on their destinations.
  const expected = {
    [PARA.people]: { name: "People", chain: people, pallet: "PeopleLite", event: "AttestationAllowanceIncreased",
      ok: (e) => sameAccount(e.account, attester) },
    [PARA.bulletin]: { name: "Bulletin", chain: bulletin, pallet: "TransactionStorage", event: "AuthorizerAdded",
      ok: (e) => sameAccount(e.who ?? e.authorizer ?? Object.values(e)[0], authorizer) },
  };
  const seen = new Set();
  for (const [dest, msgs] of r.forwarded_xcms) {
    const para = dest.value?.interior?.value?.value;
    const x = expected[para];
    if (!x) { check(false, "forwarded XCM goes to People or Bulletin", json(dest)); continue; }
    for (const msg of msgs) {
      seen.add(para);
      const d = await dryRunXcm(x.chain, PARA.assetHub, msg);
      if (!d.success) { check(false, `${x.name}: XCM dry run`, json(d.value)); continue; }
      check(d.value.execution_result.type === "Complete", `${x.name}: XCM from Asset Hub executes`, json(d.value.execution_result));
      // A failed Transact still reports Complete, so the effect is asserted from events.
      const hit = pickEvents(d.value.emitted_events, x.pallet, x.event)[0];
      check(Boolean(hit && x.ok(hit)), `${x.name}: ${x.pallet}.${x.event}`, json(hit));
      info(`${x.name} events`, eventNames(d.value.emitted_events).join(", "));
    }
  }
  for (const [para, x] of Object.entries(expected)) check(seen.has(Number(para)), `XCM to ${x.name} forwarded`);

  // Weight: the batch is enacted by the scheduler and must fit its limit.
  const maxSched = await ah.api.constants.Scheduler.MaximumWeight({ at: ah.at });
  const tx = await ah.api.txFromCallData(Binary.fromHex(calls.rootBatch));
  const infoCall = await ah.api.apis.TransactionPaymentCallApi.query_call_info(tx.decodedCall, calls.rootBatchLen, { at: ah.at });
  const w = infoCall.weight;
  check(w.ref_time <= maxSched.ref_time && w.proof_size <= maxSched.proof_size, "inner batch declared weight fits the scheduler limit",
    `ref_time ${w.ref_time} / ${maxSched.ref_time}, proof ${w.proof_size} / ${maxSched.proof_size}`);
  const actual = r.execution_result.success ? r.execution_result.value.actual_weight : undefined;
  if (actual) info("inner batch actual weight", json(actual));
}

// 2. Fellowship leg: the inline proposal with the Fellows origin, then its XCM on Asset Hub.
const fellows = await dryRunCall(collectives, Enum("FellowshipOrigins", Enum("Fellows")), calls.fellowship.xcmToAssetHub);
if (!fellows.success) check(false, "Collectives dry run of the Fellowship proposal", json(fellows.value));
else {
  check(fellows.value.execution_result.success, "Collectives: Fellowship proposal executes with the Fellows origin", dispatchError(fellows.value) ?? "ok");
  const fwd = fellows.value.forwarded_xcms.flatMap(([dest, msgs]) => msgs.map((m) => [dest.value?.interior?.value?.value, m]));
  check(fwd.length === 1 && fwd[0][0] === PARA.assetHub, "Collectives: one XCM forwarded to Asset Hub");
  for (const [, msg] of fwd) {
    const d = await dryRunXcm(ah, PARA.collectives, msg);
    if (!d.success) { check(false, "Asset Hub: whitelist XCM dry run", json(d.value)); continue; }
    const wl = pickEvents(d.value.emitted_events, "Whitelist", "CallWhitelisted")[0];
    check(d.value.execution_result.type === "Complete" && hex(wl?.call_hash ?? "0x") === calls.rootBatchHash,
      "Asset Hub: Whitelist.CallWhitelisted for the inner call hash", json(wl ?? d.value.execution_result));
  }
}

// 3. Referendum leg: the preimage with the WhitelistedCaller origin.
const ref = await dryRunCall(ah, Enum("Origins", Enum("WhitelistedCaller")), calls.refPreimage);
if (!ref.success) check(false, "Asset Hub dry run of the referendum preimage", json(ref.value));
else {
  const er = ref.value.execution_result;
  const whitelisted = (await ah.api.query.Whitelist.WhitelistedCall.getValue(calls.rootBatchHash, { at: ah.at })) !== undefined;
  const notWhitelisted = !er.success && er.value.error.type === "Module" && er.value.error.value.type === "Whitelist"
    && er.value.error.value.value.type === "CallIsNotWhitelisted";
  if (whitelisted) check(er.success, "Asset Hub: referendum preimage executes with WhitelistedCaller (call is whitelisted)", dispatchError(ref.value) ?? "ok");
  else check(notWhitelisted, "Asset Hub: WhitelistedCaller origin accepted, fails only with CallIsNotWhitelisted until the whitelist lands", json(er.value.error ?? "unexpected success"));
}

// 4. Submission by the submitter: notes the preimage and opens the referendum, showing the deposits held.
const submitter = arg("submitter", p.submitter);
if (!submitter) info("submission dry run skipped", "set params.submitter or pass --submitter <ss58>");
else if (!calls.submission.referendaSubmit) info("submission dry run skipped", "no enactAt pinned");
else {
  const note = await ah.api.txFromCallData(Binary.fromHex(calls.submission.notePreimage));
  const submit = await ah.api.txFromCallData(Binary.fromHex(calls.submission.referendaSubmit));
  const batch = ah.api.tx.Utility.batch_all({ calls: [note.decodedCall, submit.decodedCall] });
  const s = await ah.api.apis.DryRunApi.dry_run_call(Enum("system", Enum("Signed", ss58(submitter))), batch.decodedCall, XCM_VERSION, { at: ah.at });
  if (!s.success) check(false, "Asset Hub: submission dry run", json(s.value));
  else {
    const ev = s.value.emitted_events;
    check(s.value.execution_result.success, `Asset Hub: note_preimage + Referenda.submit signed by ${ss58(submitter)}`, dispatchError(s.value) ?? eventNames(ev).filter((e) => /Preimage|Referenda/.test(e)).join(", "));
    const held = pickEvents(ev, "Balances", "Held").concat(pickEvents(ev, "Balances", "Reserved"));
    if (held.length) info("deposits held at submission", held.map((h) => fmtDot(h.amount)).join(" + "));
    const sub = pickEvents(ev, "Referenda", "Submitted")[0];
    if (sub) info("referendum index if submitted at this block", String(sub.index));
  }
}
const tracks = await ah.api.constants.Referenda.Tracks({ at: ah.at });
const wc = tracks.find(([, t]) => t.name.replace(/\0+$/, "") === "whitelisted_caller");
info("decision deposit (Referenda.place_decision_deposit, after submit)", fmtDot(wc[1].decision_deposit));

const md = [`# Dry run: ${p.title}`, "",
  `DryRunApi against live Polkadot state by \`src/dry-run.mjs\`. Asset Hub block #${ah.block} (\`${ah.at}\`), People #${people.block} (\`${people.at}\`), Bulletin #${bulletin.block} (\`${bulletin.at}\`), Collectives #${collectives.block} (\`${collectives.at}\`). Runtimes ${ah.spec}.`,
  "", `Inner call hash \`${calls.rootBatchHash}\`, preimage hash \`${calls.refPreimageHash}\`.`, "", markdownRows(rows), ""];
writeFileSync(out("DRY_RUN.md"), md.join("\n"));
console.log(`\n${failed() ? "DRY RUN FAILED" : "dry run green"}; wrote ${out("DRY_RUN.md")}`);
c.close(); process.exit(failed() ? 1 : 0);
