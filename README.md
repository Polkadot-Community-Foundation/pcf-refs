# pcf-refs

Call data and dry runs for the governance referenda the Polkadot Community Foundation (PCF) proposes on Polkadot.

**This repository never signs or dispatches anything on chain.** It does three things:

1. **Generates call data**: every call of a proposal, the preimage and the referendum submissions, encoded offline
   from runtime metadata committed in this repository.
2. **Executes dry runs**: each call with the origin it will have once enacted, against live Polkadot state
   (`DryRunApi`) and on a local Chopsticks fork that runs the whole sequence end to end.
3. **Logs the outcomes**: every check states the outcome it expects. PASS means the observed outcome is the expected
   one, including expected errors; FAIL means it is not. Each run writes a Markdown report and a JSON log.

Signing and submitting happen outside this repository, by the accounts that own each step.

## Proposals

Each proposal lives in `proposals/<name>/`:

| File | Committed | Content |
|---|---|---|
| `params.json` | yes | the only input: addresses, amounts, names, enactment block, RPC endpoints |
| `calls.json` | yes | every encoded call, both hashes and the deadlines |
| `BREAKDOWN.md` | yes | the call data decoded call by call against live metadata |
| `reports/` | no | reports (`.md`), logs (`.json`) and console output (`.log`) of the online commands; published by CI and in releases |

### `app-onboarding`

*Whitelisting the Polkadot App user onboarding calls.* One `Utility.batch_all` on Asset Hub, dispatched with Root
through the Whitelisted Caller track:

| Chain | Call |
|---|---|
| Asset Hub | `DotnsGateway.increase_attestation_allowance(attester, count)` |
| Asset Hub | `DotnsGateway.set_dispatcher_address(dispatcher)` |
| People | `PeopleLite.increase_attestation_allowance(attester, count)`, sent from Asset Hub as an XCM `Transact` with origin kind `Superuser` |
| Asset Hub | `Revive.call(DotnsNameWhitelist, grantNames(names, namesOwner))` |

The proposal does not ask for Bulletin storage: PCF funds its own through paid lite personhood
(`PeopleLite.register_with_fee`, then `Resources.claim_long_term_storage`, both on People), with no governance call.

The Fellowship whitelists the hash of that batch with a referendum on Collectives (Fellows origin, an XCM
`Whitelist.whitelist_call` to Asset Hub). The Asset Hub referendum carries
`Whitelist.dispatch_whitelisted_call_with_preimage(batch)` with a fixed `At(enactAt)` enactment, so it cannot enact
before the whitelist lands. Both referenda are assumed to decide within 7 days of their decision deposits, and the
whitelist must be on Asset Hub 2 days before `enactAt`. So the Fellowship referendum must be submitted, with its
decision deposit, 9 days before `enactAt`; `calls.json` records both deadlines as relay blocks. `pin` sets `enactAt`
10 days out, leaving a day to publish the release and submit both referenda.

## Releases

A release is cut by pushing a tag `<proposal>/v<n>` to a commit on `main`, or `<proposal>/v<n>-rc<m>` for a
pre-release. The release workflow re-runs every check on a clean runner and publishes, only if every check passed:

- the call data as hex files (`preimage.hex`, `inner-call.hex`, `note-preimage.hex`, `referenda-submit.hex`,
  `fellowship-submit.hex`) and `calls.json`;
- the preflight, dry-run and rehearsal reports, with their JSON logs and console output;
- a tarball of all of it with `SHA256SUMS`, and release notes listing both hashes, the deadlines and the outcome of
  each report.

To verify a release, check the published files, tie them to the commit they were built from, then run the checks
against live Polkadot. The tarball is named after the tag with `/` replaced by `-`:

```sh
tar xzf <proposal>-v<n>[-rc<m>].tar.gz && cd <proposal> && sha256sum -c SHA256SUMS
git clone https://github.com/Polkadot-Community-Foundation/pcf-refs && cd pcf-refs
git checkout <commit from the release notes> && npm ci
diff ../calls.json proposals/<proposal>/calls.json   # the published call data is this commit's
npm test                                             # re-encodes calls.json offline and compares byte for byte
npm run decode -- --proposal proposals/<proposal> && git diff --exit-code -- proposals/<proposal>/BREAKDOWN.md
npm run preflight -- --proposal proposals/<proposal>
npm run dry-run -- --proposal proposals/<proposal>
```

The release notes list these commands for the release, plus one check of each `*.hex` file against its field in
`calls.json`.

## Continuous checks

| Workflow | When | What |
|---|---|---|
| `ci` | every pull request and push to `main` | lint, typecheck, and the offline tests (re-encode every proposal and compare byte for byte) |
| `dry-run` | daily, on pull requests touching proposals or code, and on demand | all online commands for a proposal; reports and logs are uploaded as an artifact and summarized on the run page |
| `release` | on a release tag | everything above, then the release |

The daily run fails when a runtime upgrade invalidates the published call data, or when the chain state the proposal
expects has changed (for example once it is enacted).

## Setup

Node 22.18 or later (`.nvmrc` pins 24). The scripts are TypeScript run directly by Node.

```sh
npm ci
```

`npm ci` also generates the typed chain descriptors (polkadot-api) from the metadata in `.papi/metadata`.

## Commands

| Command | Network | What it does |
|---|---|---|
| `npm run pin` | relay | Fills a `null` `enactAt` (relay block now + `enactInDays`) in `params.json`. A value already set is kept. |
| `npm run encode` | none | Encodes the package into `calls.json`. `-- --check` compares instead of writing. |
| `npm run decode` | Asset Hub, People, Collectives (`--hex` also Bulletin) | Decodes `calls.json` against live metadata into `BREAKDOWN.md`, following each XCM `Transact` into the destination chain and the Revive calldata into the DotNS ABI. Recomputes every hash and fails on a mismatch. `-- --hex <call> --chain <assetHub\|collectives\|people\|bulletin>` decodes any call. |
| `npm run preflight` | relay, Asset Hub, People, Collectives | Live state before publication: runtimes unchanged, allowances empty, dispatcher deployed (with code hashes), names `Open` and unregistered, names owner mapped to its account, HRMP channel to People open, deadlines reachable (with estimated UTC dates, which the release notes repeat). Lists the proxies and balances of every account involved. |
| `npm run dry-run` | Asset Hub, People, Collectives | `DryRunApi` on live state: the batch with Root on Asset Hub, then its one forwarded XCM on People, and no XCM to any other chain; the Fellowship proposal with the Fellows origin, then its XCM on Asset Hub; the preimage with the WhitelistedCaller origin, expected to fail with `CallIsNotWhitelisted` until the whitelist lands; and, with `-- --submitter <ss58>` or `params.submitter`, `note_preimage` + `Referenda.submit` to show the deposits. |
| `npm run rehearse` | Asset Hub, People, Collectives, on a local fork | Forks Asset Hub, People and Collectives with Chopsticks, enacts both referenda through the scheduler with their real origins, delivers the XCMs (Asset Hub must send exactly one, to People), then reads the state it changes before and after: each allowance must grow by exactly `count`, the dispatcher must become the proposed address, and each name must go from `Open` to granted to the names owner. Then it runs the post-enactment checks. Voting is not simulated. `-- --port-base <n>` (default 8100), `-- --keep`. |
| `npm run verify` | Asset Hub, People | After enactment: live state against `params.json`, with allowance used and names registered, for periodic reports. |
| `npm run bundle` | none | Assembles the release assets into `dist/<proposal>/`; refuses unless `calls.json` re-encodes and every report passed. |
| `npm run check` | relay, Asset Hub, People, Collectives | `encode --check`, `decode`, `preflight` and `dry-run` in one go. |

Every command but `check` takes `-- --proposal <dir>` (default `proposals/app-onboarding`); `check` runs the default.
Reports go to `proposals/<name>/reports/`.

## Preparing a release

1. Pin the enactment block: set `enactAt` to `null`, then `npm run pin && npm run encode && npm run decode`. Pinning
   changes `Referenda.submit` and the deadlines, so pin once, open a pull request, and tag the merge commit.
2. Tag it with the next unused version: `git tag <proposal>/v<n>-rc<m> && git push origin <proposal>/v<n>-rc<m>`.

If the whitelist misses `enactAt`, the referendum enacts without effect. The whitelist is keyed by the inner call
hash, so only the Asset Hub referendum needs a new `enactAt`; its preimage does not change.

## When a runtime upgrades

`npm run preflight` and the daily `dry-run` fail once a live runtime no longer matches `calls.json`. Refresh the
metadata and re-encode:

```sh
npm run papi:update   # fetch the live metadata into .papi/ and regenerate the descriptors
npm run encode        # the hashes change if the call encoding did
npm run decode
```

Offline tests skip proposals encoded for older runtimes, since those can no longer be reproduced from newer metadata.

## Layout

```
src/lib/        reusable modules
  chains.ts       the five chains, typed descriptors, connections pinned to a finalized block, failover endpoints
  proposal.ts     params.json schema, validation, proposal paths
  package.ts      builds the governance package offline (calls.json)
  xcm.ts          XCM locations and the unpaid Transact message
  dotns.ts        DotNS ABIs and read-only contract calls through ReviveApi
  decode.ts       renders call data as a tree, following nested calls across chains
  enacted.ts      post-enactment checks, shared by verify and rehearse
  events.ts       runtime event helpers
  chopsticks.ts   Chopsticks fork process and dev RPCs
  report.ts       expected-outcome checks, Markdown reports and JSON logs
  format.ts       hex, hashes, accounts, display
  cli.ts          flag parsing, report output and exit codes
src/cli/        one file per command
test/           offline tests (node:test)
.papi/          committed runtime metadata; descriptors are generated from it
```

## Development

```sh
npm run lint        # Biome lint and format check; warnings fail (npm run lint:fix to apply)
npm run typecheck   # tsc, strict
npm test
```

To add a proposal, copy a proposal folder, edit `params.json` and run the commands with `-- --proposal <dir>`. A
proposal with different calls needs its own builder next to `src/lib/package.ts`.

## Limits of the evidence

The dry runs execute the real runtimes on live state, one leg at a time. The rehearsal chains the legs on a fork,
including the scheduler and XCM delivery, but Chopsticks does not run collators or relay inclusion, and the referenda
are enacted directly rather than voted on.
