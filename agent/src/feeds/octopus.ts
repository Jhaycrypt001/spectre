/**
 * Octopus Agile half-hourly electricity prices.
 *
 * Public, unauthenticated. Verified live 2026-07-22.
 * Docs: https://developer.octopus.energy/rest/guides/api-basics
 *
 * Agile is a real UK domestic tariff whose unit rate changes every 30 minutes and
 * tracks the wholesale market. Peak periods are exactly when the grid values demand
 * reduction, so this feed is both our price signal and our dispatch trigger.
 */

const AGILE_PRODUCT = "AGILE-24-10-01";

/** Region letter of the GB distribution area. "C" = London. */
export type RegionCode =
  | "A" | "B" | "C" | "D" | "E" | "F" | "G"
  | "H" | "J" | "K" | "L" | "M" | "N" | "P";

export interface PriceSlot {
  /** Start of the half-hour settlement period (UTC). */
  readonly from: Date;
  /** End of the half-hour settlement period (UTC). */
  readonly to: Date;
  /** Unit rate in pence per kWh, including VAT. */
  readonly pencePerKwh: number;
}

interface AgileRate {
  value_exc_vat: number;
  value_inc_vat: number;
  valid_from: string;
  valid_to: string | null;
  payment_method: string | null;
}

interface AgileResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: AgileRate[];
}

function tariffCode(region: RegionCode): string {
  return `E-1R-${AGILE_PRODUCT}-${region}`;
}

/**
 * Fetch upcoming half-hourly unit rates, ascending by start time.
 *
 * The API returns newest-first and may include slots already in the past, so we
 * filter and re-sort rather than trusting the wire order.
 */
export async function fetchAgilePrices(
  region: RegionCode = "C",
  options: { signal?: AbortSignal } = {},
): Promise<PriceSlot[]> {
  const url =
    `https://api.octopus.energy/v1/products/${AGILE_PRODUCT}` +
    `/electricity-tariffs/${tariffCode(region)}/standard-unit-rates/`;

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok) {
    throw new Error(
      `Octopus Agile request failed: ${response.status} ${response.statusText}`,
    );
  }

  const body = (await response.json()) as AgileResponse;

  if (!Array.isArray(body.results) || body.results.length === 0) {
    throw new Error("Octopus Agile returned no rates");
  }

  return body.results
    .filter((rate): rate is AgileRate & { valid_to: string } => rate.valid_to !== null)
    .map((rate) => ({
      from: new Date(rate.valid_from),
      to: new Date(rate.valid_to),
      pencePerKwh: rate.value_inc_vat,
    }))
    .sort((a, b) => a.from.getTime() - b.from.getTime());
}

/** The slot covering `at`, or undefined if the feed does not cover that time. */
export function slotAt(slots: readonly PriceSlot[], at: Date): PriceSlot | undefined {
  const t = at.getTime();
  return slots.find((slot) => slot.from.getTime() <= t && t < slot.to.getTime());
}

/**
 * Identify the most expensive contiguous run of slots in the forward window.
 *
 * This is the dispatch opportunity: the window where a kWh avoided is worth most.
 */
export function peakWindow(
  slots: readonly PriceSlot[],
  slotCount = 2,
): { slots: PriceSlot[]; meanPencePerKwh: number } | undefined {
  const future = slots.filter((slot) => slot.to.getTime() > Date.now());
  if (future.length < slotCount) return undefined;

  let best: { slots: PriceSlot[]; meanPencePerKwh: number } | undefined;

  for (let i = 0; i + slotCount <= future.length; i++) {
    const run = future.slice(i, i + slotCount);
    const mean = run.reduce((sum, s) => sum + s.pencePerKwh, 0) / run.length;
    if (!best || mean > best.meanPencePerKwh) {
      best = { slots: run, meanPencePerKwh: mean };
    }
  }

  return best;
}
