# pcf-governance

Encodes, decodes, checks and dry-runs the governance calls PCF proposes to the Polkadot Technical Fellowship. The
tooling never signs or submits anything. Everything is read from live Polkadot state.

Each proposal lives in `proposals/<name>/`. `params.json` is the only input; everything else in that folder is
generated and committed, so anyone can regenerate it and diff it.

## Current proposal: `proposals/app-onboarding`

*Whitelisting the Polkadot App user onboarding calls.* One `Utility.batch_all` on Asset Hub, dispatched with Root
through the Whitelisted Caller track:

| Chain | Call |
|---|---|
| Asset Hub | `DotnsGateway.increase_attestation_allowance(attester, count)` |
| Asset Hub | `DotnsGateway.set_dispatcher_address(dispatcher)` |
| People | `PeopleLite.increase_attestation_allowance(attester, count)`, sent from Asset Hub as an XCM `Transact` with origin kind `Superuser` |
| Asset Hub | `Revive.call(DotnsNameWhitelist, grantNames(names, namesOwner))` |
| Bulletin | `TransactionStorage.add_authorizer(authorizer, budget)`, sent from Asset Hub as an XCM `Transact` with origin kind `Superuser` |

The Fellowship whitelists the hash of that batch with a referendum on Collectives (Fellows origin, an XCM
`Whitelist.whitelist_call` to Asset Hub). The Asset Hub referendum carries
`Whitelist.dispatch_whitelisted_call_with_preimage(batch)` with a fixed `At(enactAt)` enactment, so it cannot enact
before the whitelist lands.

| File | Content |
|---|---|
| `params.json` | addresses, amounts, names, Bulletin budget, enactment block, endpoints |
| `calls.json` | every encoded call, the inner call hash, the preimage hash and the deadlines |
| `BREAKDOWN.md` | the bytes decoded call by call, for the forum post |
| `PREFLIGHT.md` | live state before submission |
| `DRY_RUN.md` | DryRunApi results of every leg |
| `REHEARSAL.md` | end-to-end run on a Chopsticks fork |
| `STATE.md` | live state after enactment (written by `verify`) |

## Setup

Node 22 or later.

```sh
npm ci
```

## Reproduce the published package

```sh
npm run check
```

This re-encodes from `params.json` and requires `calls.json` to come out byte for byte the same. It then decodes the
bytes independently of the encoder, runs the preflight checks and dry-runs every leg. Any failure exits non-zero.
The encoding is only reproducible while the runtimes it was built against (recorded in `calls.json`) are live.

## Scripts

| Script | What it does |
|---|---|
| `npm run encode -- --pin` | Encodes the package into `calls.json`. `--pin` fills a `null` `enactAt` (relay block now + `enactInDays`) and `bulletin.validUntil` (Bulletin block now + `validDays`) and writes them back to `params.json`. `--check` compares instead of writing. |
| `npm run decode` | Decodes `calls.json` against live metadata into `BREAKDOWN.md`, following each XCM `Transact` into the destination chain and the Revive calldata into the DotNS ABI. Recomputes every hash. `-- --hex <call> --chain <assetHub\|collectives\|people\|bulletin>` decodes any call. |
| `npm run preflight` | Checks live state: runtimes unchanged since encoding, allowances empty, dispatcher deployed (with code hashes), names `Open` and unregistered, names owner mapped to its substrate account, authorizer not yet registered, HRMP channels open, deadlines reachable. Lists the proxies and balances of every account involved. |
| `npm run dry-run` | DryRunApi on live state: the batch with Root on Asset Hub, then each forwarded XCM on People and Bulletin; the Fellowship proposal with the Fellows origin on Collectives, then its XCM on Asset Hub; the referendum preimage with the WhitelistedCaller origin (expected to fail with `CallIsNotWhitelisted` until the whitelist lands); and, with `-- --submitter <ss58>` or `params.submitter`, `note_preimage` + `Referenda.submit` to show the deposits. Checks the expected events and that the batch weight fits the scheduler limit. |
| `npm run rehearse` | Forks Asset Hub, People, Bulletin and Collectives with Chopsticks, connected over XCM. Enacts the Fellowship referendum and then the Whitelisted Caller referendum through the scheduler with their real origins, delivers the XCMs, and runs the post-enactment checks on the fork. Voting is not simulated. Ports 8100 to 8103, or from `REHEARSE_PORT_BASE`. `-- --keep` leaves the fork running. |
| `npm run verify` | After enactment: checks live state against `params.json` and reports allowance used, names registered and the Bulletin budget. Use it for the periodic reports. |

## Submitting

Checklist, in order:

1. Pin the dates. Set `enactAt` and `bulletin.validUntil` to `null`, run `npm run encode -- --pin`, then
   `npm run decode`. `enactAt` must leave the Fellowship 8 days (7-day decision plus one day margin) and the
   whitelist 24 hours before enactment. `calls.json` prints both deadlines as relay blocks. Pinning changes both
   hashes, so pin once and publish.
2. Run `npm run check` and `npm run rehearse`, and commit every generated file.
3. Publish `BREAKDOWN.md`, `DRY_RUN.md` and `REHEARSAL.md` with the two hashes on the forum.
4. Fellowship (Collectives): a sponsoring Fellow signs `fellowship.submit` from `calls.json` and places its
   decision deposit.
5. Asset Hub: the submitter signs `Utility.batch_all([submission.notePreimage, submission.referendaSubmit])`, then
   `Referenda.place_decision_deposit(<index>)` (10,000 DOT on the Whitelisted Caller track). Read the index from the
   `Referenda.Submitted` event, never from a guess.
6. Before `fellowshipSubmitBy` and `whitelistLandedBy`, re-run `npm run preflight`. It reports whether the call is
   whitelisted and the preimage noted.
7. After `enactAt`, run `npm run verify` and commit `STATE.md`.

If the whitelist misses `enactAt`, the referendum enacts without effect. The whitelist is keyed by the inner call
hash, so only the Asset Hub referendum is resubmitted with a new `enactAt`. Its preimage hash does not change.

## Limits of the evidence

The dry runs execute the real runtimes on live state, one leg at a time. The rehearsal chains the legs on a fork,
including the scheduler and XCM delivery, but Chopsticks does not run collators or relay inclusion, and the referenda
are enacted directly rather than voted. Rehearsing on a zombie-bite fork is the stronger test.
