/**
 * What the contract actually enforces.
 *
 * The reference layout puts a testimonial wall here. Spectre has no customers to
 * quote, and inventing some would undercut the one thing this page is arguing — that
 * claims should be checkable. So this slot carries the enforced properties instead,
 * each stated as something the contract does rather than something we promise.
 */

import { ShieldCheck, Lock, Gauge, Wallet, Eye, Scale } from "lucide-react";

import { SectionHeader } from "@/components/landing/section-header";

const GUARANTEES = [
  {
    icon: Scale,
    title: "Payouts are recomputable",
    body: "Every payment equals delivered × price, where delivered is adjusted baseline minus metered actual, capped at the pledge. The settling event carries all four numbers, so anyone can redo the arithmetic without asking us for anything.",
  },
  {
    icon: Lock,
    title: "Baselines are committed in advance",
    body: "A home commits a hash of its baseline before the window opens and reveals the values at settlement. The contract checks the reveal against the commitment, so a baseline cannot be rewritten after the fact to manufacture a reduction.",
  },
  {
    icon: Gauge,
    title: "Adjustments are bounded",
    body: "Day-of grid conditions can shift a baseline, but the contract clamps that adjustment to ±20% and records when the clamp binds. No single input can swing a payout without limit.",
  },
  {
    icon: Wallet,
    title: "Budgets are escrowed, refunds are honest",
    body: "The buyer's budget is locked in the contract before any home pledges against it. It can only ever pay for delivered reduction, and whatever the window does not spend is withdrawable by the buyer — never stranded, never overspent.",
  },
  {
    icon: Eye,
    title: "The frontend holds no keys",
    body: "This site reads the chain and nothing else. It cannot sign, move funds, or alter market state. Every figure it shows is decoded from a public event you can read yourself.",
  },
  {
    icon: ShieldCheck,
    title: "Overstating a pledge earns nothing",
    body: "The pledge is a ceiling on payment, not a target. Shedding more than pledged pays the pledge; shedding less pays what actually landed. There is no configuration in which exaggerating is the profitable move.",
  },
] as const;

export function Guarantees() {
  return (
    <section id="mechanism" className="relative w-full">
      <div
        aria-hidden
        className="glow-bottom pointer-events-none absolute inset-0 -z-10"
      />
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 md:py-28">
        <SectionHeader
          eyebrow="Guarantees"
          title="Not trust."
          accent="Arithmetic."
          subtitle="Trusting Spectre is not the point — checking it is. These are properties the deployed contract enforces, each one visible in the events it emits."
        />

        <div className="mt-14 grid divide-y divide-border overflow-hidden rounded-2xl border border-border sm:grid-cols-2 sm:divide-x lg:grid-cols-3">
          {GUARANTEES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="flex flex-col gap-3 bg-card/20 p-6 transition-colors hover:bg-card/40 md:p-8"
            >
              <span className="grid size-9 place-items-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
                <Icon className="size-4.5 text-primary" />
              </span>
              <h3 className="text-lg font-medium tracking-tight">{title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
