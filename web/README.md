# Spectre — web

The public site and live dashboard for the Spectre market. The dashboard reads the
deployed contract's event log from Casper testnet and renders the settlement it
produced, so every figure on screen is decoded from chain data rather than entered
by hand.

## Running it

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

`predev` and `prebuild` run `scripts/sync-agent.mjs`, which vendors the agent's event
decoder into `lib/agent-vendored/`. Those files are generated — edit the originals in
`agent/src/` instead.

## Routes

| Route          | What it does                                                        |
| -------------- | ------------------------------------------------------------------- |
| `/`            | Landing page: the mechanism, the guarantees, and the live settlement |
| `/dashboard`   | Live dashboard, polling the contract every 20s                       |
| `/api/market`  | Server-side chain read, briefly cached; `?fresh=1` bypasses the cache |

## Configuration

No configuration is required. The contract address is read from
`agent/deployment.json`, which `npm run install:contract` rewrites on every redeploy,
so the dashboard always follows the live deployment.

| Variable                | Default                       | Purpose                                  |
| ----------------------- | ----------------------------- | ---------------------------------------- |
| `CASPER_CONTRACT_HASH`  | from `agent/deployment.json`  | Override the contract to read             |
| `CASPER_RPC_URL`        | testnet node                  | Casper JSON-RPC endpoint                  |
| `CASPER_EXPLORER`       | `https://testnet.cspr.live`   | Base URL used to build explorer links     |

The frontend holds no signing key. It reads public events and cannot move funds or
change market state.

## Checks

```bash
npx tsc --noEmit
npm run lint
npm run build
```
