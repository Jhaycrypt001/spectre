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

// `process.getBuiltinModule` (Node 22+) hands back the built-in `module` with no import
// for the bundler to see or rewrite. Bound to the app's working directory (this web/
// project) so package resolution starts from its node_modules.
const nodeRequire = process
  .getBuiltinModule("module")
  .createRequire(process.cwd() + "/");

const sdk = nodeRequire("casper-js-sdk") as typeof import("casper-js-sdk");

export const { HttpHandler, RpcClient } = sdk;
export default sdk;
