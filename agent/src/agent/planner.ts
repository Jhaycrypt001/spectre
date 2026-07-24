/**
 * Dispatch planner.
 *
 * Decides whether to curtail, which intervals, and how much to pledge.
 *
 * # Why this is deterministic
 *
 * The decision is arithmetic over live prices, carbon intensity, and a thermal
 * constraint. Handing that to a language model would make the outcome
 * non-reproducible and would risk pledging a quantity the household cannot
 * physically deliver — which on this protocol means forfeiting the payment.
 *
 * So the *decision* is deterministic and auditable, and the LLM's job is to explain
 * it in human terms and to handle the genuinely open-ended parts (weighing user
 * preferences, summarising tradeoffs). That split is deliberate: an agent that
 * cannot explain itself is unusable, but an agent whose spending decisions are
 * a sampled token stream is unsafe.
 */

import { type PriceSlot, slotAt } from "../feeds/octopus.js";
import { type CarbonReading, intensityAt } from "../feeds/carbon.js";
import { SimulatedMeter } from "../meter/simulated.js";
import { INTERVALS_PER_DAY, intervalLabel } from "../meter/types.js";

/** Household preferences that shape the tradeoff. */
export interface DispatchPolicy {
  /**
   * Minimum price premium over the day's median that justifies curtailment.
   * Prevents the agent from shedding load for trivial gain.
   */
  readonly minPremiumRatio: number;
  /** Never curtail for longer than this many consecutive intervals. */
  readonly maxConsecutiveIntervals: number;
  /** Minimum expected earnings to bother dispatching, in pence. */
  readonly minEarningsPence: number;
  /** Safety margin above the tank's comfort floor, in Celsius. */
  readonly comfortMarginC: number;
}

export const DEFAULT_POLICY: DispatchPolicy = {
  minPremiumRatio: 1.3,
  maxConsecutiveIntervals: 4,
  minEarningsPence: 20,
  comfortMarginC: 1.0,
};

export interface DispatchPlan {
  readonly shouldDispatch: boolean;
  /** Settlement interval indices to curtail. */
  readonly intervals: number[];
  /** Watt-hours the agent commits to deliver. */
  readonly pledgeWh: number;
  /** Expected earnings in pence at the prevailing price. */
  readonly expectedPence: number;
  /** Expected carbon avoided, in grams. */
  readonly expectedGramsCo2: number;
  /** Mean price across the chosen window, p/kWh. */
  readonly meanPencePerKwh: number;
  /** Projected tank low point if the plan runs, in Celsius. */
  readonly projectedTankLowC: number;
  /** Ordered, human-readable account of how the decision was reached. */
  readonly rationale: string[];
}

/** Median of a numeric array. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

/**
 * Map today's price slots onto settlement interval indices.
 * Returns a sparse array of length INTERVALS_PER_DAY.
 */
function pricesByInterval(
  slots: readonly PriceSlot[],
  reference: Date,
): Array<number | undefined> {
  const out = new Array<number | undefined>(INTERVALS_PER_DAY).fill(undefined);
  const dayStart = new Date(reference);
  dayStart.setHours(0, 0, 0, 0);

  for (let i = 0; i < INTERVALS_PER_DAY; i++) {
    const at = new Date(dayStart.getTime() + i * 30 * 60_000);
    const slot = slotAt(slots, at);
    if (slot) out[i] = slot.pencePerKwh;
  }
  return out;
}

/**
 * Find the best contiguous run of intervals to curtail.
 *
 * Considers every run up to the policy maximum, scores it by expected earnings,
 * and rejects any run the meter refuses on comfort grounds.
 */
export async function planDispatch(
  meter: SimulatedMeter,
  prices: readonly PriceSlot[],
  carbon: readonly CarbonReading[],
  now: Date = new Date(),
  policy: DispatchPolicy = DEFAULT_POLICY,
): Promise<DispatchPlan> {
  const rationale: string[] = [];

  const byInterval = pricesByInterval(prices, now);
  const known = byInterval.filter((p): p is number => p !== undefined);

  if (known.length === 0) {
    return {
      shouldDispatch: false,
      intervals: [],
      pledgeWh: 0,
      expectedPence: 0,
      expectedGramsCo2: 0,
      meanPencePerKwh: 0,
      projectedTankLowC: 0,
      rationale: ["No price data available for today; cannot evaluate dispatch."],
    };
  }

  const dayMedian = median(known);
  rationale.push(
    `Today's median unit rate is ${dayMedian.toFixed(2)} p/kWh across ` +
      `${known.length} published half-hours.`,
  );

  const loads = meter.listFlexibleLoads();
  const heater = loads[0];
  if (!heater) {
    return {
      shouldDispatch: false,
      intervals: [],
      pledgeWh: 0,
      expectedPence: 0,
      expectedGramsCo2: 0,
      meanPencePerKwh: 0,
      projectedTankLowC: 0,
      rationale: [...rationale, "No flexible load registered on this meter."],
    };
  }

  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  interface Candidate {
    intervals: number[];
    meanPrice: number;
    reductionWh: number;
    pence: number;
    grams: number;
    tankLowC: number;
  }

  const candidates: Candidate[] = [];

  // Only consider windows that have not already started.
  const firstFuture = Math.max(
    0,
    Math.ceil((now.getTime() - dayStart.getTime()) / (30 * 60_000)),
  );

  const normal = meter.simulateDay(0);

  for (let start = firstFuture; start < INTERVALS_PER_DAY; start++) {
    for (let len = 1; len <= policy.maxConsecutiveIntervals; len++) {
      const end = start + len - 1;
      if (end >= INTERVALS_PER_DAY) break;

      const window: number[] = [];
      let priced = true;
      for (let i = start; i <= end; i++) {
        if (byInterval[i] === undefined) {
          priced = false;
          break;
        }
        window.push(i);
      }
      if (!priced) continue;

      const meanPrice =
        window.reduce((sum, i) => sum + (byInterval[i] ?? 0), 0) / window.length;

      // Reject windows that are not meaningfully expensive.
      if (meanPrice < dayMedian * policy.minPremiumRatio) continue;

      // Simulate the curtailment to find the real reduction and comfort impact.
      const curtailedSet = new Set(window);
      const curtailed = meter.simulateDay(0, curtailedSet);

      const reductionWh = window.reduce(
        (sum, i) => sum + ((normal.intervalsWh[i] ?? 0) - (curtailed.intervalsWh[i] ?? 0)),
        0,
      );
      if (reductionWh <= 0) continue;

      const tankLowC = meter.projectTankLow(curtailedSet, start);
      if (tankLowC < meter.comfortFloorC + policy.comfortMarginC) continue;

      const pence = (reductionWh / 1000) * meanPrice;

      const at = new Date(dayStart.getTime() + start * 30 * 60_000);
      const intensity = intensityAt(carbon, at);
      const grams = intensity ? (reductionWh / 1000) * intensity.forecastGco2PerKwh : 0;

      candidates.push({
        intervals: window,
        meanPrice,
        reductionWh,
        pence,
        grams,
        tankLowC,
      });
    }
  }

  if (candidates.length === 0) {
    rationale.push(
      "No window clears the policy: either no half-hour is expensive enough, " +
        "or every candidate would push the tank below the comfort floor.",
    );
    return {
      shouldDispatch: false,
      intervals: [],
      pledgeWh: 0,
      expectedPence: 0,
      expectedGramsCo2: 0,
      meanPencePerKwh: 0,
      projectedTankLowC: 0,
      rationale,
    };
  }

  // Rank by earnings; carbon breaks ties.
  candidates.sort((a, b) => b.pence - a.pence || b.grams - a.grams);
  const best = candidates[0]!;

  rationale.push(
    `Evaluated ${candidates.length} feasible windows; best is ` +
      `${intervalLabel(best.intervals[0]!)} to ` +
      `${intervalLabel(best.intervals[best.intervals.length - 1]!)} at ` +
      `${best.meanPrice.toFixed(2)} p/kWh ` +
      `(${(best.meanPrice / dayMedian).toFixed(2)}x the daily median).`,
  );

  rationale.push(
    `Curtailing ${heater.label} across that window avoids ` +
      `${(best.reductionWh / 1000).toFixed(2)} kWh, worth ` +
      `£${(best.pence / 100).toFixed(2)} and ` +
      `${(best.grams / 1000).toFixed(2)} kg CO2.`,
  );

  rationale.push(
    `Tank is projected to bottom out at ${best.tankLowC.toFixed(1)}C, ` +
      `above the ${meter.comfortFloorC}C comfort floor ` +
      `(margin ${(best.tankLowC - meter.comfortFloorC).toFixed(1)}C).`,
  );

  if (best.pence < policy.minEarningsPence) {
    rationale.push(
      `Expected earnings of ${best.pence.toFixed(1)}p fall below the ` +
        `${policy.minEarningsPence}p threshold; not worth dispatching.`,
    );
    return {
      shouldDispatch: false,
      intervals: [],
      pledgeWh: 0,
      expectedPence: best.pence,
      expectedGramsCo2: best.grams,
      meanPencePerKwh: best.meanPrice,
      projectedTankLowC: best.tankLowC,
      rationale,
    };
  }

  // Pledge conservatively. Delivering less than pledged forfeits the shortfall,
  // and the baseline carries genuine estimation error, so we commit to 90% of
  // the simulated reduction rather than all of it.
  const pledgeWh = Math.floor(best.reductionWh * 0.9);

  rationale.push(
    `Pledging ${pledgeWh} Wh — 90% of the simulated reduction, leaving headroom ` +
      `for baseline estimation error, since under-delivery forfeits the shortfall.`,
  );

  return {
    shouldDispatch: true,
    intervals: best.intervals,
    pledgeWh,
    expectedPence: best.pence,
    expectedGramsCo2: best.grams,
    meanPencePerKwh: best.meanPrice,
    projectedTankLowC: best.tankLowC,
    rationale,
  };
}
