/**
 * Resolve an already-installed contract and write the deployment record.
 *
 * Separate from `install` so a completed installation never has to be paid for
 * twice just to recover its address.
 *
 * Run: npm run resolve
 */

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig, contractUrl } from "../chain/config.js";
import { SpectreClient, PACKAGE_HASH_KEY } from "../chain/client.js";
import type { DeploymentRecord } from "./install.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOYMENT_PATH = resolve(HERE, "../../deployment.json");

async function main(): Promise<void> {
  console.log("Spectre — resolve installed contract\n");

  const config = loadConfig();
  const client = new SpectreClient(config);

  console.log(`  deployer : ${client.publicKey.toHex()}`);
  console.log(`  named key: ${PACKAGE_HASH_KEY}`);

  const { packageHash, contractHash } = await client.resolveContractHash();

  console.log(`\n  package  : ${packageHash}`);
  console.log(`  contract : ${contractHash}`);
  console.log(`  explorer : ${contractUrl(config, contractHash)}`);

  const installTxHash = process.env["SPECTRE_INSTALL_TX"] ?? "";

  const record: DeploymentRecord = {
    chainName: config.chainName,
    rpcUrl: config.rpcUrl,
    packageHash,
    contractHash,
    installTxHash,
    installedAt: new Date().toISOString(),
    deployer: client.publicKey.toHex(),
    wasmBytes: 0,
  };
  writeFileSync(DEPLOYMENT_PATH, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`\nDeployment record written to ${DEPLOYMENT_PATH}`);
}

main().catch((error: unknown) => {
  console.error(`\nResolve failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
