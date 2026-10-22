/**
 * The slice of the DotNS contracts the commands read or decode: ABIs, and read-only calls through `ReviveApi.call`.
 * Solidity encoding is done with viem.
 */
import type { HexString } from "polkadot-api";
import {
  type Abi,
  type ContractFunctionArgs,
  type ContractFunctionName,
  decodeFunctionResult,
  encodeFunctionData,
  parseAbi,
} from "viem";
import type { Chain } from "./chains.ts";
import { fromHex, toHex, toJson, toSs58 } from "./format.ts";

/** Name whitelist calls the decoder recognises in `Revive.call` calldata. */
export const WHITELIST_ABI = parseAbi(["function grantNames(string[] labels, address user)"]);
/** The dispatcher is an upgradeable proxy; its owner can upgrade it. */
export const OWNABLE_ABI = parseAbi(["function owner() view returns (address)"]);

/** ERC-1967 implementation slot of an upgradeable proxy. */
const ERC1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

/** Revive flag set on reverted calls. */
const REVERT_FLAG = 1;

/** Any account works as the origin of a read-only call. */
const READ_ORIGIN = toSs58(`0x${"00".repeat(32)}`);

/** Calls a view function on Asset Hub and decodes its result. Throws on a failed or reverted call. */
export async function readContract<
  const abi extends Abi,
  name extends ContractFunctionName<abi, "view">,
  args extends ContractFunctionArgs<abi, "view", name>,
>(ah: Chain<"assetHub">, address: HexString, abi: abi, functionName: name, args: args) {
  const data = encodeFunctionData({ abi, functionName, args } as never);
  const r = await ah.api.apis.ReviveApi.call(READ_ORIGIN, address, 0n, undefined, undefined, fromHex(data), {
    at: ah.at,
  });
  if (!r.result.success) throw new Error(`ReviveApi.call ${address} ${functionName} failed: ${toJson(r.result.value)}`);
  if (r.result.value.flags & REVERT_FLAG)
    throw new Error(`ReviveApi.call ${address} ${functionName} reverted: ${toHex(r.result.value.data)}`);
  return decodeFunctionResult({ abi, functionName, data: toHex(r.result.value.data) } as never) as ReturnType<
    typeof decodeFunctionResult<abi, name>
  >;
}

/** Code hash of the contract at `address`, or undefined when it is not a contract. */
export async function codeHashOf(ah: Chain<"assetHub">, address: HexString): Promise<HexString | undefined> {
  const info = await ah.api.query.Revive.AccountInfoOf.getValue(address, { at: ah.at });
  return info?.account_type.type === "Contract" ? info.account_type.value.code_hash : undefined;
}

/** Implementation address of an ERC-1967 proxy, or undefined when the slot is empty. */
export async function implementationOf(ah: Chain<"assetHub">, proxy: HexString): Promise<HexString | undefined> {
  const slot = await ah.api.apis.ReviveApi.get_storage(proxy, ERC1967_IMPLEMENTATION_SLOT, { at: ah.at });
  if (!slot.success || !slot.value) return undefined;
  return `0x${toHex(slot.value).slice(-40)}`;
}
