/**
 * Install the SpectreMarket contract on Casper.
 *
 * Writes a deployment record to `deployment.json` so subsequent runs and the
 * frontend can find the contract without re-deriving it from named keys.
 *
 * Run: npm run install:contract
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig, GAS, contractUrl } from "../chain/config.js";
import { SpectreClient, PACKAGE_HASH_KEY } from "../chain/client.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(
  HERE,
  "../../../contracts/spectre-market/wasm/SpectreMarket.wasm",
);
const DEPLOYMENT_PATH = resolve(HERE, "../../deployment.json");

export interface DeploymentRecord {
  readonly chainName: string;
  readonly rpcUrl: string;
  readonly packageHash: string;
  readonly contractHash: string;
  readonly installTxHash: string;
  readonly installedAt: string;
  readonly deployer: string;
  readonly wasmBytes: number;
}

function cspr(motes: bigint): string {
  return (Number(motes) / 1e9).toFixed(4);
}

async function main(): Promise<void> {
  console.log("Spectre — contract installation\n");

  const config = loadConfig();
  console.log(`  chain    : ${config.chainName}`);
  console.log(`  rpc      : ${config.rpcUrl}`);

  if (!existsSync(WASM_PATH)) {
    throw new Error(
      `WASM not found at ${WASM_PATH}.\n` +
        `Build it first: cd contracts/spectre-market && cargo odra build`,
    );
  }
  const wasm = readFileSync(WASM_PATH);
  console.log(`  wasm     : ${wasm.length} bytes`);

  const client = new SpectreClient(config);
  console.log(`  deployer : ${client.publicKey.toHex()}`);
  console.log(`  account  : ${client.accountHash}`);

  // Preflight: fail before spending if the account cannot cover the install.
  const balance = await client.balance();
  console.log(`  balance  : ${cspr(balance)} CSPR`);

  if (balance < BigInt(GAS.install)) {
    throw new Error(
      `Insufficient balance. Install needs ${cspr(BigInt(GAS.install))} CSPR, ` +
        `account holds ${cspr(balance)} CSPR.\n` +
        `Fund it at https://testnet.cspr.live/tools/faucet`,
    );
  }

  if (existsSync(DEPLOYMENT_PATH)) {
    const prior = JSON.parse(readFileSync(DEPLOYMENT_PATH, "utf8")) as DeploymentRecord;
    console.log(
      `\n  Note: a deployment already exists (${prior.contractHash.slice(0, 16)}...).\n` +
        `  Installing again creates a new contract version.`,
    );
  }

  console.log(`\nInstalling (budget ${cspr(BigInt(GAS.install))} CSPR)...`);
  const result = await client.installContract(wasm);

  console.log(`  cost     : ${cspr(result.costMotes)} CSPR`);
  console.log(`  block    : ${result.blockHeight ?? "unknown"}`);
  console.log(`  tx       : ${result.url}`);

  console.log(`\nResolving contract hash from named key "${PACKAGE_HASH_KEY}"...`);
  const { packageHash, contractHash } = await client.resolveContractHash();

  console.log(`  package  : ${packageHash}`);
  console.log(`  contract : ${contractHash}`);
  console.log(`  explorer : ${contractUrl(config, contractHash)}`);

  const record: DeploymentRecord = {
    chainName: config.chainName,
    rpcUrl: config.rpcUrl,
    packageHash,
    contractHash,
    installTxHash: result.hash,
    installedAt: new Date().toISOString(),
    deployer: client.publicKey.toHex(),
    wasmBytes: wasm.length,
  };
  writeFileSync(DEPLOYMENT_PATH, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`\nDeployment record written to ${DEPLOYMENT_PATH}`);

  const after = await client.balance();
  console.log(`Balance after install: ${cspr(after)} CSPR`);
}

main().catch((error: unknown) => {
  console.error(`\nInstall failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
