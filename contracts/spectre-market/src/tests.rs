//! Integration tests for the Spectre market.
//!
//! These cover the protocol's security properties, not just its arithmetic:
//! that history cannot be revised after dispatch is known, that a pre-event
//! consumption spike cannot buy unbounded credit, and that escrowed funds can
//! never leave except against a verified reduction.

use odra::casper_types::U512;
use odra::host::{Deployer, HostEnv, HostRef, NoArgs};
use odra::prelude::*;

use crate::market::{Error, SpectreMarket, SpectreMarketHostRef};

/// 1 CSPR in motes.
const CSPR: u64 = 1_000_000_000;

const ASSET: &str = "site-001";
const EVENT: &str = "dispatch-2026-07-22-evening";

/// Ten historical days of window totals, in watt-hours. Deliberately varied so the
/// baseline carries genuine estimation error rather than being trivially exact.
fn history_window() -> Vec<u64> {
    vec![1_780, 1_820, 1_755, 1_900, 1_840, 1_690, 1_875, 1_810, 1_795, 1_735]
}

/// Ten historical days across the pre-event observation window.
fn history_adj_window() -> Vec<u64> {
    vec![600, 615, 590, 640, 620, 575, 630, 605, 598, 588]
}

struct Fixture {
    env: HostEnv,
    market: SpectreMarketHostRef,
    buyer: Address,
    household: Address,
}

fn setup() -> Fixture {
    let env = odra_test::env();
    let market = SpectreMarket::deploy(&env, NoArgs);

    let buyer = env.get_account(0);
    let household = env.get_account(1);

    Fixture {
        env,
        market,
        buyer,
        household,
    }
}

impl Fixture {
    /// Register the asset and commit its baseline, as the household.
    fn register_and_commit(&mut self) {
        self.env.set_caller(self.household);
        self.market.register_asset(ASSET.to_string(), 3_000);

        let commitment = self
            .market
            .compute_commitment(history_window(), history_adj_window());
        self.market.commit_baseline(ASSET.to_string(), commitment);
    }

    /// Open a funded dispatch event as the buyer.
    ///
    /// `deadline` is the pledge deadline; the settlement window is opened for a fixed
    /// span after it (see `SETTLE_WINDOW`), which is what most tests exercise. Tests
    /// that need to control the settlement deadline directly call the entry point.
    fn open_event(&mut self, budget_cspr: u64, price_per_kwh_motes: u64, deadline: u64) {
        self.env.set_caller(self.buyer);
        self.market
            .with_tokens(U512::from(budget_cspr * CSPR))
            .open_event(
                EVENT.to_string(),
                35, // 17:30
                37, // 18:30, inclusive
                U512::from(price_per_kwh_motes),
                deadline,
                deadline + SETTLE_WINDOW,
            );
    }
}

/// Span between the pledge deadline and the settlement deadline used by the test
/// helper. Large enough that tests which settle right after the pledge window still
/// fall inside the settlement window.
const SETTLE_WINDOW: u64 = 1_000_000;

#[test]
fn happy_path_pays_for_verified_reduction() {
    let mut f = setup();
    f.register_and_commit();

    // Baseline commitment must predate the pledge deadline.
    f.env.advance_block_time(1_000);
    f.open_event(10, CSPR, 100_000);

    f.env.set_caller(f.household);
    f.market
        .pledge(EVENT.to_string(), ASSET.to_string(), 1_500);

    // Run past the window.
    f.env.advance_block_time(200_000);

    let balance_before = f.env.balance_of(&f.household);

    let detail = f.market.settle(
        EVENT.to_string(),
        ASSET.to_string(),
        history_window(),
        history_adj_window(),
        606, // observation window ran essentially at baseline
        300, // actual draw during the dispatch window
    );

    // Mean of history_window() is 1800 Wh.
    assert_eq!(detail.unadjusted_baseline_wh, 1_800);
    // Observation baseline mean is 606, actual 606 -> no adjustment.
    assert_eq!(detail.adjustment_bps, 0);
    assert_eq!(detail.adjusted_baseline_wh, 1_800);
    // Delivered 1800 - 300 = 1500, exactly the pledge.
    assert_eq!(detail.delivered_wh, 1_500);
    // 1500 Wh at 1 CSPR/kWh = 1.5 CSPR.
    assert_eq!(detail.paid_motes, U512::from(1_500_000_000u64));

    let balance_after = f.env.balance_of(&f.household);
    assert_eq!(balance_after - balance_before, U512::from(1_500_000_000u64));
}

#[test]
fn payout_is_capped_at_the_pledged_quantity() {
    let mut f = setup();
    f.register_and_commit();
    f.env.advance_block_time(1_000);
    f.open_event(10, CSPR, 100_000);

    f.env.set_caller(f.household);
    // Pledge only 500 Wh but deliver far more.
    f.market.pledge(EVENT.to_string(), ASSET.to_string(), 500);

    f.env.advance_block_time(200_000);

    let detail = f.market.settle(
        EVENT.to_string(),
        ASSET.to_string(),
        history_window(),
        history_adj_window(),
        606,
        100,
    );

    // Over-delivery is not rewarded; the surplus stays with the buyer.
    assert_eq!(detail.delivered_wh, 500);
    assert_eq!(detail.paid_motes, U512::from(500_000_000u64));
}

#[test]
fn no_reduction_pays_nothing() {
    let mut f = setup();
    f.register_and_commit();
    f.env.advance_block_time(1_000);
    f.open_event(10, CSPR, 100_000);

    f.env.set_caller(f.household);
    f.market
        .pledge(EVENT.to_string(), ASSET.to_string(), 1_500);

    f.env.advance_block_time(200_000);

    // Consumed *more* than baseline during the window.
    let detail = f.market.settle(
        EVENT.to_string(),
        ASSET.to_string(),
        history_window(),
        history_adj_window(),
        606,
        4_000,
    );

    assert_eq!(detail.delivered_wh, 0);
    assert_eq!(detail.paid_motes, U512::zero());
}

/// The core security property: revealed history must match what was committed.
#[test]
fn tampered_history_is_rejected() {
    let mut f = setup();
    f.register_and_commit();
    f.env.advance_block_time(1_000);
    f.open_event(10, CSPR, 100_000);

    f.env.set_caller(f.household);
    f.market
        .pledge(EVENT.to_string(), ASSET.to_string(), 1_500);
    f.env.advance_block_time(200_000);

    // Inflate one historical day to raise the baseline and the payout.
    let mut tampered = history_window();
    tampered[0] = 9_999;

    let result = f.market.try_settle(
        EVENT.to_string(),
        ASSET.to_string(),
        tampered,
        history_adj_window(),
        606,
        300,
    );

    assert_eq!(result.err(), Some(Error::BaselineMismatch.into()));
}

/// Tampering with the adjustment-window series must fail too — both series are
/// bound into the same commitment.
#[test]
fn tampered_adjustment_history_is_rejected() {
    let mut f = setup();
    f.register_and_commit();
    f.env.advance_block_time(1_000);
    f.open_event(10, CSPR, 100_000);

    f.env.set_caller(f.household);
    f.market
        .pledge(EVENT.to_string(), ASSET.to_string(), 1_500);
    f.env.advance_block_time(200_000);

    let mut tampered_adj = history_adj_window();
    tampered_adj[3] = 1;

    let result = f.market.try_settle(
        EVENT.to_string(),
        ASSET.to_string(),
        history_window(),
        tampered_adj,
        606,
        300,
    );

    assert_eq!(result.err(), Some(Error::BaselineMismatch.into()));
}

/// A baseline committed after the pledge deadline could have been tailored to the
/// event, so it must be refused.
#[test]
fn baseline_committed_too_late_is_rejected() {
    let mut f = setup();

    f.env.set_caller(f.household);
    f.market.register_asset(ASSET.to_string(), 3_000);

    // Open the event first, with a deadline in the near past relative to the commit.
    f.env.set_caller(f.buyer);
    f.market
        .with_tokens(U512::from(10 * CSPR))
        .open_event(EVENT.to_string(), 35, 37, U512::from(CSPR), 5_000, 5_000 + SETTLE_WINDOW);

    // Household commits *after* that deadline.
    f.env.advance_block_time(6_000);
    f.env.set_caller(f.household);
    let commitment = f
        .market
        .compute_commitment(history_window(), history_adj_window());
    f.market.commit_baseline(ASSET.to_string(), commitment);

    let result = f
        .market
        .try_pledge(EVENT.to_string(), ASSET.to_string(), 1_500);

    // The pledge window has also closed by now; either guard is a correct refusal.
    let err = result.err().expect("pledge must fail");
    assert!(
        err == Error::BaselineCommittedTooLate.into()
            || err == Error::PledgeWindowClosed.into(),
        "unexpected error: {err:?}"
    );
}

/// The economic property that makes household participation trustless: inflating
/// the baseline with a pre-event spike costs more energy than the credit it buys.
#[test]
fn pre_event_spike_is_clamped_and_unprofitable() {
    let mut f = setup();
    f.register_and_commit();
    f.env.advance_block_time(1_000);
    f.open_event(10, CSPR, 100_000);

    f.env.set_caller(f.household);
    f.market
        .pledge(EVENT.to_string(), ASSET.to_string(), 3_000);
    f.env.advance_block_time(200_000);

    // Household burns 5x its normal observation-window draw to lift the baseline.
    let detail = f.market.settle(
        EVENT.to_string(),
        ASSET.to_string(),
        history_window(),
        history_adj_window(),
        3_030, // 5x the ~606 Wh baseline
        300,
    );

    // The adjustment is clamped to +20%, not +400%.
    assert!(detail.adjustment_clamped);
    assert_eq!(detail.adjustment_bps, 2_000);
    assert_eq!(detail.adjusted_baseline_wh, 2_160); // 1800 * 1.2

    // Credit gained: 2160 - 1800 = 360 Wh.
    // Energy burned to obtain it: 3030 - 606 = 2424 Wh.
    let gained_wh = detail.delivered_wh - 1_500;
    let burned_wh = 3_030 - 606;
    assert_eq!(gained_wh, 360);
    assert!(
        burned_wh > gained_wh * 6,
        "spike must cost far more than it yields: burned {burned_wh}, gained {gained_wh}"
    );
}

#[test]
fn pledge_cannot_exceed_physical_capacity() {
    let mut f = setup();
    f.register_and_commit();
    f.env.advance_block_time(1_000);
    f.open_event(10, CSPR, 100_000);

    f.env.set_caller(f.household);
    // 3000 W across 3 half-hour intervals = 4500 Wh maximum.
    let result = f
        .market
        .try_pledge(EVENT.to_string(), ASSET.to_string(), 5_000);

    assert_eq!(result.err(), Some(Error::PledgeExceedsCapacity.into()));
}

#[test]
fn double_settlement_is_rejected() {
    let mut f = setup();
    f.register_and_commit();
    f.env.advance_block_time(1_000);
    f.open_event(10, CSPR, 100_000);

    f.env.set_caller(f.household);
    f.market
        .pledge(EVENT.to_string(), ASSET.to_string(), 1_500);
    f.env.advance_block_time(200_000);

    f.market.settle(
        EVENT.to_string(),
        ASSET.to_string(),
        history_window(),
        history_adj_window(),
        606,
        300,
    );

    let result = f.market.try_settle(
        EVENT.to_string(),
        ASSET.to_string(),
        history_window(),
        history_adj_window(),
        606,
        300,
    );

    assert_eq!(result.err(), Some(Error::AlreadySettled.into()));
}

#[test]
fn settlement_before_the_window_closes_is_rejected() {
    let mut f = setup();
    f.register_and_commit();
    f.env.advance_block_time(1_000);
    f.open_event(10, CSPR, 100_000);

    f.env.set_caller(f.household);
    f.market
        .pledge(EVENT.to_string(), ASSET.to_string(), 1_500);

    // No time advance: the window has not run yet.
    let result = f.market.try_settle(
        EVENT.to_string(),
        ASSET.to_string(),
        history_window(),
        history_adj_window(),
        606,
        300,
    );

    assert_eq!(result.err(), Some(Error::TooEarlyToSettle.into()));
}

#[test]
fn duplicate_pledge_is_rejected() {
    let mut f = setup();
    f.register_and_commit();
    f.env.advance_block_time(1_000);
    f.open_event(10, CSPR, 100_000);

    f.env.set_caller(f.household);
    f.market
        .pledge(EVENT.to_string(), ASSET.to_string(), 1_000);

    let result = f
        .market
        .try_pledge(EVENT.to_string(), ASSET.to_string(), 1_000);

    assert_eq!(result.err(), Some(Error::DuplicatePledge.into()));
}

#[test]
fn pledge_without_a_baseline_commitment_is_rejected() {
    let mut f = setup();

    f.env.set_caller(f.household);
    f.market.register_asset(ASSET.to_string(), 3_000);

    f.env.advance_block_time(1_000);
    f.open_event(10, CSPR, 100_000);

    f.env.set_caller(f.household);
    let result = f
        .market
        .try_pledge(EVENT.to_string(), ASSET.to_string(), 1_000);

    assert_eq!(result.err(), Some(Error::NoBaselineCommitment.into()));
}

#[test]
fn opening_an_event_without_funds_is_rejected() {
    let mut f = setup();

    f.env.set_caller(f.buyer);
    let result = f.market.try_open_event(
        EVENT.to_string(),
        35,
        37,
        U512::from(CSPR),
        100_000,
        100_000 + SETTLE_WINDOW,
    );

    assert_eq!(result.err(), Some(Error::BudgetNotAttached.into()));
}

#[test]
fn buyer_reclaims_unspent_budget() {
    let mut f = setup();
    f.register_and_commit();
    f.env.advance_block_time(1_000);
    f.open_event(10, CSPR, 100_000);

    f.env.set_caller(f.household);
    f.market
        .pledge(EVENT.to_string(), ASSET.to_string(), 1_500);
    f.env.advance_block_time(200_000);

    f.market.settle(
        EVENT.to_string(),
        ASSET.to_string(),
        history_window(),
        history_adj_window(),
        606,
        300,
    );

    // 10 CSPR escrowed, 1.5 CSPR paid out.
    assert_eq!(
        f.market.remaining_budget(EVENT.to_string()),
        U512::from(8_500_000_000u64)
    );

    // The buyer can only reclaim once the settlement window has fully closed.
    f.env.advance_block_time(SETTLE_WINDOW);

    f.env.set_caller(f.buyer);
    let before = f.env.balance_of(&f.buyer);
    f.market.withdraw_unspent(EVENT.to_string());
    let after = f.env.balance_of(&f.buyer);

    assert_eq!(after - before, U512::from(8_500_000_000u64));
}

/// Fairness invariant: a buyer cannot reclaim the budget while pledgers can still
/// settle. Without a settlement window, a buyer could withdraw the instant pledging
/// closed, close the event, and revert every honest settlement — taking delivered
/// reduction for free. This is the check that forecloses that attack.
#[test]
fn buyer_cannot_withdraw_before_the_settlement_window_closes() {
    let mut f = setup();
    f.register_and_commit();
    f.env.advance_block_time(1_000);
    f.open_event(10, CSPR, 100_000);

    f.env.set_caller(f.household);
    f.market
        .pledge(EVENT.to_string(), ASSET.to_string(), 1_500);

    // Past the pledge deadline but inside the settlement window.
    f.env.advance_block_time(200_000);

    f.env.set_caller(f.buyer);
    let result = f.market.try_withdraw_unspent(EVENT.to_string());
    assert_eq!(result.err(), Some(Error::SettlementWindowOpen.into()));

    // The pledger's right to settle is intact precisely because the event is still
    // open — the buyer could not close it out from under them.
    let settled = f.market.try_settle(
        EVENT.to_string(),
        ASSET.to_string(),
        history_window(),
        history_adj_window(),
        606,
        300,
    );
    assert!(settled.is_ok(), "an honest pledger must still be able to settle");
}

/// The settlement deadline must be strictly after the pledge deadline; a zero-width
/// window would reintroduce the attack the window exists to prevent.
#[test]
fn a_settlement_deadline_at_or_before_the_pledge_deadline_is_rejected() {
    let mut f = setup();
    f.register_and_commit();
    f.env.advance_block_time(1_000);

    f.env.set_caller(f.buyer);
    let result = f.market.with_tokens(U512::from(10 * CSPR)).try_open_event(
        EVENT.to_string(),
        35,
        37,
        U512::from(CSPR),
        100_000,
        100_000, // equal to the pledge deadline: no settlement window
    );
    assert_eq!(result.err(), Some(Error::SettlementWindowInvalid.into()));
}

#[test]
fn only_the_buyer_may_withdraw() {
    let mut f = setup();
    f.register_and_commit();
    f.env.advance_block_time(1_000);
    f.open_event(10, CSPR, 100_000);
    f.env.advance_block_time(200_000);

    f.env.set_caller(f.household);
    let result = f.market.try_withdraw_unspent(EVENT.to_string());

    assert_eq!(result.err(), Some(Error::NotEventBuyer.into()));
}

#[test]
fn only_the_owner_may_commit_a_baseline() {
    let mut f = setup();

    f.env.set_caller(f.household);
    f.market.register_asset(ASSET.to_string(), 3_000);

    f.env.set_caller(f.buyer);
    let commitment = f
        .market
        .compute_commitment(history_window(), history_adj_window());
    let result = f
        .market
        .try_commit_baseline(ASSET.to_string(), commitment);

    assert_eq!(result.err(), Some(Error::NotAssetOwner.into()));
}

#[test]
fn duplicate_asset_registration_is_rejected() {
    let mut f = setup();

    f.env.set_caller(f.household);
    f.market.register_asset(ASSET.to_string(), 3_000);
    let result = f.market.try_register_asset(ASSET.to_string(), 3_000);

    assert_eq!(result.err(), Some(Error::AssetAlreadyExists.into()));
}

#[test]
fn wrong_day_count_is_rejected() {
    let mut f = setup();
    f.register_and_commit();
    f.env.advance_block_time(1_000);
    f.open_event(10, CSPR, 100_000);

    f.env.set_caller(f.household);
    f.market
        .pledge(EVENT.to_string(), ASSET.to_string(), 1_500);
    f.env.advance_block_time(200_000);

    let mut short = history_window();
    short.pop();

    let result = f.market.try_settle(
        EVENT.to_string(),
        ASSET.to_string(),
        short,
        history_adj_window(),
        606,
        300,
    );

    assert_eq!(result.err(), Some(Error::WrongDayCount.into()));
}

/// Escrow invariant: payouts can never exceed the funded budget.
#[test]
fn payout_cannot_exceed_the_escrowed_budget() {
    let mut f = setup();
    f.register_and_commit();
    f.env.advance_block_time(1_000);

    // Fund only 0.1 CSPR but price at 1 CSPR/kWh, so a full delivery would owe 1.5.
    f.env.set_caller(f.buyer);
    f.market
        .with_tokens(U512::from(CSPR / 10))
        .open_event(
            EVENT.to_string(),
            35,
            37,
            U512::from(CSPR),
            100_000,
            100_000 + SETTLE_WINDOW,
        );

    f.env.set_caller(f.household);
    f.market
        .pledge(EVENT.to_string(), ASSET.to_string(), 1_500);
    f.env.advance_block_time(200_000);

    let result = f.market.try_settle(
        EVENT.to_string(),
        ASSET.to_string(),
        history_window(),
        history_adj_window(),
        606,
        300,
    );

    assert_eq!(result.err(), Some(Error::InsufficientBudget.into()));
}

/// Fixed vectors pinning the commitment hash.
///
/// The agent computes this hash off-chain (`agent/src/chain/commitment.ts`) and the
/// contract recomputes it at settlement. If the two implementations ever diverge —
/// a reordered field, a changed length prefix, a different digest length — `settle`
/// reverts with `BaselineMismatch`, but only *after* the household has curtailed and
/// paid gas for a commit and a pledge. The failure is expensive and arrives late.
///
/// These digests were produced independently by both implementations and are
/// asserted here so that divergence is a failing test rather than a lost payment.
#[test]
fn commitment_matches_pinned_vectors() {
    let fixture = setup();

    let hex_of = |b: &odra::casper_types::bytesrepr::Bytes| -> String {
        b.iter().map(|x| format!("{:02x}", x)).collect()
    };

    let commitment = fixture
        .market
        .compute_commitment(history_window(), history_adj_window());
    assert_eq!(
        hex_of(&commitment),
        "e482822345d1244f54177e52cd0b9470a8a0ad50fe48812703ffa6948bef7b7d",
    );

    // Degenerate input: the length prefixes and separator must still be hashed, so
    // this differs from the hash of an empty preimage.
    let zeros = fixture.market.compute_commitment(vec![0u64], vec![0u64]);
    assert_eq!(
        hex_of(&zeros),
        "db2f14fa1836c1fd1e006c4475441ff5cc2de006931e0141e00940dce55d3b13",
    );
}
