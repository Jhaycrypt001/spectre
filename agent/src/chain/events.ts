/**
 * Reading SpectreMarket's on-chain event log.
 *
 * # Why events are the read path
 *
 * Odra stores module state (`Var`, `Mapping`) in a dictionary keyed by an internal
 * hash, so those entries cannot be addressed from outside without reimplementing
 * Odra's key derivation. The CES event log can: it lives under the `__events` URef,
 * is indexed by a plain integer, and — by design — carries every intermediate value
 * a settlement produced.
 *
 * That is the stronger guarantee anyway. The market's central claim is that a third
 * party can recompute any payout from chain data alone. This module is that third
 * party: it reads only what the contract published, and never trusts the agent's own
 * record of what it did.
 *
 * # Wire format (CES 1.1)
 *
 * Each dictionary item is a CLValue of type `Any`, whose bytes are:
 *
 *   [ u32 length prefix ][ "event_" + name, CL String ][ field bytes... ]
 *
 * Fields follow in declaration order with no names, so decoding requires knowing
 * the struct layout — which is why each event type below is decoded explicitly
 * rather than reflectively.
 */

/** Little-endian u32 reader. */
class Reader {
  private offset = 0;

  constructor(private readonly buf: Uint8Array) {}

  get remaining(): number {
    return this.buf.length - this.offset;
  }

  private take(n: number): Uint8Array {
    if (this.offset + n > this.buf.length) {
      throw new Error(
        `Truncated event payload: wanted ${n} bytes at offset ${this.offset}, ` +
          `only ${this.remaining} remain.`,
      );
    }
    const slice = this.buf.subarray(this.offset, this.offset + n);
    this.offset += n;
    return slice;
  }

  u8(): number {
    return this.take(1)[0]!;
  }

  bool(): boolean {
    return this.u8() !== 0;
  }

  u32(): number {
    const b = this.take(4);
    return (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0;
  }

  i32(): number {
    const b = this.take(4);
    return b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24);
  }

  u64(): bigint {
    const b = this.take(8);
    let value = 0n;
    for (let i = 7; i >= 0; i -= 1) value = (value << 8n) | BigInt(b[i]!);
    return value;
  }

  /** CL `U512`: one length byte, then that many little-endian magnitude bytes. */
  u512(): bigint {
    const length = this.u8();
    if (length === 0) return 0n;
    const b = this.take(length);
    let value = 0n;
    for (let i = length - 1; i >= 0; i -= 1) value = (value << 8n) | BigInt(b[i]!);
    return value;
  }

  /** CL `String`: u32 byte length, then UTF-8. */
  string(): string {
    const length = this.u32();
    return new TextDecoder().decode(this.take(length));
  }

  /** CL `Bytes` (`List<U8>`): u32 length, then raw bytes. */
  bytes(): Uint8Array {
    const length = this.u32();
    return new Uint8Array(this.take(length));
  }

  /**
   * CL `Key`/`Address`: a one-byte tag followed by a 32-byte hash.
   *
   * Odra's `Address` is an enum over account and contract keys; both carry 32
   * bytes after the tag, so the tag is preserved to keep them distinguishable.
   */
  address(): string {
    const tag = this.u8();
    const hash = this.take(32);
    const hex = Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
    return tag === 0 ? `account-hash-${hex}` : `hash-${hex}`;
  }
}

export interface AssetRegistered {
  readonly kind: "AssetRegistered";
  readonly assetId: string;
  readonly owner: string;
  readonly maxCurtailableW: bigint;
}

export interface BaselineCommitted {
  readonly kind: "BaselineCommitted";
  readonly assetId: string;
  readonly commitment: string;
  readonly committedAt: bigint;
}

export interface EventOpened {
  readonly kind: "EventOpened";
  readonly eventId: string;
  readonly buyer: string;
  readonly startInterval: number;
  readonly endInterval: number;
  readonly pricePerKwhMotes: bigint;
  readonly budgetMotes: bigint;
  readonly pledgeDeadline: bigint;
  readonly settlementDeadline: bigint;
}

export interface Pledged {
  readonly kind: "Pledged";
  readonly eventId: string;
  readonly assetId: string;
  readonly pledgedWh: bigint;
}

export interface Settled {
  readonly kind: "Settled";
  readonly eventId: string;
  readonly assetId: string;
  readonly unadjustedBaselineWh: bigint;
  readonly adjustedBaselineWh: bigint;
  readonly adjustmentBps: number;
  readonly adjustmentClamped: boolean;
  readonly actualWh: bigint;
  readonly pledgedWh: bigint;
  readonly deliveredWh: bigint;
  readonly paidMotes: bigint;
}

export interface BudgetWithdrawn {
  readonly kind: "BudgetWithdrawn";
  readonly eventId: string;
  readonly buyer: string;
  readonly refundedMotes: bigint;
}

export type MarketEvent =
  | AssetRegistered
  | BaselineCommitted
  | EventOpened
  | Pledged
  | Settled
  | BudgetWithdrawn;

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Decode one CES event payload.
 *
 * Field order mirrors the `#[odra::event]` struct declarations in
 * `contracts/spectre-market/src/market.rs`. Reordering a struct field there
 * without changing it here would silently misdecode, so the two are kept adjacent
 * in review.
 */
export function decodeEvent(payload: Uint8Array): MarketEvent {
  const reader = new Reader(payload);

  // CES wraps the payload in an `Any`, which is length-prefixed. Skip that prefix
  // when it accounts for exactly the remaining bytes; older writers omit it.
  const first = reader.u32();
  const rest = new Reader(
    first === payload.length - 4 ? payload.subarray(4) : payload,
  );

  const name = rest.string().replace(/^event_/, "");

  switch (name) {
    case "AssetRegistered":
      return {
        kind: "AssetRegistered",
        assetId: rest.string(),
        owner: rest.address(),
        maxCurtailableW: rest.u64(),
      };

    case "BaselineCommitted":
      return {
        kind: "BaselineCommitted",
        assetId: rest.string(),
        commitment: toHex(rest.bytes()),
        committedAt: rest.u64(),
      };

    case "EventOpened":
      return {
        kind: "EventOpened",
        eventId: rest.string(),
        buyer: rest.address(),
        startInterval: rest.u32(),
        endInterval: rest.u32(),
        pricePerKwhMotes: rest.u512(),
        budgetMotes: rest.u512(),
        pledgeDeadline: rest.u64(),
        settlementDeadline: rest.u64(),
      };

    case "Pledged":
      return {
        kind: "Pledged",
        eventId: rest.string(),
        assetId: rest.string(),
        pledgedWh: rest.u64(),
      };

    case "Settled":
      return {
        kind: "Settled",
        eventId: rest.string(),
        assetId: rest.string(),
        unadjustedBaselineWh: rest.u64(),
        adjustedBaselineWh: rest.u64(),
        adjustmentBps: rest.i32(),
        adjustmentClamped: rest.bool(),
        actualWh: rest.u64(),
        pledgedWh: rest.u64(),
        deliveredWh: rest.u64(),
        paidMotes: rest.u512(),
      };

    case "BudgetWithdrawn":
      return {
        kind: "BudgetWithdrawn",
        eventId: rest.string(),
        buyer: rest.address(),
        refundedMotes: rest.u512(),
      };

    default:
      throw new Error(`Unknown event type "${name}".`);
  }
}

/** Human-readable one-line rendering, used by the dispatch log. */
export function formatEvent(event: MarketEvent): string {
  const cspr = (motes: bigint): string =>
    `${(Number(motes) / 1e9).toFixed(4)} CSPR`;

  switch (event.kind) {
    case "AssetRegistered":
      return `AssetRegistered  ${event.assetId} owner=${event.owner.slice(0, 20)}… max=${event.maxCurtailableW}W`;
    case "BaselineCommitted":
      return `BaselineCommitted ${event.assetId} commitment=${event.commitment.slice(0, 16)}… at=${event.committedAt}`;
    case "EventOpened":
      return `EventOpened      ${event.eventId} intervals=${event.startInterval}-${event.endInterval} price=${cspr(event.pricePerKwhMotes)}/kWh budget=${cspr(event.budgetMotes)} settleBy=${event.settlementDeadline}`;
    case "Pledged":
      return `Pledged          ${event.eventId}|${event.assetId} pledged=${event.pledgedWh}Wh`;
    case "Settled":
      return (
        `Settled          ${event.eventId}|${event.assetId} ` +
        `baseline=${event.unadjustedBaselineWh}->${event.adjustedBaselineWh}Wh ` +
        `adj=${event.adjustmentBps}bps${event.adjustmentClamped ? " (clamped)" : ""} ` +
        `actual=${event.actualWh}Wh delivered=${event.deliveredWh}Wh paid=${cspr(event.paidMotes)}`
      );
    case "BudgetWithdrawn":
      return `BudgetWithdrawn  ${event.eventId} refunded=${cspr(event.refundedMotes)}`;
  }
}
