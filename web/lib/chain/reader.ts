/**
 * Read-only view of the SpectreMarket event log, for the dashboard.
 *
 * # Why this is separate from the agent's `SpectreClient`
 *
 * The agent's client (`agent/src/chain/client.ts`) is built to *spend money*: its
 * constructor loads a signing key from disk and every method is a transaction.
 * The dashboard only ever reads, and putting a private key into a web server to
 * read public state would be indefensible. So this reader does the same global-state
 * reads the client's `eventCount()` / `readEvents()` do — walking the contract's
 * named keys to the `__events` dictionary — but with no key and no ability to sign.
 *
 * # Single source of truth
 *
 * The one piece that must not diverge between agent and dashboard is the *decode*:
 * if the two disagreed about how to read a Settled event's bytes, the dashboard
 * could show a payout the chain never produced. So the decoder itself is imported
 * unchanged from the agent (`decodeEvent`), not reimplemented here. This file only
 * moves bytes; `events.ts` is what interprets them.
 *
 * This runs server-side only (Node runtime). It is imported by route handlers under
 * `app/api/`, never by a client component.
 */

import "server-only";

// Load the SDK through the shim, which forces the Node build (lib.node.js). Importing
// `casper-js-sdk` directly here lets Turbopack resolve the browser build, whose HTTP
// layer 413s the testnet node. See lib/chain/casper-sdk.ts for the full story.
import { HttpHandler, RpcClient } from "@/lib/chain/casper-sdk";

import { decodeEvent, type MarketEvent } from "@/lib/agent-vendored/events";

/** Casper testnet defaults, overridable via env for a local network. */
const RPC_URL =
  process.env.CASPER_RPC_URL ?? "https://node.testnet.casper.network/rpc";

/**
 * Named key the contract stores its CES event log under, and its length counter.
 * These names are CES 1.1 convention, matching what the agent reads.
 */
const EVENTS_KEY = "__events";
const EVENTS_LENGTH_KEY = "__events_length";

export interface ChainReader {
  /** Number of events emitted since the contract was installed. */
  eventCount(): Promise<number>;
  /** Decode events by index, half-open range `[from, to)`. */
  readEvents(from: number, to: number): Promise<MarketEvent[]>;
  /** Decode the whole log, oldest first. */
  readAll(): Promise<MarketEvent[]>;
}

/**
 * Construct a reader against a contract hash (unprefixed hex, as in deployment.json).
 *
 * Named keys are fixed at install time, so they are resolved once and cached for
 * the lifetime of this reader instance.
 */
export function createChainReader(contractHash: string): ChainReader {
  // "fetch" transport. The SDK's Node build also offers an "axios" transport, but
  // inside Next's server runtime axios's POST to the testnet node comes back 413
  // Payload Too Large (the same call on fetch, and axios outside Next, succeeds — Next
  // appears to alter something axios sends). Plain fetch works, so we use it.
  const rpc = new RpcClient(new HttpHandler(RPC_URL, "fetch"));
  let namedKeyCache: Record<string, string> | undefined;

  async function namedKeys(): Promise<Record<string, string>> {
    if (namedKeyCache) return namedKeyCache;

    const stored = await rpc.queryLatestGlobalState(`hash-${contractHash}`, []);
    const keys = stored.storedValue.contract?.namedKeys ?? [];

    const map: Record<string, string> = {};
    for (const entry of keys) {
      map[entry.name] = entry.key.toString();
    }

    if (!map[EVENTS_KEY]) {
      throw new Error(
        `Contract ${contractHash} exposes no \`${EVENTS_KEY}\` named key; ` +
          `it may not be a CES-instrumented Odra contract.`,
      );
    }

    namedKeyCache = map;
    return map;
  }

  async function eventCount(): Promise<number> {
    const keys = await namedKeys();
    const uref = keys[EVENTS_LENGTH_KEY];
    if (!uref) return 0;

    const stored = await rpc.queryLatestGlobalState(uref, []);
    const parsed = (stored.storedValue as { clValue?: { toString(): string } })
      .clValue;
    return parsed ? Number(parsed.toString()) : 0;
  }

  async function readEvents(from: number, to: number): Promise<MarketEvent[]> {
    const keys = await namedKeys();
    const uref = keys[EVENTS_KEY]!;
    const events: MarketEvent[] = [];

    // Sequential, matching the agent: testnet nodes rate-limit bursts and the log
    // is small enough that parallelism would only add a failure mode.
    for (let index = from; index < to; index += 1) {
      const item = await rpc.getDictionaryItem(null, uref, String(index));
      const raw = (item.storedValue as { clValue?: { bytes(): Uint8Array } })
        .clValue;
      if (!raw) {
        throw new Error(`Event ${index} held no CLValue.`);
      }
      events.push(decodeEvent(raw.bytes()));
    }

    return events;
  }

  async function readAll(): Promise<MarketEvent[]> {
    const count = await eventCount();
    if (count === 0) return [];
    return readEvents(0, count);
  }

  return { eventCount, readEvents, readAll };
}
