/**
 * Preprod end-to-end trade-cycle test — GATED by `MIDNIGHT_PREPROD_E2E=1`.
 *
 * Exercises the full launchpad flow against live Midnight preprod:
 *   1. Init wallet, sanity-check NIGHT + DUST balances
 *   2. Deploy a fresh launch with known, compact params
 *   3. Buy 100 tokens — assert on-chain state deltas are exact
 *   4. Sell 40 tokens — assert deltas again
 *   5. Withdraw platform + creator accruals — assert zero'd and wallet
 *      receives the full (platform + creator) amount in NIGHT
 *
 * Wall-clock: ~10 minutes (mostly wallet sync + proof generation + tx
 * finality). `vitest.config.ts` excludes this file unless
 * `MIDNIGHT_PREPROD_E2E === '1'` is set, and the `it.skip` branch below
 * adds belt-and-suspenders gating so the file can be safely imported under
 * a normal `npm test` run (test reports as skipped, no network side
 * effects).
 */

import { describe, it, expect } from 'vitest';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { initWallet, stopWallet, getBalances } from '../../src/wallet.js';
import {
  deployLaunch,
  connectLaunch,
  buy,
  sell,
  withdrawPlatform,
  withdrawCreator,
  quoteBuy,
  quoteSell,
} from '../../src/launch.js';

const GATED = process.env.MIDNIGHT_PREPROD_E2E === '1';

/**
 * The string-hex key under which native NIGHT balances appear in
 * `getBalances().unshielded`. Matches `state.unshielded.balances[raw]`
 * in the wallet SDK — `raw` is a hex-encoded `RawTokenType` string.
 */
function nightTokenKey(): string {
  return ledger.nativeToken().raw;
}

describe('preprod end-to-end', () => {
  const run = GATED ? it : it.skip;

  run(
    'deploy -> buy -> sell -> withdraw platform + creator, all state deltas exact',
    async () => {
      const wallet = await initWallet(undefined, { syncTimeoutMs: 40 * 60_000 });
      try {
        // ─── 1. Prerequisites: wallet has NIGHT + DUST ───────────────────
        const NIGHT = nightTokenKey();
        const initial = await getBalances(wallet);
        const nightBalance = initial.unshielded[NIGHT] ?? 0n;
        if (nightBalance < 10_000_000n) {
          throw new Error(
            `Wallet needs >=0.01 tNIGHT for E2E (has ${nightBalance}). ` +
              `Address: ${wallet.addresses.unshielded}. ` +
              `Top up via https://faucet.preprod.midnight.network then retry.`,
          );
        }
        if (initial.dustBalance === 0n) {
          throw new Error('Wallet has no DUST. Run `dust register` first.');
        }

        // ─── 2. Deploy a launch with known, compact params ───────────────
        const platformPubkey = wallet.keys.shielded.keys.coinPublicKey;
        const handle = await deployLaunch(wallet, {
          metadata: {
            name: 'E2E-Test',
            symbol: 'E2ET',
            decimals: 6,
            imageUri: 'ipfs://e2e-test',
          },
          curve: {
            basePriceNight: 1_000n, // 0.000001 NIGHT per token at supply=0
            slopeNight: 1n, // +1 atom per additional token
            maxSupply: 10_000n,
          },
          fees: {
            feeBps: 100, // 1%
            platformShareBps: 5000, // 50%
            creatorShareBps: 4000, // 40%
            referralShareBps: 1000, // 10%
            platformRecipient: platformPubkey,
            creatorRecipient: platformPubkey, // self = easy balance verification
          },
        });
        expect(handle.contractAddress).toMatch(/^[0-9a-f]{64}$/);

        // ─── 3. Buy 100 tokens, assert state ─────────────────────────────
        const buyQuote = quoteBuy(handle, 100n);
        expect(buyQuote.curveSide).toBeGreaterThan(0n);
        await buy(wallet, handle, 100n);

        const afterBuy = await connectLaunch(wallet, handle.contractAddress);
        expect(afterBuy.state.tokensSold).toBe(100n);
        expect(afterBuy.state.nightReserve).toBe(buyQuote.curveSide);
        expect(afterBuy.state.platformAccrued).toBe(buyQuote.split.platform);
        expect(afterBuy.state.creatorAccrued).toBe(buyQuote.split.creator);

        // ─── 4. Sell 40 tokens, assert state ─────────────────────────────
        const sellQuote = quoteSell(afterBuy, 40n);
        await sell(wallet, afterBuy, 40n);

        const afterSell = await connectLaunch(wallet, handle.contractAddress);
        expect(afterSell.state.tokensSold).toBe(60n);
        expect(afterSell.state.nightReserve).toBe(
          afterBuy.state.nightReserve - sellQuote.curveSide,
        );
        // Accruals grew by this sell's split. No referral on either call,
        // so the referral cut routed into platform in both quotes.
        expect(afterSell.state.platformAccrued).toBe(
          afterBuy.state.platformAccrued + sellQuote.split.platform,
        );
        expect(afterSell.state.creatorAccrued).toBe(
          afterBuy.state.creatorAccrued + sellQuote.split.creator,
        );

        // ─── 5. Withdraw platform + creator, assert zero'd ───────────────
        const preWithdraw = await getBalances(wallet);
        const preNight = preWithdraw.unshielded[NIGHT] ?? 0n;

        await withdrawPlatform(wallet, afterSell);
        await withdrawCreator(wallet, afterSell);

        const afterWithdraw = await connectLaunch(
          wallet,
          handle.contractAddress,
        );
        expect(afterWithdraw.state.platformAccrued).toBe(0n);
        expect(afterWithdraw.state.creatorAccrued).toBe(0n);

        const postWithdraw = await getBalances(wallet);
        const postNight = postWithdraw.unshielded[NIGHT] ?? 0n;
        // Recipient (both = self) received the full (platformAccrued +
        // creatorAccrued) in NIGHT.
        const expectedInflow =
          afterSell.state.platformAccrued + afterSell.state.creatorAccrued;
        expect(postNight - preNight).toBe(expectedInflow);
      } finally {
        await stopWallet(wallet);
      }
    },
    45 * 60_000, // 45-minute timeout — accounts for ~25-min wallet sync + 5 txs × ~60s
  );
});
