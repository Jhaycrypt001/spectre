"use client";

/**
 * Client hook for the live market state served by `/api/market`.
 *
 * Owns the fetch, the loading/error states, and a light poll so the dashboard reflects
 * new chain activity without a manual refresh. The route already caches reads for a few
 * seconds server-side, so polling here is cheap; the poll is paused while the tab is
 * hidden to avoid pointless requests.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { MarketResponse, MarketError } from "@/lib/market-types";

type Status = "loading" | "ready" | "error";

export interface UseMarket {
  readonly data: MarketResponse | undefined;
  readonly status: Status;
  readonly error: string | undefined;
  /** Force a fresh read (bypasses the server's short cache). */
  readonly refresh: () => void;
  /** Whether a refresh is in flight over already-loaded data. */
  readonly refreshing: boolean;
}

const POLL_INTERVAL_MS = 20_000;

export function useMarket(): UseMarket {
  const [data, setData] = useState<MarketResponse | undefined>();
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async (fresh: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (fresh) setRefreshing(true);
    try {
      const res = await fetch(`/api/market${fresh ? "?fresh=1" : ""}`, {
        headers: { accept: "application/json" },
      });
      const body = (await res.json()) as MarketResponse | MarketError;
      if (!res.ok || "error" in body) {
        const detail =
          "error" in body
            ? (body.detail ?? body.error)
            : `HTTP ${res.status}`;
        setError(detail);
        setStatus((prev) => (prev === "ready" ? "ready" : "error"));
      } else {
        setData(body);
        setError(undefined);
        setStatus("ready");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus((prev) => (prev === "ready" ? "ready" : "error"));
    } finally {
      inFlight.current = false;
      if (fresh) setRefreshing(false);
    }
  }, []);

  const refresh = useCallback(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    // Kick the first read off the effect's own tick. Calling `load` inline would set
    // state synchronously during the commit and cascade an extra render.
    const initial = window.setTimeout(() => void load(false), 0);

    const tick = () => {
      if (document.visibilityState === "visible") void load(false);
    };
    const timer = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);

  return { data, status, error, refresh, refreshing };
}
