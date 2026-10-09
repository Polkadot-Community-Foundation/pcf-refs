import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withTimeout } from "../src/lib/timeout.ts";

describe("withTimeout", () => {
  it("resolves with the work's value when it completes in time", async () => {
    assert.equal(await withTimeout("work", 1_000, Promise.resolve(42)), 42);
  });

  it("rejects with a message naming the work when it does not", async () => {
    await assert.rejects(
      withTimeout("dev_newBlock", 10, new Promise(() => {})),
      /dev_newBlock did not complete within 0.01 s/,
    );
  });
});
