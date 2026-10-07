/**
 * Small, dependency-light helpers for hex, hashes, accounts and human-readable output.
 * Byte values are `Uint8Array` throughout, as in polkadot-api 3; hex strings appear only at the edges
 * (JSON files, Markdown, console).
 */
import { Blake2256 } from "@polkadot-api/substrate-bindings";
import { AccountId, Binary, type HexString, type SS58String } from "polkadot-api";

/** SS58 prefix of Polkadot and its system chains. */
const POLKADOT_SS58_PREFIX = 0;
const accountCodec = AccountId(POLKADOT_SS58_PREFIX);

export const toHex = (bytes: Uint8Array): HexString => Binary.toHex(bytes);
export const fromHex = (hex: HexString): Uint8Array => Binary.fromHex(hex);

/** Blake2-256 of SCALE bytes given as hex: the call hash used by the Whitelist and Preimage pallets. */
export const blake2 = (hex: HexString): HexString => toHex(Blake2256(fromHex(hex)));

/** Number of bytes in a 0x-prefixed hex string. */
export const byteLength = (hex: HexString): number => (hex.length - 2) / 2;

/** Normalizes an SS58 address (any prefix) or a 0x-prefixed 32-byte account id to a Polkadot SS58 address. */
export function toSs58(account: string): SS58String {
  const bytes = account.startsWith("0x") ? fromHex(account) : accountCodec.enc(account);
  if (bytes.length !== 32) throw new Error(`not a 32-byte account: ${account}`);
  return accountCodec.dec(bytes);
}

export const sameAccount = (a: string, b: string): boolean => toSs58(a) === toSs58(b);

export const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** `JSON.stringify` that renders bigints as decimal strings and byte arrays as hex. */
export const toJson = (value: unknown, space?: number): string =>
  JSON.stringify(
    value,
    (_, v) => (typeof v === "bigint" ? v.toString() : v instanceof Uint8Array ? toHex(v) : v),
    space,
  );

/** Planck (10 decimals) to a DOT amount for display. */
export const formatDot = (planck: bigint): string =>
  `${(Number(planck) / 1e10).toLocaleString("en-US", { maximumFractionDigits: 4 })} DOT`;

export const formatCount = (n: number): string => n.toLocaleString("en-US");
