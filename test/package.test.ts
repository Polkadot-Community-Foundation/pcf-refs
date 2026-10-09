import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { getOfflineApi } from "polkadot-api";
import { descriptors } from "../src/lib/chains.ts";
import { blake2, toJson } from "../src/lib/format.ts";
import { buildPackage, type GovernancePackage } from "../src/lib/package.ts";
import { loadProposal, requirePinned } from "../src/lib/proposal.ts";

const proposals = readdirSync("proposals")
  .map((name) => `proposals/${name}`)
  .filter((dir) => existsSync(`${dir}/params.json`));

/** Runtimes described by the committed metadata in .papi/. */
const committed = {
  assetHub: (await getOfflineApi(descriptors.assetHub)).constants.System.Version.spec_version,
  people: (await getOfflineApi(descriptors.people)).constants.System.Version.spec_version,
  bulletin: (await getOfflineApi(descriptors.bulletin)).constants.System.Version.spec_version,
  collectives: (await getOfflineApi(descriptors.collectives)).constants.System.Version.spec_version,
};

describe("buildPackage", () => {
  for (const dir of proposals) {
    const published = JSON.parse(readFileSync(`${dir}/calls.json`, "utf8")) as GovernancePackage;
    // A proposal encoded for older runtimes cannot be reproduced from newer metadata.
    const skip = toJson(published.runtimes) === toJson(committed) ? false : `encoded for ${toJson(published.runtimes)}`;

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
        published.submission.referendaSubmit.includes(published.refPreimageHash.slice(2)),
        "referendum looks up the preimage",
      );
    });
  }
});
