# Spectre — 3-Minute Demo Script

**Casper Agentic Buildathon 2026**
Live site: <https://spectre-wine-phi.vercel.app> · Contract `fcec0112…e7e60af38` on Casper testnet

> Total runtime target: **3:00**. Times are cumulative. Read the **[SAY]** lines aloud;
> the **[SHOW]** lines are what's on screen. Practice once so the settlement walkthrough
> lands inside the clock — that's the part judges remember.

---

## 0:00 – 0:25 · The hook (landing hero)

**[SHOW]** Landing page hero at <https://spectre-wine-phi.vercel.app>. Let the "Live on
Casper testnet" badge be visible.

**[SAY]**
> "Grid operators pay real money for demand *reduction* — a negawatt. It's a regulated
> market worth billions, and households are completely locked out of it. Not for technical
> reasons — because a single home's contribution is worth maybe twenty pence to a pound,
> and the cost to verify and pay that exceeds the payment itself. So aggregators bundle
> thousands of homes under opaque manual contracts. Spectre removes that middleman
> entirely. An autonomous agent decides what to curtail, and **the contract itself**
> computes the reduction and pays the household — every payout recomputable by anyone from
> chain data."

---

## 0:25 – 0:45 · The hard problem (scroll to mechanism)

**[SHOW]** Scroll to the "proving a negawatt" / mechanism section.

**[SAY]**
> "The hard part is proving energy that was *never consumed*. Payment rests on a baseline —
> what the home *would* have drawn. That's the attack surface: a home that knows the formula
> can inflate its baseline, then 'reduce' to normal and get paid for nothing. Spectre's
> defence is commit-reveal, enforced on chain: the home commits a hash of its baseline
> **before** any dispatch window opens, and the contract re-hashes at settlement. History
> can't be revised."

---

## 0:45 – 1:15 · The agent runs (terminal)

**[SHOW]** Terminal. Run the agent's dispatch cycle (or play a pre-recorded run). The six
transaction proofs should scroll by, ending with "Every published value reproduced exactly."

**[SAY]**
> "Here's the autonomous agent running a full cycle against Casper testnet. It pulls live
> grid prices, picks the best dispatch window — here, 17:30 to 19:30 at 2 CSPR per
> kilowatt-hour — registers the home, takes its sealed baseline commitment, opens the
> window, the home pledges a reduction, and the agent settles. Six real transactions. Watch
> the last line: **every value the agent published, it re-derived independently from chain
> and it matched exactly.** No trust in the agent required."

> *(If pre-recorded: "This is a recorded run so we stay on the clock — the transactions are
> real and on the explorer.")*

---

## 1:15 – 2:15 · The proof — settlement math (dashboard) ★ the centrepiece

**[SHOW]** Open <https://spectre-wine-phi.vercel.app/dashboard>. Point at the live pulse:
"Live from Casper testnet · 6 events." Then the contract strip, then scroll to the
**Settlement math** block for the settled window.

**[SAY]**
> "This dashboard is reading the deployed contract live — six events, right now, no backend
> database. Every number is decoded from an event the contract emitted. Here's the money
> shot: the settlement, step by step."

**[SHOW]** Walk down the settlement math rows one at a time as you speak.

**[SAY]**
> "The contract recomputed this home's baseline from its revealed history — **3,745 watt-
> hours**. It applied the day-of grid adjustment, clamped to the ±20% cap the contract
> enforces — **2,996**. It subtracts the metered actual consumption — **1,033**. That
> leaves a **delivered reduction of 1,963 watt-hours**. Times the price, 2 CSPR per
> kilowatt-hour, and the home is paid **3.926 CSPR** — settled on Casper. Not a number the
> operator chose. `delivered × price`, and delivered is `baseline − actual`. Anyone can
> recompute this from this one event."

**[SHOW]** Click the contract link in the strip → the Casper testnet explorer opens on the
real contract.

**[SAY]**
> "And it's not a mock — there's the contract on the public explorer. The dashboard and the
> chain agree because the dashboard reuses the agent's exact decoder as the single source of
> truth."

---

## 2:15 – 2:45 · Why it matters (receipts + participants)

**[SHOW]** Scroll to Participants + Receipts (the raw event log) on the dashboard.

**[SAY]**
> "Underneath is the full receipt log — every registration, commitment, pledge and
> settlement the contract emitted, in order. The home can't revise history, the buyer can't
> shave the payout, and a third party can reconstruct the entire settlement from chain data
> alone. That's the thing aggregators can't offer: a market a household can actually audit."

---

## 2:45 – 3:00 · Close

**[SHOW]** Back to the landing hero, or a title card with the URL and contract hash.

**[SAY]**
> "Spectre — a verifiable market for household demand reduction, live on Casper. Autonomous
> dispatch, on-chain settlement, every payout provable. Thanks for watching."

**[SHOW]** On-screen text:
> `spectre-wine-phi.vercel.app` · contract `fcec0112…e7e60af38` · Casper testnet

---

## Shot list / prep checklist

- [ ] **Pre-load** the dashboard before recording so `/api/market` is warm (first hit can be
      a second slow). Hit it once, then refresh on camera.
- [ ] Record the terminal run **beforehand** — a live settle can hit testnet latency and blow
      the clock. Real transactions, just pre-captured.
- [ ] Have the **explorer contract page** already open in a second tab to cut to.
- [ ] Do the whole thing in **one browser window** so there's no horizontal scroll on the
      dashboard (already guarded, but keep the window ≥ 900px wide for the demo).
- [ ] Numbers to say out loud, verbatim from the live contract:
      **3,745 → 2,996 → 1,033 → 1,963 Wh → 3.926 CSPR**, window **17:30–19:30**, price **2
      CSPR/kWh**.
- [ ] If any number on your live dashboard differs at record time (a new cycle was run),
      **read the numbers off the screen** — the script's job is the structure, the chain is
      the source of truth.

## Timing cheatsheet

| Segment | Ends at | Beat |
|---|---|---|
| Hook | 0:25 | The locked-out market |
| Hard problem | 0:45 | Proving a negawatt / commit-reveal |
| Agent runs | 1:15 | 6 real transactions, self-verified |
| Settlement math | 2:15 | ★ baseline → payout, live |
| Why it matters | 2:45 | Auditable receipts |
| Close | 3:00 | URL + contract card |
