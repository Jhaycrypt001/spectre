# Spectre Market on Casper — Architecture

## The problem

Grid operators pay for **demand reduction** — a "negawatt". It is a real, regulated,
multi-billion-dollar market (FERC Order 2222 in the US, National Grid ESO / Octopus
flexibility services in the UK).

Households are locked out of it. Not for technical reasons — because a single household's
contribution in a dispatch window is worth roughly £0.20–£1.50, and the cost to verify,
settle, and pay that is larger than the payment itself. Aggregators solve this by bundling
thousands of homes under a manual contract, which means onboarding friction, opaque
revenue splits, and no way for an individual to audit what they were owed.

Two things remove that blocker:
1. **An autonomous agent** that decides what to curtail without asking a human each time.
2. **Sub-cent on-chain settlement** so a £0.31 payment is economically worth making.

Neither works alone. Together they open a market that currently cannot exist.

## The hard part: proving a negawatt

You cannot meter energy that was not consumed. The industry answer is a **baseline
methodology** — a counterfactual estimate of what the site *would* have drawn.

We implement the **CAISO "10-in-10" baseline** (also the basis of PJM's methodology):

- Take the 10 most recent eligible non-event weekdays.
- For the same half-hour interval, average consumption across those 10 days.
- Apply a **day-of adjustment** from the 2 hours preceding the event window,
  clamped to ±20% to prevent gaming.
- `delivered_kwh = max(0, adjusted_baseline_kwh - actual_kwh)`

This is a real, published, auditable standard. Implementing it on-chain is what makes the
payout trustworthy rather than an assertion.

### Why it must be commit-reveal

A site that knows the baseline formula can inflate its baseline by deliberately consuming
more on non-event days, then "reduce" to normal and get paid for nothing. This is the
central fraud in demand response and the reason the market is gated to trusted parties.

Our defence:

1. The asset's baseline window is **hashed and committed on-chain before the dispatch
   event opens** (`baseline_commitment`).
2. At settlement the raw intervals are **revealed**; the contract rehashes them and
   rejects any mismatch.
3. The contract — not the aggregator, not the agent — computes the baseline and the
   payout from the revealed data.

The result: the household cannot revise history, the aggregator cannot shave the payout,
and any third party can recompute the settlement from on-chain data alone.

**This is the novel on-chain primitive: a verifiable negawatt.**

## Components

### 1. `SpectreMarket` — Odra contract (Casper Testnet)

| Entry point | Purpose |
| --- | --- |
| `register_asset` | Register a flexible load (owner, max curtailable kW) |
| `commit_baseline` | Store `hash(baseline_intervals)` for an asset, before any event |
| `open_event` | Buyer escrows a budget; sets window, £/kWh-avoided, cap |
| `pledge` | Agent pledges kWh for an asset into an open event (pre-window only) |
| `settle` | Reveal intervals + actual draw → contract verifies hash, recomputes 10-in-10 baseline, pays `min(delivered, pledged) * price` |
| `withdraw_unspent` | Buyer reclaims undelivered budget after settlement closes |

Money is escrowed at `open_event` and released only against a verified reduction. There is
no trusted settlement operator anywhere in the path.

### 2. Dispatch agent (TypeScript / Node 24)

Live inputs, both **public, free, unauthenticated** (verified 2026-07-22):

- `api.octopus.energy/v1/products/AGILE-24-10-01/.../standard-unit-rates/`
  → real half-hourly UK electricity prices
- `api.carbonintensity.org.uk/intensity`
  → real grid carbon intensity

The agent:
1. Polls real prices + carbon intensity.
2. Runs an appliance thermal model to find what can be shed without breaching comfort.
3. Decides what to curtail and how much to pledge — **deterministically**, in integer
   arithmetic over those inputs.
4. Uses an LLM to **explain** that decision in plain language.
5. Signs and submits `pledge` / `settle` transactions to Casper Testnet.

The agentic decision is genuine, not decorative: shedding a water heater at 17:30 is only
correct if the tank stays above the user's floor temperature until the next reheat, and
that depends on price forecast, ambient temp, and usage pattern.

**The decision is not made by the model.** Curtailment spends money and forfeits payment
on error, so it must be reproducible and auditable — `planDispatch` computes it and
`explain` only phrases the result. If no API key is set or the call fails, the agent
falls back to the planner's own rationale, so the explanation is always available and
nothing the model returns ever feeds back into a transaction.

### 3. Meter adapter (the honesty layer)

No smart plug in this build. So the meter is an interface with two implementations:

- `SimulatedMeter` — physics-based appliance models (thermal mass, standing loss, duty
  cycle). This is what the submission runs on.
- Real hardware would be a second implementation of the same `Meter` interface — a local
  HTTP adapter for Shelly/Tasmota plugs. **Not built for this submission.** The interface
  is the seam; nothing above it knows which implementation is underneath.

**The README states plainly: prices and carbon intensity are live and real; household load
is simulated.** We do not claim hardware we do not have. The adapter boundary is what
makes the claim "this drops onto real hardware" credible rather than hand-waving.

## What we are NOT building

Scope discipline — every one of these is a tempting rabbit hole that loses us the deadline:

- No aggregator marketplace / multi-buyer order book
- No token. Settlement is in native CSPR.
- No reputation scoring system (crowded field; adds nothing to the core claim)
- No mobile app
- No real grid-operator integration (we are the buyer in the demo, and we say so)

## Demo narrative (3 minutes)

1. Real Agile price feed shows tonight's 17:30 peak at ~27p/kWh.
2. Buyer opens a dispatch event on Casper, escrowing CSPR. → explorer link
3. Agent commits the household's baseline hash. → explorer link
4. Agent reasons aloud: which loads, how long, comfort impact, expected earnings.
5. Window runs. Load visibly drops against baseline.
6. Agent settles. Contract recomputes the baseline on-chain and pays. → explorer link
7. Recompute the payout by hand from on-chain data. It matches.

Step 7 is the point. Nothing is taken on trust.
