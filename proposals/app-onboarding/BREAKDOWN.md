# Whitelisting the Polkadot App user onboarding calls: decoded calls

Decoded by `src/cli/decode.ts` from the bytes in `calls.json` against live metadata (Asset Hub 2005000, People 2005000, Collectives 2005000). Every hash below is recomputed from the bytes.

## Referendum preimage (Asset Hub, Whitelisted Caller track)

| | |
|---|---|
| Preimage hash | `0x681f287489eea7db8bf4a37c03d4f8f861fa69565c313aa5e45dbf1a6ff29325` |
| Preimage length | 120 bytes |
| Whitelisted (inner) call hash | `0x33ed6c42bb4078327a29bf59f8cb34c9df2f93703c3c624e47dc967b4a4af03f` |
| Inner call length | 118 bytes |

- **Asset Hub** `Whitelist.dispatch_whitelisted_call_with_preimage`: dispatches with Root the call whose hash the Fellowship whitelisted, `0x33ed6c42bb4078327a29bf59f8cb34c9df2f93703c3c624e47dc967b4a4af03f` (118 B)
  - **Asset Hub** `Utility.batch_all`: 3 calls, all or nothing
    - **Asset Hub** `DotnsGateway.increase_attestation_allowance` `{"account":"15sDLj4T9NnCtT665koDMxBs1PZw3rzDc6wcz9tN9kKTQ2zj","count":1000000}`
    - **Asset Hub** `DotnsGateway.set_dispatcher_address` `{"address":"0xa06d1cb1e3fedff7b5dfa779b4cc61703f8a46a1"}`
    - **Asset Hub** `PolkadotXcm.send` to parachain 1004 (People), parents 1
      - XCM `UnpaidExecution` `{"weight_limit":{"type":"Unlimited"}}`
      - XCM `Transact`, origin kind `Superuser`
        - **People** `PeopleLite.increase_attestation_allowance` `{"account":"15sDLj4T9NnCtT665koDMxBs1PZw3rzDc6wcz9tN9kKTQ2zj","count":1000000}`

## Fellowship referendum (Collectives, Fellows origin)

Whitelists exactly the inner call hash above: yes.

Removes from the whitelist, in the same batch, the inner call hash it supersedes: `0x90640a174e1d62b5645f31cb053d562e95a63881fd1e0f9197edbbcf83e21fad`.

- **Collectives** `FellowshipReferenda.submit`: track origin `FellowshipOrigins.Fellows`, enactment `After(10)`
  - **Collectives** `PolkadotXcm.send` to parachain 1000 (Asset Hub), parents 1
    - XCM `UnpaidExecution` `{"weight_limit":{"type":"Unlimited"}}`
    - XCM `Transact`, origin kind `Xcm`
      - **Asset Hub** `Utility.batch_all`: 2 calls, all or nothing
        - **Asset Hub** `Whitelist.remove_whitelisted_call`: removes call hash `0x90640a174e1d62b5645f31cb053d562e95a63881fd1e0f9197edbbcf83e21fad` from the whitelist
        - **Asset Hub** `Whitelist.whitelist_call`: whitelists call hash `0x33ed6c42bb4078327a29bf59f8cb34c9df2f93703c3c624e47dc967b4a4af03f`

## Referendum submission (Asset Hub)

The referendum enacts from relay block 33698272. A Fellowship referendum proposed before relay block 33583072 whitelists the call before then.

- **Asset Hub** `Referenda.submit`: track origin `Origins.WhitelistedCaller`, proposal `Lookup` `{"hash":"0x681f287489eea7db8bf4a37c03d4f8f861fa69565c313aa5e45dbf1a6ff29325","len":120}`, enactment `At(33698272)`

## Raw bytes

| Item | Hex |
|---|---|
| Referendum preimage (`Preimage.note_preimage` input) | `0x400328020c9802d73cbe95c22972969358215bd2380a16fb696a2154f1b1777d3dada8e94cab0d40420f009804a06d1cb1e3fedff7b5dfa779b4cc61703f8a46a11f0005010100b10f05082f0000060200983e00d73cbe95c22972969358215bd2380a16fb696a2154f1b1777d3dada8e94cab0d40420f00` |
| Inner call (whitelisted) | `0x28020c9802d73cbe95c22972969358215bd2380a16fb696a2154f1b1777d3dada8e94cab0d40420f009804a06d1cb1e3fedff7b5dfa779b4cc61703f8a46a11f0005010100b10f05082f0000060200983e00d73cbe95c22972969358215bd2380a16fb696a2154f1b1777d3dada8e94cab0d40420f00` |
| `FellowshipReferenda.submit` (Collectives) | `0x3d003e020165011f0005010100a10f05082f00000603001d01280208400190640a174e1d62b5645f31cb053d562e95a63881fd1e0f9197edbbcf83e21fad400033ed6c42bb4078327a29bf59f8cb34c9df2f93703c3c624e47dc967b4a4af03f010a000000` |
| `Referenda.submit` (Asset Hub) | `0x3e003f0d02681f287489eea7db8bf4a37c03d4f8f861fa69565c313aa5e45dbf1a6ff293257800000000e0310202` |
