# Whitelisting the Polkadot App user onboarding calls

This proposal asks Polkadot governance to dispatch four calls that let Polkadot App users complete onboarding: two
attestation allowances, the dotNS dispatcher address, and three app names on the dotNS name whitelist. The call data,
its decoding and the checks that back every statement below are in this folder.

| Item | Value |
|---|---|
| Chains changed | Asset Hub, People (Collectives carries the Fellowship whitelist) |
| Route | Fellowship whitelist on Collectives, then a Whitelisted Caller referendum on Asset Hub |
| Inner call hash | `0x90640a174e1d62b5645f31cb053d562e95a63881fd1e0f9197edbbcf83e21fad` (547 bytes) |
| Referendum preimage hash | `0x294b20f9659cfb82c624b9391106bb3533cad0921e595b70389b12ab68e8e54a` (549 bytes) |
| Status | Version 2, under discussion on the [forum](https://forum.polkadot.network/t/final-steps-for-dotdao-to-enable-user-onboarding-via-polkadot-app/18937); released as [`app-onboarding/v2-rc1`](https://github.com/Polkadot-Community-Foundation/pcf-refs/releases/tag/app-onboarding/v2-rc1) |
| Enactment | relay block 33525098, about 2026-10-21 07:00 UTC (09:00 CEST) |

Files: [`params.json`](params.json) (inputs), [`calls.json`](calls.json) (every encoded call, both hashes, the
deadlines), [`BREAKDOWN.md`](BREAKDOWN.md) (the call data decoded call by call against live metadata). How the
repository works in general is in the [root README](../../README.md).

## What and why

Users of the Polkadot App, an end-user app for Polkadot, get a username when they onboard. Two things happen on chain:

- On People, an attester account makes the user a lite person (a lightweight personhood status on People) with
  `PeopleLite.attest`.
- On Asset Hub, the attester reserves the user's `.dot` name through the `DotnsGateway` pallet, which forwards the
  reservation to the dotNS contracts by calling a dispatcher contract.

Each attestation on People and each name reservation the attester submits through the gateway uses one unit of the
attester's attestation allowance on that chain. Today on Polkadot no attestation allowance exists on either chain and
no dispatcher is set, so registrations cannot complete.

The apps Get CASH (`getcash.dot`), the dotNS app (`dotns.dot`) and Browse (`browse.dot`) need short names. In dotNS,
names of 5 characters or fewer are reserved for governance, and names of 6 to 8 characters require personhood
([`IPopRules.sol`](https://github.com/Polkadot-Community-Foundation/dotns/blob/v1.0.0-pcf.1/contracts/pop/IPopRules.sol)).
The dotNS name whitelist lets governance grant such a name to a chosen account, which can then register it; the
whitelist accepts grants only from a Root dispatch
([`DotnsNameWhitelist.sol`](https://github.com/Polkadot-Community-Foundation/dotns/blob/v1.0.0-pcf.1/contracts/whitelist/DotnsNameWhitelist.sol)).
This proposal grants the three names to one account, the names owner
`0xA5C4c241985D77A0296a0FB83E0FA5905e9E39De`.

The apps also need storage on the Bulletin chain. That is not part of this request, because it can be obtained without
governance through paid lite personhood (`PeopleLite.register_with_fee`, then `Resources.claim_long_term_storage`, both
on People).

## The calls

All four calls run in one `Utility.batch_all` on Asset Hub, dispatched with Root. Each value is described in
[Parameters](#parameters).

### 1. Attestation allowance on Asset Hub

`DotnsGateway.increase_attestation_allowance(15sDLj4T9NnCtT665koDMxBs1PZw3rzDc6wcz9tN9kKTQ2zj, 1000000)`

- **Why.** We want the attester to reserve `.dot` names for onboarding users, because the gateway refuses a
  reservation from the attester when it has no allowance left.
- **What it does.** Adds 1,000,000 to `DotnsGateway.AttestationAllowance` for the attester and emits
  `DotnsGateway.AttestationAllowanceIncreased`. The attester can then submit up to 1,000,000 name reservations
  through the gateway, one unit each. It grants no other authority.
- **Origin.** The pallet's allowance manager origin; the batch dispatches it with Root.
- **How this repo checks it.** `preflight` requires the allowance to be empty today. `dry-run` requires
  `DotnsGateway.AttestationAllowanceIncreased` for the attester. `rehearse` reads the allowance before and after
  enactment and requires it to grow by exactly 1,000,000.

### 2. dotNS dispatcher on Asset Hub

`DotnsGateway.set_dispatcher_address(0xA06d1CB1e3FedFF7b5dFa779b4Cc61703F8A46A1)`

- **Why.** We want name reservations made through the gateway to reach dotNS, because the gateway has no contract to
  forward them to until a dispatcher is set.
- **What it does.** Sets `DotnsGateway.DispatcherAddress` and emits `DotnsGateway.DispatcherAddressSet`. The gateway
  calls the dispatcher with Root origin, and dotNS treats a Root caller as governance authority through
  `originIsRoot`. The contract at this address therefore receives governance authority for every call the gateway
  forwards. The address is the proxy of `DotnsPopController`, the dotNS controller that issues device names and
  personhood names on behalf of the gateway. The
  [dotNS v1.0.0-pcf.1 release](https://github.com/Polkadot-Community-Foundation/dotns/releases/tag/v1.0.0-pcf.1)
  lists it under that name in its contract address table.
- **Origin.** The pallet's dispatcher manager origin; the batch dispatches it with Root.
- **How this repo checks it.** `preflight` requires a contract at the address, reports the dispatcher set today, and
  reports the live code hash of the proxy and of its ERC-1967 implementation. It does not compare them with the
  release: the release's `codehashes.json` hashes build artifacts, which hash differently from deployed code.
  `dry-run` requires `DotnsGateway.DispatcherAddressSet` with the proposed address. `rehearse` requires the
  dispatcher to change from its current value to the proposed address.

### 3. Attestation allowance on People

`PeopleLite.increase_attestation_allowance(15sDLj4T9NnCtT665koDMxBs1PZw3rzDc6wcz9tN9kKTQ2zj, 1000000)` on People,
sent from Asset Hub with `PolkadotXcm.send`

- **Why.** We want the attester to make onboarding users lite persons with `PeopleLite.attest`, because each
  attestation needs one unit of allowance.
- **What it does.** Asset Hub sends People (parachain 1004) an XCM with `UnpaidExecution` and a `Transact` of origin
  kind `Superuser`, so People executes the call with Root. It adds 1,000,000 to `PeopleLite.AttestationAllowance` for
  the attester and emits `PeopleLite.AttestationAllowanceIncreased`. The attester can then make up to 1,000,000
  attestations. It grants no other authority.
- **Origin.** Root on Asset Hub to send the XCM; on People, the `Superuser` origin kind from Asset Hub.
- **How this repo checks it.** `preflight` requires the People allowance to be empty and the HRMP channel from Asset
  Hub to People to be open. `dry-run` requires Asset Hub to send exactly one XCM, forwarded to People and to no other
  destination, then dry-runs that XCM on People and requires it to complete with
  `PeopleLite.AttestationAllowanceIncreased` for the attester (a failed `Transact` still reports `Complete`, so the
  effect is checked from events). `rehearse` delivers the XCM on the fork, sees the event on People, and requires the
  allowance to grow by exactly 1,000,000.

### 4. App names on the dotNS name whitelist

`Revive.call(0xEc2f4c007b51c35DEfa96bF654f357Fc850362Ab, grantNames(["getcash", "dotns", "browse"], 0xA5C4c241985D77A0296a0FB83E0FA5905e9E39De))`

- **Why.** We want `getcash.dot`, `dotns.dot` and `browse.dot` to be registrable by the names owner, because names of
  5 characters or fewer are reserved for governance and names of 6 to 8 characters can only be registered with
  personhood. A Root grant on the whitelist is how governance assigns such a name to a chosen account.
- **What it does.** Calls `grantNames` on the dotNS name whitelist contract with Root origin. Each name goes from
  `Open` to `Claimed`, granted to the names owner, and the contract emits `NameAccepted` for each. The grant
  registers nothing by itself. The names owner later registers each name with `registerReserved` on the registrar
  controller, which checks the grant and consumes it
  ([`DotnsRegistrarController.sol`](https://github.com/Polkadot-Community-Foundation/dotns/blob/v1.0.0-pcf.1/contracts/registrars/DotnsRegistrarController.sol)).
- **Origin.** Root. The whitelist checks `originIsRoot` and accepts no signed account.
- **How this repo checks it.** `preflight` requires a contract at the whitelist address, at most `maxGrantBatch` names,
  each name `Open` on the whitelist and unregistered, and the names owner mapped (`Revive.OriginalAccount` records
  the Asset Hub account behind the H160, set with `Revive.map_account`). `dry-run` requires `NameAccepted` for every
  name, to the names owner. `rehearse` requires each name to go from `Open` and unregistered to `Claimed`, granted to
  the names owner, and still unregistered.

### Why one batch

The four calls go in one `Utility.batch_all`, so the Asset Hub calls and the sending of the XCM apply all together or
not at all: a failure in any of them reverts the whole batch. Call 3 is only sent atomically. It executes later on
People, and a failure there does not revert the Asset Hub calls. This is why `dry-run` and `rehearse` check its effect
from People events and state.

One batch also gives the Fellowship one hash to whitelist and voters one referendum to decide. The batch is
dispatched with Root by `Whitelist.dispatch_whitelisted_call_with_preimage`. Referenda run on Asset Hub, so the
People call travels as an XCM `Transact` with origin kind `Superuser`, which People executes with Root. The batch
sends exactly one XCM, to People. `dry-run` also checks that the batch's declared weight fits the Asset Hub
scheduler's maximum weight, since the scheduler enacts it.

## Parameters

From [`params.json`](params.json):

| Parameter | Value | What it is |
|---|---|---|
| `attester` | `15sDLj4T9NnCtT665koDMxBs1PZw3rzDc6wcz9tN9kKTQ2zj` | the attester account, granted the allowance on Asset Hub and People |
| `count` | `1000000` | allowance granted on each chain |
| `dispatcher` | `0xA06d1CB1e3FedFF7b5dFa779b4Cc61703F8A46A1` | the dotNS contract the gateway forwards reservations to (the `DotnsPopController` proxy) |
| `names` | `getcash`, `dotns`, `browse` | names granted on the whitelist |
| `namesOwner` | `0xA5C4c241985D77A0296a0FB83E0FA5905e9E39De` | the account the names are granted to |
| `dotns.nameWhitelist` | `0xEc2f4c007b51c35DEfa96bF654f357Fc850362Ab` | dotNS name whitelist contract |
| `dotns.registrarController` | `0x76c19abE11404e43445670F13173AFA60BED53f8` | dotNS registrar controller, read to check that names are unregistered |
| `dotns.registrar` | `0x37442d086e282F7C497FC4Ffe00D0A06B84a1f81` | dotNS registrar, read to check who owns a registered name |
| `dotns.release` | [v1.0.0-pcf.1](https://github.com/Polkadot-Community-Foundation/dotns/releases/tag/v1.0.0-pcf.1) | dotNS release the contract addresses come from |
| `grantWeight` | ref time `10000000000`, proof size `1000000` | weight limit of the `grantNames` call |
| `grantStorageDepositLimit` | `10000000000` planck | storage deposit limit of the `grantNames` call; Root is not charged, but 0 reverts the call |
| `enactInDays` | `9` | delay `npm run pin` uses to set `enactAt` when it is `null` |
| `enactAt` | `33525098` | relay block the Asset Hub referendum enacts at, about 2026-10-21 07:00 UTC |

## Hashes

From [`calls.json`](calls.json), encoded for runtimes Asset Hub 2005000, People 2005000 and Collectives 2005000:

| Call | Hash | Length |
|---|---|---|
| Inner call (`Utility.batch_all`), whitelisted by the Fellowship | `0x90640a174e1d62b5645f31cb053d562e95a63881fd1e0f9197edbbcf83e21fad` | 547 bytes |
| Referendum preimage (`Whitelist.dispatch_whitelisted_call_with_preimage(batch)`) | `0x294b20f9659cfb82c624b9391106bb3533cad0921e595b70389b12ab68e8e54a` | 549 bytes |

Neither hash depends on the enactment block: only `Referenda.submit` and the deadlines do.

## Governance route

1. **Fellowship whitelist referendum on Collectives.** `FellowshipReferenda.submit` with the Fellows origin and
   enactment `After(10)` blocks. When it enacts, Collectives sends Asset Hub an XCM `Transact` (origin kind `Xcm`) of
   `Whitelist.whitelist_call(0x90640a17…1fad)`.
2. **Whitelisted Caller referendum on Asset Hub.** `Preimage.note_preimage` with the preimage, then
   `Referenda.submit` on the Whitelisted Caller track, looking the preimage up by hash and length, with a fixed
   `At(enactAt)` enactment. When it enacts, it dispatches `Whitelist.dispatch_whitelisted_call_with_preimage(batch)`,
   which runs the batch with Root only if the Fellowship has whitelisted its hash.

The fixed enactment means the Asset Hub referendum does not enact before `enactAt`, however early it is approved. The
deadlines below leave the Fellowship time to whitelist the call before then. They assume both referenda decide within
7 days of their decision deposits, and keep a 1-day margin between the whitelist and enactment. `calls.json` records
them as relay blocks (14,400 per day).

Relay blocks are binding; the dates are estimates at 6 seconds per block, computed from the relay chain on
2026-10-12. Moving `enactAt` changes `Referenda.submit` and the deadlines, not the inner call or the preimage.

| Deadline | Rule | Relay block | About (UTC) |
|---|---|---|---|
| Fellowship referendum submitted, with its decision deposit, by | `enactAt` − 8 days | 33409898 | 2026-10-13 07:00 |
| Whitelist on Asset Hub by (cutoff) | `enactAt` − 1 day | 33510698 | 2026-10-20 07:00 |
| Asset Hub referendum enacts at | `enactAt` at the earliest (later if the referendum is approved after it) | 33525098 | 2026-10-21 07:00 |

Under the same 7-day assumption, the Asset Hub referendum must also be submitted, with its decision deposit, early
enough to be decided before `enactAt`.

If the whitelist lands after the cutoff but before `enactAt`, the batch still runs: the cutoff is a margin. If it
misses `enactAt`, the Asset Hub referendum enacts without effect, because `dispatch_whitelisted_call_with_preimage`
fails while the call is not whitelisted. The whitelist is keyed by the inner call hash, so only a new Asset Hub
referendum with a new `enactAt` is needed; the preimage and the Fellowship whitelist stay valid.

The alternative route is a referendum on the Root track with the inner call as its proposal. It needs no Fellowship
whitelist. This repository encodes only the Whitelisted Caller route.

## Verify it yourself

Requires Node 22.18 or later and network access to Polkadot RPC endpoints; `rehearse` also starts local Chopsticks
forks on three ports from 8100. See [Setup](../../README.md#setup).

```sh
git clone https://github.com/Polkadot-Community-Foundation/pcf-refs && cd pcf-refs
npm ci
npm test
npm run encode -- --proposal proposals/app-onboarding --check
npm run decode -- --proposal proposals/app-onboarding && git diff --exit-code -- proposals/app-onboarding/BREAKDOWN.md
npm run preflight -- --proposal proposals/app-onboarding
npm run dry-run -- --proposal proposals/app-onboarding
npm run rehearse -- --proposal proposals/app-onboarding
```

| Command | PASS means |
|---|---|
| `npm test`, `encode --check` | [`calls.json`](calls.json) re-encodes byte for byte from [`params.json`](params.json) and the committed metadata, with no network |
| `decode` | the bytes decode against live metadata to the calls in [`BREAKDOWN.md`](BREAKDOWN.md), every hash recomputes, and the Fellowship whitelists exactly the inner call hash |
| `preflight` | live runtimes match the encoding; both allowances are empty; the dispatcher and whitelist are contracts; every name is `Open` and unregistered; the names owner is mapped; the HRMP channel to People is open; no deadline has passed |
| `dry-run` | on live state, the batch executes with Root and emits the events listed above, with one XCM to People that executes there and no XCM to any other chain; the Fellowship proposal executes with the Fellows origin and whitelists the inner call hash on Asset Hub; the preimage, run with the Whitelisted Caller origin, fails only with `CallIsNotWhitelisted` until the whitelist lands |
| `rehearse` | on a local fork, both referenda enact through the scheduler with their real origins, Asset Hub sends exactly one XCM, to People, and the state changes exactly as described for each call |

What the dry runs and the rehearsal do not cover: [Limits of the evidence](../../README.md#limits-of-the-evidence).

PASS means the observed outcome is the expected one, including expected errors. `preflight`, `dry-run` and `rehearse`
each write a report and a JSON log to `reports/` in this folder. The daily `dry-run` workflow publishes them as an
artifact, and every release carries them with the call data. Releases are at
<https://github.com/Polkadot-Community-Foundation/pcf-refs/releases>; how to verify a downloaded release is in the
[root README](../../README.md#verify-a-release).

### Check the live referenda

Once the referenda are submitted, compare them with this repository, for example in Polkadot-JS Apps under Chain
state:

| Chain | Read | Expected |
|---|---|---|
| Collectives | `FellowshipReferenda.ReferendumInfoFor(<index>)` | origin `FellowshipOrigins.Fellows`; enactment `After(10)`; an inline proposal: `PolkadotXcm.send` to Asset Hub (parachain 1000) of a `Transact`, origin kind `Xcm`, of `Whitelist.whitelist_call(0x90640a174e1d62b5645f31cb053d562e95a63881fd1e0f9197edbbcf83e21fad)` |
| Asset Hub | `Referenda.ReferendumInfoFor(<index>)` | origin `Origins.WhitelistedCaller`; proposal `Lookup` with hash `0x294b20f9659cfb82c624b9391106bb3533cad0921e595b70389b12ab68e8e54a` and length 549; enactment `At(enactAt)`, with `enactAt` from the release notes |
| Asset Hub | `Preimage.PreimageFor((0x294b20f9…e54a, 549))` | the bytes of `refPreimage` in [`calls.json`](calls.json) |

The full submission bytes are `fellowship.submit` (Collectives) and `submission.referendaSubmit` (Asset Hub) in
[`calls.json`](calls.json), decoded in [`BREAKDOWN.md`](BREAKDOWN.md). Each release publishes them as
`fellowship-submit.hex` and `referenda-submit.hex`. `npm run decode -- --hex <call> --chain <chain>` decodes any call
read from chain. `preflight` also reports whether the inner call is whitelisted on Asset Hub and whether the preimage
is noted.

## After enactment

Governance can undo or adjust each change:

| Change | How to undo it |
|---|---|
| Asset Hub allowance | `DotnsGateway.clear_attestation_allowance(attester)` |
| People allowance | `PeopleLite.clear_attestation_allowance(attester)`, sent from Asset Hub the same way as call 3 |
| Dispatcher | `DotnsGateway.set_dispatcher_address` with another address |
| Name grants | `revokeName(label)` on the whitelist, with Root, resets a granted name to `Open` until it is registered; registration consumes the grant ([`DotnsNameWhitelist.sol`](https://github.com/Polkadot-Community-Foundation/dotns/blob/v1.0.0-pcf.1/contracts/whitelist/DotnsNameWhitelist.sol)) |

Clearing an allowance stops further attestations; it does not undo those already made.

`npm run verify -- --proposal proposals/app-onboarding` checks live state against [`params.json`](params.json): both
allowances granted, with how many units are left and used, the dispatcher set, and each name either granted to the
names owner or registered to it. It writes `reports/state.md` and `reports/state.json`, so anyone can check how the
allowances and names are used after enactment.

## Versions

| Version | Calls | Inner call hash | Preimage hash | Release |
|---|---|---|---|---|
| v1 | 5: the four above, plus a Bulletin `TransactionStorage.add_authorizer` sent by XCM | `0xb47e722c2c665db41e610308097c395f2be4361c861443372c15579a4f28b8ad` (617 bytes) | `0x6d5e2de1d74047484016347ffe83e9d47a89939a6f699ed82934a4826875a989` (619 bytes) | [`app-onboarding/v1-rc1`](https://github.com/Polkadot-Community-Foundation/pcf-refs/releases/tag/app-onboarding/v1-rc1) pre-release, superseded |
| v2 | 4: the calls above | `0x90640a174e1d62b5645f31cb053d562e95a63881fd1e0f9197edbbcf83e21fad` (547 bytes) | `0x294b20f9659cfb82c624b9391106bb3533cad0921e595b70389b12ab68e8e54a` (549 bytes) | [`app-onboarding/v2-rc1`](https://github.com/Polkadot-Community-Foundation/pcf-refs/releases/tag/app-onboarding/v2-rc1) pre-release |

Version 2 drops the Bulletin storage authorizer, for the reason given in [What and why](#what-and-why). Its first four
calls are byte for byte those of version 1. Discussion:
[Final steps for DotDAO to enable user onboarding via Polkadot App](https://forum.polkadot.network/t/final-steps-for-dotdao-to-enable-user-onboarding-via-polkadot-app/18937).
