import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createClient, Enum, Binary, AccountId } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws";
import { Blake2256 } from "@polkadot-api/substrate-bindings";
import { encodeFunctionData, parseAbi } from "viem";

export const DAY = 14_400; // 6 s blocks: relay, Asset Hub referenda (relay-block based) and Bulletin
export const PARA = { assetHub: 1000, collectives: 1001, people: 1004, bulletin: 1010 };

export const WHITELIST_ABI = parseAbi([
  "function grantNames(string[] labels, address user)",
  "function statusOf(string label) view returns (uint8)",
  "function granteeOf(string label) view returns (address)",
  "function maxGrantBatch() view returns (uint16)",
  "event NameAccepted(bytes32 indexed node, address indexed user, string label)",
]);
export const CONTROLLER_ABI = parseAbi(["function available(string label) view returns (bool)"]);
export const REGISTRAR_ABI = parseAbi(["function ownerOf(uint256 id) view returns (address)"]);
export const NAME_STATUS = ["Open", "Reserved", "Claimed"];

export const hex = (u) => typeof u === "string" ? u : u?.asHex ? u.asHex() : "0x" + Buffer.from(u).toString("hex");
export const bytes = (h) => new Uint8Array(Buffer.from(h.slice(2), "hex"));
export const blake2 = (h) => hex(Blake2256(bytes(h)));
export const byteLen = (h) => (h.length - 2) / 2;
export const ss58 = (v) => AccountId(0).dec(v.startsWith("0x") ? v : hex(AccountId().enc(v)));
export const json = (x, space) =>
  JSON.stringify(x, (_, v) => typeof v === "bigint" ? v.toString() : v?.asHex ? v.asHex() : v, space);
export const fmtDot = (planck) => `${(Number(BigInt(planck)) / 1e10).toLocaleString("en-US", { maximumFractionDigits: 4 })} DOT`;

export const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
export const flag = (k) => process.argv.includes(`--${k}`);

export function loadProposal() {
  const dir = resolve(arg("proposal", "proposals/app-onboarding"));
  const file = join(dir, "params.json");
  if (!existsSync(file)) throw new Error(`no params.json in ${dir}`);
  const p = JSON.parse(readFileSync(file, "utf8"));
  const h160 = /^0x[0-9a-fA-F]{40}$/;
  for (const k of ["dispatcher", "namesOwner"]) if (!h160.test(p[k])) throw new Error(`params.${k} must be a 0x H160`);
  for (const k of ["nameWhitelist", "registrarController", "registrar"]) if (!h160.test(p.dotns[k])) throw new Error(`params.dotns.${k} must be a 0x H160`);
  ss58(p.attester); ss58(p.bulletin.authorizer);
  if (!Number.isSafeInteger(p.count) || p.count <= 0) throw new Error("params.count must be a positive integer");
  if (!p.names.length || p.names.some((n) => !/^[a-z0-9-]+$/.test(n))) throw new Error(`params.names must be bare lowercase labels`);
  return { dir, p, out: (name) => join(dir, name) };
}

export const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
export const writeJson = (f, x) => writeFileSync(f, json(x, 2) + "\n");

// One papi client per chain. All reads and dry runs of a run are pinned to the finalized block taken at connect time.
export async function connect(endpoints, which = Object.keys(endpoints)) {
  const chains = {};
  await Promise.all(which.map(async (k) => {
    const client = createClient(getWsProvider(endpoints[k]));
    const api = client.getUnsafeApi();
    await api.runtimeToken;
    const fin = await client.getFinalizedBlock();
    const spec = (await api.constants.System.Version({ at: fin.hash })).spec_version;
    chains[k] = { client, api, at: fin.hash, block: fin.number, spec };
  }));
  chains.close = () => which.forEach((k) => chains[k].client.destroy());
  return chains;
}

const here = (para) => Enum("V5", { parents: 1, interior: Enum("X1", Enum("Parachain", para)) });
export const siblingLocation = here;

// Root on Asset Hub, Superuser Transact on the sibling: the pattern of refs 1945 and 1951.
export const xcmTransact = (api, para, call, originKind = "Superuser") => api.tx.PolkadotXcm.send({
  dest: here(para),
  message: Enum("V5", [
    Enum("UnpaidExecution", { weight_limit: Enum("Unlimited"), check_origin: undefined }),
    Enum("Transact", { origin_kind: Enum(originKind), fallback_max_weight: undefined, call }),
  ]),
});

// Builds every call of the package from params. Pure function of params + metadata, so re-running it on the same
// runtimes reproduces the published bytes.
export async function buildPackage(c, p) {
  const { assetHub: ah, people, bulletin, collectives } = c;
  const attester = ss58(p.attester);

  const peopleAllowance = await people.api.tx.PeopleLite.increase_attestation_allowance({ account: attester, count: p.count }).getEncodedData();
  const bulletinAddAuthorizer = await bulletin.api.tx.TransactionStorage.add_authorizer({
    who: ss58(p.bulletin.authorizer),
    budget: {
      quota: { transactions: p.bulletin.transactions, bytes: BigInt(p.bulletin.bytes) },
      valid_until: p.bulletin.validUntil,
      feeless: p.bulletin.feeless,
    },
  }).getEncodedData();
  const grantNamesCalldata = encodeFunctionData({ abi: WHITELIST_ABI, functionName: "grantNames", args: [p.names, p.namesOwner] });

  const calls = [
    ah.api.tx.DotnsGateway.increase_attestation_allowance({ account: attester, count: p.count }),
    ah.api.tx.DotnsGateway.set_dispatcher_address({ address: p.dispatcher }),
    xcmTransact(ah.api, PARA.people, peopleAllowance),
    ah.api.tx.Revive.call({
      dest: p.dotns.nameWhitelist,
      value: 0n,
      weight_limit: { ref_time: BigInt(p.grantWeight.refTime), proof_size: BigInt(p.grantWeight.proofSize) },
      storage_deposit_limit: BigInt(p.grantStorageDepositLimit),
      data: Binary.fromHex(grantNamesCalldata),
    }),
    xcmTransact(ah.api, PARA.bulletin, bulletinAddAuthorizer),
  ];
  const batch = ah.api.tx.Utility.batch_all({ calls: calls.map((x) => x.decodedCall) });
  const rootBatch = hex(await batch.getEncodedData());
  const rootBatchHash = blake2(rootBatch);

  const refPreimage = hex(await ah.api.tx.Whitelist.dispatch_whitelisted_call_with_preimage({ call: batch.decodedCall }).getEncodedData());
  const refPreimageHash = blake2(refPreimage);

  const whitelistCall = hex(await ah.api.tx.Whitelist.whitelist_call({ call_hash: rootBatchHash }).getEncodedData());
  const fellowshipXcm = hex(await xcmTransact(collectives.api, PARA.assetHub, Binary.fromHex(whitelistCall), "Xcm").getEncodedData());
  const fellowshipSubmit = hex(await collectives.api.tx.FellowshipReferenda.submit({
    proposal_origin: Enum("FellowshipOrigins", Enum("Fellows")),
    proposal: Enum("Inline", Binary.fromHex(fellowshipXcm)),
    enactment_moment: Enum("After", 10),
  }).getEncodedData());

  const notePreimage = hex(await ah.api.tx.Preimage.note_preimage({ bytes: Binary.fromHex(refPreimage) }).getEncodedData());
  const referendaSubmit = p.enactAt == null ? null : hex(await ah.api.tx.Referenda.submit({
    proposal_origin: Enum("Origins", Enum("WhitelistedCaller")),
    proposal: Enum("Lookup", { hash: refPreimageHash, len: byteLen(refPreimage) }),
    enactment_moment: Enum("At", p.enactAt),
  }).getEncodedData());

  return {
    inner: {
      assetHubAllowance: hex(await calls[0].getEncodedData()),
      assetHubDispatcher: hex(await calls[1].getEncodedData()),
      peopleAllowance: hex(peopleAllowance),
      assetHubXcmToPeople: hex(await calls[2].getEncodedData()),
      grantNamesCalldata,
      assetHubGrantNames: hex(await calls[3].getEncodedData()),
      bulletinAddAuthorizer: hex(bulletinAddAuthorizer),
      assetHubXcmToBulletin: hex(await calls[4].getEncodedData()),
    },
    rootBatch, rootBatchLen: byteLen(rootBatch), rootBatchHash,
    refPreimage, refPreimageLen: byteLen(refPreimage), refPreimageHash,
    fellowship: { whitelistCall, xcmToAssetHub: fellowshipXcm, submit: fellowshipSubmit },
    submission: { notePreimage, referendaSubmit },
  };
}

// Revive read-only contract call (ReviveApi.call), returning the raw return data or throwing on revert.
export async function ethCall(ah, to, data) {
  const origin = ss58("0x" + "00".repeat(32));
  const r = await ah.api.apis.ReviveApi.call(origin, to, 0n, undefined, undefined, Binary.fromHex(data), { at: ah.at });
  if (!r.result.success) throw new Error(`ReviveApi.call ${to} failed: ${json(r.result.value)}`);
  if (r.result.value.flags & 1) throw new Error(`ReviveApi.call ${to} reverted: ${hex(r.result.value.data)}`);
  return hex(r.result.value.data);
}

export const eventNames = (events) => events.map((e) => `${e.type}.${e.value.type}`);
export const pickEvents = (events, pallet, name) =>
  events.filter((e) => e.type === pallet && (!name || e.value.type === name)).map((e) => e.value.value);

// Reports PASS/FAIL lines and keeps the exit code.
export function checklist() {
  const rows = [];
  const check = (ok, label, detail = "") => { rows.push({ ok, label, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`); return ok; };
  const info = (label, detail = "") => { rows.push({ ok: null, label, detail }); console.log(`info  ${label}${detail ? `  (${detail})` : ""}`); };
  return { rows, check, info, failed: () => rows.some((r) => r.ok === false) };
}

export const markdownRows = (rows) =>
  ["| | Check | Detail |", "|---|---|---|", ...rows.map((r) => `| ${r.ok === null ? "·" : r.ok ? "✅" : "❌"} | ${r.label} | ${r.detail.replaceAll("|", "\\|")} |`)].join("\n");

export { Enum, Binary };
