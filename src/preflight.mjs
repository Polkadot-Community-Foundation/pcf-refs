// Read-only checks of live state before publishing or submitting: the targets are empty, the addresses are what
// params.json says, the XCM routes are open, the deadlines are still reachable. Writes PREFLIGHT.md.
// Usage: node src/preflight.mjs [--proposal <dir>]
import { writeFileSync, existsSync } from "node:fs";
import { decodeFunctionResult, encodeFunctionData } from "viem";
import {
  loadProposal, connect, readJson, ethCall, checklist, markdownRows, json, hex, ss58, fmtDot,
  WHITELIST_ABI, CONTROLLER_ABI, NAME_STATUS, PARA, DAY,
} from "./lib.mjs";

const { p, out } = loadProposal();
const c = await connect(p.endpoints);
const { relay, assetHub: ah, people, bulletin } = c;
const { check, info, rows, failed } = checklist();
const q = (chain, pallet, item, ...keys) => chain.api.query[pallet][item].getValue(...keys, { at: chain.at });
const attester = ss58(p.attester), authorizer = ss58(p.bulletin.authorizer);
const calls = existsSync(out("calls.json")) ? readJson(out("calls.json")) : null;

info("state read at", `relay #${relay.block}, Asset Hub #${ah.block}, People #${people.block}, Bulletin #${bulletin.block}`);

// Runtimes: the published bytes were encoded against these.
if (calls) for (const [k, v] of Object.entries(calls.runtimes))
  check(c[k].spec === v, `${k} runtime unchanged since encode`, `live ${c[k].spec}, encoded ${v}`);
else check(false, "calls.json exists", "run npm run encode first");

// Attestation allowances and dispatcher are empty.
check(!(await q(ah, "DotnsGateway", "AttestationAllowance", attester)), "Asset Hub attester allowance is empty", `${attester}`);
check(!(await q(people, "PeopleLite", "AttestationAllowance", attester)), "People attester allowance is empty");
const dispatcherNow = await q(ah, "DotnsGateway", "DispatcherAddress");
info("Asset Hub DotnsGateway dispatcher today", dispatcherNow ? hex(dispatcherNow) : "unset");

// Dispatcher is a deployed contract (DotnsPopController proxy); print code hashes for verification against the release.
const ERC1967_IMPL = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const codeHashOf = async (addr) => {
  const acc = await q(ah, "Revive", "AccountInfoOf", addr);
  return acc?.account_type?.type === "Contract" ? hex(acc.account_type.value.code_hash) : null;
};
const dispCode = await codeHashOf(p.dispatcher);
check(Boolean(dispCode), "dispatcher is a contract", `${p.dispatcher} code hash ${dispCode}`);
const slot = await ah.api.apis.ReviveApi.get_storage(p.dispatcher, ERC1967_IMPL, { at: ah.at });
const implRaw = slot.success && slot.value ? hex(slot.value) : null;
if (implRaw) {
  const impl = "0x" + implRaw.slice(-40);
  info("dispatcher ERC-1967 implementation", `${impl} code hash ${await codeHashOf(impl)}`);
}

// Names: Open on the whitelist, available in the registrar, batch within maxGrantBatch.
const call = async (to, abi, functionName, args = []) =>
  decodeFunctionResult({ abi, functionName, data: await ethCall(ah, to, encodeFunctionData({ abi, functionName, args })) });
check(Boolean(await codeHashOf(p.dotns.nameWhitelist)), "DotnsNameWhitelist is a contract", p.dotns.nameWhitelist);
const maxBatch = await call(p.dotns.nameWhitelist, WHITELIST_ABI, "maxGrantBatch");
check(p.names.length <= maxBatch, "grant batch within maxGrantBatch", `${p.names.length} ≤ ${maxBatch}`);
for (const label of p.names) {
  const status = NAME_STATUS[await call(p.dotns.nameWhitelist, WHITELIST_ABI, "statusOf", [label])];
  const available = await call(p.dotns.registrarController, CONTROLLER_ABI, "available", [label]);
  check(status === "Open" && available, `${label}.dot is Open on the whitelist and unregistered`, `status ${status}, available ${available}`);
}

// Names owner: the H160 maps back to a substrate account (a pure proxy); list who controls it.
const original = await q(ah, "Revive", "OriginalAccount", p.namesOwner);
check(Boolean(original), "names owner H160 is a mapped substrate account", original ? `${p.namesOwner} → ${original}` : `${p.namesOwner} unmapped`);
const proxies = async (chain, who) => {
  const [delegates] = (await q(chain, "Proxy", "Proxies", who)) ?? [[]];
  return delegates.map((d) => `${d.delegate} ${d.proxy_type.type} delay ${d.delay}`).join("; ") || "none";
};
if (original) info("names owner proxies (Asset Hub)", await proxies(ah, original));
info("attester proxies (Asset Hub)", await proxies(ah, attester));
info("attester proxies (People)", await proxies(people, attester));
info("authorizer proxies (Asset Hub)", await proxies(ah, authorizer));
const free = async (chain, who) => fmtDot((await q(chain, "System", "Account", who)).data.free);
info("attester free balance", `Asset Hub ${await free(ah, attester)}, People ${await free(people, attester)}`);
info("authorizer free balance", `Asset Hub ${await free(ah, authorizer)}, Bulletin ${await free(bulletin, authorizer)}`);

// Bulletin: authorizer not yet registered, expiry ahead.
const existing = await q(bulletin, "TransactionStorage", "AllowedAuthorizers", authorizer);
check(!existing, "Bulletin authorizer not yet registered", existing ? json(existing) : authorizer);
const allAuthorizers = await bulletin.api.query.TransactionStorage.AllowedAuthorizers.getEntries({ at: bulletin.at });
info("Bulletin authorizers registered today", String(allAuthorizers.length));
if (p.bulletin.validUntil != null)
  check(p.bulletin.validUntil > bulletin.block, "Bulletin validUntil is in the future",
    `#${p.bulletin.validUntil}, ${((p.bulletin.validUntil - bulletin.block) / DAY).toFixed(1)} days from now`);

// XCM routes Asset Hub → People and → Bulletin.
for (const [name, para] of [["People", PARA.people], ["Bulletin", PARA.bulletin]]) {
  const ch = await q(relay, "Hrmp", "HrmpChannels", { sender: PARA.assetHub, recipient: para });
  check(Boolean(ch), `HRMP channel Asset Hub → ${name} open`, ch ? `max message ${ch.max_message_size} B` : "missing");
}

// Governance state of this package.
if (calls) {
  const wl = await q(ah, "Whitelist", "WhitelistedCall", calls.rootBatchHash);
  info("inner call whitelisted on Asset Hub", wl === undefined ? "not yet" : "yes");
  const pre = await q(ah, "Preimage", "RequestStatusFor", calls.refPreimageHash);
  info("referendum preimage noted on Asset Hub", pre ? pre.type : "not yet");
  const relayNow = relay.block, d = calls.deadlines;
  check(d.fellowshipSubmitBy > relayNow, "Fellowship submission deadline not passed",
    `relay #${d.fellowshipSubmitBy}, ${((d.fellowshipSubmitBy - relayNow) / DAY).toFixed(1)} days from now`);
  check(d.enactAt > relayNow, "enactment block in the future", `relay #${d.enactAt}, ${((d.enactAt - relayNow) / DAY).toFixed(1)} days from now`);
}

// Deposits the submitter needs on Asset Hub.
const tracks = await ah.api.constants.Referenda.Tracks({ at: ah.at });
const wc = tracks.find(([, t]) => t.name.replace(/\0+$/, "") === "whitelisted_caller");
info("Whitelisted Caller track", `id ${wc[0]}, decision deposit ${fmtDot(wc[1].decision_deposit)}, submission deposit ${fmtDot(await ah.api.constants.Referenda.SubmissionDeposit({ at: ah.at }))}`);

const md = [`# Preflight: ${p.title}`, "", `Read-only checks by \`src/preflight.mjs\` against live Polkadot state.`, "", markdownRows(rows), ""];
writeFileSync(out("PREFLIGHT.md"), md.join("\n"));
console.log(`\n${failed() ? "PREFLIGHT FAILED" : "preflight green"}; wrote ${out("PREFLIGHT.md")}`);
c.close(); process.exit(failed() ? 1 : 0);
