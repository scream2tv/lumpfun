import { describe, it, expect } from 'vitest';
import { deployInSimulator, getLedger } from './harness.js';
import { curveCostBuy, curvePayoutSell } from '../../src/curve.js';

// Raw-cut helper (same shape as curve.test.ts / fees.test.ts) — kept local so
// this suite is self-contained. Routing (platform-absorbs-remainder-and-r)
// happens in the contract; these are the floored bases the circuit expects.
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

const EMPTY_REF = new Uint8Array(32);

// Sum every accrual the ledger tracks (platform + creator + all referrals).
// Takes the referral keys we've actually touched as a hint — the Map accessor
// on the LedgerView only exposes member/lookup, not iteration, so the caller
// tells us which keys to poll.
function totalAccruals(
  s: ReturnType<typeof getLedger>,
  refKeys: Uint8Array[],
): bigint {
  let sum = s.platform_accrued + s.creator_accrued;
  for (const k of refKeys) {
    if (s.referrals_accrued.member(k)) sum += s.referrals_accrued.lookup(k);
  }
  return sum;
}

describe('LumpLaunch invariants', () => {
  it('no-path-to-recipients-without-fee: accruals growth == sum of per-trade fees', async () => {
    const basePrice = 1000n;
    const slope = 1n;
    const feeBps = 150;
    const pBps = 5000;
    const cBps = 4000;
    const rBps = 1000;
    const h = await deployInSimulator({
      basePrice,
      slope,
      maxSupply: 10_000n,
      feeBps,
      pBps,
      cBps,
      rBps,
    });

    const trader = new Uint8Array(32).fill(9);
    const ref1 = new Uint8Array(32).fill(11);
    const ref2 = new Uint8Array(32).fill(13);
    const refKeys = [ref1, ref2];

    const baseline = totalAccruals(getLedger(h), refKeys);
    expect(baseline).toBe(0n);

    // Run a scripted sequence of trades and track the exact fee each should
    // produce. Transfer is interleaved to confirm it does NOT add to fees.
    let soldRunning = 0n;
    let expectedFeeGrowth = 0n;

    // Buy #1 — no referral.
    {
      const n = 10n;
      const cost = curveCostBuy(soldRunning, n, basePrice, slope);
      const cuts = rawCuts(cost, feeBps, pBps, cBps, rBps);
      h.buy({
        buyer: trader,
        nTokens: n,
        curveCost: cost,
        feeTotal: cuts.fee,
        pCut: cuts.p,
        cCut: cuts.c,
        rCut: cuts.r,
        remainder: cuts.remainder,
        hasReferral: false,
        referral: EMPTY_REF,
      });
      soldRunning += n;
      expectedFeeGrowth += cuts.fee;
    }

    // Buy #2 — referral #1 present.
    {
      const n = 25n;
      const cost = curveCostBuy(soldRunning, n, basePrice, slope);
      const cuts = rawCuts(cost, feeBps, pBps, cBps, rBps);
      h.buy({
        buyer: trader,
        nTokens: n,
        curveCost: cost,
        feeTotal: cuts.fee,
        pCut: cuts.p,
        cCut: cuts.c,
        rCut: cuts.r,
        remainder: cuts.remainder,
        hasReferral: true,
        referral: ref1,
      });
      soldRunning += n;
      expectedFeeGrowth += cuts.fee;
    }

    // Buy #3 — referral #2 present.
    {
      const n = 15n;
      const cost = curveCostBuy(soldRunning, n, basePrice, slope);
      const cuts = rawCuts(cost, feeBps, pBps, cBps, rBps);
      h.buy({
        buyer: trader,
        nTokens: n,
        curveCost: cost,
        feeTotal: cuts.fee,
        pCut: cuts.p,
        cCut: cuts.c,
        rCut: cuts.r,
        remainder: cuts.remainder,
        hasReferral: true,
        referral: ref2,
      });
      soldRunning += n;
      expectedFeeGrowth += cuts.fee;
    }

    // Transfer must NOT touch accruals.
    const accrualsBeforeTransfer = totalAccruals(getLedger(h), refKeys);
    const other = new Uint8Array(32).fill(42);
    h.transfer({ fromAddr: trader, toAddr: other, amount: 5n });
    const accrualsAfterTransfer = totalAccruals(getLedger(h), refKeys);
    expect(accrualsAfterTransfer).toBe(accrualsBeforeTransfer);

    // Sell #1 — no referral.
    {
      const n = 7n;
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
      expectedFeeGrowth += cuts.fee;
    }

    // Sell #2 — referral #1 present.
    {
      const n = 12n;
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
        hasReferral: true,
        referral: ref1,
      });
      soldRunning -= n;
      expectedFeeGrowth += cuts.fee;
    }

    const finalAccruals = totalAccruals(getLedger(h), refKeys);
    expect(finalAccruals - baseline).toBe(expectedFeeGrowth);
  });

  it('reserve conservation: night_reserve == (Σ curve_costs) − (Σ curve_payouts) at each step', async () => {
    const basePrice = 500n;
    const slope = 2n;
    const h = await deployInSimulator({
      basePrice,
      slope,
      maxSupply: 10_000n,
      feeBps: 0, // keeps step-by-step accounting clean
      pBps: 5000,
      cBps: 4000,
      rBps: 1000,
    });
    const trader = new Uint8Array(32).fill(5);

    let soldRunning = 0n;
    let cumulativeCurve = 0n; // + buys, − sells

    type Op = { kind: 'buy' | 'sell'; n: bigint };
    const script: Op[] = [
      { kind: 'buy', n: 10n },
      { kind: 'buy', n: 25n },
      { kind: 'sell', n: 7n },
      { kind: 'buy', n: 3n },
      { kind: 'sell', n: 20n },
      { kind: 'buy', n: 50n },
      { kind: 'sell', n: 1n },
    ];

    for (const op of script) {
      if (op.kind === 'buy') {
        const cost = curveCostBuy(soldRunning, op.n, basePrice, slope);
        h.buy({
          buyer: trader,
          nTokens: op.n,
          curveCost: cost,
          feeTotal: 0n,
          pCut: 0n,
          cCut: 0n,
          rCut: 0n,
          remainder: 0n,
          hasReferral: false,
          referral: EMPTY_REF,
        });
        soldRunning += op.n;
        cumulativeCurve += cost;
      } else {
        const payout = curvePayoutSell(soldRunning, op.n, basePrice, slope);
        h.sell({
          seller: trader,
          nTokens: op.n,
          curvePayout: payout,
          feeTotal: 0n,
          pCut: 0n,
          cCut: 0n,
          rCut: 0n,
          remainder: 0n,
          hasReferral: false,
          referral: EMPTY_REF,
        });
        soldRunning -= op.n;
        cumulativeCurve -= payout;
      }
      const s = getLedger(h);
      expect(s.night_reserve).toBe(cumulativeCurve);
      expect(s.tokens_sold).toBe(soldRunning);
    }
  });

  it('curve identity: with no withdrawals, night_reserve == curve_cost(0, tokens_sold) after interleaved trades', async () => {
    const basePrice = 700n;
    const slope = 3n;
    const h = await deployInSimulator({
      basePrice,
      slope,
      maxSupply: 10_000n,
      feeBps: 0,
      pBps: 5000,
      cBps: 4000,
      rBps: 1000,
    });
    const trader = new Uint8Array(32).fill(5);

    let soldRunning = 0n;

    type Op = { kind: 'buy' | 'sell'; n: bigint };
    const script: Op[] = [
      { kind: 'buy', n: 17n },
      { kind: 'buy', n: 4n },
      { kind: 'sell', n: 13n },
      { kind: 'buy', n: 100n },
      { kind: 'sell', n: 50n },
      { kind: 'buy', n: 9n },
    ];

    for (const op of script) {
      if (op.kind === 'buy') {
        const cost = curveCostBuy(soldRunning, op.n, basePrice, slope);
        h.buy({
          buyer: trader,
          nTokens: op.n,
          curveCost: cost,
          feeTotal: 0n,
          pCut: 0n,
          cCut: 0n,
          rCut: 0n,
          remainder: 0n,
          hasReferral: false,
          referral: EMPTY_REF,
        });
        soldRunning += op.n;
      } else {
        const payout = curvePayoutSell(soldRunning, op.n, basePrice, slope);
        h.sell({
          seller: trader,
          nTokens: op.n,
          curvePayout: payout,
          feeTotal: 0n,
          pCut: 0n,
          cCut: 0n,
          rCut: 0n,
          remainder: 0n,
          hasReferral: false,
          referral: EMPTY_REF,
        });
        soldRunning -= op.n;
      }
      // Key identity: running reserve equals integral from 0 to tokens_sold,
      // independent of how we got there.
      const s = getLedger(h);
      const expected = curveCostBuy(0n, soldRunning, basePrice, slope);
      expect(s.night_reserve).toBe(expected);
    }
  });

  it('withdrawals do not leak beyond accrued: cannot withdraw more than accrued', async () => {
    const h = await deployInSimulator({
      basePrice: 10_000n,
      slope: 0n,
      maxSupply: 10n,
      feeBps: 100,
      pBps: 5000,
      cBps: 4000,
      rBps: 1000,
    });
    const buyer = new Uint8Array(32).fill(9);
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
      hasReferral: false,
      referral: EMPTY_REF,
    });

    // First sweep works and zeroes the accrual.
    expect(getLedger(h).platform_accrued).toBeGreaterThan(0n);
    h.withdrawPlatform();
    expect(getLedger(h).platform_accrued).toBe(0n);

    // Second sweep without new accrual throws — caller can't re-withdraw the
    // same balance twice.
    expect(() => h.withdrawPlatform()).toThrow();

    // Same property for creator.
    expect(getLedger(h).creator_accrued).toBeGreaterThan(0n);
    h.withdrawCreator();
    expect(getLedger(h).creator_accrued).toBe(0n);
    expect(() => h.withdrawCreator()).toThrow();
  });

  it('10-random-ops property: per-trade p + c + r + remainder == fee in ledger deltas', async () => {
    const basePrice = 1000n;
    const slope = 1n;
    const feeBps = 100;
    const pBps = 5000;
    const cBps = 4000;
    const rBps = 1000;
    const h = await deployInSimulator({
      basePrice,
      slope,
      maxSupply: 10_000n,
      feeBps,
      pBps,
      cBps,
      rBps,
    });
    const trader = new Uint8Array(32).fill(9);
    const other = new Uint8Array(32).fill(42);
    const refKeys: Uint8Array[] = [];

    // Seed 200 tokens so sells are valid; they're pre-accounted in deltas
    // (we track baseline before each op).
    {
      const seed = 200n;
      const cost = curveCostBuy(0n, seed, basePrice, slope);
      const cuts = rawCuts(cost, feeBps, pBps, cBps, rBps);
      h.buy({
        buyer: trader,
        nTokens: seed,
        curveCost: cost,
        feeTotal: cuts.fee,
        pCut: cuts.p,
        cCut: cuts.c,
        rCut: cuts.r,
        remainder: cuts.remainder,
        hasReferral: false,
        referral: EMPTY_REF,
      });
    }
    let soldRunning = 200n;

    // Deterministic pseudo-random (seeded) so the test is reproducible.
    let seed = 0xDEADBEEF;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xFFFFFFFF;
    };

    for (let i = 0; i < 10; i++) {
      const pre = getLedger(h);
      const prePlatform = pre.platform_accrued;
      const preCreator = pre.creator_accrued;
      const preRefSum = refKeys.reduce(
        (acc, k) =>
          acc +
          (pre.referrals_accrued.member(k) ? pre.referrals_accrued.lookup(k) : 0n),
        0n,
      );

      const dice = rand();
      if (dice < 0.55) {
        // Buy.
        const n = BigInt(Math.floor(rand() * 10) + 1);
        const cost = curveCostBuy(soldRunning, n, basePrice, slope);
        const cuts = rawCuts(cost, feeBps, pBps, cBps, rBps);
        const withRef = rand() < 0.4;
        const ref = new Uint8Array(32).fill(i + 100);
        if (withRef) refKeys.push(ref);
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

        // Ledger delta sanity: delta sums to cuts.fee.
        const post = getLedger(h);
        const postRefSum = refKeys.reduce(
          (acc, k) =>
            acc +
            (post.referrals_accrued.member(k)
              ? post.referrals_accrued.lookup(k)
              : 0n),
          0n,
        );
        const dPlatform = post.platform_accrued - prePlatform;
        const dCreator = post.creator_accrued - preCreator;
        const dRef = postRefSum - preRefSum;
        expect(dPlatform + dCreator + dRef).toBe(cuts.fee);
      } else if (dice < 0.85 && soldRunning > 0n) {
        // Sell.
        const n = BigInt(Math.min(Number(soldRunning), Math.floor(rand() * 5) + 1));
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

        const post = getLedger(h);
        const postRefSum = refKeys.reduce(
          (acc, k) =>
            acc +
            (post.referrals_accrued.member(k)
              ? post.referrals_accrued.lookup(k)
              : 0n),
          0n,
        );
        const dPlatform = post.platform_accrued - prePlatform;
        const dCreator = post.creator_accrued - preCreator;
        const dRef = postRefSum - preRefSum;
        expect(dPlatform + dCreator + dRef).toBe(cuts.fee);
      } else {
        // Transfer — must add zero to any accrual delta.
        h.transfer({ fromAddr: trader, toAddr: other, amount: 1n });
        const post = getLedger(h);
        const postRefSum = refKeys.reduce(
          (acc, k) =>
            acc +
            (post.referrals_accrued.member(k)
              ? post.referrals_accrued.lookup(k)
              : 0n),
          0n,
        );
        expect(post.platform_accrued - prePlatform).toBe(0n);
        expect(post.creator_accrued - preCreator).toBe(0n);
        expect(postRefSum - preRefSum).toBe(0n);
      }
    }
  });
});
