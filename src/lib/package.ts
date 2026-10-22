/**
 * The governance package: every call PCF asks governance to dispatch, wrapped for both votes.
 *
 * - The inner call is one `Utility.batch_all` on Asset Hub. The Fellowship whitelists its hash and it executes with
 *   Root.
 * - The referendum preimage is `Whitelist.dispatch_whitelisted_call_with_preimage(inner)`, submitted on the Asset Hub
 *   Whitelisted Caller track with a fixed `At(enactAt)` enactment.
 * - The Fellowship referendum on Collectives (Fellows origin) sends `Whitelist.whitelist_call(hash)` to Asset Hub,
 *   batched after a `Whitelist.remove_whitelisted_call` for each inner call hash the package supersedes.
 *
 * Encoding is offline, from the metadata committed in `.papi/`. The package is therefore a pure function of the
 * pinned params and the runtimes those descriptors describe, and anyone can reproduce it byte for byte.
 */
import { readFileSync } from "node:fs";
import { Enum, getOfflineApi, type HexString, type SS58String } from "polkadot-api";
import { BLOCKS_PER_DAY, CHAIN_NAMES, descriptors, PARA } from "./chains.ts";
import { blake2, byteLength, fromHex, toHex, toSs58 } from "./format.ts";
import type { PinnedParams, Proposal } from "./proposal.ts";
import { siblingLocation, unpaidTransact } from "./xcm.ts";

/** The Fellowship decision period is about 7 days from the decision deposit; one more day is margin for the whitelist. */
const FELLOWSHIP_LEAD_DAYS = 7 + 1;
/** Enactment delay of the Fellowship referendum, in Collectives blocks. */
const FELLOWSHIP_ENACTMENT_AFTER = 10;

/** Contents of `calls.json`. */
export interface GovernancePackage {
  title: string;
  /** `spec_version` of the runtimes the package is encoded for. */
  runtimes: { assetHub: number; people: number; collectives: number };
  parameters: {
    attester: SS58String;
    count: number;
    dispatcher: HexString;
    supersedes: HexString[];
  };
  /** Relay block numbers. A Fellowship referendum proposed before `fellowshipProposedBy` whitelists the call before
   * `enactAt`, the earliest block the Whitelisted Caller referendum enacts at. */
  timing: { enactAt: number; fellowshipProposedBy: number };
  /** Each call of the batch, and the calls it carries to other chains. */
  inner: {
    assetHubAllowance: HexString;
    assetHubDispatcher: HexString;
    peopleAllowance: HexString;
    assetHubXcmToPeople: HexString;
  };
  /** The batch: what the Fellowship whitelists and what executes with Root. */
  rootBatch: HexString;
  rootBatchLen: number;
  rootBatchHash: HexString;
  /** The referendum preimage: what `Referenda.submit` looks up. */
  refPreimage: HexString;
  refPreimageLen: number;
  refPreimageHash: HexString;
  fellowship: {
    /** `Whitelist.remove_whitelisted_call` for each superseded inner call hash. */
    removeWhitelistedCalls: HexString[];
    whitelistCall: HexString;
    /** What the Fellowship's XCM executes on Asset Hub: the removals and the whitelist in one `Utility.batch_all`, or
     * the whitelist alone when nothing is superseded. */
    assetHubCall: HexString;
    xcmToAssetHub: HexString;
    submit: HexString;
  };
  submission: { notePreimage: HexString; referendaSubmit: HexString };
}

export async function buildPackage(p: PinnedParams): Promise<GovernancePackage> {
  const [ah, people, collectives] = await Promise.all([
    getOfflineApi(descriptors.assetHub),
    getOfflineApi(descriptors.people),
    getOfflineApi(descriptors.collectives),
  ]);
  const attester = toSs58(p.attester);

  // Call executed on People, carried by XCM.
  const peopleAllowance = people.tx.PeopleLite.increase_attestation_allowance({ account: attester, count: p.count });

  const calls = {
    assetHubAllowance: ah.tx.DotnsGateway.increase_attestation_allowance({ account: attester, count: p.count }),
    assetHubDispatcher: ah.tx.DotnsGateway.set_dispatcher_address({ address: p.dispatcher }),
    assetHubXcmToPeople: ah.tx.PolkadotXcm.send({
      dest: siblingLocation(PARA.people),
      message: unpaidTransact(peopleAllowance.encodedData, "Superuser"),
    }),
  };
  const batch = ah.tx.Utility.batch_all({
    calls: [
      calls.assetHubAllowance.decodedCall,
      calls.assetHubDispatcher.decodedCall,
      calls.assetHubXcmToPeople.decodedCall,
    ],
  });
  const rootBatch = toHex(batch.encodedData);
  const rootBatchHash = blake2(rootBatch);

  const refPreimage = toHex(
    ah.tx.Whitelist.dispatch_whitelisted_call_with_preimage({ call: batch.decodedCall }).encodedData,
  );
  const refPreimageHash = blake2(refPreimage);

  const removeWhitelisted = p.supersedes.map((call_hash) => ah.tx.Whitelist.remove_whitelisted_call({ call_hash }));
  const whitelist = ah.tx.Whitelist.whitelist_call({ call_hash: rootBatchHash });
  const assetHubCall = removeWhitelisted.length
    ? ah.tx.Utility.batch_all({ calls: [...removeWhitelisted.map((c) => c.decodedCall), whitelist.decodedCall] })
        .encodedData
    : whitelist.encodedData;
  const fellowshipXcm = collectives.tx.PolkadotXcm.send({
    dest: siblingLocation(PARA.assetHub),
    message: unpaidTransact(assetHubCall, "Xcm"),
  }).encodedData;
  const fellowshipSubmit = collectives.tx.FellowshipReferenda.submit({
    proposal_origin: Enum("FellowshipOrigins", Enum("Fellows")),
    proposal: Enum("Inline", fellowshipXcm),
    enactment_moment: Enum("After", FELLOWSHIP_ENACTMENT_AFTER),
  }).encodedData;

  const notePreimage = ah.tx.Preimage.note_preimage({ bytes: fromHex(refPreimage) }).encodedData;
  const referendaSubmit = ah.tx.Referenda.submit({
    proposal_origin: Enum("Origins", Enum("WhitelistedCaller")),
    proposal: Enum("Lookup", { hash: refPreimageHash, len: byteLength(refPreimage) }),
    enactment_moment: Enum("At", p.enactAt),
  }).encodedData;

  return {
    title: p.title,
    runtimes: {
      assetHub: ah.constants.System.Version.spec_version,
      people: people.constants.System.Version.spec_version,
      collectives: collectives.constants.System.Version.spec_version,
    },
    parameters: {
      attester,
      count: p.count,
      dispatcher: p.dispatcher,
      supersedes: p.supersedes,
    },
    timing: {
      enactAt: p.enactAt,
      fellowshipProposedBy: p.enactAt - FELLOWSHIP_LEAD_DAYS * BLOCKS_PER_DAY,
    },
    inner: {
      assetHubAllowance: toHex(calls.assetHubAllowance.encodedData),
      assetHubDispatcher: toHex(calls.assetHubDispatcher.encodedData),
      peopleAllowance: toHex(peopleAllowance.encodedData),
      assetHubXcmToPeople: toHex(calls.assetHubXcmToPeople.encodedData),
    },
    rootBatch,
    rootBatchLen: byteLength(rootBatch),
    rootBatchHash,
    refPreimage,
    refPreimageLen: byteLength(refPreimage),
    refPreimageHash,
    fellowship: {
      removeWhitelistedCalls: removeWhitelisted.map((c) => toHex(c.encodedData)),
      whitelistCall: toHex(whitelist.encodedData),
      assetHubCall: toHex(assetHubCall),
      xcmToAssetHub: toHex(fellowshipXcm),
      submit: toHex(fellowshipSubmit),
    },
    submission: { notePreimage: toHex(notePreimage), referendaSubmit: toHex(referendaSubmit) },
  };
}

/** The runtimes the package is encoded for, as `Asset Hub 2005000, People 2005000, …`. */
export const describeRuntimes = (runtimes: GovernancePackage["runtimes"]): string =>
  Object.entries(runtimes)
    .map(([chain, spec]) => `${CHAIN_NAMES[chain as keyof typeof runtimes]} ${spec}`)
    .join(", ");

/** Reads the committed `calls.json` of a proposal. */
export function readPackage(proposal: Proposal): GovernancePackage {
  return JSON.parse(readFileSync(proposal.path("calls.json"), "utf8")) as GovernancePackage;
}
