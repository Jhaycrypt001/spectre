"use client";

/**
 * The settlement math walkthrough — the dashboard's core claim, made legible.
 *
 * A `Settled` event on chain carries the full accounting: the baseline the contract
 * recomputed from the revealed history, the day-of adjustment, metered actual, the
 * reduction it credited, and the payout. This component lays that out as a vertical
 * computation so a reader can follow every step and see that the paid amount is not a
 * number the operator chose — it is `delivered × price`, and `delivered` is itself
 * `adjustedBaseline − actual` (capped at the pledge). Every figure shown is the value
 * the chain emitted; nothing here is recomputed or rounded into agreement.
 */

import { Badge } from "@/components/ui/badge";
import type { DispatchStory, SettlementView } from "@/lib/market-types";
import { bpsToPercent, formatCspr, formatWh, whToKwh } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  readonly dispatch: DispatchStory;
  readonly settlement: SettlementView;
}

/** One row in the computation: a label, the value, and how it was derived. */
function Step({
  label,
  value,
  unit,
  derivation,
  emphasis,
  sign,
}: {
  label: string;
  value: string;
  unit?: string;
  derivation?: string;
  emphasis?: boolean;
  sign?: "minus" | "times" | "equals";
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[1.4rem_1fr_auto] items-baseline gap-x-3 py-2",
        emphasis && "rounded-lg bg-primary/5 px-3 -mx-3 ring-1 ring-primary/20",
      )}
    >
      <span
        aria-hidden
        className="font-mono text-muted-foreground/70 text-sm select-none"
      >
        {sign === "minus" ? "−" : sign === "times" ? "×" : sign === "equals" ? "=" : ""}
      </span>
      <div className="flex flex-col gap-0.5">
        <span
          className={cn(
            "leading-tight",
            emphasis ? "font-medium text-foreground" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
        {derivation ? (
          <span className="text-xs text-muted-foreground/70">{derivation}</span>
        ) : null}
      </div>
      <span
        className={cn(
          "font-mono tabular-nums text-right whitespace-nowrap",
          emphasis ? "text-lg font-semibold text-primary" : "text-foreground",
        )}
      >
        {value}
        {unit ? (
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function SettlementMath({ dispatch, settlement: s }: Props) {
  const reductionBeforeCap = s.adjustedBaselineWh - s.actualWh;
  const capped = s.deliveredWh < reductionBeforeCap;

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
        <span className="font-mono text-xs text-muted-foreground">
          {s.assetId}
        </span>
        <Badge variant="outline" className="font-mono">
          window {dispatch.windowLabel}
        </Badge>
      </div>

      <Step
        label="Baseline recomputed from revealed history"
        derivation="what this home would have used, absent the event"
        value={formatWh(s.unadjustedBaselineWh)}
        unit="Wh"
      />
      <Step
        sign="minus"
        label={`Day-of adjustment ${bpsToPercent(s.adjustmentBps)}`}
        derivation={
          s.adjustmentClamped
            ? "clamped to the ±20% cap the contract enforces"
            : "grid-condition correction applied on the day"
        }
        value={formatWh(s.adjustedBaselineWh)}
        unit="Wh"
      />
      <Step
        sign="minus"
        label="Metered actual consumption in the window"
        derivation="what the home actually drew, from the meter"
        value={formatWh(s.actualWh)}
        unit="Wh"
      />
      <Step
        sign="equals"
        label="Reduction delivered"
        derivation={
          capped
            ? `capped at the ${formatWh(s.pledgedWh)} Wh pledge (raw ${formatWh(reductionBeforeCap)} Wh)`
            : `adjusted baseline − actual, within the ${formatWh(s.pledgedWh)} Wh pledge`
        }
        value={formatWh(s.deliveredWh)}
        unit="Wh"
      />
      <Step
        sign="times"
        label={`Price ${formatCspr(dispatch.pricePerKwhCspr)} CSPR per kWh`}
        derivation={`${whToKwh(s.deliveredWh)} kWh × ${formatCspr(dispatch.pricePerKwhCspr)} CSPR`}
        value={formatCspr(dispatch.pricePerKwhCspr)}
        unit="CSPR/kWh"
      />
      <div className="my-1 border-t border-dashed border-border" />
      <Step
        sign="equals"
        emphasis
        label="Paid to the household"
        derivation="settled on Casper — recomputable from this event alone"
        value={formatCspr(s.paidCspr)}
        unit="CSPR"
      />
    </div>
  );
}
