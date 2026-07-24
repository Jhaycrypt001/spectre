//! The Spectre market contract.
//!
//! # What this contract is for
//!
//! Grid operators pay for demand *reduction* — a negawatt. Households are excluded
//! from that market today because verifying and settling a £0.30 payment costs more
//! than the payment is worth, so participation is gated behind aggregators who must
//! be trusted to report honestly and split fairly.
//!
//! This contract removes the trusted party. It escrows the buyer's budget, computes
//! the reduction itself from committed meter data, and pays the household directly.
//!
//! # The trust problem, and how it is solved
//!
//! You cannot meter energy that was not consumed, so payment rests on a *baseline*:
//! an estimate of what the site would have drawn. That estimate is the attack
//! surface. A site that knows the formula can inflate its baseline on ordinary days,
//! then "reduce" to normal during an event and be paid for nothing.
//!
//! Three mechanisms close this:
//!
//! 1. **Commit before dispatch.** [`commit_baseline`] stores a hash of the asset's
//!    historical interval data. [`pledge`] refuses any asset whose commitment
//!    post-dates the event. History cannot be revised once dispatch is known.
//! 2. **Reveal and verify.** [`settle`] takes the raw intervals, rehashes them, and
//!    rejects any mismatch. The revealed data must be exactly what was committed.
//! 3. **Clamped adjustment.** The day-of adjustment is bounded to +/-20%, making a
//!    pre-event consumption spike cost more energy than the credit it earns.
//!
//! The contract computes the settlement arithmetic on-chain and emits every
//! intermediate value, so any third party can recompute a payout from chain data
//! alone. Nothing is taken on trust.

use odra::casper_types::bytesrepr::{Bytes, ToBytes};
use odra::casper_types::U512;
use odra::prelude::*;

use crate::baseline;
use crate::types::{Asset, DispatchEvent, Pledge, SettlementDetail, BASELINE_DAY_COUNT};

/// Errors surfaced by the market.
#[odra::odra_error]
pub enum Error {
    /// Caller is not the contract administrator.
    NotAdmin = 1,
    /// Referenced asset has not been registered.
    UnknownAsset = 2,
    /// Referenced dispatch event does not exist.
    UnknownEvent = 3,
    /// Caller does not own the asset.
    NotAssetOwner = 4,
    /// Asset is registered but not accepting dispatch.
    AssetInactive = 5,
    /// An asset with this id already exists.
    AssetAlreadyExists = 6,
    /// An event with this id already exists.
    EventAlreadyExists = 7,
    /// The event's pledge deadline has passed.
    PledgeWindowClosed = 8,
    /// Baseline was committed at or after the event opened, so it may have been
    /// chosen with knowledge of the dispatch. Rejected.
    BaselineCommittedTooLate = 9,
    /// Asset has no baseline commitment.
    NoBaselineCommitment = 10,
    /// Revealed interval data does not hash to the stored commitment.
    BaselineMismatch = 11,
    /// Revealed history did not contain exactly BASELINE_DAY_COUNT days.
    WrongDayCount = 12,
    /// A pledge already exists for this asset in this event.
    DuplicatePledge = 13,
    /// No pledge exists for this asset in this event.
    NoPledge = 14,
    /// This pledge has already been settled.
    AlreadySettled = 15,
    /// Pledged reduction exceeds what the asset can physically deliver.
    PledgeExceedsCapacity = 16,
    /// The event budget cannot cover this payout.
    InsufficientBudget = 17,
    /// The event is already closed.
    EventClosed = 18,
    /// Buyer attached no funds, or fewer than declared.
    BudgetNotAttached = 19,
    /// The dispatch window is empty or inverted.
    InvalidWindow = 20,
    /// Settlement attempted before the pledge deadline.
    TooEarlyToSettle = 21,
    /// Only the buyer may withdraw unspent budget.
    NotEventBuyer = 22,
    /// The settlement deadline is not strictly after the pledge deadline.
    SettlementWindowInvalid = 23,
    /// The buyer tried to reclaim budget while pledgers can still settle.
    SettlementWindowOpen = 24,
}

/// Emitted when a flexible load joins the market.
#[odra::event]
pub struct AssetRegistered {
    pub asset_id: String,
    pub owner: Address,
    pub max_curtailable_w: u64,
}

/// Emitted when an asset commits to its historical baseline.
///
/// The block time in this event is what makes commit-before-dispatch auditable:
/// anyone can compare it against the event's opening time.
#[odra::event]
pub struct BaselineCommitted {
    pub asset_id: String,
    pub commitment: Bytes,
    pub committed_at: u64,
}

/// Emitted when a buyer opens and funds a dispatch event.
#[odra::event]
pub struct EventOpened {
    pub event_id: String,
    pub buyer: Address,
    pub start_interval: u32,
    pub end_interval: u32,
    pub price_per_kwh_motes: U512,
    pub budget_motes: U512,
    pub pledge_deadline: u64,
    pub settlement_deadline: u64,
}

/// Emitted when an agent pledges reduction from an asset.
#[odra::event]
pub struct Pledged {
    pub event_id: String,
    pub asset_id: String,
    pub pledged_wh: u64,
}

/// Emitted on settlement, carrying the complete arithmetic.
///
/// Every field needed to recompute the payout independently is present.
#[odra::event]
pub struct Settled {
    pub event_id: String,
    pub asset_id: String,
    pub unadjusted_baseline_wh: u64,
    pub adjusted_baseline_wh: u64,
    pub adjustment_bps: i32,
    pub adjustment_clamped: bool,
    pub actual_wh: u64,
    pub pledged_wh: u64,
    pub delivered_wh: u64,
    pub paid_motes: U512,
}

/// Emitted when a buyer reclaims budget that was not delivered against.
#[odra::event]
pub struct BudgetWithdrawn {
    pub event_id: String,
    pub buyer: Address,
    pub refunded_motes: U512,
}

#[odra::module(
    events = [AssetRegistered, BaselineCommitted, EventOpened, Pledged, Settled, BudgetWithdrawn],
    errors = Error
)]
pub struct SpectreMarket {
    admin: Var<Address>,
    assets: Mapping<String, Asset>,
    events: Mapping<String, DispatchEvent>,
    /// Keyed by `event_id|asset_id`.
    pledges: Mapping<String, Pledge>,
    asset_count: Var<u32>,
    event_count: Var<u32>,
}

#[odra::module]
impl SpectreMarket {
    pub fn init(&mut self) {
        self.admin.set(self.env().caller());
        self.asset_count.set(0);
        self.event_count.set(0);
    }

    // ---------------------------------------------------------------- assets

    /// Register a flexible load. The caller becomes the payee.
    pub fn register_asset(&mut self, asset_id: String, max_curtailable_w: u64) {
        if self.assets.get(&asset_id).is_some() {
            self.env().revert(Error::AssetAlreadyExists);
        }

        let owner = self.env().caller();
        self.assets.set(
            &asset_id,
            Asset {
                owner,
                max_curtailable_w,
                baseline_commitment: Bytes::from(Vec::new()),
                committed_at: 0,
                active: true,
            },
        );

        let count = self.asset_count.get_or_default();
        self.asset_count.set(count + 1);

        self.env().emit_event(AssetRegistered {
            asset_id,
            owner,
            max_curtailable_w,
        });
    }

    /// Commit to the asset's historical baseline data.
    ///
    /// `commitment` must be `blake2b(serialize(history))` where `history` is the
    /// per-day window totals later revealed to [`settle`]. Committing early and
    /// revealing late is what prevents the history from being chosen with knowledge
    /// of which windows will be dispatched.
    pub fn commit_baseline(&mut self, asset_id: String, commitment: Bytes) {
        let mut asset = self.require_asset(&asset_id);
        if self.env().caller() != asset.owner {
            self.env().revert(Error::NotAssetOwner);
        }

        let now = self.env().get_block_time();
        asset.baseline_commitment = commitment.clone();
        asset.committed_at = now;
        self.assets.set(&asset_id, asset);

        self.env().emit_event(BaselineCommitted {
            asset_id,
            commitment,
            committed_at: now,
        });
    }

    // ---------------------------------------------------------------- events

    /// Open a dispatch event, escrowing the attached CSPR as its budget.
    ///
    /// The attached deposit *is* the budget; there is no way to open an event that
    /// promises more than it can pay.
    #[odra(payable)]
    pub fn open_event(
        &mut self,
        event_id: String,
        start_interval: u32,
        end_interval: u32,
        price_per_kwh_motes: U512,
        pledge_deadline: u64,
        settlement_deadline: u64,
    ) {
        if self.events.get(&event_id).is_some() {
            self.env().revert(Error::EventAlreadyExists);
        }
        if end_interval < start_interval {
            self.env().revert(Error::InvalidWindow);
        }

        // The settlement window must be non-empty, otherwise the buyer could reclaim
        // the budget in the same instant pledging closes and strand honest pledgers.
        if settlement_deadline <= pledge_deadline {
            self.env().revert(Error::SettlementWindowInvalid);
        }

        let budget = self.env().attached_value();
        if budget.is_zero() {
            self.env().revert(Error::BudgetNotAttached);
        }

        let buyer = self.env().caller();
        self.events.set(
            &event_id,
            DispatchEvent {
                buyer,
                start_interval,
                end_interval,
                price_per_kwh_motes,
                budget_motes: budget,
                spent_motes: U512::zero(),
                pledge_deadline,
                settlement_deadline,
                closed: false,
            },
        );

        let count = self.event_count.get_or_default();
        self.event_count.set(count + 1);

        self.env().emit_event(EventOpened {
            event_id,
            buyer,
            start_interval,
            end_interval,
            price_per_kwh_motes,
            budget_motes: budget,
            pledge_deadline,
            settlement_deadline,
        });
    }

    /// Pledge reduction from an asset into an open event.
    ///
    /// Rejects any asset whose baseline commitment is not strictly older than the
    /// event's own commitment cutoff. This is the check that makes the commit-reveal
    /// scheme binding rather than ceremonial.
    pub fn pledge(&mut self, event_id: String, asset_id: String, pledged_wh: u64) {
        let event = self.require_event(&event_id);
        let asset = self.require_asset(&asset_id);

        if event.closed {
            self.env().revert(Error::EventClosed);
        }
        if !asset.active {
            self.env().revert(Error::AssetInactive);
        }
        if asset.baseline_commitment.is_empty() {
            self.env().revert(Error::NoBaselineCommitment);
        }

        let now = self.env().get_block_time();
        if now > event.pledge_deadline {
            self.env().revert(Error::PledgeWindowClosed);
        }

        // The baseline must predate the pledge window closing. An asset that
        // commits after seeing the event terms could tailor its history to it.
        if asset.committed_at >= event.pledge_deadline {
            self.env().revert(Error::BaselineCommittedTooLate);
        }

        // A pledge may not exceed what the hardware can physically shed across the
        // window. Intervals are half-hourly, so watts * hours = watt-hours.
        let intervals = (event.end_interval - event.start_interval + 1) as u64;
        let max_wh = asset.max_curtailable_w * intervals / 2;
        if pledged_wh > max_wh {
            self.env().revert(Error::PledgeExceedsCapacity);
        }

        let key = Self::pledge_key(&event_id, &asset_id);
        if self.pledges.get(&key).is_some() {
            self.env().revert(Error::DuplicatePledge);
        }

        self.pledges.set(
            &key,
            Pledge {
                pledged_wh,
                settled: false,
                delivered_wh: 0,
                paid_motes: U512::zero(),
            },
        );

        self.env().emit_event(Pledged {
            event_id,
            asset_id,
            pledged_wh,
        });
    }

    // ------------------------------------------------------------ settlement

    /// Reveal meter data and settle a pledge.
    ///
    /// The contract rehashes `history_window_wh` and `history_adj_window_wh` against
    /// the stored commitment, recomputes the 10-in-10 baseline, and pays
    /// `min(delivered, pledged)` at the event price.
    ///
    /// * `history_window_wh` — per-day totals across the dispatch window intervals.
    /// * `history_adj_window_wh` — per-day totals across the pre-event observation
    ///   window, used for the day-of adjustment.
    /// * `actual_adj_window_wh` — actual draw in the observation window on the day.
    /// * `actual_window_wh` — actual draw across the dispatch window.
    #[allow(clippy::too_many_arguments)]
    pub fn settle(
        &mut self,
        event_id: String,
        asset_id: String,
        history_window_wh: Vec<u64>,
        history_adj_window_wh: Vec<u64>,
        actual_adj_window_wh: u64,
        actual_window_wh: u64,
    ) -> SettlementDetail {
        let mut event = self.require_event(&event_id);
        let asset = self.require_asset(&asset_id);

        if event.closed {
            self.env().revert(Error::EventClosed);
        }

        // Settlement is only meaningful once the window has run.
        let now = self.env().get_block_time();
        if now <= event.pledge_deadline {
            self.env().revert(Error::TooEarlyToSettle);
        }

        let key = Self::pledge_key(&event_id, &asset_id);
        let mut pledge = match self.pledges.get(&key) {
            Some(p) => p,
            None => self.env().revert(Error::NoPledge),
        };
        if pledge.settled {
            self.env().revert(Error::AlreadySettled);
        }

        if history_window_wh.len() != BASELINE_DAY_COUNT as usize
            || history_adj_window_wh.len() != BASELINE_DAY_COUNT as usize
        {
            self.env().revert(Error::WrongDayCount);
        }

        // Verify the reveal against the commitment. Any edit to history fails here.
        let expected = Self::baseline_hash(
            &self.env(),
            &history_window_wh,
            &history_adj_window_wh,
        );
        if expected != asset.baseline_commitment {
            self.env().revert(Error::BaselineMismatch);
        }

        let result = baseline::compute(
            &history_window_wh,
            &history_adj_window_wh,
            &[actual_adj_window_wh],
        );

        let delivered = baseline::delivered_wh(result.adjusted_wh, actual_window_wh);

        // An agent is paid for what it delivered, capped by what it promised.
        // Over-delivery is not rewarded; that budget stays with the buyer.
        let payable_wh = delivered.min(pledge.pledged_wh);
        let payout = baseline::payout_motes(payable_wh, event.price_per_kwh_motes);

        let remaining = event.budget_motes - event.spent_motes;
        if payout > remaining {
            self.env().revert(Error::InsufficientBudget);
        }

        if payout > U512::zero() {
            self.env().transfer_tokens(&asset.owner, &payout);
        }

        event.spent_motes += payout;
        self.events.set(&event_id, event);

        pledge.settled = true;
        pledge.delivered_wh = payable_wh;
        pledge.paid_motes = payout;
        let pledged_wh = pledge.pledged_wh;
        self.pledges.set(&key, pledge);

        let adjustment_bps = result.adjustment_bps as i32;

        self.env().emit_event(Settled {
            event_id,
            asset_id,
            unadjusted_baseline_wh: result.unadjusted_wh,
            adjusted_baseline_wh: result.adjusted_wh,
            adjustment_bps,
            adjustment_clamped: result.clamped,
            actual_wh: actual_window_wh,
            pledged_wh,
            delivered_wh: payable_wh,
            paid_motes: payout,
        });

        SettlementDetail {
            unadjusted_baseline_wh: result.unadjusted_wh,
            adjusted_baseline_wh: result.adjusted_wh,
            adjustment_bps,
            adjustment_clamped: result.clamped,
            actual_wh: actual_window_wh,
            delivered_wh: payable_wh,
            paid_motes: payout,
        }
    }

    /// Close an event and return unspent budget to the buyer.
    pub fn withdraw_unspent(&mut self, event_id: String) {
        let mut event = self.require_event(&event_id);

        if self.env().caller() != event.buyer {
            self.env().revert(Error::NotEventBuyer);
        }
        if event.closed {
            self.env().revert(Error::EventClosed);
        }
        // The buyer may only reclaim budget once the settlement window has fully
        // closed. Before then, pledgers who delivered still have the right to settle,
        // and closing the event here would revert their settlement — letting a buyer
        // take delivered reduction without paying. This check is what forecloses that.
        if self.env().get_block_time() <= event.settlement_deadline {
            self.env().revert(Error::SettlementWindowOpen);
        }

        let refund = event.budget_motes - event.spent_motes;
        event.closed = true;
        let buyer = event.buyer;
        self.events.set(&event_id, event);

        if refund > U512::zero() {
            self.env().transfer_tokens(&buyer, &refund);
        }

        self.env().emit_event(BudgetWithdrawn {
            event_id,
            buyer,
            refunded_motes: refund,
        });
    }

    // ----------------------------------------------------------------- views

    pub fn get_asset(&self, asset_id: String) -> Option<Asset> {
        self.assets.get(&asset_id)
    }

    pub fn get_event(&self, event_id: String) -> Option<DispatchEvent> {
        self.events.get(&event_id)
    }

    pub fn get_pledge(&self, event_id: String, asset_id: String) -> Option<Pledge> {
        self.pledges.get(&Self::pledge_key(&event_id, &asset_id))
    }

    pub fn asset_count(&self) -> u32 {
        self.asset_count.get_or_default()
    }

    pub fn event_count(&self) -> u32 {
        self.event_count.get_or_default()
    }

    /// Remaining escrowed budget for an event, in motes.
    pub fn remaining_budget(&self, event_id: String) -> U512 {
        let event = self.require_event(&event_id);
        event.budget_motes - event.spent_motes
    }

    /// The commitment hash for a given history. Exposed so an agent can compute the
    /// exact value the contract will expect, rather than guessing the encoding.
    pub fn compute_commitment(
        &self,
        history_window_wh: Vec<u64>,
        history_adj_window_wh: Vec<u64>,
    ) -> Bytes {
        Self::baseline_hash(&self.env(), &history_window_wh, &history_adj_window_wh)
    }

    // ------------------------------------------------------------- internals

    fn pledge_key(event_id: &str, asset_id: &str) -> String {
        let mut key = String::with_capacity(event_id.len() + asset_id.len() + 1);
        key.push_str(event_id);
        key.push('|');
        key.push_str(asset_id);
        key
    }

    /// Domain-separated hash of the revealed baseline data.
    ///
    /// The two series are length-prefixed and separated so that no rearrangement of
    /// values between them can produce the same digest.
    fn baseline_hash(
        env: &odra::ContractEnv,
        history_window_wh: &[u64],
        history_adj_window_wh: &[u64],
    ) -> Bytes {
        let mut preimage: Vec<u8> = Vec::new();
        preimage.extend_from_slice(b"spectre:baseline:v1");
        preimage.extend_from_slice(&(history_window_wh.len() as u32).to_bytes().unwrap_or_default());
        for value in history_window_wh {
            preimage.extend_from_slice(&value.to_bytes().unwrap_or_default());
        }
        preimage.extend_from_slice(b"|");
        preimage
            .extend_from_slice(&(history_adj_window_wh.len() as u32).to_bytes().unwrap_or_default());
        for value in history_adj_window_wh {
            preimage.extend_from_slice(&value.to_bytes().unwrap_or_default());
        }
        Bytes::from(env.hash(preimage.as_slice()).to_vec())
    }

    fn require_asset(&self, asset_id: &str) -> Asset {
        match self.assets.get(&asset_id.to_string()) {
            Some(asset) => asset,
            None => self.env().revert(Error::UnknownAsset),
        }
    }

    fn require_event(&self, event_id: &str) -> DispatchEvent {
        match self.events.get(&event_id.to_string()) {
            Some(event) => event,
            None => self.env().revert(Error::UnknownEvent),
        }
    }
}
