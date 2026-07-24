/**
 * The artifacts rendered inside the sticky feature section's panels.
 *
 * Every figure here is the one the deployed contract actually emitted for
 * evt-mrwwzj81 — baseline 3,745 Wh, clamped adjustment to 2,996, metered 1,033,
 * delivered 1,963, paid 3.926 CSPR. The landing page and the live dashboard read
 * from the same settlement, so an illustration can never drift from the chain.
 */

const WINDOW_CHROME = (
  <div className="flex gap-2">
    <div className="size-3 rounded-full bg-red-500" />
    <div className="size-3 rounded-full bg-yellow-500" />
    <div className="size-3 rounded-full bg-green-500" />
  </div>
);

/** Panel 1 — the agent deciding what it can sell. */
export function AgentTerminalVisual() {
  const lines = [
    { dim: true, text: "Reading grid prices for 17:30–19:30..." },
    { dim: true, text: "Price 2 CSPR/kWh — above 30-day median" },
    { dim: true, text: "Forecasting baseline from 14 days of history" },
    { dim: true, text: "Deferrable: water heater 1.2kW, EV 1.5kW" },
    { ok: true, text: "✓ Pledged 2,700 Wh within comfort limits" },
  ];
  return (
    <div className="relative w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border bg-muted px-4 py-3">
        {WINDOW_CHROME}
      </div>
      <div className="bg-background p-4 font-mono text-xs md:p-6 md:text-sm">
        <div className="space-y-1 text-foreground">
          <div className="flex">
            <span className="text-primary">$</span>
            <span className="ml-2">spectre agent --site site-mrwwzj81</span>
          </div>
          {lines.map((l) => (
            <div
              key={l.text}
              className={l.ok ? "text-success" : "text-muted-foreground"}
            >
              {l.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Panel 2 — the baseline locked before the window, revealed after. */
export function CommitRevealVisual() {
  return (
    <div className="relative w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border bg-muted px-4 py-3">
        {WINDOW_CHROME}
        <span className="ml-1 font-mono text-xs text-muted-foreground">
          baseline.commit
        </span>
      </div>
      <div className="flex flex-col gap-4 bg-background p-5 md:p-6">
        <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Before the window opens
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
              locked
            </span>
          </div>
          <code className="font-mono text-xs break-all text-foreground/80">
            945c1247…1f0e57c6
          </code>
        </div>

        <div className="flex justify-center">
          <span className="font-mono text-xs text-muted-foreground/60">
            ↓ window runs ↓
          </span>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Revealed at settlement
            </span>
            <span className="rounded-full bg-success/15 px-2 py-0.5 font-mono text-[10px] text-success">
              hash matches
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-foreground">Baseline</span>
            <span className="font-mono text-lg font-semibold tabular-nums text-foreground">
              3,745 <span className="text-xs text-muted-foreground">Wh</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Panel 3 — the arithmetic that produces the payout. */
export function SettlementMathVisual() {
  const rows = [
    { sign: "", label: "baseline revealed", value: "3,745 Wh" },
    { sign: "−", label: "day-of adjustment, clamped at −20%", value: "2,996 Wh" },
    { sign: "−", label: "metered actual", value: "1,033 Wh" },
    { sign: "=", label: "delivered reduction", value: "1,963 Wh", strong: true },
  ];
  return (
    <div className="relative w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border bg-muted px-4 py-3">
        {WINDOW_CHROME}
        <span className="ml-1 font-mono text-xs text-muted-foreground">
          Settled · evt-mrwwzj81
        </span>
      </div>
      <div className="flex flex-col bg-background p-5 md:p-6">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline gap-3 py-2">
            <span className="w-3 shrink-0 font-mono text-sm text-muted-foreground/60">
              {r.sign}
            </span>
            <span
              className={
                r.strong
                  ? "flex-1 text-sm text-foreground"
                  : "flex-1 text-sm text-muted-foreground"
              }
            >
              {r.label}
            </span>
            <span className="font-mono text-sm tabular-nums text-foreground">
              {r.value}
            </span>
          </div>
        ))}
        <div className="mt-3 flex items-baseline gap-3 rounded-md bg-primary/5 px-3 py-3 ring-1 ring-primary/20">
          <span className="w-3 shrink-0 font-mono text-sm text-muted-foreground/60">
            ×
          </span>
          <span className="flex-1 text-sm text-foreground">
            2 CSPR / kWh → paid to the household
          </span>
          <span className="font-mono text-base font-semibold tabular-nums text-primary">
            3.926 CSPR
          </span>
        </div>
      </div>
    </div>
  );
}
