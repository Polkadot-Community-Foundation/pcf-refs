/**
 * Renders SCALE call data as a readable tree, using the metadata of the live chain rather than the committed
 * descriptors, so the decoding is independent of the encoder. It follows the nested calls this package uses:
 * `Utility` batches, the whitelisted dispatch, XCM `Transact` (decoded with the destination chain's metadata),
 * Revive calls (Solidity calldata decoded with the DotNS ABI) and referendum submissions.
 */
import type { HexString } from "polkadot-api";
import { decodeFunctionData, type Hex } from "viem";
import { CHAIN_NAMES, type Chain, type ChainKey, chainOfPara } from "./chains.ts";
import { WHITELIST_ABI } from "./dotns.ts";
import { blake2, byteLength, fromHex, toHex, toJson } from "./format.ts";

interface DecodedCall {
  type: string;
  value: { type: string; value: unknown };
}

/** Facts the decoder extracts while walking, for cross-checks against calls.json. */
export interface DecodeFacts {
  /** Hash of the call dispatched by `dispatch_whitelisted_call_with_preimage`. */
  dispatchedHash?: HexString;
  /** Hash passed to `Whitelist.whitelist_call`. */
  whitelistedHash?: HexString;
}

/** Chains the decoder may need, keyed like `ChainKey`. */
export type DecodeChains = Partial<{ [K in ChainKey]: Chain<K> }>;

export class CallDecoder {
  readonly facts: DecodeFacts = {};
  private lines: string[] = [];
  private readonly chains: DecodeChains;

  constructor(chains: DecodeChains) {
    this.chains = chains;
  }

  /** Decodes `callData` on `chain` and returns the tree as Markdown list lines. */
  async render(chain: ChainKey, callData: HexString): Promise<string[]> {
    this.lines = [];
    await this.call(chain, callData, 0);
    return this.lines;
  }

  private say(depth: number, text: string): void {
    this.lines.push(`${"  ".repeat(depth)}- ${text}`);
  }

  private async call(chain: ChainKey, callData: HexString, depth: number): Promise<void> {
    const target = this.chains[chain];
    if (!target) throw new Error(`no connection to ${chain} to decode ${callData.slice(0, 20)}…`);
    const tx = await target.api.txFromCallData(fromHex(callData));
    await this.walk(chain, tx.decodedCall as DecodedCall, depth, callData);
  }

  private async walk(chain: ChainKey, call: DecodedCall, depth: number, callData?: HexString): Promise<void> {
    const pallet = call.type;
    const name = call.value.type;
    // biome-ignore lint/suspicious/noExplicitAny: arguments are walked generically across pallets
    const args = (call.value.value ?? {}) as any;
    const label = `**${CHAIN_NAMES[chain]}** \`${pallet}.${name}\``;
    const json = (v: unknown) => `\`${toJson(v)}\``;

    if (pallet === "Utility" && ["batch", "batch_all", "force_batch"].includes(name)) {
      this.say(depth, `${label}: ${args.calls.length} calls${name === "batch_all" ? ", all or nothing" : ""}`);
      for (const inner of args.calls) await this.walk(chain, inner, depth + 1);
    } else if (pallet === "Whitelist" && name === "dispatch_whitelisted_call_with_preimage") {
      // The argument is the boxed call itself: the dispatched bytes are this call minus its 2-byte call index.
      const inner: HexString | undefined = callData ? `0x${callData.slice(6)}` : undefined;
      if (inner) this.facts.dispatchedHash = blake2(inner);
      const what = inner ? `\`${blake2(inner)}\` (${byteLength(inner)} B)` : "(hash not computed for a nested call)";
      this.say(depth, `${label}: dispatches with Root the call whose hash the Fellowship whitelisted, ${what}`);
      await this.walk(chain, args.call, depth + 1);
    } else if (pallet === "Whitelist" && name === "whitelist_call") {
      this.facts.whitelistedHash = args.call_hash;
      this.say(depth, `${label}: whitelists call hash \`${args.call_hash}\``);
    } else if (pallet === "PolkadotXcm" && name === "send") {
      const para: number | undefined = args.dest.value.interior.value?.value;
      const dest = para === undefined ? undefined : chainOfPara(para);
      this.say(
        depth,
        `${label} to parachain ${para} (${dest ? CHAIN_NAMES[dest] : "unknown"}), parents ${args.dest.value.parents}`,
      );
      for (const instruction of args.message.value) {
        if (instruction.type !== "Transact") {
          this.say(depth + 1, `XCM \`${instruction.type}\` ${json(instruction.value)}`);
          continue;
        }
        this.say(depth + 1, `XCM \`Transact\`, origin kind \`${instruction.value.origin_kind.type}\``);
        const inner = toHex(instruction.value.call);
        if (dest) await this.call(dest, inner, depth + 2);
        else this.say(depth + 2, `undecoded call \`${inner}\``);
      }
    } else if (pallet === "Revive" && name === "call") {
      const data = toHex(args.data) as Hex;
      this.say(
        depth,
        `${label} to contract \`${args.dest}\`, value ${args.value}, weight limit ${json(args.weight_limit)}, storage deposit limit ${args.storage_deposit_limit}`,
      );
      try {
        const decoded = decodeFunctionData({ abi: WHITELIST_ABI, data });
        this.say(depth + 1, `Solidity \`${decoded.functionName}\` ${json(decoded.args)}`);
      } catch {
        this.say(depth + 1, `calldata \`${data}\` (not a DotNS whitelist call)`);
      }
    } else if (pallet === "FellowshipReferenda" && name === "submit") {
      const origin = `${args.proposal_origin.type}.${args.proposal_origin.value.type}`;
      const enactment = `${args.enactment_moment.type}(${args.enactment_moment.value})`;
      this.say(depth, `${label}: track origin \`${origin}\`, enactment \`${enactment}\``);
      if (args.proposal.type === "Inline") await this.call(chain, toHex(args.proposal.value), depth + 1);
      else this.say(depth + 1, `proposal ${json(args.proposal)}`);
    } else if (pallet === "Referenda" && name === "submit") {
      const origin = `${args.proposal_origin.type}.${args.proposal_origin.value.type}`;
      const enactment = `${args.enactment_moment.type}(${args.enactment_moment.value})`;
      this.say(
        depth,
        `${label}: track origin \`${origin}\`, proposal \`${args.proposal.type}\` ${json(args.proposal.value)}, enactment \`${enactment}\``,
      );
    } else {
      this.say(depth, `${label} ${json(args)}`);
    }
  }
}
