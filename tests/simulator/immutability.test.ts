import { describe, it, expect } from 'vitest';
import { deployInSimulator, getLedger, type LedgerView } from './harness.js';
import { curveCostBuy, curvePayoutSell } from '../../src/curve.js';

const EMPTY_REF = new Uint8Array(32);

function rawCuts(
  curveSide: bigint,
  feeBps: number,
  pBps: number,
  cBps: number,
  rBps: number,
) {
  const fee = (curveSide * BigInt(feeBps)) / 10000n;
  const p = (fee * BigInt(pBps)) / 10000n;
  const c = (fee * BigInt(cBps)) / 10000n;
  const r = (fee * BigInt(rBps)) / 10000n;
  const remainder = fee - p - c - r;
  return { fee, p, c, r, remainder };
}

// Snapshot every immutable ledger field as a plain-string map. Bytes fields
// are serialized as hex so equality is a plain string compare (no deep-object
// surprises from the simulator's Uint8Array views).
function captureImmutables(s: LedgerView): Record<string, string> {
  return {
    name: JSON.stringify(s.name),
    symbol: JSON.stringify(s.symbol),
    decimals: String(s.decimals),
    image_uri: JSON.stringify(s.image_uri),
    creator_pubkey: Buffer.from(s.creator_pubkey).toString('hex'),
    base_price_night: String(s.base_price_night),
    slope_night: String(s.slope_night),
    max_supply: String(s.max_supply),
    fee_bps: String(s.fee_bps),
    platform_share_bps: String(s.platform_share_bps),
    creator_share_bps: String(s.creator_share_bps),
    referral_share_bps: String(s.referral_share_bps),
    platform_recipient: Buffer.from(s.platform_recipient).toString('hex'),
    creator_recipient: Buffer.from(s.creator_recipient).toString('hex'),
  };
}

function expectImmutablesEqual(
  a: Record<string, string>,
  b: Record<string, string>,
  step: number,
) {
  for (const k of Object.keys(a)) {
    if (a[k] !== b[k]) {
      throw new Error(
        `immutable field "${k}" diverged at step ${step}: before=${b[k]} after=${a[k]}`,
      );
    }
    expect(a[k]).toBe(b[k]);
  }
}

describe('LumpLaunch immutability', () => {
  it('every immutable field is byte-identical after 20 random trades', async () => {
    const basePrice = 1000n;
    const slope = 1n;
    const feeBps = 100;
    const pBps = 5000;
    const cBps = 4000;
    const rBps = 1000;
    const h = await deployInSimulator({
      name: 'FixTok',
      symbol: 'FIX',
      decimals: 9n,
      imageUri: 'ipfs://baseline',
      basePrice,
      slope,
      maxSupply: 10_000n,
      feeBps,
      pBps,
      cBps,
      rBps,
    });

    const baseline = captureImmutables(getLedger(h));
    const trader = new Uint8Array(32).fill(9);
    const other = new Uint8Array(32).fill(42);

    // Deterministic pseudo-random so failures are reproducible.
    let seed = 0xC0FFEE;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xFFFFFFFF;
    };

    let soldRunning = 0n;
    for (let i = 0; i < 20; i++) {
      const dice = rand();
      try {
        if (dice < 0.55) {
          const n = BigInt(Math.floor(rand() * 20) + 1);
          const cost = curveCostBuy(soldRunning, n, basePrice, slope);
          const cuts = rawCuts(cost, feeBps, pBps, cBps, rBps);
          const withRef = rand() < 0.3;
          const ref = new Uint8Array(32).fill((i % 250) + 5);
          h.buy({
            buyer: trader,
            nTokens: n,
            curveCost: cost,
            feeTotal: cuts.fee,
            pCut: cuts.p,
            cCut: cuts.c,
            rCut: cuts.r,
            remainder: cuts.remainder,
            hasReferral: withRef,
            referral: withRef ? ref : EMPTY_REF,
          });
          soldRunning += n;
        } else if (dice < 0.85 && soldRunning > 0n) {
          const n = BigInt(
            Math.min(Number(soldRunning), Math.floor(rand() * 10) + 1),
          );
          if (n <= 0n) continue;
          const payout = curvePayoutSell(soldRunning, n, basePrice, slope);
          const cuts = rawCuts(payout, feeBps, pBps, cBps, rBps);
          h.sell({
            seller: trader,
            nTokens: n,
            curvePayout: payout,
            feeTotal: cuts.fee,
            pCut: cuts.p,
            cCut: cuts.c,
            rCut: cuts.r,
            remainder: cuts.remainder,
            hasReferral: false,
            referral: EMPTY_REF,
          });
          soldRunning -= n;
        } else {
          // Transfer — requires balance; best-effort small amount.
          if (soldRunning > 0n) {
            h.transfer({ fromAddr: trader, toAddr: other, amount: 1n });
          }
        }
      } catch {
        // Some random combinations are invalid (e.g., exceed supply). Those
        // throws are simulator rejections — state is preserved, so
        // immutability is still expected to hold.
      }

      const after = captureImmutables(getLedger(h));
      expectImmutablesEqual(after, baseline, i);
    }
  });

  it('withdrawals do not perturb any immutable field', async () => {
    const h = await deployInSimulator({
      basePrice: 10_000n,
      slope: 0n,
      maxSupply: 10n,
      feeBps: 100,
      pBps: 5000,
      cBps: 4000,
      rBps: 1000,
    });
    const baseline = captureImmutables(getLedger(h));
    const buyer = new Uint8Array(32).fill(9);
    const referral = new Uint8Array(32).fill(11);

    const cost = curveCostBuy(0n, 1n, 10_000n, 0n);
    const cuts = rawCuts(cost, 100, 5000, 4000, 1000);
    h.buy({
      buyer,
      nTokens: 1n,
      curveCost: cost,
      feeTotal: cuts.fee,
      pCut: cuts.p,
      cCut: cuts.c,
      rCut: cuts.r,
      remainder: cuts.remainder,
      hasReferral: true,
      referral,
    });
    expectImmutablesEqual(captureImmutables(getLedger(h)), baseline, 0);

    h.withdrawPlatform();
    expectImmutablesEqual(captureImmutables(getLedger(h)), baseline, 1);

    h.withdrawCreator();
    expectImmutablesEqual(captureImmutables(getLedger(h)), baseline, 2);

    h.withdrawReferral({ ref: referral });
    expectImmutablesEqual(captureImmutables(getLedger(h)), baseline, 3);
  });

  it('view circuit calls do not perturb any mutable or immutable field', async () => {
    // View circuits (curve_quote_buy/sell, current_price, balance_of) must
    // not mutate anything — we check both immutables AND live state.
    const basePrice = 1000n;
    const slope = 1n;
    const h = await deployInSimulator({
      basePrice,
      slope,
      maxSupply: 10_000n,
      feeBps: 0,
      pBps: 5000,
      cBps: 4000,
      rBps: 1000,
    });
    const trader = new Uint8Array(32).fill(9);

    // Seed some state so "no mutation" is a meaningful check.
    const seedN = 50n;
    const cost = curveCostBuy(0n, seedN, basePrice, slope);
    h.buy({
      buyer: trader,
      nTokens: seedN,
      curveCost: cost,
      feeTotal: 0n,
      pCut: 0n,
      cCut: 0n,
      rCut: 0n,
      remainder: 0n,
      hasReferral: false,
      referral: EMPTY_REF,
    });

    const pre = getLedger(h);
    const preImmut = captureImmutables(pre);
    const preTokens = pre.tokens_sold;
    const preReserve = pre.night_reserve;
    const preBalance = pre.balances.lookup(trader);

    // Fire every view circuit.
    h.curveQuoteBuy(1n);
    h.curveQuoteBuy(10n);
    h.curveQuoteSell(1n);
    h.currentPrice();
    h.balanceOf(trader);

    const post = getLedger(h);
    expectImmutablesEqual(captureImmutables(post), preImmut, 0);
    expect(post.tokens_sold).toBe(preTokens);
    expect(post.night_reserve).toBe(preReserve);
    expect(post.balances.lookup(trader)).toBe(preBalance);
  });
});
