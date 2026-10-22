/**
 * A proposal is a folder under `proposals/` with one input, `params.json`, and the files the commands generate next to
 * it. This module defines the params schema, validates it and resolves the folder's paths.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { HexString } from "polkadot-api";
import type { Address } from "viem";
import { descriptors, type Endpoints } from "./chains.ts";
import { toJson, toSs58 } from "./format.ts";

export interface Params {
  title: string;
  endpoints: Endpoints;
  /** Account granted the attestation allowance on Asset Hub and People. */
  attester: string;
  /** Allowance granted on each chain. */
  count: number;
  /** DotNS contract the gateway forwards name reservations to (the PopController proxy). */
  dispatcher: Address;
  /** Inner call hashes of earlier versions, removed from the Asset Hub whitelist by the Fellowship referendum. */
  supersedes: HexString[];
  /** DotNS release the dispatcher address comes from. */
  dotns: { release: string };
  /** Delay used by `pin` when `enactAt` is null. */
  enactInDays: number;
  /** Relay block the Whitelisted Caller referendum enacts at. */
  enactAt: number | null;
  /** Account that notes the preimage and submits the referendum, for the deposit dry run. */
  submitter: string | null;
}

/** Params whose enactment block is fixed, so the encoding is reproducible. */
export type PinnedParams = Params & { enactAt: number };

export interface Proposal {
  dir: string;
  params: Params;
  /** Path of a file in the proposal folder. */
  path(name: string): string;
  /** Folder for the reports and logs of the online commands; generated, not committed. */
  reports: string;
}

export const DEFAULT_PROPOSAL = "proposals/app-onboarding";

export function loadProposal(dir: string = DEFAULT_PROPOSAL): Proposal {
  const root = resolve(dir);
  const file = join(root, "params.json");
  if (!existsSync(file)) throw new Error(`no params.json in ${root}`);
  const params = JSON.parse(readFileSync(file, "utf8")) as Params;
  validate(params);
  return { dir: root, params, path: (name) => join(root, name), reports: join(root, "reports") };
}

export function saveParams(proposal: Proposal): void {
  writeFileSync(proposal.path("params.json"), `${toJson(proposal.params, 2)}\n`);
}

export function isPinned(params: Params): params is PinnedParams {
  return typeof params.enactAt === "number";
}

export function requirePinned(params: Params): PinnedParams {
  if (!isPinned(params)) throw new Error("params.json has no enactment block (enactAt): run `npm run pin`");
  return params;
}

const H160 = /^0x[0-9a-fA-F]{40}$/;
const H256 = /^0x[0-9a-f]{64}$/;
/** Keys params.json may have. */
const KEYS: Record<keyof Params, true> = {
  title: true,
  endpoints: true,
  attester: true,
  count: true,
  dispatcher: true,
  supersedes: true,
  dotns: true,
  enactInDays: true,
  enactAt: true,
  submitter: true,
};

function validate(p: Params): void {
  const fail = (msg: string): never => {
    throw new Error(`params.json: ${msg}`);
  };
  for (const key of Object.keys(p)) if (!Object.hasOwn(KEYS, key)) fail(`unknown key ${key}`);
  for (const key of Object.keys(KEYS)) if (!Object.hasOwn(p, key)) fail(`missing key ${key}`);
  if (!H160.test(p.dispatcher)) fail("dispatcher must be a 0x-prefixed H160");
  for (const chain of Object.keys(descriptors) as (keyof Endpoints)[]) {
    const urls = p.endpoints[chain];
    if (!Array.isArray(urls) || urls.length === 0 || !urls.every((u) => /^wss?:\/\//.test(u))) {
      fail(`endpoints.${chain} must be a non-empty list of ws:// or wss:// URLs`);
    }
  }
  toSs58(p.attester);
  if (p.submitter !== null) toSs58(p.submitter);
  if (!Number.isSafeInteger(p.count) || p.count <= 0) fail("count must be a positive integer");
  if (!Array.isArray(p.supersedes) || !p.supersedes.every((h) => H256.test(h))) {
    fail("supersedes must be a list of 0x-prefixed lowercase 32-byte call hashes");
  }
  if (new Set(p.supersedes).size !== p.supersedes.length) fail("supersedes lists a call hash twice");
}
