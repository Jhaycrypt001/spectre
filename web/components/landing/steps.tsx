/**
 * The three moves that make up a full market cycle, as numbered steps with a
 * supporting visual rail. Mirrors the reference layout's alternating step blocks.
 */

import { SectionHeader } from "@/components/landing/section-header";

const STEPS = [
  {
    n: "01",
    title: "Register a home and commit a baseline",
    body: "A household registers its meter and the ceiling it can curtail. Before each window, its agent commits a hash of the baseline it expects to consume — locked in advance, revealed only at settlement.",
    tags: ["AssetRegistered", "BaselineCommitted"],
  },
  {
    n: "02",
    title: "Open a window and escrow the budget",
    body: "A buyer opens a dispatch window with a price per kWh and locks the budget in the contract. Homes pledge how much load they will shed. Nothing pays out until the window closes.",
    tags: ["EventOpened", "Pledged"],
  },
  {
    n: "03",
    title: "Settle on delivered reduction",
    body: "Baselines are revealed and verified against their commitments. The contract computes delivered reduction, pays delivered × price up to the pledge, and returns whatever the window did not spend.",
    tags: ["Settled", "BudgetWithdrawn"],
  },
] as const;

export function Steps() {
  return (
    <section id="lifecycle" className="relative w-full">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 md:py-28">
        <SectionHeader
          eyebrow="Lifecycle"
          title="Register. Pledge."
          accent="Settle."
          subtitle="Three moves, all on chain. No trusted operator sits between a home and its payment."
        />

        <div className="mt-14 flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border">
          {STEPS.map((step) => (
            <div
              key={step.n}
              className="grid gap-6 bg-card/20 p-6 md:grid-cols-[auto_1fr_auto] md:items-center md:gap-10 md:p-8"
            >
              <span className="font-mono text-4xl font-medium tracking-tighter text-primary/40 md:text-5xl">
                {step.n}
              </span>
              <div className="flex flex-col gap-2">
                <h3 className="text-2xl font-medium tracking-tighter md:text-3xl">
                  {step.title}
                </h3>
                <p className="max-w-2xl leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 md:flex-col md:items-end">
                {step.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md border border-border bg-background/60 px-2.5 py-1 font-mono text-xs text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
