/**
 * Runs the dispatch planner against live market data.
 *
 * Run: npm run plan
 */

import { fetchAgilePrices } from "../feeds/octopus.js";
import { fetchIntensityForecast } from "../feeds/carbon.js";
import { SimulatedMeter } from "../meter/simulated.js";
import { intervalLabel } from "../meter/types.js";
import { planDispatch, DEFAULT_POLICY } from "../agent/planner.js";

async function main(): Promise<void> {
  console.log("Spectre — dispatch planner (live data)\n");

  const [prices, carbon] = await Promise.all([
    fetchAgilePrices("C"),
    fetchIntensityForecast(),
  ]);

  const meter = new SimulatedMeter("demo-site-001");

  // Plan from the start of today so the whole day is evaluable regardless of
  // when this is run.
  const reference = new Date();
  reference.setHours(0, 0, 0, 0);

  const plan = await planDispatch(meter, prices, carbon, reference, DEFAULT_POLICY);

  console.log("Agent reasoning:");
  for (const [i, line] of plan.rationale.entries()) {
    console.log(`  ${i + 1}. ${line}`);
  }

  console.log("\nDecision");
  console.log(`  dispatch     : ${plan.shouldDispatch ? "YES" : "NO"}`);

  if (plan.shouldDispatch) {
    const first = plan.intervals[0]!;
    const last = plan.intervals[plan.intervals.length - 1]!;
    console.log(
      `  window       : ${intervalLabel(first)} to ${intervalLabel(last)} ` +
        `(intervals ${first}-${last})`,
    );
    console.log(`  pledge       : ${plan.pledgeWh} Wh`);
    console.log(`  mean price   : ${plan.meanPencePerKwh.toFixed(2)} p/kWh`);
    console.log(`  earnings     : £${(plan.expectedPence / 100).toFixed(2)}`);
    console.log(`  carbon saved : ${(plan.expectedGramsCo2 / 1000).toFixed(2)} kg CO2`);
    console.log(`  tank low     : ${plan.projectedTankLowC.toFixed(1)}C`);
  }

  console.log(
    `\n${plan.shouldDispatch ? "Planner produced a dispatchable window." : "Planner declined to dispatch."}`,
  );
}

main().catch((error: unknown) => {
  console.error("\nPlanner failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
