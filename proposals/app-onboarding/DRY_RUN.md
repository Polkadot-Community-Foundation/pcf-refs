# Dry run: Whitelisting the Polkadot App user onboarding calls

DryRunApi against live Polkadot state by `src/cli/dry-run.ts`. Asset Hub block #21553609 (`0xeeb09dc34aa6e94886944b075d904873d5e49989cd2107920bd02acac6f50bc5`), People #10688197 (`0x871552d840106916c4bb9ae604b742ba40fc68d34c8f71738172f7cf3ff68f94`), Bulletin #2141304 (`0xdae319b136229386f0ddc1055140398d431aeb214497c00164ea5335d1d0b4c9`), Collectives #9856616 (`0x8db35407ed25cabefa96f260802f04d040a33d63841ac4bd62ef0a73603e31a7`). Runtimes 2005000.

Inner call hash `0x417895ace5e6aeae046bee1f80952a6bef58adba1d7071a5af8f460dd40168a3`, preimage hash `0x7c14077c2d5f0a14203a4af55680ec9c704243f3f879ccdcb5d18783689c4b50`.

| | Check | Detail |
|---|---|---|
| · | state | Asset Hub #21553609 0xeeb09dc34aa6e94886944b075d904873d5e49989cd2107920bd02acac6f50bc5, People #10688197, Bulletin #2141304, Collectives #9856616 |
| · | package | inner call 0x417895ace5e6aeae046bee1f80952a6bef58adba1d7071a5af8f460dd40168a3, preimage 0x7c14077c2d5f0a14203a4af55680ec9c704243f3f879ccdcb5d18783689c4b50 |
| ✅ | Asset Hub: inner batch executes with Root | 15 events |
| ✅ | Asset Hub: DotnsGateway.AttestationAllowanceIncreased for the attester | {"account":"15sDLj4T9NnCtT665koDMxBs1PZw3rzDc6wcz9tN9kKTQ2zj","count":1000000} |
| ✅ | Asset Hub: DotnsGateway.DispatcherAddressSet to the dispatcher | {"address":"0xa06d1cb1e3fedff7b5dfa779b4cc61703f8a46a1"} |
| ✅ | Asset Hub: DotnsNameWhitelist NameAccepted for every name, to the names owner | getcash→0xA5C4c241985D77A0296a0FB83E0FA5905e9E39De, dotns→0xA5C4c241985D77A0296a0FB83E0FA5905e9E39De, browse→0xA5C4c241985D77A0296a0FB83E0FA5905e9E39De |
| ✅ | Asset Hub: two XCMs sent |  |
| · | Asset Hub events | DotnsGateway.AttestationAllowanceIncreased, Utility.ItemCompleted, DotnsGateway.DispatcherAddressSet, Utility.ItemCompleted, XcmpQueue.XcmpMessageSent, PolkadotXcm.Sent, Utility.ItemCompleted, Revive.ContractEmitted, Revive.ContractEmitted, Revive.ContractEmitted, Utility.ItemCompleted, XcmpQueue.XcmpMessageSent, PolkadotXcm.Sent, Utility.ItemCompleted, Utility.BatchCompleted |
| ✅ | Bulletin: XCM from Asset Hub executes | {"type":"Complete","value":{"used":{"ref_time":"147709000","proof_size":"3532"}}} |
| ✅ | Bulletin: TransactionStorage.AuthorizerAdded | {"who":"1YoKNfXM43vegdG6g4XHCDPK6EGykYgHPNkXfRL6etnma1b"} |
| · | Bulletin events | System.NewAccount, TransactionStorage.AuthorizerAdded |
| ✅ | People: XCM from Asset Hub executes | {"type":"Complete","value":{"used":{"ref_time":"138602000","proof_size":"3517"}}} |
| ✅ | People: PeopleLite.AttestationAllowanceIncreased | {"account":"15sDLj4T9NnCtT665koDMxBs1PZw3rzDc6wcz9tN9kKTQ2zj","count":1000000} |
| · | People events | PeopleLite.AttestationAllowanceIncreased |
| ✅ | XCM to People forwarded |  |
| ✅ | XCM to Bulletin forwarded |  |
| ✅ | inner batch declared weight fits the scheduler limit | ref_time 10668506773 / 1600000000000, proof 1022628 / 8388608 |
| · | inner batch actual weight | {"ref_time":"4610991307","proof_size":"634078"} |
| ✅ | Collectives: Fellowship proposal executes with the Fellows origin | ok |
| ✅ | Collectives: one XCM forwarded, to Asset Hub |  |
| ✅ | Asset Hub: Whitelist.CallWhitelisted for the inner call hash | {"call_hash":"0x417895ace5e6aeae046bee1f80952a6bef58adba1d7071a5af8f460dd40168a3"} |
| ✅ | Asset Hub: WhitelistedCaller origin accepted, fails only with CallIsNotWhitelisted until the whitelist lands | {"type":"Module","value":{"type":"Whitelist","value":{"type":"CallIsNotWhitelisted"}}} |
| · | submission dry run skipped | set params.submitter or pass --submitter <ss58> |
