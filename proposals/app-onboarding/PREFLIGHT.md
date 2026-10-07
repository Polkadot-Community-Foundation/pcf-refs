# Preflight: Whitelisting the Polkadot App user onboarding calls

Read-only checks by `src/preflight.mjs` against live Polkadot state.

| | Check | Detail |
|---|---|---|
| · | state read at | relay #33330883, Asset Hub #21551711, People #10686229, Bulletin #2140618 |
| ✅ | assetHub runtime unchanged since encode | live 2005000, encoded 2005000 |
| ✅ | people runtime unchanged since encode | live 2005000, encoded 2005000 |
| ✅ | bulletin runtime unchanged since encode | live 2005000, encoded 2005000 |
| ✅ | collectives runtime unchanged since encode | live 2005000, encoded 2005000 |
| ✅ | Asset Hub attester allowance is empty | 15sDLj4T9NnCtT665koDMxBs1PZw3rzDc6wcz9tN9kKTQ2zj |
| ✅ | People attester allowance is empty |  |
| · | Asset Hub DotnsGateway dispatcher today | unset |
| ✅ | dispatcher is a contract | 0xA06d1CB1e3FedFF7b5dFa779b4Cc61703F8A46A1 code hash 0xfe34b64daf1c17301782eeeccc7dd46441aaba9d8b34e733ea9d254c629f3d2a |
| · | dispatcher ERC-1967 implementation | 0xede39b11362321992dbb4f19366a13faddceb6c1 code hash 0xddfef98aaa9c85648663fca48a9e2680a52134fecfe852248f367550c06c122b |
| ✅ | DotnsNameWhitelist is a contract | 0xEc2f4c007b51c35DEfa96bF654f357Fc850362Ab |
| ✅ | grant batch within maxGrantBatch | 3 ≤ 100 |
| ✅ | getcash.dot is Open on the whitelist and unregistered | status Open, available true |
| ✅ | dotns.dot is Open on the whitelist and unregistered | status Open, available true |
| ✅ | browse.dot is Open on the whitelist and unregistered | status Open, available true |
| ✅ | names owner H160 is a mapped substrate account | 0xA5C4c241985D77A0296a0FB83E0FA5905e9E39De → 13oaSihqaoZ8zprCpbnuqdQqi9zLw99rwkSk3zG2hbzxU3ke |
| · | names owner proxies (Asset Hub) | 12mD2ibwcFiVNiDrzcjXHvsz7aDhgkCdY1Do8wUyhzSX6S9a Any delay 0 |
| · | attester proxies (Asset Hub) | 12jrwPAgzi1iTCSxxbdjzmLitdeKB87xh8yeriV2ihWH8vBt Any delay 0; 12mD2ibwcFiVNiDrzcjXHvsz7aDhgkCdY1Do8wUyhzSX6S9a Any delay 0 |
| · | attester proxies (People) | 12jrwPAgzi1iTCSxxbdjzmLitdeKB87xh8yeriV2ihWH8vBt Any delay 0 |
| · | authorizer proxies (Asset Hub) | 12mD2ibwcFiVNiDrzcjXHvsz7aDhgkCdY1Do8wUyhzSX6S9a Any delay 0; 16AT2CCTSWgvefh5fLTo8s2p3TrWKRrtUNStLczjnEftiB8C Any delay 0 |
| · | attester free balance | Asset Hub 0.5662 DOT, People 0.1966 DOT |
| · | authorizer free balance | Asset Hub 0.9997 DOT, Bulletin 0 DOT |
| ✅ | Bulletin authorizer not yet registered | 1YoKNfXM43vegdG6g4XHCDPK6EGykYgHPNkXfRL6etnma1b |
| · | Bulletin authorizers registered today | 0 |
| ✅ | Bulletin validUntil is in the future | #7396458, 365.0 days from now |
| ✅ | HRMP channel Asset Hub → People open | max message 102400 B |
| ✅ | HRMP channel Asset Hub → Bulletin open | max message 102400 B |
| · | inner call whitelisted on Asset Hub | not yet |
| · | referendum preimage noted on Asset Hub | not yet |
| ✅ | Fellowship submission deadline not passed | relay #33417122, 6.0 days from now |
| ✅ | enactment block in the future | relay #33532322, 14.0 days from now |
| · | Whitelisted Caller track | id 1, decision deposit 10,000 DOT, submission deposit 10 DOT |
