/**
 * XCM building blocks. Governance reaches People and Bulletin the way refs 1945 and 1951 did: Asset Hub, dispatching
 * with Root, sends an unpaid `Transact` that the sibling executes with the Superuser origin kind.
 */
import {
  XcmV2OriginKind,
  XcmV3WeightLimit,
  XcmV5Instruction,
  XcmV5Junction,
  XcmV5Junctions,
  XcmVersionedLocation,
  XcmVersionedXcm,
} from "@polkadot-api/descriptors";

/** XCM version used to encode messages and to read dry-run results. */
export const XCM_VERSION = 5;

/** Location of sibling parachain `para`, seen from another parachain. */
export const siblingLocation = (para: number) =>
  XcmVersionedLocation.V5({ parents: 1, interior: XcmV5Junctions.X1(XcmV5Junction.Parachain(para)) });

/** `UnpaidExecution` + `Transact(call)`, dispatched on the destination with `originKind`. */
export const unpaidTransact = (call: Uint8Array, originKind: "Superuser" | "Xcm") =>
  XcmVersionedXcm.V5([
    XcmV5Instruction.UnpaidExecution({ weight_limit: XcmV3WeightLimit.Unlimited(), check_origin: undefined }),
    XcmV5Instruction.Transact({ origin_kind: XcmV2OriginKind[originKind](), fallback_max_weight: undefined, call }),
  ]);
