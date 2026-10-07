// End-to-end probe on a Chopsticks fork of live Asset Hub, People, Bulletin and Collectives, connected over XCM:
//   1. the Fellowship referendum enacts on Collectives (scheduled with the Fellows origin) and whitelists the call
//      on Asset Hub;
//   2. the Whitelisted Caller referendum enacts on Asset Hub (preimage noted, scheduled by Lookup with the
//      WhitelistedCaller origin, as Referenda does at At(enactAt));
//   3. People and Bulletin receive and execute their XCMs;
//   4. the post-enactment checks of verify run on the forked state.
// Voting is not simulated. Chopsticks runs each chain's real runtime on live state, but it does not run collators
// or relay inclusion. Writes REHEARSAL.md.
// Usage: node src/rehearse.mjs [--proposal <dir>] [--keep]
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bytes } from "@polkadot-api/substrate-bindings";
import { loadProposal, connect, readJson, checklist, markdownRows, flag, json, hex, bytes, PARA } from "./lib.mjs";
import { enactedChecks } from "./checks.mjs";

const { p, out } = loadProposal();
const calls = readJson(out("calls.json"));
const chains = ["assetHub", "people", "bulletin", "collectives"];
const ports = Object.fromEntries(chains.map((k, i) => [k, Number(process.env.REHEARSE_PORT_BASE ?? 8100) + i]));
const local = Object.fromEntries(chains.map((k) => [k, `ws://127.0.0.1:${ports[k]}`]));

const dir = mkdtempSync(join(tmpdir(), "pcf-governance-"));
const configs = chains.map((k) => {
  const f = join(dir, `${k}.yml`);
  writeFileSync(f, `endpoint: ${p.endpoints[k]}\nport: ${ports[k]}\nmock-signature-host: true\nruntime-log-level: 0\n`);
  return f;
});
const bin = new URL("../node_modules/.bin/chopsticks", import.meta.url).pathname;
const proc = spawn(bin, ["xcm", ...configs.flatMap((f) => ["-p", f])], { stdio: ["ignore", "pipe", "pipe"] });
let log = "";
const ready = new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`chopsticks did not start in 5 min:\n${log.slice(-2000)}`)), 300_000);
  const onData = (d) => { log += d; if (log.includes("Connected parachains")) { clearTimeout(t); resolve(); } };
  proc.stdout.on("data", onData); proc.stderr.on("data", onData);
  proc.on("exit", (code) => reject(new Error(`chopsticks exited with ${code}:\n${log.slice(-2000)}`)));
});
const stop = () => { if (!flag("keep")) { proc.kill(); rmSync(dir, { recursive: true, force: true }); } };

const { check, info, rows, failed } = checklist();
let c;
try {
  console.log("starting chopsticks (forking live state, takes a minute)…");
  await ready;

  c = await connect(local, chains);
  const rpc = (k, method, params) => c[k].client._request(method, params);
  const newBlock = (k) => rpc(k, "dev_newBlock", [{ count: 1 }]);
  // Reads go to the fork's head: papi's own view can trail the blocks built through dev_newBlock.
  const query = async (k, pallet, item, ...keys) => {
    const hash = await rpc(k, "chain_getBlockHash", []);
    return c[k].api.query[pallet][item].getValue(...keys, { at: hash });
  };
  // The scheduler keys its agenda by local or relay block number depending on the runtime; follow IncompleteSince.
  const nextAgendaBlock = async (k) => {
    const [since, relayNow, localNow] = await Promise.all([
      query(k, "Scheduler", "IncompleteSince"),
      query(k, "ParachainSystem", "LastRelayChainBlockNumber"),
      query(k, "System", "Number"),
    ]);
    return (Math.abs(since - relayNow) < Math.abs(since - localNow) ? relayNow : localNow) + 1;
  };
  const events = async (k, number) => {
    const hash = await rpc(k, "chain_getBlockHash", number === undefined ? [] : [number]);
    return (await c[k].api.query.System.Events.getValue({ at: hash })).map((e) => e.event);
  };
  const names = (evs) => evs.map((e) => `${e.type}.${e.value.type}`);
  // Chopsticks builds catch-up blocks right after connecting the chains; storage set during one of them is lost.
  // dev_newBlock queues behind them, so one block per chain settles the forks before anything is injected.
  await Promise.all(chains.map(newBlock));

  // 1. Fellowship referendum enacts on Collectives.
  const collAt = await nextAgendaBlock("collectives");
  await rpc("collectives", "dev_setStorage", [{
    Scheduler: { Agenda: [[[collAt], [{ call: { Inline: calls.fellowship.xcmToAssetHub }, origin: { FellowshipOrigins: "Fellows" } }]]] },
  }]);
  await newBlock("collectives");
  const collEv = await events("collectives");
  check(names(collEv).includes("PolkadotXcm.Sent"), "Collectives: Fellowship proposal enacted, XCM sent to Asset Hub", names(collEv).filter((e) => !e.startsWith("System") && !e.startsWith("ParachainSystem")).join(", "));
  let whitelisted;
  for (let i = 0; i < 3 && whitelisted === undefined; i++) {
    await newBlock("assetHub");
    whitelisted = await query("assetHub", "Whitelist", "WhitelistedCall", calls.rootBatchHash);
  }
  check(whitelisted !== undefined, "Asset Hub: inner call hash whitelisted", calls.rootBatchHash);

  // 2. Whitelisted Caller referendum enacts on Asset Hub.
  const before = { people: await query("people", "System", "Number"), bulletin: await query("bulletin", "System", "Number") };
  const ahAt = await nextAgendaBlock("assetHub");
  await rpc("assetHub", "dev_setStorage", [{
    Preimage: {
      // Chopsticks takes a hex value as already SCALE-encoded, so the bytes carry their compact length prefix.
      PreimageFor: [[[[calls.refPreimageHash, calls.refPreimageLen]], hex(Bytes().enc(bytes(calls.refPreimage)))]],
      RequestStatusFor: [[[calls.refPreimageHash], { Requested: { maybeTicket: null, count: 1, maybeLen: calls.refPreimageLen } }]],
    },
    Scheduler: { Agenda: [[[ahAt], [{ call: { Lookup: { hash: calls.refPreimageHash, len: calls.refPreimageLen } }, origin: { Origins: "WhitelistedCaller" } }]]] },
  }]);
  await newBlock("assetHub");
  const ahEv = await events("assetHub");
  const dispatched = ahEv.find((e) => e.type === "Scheduler" && e.value.type === "Dispatched");
  check(Boolean(dispatched?.value.value.result.success), "Asset Hub: referendum enacted with WhitelistedCaller", json(dispatched?.value.value.result ?? names(ahEv)));
  check(names(ahEv).includes("Whitelist.WhitelistedCallDispatched"), "Asset Hub: Whitelist.WhitelistedCallDispatched");
  const wd = ahEv.find((e) => e.type === "Whitelist" && e.value.type === "WhitelistedCallDispatched");
  if (wd) check(wd.value.value.result.success, "Asset Hub: inner batch succeeded inside the whitelisted dispatch", json(wd.value.value.result));
  info("Asset Hub events", names(ahEv).filter((e) => !/^(System|ParachainSystem|Balances|TransactionPayment)\./.test(e)).join(", "));

  // 3. People and Bulletin process their XCMs. Chopsticks may build the receiving block itself, so every block since
  // the enactment is scanned.
  for (const [k, pallet, event] of [["people", "PeopleLite", "AttestationAllowanceIncreased"], ["bulletin", "TransactionStorage", "AuthorizerAdded"]]) {
    let hit;
    for (let i = 0; i < 3 && !hit; i++) {
      await newBlock(k);
      const head = await query(k, "System", "Number");
      for (let n = before[k] + 1; n <= head && !hit; n++)
        if (names(await events(k, n)).includes(`${pallet}.${event}`)) hit = n;
    }
    check(Boolean(hit), `${k}: ${pallet}.${event} after XCM delivery`, hit ? `block #${hit}` : "not seen");
  }

  // 4. Post-enactment state on the fork.
  c.close();
  c = await connect(local, ["assetHub", "people", "bulletin"]);
  await enactedChecks(c, p, { check, info });
} catch (e) {
  check(false, "rehearsal ran to completion", e.message.split("\n")[0]);
} finally {
  c?.close();
  stop();
}

const md = [`# Rehearsal (Chopsticks): ${p.title}`, "",
  "End-to-end probe by `src/rehearse.mjs` on a Chopsticks fork of live Asset Hub, People, Bulletin and Collectives. " +
  "The Fellowship referendum and the Whitelisted Caller referendum are enacted through the scheduler with their real origins; voting is not simulated.", "",
  `Inner call hash \`${calls.rootBatchHash}\`, preimage hash \`${calls.refPreimageHash}\`, parachains ${Object.values(PARA).join(", ")}.`, "",
  markdownRows(rows), ""];
writeFileSync(out("REHEARSAL.md"), md.join("\n"));
console.log(`\n${failed() ? "REHEARSAL FAILED" : "rehearsal green"}; wrote ${out("REHEARSAL.md")}`);
process.exit(failed() ? 1 : 0);
