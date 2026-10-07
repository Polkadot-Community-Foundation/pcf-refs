# Dry run: Whitelisting the Polkadot App user onboarding calls

DryRunApi against live Polkadot state by `src/dry-run.mjs`. Asset Hub block #21551711 (`0x7c65bf92d62d0fd0cb506e81c52a8d63b56254c107f1be9c7f73d35503a151f6`), People #10686229 (`0xf4b3a7dd20c0a7f7905ebc939e6a023f1034d8c5cc1e5d89cc117d0bbdb3fad2`), Bulletin #2140618 (`0xcb09e447d915fd3330f14152cc6b5a261e3990f9f225cc1aea6b5269117d8b76`), Collectives #9856309 (`0x1791afaf45d0a2085e7abcd9fe60d1e34187215f8cf62b18c0bc88d6927c422d`). Runtimes 2005000.

Inner call hash `0x417895ace5e6aeae046bee1f80952a6bef58adba1d7071a5af8f460dd40168a3`, preimage hash `0x7c14077c2d5f0a14203a4af55680ec9c704243f3f879ccdcb5d18783689c4b50`.

| | Check | Detail |
|---|---|---|
| · | state | Asset Hub #21551711 0x7c65bf92d62d0fd0cb506e81c52a8d63b56254c107f1be9c7f73d35503a151f6, People #10686229, Bulletin #2140618, Collectives #9856309 |
| · | package | inner call 0x417895ace5e6aeae046bee1f80952a6bef58adba1d7071a5af8f460dd40168a3, preimage 0x7c14077c2d5f0a14203a4af55680ec9c704243f3f879ccdcb5d18783689c4b50 |
| ✅ | Asset Hub: inner batch executes with Root | 15 events |
| ✅ | Asset Hub: DotnsGateway.AttestationAllowanceIncreased for the attester | {"account":"15sDLj4T9NnCtT665koDMxBs1PZw3rzDc6wcz9tN9kKTQ2zj","count":1000000} |
| ✅ | Asset Hub: DotnsGateway.DispatcherAddressSet to the dispatcher | {"address":"0xa06d1cb1e3fedff7b5dfa779b4cc61703f8a46a1"} |
| ✅ | Asset Hub: DotnsNameWhitelist NameAccepted for every name, to the names owner | getcash→0xA5C4c241985D77A0296a0FB83E0FA5905e9E39De, dotns→0xA5C4c241985D77A0296a0FB83E0FA5905e9E39De, browse→0xA5C4c241985D77A0296a0FB83E0FA5905e9E39De |
| ✅ | Asset Hub: two XCMs sent | PolkadotXcm.Sent, PolkadotXcm.Sent |
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
| ✅ | Collectives: one XCM forwarded to Asset Hub |  |
| ✅ | Asset Hub: Whitelist.CallWhitelisted for the inner call hash | {"call_hash":"0x417895ace5e6aeae046bee1f80952a6bef58adba1d7071a5af8f460dd40168a3"} |
| ✅ | Asset Hub: WhitelistedCaller origin accepted, fails only with CallIsNotWhitelisted until the whitelist lands | {"type":"Module","value":{"type":"Whitelist","value":{"type":"CallIsNotWhitelisted"}}} |
| · | submission dry run skipped | set params.submitter or pass --submitter <ss58> |
| · | decision deposit (Referenda.place_decision_deposit, after submit) | 10,000 DOT |
