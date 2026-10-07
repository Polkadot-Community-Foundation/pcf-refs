import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blake2, byteLength, formatDot, sameAccount, toJson, toSs58 } from "../src/lib/format.ts";

const ATTESTER = "15sDLj4T9NnCtT665koDMxBs1PZw3rzDc6wcz9tN9kKTQ2zj";
const ATTESTER_HEX = "0xd73cbe95c22972969358215bd2380a16fb696a2154f1b1777d3dada8e94cab0d";

describe("format", () => {
  it("blake2 of empty input", () => {
    assert.equal(blake2("0x"), "0x0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8");
  });

  it("normalizes account ids to Polkadot SS58", () => {
    assert.equal(toSs58(ATTESTER_HEX), ATTESTER);
    assert.equal(toSs58(ATTESTER), ATTESTER);
    assert.ok(sameAccount(ATTESTER, ATTESTER_HEX));
    assert.throws(() => toSs58("0x1234"));
  });

  it("serializes bigints and bytes", () => {
    assert.equal(toJson({ a: 1n, b: new Uint8Array([1, 255]) }), '{"a":"1","b":"0x01ff"}');
  });

  it("formats sizes and amounts", () => {
    assert.equal(byteLength("0x0102"), 2);
    assert.equal(formatDot(100_000_000_000_000n), "10,000 DOT");
  });
});
