/**
 * Closing call to action. The reference layout ends on a lit, centered block; the ask
 * here is to go verify the claim rather than to sign up for anything.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GradientText } from "@/components/landing/section-header";

export function Cta() {
  return (
    <section
      id="cta"
      className="relative flex flex-col items-center justify-center overflow-hidden px-4 py-20 md:py-32"
    >
      <div
        aria-hidden
        className="glow-bottom pointer-events-none absolute inset-0 -z-10"
      />
      <h2 className="max-w-3xl text-center text-3xl font-medium tracking-tighter text-balance md:text-4xl lg:text-5xl">
        Don&apos;t take our word for it.{" "}
        <GradientText>Recompute it.</GradientText>
      </h2>
      <p className="mt-5 max-w-xl text-center leading-relaxed text-balance text-muted-foreground">
        Open the dashboard, follow the settlement math from baseline to payout, and
        check it against the contract&apos;s own events on the public explorer.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button asChild size="lg">
          <Link href="/dashboard">
            Open the live dashboard
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
