/**
 * Planner tests.
 *
 * These use synthetic price curves rather than live data, so the decision logic is
 * pinned regardless of what the real market is doing on any given day.
 *
 * Run: npm test
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { planDispatch, DEFAULT_POLICY, type DispatchPolicy } from "./planner.js";
import { SimulatedMeter } from "../meter/simulated.js";
import type { PriceSlot } from "../feeds/octopus.js";
import type { CarbonReading } from "../feeds/carbon.js";

const DAY_START = new Date("2026-07-22T00:00:00Z");

/** Build 48 half-hourly price slots from a per-interval pence array. */
function slots(pence: (index: number) => number): PriceSlot[] {
  return Array.from({ length: 48 }, (_, i) => ({
    from: new Date(DAY_START.getTime() + i * 30 * 60_000),
    to: new Date(DAY_START.getTime() + (i + 1) * 30 * 60_000),
    pencePerKwh: pence(i),
  }));
}

/** Flat carbon intensity across the day. */
function carbon(gco2: number): CarbonReading[] {
  return Array.from({ length: 48 }, (_, i) => ({
    from: new Date(DAY_START.getTime() + i * 30 * 60_000),
    to: new Date(DAY_START.getTime() + (i + 1) * 30 * 60_000),
    forecastGco2PerKwh: gco2,
    actualGco2PerKwh: null,
    index: "moderate" as const,
  }));
}

describe("planDispatch", () => {
  it("declines when prices are flat", async () => {
    const meter = new SimulatedMeter("test");
    const plan = await planDispatch(meter, slots(() => 20), carbon(150), DAY_START);

    assert.equal(plan.shouldDispatch, false);
    assert.equal(plan.intervals.length, 0);
    assert.ok(
      plan.rationale.some((line) => line.includes("No window clears the policy")),
      "should explain why it declined",
    );
  });

  it("dispatches into a clear evening peak", async () => {
    const meter = new SimulatedMeter("test");
    // Evening peak at 4x the base rate.
    const plan = await planDispatch(
      meter,
      slots((i) => (i >= 34 && i <= 40 ? 80 : 20)),
      carbon(150),
      DAY_START,
    );

    assert.equal(plan.shouldDispatch, true);
    assert.ok(plan.intervals.length > 0);
    // Every chosen interval must fall inside the expensive band.
    for (const i of plan.intervals) {
      assert.ok(i >= 34 && i <= 40, `interval ${i} is outside the peak`);
    }
    assert.ok(plan.pledgeWh > 0);
    assert.ok(plan.expectedPence > 0);
  });

  it("never plans a window that breaches the comfort floor", async () => {
    const meter = new SimulatedMeter("test");
    // Price everything astronomically so only comfort can constrain the plan.
    const plan = await planDispatch(
      meter,
      slots((i) => (i >= 20 ? 500 : 10)),
      carbon(150),
      DAY_START,
    );

    if (plan.shouldDispatch) {
      assert.ok(
        plan.projectedTankLowC >= meter.comfortFloorC + DEFAULT_POLICY.comfortMarginC,
        `tank low ${plan.projectedTankLowC}C breaches floor ${meter.comfortFloorC}C`,
      );
    }
  });

  it("respects the maximum consecutive interval policy", async () => {
    const meter = new SimulatedMeter("test");
    const policy: DispatchPolicy = { ...DEFAULT_POLICY, maxConsecutiveIntervals: 2 };

    const plan = await planDispatch(
      meter,
      slots((i) => (i >= 34 && i <= 40 ? 80 : 20)),
      carbon(150),
      DAY_START,
      policy,
    );

    assert.ok(plan.intervals.length <= 2, "must not exceed the policy window length");
  });

  it("declines when earnings fall below the threshold", async () => {
    const meter = new SimulatedMeter("test");
    const policy: DispatchPolicy = { ...DEFAULT_POLICY, minEarningsPence: 10_000 };

    const plan = await planDispatch(
      meter,
      slots((i) => (i >= 34 && i <= 40 ? 80 : 20)),
      carbon(150),
      DAY_START,
      policy,
    );

    assert.equal(plan.shouldDispatch, false);
    assert.ok(
      plan.rationale.some((line) => line.includes("below the")),
      "should explain the earnings shortfall",
    );
  });

  it("pledges less than the simulated reduction", async () => {
    const meter = new SimulatedMeter("test");
    const plan = await planDispatch(
      meter,
      slots((i) => (i >= 34 && i <= 40 ? 80 : 20)),
      carbon(150),
      DAY_START,
    );

    assert.equal(plan.shouldDispatch, true);
    // Under-delivery forfeits the shortfall, so the pledge must carry headroom.
    const impliedReductionWh = (plan.expectedPence / plan.meanPencePerKwh) * 1000;
    assert.ok(
      plan.pledgeWh < impliedReductionWh,
      `pledge ${plan.pledgeWh} Wh must be below reduction ${impliedReductionWh.toFixed(0)} Wh`,
    );
  });

  it("always produces a rationale", async () => {
    const meter = new SimulatedMeter("test");
    const plan = await planDispatch(meter, slots(() => 20), carbon(150), DAY_START);

    assert.ok(plan.rationale.length > 0, "a decision must always be explainable");
  });

  it("handles an empty price feed without throwing", async () => {
    const meter = new SimulatedMeter("test");
    const plan = await planDispatch(meter, [], carbon(150), DAY_START);

    assert.equal(plan.shouldDispatch, false);
    assert.ok(plan.rationale[0]?.includes("No price data"));
  });

  it("prefers the higher-earning window when two qualify", async () => {
    const meter = new SimulatedMeter("test");
    // Two peaks; the later one pays more.
    const plan = await planDispatch(
      meter,
      slots((i) => {
        if (i >= 20 && i <= 22) return 60;
        if (i >= 36 && i <= 38) return 90;
        return 20;
      }),
      carbon(150),
      DAY_START,
    );

    assert.equal(plan.shouldDispatch, true);
    assert.ok(
      plan.meanPencePerKwh > 60,
      `should select the richer window, got ${plan.meanPencePerKwh}`,
    );
  });
});
