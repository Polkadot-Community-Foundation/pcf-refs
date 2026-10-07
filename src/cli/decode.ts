/**
 * `npm run decode`: decodes the bytes in calls.json against live metadata into BREAKDOWN.md, for the forum post.
 * It reads only the hex, recomputes every hash and fails on any mismatch with calls.json.
 *
 *   --hex <call> [--chain assetHub|collectives|people|bulletin]   decode any call and print it; nothing is written
 */
import { writeFileSync } from "node:fs";
import type { HexString } from "polkadot-api";
import { type ChainKey, connect } from "../lib/chains.ts";
import { main, parseCommand } from "../lib/cli.ts";
import { CallDecoder } from "../lib/decode.ts";
import { blake2, byteLength } from "../lib/format.ts";
import { readPackage } from "../lib/package.ts";

main(async () => {
  const { proposal, flags } = parseCommand({
    hex: { type: "string" },
    chain: { type: "string", default: "assetHub" },
  });
  const chains = await connect(proposal.params.endpoints, ["assetHub", "people", "bulletin", "collectives"]);
  try {
    const decoder = new CallDecoder(chains);
    if (flags.hex) {
      console.log((await decoder.render(flags.chain as ChainKey, flags.hex as HexString)).join("\n"));
      return 0;
    }

    const pkg = readPackage(proposal);
    const mismatches: string[] = [];
    const expect = (what: string, computed: unknown, published: unknown) => {
      if (computed !== published) mismatches.push(`${what}: computed ${computed}, calls.json ${published}`);
    };

    const preimageTree = await decoder.render("assetHub", pkg.refPreimage);
    const innerHash = decoder.facts.dispatchedHash;
    expect("refPreimageHash", blake2(pkg.refPreimage), pkg.refPreimageHash);
    expect("rootBatchHash", innerHash, pkg.rootBatchHash);
    expect("rootBatch bytes", `0x${pkg.refPreimage.slice(6)}`, pkg.rootBatch);

    const fellowshipTree = await decoder.render("collectives", pkg.fellowship.submit);
    expect("Fellowship whitelist hash", decoder.facts.whitelistedHash, innerHash);

    const submitTree = await decoder.render("assetHub", pkg.submission.referendaSubmit);
    const d = pkg.deadlines;

    const md = [
      `# ${pkg.title}: decoded calls`,
      "",
      `Decoded by \`src/cli/decode.ts\` from the bytes in \`calls.json\` against live metadata (Asset Hub ${chains.assetHub.spec}, People ${chains.people.spec}, Bulletin ${chains.bulletin.spec}, Collectives ${chains.collectives.spec}). Every hash below is recomputed from the bytes.`,
      "",
      "## Referendum preimage (Asset Hub, Whitelisted Caller track)",
      "",
      "| | |",
      "|---|---|",
      `| Preimage hash | \`${blake2(pkg.refPreimage)}\` |`,
      `| Preimage length | ${byteLength(pkg.refPreimage)} bytes |`,
      `| Whitelisted (inner) call hash | \`${innerHash}\` |`,
      `| Inner call length | ${byteLength(pkg.rootBatch)} bytes |`,
      "",
      ...preimageTree,
      "",
      "## Fellowship referendum (Collectives, Fellows origin)",
      "",
      `Whitelists exactly the inner call hash above: ${decoder.facts.whitelistedHash === innerHash ? "yes" : "**NO**"}.`,
      "",
      ...fellowshipTree,
      "",
      "## Referendum submission (Asset Hub)",
      "",
      `Enactment is fixed at relay block ${d.enactAt}. The Fellowship referendum must be submitted by relay block ${d.fellowshipSubmitBy} and the whitelist must be on Asset Hub by relay block ${d.whitelistLandedBy}.`,
      "",
      ...submitTree,
      "",
      "## Raw bytes",
      "",
      "| Item | Hex |",
      "|---|---|",
      `| Referendum preimage (\`Preimage.note_preimage\` input) | \`${pkg.refPreimage}\` |`,
      `| Inner call (whitelisted) | \`${pkg.rootBatch}\` |`,
      `| \`FellowshipReferenda.submit\` (Collectives) | \`${pkg.fellowship.submit}\` |`,
      `| \`Referenda.submit\` (Asset Hub) | \`${pkg.submission.referendaSubmit}\` |`,
      "",
    ];
    writeFileSync(proposal.path("BREAKDOWN.md"), md.join("\n"));
    console.log(md.join("\n"));

    if (mismatches.length) {
      for (const m of mismatches) console.error(`MISMATCH ${m}`);
      return 1;
    }
    console.log(`\nall hashes match calls.json; wrote ${proposal.path("BREAKDOWN.md")}`);
    return 0;
  } finally {
    chains.close();
  }
});
