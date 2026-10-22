/**
 * `npm run decode`: decodes the bytes in calls.json against live metadata into BREAKDOWN.md, for the forum post.
 * It reads only the hex, recomputes every hash and fails on any mismatch with calls.json.
 *
 *   --hex <call> [--chain assetHub|collectives|people|bulletin]   decode any call and print it; nothing is written
 */
import { writeFileSync } from "node:fs";
import type { HexString } from "polkadot-api";
import { CHAIN_NAMES, type ChainKey, connect } from "../lib/chains.ts";
import { main, parseCommand } from "../lib/cli.ts";
import { CallDecoder } from "../lib/decode.ts";
import { blake2, byteLength } from "../lib/format.ts";
import { type GovernancePackage, readPackage } from "../lib/package.ts";

main(async () => {
  const { proposal, flags } = parseCommand({
    hex: { type: "string" },
    chain: { type: "string", default: "assetHub" },
  });
  if (flags.hex) {
    const chains = await connect(proposal.params.endpoints, ["assetHub", "people", "bulletin", "collectives"]);
    try {
      const tree = await new CallDecoder(chains).render(flags.chain as ChainKey, flags.hex as HexString);
      console.log(tree.join("\n"));
      return 0;
    } finally {
      chains.close();
    }
  }

  const pkg = readPackage(proposal);
  const keys = Object.keys(pkg.runtimes) as (keyof GovernancePackage["runtimes"])[];
  const chains = await connect(proposal.params.endpoints, keys);
  try {
    const decoder = new CallDecoder(chains);
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
    const removed = decoder.facts.removedHashes;
    expect("Fellowship removed hashes", removed.join(", "), pkg.parameters.supersedes.join(", "));

    const submitTree = await decoder.render("assetHub", pkg.submission.referendaSubmit);
    const t = pkg.timing;

    const md = [
      `# ${pkg.title}: decoded calls`,
      "",
      `Decoded by \`src/cli/decode.ts\` from the bytes in \`calls.json\` against live metadata (${keys.map((k) => `${CHAIN_NAMES[k]} ${chains[k].spec}`).join(", ")}). Every hash below is recomputed from the bytes.`,
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
      ...(removed.length
        ? [
            "",
            `Removes from the whitelist, in the same batch, the inner call hash${removed.length > 1 ? "es" : ""} it supersedes: ${removed.map((h) => `\`${h}\``).join(", ")}.`,
          ]
        : []),
      "",
      ...fellowshipTree,
      "",
      "## Referendum submission (Asset Hub)",
      "",
      `The referendum enacts from relay block ${t.enactAt}. A Fellowship referendum proposed before relay block ${t.fellowshipProposedBy} whitelists the call before then.`,
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
