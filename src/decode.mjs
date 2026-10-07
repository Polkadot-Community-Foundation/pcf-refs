// Decodes the published bytes against live metadata, independently of the encoder: it reads only calls.json (or a
// hex you pass), recomputes every hash, follows XCM Transacts into the destination chain's metadata and decodes
// Revive calldata with the DotNS whitelist ABI. Writes BREAKDOWN.md for the forum post.
// Usage: node src/decode.mjs [--proposal <dir>]
//        node src/decode.mjs --hex <call> [--chain assetHub|collectives|people|bulletin]   (prints only)
import { writeFileSync } from "node:fs";
import { decodeFunctionData } from "viem";
import { loadProposal, connect, readJson, blake2, byteLen, json, arg, Binary, hex, WHITELIST_ABI, PARA } from "./lib.mjs";

const { p, out } = loadProposal();
const c = await connect(p.endpoints, ["assetHub", "people", "bulletin", "collectives"]);
const byPara = { [PARA.assetHub]: "assetHub", [PARA.people]: "people", [PARA.bulletin]: "bulletin", [PARA.collectives]: "collectives" };
const chainName = { assetHub: "Asset Hub", people: "People", bulletin: "Bulletin", collectives: "Collectives" };
const lines = [];
const say = (depth, s) => lines.push(`${"  ".repeat(depth)}- ${s}`);
const args = (v) => "`" + json(v) + "`";
const found = { innerHashes: [] };

async function render(chain, callHex, depth) {
  const tx = await c[chain].api.txFromCallData(Binary.fromHex(callHex));
  return walk(chain, tx.decodedCall, depth);
}

async function walk(chain, call, depth) {
  const pallet = call.type, name = call.value.type, a = call.value.value ?? {};
  const label = `**${chainName[chain]}** \`${pallet}.${name}\``;
  if (pallet === "Utility" && /^(batch|batch_all|force_batch)$/.test(name)) {
    say(depth, `${label}: ${a.calls.length} calls, all or nothing`);
    for (const inner of a.calls) await walk(chain, inner, depth + 1);
  } else if (pallet === "Whitelist" && name === "dispatch_whitelisted_call_with_preimage") {
    const innerHex = hex(await c[chain].api.tx[a.call.type][a.call.value.type](a.call.value.value).getEncodedData());
    found.innerHashes.push(blake2(innerHex));
    say(depth, `${label}: dispatches with Root the call whose hash the Fellowship whitelisted, \`${blake2(innerHex)}\` (${byteLen(innerHex)} B)`);
    await walk(chain, a.call, depth + 1);
  } else if (pallet === "Whitelist" && name === "whitelist_call") {
    found.whitelisted = hex(a.call_hash);
    say(depth, `${label}: whitelists call hash \`${hex(a.call_hash)}\``);
  } else if (pallet === "PolkadotXcm" && name === "send") {
    const para = a.dest.value.interior.value?.value;
    const dest = byPara[para];
    say(depth, `${label} to parachain ${para} (${chainName[dest] ?? "unknown"}), parents ${a.dest.value.parents}`);
    for (const ins of a.message.value) {
      if (ins.type === "Transact") {
        say(depth + 1, `XCM \`Transact\`, origin kind \`${ins.value.origin_kind.type}\``);
        if (!dest) { say(depth + 2, `undecoded call \`${hex(ins.value.call)}\``); continue; }
        await render(dest, hex(ins.value.call), depth + 2);
      } else say(depth + 1, `XCM \`${ins.type}\` ${args(ins.value)}`);
    }
  } else if (pallet === "Revive" && name === "call") {
    const data = hex(a.data);
    say(depth, `${label} to contract \`${a.dest}\`, value ${a.value}, weight limit ${args(a.weight_limit)}, storage deposit limit ${a.storage_deposit_limit}`);
    try {
      const d = decodeFunctionData({ abi: WHITELIST_ABI, data });
      say(depth + 1, `Solidity \`${d.functionName}\` ${args(d.args)}`);
    } catch { say(depth + 1, `calldata \`${data}\` (not a DotNS whitelist call)`); }
  } else if (pallet === "FellowshipReferenda" && name === "submit") {
    say(depth, `${label}: track origin \`${a.proposal_origin.type}.${a.proposal_origin.value.type}\`, enactment \`${a.enactment_moment.type}(${a.enactment_moment.value})\``);
    if (a.proposal.type !== "Inline") say(depth + 1, `proposal ${args(a.proposal)}`);
    else await render(chain, hex(a.proposal.value), depth + 1);
  } else if (pallet === "Referenda" && name === "submit") {
    say(depth, `${label}: track origin \`${a.proposal_origin.type}.${a.proposal_origin.value.type}\`, proposal \`${a.proposal.type}\` ${args(a.proposal.value)}, enactment \`${a.enactment_moment.type}(${a.enactment_moment.value})\``);
  } else {
    say(depth, `${label} ${args(a)}`);
  }
}

if (arg("hex")) {
  await render(arg("chain", "assetHub"), arg("hex"), 0);
  console.log(lines.join("\n"));
  c.close(); process.exit(0);
}

const calls = readJson(out("calls.json"));
let ok = true;
const mismatch = (what, a, b) => { if (a !== b) { ok = false; console.error(`MISMATCH ${what}: computed ${a}, calls.json ${b}`); } };
const md = [`# ${calls.title}: decoded calls`, "",
  `Decoded by \`src/decode.mjs\` from the bytes in \`calls.json\` against live metadata (Asset Hub ${c.assetHub.spec}, People ${c.people.spec}, Bulletin ${c.bulletin.spec}, Collectives ${c.collectives.spec}). Every hash below is recomputed from the bytes.`, ""];

lines.length = 0;
await render("assetHub", calls.refPreimage, 0);
const refHash = blake2(calls.refPreimage);
mismatch("refPreimageHash", refHash, calls.refPreimageHash);
mismatch("rootBatchHash", found.innerHashes[0], calls.rootBatchHash);
// The inner call is the preimage minus its 2-byte call index: check the bytes, not only the re-encoding.
mismatch("inner call bytes", "0x" + calls.refPreimage.slice(6), calls.rootBatch);
md.push("## Referendum preimage (Asset Hub, Whitelisted Caller track)", "",
  `| | |`, `|---|---|`,
  `| Preimage hash | \`${refHash}\` |`, `| Preimage length | ${byteLen(calls.refPreimage)} bytes |`,
  `| Whitelisted (inner) call hash | \`${found.innerHashes[0]}\` |`, `| Inner call length | ${byteLen(calls.rootBatch)} bytes |`, "",
  ...lines, "");

lines.length = 0;
await render("collectives", calls.fellowship.submit, 0);
mismatch("Fellowship whitelist hash", found.whitelisted, found.innerHashes[0]);
md.push("## Fellowship referendum (Collectives, Fellows origin)", "",
  `Whitelists exactly the inner call hash above: ${found.whitelisted === found.innerHashes[0] ? "yes" : "**NO**"}.`, "", ...lines, "");

if (calls.submission.referendaSubmit) {
  lines.length = 0;
  await render("assetHub", calls.submission.referendaSubmit, 0);
  md.push("## Referendum submission (Asset Hub)", "",
    `Enactment is fixed at relay block ${calls.deadlines.enactAt}. The Fellowship referendum must be submitted by relay block ${calls.deadlines.fellowshipSubmitBy} and the whitelist must be on Asset Hub by relay block ${calls.deadlines.whitelistLandedBy}.`, "",
    ...lines, "");
}
md.push("## Raw bytes", "", "| Item | Hex |", "|---|---|",
  `| Referendum preimage (\`Preimage.note_preimage\` input) | \`${calls.refPreimage}\` |`,
  `| Inner call (whitelisted) | \`${calls.rootBatch}\` |`,
  `| \`FellowshipReferenda.submit\` (Collectives) | \`${calls.fellowship.submit}\` |`,
  ...(calls.submission.referendaSubmit ? [`| \`Referenda.submit\` (Asset Hub) | \`${calls.submission.referendaSubmit}\` |`] : []), "");

writeFileSync(out("BREAKDOWN.md"), md.join("\n"));
console.log(md.join("\n"));
console.log(ok ? `\nall hashes match calls.json; wrote ${out("BREAKDOWN.md")}` : "\nHASH MISMATCH, see above");
c.close(); process.exit(ok ? 0 : 1);
