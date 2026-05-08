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
//
// Special-cased: Lucid Evolution wraps wallet errors as Effect-style
// classes (TxSubmitError, TxSignerError, …) where `.message` is the
// String(originalError) of the CIP-30 payload — i.e. literally "[object
// Object]". The real `{ code, info }` is parked under .cause / .error /
// the original Effect tag. We probe those before falling back to message.
export function rawErrorString(e: unknown): string {
  // Try a chain of nested-error fields in priority order. CIP-30 plain
  // objects, Effect's `.cause`, Lucid's `.error` (some throw classes use
  // a non-standard field), and our own previously-flattened messages.
  if (e instanceof Error) {
    const probed = probeNested(e);
    if (probed) return probed;
    if (e.message && e.message !== '[object Object]') return e.message;
    // Last resort: dump own properties so a future failure isn't opaque.
    try { return JSON.stringify(e, Object.getOwnPropertyNames(e)).slice(0, 1024); }
    catch { /* fallthrough */ }
    return e.message ?? String(e);
  }
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const probed = probeNested(e);
    if (probed) return probed;
    try { return JSON.stringify(e); } catch { /* fallthrough */ }
  }
  return String(e);
}

// Walk a few well-known nested-error fields looking for a CIP-30 shape
// `{ code, info }` or a string message. Returns null if nothing useful.
//
// Effect-style classes (Lucid Evolution's TxSubmitError, TxSignerError,
// TxBuilderError) hide the underlying wallet payload behind class slots
// that aren't enumerable. We additionally walk Object.getOwnPropertyNames
// to reach those.
function probeNested(e: object): string | null {
  const wellKnown = ['cause', 'error', 'reason', 'data', 'original', 'inner'];
  for (const f of wellKnown) {
    const v = (e as Record<string, unknown>)[f];
    const m = matchCip30Like(v);
    if (m) return m;
  }
  // Walk every own property — covers Effect's non-enumerable slots.
  for (const name of Object.getOwnPropertyNames(e)) {
    if (name === 'message' || name === 'stack' || name === 'name') continue;
    const v = (e as Record<string, unknown>)[name];
    const m = matchCip30Like(v);
    if (m) return m;
  }
  // Top-level CIP-30 shape on the error object itself.
  return matchCip30Like(e);
}

// Recognise a CIP-30 `{ code, info }` shape, a nested `cause` of one, an
// Effect Cause tagged union, or a plain string message. Return the
// rendered string if found.
function matchCip30Like(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.info === 'string')   return `${o.code ?? ''} ${o.info}`.trim();
  if (typeof o.message === 'string' && o.message !== '[object Object]') return o.message;

  // Effect Cause<E> tagged union — Lucid Evolution wraps wallet errors as
  // FiberFailureError whose .cause is one of these. The shape is documented
  // in @effect/io: Fail | Die | Sequential | Parallel | Empty | Interrupt.
  switch (o._tag) {
    case 'Fail':       return matchCip30Like(o.error);
    case 'Die':        return matchCip30Like(o.defect);
    case 'Sequential':
    case 'Parallel':   return matchCip30Like(o.left) ?? matchCip30Like(o.right);
  }

  if (o.cause && typeof o.cause === 'object') {
    return matchCip30Like(o.cause);
  }
  return null;
}

// Pull a numeric `code` off the error or any of its nested error slots.
// Used by the classifier to dispatch on CIP-30 numeric codes when the
// info string alone is ambiguous. Walks the same Effect Cause shape as
// matchCip30Like so FiberFailureError is reachable.
function pickCode(e: unknown, depth = 0): number | undefined {
  if (depth > 5 || !e || typeof e !== 'object') return undefined;
  const o = e as Record<string, unknown>;
  if (typeof o.code === 'number') return o.code;

  // Effect Cause walk.
  switch (o._tag) {
    case 'Fail':       return pickCode(o.error,  depth + 1);
    case 'Die':        return pickCode(o.defect, depth + 1);
    case 'Sequential':
    case 'Parallel':   return pickCode(o.left, depth + 1) ?? pickCode(o.right, depth + 1);
  }

  // Well-known nested error slots.
  for (const f of ['cause', 'error', 'reason', 'data', 'original', 'inner']) {
    const v = (e as Record<string, unknown>)[f];
    const c = pickCode(v, depth + 1);
    if (typeof c === 'number') return c;
  }
  // Same walk over non-enumerable own properties.
  for (const name of Object.getOwnPropertyNames(e)) {
    if (name === 'message' || name === 'stack' || name === 'name') continue;
    const c = pickCode((e as Record<string, unknown>)[name], depth + 1);
    if (typeof c === 'number') return c;
  }
  return undefined;
}

// ── Classifier ────────────────────────────────────────────────────────────
// Order matters: more-specific patterns first. The first match wins.
// Return type excludes 'success' — classifier only sees throwables.
export type FailureState = Exclude<TxOutcomeState, 'success'>;

export function classifyError(e: unknown): { code: TxErrorCode; state: FailureState; raw: string } {
  const raw = rawErrorString(e);
  const m   = raw.toLowerCase();

  // CIP-30 numeric codes:
  //   APIError      : -1 InvalidRequest, -2 InternalError, -3 Refused, -4 AccountChange
  //   TxSignError   : 1 ProofGeneration, 2 UserDeclined
  //   TxSendError   : 1 Refused,          2 Failure
  // Read whichever is on the throwable. Vespr/Eternl/Lace all surface
  // their wallet-side rejection as `info` strings, so we additionally
  // string-match — the numeric `code` alone is not enough to tell user
  // rejection apart from a generic wallet hiccup.
  const code = pickCode(e);

  // User rejection. POSITIVE code 2 (TxSignError.UserDeclined) is the
  // canonical signal; we also accept the english variants. Negative -2
  // is APIError.InternalError, NOT a rejection — handled below.
  if (
    /user (declined|rejected|cancel)/.test(m) ||
    /declined to sign/.test(m) ||
    /transaction declined/.test(m) ||
    code === 2
  ) return { code: 'USER_REJECTED',       state: 'user_cancelled', raw };

  // CIP-30 APIError.Refused is `-3`. Vespr's info field tells us whether
  // it's "wallet locked" (PIN expired, user has to unlock) or "wallet
  // disconnected" (dApp lost authorization, user has to re-approve from
  // the wallet's connected-dApps list). Both are retry-safe but the CTA
  // and copy differ.
  if (code === -3) {
    if (/disconnect|lack of access|not authorized|authoriz/i.test(m)) {
      return { code: 'WALLET_DISCONNECTED', state: 'retry_safe', raw };
    }
    return { code: 'WALLET_LOCKED', state: 'retry_safe', raw };
  }
  if (/wallet.*locked/.test(m))
    return { code: 'WALLET_LOCKED',       state: 'retry_safe',     raw };
  if (/no used addresses|wallet not enabled|not connected|refused/.test(m))
    return { code: 'WALLET_DISCONNECTED', state: 'retry_safe',     raw };

  // CIP-30 APIError.InternalError — wallet's own submit endpoint failed
  // for an opaque reason. Most often: wallet just lost network context,
  // tx is malformed for the wallet's submit node, or a transient hiccup.
  // Retry-safe (no auto-retry — root cause is unknown to us).
  if (code === -2 || /error occurred during execution of this api call/i.test(m))
    return { code: 'INTERNAL_ERROR',      state: 'retry_safe',     raw };

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
