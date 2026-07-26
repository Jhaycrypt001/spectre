/**
 * GET /api/market — the live market state, read from Casper testnet.
 *
 * Reads the contract's on-chain event log (via the read-only reader, no signing
 * key), folds it into per-dispatch stories, and returns the whole thing as JSON.
 * Everything here is derived from decoded chain events — the response carries no
 * figure the contract did not itself emit.
 *
 * Dynamic by default in Next 16, so each request reflects current chain state. A
 * short in-process cache keeps a burst of dashboard refreshes from hammering the
 * public testnet node; `?fresh=1` bypasses it.
 */

import { NextResponse, type NextRequest } from "next/server";

import { createChainReader } from "@/lib/chain/reader";
import { buildMarketState, type MarketState } from "@/lib/chain/market";
import { loadDeployment, contractUrl } from "@/lib/chain/deployment";
import type { MarketResponse as ClientMarketResponse } from "@/lib/market-types";

// The reader uses casper-js-sdk (Node-only) and must reach the testnet RPC on
// every request, so pin the Node runtime and force dynamic rendering rather than
// letting Next attempt to cache or edge-render it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CachedResponse {
  at: number;
  body: MarketResponse;
}

export interface MarketResponse {
  readonly contractHash: string;
  readonly contractUrl: string;
  readonly chainName: string;
  readonly installedAt: string;
  readonly deployer: string;
  readonly fetchedAt: string;
  readonly market: MarketState;
}

// Compile-time guard: the shape this route serializes must match the client-safe
// mirror in lib/market-types.ts (which client components consume). If the server
// types drift, this assignment fails to typecheck rather than shipping a silent
// mismatch to the browser.
const _typeContractCheck = (r: MarketResponse): ClientMarketResponse => r;
void _typeContractCheck;

const CACHE_TTL_MS = 15_000;
let cache: CachedResponse | undefined;

export async function GET(request: NextRequest) {
  const fresh = request.nextUrl.searchParams.get("fresh") === "1";

  if (!fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.body, {
      headers: { "x-spectre-cache": "hit" },
    });
  }

  try {
    const deployment = loadDeployment();
    const reader = createChainReader(deployment.contractHash);
    const log = await reader.readAll();
    const market = buildMarketState(deployment.contractHash, log);

    const body: MarketResponse = {
      contractHash: deployment.contractHash,
      contractUrl: contractUrl(deployment),
      chainName: deployment.chainName,
      installedAt: deployment.installedAt,
      deployer: deployment.deployer,
      fetchedAt: new Date().toISOString(),
      market,
    };

    cache = { at: Date.now(), body };

    return NextResponse.json(body, {
      headers: { "x-spectre-cache": fresh ? "bypass" : "miss" },
    });
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    // Full message (which can include internal URLs or a stack's first line) goes to
    // the server log only. The public response carries just the first line, capped,
    // so the dashboard can show *something* actionable without over-sharing internals.
    console.error("[/api/market] chain read failed:", raw);
    const detail = raw.split("\n", 1)[0].slice(0, 200);
    return NextResponse.json(
      { error: "Failed to read market state from chain.", detail },
      { status: 502 },
    );
  }
}
