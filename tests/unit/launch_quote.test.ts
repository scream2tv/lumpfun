import { describe, it, expect } from 'vitest';
import { quoteBuy, quoteSell } from '../../src/launch.js';
import type { LaunchHandle } from '../../src/launch.js';

function mkLaunch(tokensSold: bigint): LaunchHandle {
  return {
    contractAddress: '0xabc',
    metadata: {
      name: 'x',
      symbol: 'x',
      decimals: 6,
      imageUri: '',
      creatorPubkey: '',
    },
    curve: { basePriceNight: 1000n, slopeNight: 1n, maxSupply: 1_000_000n },
    fees: {
      feeBps: 100,
      platformShareBps: 5000,
      creatorShareBps: 4000,
      referralShareBps: 1000,
      platformRecipient: '',
      creatorRecipient: '',
    },
    state: {
      tokensSold,
      nightReserve: 0n,
      platformAccrued: 0n,
      creatorAccrued: 0n,
    },
    explorerUrl: '',
  };
}

describe('quoteBuy', () => {
  it('first buy (tokensSold=0, n=10) matches closed-form', () => {
    const q = quoteBuy(mkLaunch(0n), 10n);
    // curveCost = 1000*10 + 1*(0 + 45) = 10045
    expect(q.curveSide).toBe(10045n);
    // fee = 10045 * 100 / 10000 = 100 (floor, since 10045*100=1004500 / 10000 = 100)
    expect(q.fee).toBe(100n);
    // grossPayByBuyer = 10045 + 100 = 10145
    expect(q.grossPayByBuyer).toBe(10145n);
    // Routed split (no referral): platform = p + remainder + r; creator = c; referral = 0
    const p = (100n * 5000n) / 10000n; // 50
    const c = (100n * 4000n) / 10000n; // 40
    const r = (100n * 1000n) / 10000n; // 10
    const remainder = 100n - p - c - r; // 0
    expect(q.split.platform).toBe(p + remainder + r); // 60
    expect(q.split.creator).toBe(c); // 40
    expect(q.split.referral).toBe(0n); // absent routes to platform
  });

  it('with referral present: referral cut is preserved', () => {
    const q = quoteBuy(mkLaunch(0n), 10n, true);
    expect(q.split.platform).toBe(50n); // just p + remainder(0)
    expect(q.split.creator).toBe(40n);
    expect(q.split.referral).toBe(10n);
  });
});

describe('quoteSell', () => {
  it('curvePayout equals curveCost at equal supply (roundtrip)', () => {
    // Sell 10 when tokensSold=10 → curve_payout = curve_cost(0, 10) = 10045
    const q = quoteSell(mkLaunch(10n), 10n);
    expect(q.curveSide).toBe(10045n);
    expect(q.netReceivedBySeller).toBe(10045n - q.fee);
  });
});
