/**
 * `npm run encode`: encodes the package from the pinned params into `calls.json`, offline.
 *
 *   --check   compare with the committed calls.json instead of writing it; exit 1 on any difference
 */
import { readFileSync, writeFileSync } from "node:fs";
import { main, parseCommand } from "../lib/cli.ts";
import { toJson } from "../lib/format.ts";
import { buildPackage, describeRuntimes } from "../lib/package.ts";
import { requirePinned } from "../lib/proposal.ts";

main(async () => {
  const { proposal, flags } = parseCommand({ check: { type: "boolean", default: false } });
  const pkg = await buildPackage(requirePinned(proposal.params));
  const file = proposal.path("calls.json");
  const json = `${toJson(pkg, 2)}\n`;

  if (flags.check) {
    const same = readFileSync(file, "utf8") === json;
    console.log(
      same ? `calls.json reproduced byte for byte (${pkg.rootBatchHash})` : "calls.json DIFFERS from a fresh encoding",
    );
    return same ? 0 : 1;
  }

  writeFileSync(file, json);
  const t = pkg.timing;
  console.log(`runtimes         ${describeRuntimes(pkg.runtimes)}`);
  console.log(`rootBatchHash    ${pkg.rootBatchHash}  (${pkg.rootBatchLen} B, whitelisted by the Fellowship)`);
  console.log(`refPreimageHash  ${pkg.refPreimageHash}  (${pkg.refPreimageLen} B, looked up by the referendum)`);
  console.log(
    `timing           Fellowship ref proposed before relay #${t.fellowshipProposedBy}, enactment from #${t.enactAt}`,
  );
  console.log(`wrote ${file}`);
  return 0;
});
