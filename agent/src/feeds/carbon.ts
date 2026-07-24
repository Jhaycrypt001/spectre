/**
 * National Grid ESO carbon intensity for Great Britain.
 *
 * Public, unauthenticated. Verified live 2026-07-22.
 * Docs: https://carbon-intensity.github.io/api-definitions/
 *
 * Carbon intensity is the second half of the dispatch signal. A kWh avoided during a
 * high-intensity period displaces more gas generation than the same kWh avoided at
 * 3am on a windy night, so the agent weighs both price and carbon.
 */

export type IntensityIndex =
  | "very low"
  | "low"
  | "moderate"
  | "high"
  | "very high";

export interface CarbonReading {
  readonly from: Date;
  readonly to: Date;
  /** Forecast grams of CO2 per kWh. Always present. */
  readonly forecastGco2PerKwh: number;
  /** Settled actual, published in arrears. Null for current/future periods. */
  readonly actualGco2PerKwh: number | null;
  readonly index: IntensityIndex;
}

interface IntensityPeriod {
  from: string;
  to: string;
  intensity: {
    forecast: number;
    actual: number | null;
    index: IntensityIndex;
  };
}

interface IntensityResponse {
  data: IntensityPeriod[];
}

function toReading(period: IntensityPeriod): CarbonReading {
  return {
    from: new Date(period.from),
    to: new Date(period.to),
    forecastGco2PerKwh: period.intensity.forecast,
    actualGco2PerKwh: period.intensity.actual,
    index: period.intensity.index,
  };
}

async function getIntensity(path: string): Promise<IntensityPeriod[]> {
  const response = await fetch(`https://api.carbonintensity.org.uk${path}`, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `Carbon Intensity request failed: ${response.status} ${response.statusText}`,
    );
  }

  const body = (await response.json()) as IntensityResponse;

  if (!Array.isArray(body.data) || body.data.length === 0) {
    throw new Error("Carbon Intensity returned no data");
  }

  return body.data;
}

/** Carbon intensity for the current half-hour settlement period. */
export async function fetchCurrentIntensity(): Promise<CarbonReading> {
  const [period] = await getIntensity("/intensity");
  if (!period) throw new Error("Carbon Intensity returned an empty period");
  return toReading(period);
}

/**
 * ISO8601 to the minute, which is the only format the API's path parameter accepts.
 * Seconds and milliseconds are rejected with a 400.
 */
function toApiDatetime(date: Date): string {
  return `${date.toISOString().slice(0, 16)}Z`;
}

/** 48-hour forward forecast, half-hourly, starting at `from` (defaults to now). */
export async function fetchIntensityForecast(
  from: Date = new Date(),
): Promise<CarbonReading[]> {
  const periods = await getIntensity(`/intensity/${toApiDatetime(from)}/fw48h`);
  return periods.map(toReading);
}

/** Reading covering `at`, or undefined if outside the forecast horizon. */
export function intensityAt(
  readings: readonly CarbonReading[],
  at: Date,
): CarbonReading | undefined {
  const t = at.getTime();
  return readings.find((r) => r.from.getTime() <= t && t < r.to.getTime());
}
