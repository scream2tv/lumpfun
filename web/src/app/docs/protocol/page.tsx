import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'LumpFun On-Chain Protocol',
  description: 'Aiken validator parameterisation, curve datum/redeemer encoding, fee accumulator, vesting timelock, and end-to-end transaction patterns for LumpFun on Cardano.',
};

export default function ProtocolDoc() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <p className="text-xs uppercase tracking-[0.25em] mb-2"
        style={{ color: 'var(--lava-bright)', fontFamily: 'var(--font-outfit)' }}>
        <Link href="/docs" style={breadcrumb}>← Docs</Link>
      </p>
      <h1 className="font-bold mb-3" style={h1}>On-Chain Protocol</h1>
      <p style={p}>
        Everything you need to build, sign, and submit transactions against
        LumpFun directly. Source of truth for validators is{' '}
        <code style={code}>contracts/cardano/</code> in the repo. CBOR
        constants below match the deployed mainnet build.
      </p>

      <Toc items={[
        { id: 'overview',        label: 'Architecture overview' },
        { id: 'addresses',       label: 'Per-launch addresses & params' },
        { id: 'curve-validator', label: 'Bonding curve validator' },
        { id: 'curve-math',      label: 'Curve math (constant product + virtual ADA)' },
        { id: 'fee-accumulator', label: 'Fee accumulator' },
        { id: 'vesting',         label: 'Vesting timelock' },
        { id: 'minting',         label: 'One-shot minting policy' },
        { id: 'tx-buy',          label: 'Build a buy transaction' },
        { id: 'tx-sell',         label: 'Build a sell transaction' },
        { id: 'tx-launch',       label: 'Build a launch transaction' },
        { id: 'graduation',      label: 'Graduation to Minswap V2' },
      ]} />

      {/* ── Overview ─────────────────────────────────────────────────── */}
      <Section id="overview" title="Architecture overview">
        <p style={p}>
          Each launched token has a unique <strong style={strong}>policy ID</strong>{' '}
          (one-shot mint), <strong style={strong}>curve script address</strong>{' '}
          (parameterised bonding curve), and{' '}
          <strong style={strong}>fee accumulator address</strong>{' '}
          (parameterised with the creator&apos;s vkey). Trades transition the
          curve UTxO; fees pay into the accumulator; vesting (if any) locks
          the creator&apos;s initial-buy tokens at a separate per-position
          timelock script. Once <code style={code}>ada_reserve</code> reaches
          the configured graduation threshold, the curve drains via the{' '}
          <code style={code}>Graduate</code> redeemer and a Minswap V2 pool
          is created from the protocol treasury.
        </p>
        <p style={p}>
          All scripts are PlutusV3, written in Aiken (stdlib v3.1.0).
        </p>
      </Section>

      {/* ── Addresses ────────────────────────────────────────────────── */}
      <Section id="addresses" title="Per-launch addresses & params">
        <p style={p}>
          A launch is fully described by the parameters baked into its
          validators at deploy time. To reconstruct any address from scratch,
          reapply the params to the unparameterised CBOR below.
        </p>
        <ParamTable rows={[
          ['curveAddress',          'bonding_curve script with (policyId, assetName, creatorFeeBps, treasuryPkh, payment_hash, graduationAda) params'],
          ['feeAccumulatorAddress', 'fee_accumulator script with (creatorPkh) param'],
          ['vestingAddress',        'vesting script with (creatorPkh, unlockPosixMs) params (per-position)'],
          ['policyId',              'one-shot minting policy with the launch seed UTxO encoded'],
        ]} />
        <p style={p}>
          On a new launch, <code style={code}>payment_hash</code> equals the{' '}
          <strong style={strong}>fee accumulator&apos;s script hash</strong>,
          not the creator&apos;s vkey. This is what routes creator fees into
          the accumulator. Tokens launched before the accumulator was added
          have <code style={code}>payment_hash = creator_pkh</code> instead
          and pay the creator&apos;s wallet directly. Both are parsed by the
          same{' '}
          <code style={code}>fees.creator_fee_paid</code> check, which now
          accepts either VKey or Script payment credentials.
        </p>
      </Section>

      {/* ── Curve validator ─────────────────────────────────────────── */}
      <Section id="curve-validator" title="Bonding curve validator">
        <p style={pTitle}>Datum (inline)</p>
        <CodeBlock>{`pub type CurveDatum {
  ada_reserve:   Int,   // lovelace at the curve UTxO
  token_reserve: Int,   // tokens in the curve, ready to sell
}

// CBOR encoding: Constr(0, [<uint ada_reserve>, <uint token_reserve>])
//   d8 79 82 <cbor-uint> <cbor-uint>`}</CodeBlock>

        <p style={pTitle}>Redeemer</p>
        <CodeBlock>{`pub type CurveRedeemer {
  Buy      { min_out: Int }   // Constr(0, [<uint min_out>])
  Sell     { min_out: Int }   // Constr(1, [<uint min_out>])
  Graduate                    // Constr(2, [])
}`}</CodeBlock>

        <p style={pTitle}>Validator parameters (compile-time)</p>
        <CodeBlock>{`validator bonding_curve(
  policy_id:        ByteArray,    // 28-byte policy hash (hex)
  asset_name:       ByteArray,    // utf-8 of ticker, hex-encoded
  creator_fee_bps:  Int,          // 0..200, 100 = 1%
  treasury_pkh:     ByteArray,    // protocol treasury vkey hash
  payment_hash:     ByteArray,    // fee accumulator script hash (new) OR creator vkey (legacy)
  graduation_ada:   Int,          // lovelace threshold, default 21_000_000_000
)`}</CodeBlock>

        <p style={pTitle}>Spend rules — Buy</p>
        <ul style={ul}>
          <Item><code style={code}>old_ada &lt; graduation_ada</code> (curve hasn&apos;t graduated)</Item>
          <Item><code style={code}>ada_in &gt; 0</code> and matches{' '}
            <code style={code}>quote_buy(old_ada, old_tokens, ada_in)</code> exactly</Item>
          <Item>continuation curve UTxO has{' '}
            <code style={code}>lovelace = old_lovelace + ada_in</code> and{' '}
            <code style={code}>tokens = old_tokens − tokens_out</code></Item>
          <Item>tx pays platform fee (1 ADA) to <code style={code}>treasury_pkh</code></Item>
          <Item>tx pays creator fee (<code style={code}>ada_in × bps / 10000</code>) to{' '}
            <code style={code}>payment_hash</code> (script or vkey)</Item>
          <Item><code style={code}>tokens_out ≥ min_out</code></Item>
        </ul>

        <p style={pTitle}>Spend rules — Sell</p>
        <ul style={ul}>
          <Item>same graduation gate</Item>
          <Item><code style={code}>tokens_in &gt; 0</code> and{' '}
            <code style={code}>ada_gross = quote_sell_gross(old_ada, old_tokens, tokens_in)</code></Item>
          <Item>continuation has{' '}
            <code style={code}>lovelace = old_lovelace − ada_gross</code> and{' '}
            <code style={code}>tokens = old_tokens + tokens_in</code></Item>
          <Item>platform + creator fees as above (creator fee on{' '}
            <code style={code}>ada_gross</code> for sell)</Item>
          <Item><code style={code}>net_ada ≥ min_out</code> where{' '}
            <code style={code}>net_ada = ada_gross − bps/10000 × ada_gross − 1_000_000</code></Item>
        </ul>

        <p style={pTitle}>Spend rules — Graduate</p>
        <ul style={ul}>
          <Item>Single check: <code style={code}>datum.ada_reserve ≥ graduation_ada</code></Item>
          <Item>Off-chain side (driven from treasury) sweeps the curve into
            treasury, then creates the Minswap V2 pool in a follow-up tx.</Item>
        </ul>
      </Section>

      {/* ── Curve math ──────────────────────────────────────────────── */}
      <Section id="curve-math" title="Curve math">
        <p style={p}>
          Constant-product with a <strong style={strong}>3,000 ADA virtual
          offset</strong> (sets the starting price without seeding real
          liquidity). Total supply is <code style={code}>1_000_000_000n</code>{' '}
          per token (0 decimals).
        </p>
        <CodeBlock>{`const VIRTUAL_ADA  = 3_000_000_000n; // lovelace

quote_buy(adaReserve, tokenReserve, adaIn):
  effective       = adaReserve + VIRTUAL_ADA
  k               = effective × tokenReserve
  newEffective    = effective + adaIn
  newTokenReserve = k / newEffective              // floor division
  return tokenReserve − newTokenReserve

quote_sell_gross(adaReserve, tokenReserve, tokensIn):
  effective       = adaReserve + VIRTUAL_ADA
  k               = effective × tokenReserve
  newTokenReserve = tokenReserve + tokensIn
  newEffective    = k / newTokenReserve
  gross           = effective − newEffective
  return min(gross, adaReserve)                   // safety cap

spotPrice(adaReserve, tokenReserve):
  return (adaReserve + VIRTUAL_ADA) × 1e6 / tokenReserve  // lovelace/token`}</CodeBlock>
        <p style={p}>
          The off-chain helpers are exported from{' '}
          <code style={code}>web/src/lib/curve-math.ts</code> in the repo.
          Use them — don&apos;t re-implement floor division semantics.
        </p>
      </Section>

      {/* ── Fee accumulator ────────────────────────────────────────── */}
      <Section id="fee-accumulator" title="Fee accumulator">
        <p style={p}>
          Per-launch script that collects creator fees into a single growing
          UTxO. Without it, every fee under ~1 ADA bumps to Cardano&apos;s
          min-UTxO and fragments the creator&apos;s wallet across hundreds of
          dust outputs after a few hundred trades.
        </p>
        <p style={pTitle}>Validator parameters</p>
        <CodeBlock>{`validator fee_accumulator(
  creator_pkh: ByteArray,   // only key that can spend
)

// Datum: unused
// Redeemer: unused
// Spend rule: tx is signed by creator_pkh.`}</CodeBlock>

        <p style={pTitle}>Lifecycle</p>
        <ul style={ul}>
          <Item>At launch: derive the accumulator address from the creator&apos;s
            vkey, take its <strong style={strong}>script hash</strong>, and
            use that hash as <code style={code}>payment_hash</code> when
            parameterising the bonding curve.</Item>
          <Item>On every trade: bonding-curve validator checks that{' '}
            <code style={code}>creator_fee × ada_in/10000</code> lovelace was
            paid to a UTxO whose payment credential matches{' '}
            <code style={code}>payment_hash</code> — including Script
            credentials. So the fee output flows to the accumulator address.</Item>
          <Item>Anytime: creator submits a tx that spends every UTxO at the
            accumulator address (signs as the creator&apos;s wallet) and
            sends the total lovelace back to themselves.</Item>
        </ul>
        <p style={p}>
          Helper available in{' '}
          <code style={code}>web/src/lib/cardano-tx.ts</code> as{' '}
          <code style={code}>claimCreatorFees(walletApi, address, validatorCbor)</code>.
        </p>
      </Section>

      {/* ── Vesting ─────────────────────────────────────────────────── */}
      <Section id="vesting" title="Vesting timelock">
        <p style={p}>
          Optional per-launch (and re-vest) lockup for creator tokens. Each
          unlock time produces a different parameterised script address, so
          positions with different timelines never collide on chain.
        </p>
        <p style={pTitle}>Validator parameters</p>
        <CodeBlock>{`validator vesting(
  creator_pkh:     ByteArray,
  unlock_posix_ms: Int,        // POSIX milliseconds, matches Lucid validFrom
)

// Spend rule (both must hold):
//   1. tx is signed by creator_pkh
//   2. tx.validity_range.lower_bound is Finite(t) with t ≥ unlock_posix_ms`}</CodeBlock>
        <p style={p}>
          Claim path: <code style={code}>claimVestedTokens</code> in{' '}
          <code style={code}>cardano-tx.ts</code>. Adds the creator&apos;s
          pkh as a required signer and sets{' '}
          <code style={code}>validFrom = max(unlock + 1s, now + 5s)</code>{' '}
          so the slot lands strictly after the unlock without trying to be in
          the past.
        </p>
      </Section>

      {/* ── Minting policy ──────────────────────────────────────────── */}
      <Section id="minting" title="One-shot minting policy">
        <p style={p}>
          Parameterised with the launch <code style={code}>OutputReference</code>{' '}
          (a tx-input the creator&apos;s wallet consumes). Spending that input
          mints the token; once spent, the policy can never mint again. This
          is what makes <strong style={strong}>policyId</strong> uniquely
          identify a launch — no second mint is possible from the same script.
        </p>
        <p style={pTitle}>Param encoding</p>
        <CodeBlock>{`// CIP-25 OutputReference (stdlib v3): Constr(0, [<bytes tx_hash>, <int output_index>])
//   d8 79 82 <bytes32> <cbor-uint>`}</CodeBlock>
      </Section>

      {/* ── Buy tx walkthrough ─────────────────────────────────────── */}
      <Section id="tx-buy" title="Build a buy transaction">
        <p style={p}>
          Walks through the exact tx your buyTokens flow signs, using
          Lucid Evolution. Pseudocode is verbatim from{' '}
          <code style={code}>web/src/lib/cardano-tx.ts</code>; copy as-is.
        </p>
        <CodeBlock>{`import {
  Lucid, Blockfrost, Data, Constr,
  applyDoubleCborEncoding, applyParamsToScript,
} from '@lucid-evolution/lucid';

// 1. Connect Lucid + wallet
const lucid = await Lucid(new Blockfrost(BF_URL, BF_PROJECT_ID), 'Mainnet');
lucid.selectWallet.fromAPI(cip30);   // any CIP-30 wallet

// 2. Pull live curve UTxO + decode datum
const curveAddress = '<from registry>';
const assetUnit    = '<policyId><assetName-hex>';
const utxos = await lucid.utxosAt(curveAddress);
const curveUtxo = utxos.find(u => u.assets[assetUnit] !== undefined);
const datum = Data.from(curveUtxo.datum) as Constr<bigint>;
const adaReserve   = datum.fields[0] as bigint;
const tokenReserve = datum.fields[1] as bigint;

// 3. Compute quote (mirror chain math exactly)
const adaIn      = 5_000_000n;          // 5 ADA
const tokensOut  = quoteBuy(adaReserve, tokenReserve, adaIn);
const minOut     = tokensOut - (tokensOut * 50n) / 10000n;   // 0.5% slippage

// 4. New datum + redeemer
const newDatum = Data.to(new Constr(0, [adaReserve + adaIn, tokenReserve - tokensOut]));
const redeemer = Data.to(new Constr(0, [minOut]));           // Buy { min_out }

// 5. Build, sign, submit
const tx = await lucid.newTx()
  .collectFrom([{...curveUtxo, datumHash: undefined}], redeemer)
  .attach.SpendingValidator({ type: 'PlutusV3', script: validatorCbor })
  .pay.ToAddressWithData(
    curveAddress,
    { kind: 'inline', value: newDatum },
    { lovelace: curveUtxo.assets.lovelace + adaIn,
      [assetUnit]: tokenReserve - tokensOut },
  )
  .pay.ToAddress(treasuryAddress, { lovelace: 1_000_000n })   // platform fee
  .pay.ToAddress(feeAccumulatorAddress,                       // creator fee
                 { lovelace: (adaIn * BigInt(creatorFeeBps)) / 10000n })
  .pay.ToAddress(walletAddr, { lovelace: 2_000_000n,
                                [assetUnit]: tokensOut })     // buyer's tokens
  .complete()
  .then(t => t.sign.withWallet().complete());

const txHash = await tx.submit();`}</CodeBlock>
        <p style={p}>
          For tokens launched before the fee accumulator, replace{' '}
          <code style={code}>feeAccumulatorAddress</code> with the
          creator&apos;s bech32 wallet address — those validators require a
          VKey output to <code style={code}>creator_pkh</code>.
        </p>
      </Section>

      {/* ── Sell tx ─────────────────────────────────────────────────── */}
      <Section id="tx-sell" title="Build a sell transaction">
        <p style={p}>
          Mirror image of the buy. Datum updates are{' '}
          <code style={code}>(adaReserve − adaGross, tokenReserve + tokensIn)</code>;
          curve UTxO loses ADA and gains tokens; redeemer is{' '}
          <code style={code}>Constr(1, [minOutAdaNet])</code>; net ADA goes
          back to the seller&apos;s wallet:
        </p>
        <CodeBlock>{`const adaGross  = quoteSellGross(adaReserve, tokenReserve, tokensIn);
const creatorFee = (adaGross * BigInt(creatorFeeBps)) / 10000n;
const adaNet    = adaGross - 1_000_000n - creatorFee;
const minOut    = adaNet - (adaNet * 50n) / 10000n;          // 0.5% slippage

// .pay.ToAddress(curveAddress, { lovelace: lovelace - adaGross, [assetUnit]: tokenReserve + tokensIn })
// .pay.ToAddress(treasuryAddress,         { lovelace: 1_000_000n })
// .pay.ToAddress(feeAccumulatorAddress,   { lovelace: creatorFee })   // (or creator vkey for legacy)
// .pay.ToAddress(sellerWalletAddr,        { lovelace: adaNet })`}</CodeBlock>
      </Section>

      {/* ── Launch ─────────────────────────────────────────────────── */}
      <Section id="tx-launch" title="Build a launch transaction">
        <p style={p}>
          Programmatic launches are supported but not common — the UI handles
          the full flow including image upload, vesting parameterisation, and
          registry write. If you need to build a launch tx directly, the
          steps are:
        </p>
        <ol style={ol}>
          <Item>Pick a seed UTxO from the creator&apos;s wallet. This UTxO
            gets consumed by the mint — its{' '}
            <code style={code}>(txHash, outputIndex)</code> becomes the
            one-shot policy parameter, so policy ID is unique per launch.</Item>
          <Item>Derive the fee accumulator script + address (parameterise{' '}
            <code style={code}>FEE_ACCUMULATOR_CBOR</code> with the
            creator&apos;s vkey hash).</Item>
          <Item>Parameterise the bonding curve with{' '}
            <code style={code}>(policyId, assetName, creatorFeeBps,
            treasuryPkh, feeAccumulatorScriptHash, graduationAda)</code>.</Item>
          <Item>If vesting requested: derive a vesting script address with{' '}
            <code style={code}>(creatorPkh, unlockPosixMs)</code>.</Item>
          <Item>Build a single tx that:
            <ul style={ul}>
              <Item>Mints <code style={code}>TOTAL_SUPPLY</code> = 1_000_000_000 tokens via the one-shot policy</Item>
              <Item>Sends <code style={code}>(MIN_UTXO + initialBuyLovelace, curveTokens − initialBuyTokensOut)</code> to{' '}
                <code style={code}>curveAddress</code> with inline{' '}
                <code style={code}>CurveDatum</code></Item>
              <Item>Sends 1 ADA platform fee to treasury</Item>
              <Item>If vesting: sends initial-buy tokens to vesting address with{' '}
                <code style={code}>Data.void()</code> datum. Else: sends them to creator wallet.</Item>
              <Item>Attaches CIP-25 metadata at label 721 (chunk every string at 64 UTF-8 bytes).</Item>
            </ul>
          </Item>
          <Item>POST the resulting <code style={code}>TokenMeta</code>{' '}
            (policyId, assetName, addresses, validatorCbor, etc.) to{' '}
            <code style={code}>POST /api/tokens</code> so the launch shows up
            in the feed and graduation cron picks it up.</Item>
        </ol>
        <p style={p}>
          The full reference implementation is{' '}
          <code style={code}>launchToken</code> in{' '}
          <code style={code}>web/src/lib/cardano-tx.ts</code>.
        </p>
      </Section>

      {/* ── Graduation ──────────────────────────────────────────────── */}
      <Section id="graduation" title="Graduation to Minswap V2">
        <p style={p}>
          Once <code style={code}>ada_reserve ≥ graduation_ada</code> (default
          21,000 ADA), the protocol drains the curve into the treasury wallet
          (<code style={code}>Graduate</code> redeemer, signed by treasury)
          and creates a Minswap V2 pool from the same wallet using the
          Minswap SDK.
        </p>
        <ParamTable rows={[
          ['adaForPool',           'all of curve.adaReserve at the moment of graduation'],
          ['tokensForPool',        'computed so the opening pool price equals the curve closing price (avoids arbitrage)'],
          ['Pool tradingFee',      '0.3% (Minswap V2 default)'],
        ]} />
        <p style={p}>
          The opening price match formula is documented in{' '}
          <code style={code}>web/src/lib/graduate-math.ts</code>. Surplus
          tokens (everything not seeded into the pool) stay in treasury and
          can be swapped back manually if needed.
        </p>
        <p style={p}>
          Graduation is automatic. The cron route runs every minute on Vercel
          Pro and triggers any pending migration. Trades on the bonding curve
          are rejected by the validator once threshold is hit; until the
          pool tx confirms, the only operation that succeeds is{' '}
          <code style={code}>Graduate</code>.
        </p>
      </Section>
    </div>
  );
}

// ── Small JSX helpers ────────────────────────────────────────────────────

function Toc({ items }: { items: Array<{ id: string; label: string }> }) {
  return (
    <div
      className="rounded-xl p-4 mb-10 flex flex-col gap-1.5"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
    >
      <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-dim)' }}>
        Sections
      </p>
      {items.map(i => (
        <a
          key={i.id}
          href={`#${i.id}`}
          className="text-sm hover:[color:var(--teal)] transition-colors"
          style={{
            color: 'var(--text)',
            fontFamily: 'var(--font-outfit), system-ui, sans-serif',
            textDecoration: 'none',
          }}
        >
          → {i.label}
        </a>
      ))}
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-12 scroll-mt-20">
      <h2 className="font-bold mb-4" style={{
        fontSize: 22,
        color: 'var(--text-bright)',
        fontFamily: 'var(--font-outfit)',
      }}>
        {title}
      </h2>
      <div>{children}</div>
    </section>
  );
}

function ParamTable({ rows }: { rows: Array<string[]> }) {
  return (
    <table
      className="w-full text-xs mb-4"
      style={{ fontFamily: 'var(--font-jetbrains), monospace', borderCollapse: 'collapse' }}
    >
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <td className="py-1.5 pr-3 align-top" style={{ color: 'var(--teal)', whiteSpace: 'nowrap' }}>{k}</td>
            <td className="py-1.5"
              style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-outfit)', lineHeight: 1.55 }}>
              {v}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre
      className="rounded-lg p-3 mb-3 overflow-x-auto text-xs"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        fontFamily: 'var(--font-jetbrains), monospace',
        color: 'var(--text)',
        lineHeight: 1.6,
      }}
    >
      <code>{children}</code>
    </pre>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 items-start">
      <span aria-hidden style={{ color: 'var(--lava-bright)', marginTop: 4, fontSize: 10 }}>▸</span>
      <span>{children}</span>
    </li>
  );
}

const h1: React.CSSProperties = {
  fontFamily: 'var(--font-outfit), system-ui, sans-serif',
  fontSize: 'clamp(36px, 5vw, 56px)',
  color: 'var(--text-bright)',
  letterSpacing: '-0.02em',
};
const p: React.CSSProperties = {
  fontFamily: 'var(--font-outfit)',
  fontSize: 14,
  color: 'var(--text-dim)',
  lineHeight: 1.6,
  marginBottom: 14,
};
const pTitle: React.CSSProperties = {
  ...p,
  marginBottom: 6,
  color: 'var(--text)',
  fontWeight: 600,
};
const ul: React.CSSProperties = {
  fontFamily: 'var(--font-outfit)',
  fontSize: 14,
  color: 'var(--text-dim)',
  lineHeight: 1.7,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  marginBottom: 14,
};
const ol: React.CSSProperties = { ...ul };
const code: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  padding: '2px 6px',
  borderRadius: 4,
  fontFamily: 'var(--font-jetbrains), monospace',
  fontSize: 12,
  color: 'var(--teal)',
};
const breadcrumb: React.CSSProperties = {
  color: 'var(--text-dim)',
  textDecoration: 'none',
};
const strong: React.CSSProperties = {
  color: 'var(--text)',
  fontWeight: 600,
};
