// Encodes the governance package from params.json against live metadata and writes calls.json.
// Nothing is signed or submitted. calls.json depends only on params.json and the runtimes, so re-running this
// against the same runtimes must leave it unchanged (`git diff --exit-code`).
// Usage: node src/encode.mjs [--proposal <dir>] [--pin | --check]
// --check re-encodes and compares with the committed calls.json instead of writing it (exit 1 on any difference).
// --pin fills a null bulletin.validUntil (current Bulletin block + validDays) and enactAt (current relay block +
// enactInDays) and writes them back to params.json. Hashes are only publishable once both are pinned.
import { writeFileSync, readFileSync } from "node:fs";
import { loadProposal, connect, buildPackage, writeJson, json, flag, DAY, ss58 } from "./lib.mjs";

const { p, out } = loadProposal();
const c = await connect(p.endpoints);
const relayNow = c.relay.block, bulletinNow = c.bulletin.block;

if (p.bulletin.validUntil == null || p.enactAt == null) {
  if (!flag("pin") || flag("check")) {
    console.error("params.json has unpinned values (bulletin.validUntil and/or enactAt). Re-run with --pin to fix them.");
    c.close(); process.exit(2);
  }
  p.bulletin.validUntil ??= bulletinNow + p.bulletin.validDays * DAY;
  p.enactAt ??= relayNow + p.enactInDays * DAY;
  writeFileSync(out("params.json"), json(p, 2) + "\n");
  console.log(`pinned bulletin.validUntil=${p.bulletin.validUntil} enactAt=${p.enactAt} in params.json`);
}
if (p.bulletin.validUntil <= bulletinNow) throw new Error(`bulletin.validUntil ${p.bulletin.validUntil} is not after the current Bulletin block ${bulletinNow}`);
if (p.enactAt <= relayNow) throw new Error(`enactAt ${p.enactAt} is not after the current relay block ${relayNow}`);

const pkg = await buildPackage(c, p);
const deadlines = {
  enactAt: p.enactAt,
  fellowshipSubmitBy: p.enactAt - 8 * DAY, // 7-day Fellowship decision + 1 day margin
  whitelistLandedBy: p.enactAt - DAY,
};
const calls = {
  title: p.title,
  runtimes: { assetHub: c.assetHub.spec, people: c.people.spec, bulletin: c.bulletin.spec, collectives: c.collectives.spec },
  parameters: {
    attester: ss58(p.attester), count: p.count, dispatcher: p.dispatcher,
    names: p.names, namesOwner: p.namesOwner, nameWhitelist: p.dotns.nameWhitelist,
    bulletinAuthorizer: ss58(p.bulletin.authorizer),
    bulletinBudget: { transactions: p.bulletin.transactions, bytes: p.bulletin.bytes, validUntil: p.bulletin.validUntil, feeless: p.bulletin.feeless },
  },
  deadlines,
  ...pkg,
};
if (flag("check")) {
  const same = readFileSync(out("calls.json"), "utf8") === json(calls, 2) + "\n";
  console.log(same ? `calls.json reproduced byte for byte (${calls.rootBatchHash})` : "calls.json DIFFERS from a fresh encoding (runtime or params changed)");
  c.close(); process.exit(same ? 0 : 1);
}
writeJson(out("calls.json"), calls);

const days = (b) => `${((b - relayNow) * 6 / 86400).toFixed(1)} d from now`;
console.log(`runtimes        AH ${c.assetHub.spec}, People ${c.people.spec}, Bulletin ${c.bulletin.spec}, Collectives ${c.collectives.spec}`);
console.log(`rootBatchHash   ${pkg.rootBatchHash}  (${pkg.rootBatchLen} B, what the Fellowship whitelists)`);
console.log(`refPreimageHash ${pkg.refPreimageHash}  (${pkg.refPreimageLen} B, what the Whitelisted Caller referendum looks up)`);
console.log(`enactAt         relay #${p.enactAt} (${days(p.enactAt)})`);
console.log(`fellowship ref  submit by relay #${deadlines.fellowshipSubmitBy} (${days(deadlines.fellowshipSubmitBy)})`);
console.log(`whitelist       on Asset Hub by relay #${deadlines.whitelistLandedBy} (${days(deadlines.whitelistLandedBy)})`);
if (deadlines.fellowshipSubmitBy <= relayNow) console.warn("warning: the Fellowship submission deadline has passed; pin a later enactAt");
console.log(`wrote ${out("calls.json")}`);
c.close(); process.exit(0);
