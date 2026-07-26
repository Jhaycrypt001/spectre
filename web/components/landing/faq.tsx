/**
 * FAQ. Answers the questions a skeptical reader actually has about this mechanism —
 * including the uncomfortable ones about gaming and metering — rather than softball
 * product questions.
 */

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { SectionHeader } from "@/components/landing/section-header";

const FAQS = [
  {
    q: "What exactly is a negawatt?",
    a: "A watt that was going to be consumed and wasn't. When the grid is strained, reducing demand is physically equivalent to adding supply, but it's far cheaper and faster than firing up a peaker plant. The problem has always been proving a reduction happened, because you're measuring the absence of something. That proof is what Spectre builds.",
  },
  {
    q: "How can you prove energy wasn't used?",
    a: "You compare metered consumption against a baseline of what the home would have used otherwise. The hard part is that whoever supplies the baseline has an incentive to inflate it. Spectre fixes that ordering problem: the home commits a hash of its baseline before the window opens, and reveals the values afterwards. The contract verifies the reveal matches the commitment, so the baseline cannot be tuned after the outcome is known.",
  },
  {
    q: "What stops a household from overstating what it will shed?",
    a: "Nothing needs to. The pledge is a ceiling on payment, not a target. If a home pledges 3,000 Wh and delivers 1,900, it is paid for 1,900. If it pledges 1,000 and delivers 1,900, it is paid for 1,000. Overstating buys nothing, and understating leaves money on the table, so honest pledging is simply the best strategy available.",
  },
  {
    q: "Who decides the baseline adjustment, and can it be abused?",
    a: "Grid conditions on the day can legitimately shift what a home would have consumed: a heatwave changes everything. The contract accepts that adjustment but clamps it to ±20%, and records in the settling event both the adjustment applied and whether the clamp was binding. So the adjustment is bounded, and every use of it is visible in the log.",
  },
  {
    q: "Where does the meter data come from?",
    a: "From the household's own metering, submitted by its agent. Spectre's on-chain component is deliberately scoped to the market and settlement logic: commitments, pledges, verified arithmetic, and escrowed payment. Hardware attestation of the meter itself is a separate trust problem, and this project doesn't claim to have solved it.",
  },
  {
    q: "Does this website hold my funds or keys?",
    a: "No. The frontend is strictly read-only: it fetches public events from the deployed contract and renders them. It holds no signing key and cannot move funds or change market state. You can verify that by reading the same events yourself on the Casper explorer.",
  },
  {
    q: "Why Casper?",
    a: "Settlement here involves many small payouts, and the arithmetic needs to be auditable rather than merely asserted. Casper's fee model keeps sub-cent settlements viable, and its account and contract model made the escrow-and-refund flow straightforward to express directly on chain.",
  },
] as const;

export function Faq() {
  return (
    <section id="faq" className="relative w-full">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 md:py-28">
        <div className="grid items-start gap-12 md:grid-cols-[1fr_1.3fr] md:gap-16">
          {/*
           * The accordion column is much taller than the heading, so the heading is
           * pinned while the reader works down the questions. Without this the left
           * track just ends, leaving a large dead gap above the section divider.
           */}
          <SectionHeader
            align="left"
            eyebrow="FAQ"
            title="The questions worth"
            accent="asking."
            subtitle="Including the ones about how this could be gamed. If a mechanism can't survive that conversation, it isn't a mechanism."
            className="md:sticky md:top-24"
          />

          <Accordion type="single" collapsible className="w-full">
            {FAQS.map((faq, i) => (
              <AccordionItem key={faq.q} value={`item-${i}`}>
                <AccordionTrigger>{faq.q}</AccordionTrigger>
                <AccordionContent>{faq.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
}
