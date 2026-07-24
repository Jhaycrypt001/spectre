/**
 * Verifies both live data feeds and reports the dispatch opportunity they imply.
 *
 * Run: npm run feeds
 */

import { fetchAgilePrices, peakWindow, slotAt } from "../feeds/octopus.js";
import {
  fetchCurrentIntensity,
  fetchIntensityForecast,
  intensityAt,
} from "../feeds/carbon.js";

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

function hhmm(date: Date): string {
  return timeFmt.format(date);
}

async function main(): Promise<void> {
  console.log("Spectre — live feed check\n");

  const [prices, current, forecast] = await Promise.all([
    fetchAgilePrices("C"),
    fetchCurrentIntensity(),
    fetchIntensityForecast(),
  ]);

  const now = new Date();

  console.log("Octopus Agile (region C / London)");
  console.log(`  slots returned : ${prices.length}`);
  const nowSlot = slotAt(prices, now);
  console.log(
    `  price now      : ${
      nowSlot ? `${nowSlot.pencePerKwh.toFixed(3)} p/kWh` : "outside published window"
    }`,
  );

  console.log("\nCarbon intensity (National Grid ESO)");
  console.log(`  period         : ${hhmm(current.from)}–${hhmm(current.to)}`);
  console.log(`  forecast       : ${current.forecastGco2PerKwh} gCO2/kWh`);
  console.log(
    `  actual         : ${
      current.actualGco2PerKwh === null ? "not yet settled" : `${current.actualGco2PerKwh} gCO2/kWh`
    }`,
  );
  console.log(`  index          : ${current.index}`);
  console.log(`  forecast slots : ${forecast.length} (48h forward)`);

  const peak = peakWindow(prices, 2);

  console.log("\nDispatch opportunity");
  if (!peak) {
    console.log("  none — insufficient forward price data");
  } else {
    const first = peak.slots[0]!;
    const last = peak.slots[peak.slots.length - 1]!;
    const carbon = intensityAt(forecast, first.from);

    console.log(`  window         : ${hhmm(first.from)}–${hhmm(last.to)} (Europe/London)`);
    console.log(`  mean price     : ${peak.meanPencePerKwh.toFixed(3)} p/kWh`);
    console.log(
      `  carbon then    : ${
        carbon ? `${carbon.forecastGco2PerKwh} gCO2/kWh (${carbon.index})` : "unknown"
      }`,
    );

    // A 3 kW immersion heater shed for the full window.
    const hours = (last.to.getTime() - first.from.getTime()) / 3_600_000;
    const kwhAvoided = 3 * hours;
    const pence = kwhAvoided * peak.meanPencePerKwh;
    const grams = carbon ? kwhAvoided * carbon.forecastGco2PerKwh : 0;

    console.log(
      `\n  Shedding a 3 kW immersion heater for ${hours.toFixed(1)}h avoids ` +
        `${kwhAvoided.toFixed(1)} kWh`,
    );
    console.log(`  → worth £${(pence / 100).toFixed(2)} at the prevailing rate`);
    if (carbon) {
      console.log(`  → avoids ${(grams / 1000).toFixed(2)} kg CO2`);
    }
  }

  console.log("\nBoth feeds live. Data is real.");
}

main().catch((error: unknown) => {
  console.error("\nFeed check failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
