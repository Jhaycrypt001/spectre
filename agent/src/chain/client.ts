/**
 * Casper chain client.
 *
 * Wraps transaction construction, signing, submission, and confirmation for the
 * SpectreMarket contract.
 *
 * # Confirmation model
 *
 * `putTransaction` returns as soon as a node accepts the transaction into its
 * buffer. Acceptance is not execution: a transaction can be accepted and then
 * revert on-chain. Every method here therefore waits for execution results and
 * surfaces the contract's own error, so a caller never mistakes "submitted" for
 * "succeeded". This matters because the agent spends real money and a silent
 * revert would otherwise look like success.
 */

// casper-js-sdk 5.x ships CommonJS only (no `module` field, `main` -> lib.node.js).
// Under Node's ESM loader that collapses to a single default export, so named
// imports resolve at type-check time but are `undefined` at runtime. Importing the
// default and destructuring keeps both the runtime binding and the types intact.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import sdk from "casper-js-sdk";
import type {
  PublicKey as PublicKeyType,
  PrivateKey as PrivateKeyType,
  Transaction,
  Args as ArgsType,
  CLValue as CLValueType,
  KeyAlgorithm as KeyAlgorithmType,
  RpcClient as RpcClientType,
  NamedKey,
  EntityVersionAndHash,
} from "casper-js-sdk";

const {
  AccountIdentifier,
  Args,
  CLTypeUInt8,
  CLTypeUInt64,
  CLValue,
  ContractCallBuilder,
  HttpHandler,
  KeyAlgorithm,
  PrivateKey,
  PurseIdentifier,
  RpcClient,
  SessionBuilder,
  Timestamp,
} = sdk;

/**
 * Named key Odra registers the contract package under.
 *
 * Odra derives this as `{package_named_key}_package_hash`
 * (`odra-core-2.9.0/src/host.rs::try_deploy_with_cfg`).
 */
export const PACKAGE_HASH_KEY = "spectre_market_package_hash";

import {
  GAS,
  type ChainConfig,
  readSecretKeyPem,
  transactionUrl,
} from "./config.js";
import { decodeEvent, type MarketEvent } from "./events.js";

/** Outcome of a submitted transaction that reached execution. */
export interface TxResult {
  readonly hash: string;
  readonly url: string;
  /** Gas actually consumed, in motes. */
  readonly costMotes: bigint;
  /** Block height the transaction executed in. */
  readonly blockHeight: number | undefined;
}

/** Raised when a transaction executes but the contract reverts. */
export class ContractRevertError extends Error {
  constructor(
    readonly hash: string,
    readonly url: string,
    message: string,
  ) {
    super(`Contract reverted: ${message}`);
    this.name = "ContractRevertError";
  }
}

/**
 * Detect the key algorithm from the PEM header.
 *
 * secp256k1 keys export as `EC PRIVATE KEY`; ed25519 as `PRIVATE KEY` (PKCS#8).
 * Detecting rather than hardcoding means either wallet export works unchanged.
 */
function detectAlgorithm(pem: string): KeyAlgorithmType {
  return pem.includes("EC PRIVATE KEY")
    ? KeyAlgorithm.SECP256K1
    : KeyAlgorithm.ED25519;
}

/** Parse a hex string, with or without a `hash-`/`contract-` prefix. */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^(contract-package-|contract-|package-|hash-)/, "");
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    throw new Error(`Not a hex string: ${hex}`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Odra's prebuilt proxy session WASM, vendored from
 * `odra-casper-rpc-client-2.9.0/resources/`.
 *
 * Loaded lazily so that non-payable operations never pay the read cost, and so a
 * missing file surfaces only when a payable call is actually attempted.
 */
let proxyWasmCache: Uint8Array | undefined;

function loadProxyWasm(): Uint8Array {
  if (proxyWasmCache) return proxyWasmCache;

  const path = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../contracts/spectre-market/wasm/proxy_caller_with_return.wasm",
  );

  try {
    proxyWasmCache = new Uint8Array(readFileSync(path));
  } catch {
    throw new Error(
      `Odra proxy WASM not found at ${path}. It is vendored from ` +
        `odra-casper-rpc-client's \`resources/\` directory and is required for ` +
        `payable entry points.`,
    );
  }
  return proxyWasmCache;
}

export class SpectreClient {
  private readonly rpc: RpcClientType;
  private readonly key: PrivateKeyType;

  readonly publicKey: PublicKeyType;
  readonly accountHash: string;

  /** Named keys are immutable after install; resolved once. */
  private namedKeyCache?: Record<string, string>;

  constructor(
    private readonly config: ChainConfig,
    /** Installed contract hash. Absent until `installContract` has run. */
    private contractHash?: string,
    /**
     * Installed package hash. Required only for payable entry points, which are
     * routed through Odra's proxy and address the package rather than a version.
     */
    private packageHash?: string,
  ) {
    this.rpc = new RpcClient(new HttpHandler(config.rpcUrl));

    const pem = readSecretKeyPem(config);
    this.key = PrivateKey.fromPem(pem, detectAlgorithm(pem));
    this.publicKey = this.key.publicKey;
    this.accountHash = this.publicKey.accountHash().toHex();
  }

  /** Contract hash, or a clear error if the contract has not been installed. */
  get contract(): string {
    if (!this.contractHash) {
      throw new Error(
        "No contract hash configured. Run `npm run deploy:install` first, " +
          "or set SPECTRE_CONTRACT_HASH.",
      );
    }
    return this.contractHash;
  }

  setContractHash(hash: string): void {
    this.contractHash = hash;
  }

  /**
   * Transaction timestamp, backdated by the configured offset.
   *
   * See {@link DEFAULT_TIME_OFFSET_MS} — a host clock running fast otherwise gets
   * every transaction rejected as "a timestamp that has not yet occurred".
   */
  private now(): InstanceType<typeof Timestamp> {
    return new Timestamp(new Date(Date.now() - this.config.timeOffsetMs));
  }

  /** Account balance in motes. */
  async balance(): Promise<bigint> {
    const result = await this.rpc.queryLatestBalance(
      PurseIdentifier.fromPublicKey(this.publicKey),
    );
    return BigInt(result.balance.toString());
  }

  /**
   * Sign, submit, and wait for execution.
   *
   * Throws {@link ContractRevertError} if the contract reverts, so callers do not
   * have to inspect execution results themselves.
   */
  private async send(tx: Transaction, label: string): Promise<TxResult> {
    tx.sign(this.key);

    const put = await this.rpc.putTransaction(tx);
    const hash = put.transactionHash.toHex();
    const url = transactionUrl(this.config, hash);

    console.log(`  ${label}: submitted ${hash}`);

    const executed = await this.waitForExecution(hash, label);

    if (executed.errorMessage) {
      throw new ContractRevertError(hash, url, executed.errorMessage);
    }

    return {
      hash,
      url,
      costMotes: executed.costMotes,
      blockHeight: executed.blockHeight,
    };
  }

  /**
   * Poll until the transaction executes.
   *
   * Casper testnet block time is ~16s; a transaction normally executes within one
   * or two blocks. The timeout is generous because failing early on a slow block
   * would strand the agent mid-settlement with money already committed.
   */
  private async waitForExecution(
    hash: string,
    label: string,
    timeoutMs = 180_000,
  ): Promise<{
    errorMessage: string | undefined;
    costMotes: bigint;
    blockHeight: number | undefined;
  }> {
    const deadline = Date.now() + timeoutMs;
    let attempt = 0;

    while (Date.now() < deadline) {
      attempt += 1;
      try {
        const info = await this.rpc.getTransactionByTransactionHash(hash);
        const execution = info.executionInfo;

        if (execution?.executionResult) {
          const result = execution.executionResult;
          return {
            errorMessage: result.errorMessage ?? undefined,
            costMotes: BigInt(result.cost?.toString() ?? "0"),
            blockHeight: execution.blockHeight,
          };
        }
      } catch {
        // Not yet visible to this node. Expected for the first few polls.
      }

      if (attempt % 4 === 0) {
        const waited = Math.round((timeoutMs - (deadline - Date.now())) / 1000);
        console.log(`  ${label}: awaiting execution (${waited}s)`);
      }
      await new Promise((r) => setTimeout(r, 4_000));
    }

    throw new Error(
      `${label}: transaction ${hash} did not execute within ${timeoutMs / 1000}s. ` +
        `It may still land — check ${transactionUrl(this.config, hash)}`,
    );
  }

  /**
   * Install the contract WASM.
   *
   * Odra's generated installer requires four configuration arguments alongside
   * the constructor's own. These names and semantics are taken from
   * `odra-core-2.9.0/src/consts.rs` and the assembly in `host.rs::try_deploy_with_cfg`,
   * not inferred: a missing or misnamed one aborts the install after the WASM
   * has already been paid for.
   *
   * `init` takes no arguments, so the constructor contributes nothing here.
   */
  async installContract(wasm: Uint8Array): Promise<TxResult> {
    const args = Args.fromMap({
      odra_cfg_package_hash_key_name: CLValue.newCLString(PACKAGE_HASH_KEY),
      odra_cfg_allow_key_override: CLValue.newCLValueBool(true),
      odra_cfg_is_upgradable: CLValue.newCLValueBool(true),
      odra_cfg_is_upgrade: CLValue.newCLValueBool(false),
    });

    const tx = new SessionBuilder()
      .from(this.publicKey)
      .wasm(wasm)
      .installOrUpgrade()
      .timestamp(this.now())
      .runtimeArgs(args)
      .chainName(this.config.chainName)
      .payment(GAS.install)
      .build();

    return this.send(tx, "install");
  }

  /**
   * Resolve the installed contract hash from the deployer's named keys.
   *
   * Odra registers the *package* hash under a named key; calls target a specific
   * contract version inside that package. We take the highest version, which is
   * what a fresh install or an upgrade just produced.
   */
  async resolveContractHash(): Promise<{ packageHash: string; contractHash: string }> {
    const info = await this.rpc.getAccountInfo(
      null,
      new AccountIdentifier(undefined, this.publicKey),
    );

    const entry = info.account.namedKeys.find((k: NamedKey) => k.name === PACKAGE_HASH_KEY);
    if (!entry) {
      const available = info.account.namedKeys.map((k: NamedKey) => k.name).join(", ") || "(none)";
      throw new Error(
        `Named key "${PACKAGE_HASH_KEY}" not found on the deployer account.\n` +
          `Available named keys: ${available}`,
      );
    }

    const packageKey = entry.key.toString();
    const packageHash = packageKey.replace(/^(hash-|package-)/, "");

    const stored = await this.rpc.queryLatestGlobalState(packageKey, []);

    // Casper 2.x returns either shape depending on how the contract was installed.
    // A session-installed Odra contract comes back as the legacy `ContractPackage`,
    // while `Package` is the 2.x addressable-entity form. Handle both rather than
    // assuming, since the difference is invisible until deploy time.
    const legacy = stored.storedValue.contractPackage;
    if (legacy && legacy.versions.length > 0) {
      const latest = legacy.versions.reduce((a, b) =>
        b.contractVersion > a.contractVersion ? b : a,
      );
      // ContractHash has no toHex(); toString() yields "[object Object]".
      // toJSON() gives the prefixed form, e.g. "contract-ec3d…".
      return {
        packageHash,
        contractHash: latest.contractHash.toJSON().replace(/^(contract-|hash-)/, ""),
      };
    }

    const versions = stored.storedValue.package?.versions ?? [];
    if (versions.length === 0) {
      throw new Error(
        `Package ${packageHash} has no contract versions in either ` +
          `\`ContractPackage\` or \`Package\` form.`,
      );
    }

    const latest = versions.reduce((a: EntityVersionAndHash, b: EntityVersionAndHash) =>
      b.entityVersionKey.entityVersion > a.entityVersionKey.entityVersion ? b : a,
    );

    return {
      packageHash,
      contractHash: latest.addressableEntity
        .toString()
        .replace(/^(entity-contract-|contract-|hash-)/, ""),
    };
  }

  /** Build a contract call against the installed contract. */
  private call(entryPoint: string, args: ArgsType, gas: number): Transaction {
    return new ContractCallBuilder()
      .from(this.publicKey)
      .byHash(this.contract)
      .entryPoint(entryPoint)
      .timestamp(this.now())
      .runtimeArgs(args)
      .chainName(this.config.chainName)
      .payment(gas)
      .build();
  }

  // --- Block time ------------------------------------------------------------

  /**
   * Timestamp of the latest block, in milliseconds.
   *
   * The contract's deadline checks run against `get_block_time`, so any deadline
   * the agent sets must be derived from this rather than from `Date.now()`. On a
   * host whose clock drifts — this project's own dev machine runs ~5s fast — using
   * local time would make a deadline that looks safe expire early on-chain.
   */
  async blockTimeMs(): Promise<number> {
    const status = await this.rpc.getStatus();
    const timestamp = status.lastAddedBlockInfo?.timestamp;
    if (!timestamp) {
      throw new Error("Node reported no latest block; cannot read block time.");
    }

    // `Timestamp.toString()` yields "[object Object]"; `toJSON()` is the ISO-8601
    // form. Several SDK wrapper types share this trap.
    const iso = timestamp.toJSON();
    const ms = new Date(iso).getTime();
    if (!Number.isFinite(ms)) {
      throw new Error(`Could not parse block timestamp: ${JSON.stringify(iso)}`);
    }
    return ms;
  }

  /**
   * Block until chain time passes `targetMs`.
   *
   * Used before `settle`, which the contract rejects until the pledge window has
   * closed. Polling block time rather than sleeping locally means the wait is
   * correct even when the host clock disagrees with the chain.
   */
  async waitForBlockTime(targetMs: bigint, label: string): Promise<void> {
    const target = Number(targetMs);

    for (;;) {
      const now = await this.blockTimeMs();
      if (now > target) return;

      const remaining = Math.ceil((target - now) / 1000);
      console.log(`  ${label}: waiting ${remaining}s for the pledge window to close`);
      await new Promise((r) => setTimeout(r, Math.min(remaining, 10) * 1_000));
    }
  }

  // --- Reading published state ---------------------------------------------

  /**
   * Resolve the contract's named keys, cached for the process lifetime.
   *
   * Named keys are fixed at install time, so re-fetching them per read would add a
   * round trip to every event poll for no benefit.
   */
  private async namedKeys(): Promise<Record<string, string>> {
    if (this.namedKeyCache) return this.namedKeyCache;

    const stored = await this.rpc.queryLatestGlobalState(`hash-${this.contract}`, []);
    const keys: NamedKey[] = stored.storedValue.contract?.namedKeys ?? [];

    const map: Record<string, string> = {};
    for (const entry of keys) {
      map[entry.name] = entry.key.toString();
    }

    if (!map["__events"]) {
      throw new Error(
        `Contract ${this.contract} exposes no \`__events\` named key. ` +
          `It may not be a CES-instrumented Odra contract.`,
      );
    }

    this.namedKeyCache = map;
    return map;
  }

  /** Number of events the contract has emitted since installation. */
  async eventCount(): Promise<number> {
    const keys = await this.namedKeys();
    const uref = keys["__events_length"];
    if (!uref) return 0;

    const stored = await this.rpc.queryLatestGlobalState(uref, []);
    const parsed = (stored.storedValue as { clValue?: { toString(): string } }).clValue;
    return parsed ? Number(parsed.toString()) : 0;
  }

  /**
   * Read and decode events by index, `[from, to)`.
   *
   * Reads are sequential rather than parallel: testnet nodes rate-limit bursts,
   * and an event log this small does not justify the added failure mode.
   */
  async readEvents(from: number, to: number): Promise<MarketEvent[]> {
    const keys = await this.namedKeys();
    const uref = keys["__events"]!;
    const events: MarketEvent[] = [];

    for (let index = from; index < to; index += 1) {
      const item = await this.rpc.getDictionaryItem(null, uref, String(index));
      const raw = (item.storedValue as { clValue?: { bytes(): Uint8Array } }).clValue;
      if (!raw) {
        throw new Error(`Event ${index} held no CLValue.`);
      }
      events.push(decodeEvent(raw.bytes()));
    }

    return events;
  }

  /** Events emitted since a previously recorded count. */
  async eventsSince(previousCount: number): Promise<MarketEvent[]> {
    const current = await this.eventCount();
    if (current <= previousCount) return [];
    return this.readEvents(previousCount, current);
  }

  /**
   * Call a payable entry point, attaching CSPR.
   *
   * # Why this cannot be a plain contract call
   *
   * Odra's `#[odra(payable)]` reads its deposit via `handle_attached_value`, which
   * looks for a `cargo_purse` argument and transfers *that purse's balance* into the
   * contract. Passing an `amount` argument alone therefore attaches nothing, and the
   * contract reverts with `BudgetNotAttached` — the deposit was never made.
   *
   * Creating and funding a purse in the caller's context requires account-context
   * code, so the call must go through session WASM. Odra ships exactly that as
   * `proxy_caller_with_return.wasm`: it creates a purse, funds it with `amount`,
   * and forwards the inner call with `cargo_purse` attached.
   *
   * The proxy targets the *package* hash rather than a contract hash, and takes the
   * inner arguments pre-serialised as `Bytes`. Both details are load-bearing: the
   * argument names and shapes here match
   * `odra-casper-rpc-client-2.9.0/src/casper_client/transactions.rs`.
   */
  private async sendPayable(
    entryPoint: string,
    innerArgs: ArgsType,
    amountMotes: bigint,
    label: string,
  ): Promise<TxResult> {
    if (!this.packageHash) {
      throw new Error(
        `Payable call \`${entryPoint}\` needs the contract package hash. ` +
          `Construct SpectreClient with it, or re-run \`npm run resolve\`.`,
      );
    }

    const amount = CLValue.newCLUInt512(amountMotes.toString());

    const args = Args.fromMap({
      package_hash: CLValue.newCLByteArray(hexToBytes(this.packageHash)),
      entry_point: CLValue.newCLString(entryPoint),
      args: CLValue.newCLList(
        CLTypeUInt8,
        Array.from(innerArgs.toBytes(), (byte) => CLValue.newCLUint8(byte)),
      ),
      attached_value: amount,
      amount,
    });

    const tx = new SessionBuilder()
      .from(this.publicKey)
      .wasm(loadProxyWasm())
      .timestamp(this.now())
      .runtimeArgs(args)
      .chainName(this.config.chainName)
      .payment(GAS.payableCall)
      .build();

    return this.send(tx, label);
  }

  // --- SpectreMarket entry points -----------------------------------------

  /** Register a curtailable asset. `maxCurtailableW` is the load's rated power. */
  async registerAsset(assetId: string, maxCurtailableW: bigint): Promise<TxResult> {
    const args = Args.fromMap({
      asset_id: CLValue.newCLString(assetId),
      max_curtailable_w: CLValue.newCLUint64(maxCurtailableW),
    });
    return this.send(this.call("register_asset", args, GAS.call), "register_asset");
  }

  /**
   * Commit the baseline hash.
   *
   * This must happen *before* the dispatch window's pledge deadline — the whole
   * anti-fraud property depends on the household not knowing the event when it
   * commits. The contract enforces the ordering; committing late reverts.
   */
  async commitBaseline(assetId: string, commitment: Uint8Array): Promise<TxResult> {
    // Odra's `Bytes` is a `List<U8>` — length-prefixed — not a fixed-size
    // `ByteArray`. Sending a `ByteArray` deserialises as `EarlyEndOfStream`
    // on-chain, because the contract reads a length that was never written.
    // The contract's own declared signature confirms `{"List":"U8"}`.
    const args = Args.fromMap({
      asset_id: CLValue.newCLString(assetId),
      commitment: CLValue.newCLList(
        CLTypeUInt8,
        Array.from(commitment, (byte) => CLValue.newCLUint8(byte)),
      ),
    });
    return this.send(this.call("commit_baseline", args, GAS.call), "commit_baseline");
  }

  /** Open a dispatch event. The attached CSPR *is* the escrowed budget. */
  async openEvent(
    eventId: string,
    startInterval: number,
    endInterval: number,
    pricePerKwhMotes: bigint,
    budgetMotes: bigint,
    pledgeDeadlineMs: bigint,
    settlementDeadlineMs: bigint,
  ): Promise<TxResult> {
    const args = Args.fromMap({
      event_id: CLValue.newCLString(eventId),
      start_interval: CLValue.newCLUInt32(startInterval),
      end_interval: CLValue.newCLUInt32(endInterval),
      price_per_kwh_motes: CLValue.newCLUInt512(pricePerKwhMotes.toString()),
      pledge_deadline: CLValue.newCLUint64(pledgeDeadlineMs),
      settlement_deadline: CLValue.newCLUint64(settlementDeadlineMs),
    });
    return this.sendPayable("open_event", args, budgetMotes, "open_event");
  }

  /** Pledge curtailment against an open event. */
  async pledge(eventId: string, assetId: string, pledgedWh: bigint): Promise<TxResult> {
    const args = Args.fromMap({
      event_id: CLValue.newCLString(eventId),
      asset_id: CLValue.newCLString(assetId),
      pledged_wh: CLValue.newCLUint64(pledgedWh),
    });
    return this.send(this.call("pledge", args, GAS.call), "pledge");
  }

  /**
   * Reveal the baseline and settle.
   *
   * The contract rehashes the revealed series and compares against the earlier
   * commitment; a mismatch reverts. Payment follows from the recomputed baseline,
   * not from anything asserted here.
   */
  async settle(
    eventId: string,
    assetId: string,
    historyWindowWh: readonly bigint[],
    historyAdjWindowWh: readonly bigint[],
    actualAdjWindowWh: bigint,
    actualWindowWh: bigint,
  ): Promise<TxResult> {
    const u64List = (xs: readonly bigint[]): CLValueType =>
      CLValue.newCLList(
        CLTypeUInt64,
        xs.map((x) => CLValue.newCLUint64(x)),
      );

    const args = Args.fromMap({
      event_id: CLValue.newCLString(eventId),
      asset_id: CLValue.newCLString(assetId),
      history_window_wh: u64List(historyWindowWh),
      history_adj_window_wh: u64List(historyAdjWindowWh),
      actual_adj_window_wh: CLValue.newCLUint64(actualAdjWindowWh),
      actual_window_wh: CLValue.newCLUint64(actualWindowWh),
    });
    return this.send(this.call("settle", args, GAS.call), "settle");
  }

  /** Reclaim unspent budget after the event closes. */
  async withdrawUnspent(eventId: string): Promise<TxResult> {
    const args = Args.fromMap({
      event_id: CLValue.newCLString(eventId),
    });
    return this.send(this.call("withdraw_unspent", args, GAS.call), "withdraw_unspent");
  }
}
