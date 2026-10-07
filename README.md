# pcf-governance

Encodes, decodes, checks and dry-runs the governance calls PCF proposes to the Polkadot Technical Fellowship. The
tooling never signs or submits anything.

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

Node 22.18 or later (`.nvmrc` pins 24). The scripts are TypeScript run directly by Node.

```sh
npm ci
```

`npm ci` also generates the typed chain descriptors from the metadata committed in `.papi/metadata`.

## Reproduce the published package

```sh
npm test        # offline: re-encodes every proposal and compares with its calls.json
npm run check   # online: the same, then decode, preflight and dry run against live Polkadot
```

Encoding is offline: it uses the runtime metadata committed in `.papi/`, so `calls.json` is a pure function of
`params.json` and those runtimes. The online commands check that the live runtimes are still the ones encoded for.

## Commands

| Command | Network | What it does |
|---|---|---|
| `npm run pin` | relay, Bulletin | Fills a `null` `enactAt` (relay block now + `enactInDays`) and `bulletin.validUntil` (Bulletin block now + `validDays`) in `params.json`. |
| `npm run encode` | none | Encodes the package into `calls.json`. `-- --check` compares instead of writing. |
| `npm run decode` | all | Decodes `calls.json` against live metadata into `BREAKDOWN.md`, following each XCM `Transact` into the destination chain and the Revive calldata into the DotNS ABI. Recomputes every hash and fails on a mismatch. `-- --hex <call> --chain <assetHub\|collectives\|people\|bulletin>` decodes any call. |
| `npm run preflight` | all | Live state before submitting: runtimes unchanged, allowances empty, dispatcher deployed (with code hashes), names `Open` and unregistered, names owner mapped to its account, authorizer not yet registered, HRMP channels open, deadlines reachable. Lists the proxies and balances of every account involved. |
| `npm run dry-run` | all | DryRunApi on live state: the batch with Root on Asset Hub, then each forwarded XCM on People and Bulletin; the Fellowship proposal with the Fellows origin, then its XCM on Asset Hub; the preimage with the WhitelistedCaller origin (fails with `CallIsNotWhitelisted` until the whitelist lands); and, with `-- --submitter <ss58>` or `params.submitter`, `note_preimage` + `Referenda.submit` to show the deposits. |
| `npm run rehearse` | all (forked) | Forks Asset Hub, People, Bulletin and Collectives with Chopsticks, enacts both referenda through the scheduler with their real origins, delivers the XCMs and runs the post-enactment checks. Voting is not simulated. `-- --port-base <n>` (default 8100), `-- --keep`. |
| `npm run verify` | Asset Hub, People, Bulletin | After enactment: live state against `params.json`, plus allowance used, names registered and Bulletin budget, for the periodic reports. |

Every command takes `-- --proposal <dir>` (default `proposals/app-onboarding`).

## Submitting

1. Pin the dates: set `enactAt` and `bulletin.validUntil` to `null`, then `npm run pin && npm run encode`. `enactAt`
   must leave the Fellowship 8 days (7-day decision plus one day margin) and the whitelist 24 hours.
   `calls.json` records both deadlines as relay blocks. Pinning changes both hashes, so pin once and publish.
2. `npm run check` and `npm run rehearse`; commit every generated file.
3. Publish `BREAKDOWN.md`, `DRY_RUN.md` and `REHEARSAL.md` with the two hashes on the forum.
4. Collectives: a sponsoring Fellow signs `fellowship.submit` from `calls.json` and places its decision deposit.
5. Asset Hub: the submitter signs `Utility.batch_all([submission.notePreimage, submission.referendaSubmit])`, then
   `Referenda.place_decision_deposit(<index>)` (10,000 DOT on the Whitelisted Caller track). Read the index from the
   `Referenda.Submitted` event.
6. Before `fellowshipSubmitBy` and `whitelistLandedBy`, `npm run preflight` reports whether the call is whitelisted
   and the preimage noted.
7. After `enactAt`, `npm run verify` and commit `STATE.md`.

If the whitelist misses `enactAt`, the referendum enacts without effect. The whitelist is keyed by the inner call
hash, so only the Asset Hub referendum is resubmitted with a new `enactAt`; its preimage does not change.

## When a runtime upgrades

`npm run preflight` fails once a live runtime no longer matches `calls.json`. Refresh the metadata and re-encode:

```sh
npm run papi:update   # fetch the live metadata into .papi/ and regenerate the descriptors
npm run encode        # the hashes change if the call encoding did
```

## Layout

```
src/lib/        reusable modules
  chains.ts       the five chains, typed descriptors, connections pinned to a finalized block
  proposal.ts     params.json schema, validation, proposal paths
  package.ts      builds the governance package offline (calls.json)
  xcm.ts          XCM locations and the unpaid Transact message
  dotns.ts        DotNS ABIs and read-only contract calls through ReviveApi
  decode.ts       renders call data as a tree, following nested calls across chains
  enacted.ts      post-enactment checks, shared by verify and rehearse
  events.ts       runtime event helpers
  chopsticks.ts   Chopsticks fork process and dev RPCs
  report.ts       PASS/FAIL checks and their Markdown report
  format.ts       hex, hashes, accounts, display
  cli.ts          flag parsing and exit codes
src/cli/        one file per command
test/           offline tests (node:test)
.papi/          committed runtime metadata; descriptors are generated from it
```

## Development

```sh
npm run lint        # Biome: lint + format check (npm run lint:fix to apply)
npm run typecheck   # tsc, strict
npm test
```

CI runs all three on every pull request.

To add a proposal, copy a proposal folder, edit `params.json` and run the commands with `-- --proposal <dir>`. A
proposal with different calls needs its own builder next to `src/lib/package.ts`.

## Limits of the evidence

The dry runs execute the real runtimes on live state, one leg at a time. The rehearsal chains the legs on a fork,
including the scheduler and XCM delivery, but Chopsticks does not run collators or relay inclusion, and the referenda
are enacted directly rather than voted. Rehearsing on a zombie-bite fork is the stronger test.
