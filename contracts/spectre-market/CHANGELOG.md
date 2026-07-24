# Changelog

Changelog for `spectre_market`.

## [0.1.0] - 2026-07-24
### Added
- `market` — the demand-reduction market: asset registration, baseline commitments,
  buyer-funded dispatch events with escrowed budgets, pledges, settlement, and
  budget withdrawal.
- `baseline` — the CAISO 10-in-10 customer baseline with a symmetric day-of
  adjustment, clamped to ±20%, computed on chain in integer arithmetic.
- `types` — shared value types, protocol constants, and the emitted event schema.
