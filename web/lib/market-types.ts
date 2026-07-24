/**
 * Client-safe mirror of the `/api/market` response shape.
 *
 * The server-side builders in `lib/chain/*` all import `"server-only"`, so their types
 * cannot cross into client components. This module re-declares the *serialized* shape
 * the route actually returns (bigints already rendered as decimal strings) so client
 * components get full typing without pulling server code into the browser bundle.
 *
 * These declarations must stay in step with `lib/chain/market.ts` and the route's
 * `MarketResponse`. They are a narrow, stable contract — the JSON on the wire — not a
 * second source of truth for any chain logic.
 */

/** One settlement, every figure recomputable from the emitting `Settled` event. */
export interface SettlementView {
  readonly assetId: string;
  readonly unadjustedBaselineWh: number;
  readonly adjustedBaselineWh: number;
  readonly adjustmentBps: number;
  readonly adjustmentClamped: boolean;
  readonly actualWh: number;
  readonly pledgedWh: number;
  readonly deliveredWh: number;
  readonly paidMotes: string;
  readonly paidCspr: number;
}

export interface PledgeView {
  readonly assetId: string;
  readonly pledgedWh: number;
}

export interface DispatchStory {
  readonly eventId: string;
  readonly buyer: string;
  readonly startInterval: number;
  readonly endInterval: number;
  readonly windowLabel: string;
  readonly pricePerKwhMotes: string;
  readonly pricePerKwhCspr: number;
  readonly budgetMotes: string;
  readonly budgetCspr: number;
  readonly pledgeDeadline: string;
  readonly settlementDeadline: string;
  readonly pledges: PledgeView[];
  readonly settlements: SettlementView[];
  readonly totalPaidCspr: number;
  readonly refundedCspr: number | undefined;
}

export interface AssetStory {
  readonly assetId: string;
  readonly owner: string;
  readonly maxCurtailableW: number;
  readonly hasCommitment: boolean;
  readonly lastCommitmentHex: string | undefined;
}

/** The market event log, bigints already serialized to decimal strings. */
export type JsonMarketEvent =
  | {
      readonly kind: "AssetRegistered";
      readonly assetId: string;
      readonly owner: string;
      readonly maxCurtailableW: string;
    }
  | {
      readonly kind: "BaselineCommitted";
      readonly assetId: string;
      readonly commitment: string;
      readonly committedAt: string;
    }
  | {
      readonly kind: "EventOpened";
      readonly eventId: string;
      readonly buyer: string;
      readonly startInterval: number;
      readonly endInterval: number;
      readonly pricePerKwhMotes: string;
      readonly budgetMotes: string;
      readonly pledgeDeadline: string;
      readonly settlementDeadline: string;
    }
  | {
      readonly kind: "Pledged";
      readonly eventId: string;
      readonly assetId: string;
      readonly pledgedWh: string;
    }
  | {
      readonly kind: "Settled";
      readonly eventId: string;
      readonly assetId: string;
      readonly unadjustedBaselineWh: string;
      readonly adjustedBaselineWh: string;
      readonly adjustmentBps: number;
      readonly adjustmentClamped: boolean;
      readonly actualWh: string;
      readonly pledgedWh: string;
      readonly deliveredWh: string;
      readonly paidMotes: string;
    }
  | {
      readonly kind: "BudgetWithdrawn";
      readonly eventId: string;
      readonly buyer: string;
      readonly refundedMotes: string;
    };

export type MarketEventKind = JsonMarketEvent["kind"];

export interface MarketState {
  readonly contractHash: string;
  readonly eventCount: number;
  readonly assets: AssetStory[];
  readonly dispatches: DispatchStory[];
  readonly log: JsonMarketEvent[];
}

export interface MarketResponse {
  readonly contractHash: string;
  readonly contractUrl: string;
  readonly chainName: string;
  readonly installedAt: string;
  readonly deployer: string;
  readonly fetchedAt: string;
  readonly market: MarketState;
}

/** The 502 error shape the route returns when a chain read fails. */
export interface MarketError {
  readonly error: string;
  readonly detail?: string;
}
