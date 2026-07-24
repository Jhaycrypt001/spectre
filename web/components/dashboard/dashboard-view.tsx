"use client";

/**
 * The live dashboard, composed. Owns nothing but layout and state — every figure comes
 * from `useMarket()`, which reads the deployed contract through `/api/market`. The order
 * is deliberate: identity first (which contract, on which chain), then the settlement
 * math (the claim), then the supporting rosters and the raw event log (the receipts).
 */

import { useMarket } from "@/lib/use-market";
import { ContractStrip } from "@/components/dashboard/contract-strip";
import { DispatchCard } from "@/components/dashboard/dispatch-card";
import { AssetRoster } from "@/components/dashboard/asset-roster";
import { EventFeed } from "@/components/dashboard/event-feed";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTimestamp } from "@/lib/format";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
      {children}
    </h2>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-96 w-full rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}

function ErrorState({
  error,
  onRetry,
}: {
  error: string | undefined;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-16 text-center">
      <p className="text-sm font-medium">Couldn&apos;t read the chain right now.</p>
      {error ? (
        <p className="max-w-md font-mono text-xs text-muted-foreground">{error}</p>
      ) : null}
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

export function DashboardView() {
  const { data, status, error, refresh, refreshing } = useMarket();

  if (status === "loading" && !data) return <LoadingState />;
  if (status === "error" && !data) return <ErrorState error={error} onRetry={refresh} />;
  if (!data) return null;

  const { market } = data;
  const settledDispatches = market.dispatches.filter(
    (d) => d.settlements.length > 0,
  );
  const openDispatches = market.dispatches.filter(
    (d) => d.settlements.length === 0,
  );

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
            <span className="text-sm text-muted-foreground">
              Live from Casper testnet · {market.eventCount} events ·{" "}
              <span className="font-mono">read {formatTimestamp(data.fetchedAt)}</span>
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
        <ContractStrip data={data} />
      </div>

      <section>
        <SectionLabel>Settlement math — every figure recomputable from chain</SectionLabel>
        <div className="flex flex-col gap-6">
          {settledDispatches.map((d) => (
            <DispatchCard key={d.eventId} dispatch={d} />
          ))}
          {settledDispatches.length === 0 ? (
            <p className="rounded-xl border border-border/60 bg-card/40 px-6 py-10 text-center text-sm text-muted-foreground">
              No settled dispatches yet. When a window settles, its full accounting
              appears here.
            </p>
          ) : null}
        </div>
      </section>

      {openDispatches.length > 0 ? (
        <section>
          <SectionLabel>Open dispatches</SectionLabel>
          <div className="flex flex-col gap-6">
            {openDispatches.map((d) => (
              <DispatchCard key={d.eventId} dispatch={d} />
            ))}
          </div>
        </section>
      ) : null}

      {/*
       * The event log is a fixed-height scroller while the roster grows with the number
       * of registered homes, so the two columns are stretched to a common height. With
       * few assets registered the roster would otherwise stop well short of the log and
       * leave the row visibly ragged along the bottom.
       */}
      <section className="grid items-stretch gap-6 lg:grid-cols-2">
        <div className="flex flex-col">
          <SectionLabel>Participants</SectionLabel>
          <AssetRoster assets={market.assets} className="flex-1" />
        </div>
        <div className="flex flex-col">
          <SectionLabel>Receipts</SectionLabel>
          <EventFeed log={market.log} />
        </div>
      </section>

      <p className="pt-2 text-center text-xs text-muted-foreground/60">
        {status === "error" && data ? (
          <span className="text-destructive/80">
            Showing last good read — refresh failed.{" "}
          </span>
        ) : null}
        Every number on this page is decoded from an event the contract emitted. Nothing
        is entered by hand.
      </p>
    </div>
  );
}
