# pcf-refs

Call data and dry runs for the governance referenda the Polkadot Community Foundation (PCF) proposes on Polkadot.
Each proposal has its own folder with a README that explains what it asks for, why, what each call does on chain, and
how to check it.

**This repository never signs or dispatches anything on chain.** It does three things:

1. **Generates call data**: every call of a proposal, the preimage and the referendum submissions, encoded offline
   from runtime metadata committed in this repository.
2. **Executes dry runs**: each call with the origin it will have once enacted, against live Polkadot state
   (`DryRunApi`) and on a local Chopsticks fork that runs the whole sequence end to end.
3. **Logs the outcomes**: every check states the outcome it expects. PASS means the observed outcome is the expected
   one, including expected errors; FAIL means it is not. Each run writes a Markdown report and a JSON log.

Signing and submitting happen outside this repository. Anyone can check the call data submitted on chain against the
call data and hashes published here.

## Proposals

| Proposal | Summary | Chains changed | Governance route | Status | Releases |
|---|---|---|---|---|---|
| [`app-onboarding`](proposals/app-onboarding/README.md) | Attestation allowances, the dotNS dispatcher and three app names, so Polkadot App users can complete onboarding | Asset Hub, People | Fellowship whitelist, then Whitelisted Caller | Version 2 under discussion on the [forum](https://forum.polkadot.network/t/final-steps-for-dotdao-to-enable-user-onboarding-via-polkadot-app/18937), not released | [`app-onboarding/v1-rc1`](https://github.com/Polkadot-Community-Foundation/pcf-refs/releases/tag/app-onboarding/v1-rc1) (earlier five-call version, superseded) |

## Verify a proposal

Requires Node 22.18 or later (`.nvmrc` pins 24) and network access to the Polkadot RPC endpoints in the proposal's
`params.json`. `rehearse` also starts local Chopsticks forks on three ports from 8100. See [Setup](#setup).

From a clone, for any proposal folder:

```sh
git clone https://github.com/Polkadot-Community-Foundation/pcf-refs && cd pcf-refs
npm ci
npm test                                                  # re-encodes every calls.json encoded for the committed metadata
npm run encode -- --proposal proposals/<name> --check     # re-encodes this proposal and compares byte for byte
npm run decode -- --proposal proposals/<name> && git diff --exit-code -- proposals/<name>/BREAKDOWN.md
npm run preflight -- --proposal proposals/<name>          # live state before publication
npm run dry-run -- --proposal proposals/<name>            # every call with its real origin, on live state
npm run rehearse -- --proposal proposals/<name>           # the whole sequence on a local fork
```

Each proposal README says what each command must show for that proposal. All commands are described in
[Commands](#commands).

## Limits of the evidence

The dry runs execute the real runtimes on live state, one leg at a time. The rehearsal chains the legs on a fork,
including the scheduler and XCM delivery, but Chopsticks does not run collators or relay inclusion, and the referenda
are enacted directly rather than voted on.

## Proposal folder

Each proposal lives in `proposals/<name>/`:

| File | Committed | Content |
|---|---|---|
| `README.md` | yes | what the proposal asks for and why, each call, the governance route and how to verify it |
| `params.json` | yes | the only input: addresses, amounts, names, enactment block, RPC endpoints |
| `calls.json` | yes | every encoded call, both hashes and the deadlines |
| `BREAKDOWN.md` | yes | the call data decoded call by call against live metadata |
| `reports/` | no | reports (`.md`), logs (`.json`) and console output (`.log`) of the online commands; published by CI and in releases |

## Releases

Releases are at <https://github.com/Polkadot-Community-Foundation/pcf-refs/releases>. A release is cut by pushing a
tag `<proposal>/v<n>` to a commit on `main`, or `<proposal>/v<n>-rc<m>` for a pre-release. The release workflow re-runs
every check on a clean runner and publishes, only if every check passed:

- the call data as hex files (`preimage.hex`, `inner-call.hex`, `note-preimage.hex`, `referenda-submit.hex`,
  `fellowship-submit.hex`), with `calls.json`, `params.json` and `BREAKDOWN.md`;
- the preflight, dry-run and rehearsal reports, with their JSON logs and console output;
- a tarball of all of it with `SHA256SUMS` and `RELEASE_NOTES.md`, and release notes listing both hashes, the
  deadlines and the outcome of each report.

### Verify a release

Check the published files, tie them to the commit they were built from, then run the checks against live Polkadot.
The tarball is named after the tag with `/` replaced by `-`:

```sh
tar xzf <proposal>-v<n>[-rc<m>].tar.gz && cd <proposal> && sha256sum -c SHA256SUMS
for f in preimage:refPreimage inner-call:rootBatch note-preimage:submission.notePreimage \
         referenda-submit:submission.referendaSubmit fellowship-submit:fellowship.submit; do
  test "$(cat ${f%%:*}.hex)" = "$(node -p "require('./calls.json').${f#*:}")" \
    && echo "${f%%:*}.hex matches calls.json" || echo "${f%%:*}.hex DIFFERS from calls.json"
done
git clone https://github.com/Polkadot-Community-Foundation/pcf-refs && cd pcf-refs
git checkout <commit from the release notes> && npm ci
diff ../calls.json proposals/<proposal>/calls.json   # the published call data is this commit's
npm test                                             # re-encodes calls.json offline and compares byte for byte
npm run decode -- --proposal proposals/<proposal> && git diff --exit-code -- proposals/<proposal>/BREAKDOWN.md
npm run preflight -- --proposal proposals/<proposal>
npm run dry-run -- --proposal proposals/<proposal>
```

The release notes list the same commands for the release.

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
| `npm run decode` | Asset Hub, People, Collectives (`--hex` also Bulletin) | Decodes `calls.json` against live metadata into `BREAKDOWN.md`, following each XCM `Transact` into the destination chain and the Revive calldata into the dotNS ABI. Recomputes every hash and fails on a mismatch. `-- --hex <call> --chain <assetHub\|collectives\|people\|bulletin>` decodes any call. |
| `npm run preflight` | relay, Asset Hub, People, Collectives | Read-only checks of live state before publication: runtimes unchanged, targets in their expected starting state, contracts deployed (with code hashes), XCM routes open, deadlines reachable (with estimated UTC dates, which the release notes repeat). It also reports the balance of each account involved. |
| `npm run dry-run` | Asset Hub, People, Collectives | `DryRunApi` on live state: every call with the origin it will have once enacted, including the XCMs it sends, executed on their destination chains; the Fellowship proposal with the Fellows origin; the preimage with the Whitelisted Caller origin. With `-- --submitter <ss58>` or `params.submitter`, also `note_preimage` + `Referenda.submit`, to show the deposits. |
| `npm run rehearse` | Asset Hub, People, Collectives, on a local fork | Forks the chains with Chopsticks, enacts both referenda through the scheduler with their real origins, delivers the XCMs, and reads the state the proposal changes before and after enactment. Then it runs the post-enactment checks. Voting is not simulated. `-- --port-base <n>` (default 8100), `-- --keep`. |
| `npm run verify` | Asset Hub, People | After enactment: live state against `params.json`, so anyone can track usage after enactment. |
| `npm run bundle` | none | Assembles the release assets into `dist/<proposal>/`; refuses unless `calls.json` re-encodes and every report passed. |
| `npm run check` | relay, Asset Hub, People, Collectives | `encode --check`, `decode`, `preflight` and `dry-run` in one go. |

The checks each command runs for a proposal are listed in that proposal's README. Every command but `check` takes
`-- --proposal <dir>` (default `proposals/app-onboarding`); `check` runs the default. Reports go to
`proposals/<name>/reports/`.

## Maintaining

### Preparing a release

1. Pin the enactment block: set `enactAt` to `null`, then `npm run pin && npm run encode && npm run decode`. Pinning
   changes `Referenda.submit` and the deadlines, so pin once, open a pull request, and tag the merge commit.
2. Tag it with the next unused version (tag format in [Releases](#releases)) and push the tag.

### When a runtime upgrades

`npm run preflight` and the daily `dry-run` fail once a live runtime no longer matches `calls.json`. Refresh the
metadata and re-encode:

```sh
npm run papi:update   # fetch the live metadata into .papi/ and regenerate the descriptors
npm run encode        # the hashes change if the call encoding did
npm run decode
```

Offline tests skip proposals encoded for older runtimes, since those can no longer be reproduced from newer metadata.

### Layout

```
proposals/      one folder per proposal (see Proposal folder)
src/lib/        reusable modules
  chains.ts       the five chains, typed descriptors, connections pinned to a finalized block, failover endpoints
  proposal.ts     params.json schema, validation, proposal paths
  package.ts      builds the governance package offline (calls.json)
  xcm.ts          XCM locations and the unpaid Transact message
  dotns.ts        dotNS ABIs and read-only contract calls through ReviveApi
  decode.ts       renders call data as a tree, following nested calls across chains
  enacted.ts      post-enactment checks, shared by verify and rehearse
  events.ts       runtime event helpers
  chopsticks.ts   Chopsticks fork process and dev RPCs
  report.ts       expected-outcome checks, Markdown reports and JSON logs
  format.ts       hex, hashes, accounts, display
  timeout.ts      timeouts for chain connections and fork RPCs
  cli.ts          flag parsing, report output and exit codes
src/cli/        one file per command
test/           offline tests (node:test)
.papi/          committed runtime metadata; descriptors are generated from it
```

### Development

```sh
npm run lint        # Biome lint and format check; warnings fail (npm run lint:fix to apply)
npm run typecheck   # tsc, strict
npm test
```

To add a proposal, copy a proposal folder, edit `params.json` and its README, and run the commands with
`-- --proposal <dir>`. A proposal with different calls needs its own builder next to `src/lib/package.ts`. Add a row
for it to [Proposals](#proposals).
