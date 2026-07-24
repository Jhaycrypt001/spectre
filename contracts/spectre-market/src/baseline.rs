//! On-chain Customer Baseline Load (CBL) calculation.
//!
//! Implements the CAISO **10-in-10 baseline with a symmetric day-of adjustment**.
//! It is implemented here in `no_std` so that the *contract* — not the agent, not the
//! buyer, and not an oracle — is the party that computes what a household is owed.
//!
//! All arithmetic is integer. Watt-hours are `u64`, ratios are basis points. Floating
//! point is never used: this must be bit-for-bit reproducible across every node.

use odra::casper_types::U512;

use crate::types::{BPS_DENOMINATOR, MAX_ADJUSTMENT_BPS};

/// Outcome of a baseline computation.
pub struct BaselineResult {
    pub unadjusted_wh: u64,
    pub adjusted_wh: u64,
    pub adjustment_bps: i64,
    pub clamped: bool,
}

/// Mean of a slice, rounded to nearest. Returns 0 for an empty slice.
pub fn mean_round(values: &[u64]) -> u64 {
    if values.is_empty() {
        return 0;
    }
    let mut sum: u128 = 0;
    for &v in values {
        sum += v as u128;
    }
    let n = values.len() as u128;
    ((sum + n / 2) / n) as u64
}

/// Sum a slice as u128 to make overflow structurally impossible.
fn sum_u128(values: &[u64]) -> u128 {
    let mut total: u128 = 0;
    for &v in values {
        total += v as u128;
    }
    total
}

/// Day-of adjustment in basis points, clamped to +/- [`MAX_ADJUSTMENT_BPS`].
///
/// The clamp is the anti-gaming property: without it, a site could inflate its
/// payout without bound by spiking consumption immediately before the window.
/// Returns `(bps, clamped)`.
pub fn adjustment_bps(baseline_window_wh: &[u64], actual_window_wh: &[u64]) -> (i64, bool) {
    let baseline_sum = sum_u128(baseline_window_wh);
    let actual_sum = sum_u128(actual_window_wh);

    // No historical draw means no meaningful ratio; apply no adjustment.
    if baseline_sum == 0 {
        return (0, false);
    }

    let delta = actual_sum as i128 - baseline_sum as i128;
    let raw_bps = (delta * BPS_DENOMINATOR as i128) / baseline_sum as i128;

    let max = MAX_ADJUSTMENT_BPS as i128;
    let clamped = raw_bps > max || raw_bps < -max;
    let bounded = if raw_bps > max {
        max
    } else if raw_bps < -max {
        -max
    } else {
        raw_bps
    };

    (bounded as i64, clamped)
}

/// Apply a basis-point adjustment to a baseline, saturating at zero.
pub fn apply_adjustment(baseline_wh: u64, bps: i64) -> u64 {
    let scaled = (baseline_wh as i128 * (BPS_DENOMINATOR + bps) as i128) / BPS_DENOMINATOR as i128;
    if scaled < 0 {
        0
    } else {
        scaled as u64
    }
}

/// Compute the adjusted baseline for a dispatch window.
///
/// * `history_by_day` — one entry per historical day, each the total watt-hours that
///   day drew across the *dispatch window* intervals.
/// * `baseline_adj_window` — per-day totals across the *pre-event observation* window.
/// * `actual_adj_window` — actual draw in the observation window on the event day.
pub fn compute(
    history_by_day: &[u64],
    baseline_adj_window: &[u64],
    actual_adj_window: &[u64],
) -> BaselineResult {
    let unadjusted = mean_round(history_by_day);

    // The observation window's own baseline is the mean across the same days.
    let adj_baseline_mean = mean_round(baseline_adj_window);
    let actual_total = sum_u128(actual_adj_window);

    // Compare like with like: mean historical draw vs. actual draw for the window.
    let (bps, clamped) = adjustment_bps(
        &[adj_baseline_mean],
        &[actual_total.min(u64::MAX as u128) as u64],
    );

    let adjusted = apply_adjustment(unadjusted, bps);

    BaselineResult {
        unadjusted_wh: unadjusted,
        adjusted_wh: adjusted,
        adjustment_bps: bps,
        clamped,
    }
}

/// Verified reduction: `max(0, adjusted_baseline - actual)`.
pub fn delivered_wh(adjusted_baseline_wh: u64, actual_wh: u64) -> u64 {
    adjusted_baseline_wh.saturating_sub(actual_wh)
}

/// Payment in motes for a delivered quantity, truncating fractions of a mote.
///
/// `delivered_wh * price_per_kwh / 1000` — integer division means any remainder
/// favours the buyer's escrow rather than silently rounding funds into existence.
pub fn payout_motes(delivered_wh: u64, price_per_kwh_motes: U512) -> U512 {
    if delivered_wh == 0 {
        return U512::zero();
    }
    price_per_kwh_motes * U512::from(delivered_wh) / U512::from(1_000u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mean_rounds_to_nearest() {
        assert_eq!(mean_round(&[1_000, 1_000, 1_005]), 1_002);
        assert_eq!(mean_round(&[]), 0);
    }

    #[test]
    fn no_adjustment_when_matching_history() {
        let (bps, clamped) = adjustment_bps(&[1_000], &[1_000]);
        assert_eq!(bps, 0);
        assert!(!clamped);
    }

    #[test]
    fn positive_adjustment_on_a_hot_day() {
        let (bps, clamped) = adjustment_bps(&[1_000], &[1_100]);
        assert_eq!(bps, 1_000); // +10%
        assert!(!clamped);
    }

    #[test]
    fn adjustment_clamps_against_pre_event_spike() {
        // Attacker draws 5x baseline before the window to inflate the adjustment.
        let (bps, clamped) = adjustment_bps(&[1_000], &[5_000]);
        assert_eq!(bps, MAX_ADJUSTMENT_BPS);
        assert!(clamped);
    }

    #[test]
    fn clamp_is_symmetric() {
        let (bps, clamped) = adjustment_bps(&[1_000], &[1]);
        assert_eq!(bps, -MAX_ADJUSTMENT_BPS);
        assert!(clamped);
    }

    #[test]
    fn zero_baseline_gives_no_adjustment() {
        let (bps, clamped) = adjustment_bps(&[0], &[500]);
        assert_eq!(bps, 0);
        assert!(!clamped);
    }

    #[test]
    fn delivered_never_underflows() {
        assert_eq!(delivered_wh(1_000, 4_000), 0);
        assert_eq!(delivered_wh(1_000, 400), 600);
    }

    #[test]
    fn payout_scales_with_delivery() {
        // 1 CSPR/kWh, 1500 Wh delivered -> 1.5 CSPR
        let price = U512::from(1_000_000_000u64);
        assert_eq!(payout_motes(1_500, price), U512::from(1_500_000_000u64));
        assert_eq!(payout_motes(0, price), U512::zero());
    }

    #[test]
    fn payout_truncates_in_the_buyers_favour() {
        // 1 mote/kWh with 1 Wh delivered would be 0.001 motes; must floor to zero
        // rather than mint a mote from nothing.
        assert_eq!(payout_motes(1, U512::from(1u64)), U512::zero());
    }

    #[test]
    fn full_window_computation() {
        // 10 days each drawing 1800 Wh in the window.
        let history = [1_800u64; 10];
        // Observation window baseline 600 Wh/day; today drew 630 (+5%).
        let adj_baseline = [600u64; 10];
        let result = compute(&history, &adj_baseline, &[630]);

        assert_eq!(result.unadjusted_wh, 1_800);
        assert_eq!(result.adjustment_bps, 500);
        assert_eq!(result.adjusted_wh, 1_890);
        assert!(!result.clamped);
    }

    /// The economic property that makes household participation trustless: the
    /// attack costs more energy than the credit it buys.
    #[test]
    fn baseline_inflation_is_unprofitable() {
        let history = [1_800u64; 10];
        let adj_baseline = [600u64; 10];

        let honest = compute(&history, &adj_baseline, &[600]);
        let attacker = compute(&history, &adj_baseline, &[3_000]);

        let honest_delivered = delivered_wh(honest.adjusted_wh, 300);
        let attacker_delivered = delivered_wh(attacker.adjusted_wh, 300);

        assert!(attacker.clamped);

        let gained = attacker_delivered - honest_delivered;
        let burned = 3_000 - 600;
        assert!(burned > gained, "attack must cost more than it yields");
    }
}
