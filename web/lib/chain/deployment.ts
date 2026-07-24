/**
 * The live deployment the dashboard reads from.
 *
 * There is exactly one authoritative record of which contract is live: the agent's
 * `deployment.json`, rewritten by `npm run install:contract` on every redeploy.
 * The dashboard reads that same file so it can never drift onto a stale hash — if
 * the contract is redeployed, the dashboard follows automatically with no edit here.
 *
 * `CASPER_CONTRACT_HASH` can override it (useful in a deploy where the file is not
 * co-located), but the file is the default and the norm.
 */

import "server-only";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface Deployment {
  readonly chainName: string;
  readonly rpcUrl: string;
  readonly packageHash: string;
  readonly contractHash: string;
  readonly installTxHash: string;
  readonly installedAt: string;
  readonly deployer: string;
  readonly explorer: string;
}

const DEFAULT_EXPLORER = "https://testnet.cspr.live";

let cache: Deployment | undefined;

export function loadDeployment(): Deployment {
  if (cache) return cache;

  const override = process.env.CASPER_CONTRACT_HASH;

  const path = resolve(process.cwd(), "../agent/deployment.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Deployment>;

  const contractHash = override ?? raw.contractHash;
  if (!contractHash) {
    throw new Error(
      `No contract hash: ${path} has none and CASPER_CONTRACT_HASH is unset.`,
    );
  }

  cache = {
    chainName: raw.chainName ?? "casper-test",
    rpcUrl: raw.rpcUrl ?? "https://node.testnet.casper.network/rpc",
    packageHash: raw.packageHash ?? "",
    contractHash,
    installTxHash: raw.installTxHash ?? "",
    installedAt: raw.installedAt ?? "",
    deployer: raw.deployer ?? "",
    explorer: process.env.CASPER_EXPLORER ?? DEFAULT_EXPLORER,
  };
  return cache;
}

/** Explorer link for the live contract. */
export function contractUrl(d: Deployment): string {
  return `${d.explorer}/contract/${d.contractHash}`;
}

/** Explorer link for a transaction hash. */
export function transactionUrl(d: Deployment, hash: string): string {
  return `${d.explorer}/transaction/${hash}`;
}
