/**
 * A proposal is a folder under `proposals/` with one input, `params.json`, and the files the commands generate next to
 * it. This module defines the params schema, validates it and resolves the folder's paths.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
  /** Labels granted on the DotNS name whitelist. */
  names: string[];
  /** H160 the names are granted to. */
  namesOwner: Address;
  dotns: {
    release: string;
    nameWhitelist: Address;
    registrarController: Address;
    registrar: Address;
  };
  /** Revive weight limit for `grantNames`, as decimal strings. */
  grantWeight: { refTime: string; proofSize: string };
  /** Revive storage deposit limit for `grantNames`, in planck. Root is not charged, but 0 reverts the call. */
  grantStorageDepositLimit: string;
  bulletin: {
    authorizer: string;
    transactions: number;
    /** Byte quota, as a decimal string. */
    bytes: string;
    /** Validity used by `pin` when `validUntil` is null. */
    validDays: number;
    /** Bulletin block the authorizer expires at. */
    validUntil: number | null;
    feeless: boolean;
  };
  /** Delay used by `pin` when `enactAt` is null. */
  enactInDays: number;
  /** Relay block the Whitelisted Caller referendum enacts at. */
  enactAt: number | null;
  /** Account that notes the preimage and submits the referendum, for the deposit dry run. */
  submitter: string | null;
}

/** Params whose dates are fixed, so the encoding (and its hashes) is reproducible. */
export type PinnedParams = Params & { enactAt: number; bulletin: Params["bulletin"] & { validUntil: number } };

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
  return params.enactAt !== null && params.bulletin.validUntil !== null;
}

export function requirePinned(params: Params): PinnedParams {
  if (!isPinned(params))
    throw new Error("params.json has unpinned dates (enactAt, bulletin.validUntil): run `npm run pin`");
  return params;
}

const H160 = /^0x[0-9a-fA-F]{40}$/;
const LABEL = /^[a-z0-9-]+$/;

function validate(p: Params): void {
  const fail = (msg: string): never => {
    throw new Error(`params.json: ${msg}`);
  };
  for (const [key, value] of Object.entries({
    dispatcher: p.dispatcher,
    namesOwner: p.namesOwner,
    "dotns.nameWhitelist": p.dotns.nameWhitelist,
    "dotns.registrarController": p.dotns.registrarController,
    "dotns.registrar": p.dotns.registrar,
  })) {
    if (!H160.test(value)) fail(`${key} must be a 0x-prefixed H160`);
  }
  for (const chain of Object.keys(descriptors) as (keyof Endpoints)[]) {
    const urls = p.endpoints[chain];
    if (!Array.isArray(urls) || urls.length === 0 || !urls.every((u) => /^wss?:\/\//.test(u))) {
      fail(`endpoints.${chain} must be a non-empty list of ws:// or wss:// URLs`);
    }
  }
  toSs58(p.attester);
  toSs58(p.bulletin.authorizer);
  if (p.submitter !== null) toSs58(p.submitter);
  if (!Number.isSafeInteger(p.count) || p.count <= 0) fail("count must be a positive integer");
  if (p.names.length === 0 || !p.names.every((n) => LABEL.test(n))) fail("names must be bare lowercase labels");
  if (!Number.isSafeInteger(p.bulletin.transactions) || p.bulletin.transactions <= 0)
    fail("bulletin.transactions must be a positive integer");
  if (BigInt(p.bulletin.bytes) <= 0n) fail("bulletin.bytes must be positive");
}
