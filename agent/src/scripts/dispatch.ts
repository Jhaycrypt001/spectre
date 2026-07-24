/**
 * End-to-end dispatch run against the deployed contract.
 *
 * Drives one complete market cycle on Casper testnet:
 *
 *   register_asset -> commit_baseline -> open_event -> pledge -> settle -> withdraw
 *
 * Every step is a real transaction paid for with real testnet CSPR, and every step
 * is verified by reading back what the contract published rather than by trusting
 * the local record of what was sent.
 *
 * # Ordering constraints this script has to respect
 *
 * The contract enforces a strict lifecycle, and two rules interact awkwardly with
 * wall-clock time:
 *
 * * `pledge` requires `now <= pledge_deadline`
 * * `settle` requires `now >  pledge_deadline`
 *
 * So the deadline must be far enough ahead that the pledge transaction lands before
 * it, and near enough that the run does not idle for minutes waiting to settle. It
 * is set from block time (not host time) because the contract compares against block
 * time, and the two differ.
 *
 * Additionally `commit_baseline` must land strictly before the deadline it will be
 * judged against — `pledge` reverts with `BaselineCommittedTooLate` otherwise. That
 * is the anti-gaming property, so the script does not work around it; it commits
 * first and opens the event afterwards, which is the honest ordering a real
 * household agent would follow.
 *
 * Run: npm run dispatch
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig, transactionUrl, contractUrl } from "../chain/config.js";
import { SpectreClient } from "../chain/client.js";
import { computeCommitment, toHex } from "../chain/commitment.js";
import { formatEvent } from "../chain/events.js";
import { SimulatedMeter } from "../meter/simulated.js";
import { planDispatch, DEFAULT_POLICY } from "../agent/planner.js";
import { explainPlan } from "../agent/explain.js";
import { fetchAgilePrices } from "../feeds/octopus.js";
import { fetchIntensityForecast } from "../feeds/carbon.js";
import { intervalLabel } from "../meter/types.js";
import type { DeploymentRecord } from "./install.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOYMENT_PATH = resolve(HERE, "../../deployment.json");

/** The 10-in-10 baseline requires exactly this many historical days. */
const BASELINE_DAYS = 10;

/**
 * Width of the pre-event observation window, in intervals.
 *
 * The day-of adjustment is computed from the intervals immediately before dispatch.
 * It mirrors the dispatch window's width in CAISO practice; here it is fixed at the
 * policy maximum so the adjustment always sees a full window regardless of how many
 * intervals the planner ends up selecting.
 */
const ADJ_WINDOW_WIDTH = DEFAULT_POLICY.maxConsecutiveIntervals;

/**
 * Price the buyer pays per kWh avoided, in motes. 2 CSPR/kWh.
 *
 * On testnet the figure is nominal. What matters is that the payout the contract
 * computes from it matches what this script predicts independently.
 */
const PRICE_PER_KWH_MOTES = 2_000_000_000n;

/** Escrowed budget for the event, in motes. 10 CSPR. */
const BUDGET_MOTES = 10_000_000_000n;

/**
 * Seconds after the current block time at which pledging closes.
 *
 * Testnet blocks are ~16s, so this allows roughly three blocks for the pledge to
 * land while keeping the settle wait short.
 */
const PLEDGE_WINDOW_SECONDS = 90;

/**
 * Seconds after the pledge deadline during which pledgers may settle before the
 * buyer can reclaim the budget.
 *
 * The contract enforces that the buyer cannot withdraw unspent budget until this
 * window has closed, so an honest pledger who delivered always has a bounded, on-
 * chain-guaranteed window to settle. In production this would be hours; this run
 * both settles and withdraws in one pass, so it is kept short enough to wait out —
 * long enough only to still demonstrate that withdraw is gated on it.
 */
const SETTLEMENT_WINDOW_SECONDS = 45;

const sum = (values: readonly number[]): bigint =>
  values.reduce((total, value) => total + BigInt(Math.round(value)), 0n);

/** Total watt-hours drawn across an inclusive interval range. */
function windowTotal(
  intervalsWh: readonly number[],
  from: number,
  to: number,
): bigint {
  return sum(intervalsWh.slice(from, to + 1));
}

/** Mean, rounded to nearest — matching `baseline::mean_round` on-chain. */
function meanRound(values: readonly bigint[]): bigint {
  if (values.length === 0) return 0n;
  const total = values.reduce((a, b) => a + b, 0n);
  const n = BigInt(values.length);
  return (total + n / 2n) / n;
}

const BPS_DENOMINATOR = 10_000n;
const MAX_ADJUSTMENT_BPS = 2_000n;

/**
 * Predict the settlement the contract will compute.
 *
 * This mirrors `contracts/spectre-market/src/baseline.rs` exactly, in integer
 * arithmetic. It exists so the run can assert that the on-chain result equals the
 * independently computed one — which is the whole auditability claim, tested rather
 * than asserted.
 */
function predictSettlement(
  historyWindow: readonly bigint[],
  historyAdjWindow: readonly bigint[],
  actualAdjWindow: bigint,
  actualWindow: bigint,
  pledgedWh: bigint,
): {
  unadjustedWh: bigint;
  adjustedWh: bigint;
  adjustmentBps: bigint;
  clamped: boolean;
  deliveredWh: bigint;
  paidMotes: bigint;
} {
  const unadjustedWh = meanRound(historyWindow);
  const adjBaseline = meanRound(historyAdjWindow);

  let adjustmentBps = 0n;
  let clamped = false;

  if (adjBaseline !== 0n) {
    const raw = ((actualAdjWindow - adjBaseline) * BPS_DENOMINATOR) / adjBaseline;
    clamped = raw > MAX_ADJUSTMENT_BPS || raw < -MAX_ADJUSTMENT_BPS;
    adjustmentBps =
      raw > MAX_ADJUSTMENT_BPS
        ? MAX_ADJUSTMENT_BPS
        : raw < -MAX_ADJUSTMENT_BPS
          ? -MAX_ADJUSTMENT_BPS
          : raw;
  }

  const scaled =
    (unadjustedWh * (BPS_DENOMINATOR + adjustmentBps)) / BPS_DENOMINATOR;
  const adjustedWh = scaled < 0n ? 0n : scaled;

  const reduction = adjustedWh > actualWindow ? adjustedWh - actualWindow : 0n;
  const deliveredWh = reduction < pledgedWh ? reduction : pledgedWh;
  const paidMotes = (PRICE_PER_KWH_MOTES * deliveredWh) / 1_000n;

  return {
    unadjustedWh,
    adjustedWh,
    adjustmentBps,
    clamped,
    deliveredWh,
    paidMotes,
  };
}

const cspr = (motes: bigint): string => `${(Number(motes) / 1e9).toFixed(4)} CSPR`;

function loadDeployment(): DeploymentRecord {
  try {
    return JSON.parse(readFileSync(DEPLOYMENT_PATH, "utf8")) as DeploymentRecord;
  } catch {
    throw new Error(
      `No deployment record at ${DEPLOYMENT_PATH}. ` +
        `Run \`npm run install:contract\` (or \`npm run resolve\`) first.`,
    );
  }
}

async function main(): Promise<void> {
  console.log("Spectre — end-to-end dispatch run\n");

  const config = loadConfig();
  const deployment = loadDeployment();
  const client = new SpectreClient(
    config,
    deployment.contractHash,
    deployment.packageHash,
  );

  console.log(`  contract : ${deployment.contractHash}`);
  console.log(`  explorer : ${contractUrl(config, deployment.contractHash)}`);
  console.log(`  operator : ${client.publicKey.toHex()}`);

  const openingBalance = await client.balance();
  console.log(`  balance  : ${cspr(openingBalance)}\n`);

  // Unique per run so repeated runs never collide with existing on-chain ids.
  const runId = Date.now().toString(36);
  const assetId = `site-${runId}`;
  const eventId = `evt-${runId}`;

  const meter = new SimulatedMeter(assetId);

  // --- Plan the dispatch from live market data ------------------------------
  //
  // The window is not hardcoded: the planner reads live Octopus Agile prices and
  // National Grid carbon intensity, ranks every feasible curtailment window by
  // earnings, and rejects any that would breach the tank's comfort floor. What it
  // returns is the window this run commits to on-chain — the autonomous decision
  // that the rest of the cycle then proves was honoured.

  console.log("Planning dispatch from live feeds (Octopus Agile + carbon intensity)");

  // Prices drive the decision, so a price-feed outage is fatal. Carbon only refines
  // the tie-break and the CO2 estimate, so its outage degrades to a zero-carbon plan
  // rather than blocking a profitable dispatch — the behaviour an autonomous agent
  // must have to keep earning when one non-critical upstream is down.
  const prices = await fetchAgilePrices();
  let carbon: Awaited<ReturnType<typeof fetchIntensityForecast>> = [];
  try {
    carbon = await fetchIntensityForecast();
  } catch (error) {
    console.log(
      `  carbon feed unavailable (${error instanceof Error ? error.message : error}); ` +
        `proceeding without CO2 estimates.`,
    );
  }
  console.log(`  prices : ${prices.length} half-hour slots`);
  console.log(`  carbon : ${carbon.length} forecast periods`);

  // Plan against the whole of today's published price curve. A household agent runs
  // this evaluation once for the day and commits to the best window it finds; the
  // reference time is anchored to local midnight so every half-hour in the day is a
  // candidate, not only those still ahead of the wall clock when the script happens
  // to be run. Settlement itself is interval-index driven, so the window the planner
  // returns flows straight through the cycle regardless of the current time of day.
  const planReference = new Date();
  planReference.setHours(0, 0, 0, 0);

  const plan = await planDispatch(meter, prices, carbon, planReference);
  for (const line of plan.rationale) console.log(`  · ${line}`);

  // Natural-language account of the decision, for the household. The planner made
  // the decision; this only phrases it, and falls back to the deterministic
  // rationale if no model is reachable, so it is always available.
  const explanation = await explainPlan(plan);
  console.log(`\n  Agent (${explanation.source}): ${explanation.text}`);
  if (explanation.fallbackReason) {
    console.log(`  (${explanation.fallbackReason})`);
  }

  if (!plan.shouldDispatch || plan.intervals.length === 0) {
    console.log(
      "\nPlanner declined to dispatch under current prices — no window clears the " +
        "policy. This is the correct outcome, not a failure: an honest agent does " +
        "not curtail when it would not pay. Re-run when peak prices are live.",
    );
    return;
  }

  const windowStart = plan.intervals[0]!;
  const windowEnd = plan.intervals[plan.intervals.length - 1]!;

  // The observation window is the ADJ_WINDOW_WIDTH intervals immediately before the
  // dispatch window. If the planner picks a window early enough that this underflows,
  // there is no valid pre-event window to measure the day-of adjustment against.
  const adjEnd = windowStart - 1;
  const adjStart = adjEnd - (ADJ_WINDOW_WIDTH - 1);
  if (adjStart < 0) {
    console.log(
      `\nPlanner selected an early window (starts at interval ${windowStart}); ` +
        `there are not ${ADJ_WINDOW_WIDTH} intervals before it to form the day-of ` +
        `observation window. Skipping this run.`,
    );
    return;
  }

  // --- Build the baseline from metered history ------------------------------

  const history = await meter.history(BASELINE_DAYS);

  const historyWindow = history.map((day) =>
    windowTotal(day.intervalsWh, windowStart, windowEnd),
  );
  const historyAdjWindow = history.map((day) =>
    windowTotal(day.intervalsWh, adjStart, adjEnd),
  );

  console.log("\nBaseline (10-in-10, from metered history)");
  console.log(
    `  dispatch window   : intervals ${windowStart}-${windowEnd} ` +
      `(${intervalLabel(windowStart)}–${intervalLabel(windowEnd)})`,
  );
  console.log(
    `  observation window: intervals ${adjStart}-${adjEnd} ` +
      `(${intervalLabel(adjStart)}–${intervalLabel(adjEnd)})`,
  );
  console.log(`  window per day    : ${historyWindow.join(", ")} Wh`);
  console.log(`  observed per day  : ${historyAdjWindow.join(", ")} Wh`);

  const commitment = computeCommitment(historyWindow, historyAdjWindow);
  console.log(`  commitment        : ${toHex(commitment)}`);

  const eventsBefore = await client.eventCount();

  // --- 1. Register the asset ------------------------------------------------

  const loads = meter.listFlexibleLoads();
  const maxCurtailableW = BigInt(loads[0]?.ratedWatts ?? 3_000);

  console.log("\n[1/6] register_asset");
  const registered = await client.registerAsset(assetId, maxCurtailableW);
  console.log(`  ok, block ${registered.blockHeight}, cost ${cspr(registered.costMotes)}`);
  console.log(`  ${registered.url}`);

  // --- 2. Commit the baseline, before any event exists ----------------------

  console.log("\n[2/6] commit_baseline");
  const committed = await client.commitBaseline(assetId, commitment);
  console.log(`  ok, block ${committed.blockHeight}, cost ${cspr(committed.costMotes)}`);
  console.log(`  ${committed.url}`);

  // --- 3. Open and fund the event -------------------------------------------

  // The deadline is derived from block time: the contract compares against block
  // time, and the host clock is known to drift from it.
  const blockTimeMs = await client.blockTimeMs();
  const pledgeDeadline = BigInt(blockTimeMs + PLEDGE_WINDOW_SECONDS * 1_000);
  const settlementDeadline =
    pledgeDeadline + BigInt(SETTLEMENT_WINDOW_SECONDS * 1_000);

  console.log("\n[3/6] open_event");
  console.log(`  budget    : ${cspr(BUDGET_MOTES)}`);
  console.log(`  price     : ${cspr(PRICE_PER_KWH_MOTES)}/kWh avoided`);
  console.log(`  pledge by : ${new Date(Number(pledgeDeadline)).toISOString()}`);
  console.log(`  settle by : ${new Date(Number(settlementDeadline)).toISOString()}`);

  const opened = await client.openEvent(
    eventId,
    windowStart,
    windowEnd,
    PRICE_PER_KWH_MOTES,
    BUDGET_MOTES,
    pledgeDeadline,
    settlementDeadline,
  );
  console.log(`  ok, block ${opened.blockHeight}, cost ${cspr(opened.costMotes)}`);
  console.log(`  ${opened.url}`);

  // --- 4. Curtail and pledge ------------------------------------------------

  // Curtail for real on the simulated site, then pledge what the physics says is
  // deliverable. Pledging more than this would forfeit the difference.
  const curtailed = new Set<number>(plan.intervals);

  const accepted = await meter.curtail("immersion-heater", windowStart, windowEnd);
  if (!accepted.accepted) {
    throw new Error(`Meter refused curtailment: ${accepted.reason}`);
  }

  const todayCurtailed = meter.simulateDay(0, curtailed);
  const todayNormal = meter.simulateDay(0);

  const actualWindow = windowTotal(todayCurtailed.intervalsWh, windowStart, windowEnd);
  const actualAdjWindow = windowTotal(todayCurtailed.intervalsWh, adjStart, adjEnd);
  const uncurtailedWindow = windowTotal(todayNormal.intervalsWh, windowStart, windowEnd);

  // The planner already chose how much to pledge — 90% of the simulated reduction,
  // leaving headroom for baseline estimation error, since under-delivery forfeits
  // the shortfall. Cap it at the physical delta as a belt-and-braces guard so a
  // planner/meter drift can never make the run pledge more than the site can shed.
  const physicalReduction =
    uncurtailedWindow > actualWindow ? uncurtailedWindow - actualWindow : 0n;
  const plannedPledge = BigInt(plan.pledgeWh);
  const pledgedWh = plannedPledge < physicalReduction ? plannedPledge : physicalReduction;

  console.log("\n[4/6] pledge");
  console.log(`  uncurtailed draw : ${uncurtailedWindow} Wh`);
  console.log(`  curtailed draw   : ${actualWindow} Wh`);
  console.log(`  physical delta   : ${physicalReduction} Wh`);
  console.log(`  planner pledge   : ${plannedPledge} Wh (£${(plan.expectedPence / 100).toFixed(2)} expected)`);
  console.log(`  tank low point   : ${meter.projectTankLow(curtailed).toFixed(1)}C ` +
    `(floor ${meter.comfortFloorC}C)`);

  if (pledgedWh === 0n) {
    throw new Error(
      "Curtailment produced no measurable reduction; nothing to pledge. " +
        "Check the simulator's thermostat band.",
    );
  }

  const pledged = await client.pledge(eventId, assetId, pledgedWh);
  console.log(`  pledged ${pledgedWh} Wh, block ${pledged.blockHeight}, cost ${cspr(pledged.costMotes)}`);
  console.log(`  ${pledged.url}`);

  // --- 5. Wait out the pledge window, then settle ---------------------------

  const predicted = predictSettlement(
    historyWindow,
    historyAdjWindow,
    actualAdjWindow,
    actualWindow,
    pledgedWh,
  );

  console.log("\n  predicted settlement (computed locally, from the same inputs)");
  console.log(`    unadjusted baseline : ${predicted.unadjustedWh} Wh`);
  console.log(`    day-of adjustment   : ${predicted.adjustmentBps} bps` +
    `${predicted.clamped ? " (clamped)" : ""}`);
  console.log(`    adjusted baseline   : ${predicted.adjustedWh} Wh`);
  console.log(`    actual draw         : ${actualWindow} Wh`);
  console.log(`    delivered           : ${predicted.deliveredWh} Wh`);
  console.log(`    payout              : ${cspr(predicted.paidMotes)}`);

  console.log("\n[5/6] settle");
  await client.waitForBlockTime(pledgeDeadline + 1_000n, "settle");

  const settled = await client.settle(
    eventId,
    assetId,
    historyWindow,
    historyAdjWindow,
    actualAdjWindow,
    actualWindow,
  );
  console.log(`  ok, block ${settled.blockHeight}, cost ${cspr(settled.costMotes)}`);
  console.log(`  ${settled.url}`);

  // --- 6. Close the event and reclaim unspent budget ------------------------

  // The contract will not let the buyer withdraw until the settlement window has
  // closed — the guard that stops a buyer reclaiming budget out from under a pledger
  // who has delivered. So the run waits it out, exactly as an honest buyer must.
  console.log("\n[6/6] withdraw_unspent");
  await client.waitForBlockTime(settlementDeadline + 1_000n, "withdraw");
  const withdrawn = await client.withdrawUnspent(eventId);
  console.log(`  ok, block ${withdrawn.blockHeight}, cost ${cspr(withdrawn.costMotes)}`);
  console.log(`  ${withdrawn.url}`);

  // --- Verify against what the contract published ---------------------------

  console.log("\nOn-chain event log");
  const emitted = await client.eventsSince(eventsBefore);
  for (const event of emitted) {
    console.log(`  ${formatEvent(event)}`);
  }

  const settlement = emitted.find((e) => e.kind === "Settled");
  if (!settlement || settlement.kind !== "Settled") {
    throw new Error("No Settled event was emitted; settlement did not take effect.");
  }

  console.log("\nVerification — contract result vs. independent computation");
  const checks: Array<[string, bigint | boolean, bigint | boolean]> = [
    ["unadjusted baseline", settlement.unadjustedBaselineWh, predicted.unadjustedWh],
    ["adjusted baseline", settlement.adjustedBaselineWh, predicted.adjustedWh],
    ["adjustment bps", BigInt(settlement.adjustmentBps), predicted.adjustmentBps],
    ["adjustment clamped", settlement.adjustmentClamped, predicted.clamped],
    ["actual draw", settlement.actualWh, actualWindow],
    ["delivered", settlement.deliveredWh, predicted.deliveredWh],
    ["paid", settlement.paidMotes, predicted.paidMotes],
  ];

  let mismatched = 0;
  for (const [label, onChain, local] of checks) {
    const agrees = onChain === local;
    if (!agrees) mismatched += 1;
    console.log(
      `  ${agrees ? "ok  " : "FAIL"} ${label.padEnd(20)} ` +
        `chain=${onChain} local=${local}`,
    );
  }

  const closingBalance = await client.balance();
  console.log(`\n  opening balance : ${cspr(openingBalance)}`);
  console.log(`  closing balance : ${cspr(closingBalance)}`);
  console.log(`  net             : ${cspr(closingBalance - openingBalance)}`);
  console.log(
    "\n  (This account is both buyer and household, so the payout returns to it;\n" +
      "   the net figure is gas. In production these are different accounts.)",
  );

  if (mismatched > 0) {
    throw new Error(
      `${mismatched} settlement field(s) disagreed with the independent computation.`,
    );
  }

  console.log("\nDispatch cycle complete. Every published value reproduced exactly.");
  console.log(`\nTransaction proofs:`);
  for (const [label, tx] of [
    ["register_asset ", registered],
    ["commit_baseline", committed],
    ["open_event     ", opened],
    ["pledge         ", pledged],
    ["settle         ", settled],
    ["withdraw       ", withdrawn],
  ] as const) {
    console.log(`  ${label} ${transactionUrl(config, tx.hash)}`);
  }
}

main().catch((error: unknown) => {
  console.error(`\nDispatch failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
