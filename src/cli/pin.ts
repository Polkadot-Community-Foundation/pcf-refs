/**
 * `npm run pin`: fixes the dates the encoding depends on, from live block numbers, and writes them to params.json.
 *
 * - `enactAt` (null): current relay block + `enactInDays`
 * - `bulletin.validUntil` (null): current Bulletin block + `bulletin.validDays`
 *
 * Values already set are kept. To move a date, set it back to null and pin again; both hashes change.
 */
import { BLOCKS_PER_DAY, connect } from "../lib/chains.ts";
import { main, parseCommand } from "../lib/cli.ts";
import { saveParams } from "../lib/proposal.ts";

main(async () => {
  const { proposal } = parseCommand({});
  const p = proposal.params;
  if (p.enactAt !== null && p.bulletin.validUntil !== null) {
    console.log(`already pinned: enactAt ${p.enactAt}, bulletin.validUntil ${p.bulletin.validUntil}`);
    return 0;
  }
  const chains = await connect(p.endpoints, ["relay", "bulletin"]);
  try {
    p.enactAt ??= chains.relay.block + p.enactInDays * BLOCKS_PER_DAY;
    p.bulletin.validUntil ??= chains.bulletin.block + p.bulletin.validDays * BLOCKS_PER_DAY;
  } finally {
    chains.close();
  }
  saveParams(proposal);
  console.log(
    `pinned enactAt ${p.enactAt} (relay), bulletin.validUntil ${p.bulletin.validUntil} (Bulletin); run npm run encode`,
  );
  return 0;
});
