import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';

const CWD = '/Users/scream2/Desktop/Projects/LumpFun';

function run(args: string[]): string {
  try {
    return execFileSync('npm', ['run', '--silent', 'dev', '--', ...args], {
      cwd: CWD,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    }).toString();
  } catch (e) {
    // commander exits non-zero on help for some versions; fall back to stdout
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = e as any;
    return (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '');
  }
}

describe('CLI shape', () => {
  it('--help shows top-level description', () => {
    const out = run(['--help']);
    expect(out).toMatch(/LumpFun/);
    expect(out).toMatch(/wallet/);
    expect(out).toMatch(/launch/);
    expect(out).toMatch(/chain/);
  });

  it('launch --help lists all subcommands', () => {
    const out = run(['launch', '--help']);
    for (const sub of [
      'deploy',
      'list',
      'info',
      'quote-buy',
      'quote-sell',
      'buy',
      'sell',
      'transfer',
      'withdraw-platform',
      'withdraw-creator',
      'withdraw-referral',
      'fees',
      'verify-split',
    ]) {
      expect(out).toMatch(new RegExp(`\\b${sub}\\b`));
    }
  });
});
