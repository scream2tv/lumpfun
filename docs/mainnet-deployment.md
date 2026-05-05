# Mainnet deployment guide

Goal: take LumpFun from preprod testing to live mainnet — hosted somewhere that
keeps the bonding-curve → Minswap migration running 24/7 without you needing to
keep your laptop on.

This guide assumes you already have the repo working on preprod.

---

## 1. Wallets you need

You need **two distinct mainnet wallets**:

### A. Treasury wallet (server-controlled)

This is the operational wallet the protocol drives directly. It does three things:

1. Receives the 1 ADA platform fee from every buy and every sell.
2. Holds ADA + tokens after a curve graduates (between Tx 1 "drain" and Tx 2 "create Minswap pool").
3. Signs and submits the Minswap V2 pool-creation transaction.

Because the server has to sign on its behalf, the **seed phrase** lives in your
hosting provider's environment variables. Treat it like a database password.

How to set it up:

- Use a fresh wallet — do **not** reuse any existing personal wallet.
- Recommended: Eternl or Nami → "Create new wallet" → write down 24 words →
  set a wallet name like `lumpfun-treasury-mainnet`.
- Get its **bech32 mainnet payment address** (starts with `addr1…`) — you'll
  need this for `NEXT_PUBLIC_TREASURY_ADDRESS`.
- Funding budget at minimum:
  - **~50 ADA** to cover Cardano min-UTxO and tx fees for early operations.
  - **+ enough headroom for one full graduation** at peak: a graduation TX
    drains ~21,000 ADA from the curve but the treasury has to first cover
    Minswap's own min-ADA + tx fees (~5–10 ADA out of pocket up front; the
    21,000 ADA arrives in Tx 1 before Tx 2 spends it).
  - Realistic floor: **100 ADA** to be safe.

### B. Creator wallets (one per launcher)

Every user who launches a token uses **their own browser wallet** (Eternl,
Nami, Lace, etc.) via CIP-30. Their wallet:

- Pays the launch tx fee + initial buy ADA + the 1 ADA platform fee.
- Is recorded as the `creatorAddress` on the registry row.
- Receives the per-trade creator rev-share for that token from then on.

You don't need to provision these — each user brings their own.

### C. (You, separately) — the developer wallet

The wallet you use to test launches as a regular user. Same as (B), just yours.

---

## 2. Environment variables

Two files matter:

### `web/.env.local` (local dev)

```ini
# Network
NEXT_PUBLIC_CARDANO_NETWORK=Mainnet

# Blockfrost — get a mainnet project ID from https://blockfrost.io/dashboard
NEXT_PUBLIC_BLOCKFROST_PROJECT_ID=mainnet***
BLOCKFROST_PROJECT_ID=mainnet***
BLOCKFROST_BASE_URL=https://cardano-mainnet.blockfrost.io/api/v0

# Treasury (server-side use)
TREASURY_SEED="word1 word2 word3 ... word24"     # 24-word mnemonic, single line, quoted
NEXT_PUBLIC_TREASURY_ADDRESS=addr1qx...           # bech32 mainnet payment addr

# Optional: lower the bonding-curve graduation threshold for testing
# Set to 5 (= 5 ADA) when you want a curve to graduate after only 5 ADA of buys.
# Unset (or set to 21000) for production.
# IMPORTANT: each token's threshold is baked into its validator at launch time
# from this env var, so changing it later only affects newly launched tokens.
# NEXT_PUBLIC_GRADUATION_ADA=5
```

### Hosting provider env (Vercel, Railway, Fly, etc.)

Same variables, set as project secrets. Do not commit `.env.local` — it's in
`.gitignore`.

`TREASURY_SEED` must be marked **secret/encrypted** in your hosting provider
(Vercel: "Sensitive" toggle; Fly: `fly secrets set`).

---

## 3. Where to host (and the Minswap migration question)

### TL;DR — does the migration happen automatically when my device is off?

**Only if the server is hosted somewhere that's always running.** Migration is
a server-side operation that runs inside the Next.js API routes. Concretely:

- Locally with `npm run dev` → only runs while your laptop is on **and** the
  dev server is up **and** something pings the relevant route.
- Deployed to Vercel/Railway/Fly/etc → runs whenever a request hits the deployed
  instance. **You also need a cron** that calls `GET /api/graduate/tick`
  periodically, otherwise migrations only fire when a user happens to load a
  token page that triggers `/api/curve` (which fires graduation as a side effect).

### Recommended hosting

**Vercel** is the easiest fit because:
- Native Next.js 16 / Turbopack support.
- **Vercel Cron** built in: schedule `/api/graduate/tick` to run every minute.
- Edge env vars for `TREASURY_SEED`.
- Free tier handles low traffic; pay-as-you-go for production scale.

Setup:
1. Push the repo to GitHub (see §6).
2. Import the repo into Vercel; pick `web/` as the root directory.
3. Add all env vars from §2.
4. Deploy.
5. Add a `vercel.json` cron entry (or use the dashboard) — see template below.

```json
{
  "crons": [
    { "path": "/api/graduate/tick", "schedule": "* * * * *" }
  ]
}
```

That cron fires every minute, scans the registry for tokens that have crossed
threshold but haven't migrated yet, and runs the drain + Minswap pool creation
from the treasury wallet. It is idempotent — running twice is safe.

### Alternatives

- **Railway / Render / Fly** — fine, but you'll need to add an external cron
  (GitHub Actions on a schedule, EasyCron, cron-job.org) hitting
  `https://yourdomain.com/api/graduate/tick` every minute.
- **Self-hosted on a VPS** — run `npm run start` under `pm2` or `systemd`, plus
  a system cron. Treasury key still lives on disk.

### What if no one ever loads a token page after threshold is hit?

Without the cron, migration only fires when:
- A user opens the token detail page (which calls `/api/curve`), or
- Someone manually `POST`s to `/api/graduate { policyId }`.

So **always wire the cron**. It's the difference between "auto-graduates at the
moment threshold is hit" and "auto-graduates whenever someone happens to open
the page next."

---

## 4. The bonding-curve graduation threshold (cheap testing)

The graduation threshold is now a **per-token validator parameter**, not a
hard-coded constant. This means:

- The default is 21,000 ADA on mainnet, baked in via `NEXT_PUBLIC_GRADUATION_ADA`
  (unset → 21,000) at the moment a token is launched.
- You can launch a **test token** with a tiny threshold (e.g. 5 ADA) by setting
  `NEXT_PUBLIC_GRADUATION_ADA=5` before clicking Launch.
- Existing tokens keep whatever threshold they were launched with — the
  validator param is captured at compile time and recorded in
  `cardano-registry.json` as `graduationAdaLovelace`.

So a typical mainnet test cycle is:

1. Edit `web/.env.local` → `NEXT_PUBLIC_GRADUATION_ADA=5`
2. Restart `npm run dev` (env vars only reload on restart).
3. Launch a token. Its validator is parameterised with 5 ADA threshold; the
   registry row stores `"graduationAdaLovelace": "5000000"`.
4. Buy ~5 ADA worth → curve graduates → Minswap pool gets created from treasury.
5. Total real ADA you spent: ~5 ADA into the curve + ~6–8 ADA in tx fees and
   Minswap pool deposits. Far cheaper than the full 21,000 ADA path.

For the production launch, **unset** `NEXT_PUBLIC_GRADUATION_ADA` (or set it to
`21000`) before deploying so real tokens use the full threshold.

---

## 5. Pre-mainnet checklist

Before flipping to mainnet:

- [ ] Aiken validator rebuilt — `aiken build` in `contracts/cardano/`.
- [ ] Both `BONDING_CURVE_CBOR` consts (in `src/cardano/scripts.ts` and
      `web/src/lib/cardano-tx.ts`) match the freshly compiled blueprint.
- [ ] All Aiken tests pass — `aiken check` reports 30 pass / 0 fail.
- [ ] All Node tests pass — `npx vitest run` from repo root.
- [ ] Web build is green — `npm run build` in `web/`.
- [ ] Treasury wallet is funded with ≥ 100 ADA on mainnet.
- [ ] `TREASURY_SEED` is set as a secret on your host.
- [ ] `NEXT_PUBLIC_TREASURY_ADDRESS` is the bech32 of the treasury wallet.
- [ ] `NEXT_PUBLIC_CARDANO_NETWORK=Mainnet` everywhere.
- [ ] `NEXT_PUBLIC_BLOCKFROST_PROJECT_ID` and `BLOCKFROST_PROJECT_ID` are
      mainnet keys.
- [ ] Cron job is configured to hit `/api/graduate/tick` every 1–5 minutes.
- [ ] You launched and graduated **at least one** test token end-to-end (using
      a low threshold from §4) on mainnet to prove the full pipeline works
      including the Minswap pool creation. If you don't trust the test, don't
      take real users' ADA.

---

## 6. Pushing to GitHub

Repo target: `https://github.com/scream2tv/lumpfun`

Before push:

- Confirm `.gitignore` covers `.env`, `.env.local`, `test-wallets/`,
  `contracts/managed/`, `node_modules/`, `dist/`, `~/.lumpfun/`. (It does.)
- `git status` should show no `.env*` files staged.
- Check there are no committed seed phrases or API keys in history:
  ```sh
  git log --all -p | grep -E "BLOCKFROST|TREASURY_SEED|mainnet[A-Za-z0-9]{20,}"
  ```
  Should output nothing.

If a remote isn't set yet:

```sh
git remote add origin https://github.com/scream2tv/lumpfun.git
git push -u origin feat/mvp
```

If the remote is already configured:

```sh
git push origin feat/mvp
```

Then open a PR from `feat/mvp` → `main`, or merge directly if you're the only
contributor.

---

## 7. Day-1 monitoring

- Watch the treasury address on Cardanoscan/cexplorer; alert if balance
  drops unexpectedly.
- Tail server logs for `runGraduation` errors. The cron will retry, but
  recurring failures usually mean Minswap SDK changed or the treasury ran low.
- Keep an eye on Blockfrost rate limits on the mainnet plan — every page load
  hits `/api/curve`, `/api/trades`, `/api/holders`, `/api/price-history`.
  Upgrade plan if you start seeing 429s.
