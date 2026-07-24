/**
 * Explanation-layer tests.
 *
 * The property that matters here is that the explanation is ALWAYS available and the
 * function NEVER throws, whatever the network does. So these tests exercise the
 * fallback path (no key, bad key host) rather than a live model call — a live call
 * would make the suite non-deterministic and dependent on a secret.
 *
 * Run: npm test
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { explainPlan, deterministicExplanation } from "./explain.js";
import type { DispatchPlan } from "./planner.js";

const DISPATCH_PLAN: DispatchPlan = {
  shouldDispatch: true,
  intervals: [35, 36, 37, 38],
  pledgeWh: 2700,
  expectedPence: 115,
  expectedGramsCo2: 470,
  meanPencePerKwh: 38.26,
  projectedTankLowC: 46.8,
  rationale: [
    "Today's median unit rate is 25.20 p/kWh.",
    "Best window is 17:30 to 19:30 at 38.26 p/kWh (1.52x the median).",
    "Pledging 2700 Wh, worth about £1.15.",
  ],
};

const NO_DISPATCH_PLAN: DispatchPlan = {
  shouldDispatch: false,
  intervals: [],
  pledgeWh: 0,
  expectedPence: 0,
  expectedGramsCo2: 0,
  meanPencePerKwh: 0,
  projectedTankLowC: 0,
  rationale: ["No window clears the policy under current prices."],
};

describe("deterministicExplanation", () => {
  it("returns the planner rationale as prose when dispatching", () => {
    const text = deterministicExplanation(DISPATCH_PLAN);
    assert.match(text, /38\.26 p\/kWh/);
    assert.match(text, /2700 Wh/);
  });

  it("explains a no-dispatch decision", () => {
    const text = deterministicExplanation(NO_DISPATCH_PLAN);
    assert.match(text, /No window clears the policy/);
  });

  it("never returns an empty string, even with no rationale", () => {
    const bare: DispatchPlan = { ...NO_DISPATCH_PLAN, rationale: [] };
    assert.ok(deterministicExplanation(bare).length > 0);
  });
});

describe("explainPlan fallback", () => {
  it("falls back to deterministic text when no API key is present", async () => {
    const result = await explainPlan(DISPATCH_PLAN, { apiKey: "" });
    assert.equal(result.source, "fallback");
    assert.equal(result.text, deterministicExplanation(DISPATCH_PLAN));
    assert.match(result.fallbackReason ?? "", /ANTHROPIC_API_KEY/);
  });

  it("never throws, and falls back, when the API host is unreachable", async () => {
    // A syntactically valid key but a call that cannot succeed: the timeout is tiny
    // so this resolves fast whether the network refuses or just hangs.
    const result = await explainPlan(DISPATCH_PLAN, {
      apiKey: "sk-ant-invalid-key-for-test",
      timeoutMs: 1,
    });
    assert.equal(result.source, "fallback");
    assert.ok(result.text.length > 0);
    assert.ok(result.fallbackReason);
  });
});
