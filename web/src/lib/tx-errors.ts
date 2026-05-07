// Buy/sell error taxonomy + classifier.
//
// Every async path on the trade panel (build, sign, submit, poll, refetch)
// terminates in exactly one TxOutcome state. Adding a new code: pick the
// state, add the regex/predicate to classifyError, add the UX entry below.
//
// Reference shapes:
//   CIP-30 spec error  : { code: -1 | -2 | -3 | -4, info: string }
//   Lucid Evolution    : Error instance, .message contains node reason
//   Blockfrost (lib)   : new Error(`Blockfrost ${path} → ${status}`)

export type TxErrorCode =
  | 'USER_REJECTED'
  | 'WALLET_LOCKED'
  | 'WALLET_DISCONNECTED'
  | 'INSUFFICIENT_ADA'
  | 'INSUFFICIENT_TOKENS'
  | 'UTXO_FRAGMENTED'
  | 'OUTPUT_TOO_SMALL'
  | 'CURVE_UTXO_GONE'
  | 'VALIDATOR_REJECTED'
  | 'NETWORK_ERROR'
  | 'BLOCKFROST_DOWN'
  | 'CONFIG_ERROR'
  | 'TX_OUTRACED'
  | 'INTERNAL_ERROR';

export type TxOutcomeState = 'success' | 'user_cancelled' | 'retry_safe' | 'contact_support';

export type TxOutcome =
  | { state: 'success';         txHash: string }
  | { state: 'user_cancelled';  code: 'USER_REJECTED'; raw: string }
  | { state: 'retry_safe';      code: TxErrorCode;     raw: string }
  | { state: 'contact_support'; code: TxErrorCode;     raw: string };

// ── Raw error string ──────────────────────────────────────────────────────
// CIP-30 errors come back as plain { code, info } objects (not Error
// instances) on Vespr/Eternl/Lace, so a naive String(e) yields "[object
// Object]". This collapses every shape we've seen into a string suitable
// for both classification and logging.
export function rawErrorString(e: unknown): string {
  if (e instanceof Error)   return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    if (typeof o.info    === 'string') return `${o.code ?? ''} ${o.info}`.trim();
    if (typeof o.message === 'string') return o.message;
    if (typeof o.cause   === 'string') return o.cause;
    if (o.cause && typeof o.cause === 'object') {
      const c = o.cause as Record<string, unknown>;
      if (typeof c.message === 'string') return c.message;
    }
    try { return JSON.stringify(e); } catch { /* fallthrough */ }
  }
  return String(e);
}

// ── Classifier ────────────────────────────────────────────────────────────
// Order matters: more-specific patterns first. The first match wins.
// Return type excludes 'success' — classifier only sees throwables.
export type FailureState = Exclude<TxOutcomeState, 'success'>;

export function classifyError(e: unknown): { code: TxErrorCode; state: FailureState; raw: string } {
  const raw = rawErrorString(e);
  const m   = raw.toLowerCase();

  // CIP-30 numeric codes — Vespr returns these as { code: -2, info: "..." }
  const code = (e && typeof e === 'object' && 'code' in (e as object))
    ? (e as { code?: number }).code
    : undefined;
  if (code === -2 || /user (declined|rejected|cancel)/.test(m) || /declined to sign/.test(m))
    return { code: 'USER_REJECTED',       state: 'user_cancelled', raw };
  if (code === -3 || /wallet.*locked/.test(m))
    return { code: 'WALLET_LOCKED',       state: 'retry_safe',     raw };
  if (/no used addresses|wallet not enabled|not connected/.test(m))
    return { code: 'WALLET_DISCONNECTED', state: 'retry_safe',     raw };

  // Validator + UTxO race (specific phrases first — the BadInputs check
  // overlaps with generic submit failures, so we anchor on tokens).
  if (/badinputs|input.*already spent|input not found|input.*consumed|missingrequiredinputs/.test(m))
    return { code: 'CURVE_UTXO_GONE',     state: 'retry_safe',     raw };
  if (/validator (crashed|rejected|failed)|exited prematurely|script.*failed|plutus.*failed/.test(m))
    return { code: 'VALIDATOR_REJECTED',  state: 'retry_safe',     raw };

  // Funds / sizing
  if (/insufficient.*ada|insufficientinputbalance|not enough lovelace/.test(m))
    return { code: 'INSUFFICIENT_ADA',    state: 'retry_safe',     raw };
  if (/not enough tokens|insufficient.*token/.test(m))
    return { code: 'INSUFFICIENT_TOKENS', state: 'retry_safe',     raw };
  if (/not enough ada leftover|change address|fragmented/.test(m))
    return { code: 'UTXO_FRAGMENTED',     state: 'retry_safe',     raw };
  if (/minimum output|below the cardano minimum|output too small/.test(m))
    return { code: 'OUTPUT_TOO_SMALL',    state: 'retry_safe',     raw };

  // Network / infra
  if (/blockfrost.*5\d\d/.test(m))
    return { code: 'BLOCKFROST_DOWN',     state: 'retry_safe',     raw };
  if (/fetch failed|econnrefused|enotfound|timeout|network/.test(m))
    return { code: 'NETWORK_ERROR',       state: 'retry_safe',     raw };

  // Config (operator error, not user error)
  if (/treasury not configured|validator cbor|missing.*cbor/.test(m))
    return { code: 'CONFIG_ERROR',        state: 'contact_support', raw };

  return { code: 'INTERNAL_ERROR', state: 'contact_support', raw };
}

// Sentinel for the post-submit poll timeout — treat as a classified failure
// so the same UI/logging path applies.
export function outracedOutcome(): Extract<TxOutcome, { state: 'retry_safe' }> {
  return { state: 'retry_safe', code: 'TX_OUTRACED', raw: 'tx-status poll timed out (~120s)' };
}

// ── Per-code UX ───────────────────────────────────────────────────────────
export interface TxUx {
  headline: string;
  body:     string;
  cta?:     'retry' | 'reconnect' | 'report';
}

export const TX_UX: Record<TxErrorCode, TxUx> = {
  USER_REJECTED: {
    headline: 'Trade cancelled',
    body:     'No funds moved.',
  },
  WALLET_LOCKED: {
    headline: 'Wallet is locked',
    body:     'Unlock your wallet and try again.',
    cta:      'retry',
  },
  WALLET_DISCONNECTED: {
    headline: 'Wallet connection lost',
    body:     'Reconnect your wallet and try again.',
    cta:      'reconnect',
  },
  INSUFFICIENT_ADA: {
    headline: 'Not enough ADA',
    body:     'Reduce the amount or top up — fees and the 2 ADA min-utxo are included.',
  },
  INSUFFICIENT_TOKENS: {
    headline: 'Not enough tokens',
    body:     'You\'re trying to sell more than your balance.',
  },
  UTXO_FRAGMENTED: {
    headline: 'Wallet UTxOs are fragmented',
    body:     'Cardano can\'t fit your tokens into a change output. Send all your ADA from this wallet to itself in one tx ("Send Max" in most wallets), then retry.',
    cta:      'retry',
  },
  OUTPUT_TOO_SMALL: {
    headline: 'Trade too small',
    body:     'Net amount is below Cardano\'s 1 ADA minimum output. Increase the size.',
  },
  CURVE_UTXO_GONE: {
    headline: 'Another trade landed first',
    body:     'The curve moved between your quote and submit. Reserves refreshed — retry to try again.',
    cta:      'retry',
  },
  VALIDATOR_REJECTED: {
    headline: 'Smart contract rejected the trade',
    body:     'The on-chain validator refused this transaction. Reserves refreshed — retry, or wait 30 s if it persists.',
    cta:      'retry',
  },
  NETWORK_ERROR: {
    headline: 'Network error',
    body:     'Check your connection and try again.',
    cta:      'retry',
  },
  BLOCKFROST_DOWN: {
    headline: 'Indexer temporarily unavailable',
    body:     'Try again in a moment.',
    cta:      'retry',
  },
  CONFIG_ERROR: {
    headline: 'Configuration issue',
    body:     'The protocol parameters look wrong — please report this.',
    cta:      'report',
  },
  TX_OUTRACED: {
    headline: 'Transaction did not confirm',
    body:     'Likely outraced by another trade on the same curve. The trade was not applied — safe to retry.',
    cta:      'retry',
  },
  INTERNAL_ERROR: {
    headline: 'Unexpected error',
    body:     'Try again, or report it if this keeps happening.',
    cta:      'retry',
  },
};

// Auto-retry policy: only race-style failures, exactly once.
export function shouldAutoRetry(code: TxErrorCode, attempts: number): boolean {
  if (attempts >= 2) return false;
  return code === 'CURVE_UTXO_GONE' || code === 'VALIDATOR_REJECTED';
}

// ── Log shape ─────────────────────────────────────────────────────────────
export interface TxAttemptLog {
  ts:                 string;
  op:                 'buy' | 'sell';
  policyId:           string;
  assetUnit:          string;
  walletName:         string;
  network:            'Mainnet' | 'Preprod';
  adaIn?:             string;
  tokensIn?:          string;
  curveAdaReserve?:   string;
  curveTokenReserve?: string;
  creatorFeeBps:      number;
  slippageBps:        number;
  outcome:            TxOutcomeState;
  code?:              TxErrorCode;
  txHash?:            string;
  durationMs:         number;
  retryCount:         number;
  errorMessage?:      string;
  errorRaw?:          string;
  confirmedAfterMs?:  number;
}

// Fire-and-forget log emit. Always console.info; optionally POST to a
// server sink so we can grep aggregate funnel data on Vercel logs.
export function emitTxLog(log: TxAttemptLog): void {
  // eslint-disable-next-line no-console
  console.info('[trade]', JSON.stringify(log));
  if (typeof window === 'undefined') return;
  const sinkOn = process.env.NEXT_PUBLIC_TX_LOG_SINK === '1';
  if (!sinkOn) return;
  try {
    void fetch('/api/log/tx-attempt', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify(log),
      keepalive: true,
    }).catch(() => { /* swallow */ });
  } catch { /* swallow */ }
}
