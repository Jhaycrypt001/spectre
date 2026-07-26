# Spectre

**A verifiable market for household demand reduction, settled on Casper.**

> ### In 30 seconds
>
> Grid operators pay households to *use less* power during peak windows. Today that market
> is locked to big aggregators because verifying and paying one home costs more than the
> payment. **Spectre** replaces the aggregator with an **autonomous agent** + a **Casper
> smart contract**: the agent picks what to curtail against live grid prices, the home
> commits a sealed baseline, and the **contract itself** recomputes the reduction and pays
> the home — every payout independently recomputable from chain data.
>
> | | |
> |---|---|
> | 🌐 **Live dashboard** | <https://spectre-wine-phi.vercel.app/dashboard> |
> | ⛓️ **Live contract** | [`fcec0112…af38`](https://testnet.cspr.live/contract/fcec0112055f7606cba2755c72d0461ca30aa82a7c6ba740255a32eb7e60af38) · Casper testnet |
> | 📖 **Docs** | [`docs/index.html`](docs/index.html) — open in a browser, or [read online](https://claude.ai/code/artifact/7690a5f9-6e1c-48b0-b552-c7e59e2ad0e3) |
> | 🧩 **Three parts** | `contracts/` Odra/Rust · `agent/` TypeScript dispatch agent · `web/` Next.js dashboard |
> | ✅ **Verify it yourself** | Baseline **2,996 Wh** − actual **1,033** = delivered **1,963 Wh** × **2 CSPR/kWh** = **3.926 CSPR** paid — the exact numbers on the live contract |
>
> **The one hard idea:** you can't meter power that was *never used*, so payment rests on a
> baseline the home could cheat. Spectre defeats that with **commit-reveal on chain** — the
> home seals its baseline hash *before* the window opens and can't revise history.

Grid operators pay for demand *reduction* — a negawatt. It is a real, regulated market,
and households are locked out of it. Not for technical reasons: a single home's
contribution to a dispatch window is worth roughly £0.20–£1.50, and the cost to verify,
settle, and pay that exceeds the payment. Aggregators solve this by bundling thousands of
homes under a manual contract, which means opaque revenue splits and no way for anyone to
audit what they were owed.

Spectre removes the trusted middleman. An autonomous agent decides what to curtail, and
the **contract itself** computes the reduction and pays the household directly. Every
payout is recomputable from chain data by anyone.

- **Live dashboard:** <https://spectre-wine-phi.vercel.app/dashboard> — reads the live contract, every figure decoded from an emitted event
- **Live contract:** [`fcec0112…e7e60af38`](https://testnet.cspr.live/contract/fcec0112055f7606cba2755c72d0461ca30aa82a7c6ba740255a32eb7e60af38) on Casper testnet

## The hard part: proving a negawatt

You cannot meter energy that was not consumed, so payment rests on a **baseline** — an
estimate of what the site *would* have drawn. That estimate is the attack surface. A home
that knows the formula can inflate its baseline on ordinary days, then "reduce" to normal
during an event and be paid for nothing. This is the central fraud in demand response, and
the reason the market is gated to trusted parties.

The defence is commit-reveal, enforced on chain:

1. The home hashes its baseline intervals and commits the hash **before** any dispatch
   window opens. The numbers stay private and can no longer be changed.
2. At settlement the intervals are revealed; the contract rehashes them and rejects any
   mismatch.
3. The contract — not an aggregator, not the agent — recomputes the CAISO 10-in-10
   baseline, applies the day-of adjustment within a ±20% clamp, subtracts metered actual
   use, and pays `delivered × price`.

The home cannot revise history, the buyer cannot shave the payout, and a third party can
recompute the whole settlement from chain data alone.

## A settlement that actually happened

Event `evt-mrzav0zg`, decoded from the contract's own event log:

| Step                      | Value       |
| ------------------------- | ----------- |
| Unadjusted baseline       | 3,745 Wh    |
| Adjusted (−20%, clamped)  | 2,996 Wh    |
| Metered actual            | 1,033 Wh    |
| **Delivered**             | **1,963 Wh** |
| Pledged (payment ceiling) | 2,700 Wh    |
| Price                     | 2 CSPR/kWh  |
| **Paid**                  | **3.926 CSPR** |
| Refunded to buyer         | 6.074 CSPR  |

Check it yourself: 2,996 − 1,033 = 1,963 Wh = 1.963 kWh × 2 CSPR = **3.926 CSPR**, and
10 − 3.926 = 6.074 CSPR returned. Nothing is taken on trust.

## Repository

| Path                        | What it is                                                     |
| --------------------------- | -------------------------------------------------------------- |
| `contracts/spectre-market` | The Odra contract — market, baseline, settlement (33 tests)      |
| `agent/`                    | Dispatch agent: live feeds, planner, explanation, chain client   |
| `web/`                      | Landing page and live dashboard (Next.js)                        |
| `ARCHITECTURE.md`           | The design, the trust model, and what is deliberately out of scope |

## Running it

**Contract**

```bash
cd contracts/spectre-market
cargo odra test              # 33 tests
cargo odra build   # wasm
```

**Agent** — needs a Casper testnet key at `keys/testnet_secret_key.pem`
(see `agent/.env.example`; every other value has a working default).

```bash
cd agent
npm install
npm run feeds                # live Octopus Agile prices + grid carbon intensity
npm run plan                 # what the planner decides, and why
npm test
npm run dispatch             # full lifecycle against Casper testnet
```

**Web**

```bash
cd web
npm install
npm run dev                  # http://localhost:3000
```

## What is real, and what is simulated

Stated plainly, because the distinction matters:

- **Real:** the contract and every settlement it has performed on Casper testnet; the
  Octopus Agile price feed; the National Grid carbon intensity feed; the agent's
  transactions and the arithmetic behind every payout.
- **Simulated:** household load. There is no smart plug in this build. `SimulatedMeter`
  uses physics-based appliance models (thermal mass, standing loss, duty cycle) behind a
  `Meter` interface, so real hardware is a second implementation of that interface rather
  than a rewrite.

The agent's *decision* is deterministic — integer arithmetic over live prices and a
thermal constraint — because it spends money and forfeits payment on error. A language
model is used only to explain that decision in plain language, and if it is unavailable
the agent falls back to its own rationale. Nothing the model returns feeds into a
transaction.

## Out of scope

No aggregator order book, no token (settlement is native CSPR), no reputation system, no
mobile app, and no real grid-operator integration — we are the buyer in this demo, and we
say so.

---

Built for the Casper Agentic Buildathon 2026.
