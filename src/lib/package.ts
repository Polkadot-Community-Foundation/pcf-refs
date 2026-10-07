/**
 * The governance package: every call PCF asks governance to dispatch, wrapped for both votes.
 *
 * - The inner call is one `Utility.batch_all` on Asset Hub. The Fellowship whitelists its hash and it executes with
 *   Root.
 * - The referendum preimage is `Whitelist.dispatch_whitelisted_call_with_preimage(inner)`, submitted on the Asset Hub
 *   Whitelisted Caller track with a fixed `At(enactAt)` enactment.
 * - The Fellowship referendum on Collectives (Fellows origin) sends `Whitelist.whitelist_call(hash)` to Asset Hub.
 *
 * Encoding is offline, from the metadata committed in `.papi/`. The package is therefore a pure function of the
 * pinned params and the runtimes those descriptors describe, and anyone can reproduce it byte for byte.
 */
import { readFileSync } from "node:fs";
import { Enum, getOfflineApi, type HexString, type SS58String } from "polkadot-api";
import { encodeFunctionData } from "viem";
import { BLOCKS_PER_DAY, descriptors, PARA } from "./chains.ts";
import { WHITELIST_ABI } from "./dotns.ts";
import { blake2, byteLength, fromHex, toHex, toSs58 } from "./format.ts";
import type { PinnedParams, Proposal } from "./proposal.ts";
import { siblingLocation, unpaidTransact } from "./xcm.ts";

/** Fellowship referenda use a 7-day decision period; one more day of margin. */
const FELLOWSHIP_LEAD_DAYS = 8;
/** The whitelist must be on Asset Hub a day before the referendum enacts. */
const WHITELIST_LEAD_DAYS = 1;
/** Enactment delay of the Fellowship referendum, in Collectives blocks. */
const FELLOWSHIP_ENACTMENT_AFTER = 10;

/** Contents of `calls.json`. */
export interface GovernancePackage {
  title: string;
  /** `spec_version` of the runtimes the package is encoded for. */
  runtimes: { assetHub: number; people: number; bulletin: number; collectives: number };
  parameters: {
    attester: SS58String;
    count: number;
    dispatcher: HexString;
    names: string[];
    namesOwner: HexString;
    nameWhitelist: HexString;
    bulletinAuthorizer: SS58String;
    bulletinBudget: { transactions: number; bytes: string; validUntil: number; feeless: boolean };
  };
  /** Relay block numbers. */
  deadlines: { enactAt: number; fellowshipSubmitBy: number; whitelistLandedBy: number };
  /** Each call of the batch, and the calls it carries to other chains. */
  inner: {
    assetHubAllowance: HexString;
    assetHubDispatcher: HexString;
    peopleAllowance: HexString;
    assetHubXcmToPeople: HexString;
    grantNamesCalldata: HexString;
    assetHubGrantNames: HexString;
    bulletinAddAuthorizer: HexString;
    assetHubXcmToBulletin: HexString;
  };
  /** The batch: what the Fellowship whitelists and what executes with Root. */
  rootBatch: HexString;
  rootBatchLen: number;
  rootBatchHash: HexString;
  /** The referendum preimage: what `Referenda.submit` looks up. */
  refPreimage: HexString;
  refPreimageLen: number;
  refPreimageHash: HexString;
  fellowship: { whitelistCall: HexString; xcmToAssetHub: HexString; submit: HexString };
  submission: { notePreimage: HexString; referendaSubmit: HexString };
}

export async function buildPackage(p: PinnedParams): Promise<GovernancePackage> {
  const [ah, people, bulletin, collectives] = await Promise.all([
    getOfflineApi(descriptors.assetHub),
    getOfflineApi(descriptors.people),
    getOfflineApi(descriptors.bulletin),
    getOfflineApi(descriptors.collectives),
  ]);
  const attester = toSs58(p.attester);
  const authorizer = toSs58(p.bulletin.authorizer);

  // Calls executed on other chains, carried by XCM.
  const peopleAllowance = people.tx.PeopleLite.increase_attestation_allowance({ account: attester, count: p.count });
  const bulletinAddAuthorizer = bulletin.tx.TransactionStorage.add_authorizer({
    who: authorizer,
    budget: {
      quota: { transactions: p.bulletin.transactions, bytes: BigInt(p.bulletin.bytes) },
      valid_until: p.bulletin.validUntil,
      feeless: p.bulletin.feeless,
    },
  });
  const grantNamesCalldata = encodeFunctionData({
    abi: WHITELIST_ABI,
    functionName: "grantNames",
    args: [p.names, p.namesOwner],
  });

  const calls = {
    assetHubAllowance: ah.tx.DotnsGateway.increase_attestation_allowance({ account: attester, count: p.count }),
    assetHubDispatcher: ah.tx.DotnsGateway.set_dispatcher_address({ address: p.dispatcher }),
    assetHubXcmToPeople: ah.tx.PolkadotXcm.send({
      dest: siblingLocation(PARA.people),
      message: unpaidTransact(peopleAllowance.encodedData, "Superuser"),
    }),
    assetHubGrantNames: ah.tx.Revive.call({
      dest: p.dotns.nameWhitelist,
      value: 0n,
      weight_limit: { ref_time: BigInt(p.grantWeight.refTime), proof_size: BigInt(p.grantWeight.proofSize) },
      storage_deposit_limit: BigInt(p.grantStorageDepositLimit),
      data: fromHex(grantNamesCalldata),
    }),
    assetHubXcmToBulletin: ah.tx.PolkadotXcm.send({
      dest: siblingLocation(PARA.bulletin),
      message: unpaidTransact(bulletinAddAuthorizer.encodedData, "Superuser"),
    }),
  };
  const batch = ah.tx.Utility.batch_all({
    calls: [
      calls.assetHubAllowance.decodedCall,
      calls.assetHubDispatcher.decodedCall,
      calls.assetHubXcmToPeople.decodedCall,
      calls.assetHubGrantNames.decodedCall,
      calls.assetHubXcmToBulletin.decodedCall,
    ],
  });
  const rootBatch = toHex(batch.encodedData);
  const rootBatchHash = blake2(rootBatch);

  const refPreimage = toHex(
    ah.tx.Whitelist.dispatch_whitelisted_call_with_preimage({ call: batch.decodedCall }).encodedData,
  );
  const refPreimageHash = blake2(refPreimage);

  const whitelistCall = ah.tx.Whitelist.whitelist_call({ call_hash: rootBatchHash }).encodedData;
  const fellowshipXcm = collectives.tx.PolkadotXcm.send({
    dest: siblingLocation(PARA.assetHub),
    message: unpaidTransact(whitelistCall, "Xcm"),
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
      bulletin: bulletin.constants.System.Version.spec_version,
      collectives: collectives.constants.System.Version.spec_version,
    },
    parameters: {
      attester,
      count: p.count,
      dispatcher: p.dispatcher,
      names: p.names,
      namesOwner: p.namesOwner,
      nameWhitelist: p.dotns.nameWhitelist,
      bulletinAuthorizer: authorizer,
      bulletinBudget: {
        transactions: p.bulletin.transactions,
        bytes: p.bulletin.bytes,
        validUntil: p.bulletin.validUntil,
        feeless: p.bulletin.feeless,
      },
    },
    deadlines: {
      enactAt: p.enactAt,
      fellowshipSubmitBy: p.enactAt - FELLOWSHIP_LEAD_DAYS * BLOCKS_PER_DAY,
      whitelistLandedBy: p.enactAt - WHITELIST_LEAD_DAYS * BLOCKS_PER_DAY,
    },
    inner: {
      assetHubAllowance: toHex(calls.assetHubAllowance.encodedData),
      assetHubDispatcher: toHex(calls.assetHubDispatcher.encodedData),
      peopleAllowance: toHex(peopleAllowance.encodedData),
      assetHubXcmToPeople: toHex(calls.assetHubXcmToPeople.encodedData),
      grantNamesCalldata,
      assetHubGrantNames: toHex(calls.assetHubGrantNames.encodedData),
      bulletinAddAuthorizer: toHex(bulletinAddAuthorizer.encodedData),
      assetHubXcmToBulletin: toHex(calls.assetHubXcmToBulletin.encodedData),
    },
    rootBatch,
    rootBatchLen: byteLength(rootBatch),
    rootBatchHash,
    refPreimage,
    refPreimageLen: byteLength(refPreimage),
    refPreimageHash,
    fellowship: {
      whitelistCall: toHex(whitelistCall),
      xcmToAssetHub: toHex(fellowshipXcm),
      submit: toHex(fellowshipSubmit),
    },
    submission: { notePreimage: toHex(notePreimage), referendaSubmit: toHex(referendaSubmit) },
  };
}

/** Reads the committed `calls.json` of a proposal. */
export function readPackage(proposal: Proposal): GovernancePackage {
  return JSON.parse(readFileSync(proposal.path("calls.json"), "utf8")) as GovernancePackage;
}
