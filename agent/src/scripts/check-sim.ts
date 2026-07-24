/**
 * Sanity-checks the household simulator against physical expectations.
 *
 * Run: npm run sim
 */

import { SimulatedMeter } from "../meter/simulated.js";
import { intervalLabel, INTERVALS_PER_DAY } from "../meter/types.js";

function bar(wh: number, max: number, width = 40): string {
  const n = Math.max(0, Math.round((wh / max) * width));
  return "#".repeat(n);
}

async function main(): Promise<void> {
  const meter = new SimulatedMeter("demo-site-001");

  console.log("Spectre — household simulator check\n");

  // 1. Daily profile
  const { intervalsWh, tankTraceC } = meter.simulateDay(0);
  const totalKwh = intervalsWh.reduce((a, b) => a + b, 0) / 1000;
  const peakWh = Math.max(...intervalsWh);
  const peakIdx = intervalsWh.indexOf(peakWh);

  console.log(`Daily consumption : ${totalKwh.toFixed(2)} kWh`);
  console.log(`Peak interval     : ${intervalLabel(peakIdx)} at ${peakWh} Wh`);
  console.log(`Tank range        : ${Math.min(...tankTraceC).toFixed(1)}C - ${Math.max(...tankTraceC).toFixed(1)}C`);

  // UK domestic average is roughly 7-10 kWh/day.
  const plausible = totalKwh > 5 && totalKwh < 15;
  console.log(`Plausibility      : ${plausible ? "OK (UK domestic range)" : "OUT OF RANGE"}`);

  // 2. Profile shape
  console.log("\nLoad profile (Wh per half hour)");
  for (let i = 0; i < INTERVALS_PER_DAY; i += 2) {
    const wh = intervalsWh[i] ?? 0;
    console.log(`  ${intervalLabel(i).padEnd(12)} ${String(wh).padStart(5)} ${bar(wh, peakWh)}`);
  }

  // 3. Baseline history must vary day to day, or the baseline is meaningless
  const history = await meter.history(10);
  const dailyTotals = history.map((d) => d.intervalsWh.reduce((a, b) => a + b, 0) / 1000);
  const spread = Math.max(...dailyTotals) - Math.min(...dailyTotals);
  console.log(`\nHistory days      : ${history.length}`);
  console.log(`Daily spread      : ${spread.toFixed(2)} kWh (must be > 0)`);

  // 4. The comfort constraint must actually bind
  console.log("\nCurtailment tests");

  // Intervals 35-37 = 17:30-19:00, the peak window the live price feed identified.
  const short = await meter.curtail("immersion-heater", 35, 37);
  console.log(`  17:30-19:00 (1.5h): ${short.accepted ? "ACCEPTED" : `REFUSED - ${short.reason}`}`);

  meter.reset();
  const long = await meter.curtail("immersion-heater", 20, 47); // 10:00 to midnight
  console.log(`  10:00-24:00 (14h) : ${long.accepted ? "ACCEPTED" : `REFUSED - ${long.reason}`}`);

  meter.reset();

  // 5. Curtailment must actually reduce measured consumption
  const window = [35, 36, 37];
  const curtailedSet = new Set(window);
  const { intervalsWh: curtailedWh } = meter.simulateDay(0, curtailedSet);
  const { intervalsWh: normalWh } = meter.simulateDay(0);

  const sumOver = (arr: number[]) => window.reduce((a, i) => a + (arr[i] ?? 0), 0);
  const reduction = sumOver(normalWh) - sumOver(curtailedWh);

  console.log(`\nMeasured reduction over 17:30-19:00: ${reduction} Wh`);
  console.log(`  normal    : ${window.map((i) => normalWh[i]).join(" + ")} Wh`);
  console.log(`  curtailed : ${window.map((i) => curtailedWh[i]).join(" + ")} Wh`);

  // 6. Deferral: a deferrable load pays back later. Confirm energy is not vanishing.
  const normalTotal = normalWh.reduce((a, b) => a + b, 0);
  const curtailedTotal = curtailedWh.reduce((a, b) => a + b, 0);
  console.log(`\nWhole-day totals`);
  console.log(`  normal    : ${(normalTotal / 1000).toFixed(3)} kWh`);
  console.log(`  curtailed : ${(curtailedTotal / 1000).toFixed(3)} kWh`);
  console.log(
    `  payback   : ${((normalTotal - curtailedTotal) / 1000).toFixed(3)} kWh net ` +
      `(deferrable load reheats later, so net < window reduction)`,
  );

  const checks: Array<[string, boolean]> = [
    ["daily total within UK domestic range", plausible],
    ["historical days vary (baseline has real error)", spread > 0.3],
    ["curtailment reduces metered load in the peak window", reduction > 0],
    ["comfort floor refuses an over-long curtailment", !long.accepted],
    ["comfort floor permits a reasonable curtailment", short.accepted],
  ];

  console.log("\nChecks");
  for (const [label, passed] of checks) {
    console.log(`  ${passed ? "PASS" : "FAIL"}  ${label}`);
  }

  const ok = checks.every(([, passed]) => passed);
  console.log(`\n${ok ? "Simulator behaves correctly." : "SIMULATOR CHECK FAILED"}`);
  if (!ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("\nSimulator check failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
