/**
 * The mechanism section, built on the reference's sticky-scroll pattern: the claim pins
 * on the left while the three evidence panels scroll past on the right.
 *
 * The panels follow the actual lifecycle — the agent decides, the baseline is locked
 * before the window and revealed after, and the contract turns the reveal into a payout.
 * All three show the same real settlement the dashboard reads live.
 */

import { Terminal, Lock, Scale } from "lucide-react";
import {
  StickyFeatureSection,
  type FeaturePanel,
} from "@/components/landing/sticky-feature-section";
import {
  AgentTerminalVisual,
  CommitRevealVisual,
  SettlementMathVisual,
} from "@/components/landing/feature-visuals";

const ICON = "size-4 shrink-0";

const PANELS: readonly FeaturePanel[] = [
  {
    caption: "The agent decides what to sell",
    body: "It forecasts the home's baseline from meter history, checks the offered price against what it usually earns, and pledges only load it can genuinely defer.",
    icon: <Terminal className={ICON} />,
    visual: <AgentTerminalVisual />,
  },
  {
    caption: "The baseline is locked before the window",
    body: "The home commits a hash of its baseline before anything runs, then reveals the values at settlement. The contract checks the reveal against the commitment, so a baseline cannot be rewritten after the outcome is known.",
    icon: <Lock className={ICON} />,
    visual: <CommitRevealVisual />,
  },
  {
    caption: "The contract pays only what landed",
    body: "Delivered reduction is adjusted baseline minus metered actual, capped at the pledge and clamped to ±20%. Multiply by price and you have the payout: arithmetic anyone can repeat from the settling event alone.",
    icon: <Scale className={ICON} />,
    visual: <SettlementMathVisual />,
  },
];

export function HowItWorks() {
  return (
    <StickyFeatureSection
      id="how"
      title="An agent decides. The contract verifies."
      description="The household side is autonomous: an agent reads prices, forecasts a baseline, and pledges only what it can shed without anyone noticing. The chain side is adversarial by design: it assumes the agent might lie, and settles on evidence."
      cta={{ label: "See it live", href: "/dashboard" }}
      panels={PANELS}
    />
  );
}
