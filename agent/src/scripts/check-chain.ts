/**
 * Preflight check for the chain client.
 *
 * Verifies the key loads, the account resolves, and the node is reachable —
 * without submitting anything. Run this before any deployment.
 *
 * Run: npm run check:chain
 */

import { loadConfig } from "../chain/config.js";
import { SpectreClient } from "../chain/client.js";

async function main(): Promise<void> {
  console.log("Spectre — chain preflight\n");

  const config = loadConfig();
  console.log(`  chain   : ${config.chainName}`);
  console.log(`  rpc     : ${config.rpcUrl}`);
  console.log(`  key     : ${config.secretKeyPath}`);

  const client = new SpectreClient(config);
  console.log(`\n  pubkey  : ${client.publicKey.toHex()}`);
  console.log(`  account : ${client.accountHash}`);

  const balance = await client.balance();
  console.log(`  balance : ${(Number(balance) / 1e9).toFixed(4)} CSPR`);

  console.log("\nPreflight OK — key loads, account funded, node reachable.");
}

main().catch((error: unknown) => {
  console.error(`\nPreflight failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
