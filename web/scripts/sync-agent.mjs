/**
 * Vendor the agent's audit-critical modules into the web app.
 *
 * Why copy rather than import across the boundary: Turbopack on Windows refuses to
 * resolve a module that lives outside the project root ("windows imports are not
 * implemented yet"). The agent source sits one directory up, so the dashboard cannot
 * import it directly. Rather than reimplement the decoder — and risk it drifting from
 * what the contract actually emits — this script copies the exact agent sources in,
 * with a banner marking them generated. Run on `predev`/`prebuild`, so the vendored
 * copy is always a byte-for-byte reflection of the agent at build time.
 *
 * Keep this list tiny and restricted to pure modules (no Node or SDK imports), so the
 * copies are safe to bundle unchanged.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const agentSrc = resolve(here, "..", "..", "agent", "src");
const outDir = resolve(here, "..", "lib", "agent-vendored");

/** Files to vendor, and the export surface each is relied on for. */
const files = [
  { from: resolve(agentSrc, "chain", "events.ts"), as: "events.ts" },
  { from: resolve(agentSrc, "meter", "types.ts"), as: "meter-types.ts" },
];

const banner = (source) =>
  `/*\n` +
  ` * GENERATED — do not edit by hand.\n` +
  ` *\n` +
  ` * Copied verbatim from agent/src/${source} by web/scripts/sync-agent.mjs.\n` +
  ` * Edit the agent source and re-run \`npm run sync:agent\` (runs automatically on\n` +
  ` * predev/prebuild). This is the single source of truth for how chain events are\n` +
  ` * decoded; the dashboard must never diverge from it.\n` +
  ` */\n\n`;

mkdirSync(outDir, { recursive: true });

for (const file of files) {
  const rel = file.from.slice(agentSrc.length + 1).replaceAll("\\", "/");
  const contents = readFileSync(file.from, "utf8");
  const out = resolve(outDir, file.as);
  writeFileSync(out, banner(rel) + contents);
  console.log(`vendored agent/src/${rel} -> lib/agent-vendored/${basename(out)}`);
}
