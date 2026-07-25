/**
 * Server-only handle on casper-js-sdk's *Node* build.
 *
 * # The problem
 *
 * casper-js-sdk ships two builds: `dist/lib.node.js` (Node) and `dist/lib.web.js`
 * (a UMD browser bundle). Its package.json points a top-level `"browser"` field and a
 * `browser` export condition at the browser build, and Turbopack resolves the browser
 * build even for this server-only route. That bundle's HTTP layer then rejects the
 * testnet node's JSON-RPC responses with a spurious "413 Payload Too Large" — a string
 * that exists *only* in lib.web.js; the Node build has no such path.
 *
 * On Windows Turbopack, every ordinary escape hatch failed: `serverExternalPackages`
 * and even a `createRequire(import.meta.url)` call were both rewritten by Turbopack
 * into its own external-module resolver, which still applies the `browser` condition;
 * `turbopack.resolveAlias` to the Node build's absolute path hit "windows imports are
 * not implemented yet"; a dynamic `require(variable)` made Turbopack bail with
 * "expression is too dynamic".
 *
 * # The fix
 *
 * Obtain a genuine Node `require` without any module *import* for Turbopack to trace:
 * `process.getBuiltinModule("module")` reaches the built-in `module` off the `process`
 * global (no import statement, nothing to rewrite), and its `createRequire` produces a
 * real Node require. Node then resolves the bare `casper-js-sdk` specifier the normal
 * way — ignoring the `browser` field, its `exports` map selecting `main`
 * (lib.node.js) via the `require`/`default` conditions. Verified: this resolves to
 * lib.node.js and reads the live contract's event log.
 *
 * Server-only: a client import is a build error, not a silent leak of a Node bundle.
 */

import "server-only";

// Obtain a real Node `require` without an import statement the bundler can trace or
// rewrite. Two ways to reach the built-in `module`, tried in order so this works across
// Node versions and hosts (local Windows/Turbopack *and* Vercel's Linux runtime):
//
//   1. `process.getBuiltinModule("module")` — Node 22+, cleanest, no import.
//   2. `eval("require")("module")` — older Node / any runtime; the eval keeps the
//      specifier opaque to Turbopack so it is not rewritten to the browser build.
//
// The require's base is `import.meta.url` (this file), not `process.cwd()`, because the
// working directory is not stable on serverless hosts — resolving relative to this
// module's own location finds the co-located node_modules reliably.
function nodeCreateRequire(): NodeRequire {
  const mod =
    typeof process.getBuiltinModule === "function"
      ? process.getBuiltinModule("module")
      : // eslint-disable-next-line no-eval
        (eval("require") as NodeRequire)("module");
  return (mod as typeof import("module")).createRequire(import.meta.url);
}

const sdk = nodeCreateRequire()("casper-js-sdk") as typeof import("casper-js-sdk");

export const { HttpHandler, RpcClient } = sdk;
export default sdk;
