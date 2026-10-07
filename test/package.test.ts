import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { blake2, toJson } from "../src/lib/format.ts";
import { buildPackage } from "../src/lib/package.ts";
import { loadProposal, requirePinned } from "../src/lib/proposal.ts";

const proposals = readdirSync("proposals").map((name) => `proposals/${name}`);

describe("buildPackage", () => {
  for (const dir of proposals) {
    it(`reproduces ${dir}/calls.json byte for byte, offline`, async () => {
      const proposal = loadProposal(dir);
      const pkg = await buildPackage(requirePinned(proposal.params));
      const committed = readFileSync(proposal.path("calls.json"), "utf8");
      assert.equal(`${toJson(pkg, 2)}\n`, committed);
    });

    it(`${dir}: hashes and wrapping are consistent`, async () => {
      const pkg = await buildPackage(requirePinned(loadProposal(dir).params));
      assert.equal(pkg.rootBatchHash, blake2(pkg.rootBatch));
      assert.equal(pkg.refPreimageHash, blake2(pkg.refPreimage));
      // The preimage is the whitelisted dispatch of the batch: a 2-byte call index, then the batch itself.
      assert.equal(`0x${pkg.refPreimage.slice(6)}`, pkg.rootBatch);
      assert.ok(
        pkg.fellowship.whitelistCall.endsWith(pkg.rootBatchHash.slice(2)),
        "Fellowship whitelists the batch hash",
      );
      assert.ok(
        pkg.submission.referendaSubmit.includes(pkg.refPreimageHash.slice(2)),
        "referendum looks up the preimage",
      );
    });
  }
});
