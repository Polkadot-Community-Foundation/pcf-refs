import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadProposal, type Params, requirePinned } from "../src/lib/proposal.ts";

/** Copies the app-onboarding proposal to a temp folder with `edit` applied to its params. */
function withParams(edit: (p: Params) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "pcf-refs-test-"));
  cpSync("proposals/app-onboarding", dir, { recursive: true });
  const params = JSON.parse(readFileSync(join(dir, "params.json"), "utf8")) as Params;
  edit(params);
  writeFileSync(join(dir, "params.json"), JSON.stringify(params));
  return dir;
}

describe("loadProposal", () => {
  it("loads the committed proposal", () => {
    assert.equal(loadProposal("proposals/app-onboarding").params.names.length, 3);
  });

  it("rejects a malformed H160", () => {
    assert.throws(() => loadProposal(withParams((p) => (p.namesOwner = "0x1234"))), /namesOwner/);
  });

  it("rejects a bad SS58 account", () => {
    assert.throws(() => loadProposal(withParams((p) => (p.attester = "not-an-address"))));
  });

  it("rejects labels that are not bare lowercase", () => {
    assert.throws(() => loadProposal(withParams((p) => (p.names = ["GetCash"]))), /names/);
  });

  it("rejects a non-positive allowance", () => {
    assert.throws(() => loadProposal(withParams((p) => (p.count = 0))), /count/);
  });
});

describe("requirePinned", () => {
  it("refuses params without an enactment block", () => {
    const { params } = loadProposal(withParams((p) => (p.enactAt = null)));
    assert.throws(() => requirePinned(params), /npm run pin/);
  });
});
