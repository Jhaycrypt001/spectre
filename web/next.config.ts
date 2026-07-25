import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // casper-js-sdk must be handled by native Node `require`, never bundled. Node's
  // resolver applies the package's `require` export condition and picks the Node
  // build (dist/lib.node.js) — verified with `require.resolve`. Only a *bundler*
  // applying the `browser`/`react-native` condition would select the browser build
  // (lib.web.js), whose HTTP layer spuriously 413s the testnet node. Declaring the
  // package external here keeps it out of the bundle AND, critically, makes Next's
  // output-file tracer follow its real dependency graph so every transitive
  // dependency is copied into the serverless function on Vercel. Without this the
  // runtime require threw "Cannot find module" at module load and the /api/market
  // route returned an HTML crash page ("Unexpected token <") instead of JSON.
  serverExternalPackages: ["casper-js-sdk"],
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

  // casper-js-sdk is loaded through a runtime Node `require` in
  // lib/chain/casper-sdk.ts (see the long comment there) precisely so the bundler
  // never sees the specifier and cannot substitute the browser build. The cost of
  // that invisibility is that Next's output-file tracer also can't see it, so on a
  // serverless host (Vercel) the package is NOT copied into the /api/market
  // function bundle — and the runtime `require("casper-js-sdk")` then throws
  // "Cannot find module" at module load, crashing the route with an HTML error
  // page before our handler's try/catch ever runs. Force the whole package (its
  // Node build and transitive deps) into the traced bundle for this one route.
  outputFileTracingIncludes: {
    // The SDK and its runtime dependency trees. Because the `require` above is
    // opaque to the tracer, none of these are pulled in automatically; each is
    // listed explicitly. They are hoisted flat into this project's node_modules by
    // npm, so a single-level glob per package tree suffices.
    "/api/market": [
      "./node_modules/casper-js-sdk/**/*",
      "./node_modules/axios/**/*",
      "./node_modules/follow-redirects/**/*",
      "./node_modules/proxy-from-env/**/*",
      "./node_modules/form-data/**/*",
      "./node_modules/combined-stream/**/*",
      "./node_modules/delayed-stream/**/*",
      "./node_modules/mime-types/**/*",
      "./node_modules/mime-db/**/*",
      "./node_modules/asynckit/**/*",
      "./node_modules/node-fetch/**/*",
      "./node_modules/whatwg-url/**/*",
      "./node_modules/webidl-conversions/**/*",
      "./node_modules/tr46/**/*",
      "./node_modules/eventsource/**/*",
      "./node_modules/typedjson/**/*",
      "./node_modules/reflect-metadata/**/*",
      "./node_modules/bn.js/**/*",
      "./node_modules/asn1.js/**/*",
      "./node_modules/humanize-duration/**/*",
      "./node_modules/ts-results/**/*",
      "./node_modules/@casperlabs/**/*",
      "./node_modules/@noble/**/*",
      "./node_modules/@scure/**/*",
      "./node_modules/@ethersproject/**/*",
    ],
  },
};

export default nextConfig;
