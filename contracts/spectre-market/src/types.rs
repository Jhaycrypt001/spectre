//! Shared types for the Spectre market.

use odra::casper_types::bytesrepr::Bytes;
use odra::casper_types::U512;
use odra::prelude::*;

/// Number of historical days the 10-in-10 baseline requires.
pub const BASELINE_DAY_COUNT: u32 = 10;

/// Maximum day-of adjustment, in basis points (20%).
pub const MAX_ADJUSTMENT_BPS: i64 = 2_000;

/// One hundred percent in basis points.
pub const BPS_DENOMINATOR: i64 = 10_000;

/// Settlement intervals in a standard UK day (half-hourly).
pub const INTERVALS_PER_DAY: u32 = 48;

/// A registered flexible load.
#[odra::odra_type]
pub struct Asset {
    /// Account that receives settlement payments.
    pub owner: Address,
    /// Maximum curtailable power, in watts. Bounds how much may be pledged.
    pub max_curtailable_w: u64,
    /// Hash of the asset's historical baseline data. Committed before any event.
    pub baseline_commitment: Bytes,
    /// Block time at which the commitment was made.
    pub committed_at: u64,
    /// Whether the asset is accepting dispatch.
    pub active: bool,
}

/// A dispatch event: a buyer's funded request for demand reduction.
#[odra::odra_type]
pub struct DispatchEvent {
    /// Account that funded the event and receives any unspent budget back.
    pub buyer: Address,
    /// Settlement interval at which the curtailment window opens (inclusive).
    pub start_interval: u32,
    /// Settlement interval at which it closes (inclusive).
    pub end_interval: u32,
    /// Price paid per kilowatt-hour avoided, in motes.
    pub price_per_kwh_motes: U512,
    /// Total escrowed budget, in motes.
    pub budget_motes: U512,
    /// Budget already paid out, in motes.
    pub spent_motes: U512,
    /// Block time before which pledges must be submitted.
    pub pledge_deadline: u64,
    /// Block time after which the buyer may reclaim unspent budget.
    ///
    /// Strictly later than `pledge_deadline`. Between the two, pledgers have an
    /// exclusive, on-chain-enforced window to settle: the buyer cannot close the
    /// event and strand a delivered-but-unsettled pledge before this passes.
    pub settlement_deadline: u64,
    /// Whether the event has been closed and remaining budget withdrawn.
    pub closed: bool,
}

/// An agent's commitment to deliver reduction from a specific asset.
#[odra::odra_type]
pub struct Pledge {
    /// Watt-hours the agent commits to deliver across the window.
    pub pledged_wh: u64,
    /// Whether this pledge has been settled.
    pub settled: bool,
    /// Watt-hours actually verified as delivered at settlement.
    pub delivered_wh: u64,
    /// Motes paid out for this pledge.
    pub paid_motes: U512,
}

/// The full, auditable arithmetic of a settlement.
///
/// Every intermediate value is retained and emitted so a third party can recompute
/// the payout from chain data alone, without trusting the agent or the buyer.
#[odra::odra_type]
pub struct SettlementDetail {
    pub unadjusted_baseline_wh: u64,
    pub adjusted_baseline_wh: u64,
    pub adjustment_bps: i32,
    pub adjustment_clamped: bool,
    pub actual_wh: u64,
    pub delivered_wh: u64,
    pub paid_motes: U512,
}
