# Midnight preprod proof server on Railway

A hosted instance of `midnightntwrk/proof-server:8.0.2`, used by LumpFun's
preprod web app for ZK proof generation when 1AM's hosted prover is
mainnet-only.

## What this is

- A thin Dockerfile that pulls the upstream image. No code, no state, no
  config beyond `RUST_BACKTRACE=full`.
- Railway runs one instance, restarts on crash, exposes port 6300 over HTTPS.
- The service has no database, no persistent volume, no secrets.

## Deploy

Prerequisite: a Railway account and `railway` CLI installed (`brew install
railway` or `npm i -g @railway/cli`).

From the repo root:

```bash
cd infra/midnight-proof-server
railway login
railway init                   # creates a new project, picks a name
railway up                     # builds the Dockerfile and deploys
railway domain                 # mints a public HTTPS URL
```

Copy the printed URL (looks like `midnight-proof-server-production-xxxx.up.railway.app`).

## Wire it into LumpFun

The CLI and the web app both read the proof server URL from
`MIDNIGHT_PROVER_URL`. Two places to update:

1. **Root `.env.local`** (CLI):
   ```
   MIDNIGHT_PROVER_URL=https://<your-railway-url>
   ```
2. **Vercel project env vars** (web, when you deploy preprod to Vercel):
   ```
   MIDNIGHT_PROVER_URL=https://<your-railway-url>
   ```
   Set with `vercel env add MIDNIGHT_PROVER_URL preview` and
   `... production`.

## Health check

The proof server doesn't ship a `/health` endpoint, but a `POST /prove` with
an empty body returns a 4xx — that's enough to confirm the service is up:

```bash
curl -i -X POST https://<your-railway-url>/prove
```

A `400 Bad Request` (or similar) means the server is reachable.

## Why Railway

- Docker-image-native, no buildpack guessing
- Single-region default is fine for preprod (US-East / EU-West)
- Idle pricing is reasonable; the proof server uses zero CPU when no one is
  proving
- Stateless service means redeploy is a 30-second push of a new Dockerfile

If preprod traffic outgrows a single instance (it won't in the
foreseeable future), turn on Railway's auto-scaling or migrate to Fly.io
for closer regional control.

## Upgrades

When Midnight ships a new ledger version, bump the `FROM` tag in
`Dockerfile` and `railway up` again. Document the new tag in the commit
message so the CLI's `@midnight-ntwrk/ledger-v8` version stays aligned.
