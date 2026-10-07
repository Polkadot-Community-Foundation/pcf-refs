/**
 * Runs a Chopsticks fork of several chains connected over XCM, and wraps the `dev_*` RPCs the rehearsal uses.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HexString, PolkadotClient } from "polkadot-api";
import type { ChainKey } from "./chains.ts";

const STARTUP_TIMEOUT_MS = 300_000;
/** Printed by `chopsticks xcm` once every chain is up and connected. */
const READY_MARKER = "Connected parachains";

export class Fork {
  /** Local WebSocket endpoint of each forked chain. */
  readonly endpoints: Record<ChainKey, string>;
  private readonly process: ChildProcess;
  private readonly dir: string;

  private constructor(endpoints: Record<ChainKey, string>, process: ChildProcess, dir: string) {
    this.endpoints = endpoints;
    this.process = process;
    this.dir = dir;
  }

  /** Forks `keys` from `upstream` on consecutive ports from `portBase`, and resolves once they are connected. */
  static async start(upstream: Record<ChainKey, string>, keys: readonly ChainKey[], portBase: number): Promise<Fork> {
    const dir = mkdtempSync(join(tmpdir(), "pcf-governance-"));
    const endpoints = { ...upstream };
    const configs = keys.map((key, i) => {
      const port = portBase + i;
      const file = join(dir, `${key}.yml`);
      writeFileSync(
        file,
        `endpoint: ${upstream[key]}\nport: ${port}\nmock-signature-host: true\nruntime-log-level: 0\n`,
      );
      endpoints[key] = `ws://127.0.0.1:${port}`;
      return file;
    });
    const bin = new URL("../../node_modules/.bin/chopsticks", import.meta.url).pathname;
    const child = spawn(bin, ["xcm", ...configs.flatMap((f) => ["-p", f])], { stdio: ["ignore", "pipe", "pipe"] });

    let log = "";
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`chopsticks did not start:\n${log.slice(-2000)}`)),
        STARTUP_TIMEOUT_MS,
      );
      const onData = (chunk: Buffer) => {
        log += chunk;
        if (log.includes(READY_MARKER)) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`chopsticks exited with ${code}:\n${log.slice(-2000)}`));
      });
    });
    return new Fork(endpoints, child, dir);
  }

  stop(): void {
    this.process.kill();
    rmSync(this.dir, { recursive: true, force: true });
  }
}

/** Chopsticks development RPCs on one forked chain. */
export function devRpc(client: PolkadotClient) {
  return {
    /** Builds one block, after any block Chopsticks is already building. */
    newBlock: () => client._request("dev_newBlock", [{ count: 1 }]),
    /**
     * Sets storage at the head, in Chopsticks' `{ Pallet: { Item: [[keys, value]] } }` form. A hex string value is
     * taken as already SCALE-encoded.
     */
    setStorage: (values: Record<string, unknown>) => client._request("dev_setStorage", [values]),
    /** Hash of the head, or of block `number`. papi's own view of the head can trail blocks built with `newBlock`. */
    blockHash: (number?: number) =>
      client._request<HexString>("chain_getBlockHash", number === undefined ? [] : [number]),
  };
}
