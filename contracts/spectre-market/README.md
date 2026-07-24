# spectre_market

The Spectre market contract: households sell verified demand reduction to a buyer,
and the contract itself computes what is owed and pays it out. No aggregator is
trusted to report honestly or to split fairly.

Written with [Odra](https://odra.dev) and deployed to Casper testnet.

## How it works

A household registers a site and commits to a hashed baseline *before* a dispatch
window opens, so it cannot inflate that baseline after the fact to claim a larger
reduction. A buyer opens a window and escrows the full budget up front. Agents pledge
what they can shed; the pledge is a ceiling on payment, so overstating buys nothing.

At settlement, baselines are revealed and checked against their commitments. The
contract recomputes the CAISO 10-in-10 baseline, applies the day-of adjustment within
a ±20% clamp, subtracts metered actual use, and pays `delivered × price`. Whatever the
buyer did not spend is withdrawable.

All arithmetic is integer — watt-hours as `u64`, ratios in basis points. Floating
point is never used, so settlement is bit-for-bit reproducible on every node.

## Entry points

| Function           | Called by  | Effect                                            |
| ------------------ | ---------- | ------------------------------------------------- |
| `register_asset`   | household  | Register a site and its max curtailable load      |
| `commit_baseline`  | household  | Publish the baseline hash before a window opens   |
| `open_event`       | buyer      | Open a window and escrow the budget               |
| `pledge`           | household  | Pledge the reduction it will deliver              |
| `settle`           | anyone     | Reveal, verify, compute, and pay                  |
| `withdraw_unspent` | buyer      | Reclaim the unspent budget after settlement       |

Read-only: `get_asset`, `get_event`, `get_pledge`, `asset_count`, `event_count`,
`remaining_budget`, and `compute_commitment` (which lets anyone rebuild a commitment
off-chain and check it themselves).

## Build and test

Requires [cargo-odra](https://github.com/odradev/cargo-odra).

```bash
cargo odra test              # 33 tests against the Odra host env
cargo odra build   # wasm, written to ../../wasm
```

Deployment is driven from the agent, which records the resulting address in
`agent/deployment.json`:

```bash
cd ../../agent && npm run install:contract
```
