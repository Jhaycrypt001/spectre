/**
 * Shape the flat event log into the story the dashboard tells.
 *
 * The chain emits a flat, append-only stream: an AssetRegistered here, a Settled
 * there. What a reader actually wants to see is *one dispatch event's whole life* —
 * who registered, what baseline they committed, what they pledged, what the contract
 * recomputed, and what it paid. This module does that grouping and nothing more: it
 * adds no numbers of its own. Every figure it surfaces came from a decoded event,
 * so anything shown here is recomputable from chain data alone.
 *
 * Server-only, because it consumes the read-only chain reader.
 */

import "server-only";

import type { MarketEvent } from "@/lib/agent-vendored/events";
import { intervalLabel } from "./intervals";

/**
 * JSON-safe rendering of a {@link MarketEvent}.
 *
 * Decoded events carry `bigint` fields (motes, Wh, millisecond timestamps) that
 * `JSON.stringify` refuses to serialize. This is the same event data with every
 * bigint rendered as a decimal string — lossless, and directly usable by the client.
 *
 * `MarketEvent` is a discriminated union, so we distribute over its members with a
 * generic — `T extends MarketEvent ? ... : never` — rather than a single mapped type.
 * A plain `{ [K in keyof MarketEvent]: ... }` would key over only the union's *common*
 * fields and collapse every variant's discriminant, so the client couldn't switch on
 * `kind`. Distributing preserves each variant intact, bigints swapped for strings.
 */
type JsonEvent<T> = {
  readonly [K in keyof T]: T[K] extends bigint ? string : T[K];
};
export type JsonMarketEvent = MarketEvent extends infer T
  ? T extends MarketEvent
    ? JsonEvent<T>
    : never
  : never;

/** Convert one decoded event to its JSON-safe form (bigint → decimal string). */
function toJsonEvent(event: MarketEvent): JsonMarketEvent {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    out[key] = typeof value === "bigint" ? value.toString() : value;
  }
  return out as JsonMarketEvent;
}

/** One CSPR is 1e9 motes; the market prices demand reduction in motes/kWh. */
const MOTES_PER_CSPR = 1_000_000_000;

export interface SettlementView {
  readonly assetId: string;
  /** Baseline the contract recomputed from the revealed history, in Wh. */
  readonly unadjustedBaselineWh: number;
  /** Baseline after the ±20% day-of adjustment, in Wh. */
  readonly adjustedBaselineWh: number;
  /** Day-of adjustment applied, in basis points (can be negative). */
  readonly adjustmentBps: number;
  /** Whether the adjustment hit the ±2000 bps (±20%) clamp. */
  readonly adjustmentClamped: boolean;
  /** Metered consumption during the window, in Wh. */
  readonly actualWh: number;
  /** What the household pledged to cut, in Wh. */
  readonly pledgedWh: number;
  /** Reduction the contract actually credited (min of pledged and delivered), Wh. */
  readonly deliveredWh: number;
  /** Payout, in motes and CSPR. */
  readonly paidMotes: string;
  readonly paidCspr: number;
}

export interface PledgeView {
  readonly assetId: string;
  readonly pledgedWh: number;
}

/** A single dispatch event, assembled from every event that references its id. */
export interface DispatchStory {
  readonly eventId: string;
  readonly buyer: string;
  readonly startInterval: number;
  readonly endInterval: number;
  /** e.g. "17:30-19:30", derived from the interval indices. */
  readonly windowLabel: string;
  readonly pricePerKwhMotes: string;
  readonly pricePerKwhCspr: number;
  readonly budgetMotes: string;
  readonly budgetCspr: number;
  readonly pledgeDeadline: string;
  readonly settlementDeadline: string;
  readonly pledges: PledgeView[];
  readonly settlements: SettlementView[];
  /** Sum of every settlement's payout, in CSPR. */
  readonly totalPaidCspr: number;
  /** Budget the buyer reclaimed after the window closed, in CSPR (if withdrawn). */
  readonly refundedCspr: number | undefined;
}

export interface AssetStory {
  readonly assetId: string;
  readonly owner: string;
  readonly maxCurtailableW: number;
  /** Whether a baseline commitment has been seen for this asset. */
  readonly hasCommitment: boolean;
  readonly lastCommitmentHex: string | undefined;
}

export interface MarketState {
  readonly contractHash: string;
  readonly eventCount: number;
  readonly assets: AssetStory[];
  readonly dispatches: DispatchStory[];
  /** The raw log, newest first, for a verifiable activity feed (JSON-safe). */
  readonly log: JsonMarketEvent[];
}

const cspr = (motes: bigint): number => Number(motes) / MOTES_PER_CSPR;

/**
 * Clock label for a dispatch window spanning intervals `[start, end]` inclusive.
 *
 * `intervalLabel` gives a *single* interval as "17:30-18:00". A dispatch covers a
 * run of intervals, so its window is the start clock time of the first interval to
 * the end clock time of the last — e.g. intervals 35..38 → "17:30–19:30". We take the
 * front of the start interval's label and the back of the end interval's label rather
 * than reformatting the arithmetic, so the two stay tied to the agent's own function.
 */
const windowLabel = (start: number, end: number): string => {
  const [from] = intervalLabel(start).split("-");
  const [, to] = intervalLabel(end).split("-");
  return `${from}–${to}`;
};

/** Format a chain millisecond deadline as an ISO string (UTC). */
const deadline = (ms: bigint): string => new Date(Number(ms)).toISOString();

/**
 * Mutable working copy of a dispatch story.
 *
 * The public {@link DispatchStory} is deeply `readonly` — a dashboard should not
 * be able to edit chain-derived numbers. But assembling one means pushing pledges
 * and accumulating payouts as the log is walked, so the fold works on this mutable
 * form and the result is exposed through the readonly interface at the end.
 */
type MutableDispatch = {
  -readonly [K in keyof DispatchStory]: DispatchStory[K];
} & { pledges: PledgeView[]; settlements: SettlementView[] };

/**
 * Fold the event log into structured market state.
 *
 * The log is authoritative and ordered; this walks it once, attaching each event
 * to the asset or dispatch it names. Events that reference an id never seen before
 * still create a minimal record, so a partial log (e.g. mid-cycle) renders rather
 * than throwing.
 */
export function buildMarketState(
  contractHash: string,
  log: MarketEvent[],
): MarketState {
  const assets = new Map<string, AssetStory>();
  const dispatches = new Map<string, MutableDispatch>();

  const ensureDispatch = (eventId: string): MutableDispatch => {
    let d = dispatches.get(eventId);
    if (!d) {
      d = {
        eventId,
        buyer: "",
        startInterval: 0,
        endInterval: 0,
        windowLabel: "",
        pricePerKwhMotes: "0",
        pricePerKwhCspr: 0,
        budgetMotes: "0",
        budgetCspr: 0,
        pledgeDeadline: "",
        settlementDeadline: "",
        pledges: [],
        settlements: [],
        totalPaidCspr: 0,
        refundedCspr: undefined,
      };
      dispatches.set(eventId, d);
    }
    return d;
  };

  for (const event of log) {
    switch (event.kind) {
      case "AssetRegistered":
        assets.set(event.assetId, {
          assetId: event.assetId,
          owner: event.owner,
          maxCurtailableW: Number(event.maxCurtailableW),
          hasCommitment: assets.get(event.assetId)?.hasCommitment ?? false,
          lastCommitmentHex: assets.get(event.assetId)?.lastCommitmentHex,
        });
        break;

      case "BaselineCommitted": {
        const existing = assets.get(event.assetId);
        assets.set(event.assetId, {
          assetId: event.assetId,
          owner: existing?.owner ?? "",
          maxCurtailableW: existing?.maxCurtailableW ?? 0,
          hasCommitment: true,
          lastCommitmentHex: event.commitment,
        });
        break;
      }

      case "EventOpened": {
        const d = ensureDispatch(event.eventId);
        dispatches.set(event.eventId, {
          ...d,
          buyer: event.buyer,
          startInterval: event.startInterval,
          endInterval: event.endInterval,
          windowLabel: windowLabel(event.startInterval, event.endInterval),
          pricePerKwhMotes: event.pricePerKwhMotes.toString(),
          pricePerKwhCspr: cspr(event.pricePerKwhMotes),
          budgetMotes: event.budgetMotes.toString(),
          budgetCspr: cspr(event.budgetMotes),
          pledgeDeadline: deadline(event.pledgeDeadline),
          settlementDeadline: deadline(event.settlementDeadline),
        });
        break;
      }

      case "Pledged": {
        const d = ensureDispatch(event.eventId);
        d.pledges.push({
          assetId: event.assetId,
          pledgedWh: Number(event.pledgedWh),
        });
        break;
      }

      case "Settled": {
        const d = ensureDispatch(event.eventId);
        const paidCspr = cspr(event.paidMotes);
        d.settlements.push({
          assetId: event.assetId,
          unadjustedBaselineWh: Number(event.unadjustedBaselineWh),
          adjustedBaselineWh: Number(event.adjustedBaselineWh),
          adjustmentBps: event.adjustmentBps,
          adjustmentClamped: event.adjustmentClamped,
          actualWh: Number(event.actualWh),
          pledgedWh: Number(event.pledgedWh),
          deliveredWh: Number(event.deliveredWh),
          paidMotes: event.paidMotes.toString(),
          paidCspr,
        });
        d.totalPaidCspr += paidCspr;
        break;
      }

      case "BudgetWithdrawn": {
        const d = ensureDispatch(event.eventId);
        d.refundedCspr = cspr(event.refundedMotes);
        break;
      }
    }
  }

  return {
    contractHash,
    eventCount: log.length,
    assets: [...assets.values()],
    dispatches: [...dispatches.values()],
    log: [...log].reverse().map(toJsonEvent),
  };
}
