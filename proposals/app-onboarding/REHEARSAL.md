# Rehearsal (Chopsticks): Whitelisting the Polkadot App user onboarding calls

End-to-end probe by `src/cli/rehearse.ts` on a Chopsticks fork of live Asset Hub, People, Bulletin and Collectives. The Fellowship referendum and the Whitelisted Caller referendum are enacted through the scheduler with their real origins; voting is not simulated.

Inner call hash `0x417895ace5e6aeae046bee1f80952a6bef58adba1d7071a5af8f460dd40168a3`, preimage hash `0x7c14077c2d5f0a14203a4af55680ec9c704243f3f879ccdcb5d18783689c4b50`.

| | Check | Detail |
|---|---|---|
| ✅ | Collectives: Fellowship proposal enacted, XCM sent to Asset Hub | XcmpQueue.XcmpMessageSent, PolkadotXcm.Sent, Scheduler.Dispatched |
| ✅ | Asset Hub: inner call hash whitelisted | 0x417895ace5e6aeae046bee1f80952a6bef58adba1d7071a5af8f460dd40168a3 |
| ✅ | Asset Hub: referendum enacted with WhitelistedCaller | {"success":true} |
| ✅ | Asset Hub: Whitelist.WhitelistedCallDispatched |  |
| ✅ | Asset Hub: inner batch succeeded inside the whitelisted dispatch | {"success":true,"value":{"actual_weight":{"ref_time":"4610991307","proof_size":"634078"},"pays_fee":{"type":"Yes"}}} |
| · | Asset Hub events | DotnsGateway.AttestationAllowanceIncreased, Utility.ItemCompleted, DotnsGateway.DispatcherAddressSet, Utility.ItemCompleted, XcmpQueue.XcmpMessageSent, PolkadotXcm.Sent, Utility.ItemCompleted, Revive.ContractEmitted, Revive.ContractEmitted, Revive.ContractEmitted, Utility.ItemCompleted, XcmpQueue.XcmpMessageSent, PolkadotXcm.Sent, Utility.ItemCompleted, Utility.BatchCompleted, Whitelist.WhitelistedCallDispatched, Scheduler.Dispatched, Preimage.Cleared, Dap.IssuanceMinted |
| ✅ | people: PeopleLite.AttestationAllowanceIncreased after XCM delivery | block #10688078 |
| ✅ | bulletin: TransactionStorage.AuthorizerAdded after XCM delivery | block #2141264 |
| ✅ | Asset Hub attester allowance granted | 1,000,000 left of 1,000,000, 0 used |
| ✅ | People attester allowance granted | 1,000,000 left of 1,000,000, 0 used |
| ✅ | dispatcher set | 0xa06d1cb1e3fedff7b5dfa779b4cc61703f8a46a1 |
| ✅ | getcash.dot granted to the names owner, not yet registered | status Claimed, grantee 0xA5C4c241985D77A0296a0FB83E0FA5905e9E39De |
| ✅ | dotns.dot granted to the names owner, not yet registered | status Claimed, grantee 0xA5C4c241985D77A0296a0FB83E0FA5905e9E39De |
| ✅ | browse.dot granted to the names owner, not yet registered | status Claimed, grantee 0xA5C4c241985D77A0296a0FB83E0FA5905e9E39De |
| ✅ | Bulletin authorizer registered | {"quota":{"transactions":5000,"bytes":"10737418240"},"valid_until":7396458,"feeless":true} |
| ✅ | Bulletin authorizer expiry as proposed | #7396458 |
| · | Bulletin authorizer expires in | 364.9 days |
