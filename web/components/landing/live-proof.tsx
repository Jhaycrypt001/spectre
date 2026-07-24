"use client";

/**
 * Live proof section: the deployed contract, read in the browser, right on the landing
 * page.
 *
 * The claim this whole page makes is "you can check it yourself", so the page had
 * better be willing to show its own working. The headline figure is the most recent
 * settlement's arithmetic; below it, the real event log scrolls past. If the chain read
 * fails, this degrades to a link rather than inventing numbers — a fabricated figure
 * here would contradict the entire argument.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { useMarket } from "@/lib/use-market";
import { Skeleton } from "@/components/ui/skeleton";
import { Marquee } from "@/components/ui/marquee";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/landing/section-header";
import type { JsonMarketEvent } from "@/lib/market-types";
import {
  formatCspr,
  formatWh,
  whToKwh,
  truncateHex,
  shortAddress,
} from "@/lib/format";

const motesToCspr = (motes: string): number => Number(motes) / 1e9;

const EVENT_LABEL: Record<JsonMarketEvent["kind"], string> = {
  AssetRegistered: "Asset registered",
  BaselineCommitted: "Baseline committed",
  EventOpened: "Dispatch opened",
  Pledged: "Pledged",
  Settled: "Settled",
  BudgetWithdrawn: "Budget withdrawn",
};

function eventSummary(event: JsonMarketEvent): string {
  switch (event.kind) {
    case "AssetRegistered":
      return `${event.assetId} · ${formatWh(Number(event.maxCurtailableW))} W curtailable`;
    case "BaselineCommitted":
      return `${event.assetId} · ${truncateHex(event.commitment, 6, 6)}`;
    case "EventOpened":
      return `${event.eventId} · ${formatCspr(motesToCspr(event.pricePerKwhMotes))} CSPR/kWh · budget ${formatCspr(motesToCspr(event.budgetMotes))}`;
    case "Pledged":
      return `${event.assetId} · ${formatWh(Number(event.pledgedWh))} Wh into ${event.eventId}`;
    case "Settled":
      return `${event.assetId} · ${formatWh(Number(event.deliveredWh))} Wh → ${formatCspr(motesToCspr(event.paidMotes))} CSPR`;
    case "BudgetWithdrawn":
      return `${shortAddress(event.buyer)} · ${formatCspr(motesToCspr(event.refundedMotes))} CSPR refunded`;
  }
}

export function LiveProofSection() {
  const { data, status } = useMarket();

  const dispatch = data?.market.dispatches.find((d) => d.settlements.length > 0);
  const settlement = dispatch?.settlements[0];
  const log = data?.market.log ?? [];

  return (
    <section id="proof" className="relative w-full">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 md:py-28">
        <SectionHeader
          eyebrow="Live"
          title="Read it off the chain"
          accent="right now."
          subtitle="This is not a screenshot. The figures below are fetched from the deployed contract on Casper testnet when you load this page."
        />

        <div className="mt-14 overflow-hidden rounded-2xl border border-border bg-card/20">
          {status === "loading" && !data ? (
            <div className="flex flex-col gap-4 p-8">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : settlement && dispatch ? (
            <>
              <div className="flex flex-col gap-6 p-6 md:p-10">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
                    <span className="relative inline-flex size-2 rounded-full bg-success" />
                  </span>
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    Most recent settlement · window {dispatch.windowLabel}
                  </span>
                </div>

                <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
                  <Figure
                    value={`${formatWh(settlement.deliveredWh)} Wh`}
                    label="delivered"
                  />
                  <Op>=</Op>
                  <Figure
                    value={`${whToKwh(settlement.deliveredWh)} kWh`}
                    label="converted"
                  />
                  <Op>×</Op>
                  <Figure
                    value={formatCspr(dispatch.pricePerKwhCspr)}
                    label="CSPR / kWh"
                  />
                  <Op>=</Op>
                  <div className="flex flex-col">
                    <span className="text-3xl font-semibold tabular-nums text-primary md:text-4xl">
                      {formatCspr(settlement.paidCspr)} CSPR
                    </span>
                    <span className="text-xs text-muted-foreground">
                      paid to the household
                    </span>
                  </div>
                </div>

                <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  No operator entered that figure. It is the product of two numbers the
                  contract emitted, and you can recompute it from the settling event
                  alone.
                </p>

                <div>
                  <Button asChild variant="outline">
                    <Link href="/dashboard">
                      Walk the full math
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                </div>
              </div>

              {log.length > 0 ? (
                <div className="relative border-t border-border py-4">
                  <Marquee pauseOnHover className="[--duration:38s] [--gap:0.75rem]">
                    {log.map((event, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 rounded-lg border border-border bg-background/60 px-4 py-2.5"
                      >
                        <span className="whitespace-nowrap text-xs font-medium text-foreground">
                          {EVENT_LABEL[event.kind]}
                        </span>
                        <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                          {eventSummary(event)}
                        </span>
                      </div>
                    ))}
                  </Marquee>
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-background to-transparent"
                  />
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-background to-transparent"
                  />
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex flex-col items-start gap-4 p-8 md:p-10">
              <p className="text-muted-foreground">
                The market is live on Casper testnet. Open the dashboard to read its
                current state directly.
              </p>
              <Button asChild variant="outline">
                <Link href="/dashboard">
                  Open the dashboard
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-xl font-medium tabular-nums md:text-2xl">
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function Op({ children }: { children: React.ReactNode }) {
  return (
    <span className="pb-5 text-xl text-muted-foreground/50 select-none">
      {children}
    </span>
  );
}
