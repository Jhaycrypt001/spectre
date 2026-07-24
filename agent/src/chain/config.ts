/**
 * Chain configuration.
 *
 * Every value is resolvable from the environment so the same binary runs against
 * testnet, a local NCTL network, or mainnet without a code change. Defaults target
 * Casper testnet, which is where this agent is operated today.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Casper 2.x testnet. Verified live: protocol 2.2.2, chainspec `casper-test`. */
export const DEFAULT_RPC_URL = "https://node.testnet.casper.network/rpc";
export const DEFAULT_CHAIN_NAME = "casper-test";

/** Block explorer, used to emit human-checkable links after each transaction. */
export const DEFAULT_EXPLORER = "https://testnet.cspr.live";

/**
 * Gas budgets, in motes. 1 CSPR = 1e9 motes.
 *
 * Casper 2.x charges the full payment amount when a transaction fails, so these
 * are sized from observed cost rather than set arbitrarily high. Installing a
 * ~384 KB WASM is by far the most expensive operation.
 */
export const GAS = {
  /** Contract installation. WASM size dominates. */
  install: 350_000_000_000,
  /** A state-changing entry point call with a handful of args. */
  call: 5_000_000_000,
  /**
   * A call carrying an attached CSPR transfer (open_event).
   *
   * Payable entry points are routed through Odra's ~185 KB proxy session WASM,
   * which must be uploaded and executed on every call — so this is priced like a
   * small deployment, not like a plain contract call.
   */
  payableCall: 30_000_000_000,
} as const;

/**
 * Backdate applied to every transaction timestamp, in milliseconds.
 *
 * Casper rejects transactions dated in the future ("a timestamp that has not yet
 * occurred"). A host clock even a few seconds fast therefore fails at submission,
 * which is not a rare condition: this project's own dev machine runs ~5s ahead.
 *
 * Backdating costs nothing — the timestamp only anchors the TTL window — but it
 * makes submission immune to clock drift up to this margin. Override with
 * CASPER_TIME_OFFSET_MS if a host is drifted further than this.
 */
export const DEFAULT_TIME_OFFSET_MS = 60_000;

export interface ChainConfig {
  readonly rpcUrl: string;
  readonly chainName: string;
  readonly explorer: string;
  readonly secretKeyPath: string;
  /** Milliseconds subtracted from `Date.now()` when timestamping transactions. */
  readonly timeOffsetMs: number;
}

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? fallback : value;
}

/**
 * Resolve chain configuration from the environment.
 *
 * Throws if the secret key is missing, rather than failing later mid-transaction
 * with an opaque signing error.
 */
export function loadConfig(): ChainConfig {
  const secretKeyPath = resolve(
    env("CASPER_SECRET_KEY", "../keys/testnet_secret_key.pem"),
  );

  if (!existsSync(secretKeyPath)) {
    throw new Error(
      `Secret key not found at ${secretKeyPath}.\n` +
        `Export it from Casper Wallet (menu -> Download account keys) and save the ` +
        `.pem there, or set CASPER_SECRET_KEY to its location.`,
    );
  }

  const offsetRaw = Number(env("CASPER_TIME_OFFSET_MS", String(DEFAULT_TIME_OFFSET_MS)));
  const timeOffsetMs = Number.isFinite(offsetRaw) && offsetRaw >= 0
    ? offsetRaw
    : DEFAULT_TIME_OFFSET_MS;

  return {
    rpcUrl: env("CASPER_RPC_URL", DEFAULT_RPC_URL),
    chainName: env("CASPER_CHAIN_NAME", DEFAULT_CHAIN_NAME),
    explorer: env("CASPER_EXPLORER", DEFAULT_EXPLORER),
    secretKeyPath,
    timeOffsetMs,
  };
}

/** Read the PEM from disk. Kept separate so the contents are never logged. */
export function readSecretKeyPem(config: ChainConfig): string {
  return readFileSync(config.secretKeyPath, "utf8");
}

/** Explorer link for a transaction hash. */
export function transactionUrl(config: ChainConfig, hash: string): string {
  return `${config.explorer}/transaction/${hash}`;
}

/** Explorer link for a contract hash. */
export function contractUrl(config: ChainConfig, hash: string): string {
  return `${config.explorer}/contract/${hash}`;
}
