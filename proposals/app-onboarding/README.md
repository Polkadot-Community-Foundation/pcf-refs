# Whitelisting the Polkadot App user onboarding calls

This proposal asks Polkadot governance to dispatch three calls that let Polkadot App users complete onboarding: two
attestation allowances and the dotNS dispatcher address. The call data, its decoding and the checks that back every
statement below are in this folder.

| Item | Value |
|---|---|
| Chains changed | Asset Hub, People (Collectives carries the Fellowship whitelist) |
| Route | Fellowship whitelist on Collectives, then a Whitelisted Caller referendum on Asset Hub |
| Inner call hash | `0x33ed6c42bb4078327a29bf59f8cb34c9df2f93703c3c624e47dc967b4a4af03f` (118 bytes) |
| Referendum preimage hash | `0x681f287489eea7db8bf4a37c03d4f8f861fa69565c313aa5e45dbf1a6ff29325` (120 bytes) |
| Status | Version 3, released as [`app-onboarding/v3-rc1`](https://github.com/Polkadot-Community-Foundation/pcf-refs/releases/tag/app-onboarding/v3-rc1) (pre-release). It supersedes [version 2](#versions): its Fellowship referendum removes the version 2 inner call hash from the Asset Hub whitelist |
| Enactment | from relay block 33698272, about 2026-11-02 08:00 UTC (09:00 CET), if the Fellowship referendum is proposed before relay block 33583072, about 2026-10-25 08:00 UTC; see [Timing](#timing) |

Files: [`params.json`](params.json) (inputs), [`calls.json`](calls.json) (every encoded call, both hashes, the
timing), [`BREAKDOWN.md`](BREAKDOWN.md) (the call data decoded call by call against live metadata). How the
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

This proposal is limited to those onboarding parameters: the attestation allowances and the dispatcher. The base app
names of the Polkadot App will come in a separate proposal, so each decision can be voted on by itself. Storage for
the apps on the Bulletin chain is not part of either request, because it can be obtained without governance through
paid lite personhood (`PeopleLite.register_with_fee`, then `Resources.claim_long_term_storage`, both on People).

## The calls

All three calls run in one `Utility.batch_all` on Asset Hub, dispatched with Root. Each value is described in
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
  lists it under that name in its contract address table. The proxy is upgradeable by its owner.
- **Origin.** The pallet's dispatcher manager origin; the batch dispatches it with Root.
- **How this repo checks it.** `preflight` requires a contract at the address, reports the dispatcher set today, and
  reports the live code hash of the proxy and of its ERC-1967 implementation. It does not compare them with the
  release: the release's `codehashes.json` hashes build artifacts, which hash differently from deployed code. It also
  reports the proxy's owner, the Asset Hub account behind it (`Revive.OriginalAccount`) and that account's proxies.
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

### Why one batch

The three calls go in one `Utility.batch_all`, so the Asset Hub calls and the sending of the XCM apply all together or
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
| `supersedes` | `0x90640a174e1d62b5645f31cb053d562e95a63881fd1e0f9197edbbcf83e21fad` | inner call hash of version 2, which the Fellowship referendum removes from the whitelist |
| `dotns.release` | [v1.0.0-pcf.1](https://github.com/Polkadot-Community-Foundation/dotns/releases/tag/v1.0.0-pcf.1) | dotNS release the dispatcher address comes from |
| `enactInDays` | `9` | delay `npm run pin` uses to set `enactAt` when it is `null` |
| `enactAt` | `33698272` | earliest relay block the Asset Hub referendum enacts at, about 2026-11-02 08:00 UTC |

## Hashes

From [`calls.json`](calls.json), encoded for runtimes Asset Hub 2005000, People 2005000 and Collectives 2005000:

| Call | Hash | Length |
|---|---|---|
| Inner call (`Utility.batch_all`), whitelisted by the Fellowship | `0x33ed6c42bb4078327a29bf59f8cb34c9df2f93703c3c624e47dc967b4a4af03f` | 118 bytes |
| Referendum preimage (`Whitelist.dispatch_whitelisted_call_with_preimage(batch)`) | `0x681f287489eea7db8bf4a37c03d4f8f861fa69565c313aa5e45dbf1a6ff29325` | 120 bytes |

Neither hash depends on the enactment block: only `Referenda.submit` and the timing do.

## Governance route

1. **Fellowship whitelist referendum on Collectives.** `FellowshipReferenda.submit` with the Fellows origin and
   enactment `After(10)` blocks. When it enacts, Collectives sends Asset Hub an XCM `Transact` (origin kind `Xcm`) of
   one `Utility.batch_all`, all or nothing, that:
   - removes version 2 from the whitelist:
     `Whitelist.remove_whitelisted_call(0x90640a174e1d62b5645f31cb053d562e95a63881fd1e0f9197edbbcf83e21fad)`;
   - whitelists this version:
     `Whitelist.whitelist_call(0x33ed6c42bb4078327a29bf59f8cb34c9df2f93703c3c624e47dc967b4a4af03f)`.
2. **Whitelisted Caller referendum on Asset Hub.** `Preimage.note_preimage` with the preimage, then
   `Referenda.submit` on the Whitelisted Caller track, looking the preimage up by hash and length, with a fixed
   `At(enactAt)` enactment. When it enacts, it dispatches `Whitelist.dispatch_whitelisted_call_with_preimage(batch)`,
   which runs the batch with Root only if the Fellowship has whitelisted its hash.

The removal retires version 2. A whitelisted call hash has no expiry, so without it the Asset Hub referendum of
version 2 could still dispatch the version 2 batch if it were approved, even after this version: the allowances would
grow by a second 1,000,000 each and three app names would be granted. Once the version 2 hash is removed, that
referendum can only enact without effect, failing with `CallIsNotWhitelisted`. The removal and the new whitelist apply
together or not at all, so this version can only be dispatched once version 2 no longer can.
`remove_whitelisted_call` fails only if the version 2 hash is no longer whitelisted, which happens only once the
version 2 batch has been dispatched; in that case nothing is whitelisted. `preflight` checks that the version 2 hash
is still whitelisted.

The alternative route is a referendum on the Root track with the inner call as its proposal. It needs no Fellowship
whitelist. This repository encodes only the Whitelisted Caller route.

### Timing

The Asset Hub referendum is submitted with a fixed `At(enactAt)` enactment, so it does not enact before `enactAt`,
however early it is approved. This gives the Fellowship time to whitelist the call first. The Fellowship referendum
has a decision period of about 7 days from its decision deposit; one more day is kept as a margin.

If the Fellowship referendum is proposed, with its decision deposit, before relay block 33583072 (about 2026-10-25
08:00 UTC), its whitelist reaches Asset Hub before relay block 33698272 (about 2026-11-02 08:00 UTC). The Asset Hub
referendum can then enact from relay block 33698272 until its decision period ends (28 days after it starts deciding
on the Whitelisted Caller track): at that block if it is approved by then, otherwise 10 minutes after its approval
(the track's minimum enactment period).

| | Relay block | About (UTC) |
|---|---|---|
| Fellowship referendum proposed, with its decision deposit, before | 33583072 (`enactAt` − 8 days) | 2026-10-25 08:00 |
| Asset Hub referendum can enact from | 33698272 (`enactAt`) | 2026-11-02 08:00 |

Relay blocks are binding; the dates are estimates at 6 seconds per block, computed from the relay chain on
2026-10-21. `calls.json` records both blocks under `timing` (14,400 relay blocks per day). Moving `enactAt` changes
`Referenda.submit` and the timing, not the inner call or the preimage.

A Fellowship referendum proposed later still works if its whitelist lands before the Asset Hub referendum enacts.
If the Asset Hub referendum enacts first, it enacts without effect, because `dispatch_whitelisted_call_with_preimage`
fails while the call is not whitelisted. The whitelist is keyed by the inner call hash, so only a new Asset Hub
referendum with a new `enactAt` is needed; the preimage and the Fellowship whitelist stay valid.

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
| `decode` | the bytes decode against live metadata to the calls in [`BREAKDOWN.md`](BREAKDOWN.md), every hash recomputes, and the Fellowship whitelists exactly the inner call hash and removes exactly the version 2 hash |
| `preflight` | live runtimes match the encoding; both allowances are empty; the dispatcher is a contract; the HRMP channel to People is open; the version 2 inner call is still whitelisted; the enactment block is ahead |
| `dry-run` | on live state, the batch executes with Root and emits the events listed above, with one XCM to People that executes there and no XCM to any other chain; the Fellowship proposal executes with the Fellows origin and, on Asset Hub, removes the version 2 hash from the whitelist and whitelists the inner call hash; the preimage, run with the Whitelisted Caller origin, fails only with `CallIsNotWhitelisted` until the whitelist lands |
| `rehearse` | on a local fork, both referenda enact through the scheduler with their real origins, the version 2 hash leaves the whitelist, Asset Hub sends exactly one XCM, to People, and the state changes exactly as described for each call |

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
| Collectives | `FellowshipReferenda.ReferendumInfoFor(<index>)` | origin `FellowshipOrigins.Fellows`; enactment `After(10)`; an inline proposal: `PolkadotXcm.send` to Asset Hub (parachain 1000) of a `Transact`, origin kind `Xcm`, of `Utility.batch_all([Whitelist.remove_whitelisted_call(0x90640a174e1d62b5645f31cb053d562e95a63881fd1e0f9197edbbcf83e21fad), Whitelist.whitelist_call(0x33ed6c42bb4078327a29bf59f8cb34c9df2f93703c3c624e47dc967b4a4af03f)])` |
| Asset Hub | `Referenda.ReferendumInfoFor(<index>)` | origin `Origins.WhitelistedCaller`; proposal `Lookup` with hash `0x681f287489eea7db8bf4a37c03d4f8f861fa69565c313aa5e45dbf1a6ff29325` and length 120; enactment `At(enactAt)`, with `enactAt` from [`calls.json`](calls.json) |
| Asset Hub | `Preimage.PreimageFor((0x681f287489eea7db8bf4a37c03d4f8f861fa69565c313aa5e45dbf1a6ff29325, 120))` | the bytes of `refPreimage` in [`calls.json`](calls.json) |

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

Clearing an allowance stops further attestations; it does not undo those already made.

`npm run verify -- --proposal proposals/app-onboarding` checks live state against [`params.json`](params.json): both
allowances granted, with how many units are left and used, the dispatcher set, and the version 2 hash no longer
whitelisted. It writes `reports/state.md` and `reports/state.json`, so anyone can check how the allowances are used
after enactment.

## Versions

| Version | Calls | Inner call hash | Preimage hash | Release |
|---|---|---|---|---|
| v1 | 5: the three above, `grantNames(["getcash", "dotns", "browse"])` on the dotNS name whitelist, and a Bulletin `TransactionStorage.add_authorizer` sent by XCM | `0xb47e722c2c665db41e610308097c395f2be4361c861443372c15579a4f28b8ad` (617 bytes) | `0x6d5e2de1d74047484016347ffe83e9d47a89939a6f699ed82934a4826875a989` (619 bytes) | [`app-onboarding/v1-rc1`](https://github.com/Polkadot-Community-Foundation/pcf-refs/releases/tag/app-onboarding/v1-rc1) pre-release, superseded |
| v2 | 4: the three above and `grantNames(["getcash", "dotns", "browse"])` | `0x90640a174e1d62b5645f31cb053d562e95a63881fd1e0f9197edbbcf83e21fad` (547 bytes) | `0x294b20f9659cfb82c624b9391106bb3533cad0921e595b70389b12ab68e8e54a` (549 bytes) | [`app-onboarding/v2`](https://github.com/Polkadot-Community-Foundation/pcf-refs/releases/tag/app-onboarding/v2), submitted as [Fellowship referendum #639](https://collectives.subsquare.io/fellowship/referenda/639) and [Asset Hub referendum #1955](https://polkadot.subsquare.io/referenda/1955); superseded |
| v3 | 3: the calls above | `0x33ed6c42bb4078327a29bf59f8cb34c9df2f93703c3c624e47dc967b4a4af03f` (118 bytes) | `0x681f287489eea7db8bf4a37c03d4f8f861fa69565c313aa5e45dbf1a6ff29325` (120 bytes) | [`app-onboarding/v3-rc1`](https://github.com/Polkadot-Community-Foundation/pcf-refs/releases/tag/app-onboarding/v3-rc1) pre-release |

Version 2 drops the Bulletin storage authorizer, for the reason given in [What and why](#what-and-why). Its four calls
are byte for byte the first four of version 1.

Version 3 keeps only the onboarding parameters and drops the name grants: the base app names will come in a separate
proposal, so each decision can be voted on by itself. Its three calls are byte for byte the first three of version 2,
and its Fellowship referendum also removes the version 2 inner call hash from the whitelist, as described in
[Governance route](#governance-route). Discussion:
[Final steps for DotDAO to enable user onboarding via Polkadot App](https://forum.polkadot.network/t/final-steps-for-dotdao-to-enable-user-onboarding-via-polkadot-app/18937).
