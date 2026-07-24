"use client";

/**
 * The raw on-chain event log, newest first.
 *
 * The story cards above interpret these events; this feed is the receipts. Every row is
 * one decoded event exactly as the contract emitted it, so a skeptical reader can check
 * that nothing in the interpretation was invented. The `log` arrives already ordered
 * newest-first from the route.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { JsonMarketEvent, MarketEventKind } from "@/lib/market-types";
import { formatCspr, formatWh, shortAddress, truncateHex } from "@/lib/format";

const KIND_STYLE: Record<
  MarketEventKind,
  { label: string; tone: "default" | "secondary" | "outline" }
> = {
  AssetRegistered: { label: "Asset registered", tone: "outline" },
  BaselineCommitted: { label: "Baseline committed", tone: "outline" },
  EventOpened: { label: "Dispatch opened", tone: "secondary" },
  Pledged: { label: "Pledged", tone: "secondary" },
  Settled: { label: "Settled", tone: "default" },
  BudgetWithdrawn: { label: "Budget withdrawn", tone: "outline" },
};

const motesToCspr = (motes: string): number => Number(motes) / 1e9;

/** A one-line, plain-language summary of what an event records. */
function describe(event: JsonMarketEvent): React.ReactNode {
  switch (event.kind) {
    case "AssetRegistered":
      return (
        <>
          <Ref>{event.assetId}</Ref> joined — up to{" "}
          <Num>{formatWh(Number(event.maxCurtailableW))}</Num> W curtailable, owner{" "}
          <Mono title={event.owner}>{shortAddress(event.owner)}</Mono>
        </>
      );
    case "BaselineCommitted":
      return (
        <>
          <Ref>{event.assetId}</Ref> committed a baseline hash{" "}
          <Mono title={event.commitment}>{truncateHex(event.commitment)}</Mono>{" "}
          — locked before the window, revealed after
        </>
      );
    case "EventOpened":
      return (
        <>
          <Ref>{event.eventId}</Ref> opened by{" "}
          <Mono title={event.buyer}>{shortAddress(event.buyer)}</Mono> at{" "}
          <Num>{formatCspr(motesToCspr(event.pricePerKwhMotes))}</Num> CSPR/kWh,
          budget <Num>{formatCspr(motesToCspr(event.budgetMotes))}</Num> CSPR
        </>
      );
    case "Pledged":
      return (
        <>
          <Ref>{event.assetId}</Ref> pledged{" "}
          <Num>{formatWh(Number(event.pledgedWh))}</Num> Wh into{" "}
          <Ref>{event.eventId}</Ref>
        </>
      );
    case "Settled":
      return (
        <>
          <Ref>{event.assetId}</Ref> settled{" "}
          <Num>{formatWh(Number(event.deliveredWh))}</Num> Wh delivered →{" "}
          <Num>{formatCspr(motesToCspr(event.paidMotes))}</Num> CSPR paid
        </>
      );
    case "BudgetWithdrawn":
      return (
        <>
          <Mono title={event.buyer}>{shortAddress(event.buyer)}</Mono> reclaimed{" "}
          <Num>{formatCspr(motesToCspr(event.refundedMotes))}</Num> CSPR unspent
          from <Ref>{event.eventId}</Ref>
        </>
      );
  }
}

const Ref = ({ children }: { children: React.ReactNode }) => (
  <span className="font-mono text-foreground/80">{children}</span>
);
const Mono = ({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) => (
  <span className="font-mono text-foreground/70" title={title}>
    {children}
  </span>
);
const Num = ({ children }: { children: React.ReactNode }) => (
  <span className="font-mono font-medium text-foreground tabular-nums">
    {children}
  </span>
);

export function EventFeed({ log }: { log: JsonMarketEvent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>On-chain event log</CardTitle>
        <CardDescription>
          Every event the contract emitted, newest first — the receipts behind the
          stories above.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <ScrollArea className="h-[26rem]">
          <ol className="flex flex-col">
            {log.map((event, i) => {
              const style = KIND_STYLE[event.kind];
              return (
                <li
                  key={i}
                  className="flex items-start gap-3 border-t border-border/60 px-6 py-3 first:border-t-0"
                >
                  <span className="mt-0.5 w-8 shrink-0 text-right font-mono text-xs text-muted-foreground/60 tabular-nums">
                    {log.length - i}
                  </span>
                  <Badge
                    variant={style.tone}
                    className="mt-px shrink-0 whitespace-nowrap"
                  >
                    {style.label}
                  </Badge>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {describe(event)}
                  </p>
                </li>
              );
            })}
          </ol>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
