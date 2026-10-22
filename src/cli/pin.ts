/**
 * `npm run pin`: fixes the enactment block the encoding depends on, from the live relay block, and writes it to
 * params.json.
 *
 * - `enactAt` (null): current relay block + `enactInDays`
 *
 * A value already set is kept. To move it, set it back to null and pin again. Only `Referenda.submit` and the timing
 * change: the inner call and the preimage do not depend on it.
 */
import { BLOCKS_PER_DAY, connect } from "../lib/chains.ts";
import { main, parseCommand } from "../lib/cli.ts";
import { saveParams } from "../lib/proposal.ts";

main(async () => {
  const { proposal } = parseCommand({});
  const p = proposal.params;
  if (p.enactAt !== null) {
    console.log(`already pinned: enactAt ${p.enactAt}`);
    return 0;
  }
  const chains = await connect(p.endpoints, ["relay"]);
  try {
    p.enactAt = chains.relay.block + p.enactInDays * BLOCKS_PER_DAY;
  } finally {
    chains.close();
  }
  saveParams(proposal);
  console.log(`pinned enactAt ${p.enactAt} (relay); run npm run encode`);
  return 0;
});
