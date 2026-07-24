/**
 * Physics-based household simulator.
 *
 * Household load in this build is simulated; grid prices and carbon intensity are
 * live and real. That split is stated plainly in the README and in the demo.
 *
 * The simulation is not decorative. The agent's decision is only meaningful if
 * curtailment has a real cost, so the water heater carries an actual thermal model:
 * shedding it drops the tank temperature, and the agent must decide whether the tank
 * will still be above the household's comfort floor when hot water is next drawn.
 * Remove the physics and the "agentic" reasoning becomes theatre.
 */

import {
  INTERVALS_PER_DAY,
  INTERVAL_MINUTES,
  type FlexibleLoad,
  type MeteredDay,
  type MeterSource,
} from "./types.js";

/** Specific heat capacity of water, J/(kg·K). */
const WATER_SHC = 4_186;

/** Joules per watt-hour. */
const JOULES_PER_WH = 3_600;

/**
 * Thermostat hysteresis in kelvin. The element fires once the tank has fallen this
 * far below the set point. Domestic cylinder stats typically run a 5-10 K band.
 */
const THERMOSTAT_DEADBAND_K = 7;

export interface WaterHeaterSpec {
  /** Tank volume in litres. A typical UK domestic cylinder is 150–210 L. */
  readonly litres: number;
  /** Immersion element rating in watts. */
  readonly ratedWatts: number;
  /** Target tank temperature in Celsius. */
  readonly setPointC: number;
  /** Below this, the household notices. The agent must not cross it. */
  readonly comfortFloorC: number;
  /** Standing heat loss in watts at a 45 K delta to ambient. */
  readonly standingLossW: number;
}

/**
 * A 210 L cylinder is the common size where an immersion element is the primary
 * water-heating source, and its thermal store is what makes the load dispatchable:
 * 210 L coasting from 60C to the 45C floor holds ~3.7 kWh, enough to ride through a
 * peak window without the household noticing.
 */
export const DEFAULT_TANK: WaterHeaterSpec = {
  litres: 210,
  ratedWatts: 3_000,
  setPointC: 60,
  comfortFloorC: 45,
  standingLossW: 60,
};

/**
 * Baseline (non-flexible) household demand by settlement interval, in watts.
 *
 * Shape of a typical UK domestic profile: overnight trough, morning shoulder,
 * pronounced evening peak. Scaled so that base load plus water heating lands near
 * the UK domestic average of roughly 8 kWh/day (Ofgem TDCV low/medium band).
 */
const BASE_LOAD_W: readonly number[] = [
  // 00:00-06:00 — overnight trough
  95, 92, 90, 88, 86, 86, 84, 84, 86, 88, 90, 95,
  // 06:00-09:00 — morning ramp
  140, 205, 245, 255, 225, 195,
  // 09:00-16:00 — daytime plateau
  160, 155, 152, 150, 152, 155, 160, 165, 170, 176, 182, 188, 195, 205,
  // 16:00-20:00 — evening peak
  280, 380, 475, 530, 550, 520, 470, 410,
  // 20:00-24:00 — evening decline
  345, 300, 265, 232, 205, 178, 150, 118,
];

/**
 * Litres of hot water drawn in each interval.
 *
 * Placed to reflect real domestic use: morning showers, and a sustained evening
 * demand across the 17:00-20:00 period when the grid is most stressed. The evening
 * draw is what puts the immersion element into the peak window — which is precisely
 * what makes this load worth dispatching.
 */
const HOT_WATER_DRAW_L: readonly number[] = (() => {
  const draw = new Array<number>(INTERVALS_PER_DAY).fill(0);
  draw[13] = 32; // 06:30 shower
  draw[14] = 24; // 07:00 shower
  draw[16] = 8; // 08:00 basin
  draw[34] = 10; // 17:00 early evening
  draw[35] = 14; // 17:30 cooking / washing
  draw[36] = 12; // 18:00
  draw[37] = 9; // 18:30
  draw[38] = 12; // 19:00 washing up
  draw[39] = 8; // 19:30
  draw[43] = 8; // 21:30
  return draw;
})();

/** Total litres drawn per day at nominal scale. UK household average is 120-140 L. */
export const NOMINAL_DAILY_DRAW_L = HOT_WATER_DRAW_L.reduce((a, b) => a + b, 0);

/**
 * Deterministic per-day variation so historical days are not identical.
 *
 * A baseline computed over ten identical days would be trivially exact, which would
 * quietly overstate how well the methodology performs. Real occupancy varies, so the
 * simulator varies too and the baseline carries genuine estimation error.
 */
function dayJitter(dayOffset: number, interval: number): number {
  const seed = Math.sin(dayOffset * 12.9898 + interval * 78.233) * 43_758.5453;
  const unit = seed - Math.floor(seed); // [0,1)
  return 0.82 + unit * 0.36; // ±18%
}

/** Per-day scaling of hot water use, so draws vary across the baseline window too. */
function dayDrawScale(dayOffset: number): number {
  const seed = Math.sin(dayOffset * 4.1357) * 22_431.77;
  const unit = seed - Math.floor(seed);
  return 0.85 + unit * 0.3; // ±15%
}

export class SimulatedMeter implements MeterSource {
  readonly siteId: string;

  private readonly tank: WaterHeaterSpec;
  private readonly coldInletC = 12;
  private readonly ambientC = 18;

  /** Intervals the agent has curtailed on the current day. */
  private readonly curtailed = new Set<number>();

  constructor(siteId: string, tank: WaterHeaterSpec = DEFAULT_TANK) {
    this.siteId = siteId;
    this.tank = tank;
  }

  listFlexibleLoads(): readonly FlexibleLoad[] {
    return [
      {
        id: "immersion-heater",
        label: `Immersion heater (${this.tank.litres} L cylinder)`,
        ratedWatts: this.tank.ratedWatts,
        deferrable: true,
      },
    ];
  }

  /**
   * Energy in watt-hours the immersion element draws in an interval, given the
   * tank temperature at the start of it. Also returns the resulting temperature.
   */
  private stepTank(
    startTempC: number,
    interval: number,
    curtail: boolean,
    drawScale: number,
  ): { heaterWh: number; endTempC: number } {
    const massKg = this.tank.litres;
    const hours = INTERVAL_MINUTES / 60;

    // Standing loss scales with the temperature delta to ambient.
    const delta = startTempC - this.ambientC;
    const lossW = this.tank.standingLossW * (delta / 45);
    const lossJ = lossW * hours * JOULES_PER_WH;

    // Hot water drawn is replaced by cold inlet, which cools the tank.
    const drawL = (HOT_WATER_DRAW_L[interval] ?? 0) * drawScale;
    const drawJ = drawL * WATER_SHC * (startTempC - this.coldInletC);

    let tempC = startTempC - (lossJ + drawJ) / (massKg * WATER_SHC);

    // A real cylinder thermostat has a wide hysteresis band: it lets the tank coast
    // down several degrees before firing, then heats back to the set point. A narrow
    // band would keep the element pinned near the top of its range and leave almost
    // nothing to curtail.
    let heaterWh = 0;
    if (!curtail && tempC < this.tank.setPointC - THERMOSTAT_DEADBAND_K) {
      const deficitJ = (this.tank.setPointC - tempC) * massKg * WATER_SHC;
      const maxJ = this.tank.ratedWatts * hours * JOULES_PER_WH;
      const appliedJ = Math.min(deficitJ, maxJ);
      heaterWh = appliedJ / JOULES_PER_WH;
      tempC += appliedJ / (massKg * WATER_SHC);
    }

    return { heaterWh, endTempC: tempC };
  }

  /**
   * Simulate a full day, returning per-interval consumption and the tank
   * temperature trace. `curtailedIntervals` are those the agent has shed.
   */
  simulateDay(
    dayOffset: number,
    curtailedIntervals: ReadonlySet<number> = new Set(),
  ): { intervalsWh: number[]; tankTraceC: number[] } {
    const intervalsWh: number[] = [];
    const tankTraceC: number[] = [];

    let tempC = this.tank.setPointC;
    const drawScale = dayDrawScale(dayOffset);

    for (let i = 0; i < INTERVALS_PER_DAY; i++) {
      const jitter = dayJitter(dayOffset, i);
      const baseW = (BASE_LOAD_W[i] ?? 250) * jitter;
      const baseWh = (baseW * INTERVAL_MINUTES) / 60;

      const { heaterWh, endTempC } = this.stepTank(
        tempC,
        i,
        curtailedIntervals.has(i),
        drawScale,
      );
      tempC = endTempC;

      tankTraceC.push(Number(tempC.toFixed(2)));
      intervalsWh.push(Math.round(baseWh + heaterWh));
    }

    return { intervalsWh, tankTraceC };
  }

  async history(days: number): Promise<MeteredDay[]> {
    const out: MeteredDay[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Historical days are un-curtailed by construction: the baseline must be built
    // from days on which no dispatch occurred, per the 10-in-10 eligibility rule.
    for (let d = days; d >= 1; d--) {
      const date = new Date(today);
      date.setDate(date.getDate() - d);
      const { intervalsWh } = this.simulateDay(d);
      out.push({ date, intervalsWh });
    }

    return out;
  }

  async readInterval(intervalIndex: number): Promise<number> {
    const { intervalsWh } = this.simulateDay(0, this.curtailed);
    const value = intervalsWh[intervalIndex];
    if (value === undefined) {
      throw new Error(`interval ${intervalIndex} out of range`);
    }
    return value;
  }

  /**
   * Accept a curtailment only if the tank stays above the comfort floor for the
   * remainder of the day. This is the constraint that makes the agent's decision
   * a genuine tradeoff rather than a free win.
   */
  async curtail(
    loadId: string,
    fromInterval: number,
    toInterval: number,
  ): Promise<{ accepted: boolean; reason?: string }> {
    if (loadId !== "immersion-heater") {
      return { accepted: false, reason: `unknown load: ${loadId}` };
    }

    const proposed = new Set(this.curtailed);
    for (let i = fromInterval; i <= toInterval; i++) proposed.add(i);

    const { tankTraceC } = this.simulateDay(0, proposed);
    const lowest = Math.min(...tankTraceC.slice(fromInterval));

    if (lowest < this.tank.comfortFloorC) {
      return {
        accepted: false,
        reason:
          `tank would fall to ${lowest.toFixed(1)}C, below the ` +
          `${this.tank.comfortFloorC}C comfort floor`,
      };
    }

    for (let i = fromInterval; i <= toInterval; i++) this.curtailed.add(i);
    return { accepted: true };
  }

  /** Projected tank low point if the given intervals were curtailed. */
  projectTankLow(curtailedIntervals: ReadonlySet<number>, fromInterval = 0): number {
    const { tankTraceC } = this.simulateDay(0, curtailedIntervals);
    return Math.min(...tankTraceC.slice(fromInterval));
  }

  get comfortFloorC(): number {
    return this.tank.comfortFloorC;
  }

  /** Reset curtailment state — used between demo runs. */
  reset(): void {
    this.curtailed.clear();
  }
}
