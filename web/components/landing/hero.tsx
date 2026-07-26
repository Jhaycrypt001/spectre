"use client";

/**
 * Hero + lifecycle demo.
 *
 * The headline states the claim; the tab strip below it walks the four stages a
 * negawatt actually passes through on chain — commit, open, pledge, settle — each with
 * the concrete artifact that stage produces. The stage content is a faithful
 * description of what the contract does at that step, not a mock console.
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GradientText } from "@/components/landing/section-header";
import { cn } from "@/lib/utils";

const STAGES = [
  {
    key: "commit",
    label: "Commit",
    title: "A home locks its baseline before the window",
    body: "The household agent hashes its expected consumption profile and writes only the hash on chain. The numbers stay private until settlement, and they can no longer be changed, which is what stops a home from inflating its baseline after the fact to claim a bigger reduction.",
    artifact: {
      caption: "BaselineCommitted",
      rows: [
        ["asset", "site-mrwwzj81"],
        ["commitment", "945c1247…"],
        ["reveals at", "settlement"],
      ],
    },
  },
  {
    key: "open",
    label: "Open",
    title: "A buyer opens a window and escrows the budget",
    body: "A buyer posts the hours it needs demand cut, the price per kWh it will pay, and locks the full budget into the contract up front. Homes can see exactly what is on offer before committing to anything, and the buyer cannot walk away from a settled bill.",
    artifact: {
      caption: "EventOpened",
      rows: [
        ["window", "17:30–19:30"],
        ["price", "2 CSPR / kWh"],
        ["budget", "10 CSPR escrowed"],
      ],
    },
  },
  {
    key: "pledge",
    label: "Pledge",
    title: "Agents pledge what they can actually shed",
    body: "Each home's agent decides how much load it can defer without hurting the household, and pledges that figure. The pledge is a ceiling on what it can be paid: deliver more and you are still paid for the pledge, so there is no reward for overstating.",
    artifact: {
      caption: "Pledged",
      rows: [
        ["asset", "site-mrwwzj81"],
        ["pledged", "2,700 Wh"],
        ["caps payout at", "pledge"],
      ],
    },
  },
  {
    key: "settle",
    label: "Settle",
    title: "The contract computes and pays what was delivered",
    body: "Baselines are revealed and checked against their commitments. The contract recomputes each baseline, applies the day-of adjustment within a ±20% clamp, subtracts metered actual use, and pays delivered × price. Unspent budget returns to the buyer.",
    artifact: {
      caption: "Settled",
      rows: [
        ["delivered", "1,963 Wh"],
        ["paid", "3.926 CSPR"],
        ["refunded", "6.074 CSPR"],
      ],
    },
  },
] as const;

export function Hero() {
  const [active, setActive] = useState(0);
  const stage = STAGES[active];

  return (
    <section
      id="hero"
      className="relative flex flex-col items-center justify-center overflow-hidden px-4 py-20 md:py-28"
    >
      <div aria-hidden className="glow-top pointer-events-none absolute inset-0 -z-10" />

      <span className="shadow-badge mb-6 inline-flex max-w-full items-center gap-2 overflow-hidden rounded-full bg-card px-4 py-1.5 text-sm">
        <span className="relative flex size-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
          <span className="relative inline-flex size-2 rounded-full bg-success" />
        </span>
        <span className="truncate text-muted-foreground">
          Live on Casper testnet · settling real payouts
        </span>
      </span>

      <h1 className="max-w-4xl text-center text-4xl font-semibold tracking-tighter text-balance md:text-5xl lg:text-6xl">
        The cheapest megawatt is the one{" "}
        <GradientText>nobody uses</GradientText>.
      </h1>

      <p className="mt-6 max-w-2xl text-center text-lg leading-relaxed text-balance text-muted-foreground">
        Spectre turns household demand reduction into something you can sell, and
        proves every payout on chain, so it can be recomputed by anyone rather than
        trusted.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button asChild size="lg">
          <Link href="/dashboard">
            See it settle live
            <ArrowRight className="size-4" />
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="#how">How it works</Link>
        </Button>
      </div>

      {/*
       * Lifecycle tabs. The reference draws the strip full-bleed with hairline dividers
       * as pseudo-elements rather than a bordered box, and marks the active tab with an
       * underline that grows from the left plus a faint dot-grid glow above it.
       */}
      <div className="mt-16 w-full max-w-5xl">
        <div
          role="tablist"
          aria-label="Spectre lifecycle"
          className="grid w-full grid-cols-2 overflow-hidden border-b border-border lg:grid-cols-4"
        >
          {STAGES.map((s, i) => (
            <button
              key={s.key}
              role="tab"
              type="button"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={cn(
                "group relative flex min-h-[44px] w-full cursor-pointer items-center justify-center overflow-hidden p-5 text-center text-sm font-semibold whitespace-nowrap transition-colors",
                "before:absolute before:top-0 before:left-0 before:z-10 before:h-screen before:w-px before:bg-border before:content-[''] first:before:bg-transparent",
                "after:absolute after:-top-px after:-left-px after:z-10 after:h-px after:w-screen after:bg-border after:content-[''] last:after:bg-transparent",
                i === active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {/* Dot-grid wash above the active tab, faded out toward the label. */}
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-0 -z-10 h-10 w-[calc(100%+1rem)] transition-opacity duration-300",
                  "mask-[linear-gradient(to_bottom,white,transparent)]",
                  "bg-[radial-gradient(currentColor_1px,transparent_1px)] bg-[length:6px_6px] text-primary/40",
                  i === active ? "opacity-100" : "opacity-0",
                )}
              />
              <span className="mr-2 font-mono text-xs text-muted-foreground/60">
                0{i + 1}
              </span>
              {s.label}
              <span
                aria-hidden
                className="pointer-events-none absolute right-0 bottom-0 left-0 h-px"
              >
                <span
                  className={cn(
                    "absolute inset-0 -top-px h-px w-full origin-left bg-primary transition-transform duration-300 ease-out",
                    i === active ? "scale-x-100" : "scale-x-0",
                  )}
                />
              </span>
            </button>
          ))}
        </div>

        <div className="grid gap-8 border-x border-b border-border bg-card/20 p-6 md:grid-cols-[1.2fr_1fr] md:p-8">
          <div className="flex flex-col justify-center gap-3 text-left">
            <h3 className="text-xl font-medium tracking-tight md:text-2xl">
              {stage.title}
            </h3>
            <p className="leading-relaxed text-muted-foreground">{stage.body}</p>
          </div>

          <div className="rounded-lg border border-border bg-background/60 p-4">
            <div className="mb-3 flex items-center gap-2 border-b border-border pb-2.5">
              <Check className="size-3.5 text-success" />
              <span className="font-mono text-xs text-muted-foreground">
                emits {stage.artifact.caption}
              </span>
            </div>
            <dl className="flex flex-col gap-2.5">
              {stage.artifact.rows.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="font-mono text-sm tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
