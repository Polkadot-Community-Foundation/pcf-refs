import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { getOfflineApi, getTypedCodecs, type HexString } from "polkadot-api";
import { type ChainKey, descriptors, PARA } from "../src/lib/chains.ts";
import { blake2, fromHex, toHex, toJson, toSs58 } from "../src/lib/format.ts";
import { buildPackage, type GovernancePackage } from "../src/lib/package.ts";
import { DEFAULT_PROPOSAL, loadProposal, requirePinned } from "../src/lib/proposal.ts";
import { siblingLocation } from "../src/lib/xcm.ts";

/** `spec_version` of the runtime the committed metadata in .papi/ describes. */
const committedSpec = async (chain: ChainKey): Promise<number> =>
  (await getOfflineApi(descriptors[chain])).constants.System.Version.spec_version;

const proposals = await Promise.all(
  readdirSync("proposals")
    .map((name) => `proposals/${name}`)
    .filter((dir) => existsSync(`${dir}/params.json`))
    .map(async (dir) => {
      const published = JSON.parse(readFileSync(`${dir}/calls.json`, "utf8")) as GovernancePackage;
      const runtimes = Object.keys(published.runtimes) as ChainKey[];
      const committed = Object.fromEntries(
        await Promise.all(runtimes.map(async (chain) => [chain, await committedSpec(chain)])),
      );
      // A proposal encoded for older runtimes cannot be reproduced from newer metadata.
      const skip =
        toJson(published.runtimes) === toJson(committed) ? false : `encoded for ${toJson(published.runtimes)}`;
      return { dir, published, skip };
    }),
);

describe("buildPackage", () => {
  for (const { dir, published, skip } of proposals) {
    it(`reproduces ${dir}/calls.json byte for byte, offline`, { skip }, async () => {
      const pkg = await buildPackage(requirePinned(loadProposal(dir).params));
      assert.equal(`${toJson(pkg, 2)}\n`, readFileSync(`${dir}/calls.json`, "utf8"));
    });

    it(`${dir}: hashes and wrapping are consistent`, () => {
      assert.equal(published.rootBatchHash, blake2(published.rootBatch));
      assert.equal(published.refPreimageHash, blake2(published.refPreimage));
      // The preimage is the whitelisted dispatch of the batch: a 2-byte call index, then the batch itself.
      assert.equal(`0x${published.refPreimage.slice(6)}`, published.rootBatch);
      assert.ok(
        published.fellowship.whitelistCall.endsWith(published.rootBatchHash.slice(2)),
        "Fellowship whitelists the batch hash",
      );
      assert.ok(
        published.fellowship.xcmToAssetHub.includes(published.fellowship.assetHubCall.slice(2)),
        "Fellowship XCM carries the Asset Hub call",
      );
      assert.ok(
        published.submission.referendaSubmit.includes(published.refPreimageHash.slice(2)),
        "referendum looks up the preimage",
      );
    });
  }
});

type DecodedCall = { type: string; value: { type: string; value: Record<string, unknown> } };
type XcmInstruction = { type: string; value: { origin_kind?: { type: string }; call?: Uint8Array } };

const [ah, people, ahCodecs, peopleCodecs] = await Promise.all([
  getOfflineApi(descriptors.assetHub),
  getOfflineApi(descriptors.people),
  getTypedCodecs(descriptors.assetHub),
  getTypedCodecs(descriptors.people),
]);

/** Splits call data into its 2-byte call index and its arguments. */
const splitCall = (call: Uint8Array) => ({ index: toHex(call.slice(0, 2)), args: call.slice(2) });

/** Decodes a `Utility.batch_all` with the committed Asset Hub metadata, without a connection. */
function decodeBatch(rootBatch: HexString): DecodedCall[] {
  const { index, args } = splitCall(fromHex(rootBatch));
  assert.equal(index, splitCall(ah.tx.Utility.batch_all({ calls: [] }).encodedData).index, "Utility.batch_all");
  return ahCodecs.tx.Utility.batch_all.dec(args).calls as unknown as DecodedCall[];
}

describe(`${DEFAULT_PROPOSAL} inner call`, () => {
  const { published, skip } = proposals.find((p) => p.dir === DEFAULT_PROPOSAL) ?? assert.fail(DEFAULT_PROPOSAL);
  const params = requirePinned(loadProposal(DEFAULT_PROPOSAL).params);
  const attester = toSs58(params.attester);

  it("is encoded for Asset Hub, People and Collectives only", () => {
    assert.deepEqual(Object.keys(published.runtimes), ["assetHub", "people", "collectives"]);
  });

  const batches = [
    ["encoded from params.json", async () => (await buildPackage(params)).rootBatch, false],
    ["committed in calls.json", async () => published.rootBatch, skip],
  ] as const;
  for (const [what, rootBatch, skipBatch] of batches) {
    it(`${what}: batches exactly the three onboarding calls, in order`, { skip: skipBatch }, async () => {
      const calls = decodeBatch(await rootBatch());
      assert.deepEqual(
        calls.map((c) => `${c.type}.${c.value.type}`),
        ["DotnsGateway.increase_attestation_allowance", "DotnsGateway.set_dispatcher_address", "PolkadotXcm.send"],
      );
    });

    it(`${what}: sends one XCM, to People, granting the attester allowance`, { skip: skipBatch }, async () => {
      const sends = decodeBatch(await rootBatch()).filter((c) => c.type === "PolkadotXcm" && c.value.type === "send");
      assert.deepEqual(
        sends.map((c) => c.value.value.dest),
        [siblingLocation(PARA.people)],
      );
      const send = sends[0] ?? assert.fail("no XCM");
      const message = (send.value.value.message as { value: XcmInstruction[] }).value;
      assert.deepEqual(
        message.map((i) => i.type),
        ["UnpaidExecution", "Transact"],
      );
      const transact = message[1]?.value ?? assert.fail("no Transact");
      assert.equal(transact.origin_kind?.type, "Superuser");
      const { index, args } = splitCall(transact.call ?? assert.fail("no call in Transact"));
      const allowance = people.tx.PeopleLite.increase_attestation_allowance({ account: attester, count: params.count });
      assert.equal(index, splitCall(allowance.encodedData).index, "PeopleLite.increase_attestation_allowance");
      assert.deepEqual(peopleCodecs.tx.PeopleLite.increase_attestation_allowance.dec(args), {
        account: attester,
        count: params.count,
      });
    });
  }
});

describe(`${DEFAULT_PROPOSAL} Fellowship call`, () => {
  const { published } = proposals.find((p) => p.dir === DEFAULT_PROPOSAL) ?? assert.fail(DEFAULT_PROPOSAL);
  const params = requirePinned(loadProposal(DEFAULT_PROPOSAL).params);

  it("removes every superseded call hash from the whitelist, then whitelists the inner call", async () => {
    const { index, args } = splitCall(fromHex(published.fellowship.assetHubCall));
    assert.equal(index, splitCall(ah.tx.Utility.batch_all({ calls: [] }).encodedData).index, "Utility.batch_all");
    const calls = ahCodecs.tx.Utility.batch_all.dec(args).calls as unknown as DecodedCall[];
    assert.deepEqual(
      calls.map((c) => [`${c.type}.${c.value.type}`, c.value.value.call_hash]),
      [
        ...params.supersedes.map((hash) => ["Whitelist.remove_whitelisted_call", hash]),
        ["Whitelist.whitelist_call", published.rootBatchHash],
      ],
    );
  });

  it("supersedes version 2", () => {
    assert.deepEqual(params.supersedes, ["0x90640a174e1d62b5645f31cb053d562e95a63881fd1e0f9197edbbcf83e21fad"]);
  });
});
