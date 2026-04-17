# LumpFun

LumpFun is a pump.fun-inspired token launchpad for the Midnight Network **preprod** testnet. Launches use native tNIGHT as the quote currency, a linear bonding curve (`price = base + slope * supply`), and an immutable fee split fixed at deploy time (platform / creator / optional referral, bps-denominated). The MVP is a Node + Commander CLI over a single Compact contract.

## Status

- **v0, preprod-only.** `assertPreprod()` guards every write path; mainnet config values fail fast.
- No token standard, no AMM, no DAO, no admin circuits. Fee recipients and shares are set at deploy and cannot change.
- All state is public. See [`docs/security.md`](docs/security.md) for the trust model and mainnet readiness gate.

## Prerequisites

- Node.js **≥ 18** (tested on 20).
- Docker (for the local proof server on port 6300).
- Compact toolchain **0.30.0**.

Install the Compact toolchain:

```bash
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
compact update 0.30.0
compact compile --version   # must print 0.30.0
```

## Quickstart

```bash
# Initial setup (once)
git clone <this-repo> lumpfun && cd lumpfun
npm install
cp .env.example .env
docker compose -f proof-server.yml up -d
npm run compact:compile
```

```bash
# Create + fund a wallet
npm run dev -- wallet create
# → copy the printed `unshielded` address and request tNIGHT at:
#   https://faucet.preprod.midnight.network
```

```bash
# Register NIGHT for DUST generation (one-time; uses reference repo tooling
# until transfer.ts is ported into LumpFun).
cd ../agent-lump/midnight-agent   # or wherever the reference CLI lives
MIDNIGHT_WALLET_DIR=~/.lumpfun npm run dev -- dust register
# → wait ~20 min for the initial indexer sync + DUST accrual.
```

```bash
# Back in the LumpFun repo — deploy a launch
npm run dev -- launch deploy \
  --name "My Meme" --symbol MEME --decimals 6 --image ipfs://x \
  --base-price 1000 --slope 1 --max-supply 1000000 \
  --fee-bps 100 --platform-bps 5000 --creator-bps 4000 --referral-bps 1000 \
  --platform-recipient <hex-pubkey>
```

```bash
# Trade
npm run dev -- launch quote-buy <address> --tokens 100
npm run dev -- launch buy <address> --tokens 100
npm run dev -- launch quote-sell <address> --tokens 40
npm run dev -- launch sell <address> --tokens 40
npm run dev -- launch fees <address>
npm run dev -- launch withdraw-platform <address>
npm run dev -- launch withdraw-creator <address>
```

A full run can be completed in about 15 minutes once the first-run wallet sync (~20 min) and DUST accrual are done.

## Environment variables

Copy `.env.example` → `.env`. The CLI loads `.env` via `dotenv/config`.

| Variable | Default | Notes |
| --- | --- | --- |
| `MIDNIGHT_NETWORK` | `preprod` | `preprod` \| `preview` \| `mainnet` (mainnet is blocked). |
| `MIDNIGHT_RPC_URL` | `https://rpc.preprod.midnight.network/` | Substrate JSON-RPC. |
| `MIDNIGHT_RPC_WSS_URL` | `wss://rpc.preprod.midnight.network` | Substrate WS. |
| `MIDNIGHT_INDEXER_URL` | `https://indexer.preprod.midnight.network/api/v3/graphql` | GraphQL indexer. |
| `MIDNIGHT_INDEXER_WS_URL` | `wss://indexer.preprod.midnight.network/api/v3/graphql/ws` | GraphQL subscriptions. |
| `MIDNIGHT_PROVER_URL` | `http://localhost:6300` | Local proof server (docker). |
| `MIDNIGHT_EXPLORER_URL` | `https://explorer.preprod.midnight.network` | For link-outs. |
| `MIDNIGHT_WALLET_SEED` | *(unset)* | Hex-encoded 32-byte seed; generated if absent. |
| `MIDNIGHT_WALLET_SYNC_TIMEOUT_MS` | `1800000` | First-run sync can exceed 10 min. |
| `LUMPFUN_ALLOW_MAINNET` | *(undocumented)* | Do not set. See [`docs/security.md`](docs/security.md). |

## CLI reference

All commands run via `npm run dev -- <group> <command>` (or `node dist/cli.js <...>` after `npm run build`).

**Wallet**

| Command | Purpose |
| --- | --- |
| `wallet create` | Generate a new seed and print unshielded/shielded/dust addresses. |
| `wallet status` | Print the current wallet's addresses. |
| `wallet balances` | Show NIGHT, DUST, and per-token-kind balances. |

**Launch**

| Command | Purpose |
| --- | --- |
| `launch deploy ...` | Deploy a new launch (curve, fees, metadata all immutable). |
| `launch list` | List known launches (local cache + indexer). |
| `launch info <address>` | Show a launch's current on-chain state. |
| `launch quote-buy <address> --tokens N` | Quote a buy without sending a tx. |
| `launch quote-sell <address> --tokens N` | Quote a sell without sending a tx. |
| `launch buy <address> --tokens N [--referral hex]` | Buy N tokens from the curve. |
| `launch sell <address> --tokens N [--referral hex]` | Sell N tokens to the curve. |
| `launch transfer <address> --to hex --amount N` | Transfer tokens to another address. |
| `launch withdraw-platform <address>` | Sweep accrued platform NIGHT to its fixed recipient. |
| `launch withdraw-creator <address>` | Sweep accrued creator NIGHT to its fixed recipient. |
| `launch withdraw-referral <address> --ref hex` | Sweep accrued referral NIGHT to the given referrer. |
| `launch fees <address>` | Show platform/creator accrued NIGHT. |
| `launch verify-split <txId>` | Confirm a tx exists/is finalized on the preprod indexer. |

**Chain**

| Command | Purpose |
| --- | --- |
| `chain health` | Ping the preprod RPC node. |
| `chain info` | Fetch genesis / tip info. |

All `withdraw-*` commands are callable by anyone — destinations are fixed in ledger state, so the caller simply pays DUST to forward the funds to the rightful recipient. Details in [`docs/security.md`](docs/security.md).

## Development

```bash
npm test                                   # vitest: unit + simulator suites
npm run typecheck                          # tsc --noEmit
MIDNIGHT_PREPROD_E2E=1 npm run test:preprod  # gated, hits real preprod
npm run build                              # tsc → dist/
npm run compact:compile                    # recompile the contract
```

Simulator tests (`tests/simulator/`) exercise the contract via the Compact runtime's in-process harness: curve math parity with `src/curve.ts`, fee math parity with `src/fees.ts`, immutability checks, invariant checks, and access-control falsification tests. Unit tests (`tests/unit/`) cover CLI shape, wallet helpers, config, and registry.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `MIDNIGHT_NETWORK=mainnet is disabled` | Set `MIDNIGHT_NETWORK=preprod` in `.env`. Mainnet is blocked in v0. |
| `Proof server unreachable` at `localhost:6300` | `docker compose -f proof-server.yml up -d` — verify with `docker ps`. |
| Tx fails: *wallet has no DUST* | Run `dust register` via the reference-repo CLI; allow ~20 min to accrue. |
| `Unknown MIDNIGHT_NETWORK` | Valid values: `preprod`, `preview`, `mainnet` (mainnet is blocked). |
| `compact compile` fails | `compact compile --version` must print `0.30.0`; run `compact update 0.30.0`. |

## Architecture

Full design, invariants, and DR-1 resolution: [`docs/launchpad-mvp.md`](docs/launchpad-mvp.md). Security model: [`docs/security.md`](docs/security.md).

## Contributing / License

License: TBD. Contributions: open an issue first.
