import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // NOTE: casper-js-sdk is deliberately NOT in `serverExternalPackages`. Externalizing
  // it made Turbopack wrap it in an `[externals]` resolver that honours the package's
  // `browser` condition even on the server — loading the browser build (lib.web.js),
  // whose HTTP layer rejects the testnet node's responses with a spurious "413 Payload
  // Too Large". Instead the SDK is loaded through a runtime Node `require` in
  // lib/chain/casper-sdk.ts (via `process.getBuiltinModule`), invisible to the bundler,
  // so Node's own resolver picks the Node build. Listing it as external would give
  // Turbopack a specifier to pre-resolve and reintroduce the browser build.
  turbopack: {
    // An unrelated package-lock.json in the parent home directory otherwise makes
    // Next.js infer the workspace root one level too high, which hoists this
    // project's dependencies into the wrong node_modules.
    //
    // The agent's chain decoder is reused as the single source of truth, but
    // Turbopack on Windows cannot import a module outside this root. So it is
    // vendored into lib/agent-vendored/ by scripts/sync-agent.mjs (run on
    // predev/prebuild) and imported through the normal @/ alias instead.
    root: path.join(__dirname),
  },
};

export default nextConfig;
