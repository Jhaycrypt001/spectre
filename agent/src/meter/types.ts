/**
 * Meter abstraction.
 *
 * The market does not care where readings come from, only that they are consistent
 * and auditable. This interface is the seam between the protocol and the physical
 * world: `SimulatedMeter` implements it with appliance physics for this build, and
 * `ShellyMeter` implements it against real hardware over local HTTP.
 *
 * Keeping the seam explicit is what makes "this runs on real hardware" a design
 * claim rather than a marketing one.
 */

/** Half-hourly settlement intervals per day, matching UK market convention. */
export const INTERVALS_PER_DAY = 48;

/** Minutes covered by a single settlement interval. */
export const INTERVAL_MINUTES = 30;

/** A day of metered consumption, in watt-hours per settlement interval. */
export interface MeteredDay {
  /** Midnight (local) of the day these readings cover. */
  readonly date: Date;
  /** Exactly INTERVALS_PER_DAY values, watt-hours consumed in each interval. */
  readonly intervalsWh: readonly number[];
}

/** A controllable load the agent may curtail. */
export interface FlexibleLoad {
  readonly id: string;
  readonly label: string;
  /** Rated electrical draw when running, in watts. */
  readonly ratedWatts: number;
  /**
   * Whether curtailing this load defers energy rather than destroying it. A water
   * heater reheats later (deferral); a lighting circuit does not (true saving).
   * Deferral still has real market value, but the agent must account for payback.
   */
  readonly deferrable: boolean;
}

export interface MeterSource {
  /** Stable identifier for the metered site. */
  readonly siteId: string;

  /** Loads this meter can curtail on request. */
  listFlexibleLoads(): readonly FlexibleLoad[];

  /**
   * Historical consumption, most recent day last. Used to build the baseline.
   * Must return exactly `days` entries or throw.
   */
  history(days: number): Promise<MeteredDay[]>;

  /** Consumption for a single settlement interval on the current day. */
  readInterval(intervalIndex: number): Promise<number>;

  /**
   * Request curtailment of a load for a span of intervals. Returns whether the
   * request was accepted; a meter may refuse if a comfort bound would be breached.
   */
  curtail(
    loadId: string,
    fromInterval: number,
    toInterval: number,
  ): Promise<{ accepted: boolean; reason?: string }>;
}

/** Convert a wall-clock time to its settlement interval index within the day. */
export function intervalIndexOf(date: Date, timeZone = "Europe/London"): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");

  return hour * 2 + (minute >= INTERVAL_MINUTES ? 1 : 0);
}

/** Human-readable clock label for a settlement interval index. */
export function intervalLabel(index: number): string {
  const startH = Math.floor(index / 2);
  const startM = index % 2 === 0 ? "00" : "30";
  const endIndex = (index + 1) % INTERVALS_PER_DAY;
  const endH = Math.floor(endIndex / 2);
  const endM = endIndex % 2 === 0 ? "00" : "30";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(startH)}:${startM}-${pad(endH)}:${endM}`;
}
