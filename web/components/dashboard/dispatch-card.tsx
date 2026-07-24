"use client";

/**
 * One dispatch event's whole story: the window a buyer opened, what was pledged
 * against it, the settlement accounting, and any budget the buyer reclaimed.
 *
 * The settlement math is the point; everything else here is the frame that makes it
 * legible — who opened the window, over what hours, for how much.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SettlementMath } from "@/components/dashboard/settlement-math";
import type { DispatchStory } from "@/lib/market-types";
import { formatCspr, formatWh, shortAddress, formatTimestamp } from "@/lib/format";

function Stat({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-sm tabular-nums" title={title}>
        {value}
      </span>
    </div>
  );
}

export function DispatchCard({ dispatch }: { dispatch: DispatchStory }) {
  const settled = dispatch.settlements.length > 0;
  const pledgedTotal = dispatch.pledges.reduce((sum, p) => sum + p.pledgedWh, 0);

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="font-mono text-sm">{dispatch.eventId}</CardTitle>
          <Badge variant={settled ? "default" : "secondary"}>
            {settled ? "settled" : "open"}
          </Badge>
          <Badge variant="outline" className="font-mono">
            {dispatch.windowLabel}
          </Badge>
        </div>
        <CardDescription>
          Buyer{" "}
          <span
            className="font-mono text-foreground/80"
            title={dispatch.buyer}
          >
            {shortAddress(dispatch.buyer)}
          </span>{" "}
          opened this window and escrowed a budget to pay for demand cut inside it.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Price"
          value={`${formatCspr(dispatch.pricePerKwhCspr)} CSPR/kWh`}
          title={`${dispatch.pricePerKwhMotes} motes`}
        />
        <Stat
          label="Budget escrowed"
          value={`${formatCspr(dispatch.budgetCspr)} CSPR`}
          title={`${dispatch.budgetMotes} motes`}
        />
        <Stat label="Pledged" value={`${formatWh(pledgedTotal)} Wh`} />
        <Stat
          label="Settle by"
          value={formatTimestamp(dispatch.settlementDeadline)}
        />
      </CardContent>

      {settled ? (
        <CardContent className="flex flex-col gap-6 border-t pt-5">
          {dispatch.settlements.map((s) => (
            <SettlementMath key={s.assetId} dispatch={dispatch} settlement={s} />
          ))}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 px-4 py-3 text-sm">
            <span className="text-muted-foreground">
              Paid out{" "}
              <span className="font-mono font-medium text-foreground">
                {formatCspr(dispatch.totalPaidCspr)} CSPR
              </span>{" "}
              of the {formatCspr(dispatch.budgetCspr)} CSPR budget.
            </span>
            {dispatch.refundedCspr !== undefined ? (
              <span className="text-muted-foreground">
                Buyer reclaimed{" "}
                <span className="font-mono font-medium text-foreground">
                  {formatCspr(dispatch.refundedCspr)} CSPR
                </span>{" "}
                unspent.
              </span>
            ) : null}
          </div>
        </CardContent>
      ) : (
        <CardContent className="border-t pt-5 text-sm text-muted-foreground">
          Awaiting settlement. Once the window closes and meter history is revealed,
          the contract recomputes each baseline and settles payouts here.
        </CardContent>
      )}
    </Card>
  );
}
