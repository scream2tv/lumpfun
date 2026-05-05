'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/lib/wallet';
import type { TokenMeta } from '@/lib/types';

const CREATOR_FEE_BPS = 100;
const TREASURY = process.env.NEXT_PUBLIC_TREASURY_ADDRESS ?? '';

const BUY_CHIPS = [
  { label: '2 ADA',  lovelace: 2_000_000n  },
  { label: '5 ADA',  lovelace: 5_000_000n  },
  { label: '10 ADA', lovelace: 10_000_000n },
  { label: '25 ADA', lovelace: 25_000_000n },
];

const inputBase: React.CSSProperties = {
  width: '100%',
  height: 44,
  padding: '0 14px',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-sm)',
  color: 'var(--text)',
  fontSize: 14,
  fontFamily: 'var(--font-outfit), system-ui, sans-serif',
  outline: 'none',
  transition: 'border-color 150ms, box-shadow 150ms',
};

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium" style={{ color: 'var(--text)', fontFamily: 'var(--font-outfit)' }}>
        {label}
        {hint && <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-dim)' }}>{hint}</span>}
      </label>
      {children}
      {error && <p className="text-xs" style={{ color: 'var(--lava-bright)' }}>{error}</p>}
    </div>
  );
}

function TextInput({
  hasError,
  style: styleOverride,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { hasError?: boolean }) {
  return (
    <input
      {...props}
      // Merge caller's style on top of the base so per-field overrides like
      // paddingLeft (used by the ticker `$` prefix) actually take effect.
      style={{ ...inputBase, ...styleOverride, borderColor: hasError ? 'var(--lava-bright)' : 'var(--border-subtle)' }}
      onFocus={e => {
        e.currentTarget.style.borderColor = hasError ? 'var(--lava-bright)' : 'var(--teal)';
        e.currentTarget.style.boxShadow = hasError
          ? '0 0 0 2px rgba(255,80,60,0.1)'
          : '0 0 0 2px rgba(92,224,210,0.1)';
      }}
      onBlur={e => {
        e.currentTarget.style.borderColor = hasError ? 'var(--lava-bright)' : 'var(--border-subtle)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    />
  );
}

function SocialInput({
  icon,
  placeholder,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      className="flex items-center rounded-lg overflow-hidden"
      style={{ border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}
      onFocusCapture={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--teal)';
        (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 2px rgba(92,224,210,0.1)';
      }}
      onBlurCapture={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)';
        (e.currentTarget as HTMLElement).style.boxShadow = 'none';
      }}
    >
      <div
        className="flex items-center justify-center shrink-0"
        style={{ width: 40, height: 44, color: 'var(--text-dim)', borderRight: '1px solid var(--border-subtle)' }}
      >
        {icon}
      </div>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          flex: 1,
          height: 44,
          padding: '0 12px',
          background: 'transparent',
          border: 'none',
          color: 'var(--text)',
          fontSize: 14,
          fontFamily: 'var(--font-outfit), system-ui, sans-serif',
          outline: 'none',
        }}
      />
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p style={{ color: 'var(--text-dim)' }}>{label}</p>
        <button
          type="button"
          onClick={onCopy}
          aria-label={`Copy ${label}`}
          style={{
            background: 'transparent',
            border: '1px solid var(--border-subtle)',
            color: copied ? 'var(--teal)' : 'var(--text-dim)',
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 6,
            cursor: 'pointer',
            fontFamily: 'var(--font-outfit), system-ui, sans-serif',
            transition: 'color 120ms, border-color 120ms',
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p>{value}</p>
    </div>
  );
}

function ImageDropzone({ preview, onFile }: { preview: string | null; onFile: (f: File) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = (f: File) => { if (f.type.startsWith('image/')) onFile(f); };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) accept(f);
  }, []);

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      style={{
        width: '100%',
        aspectRatio: '1',
        maxWidth: 160,
        borderRadius: 'var(--r-lg)',
        border: `2px dashed ${dragging ? 'var(--teal)' : 'var(--border-mid)'}`,
        background: dragging ? 'var(--teal-muted)' : 'var(--bg-elevated)',
        cursor: 'pointer',
        overflow: 'hidden',
        transition: 'border-color 150ms, background 150ms',
        position: 'relative',
      }}
    >
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-3" style={{ color: 'var(--text-dim)' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="3"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <span className="text-xs leading-tight">Drop image<br/>or click</span>
          <span className="text-xs" style={{ color: 'var(--text-dim)', opacity: 0.6 }}>PNG, JPG, GIF · ≤5 MB</span>
        </div>
      )}
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) accept(f); }} />
    </div>
  );
}

export default function CreatePage() {
  const { wallet, walletApi } = useWallet();
  const router = useRouter();

  const [name,        setName]        = useState('');
  const [ticker,      setTicker]      = useState('');
  const [description, setDescription] = useState('');
  const [website,     setWebsite]     = useState('');
  const [twitter,     setTwitter]     = useState('');
  const [telegram,    setTelegram]    = useState('');
  const [discord,     setDiscord]     = useState('');
  const [initialBuy,  setInitialBuy]  = useState<bigint | null>(null);
  // Tracks which preset chip is "selected" so the chip highlight is independent
  // of the actual amount — typing "5" into the custom field shouldn't light up
  // the 5 ADA chip.
  const [pickedChip,  setPickedChip]  = useState<bigint | null>(null);

  const [imageFile,    setImageFile]    = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const [nameError,   setNameError]   = useState('');
  const [tickerError, setTickerError] = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState('');
  const [launched,    setLaunched]    = useState<{ txHash: string; policyId: string; assetName: string } | null>(null);

  function handleImageFile(f: File) {
    setImageFile(f);
    setImagePreview(URL.createObjectURL(f));
  }

  function validateName(v: string) {
    if (!v.trim()) { setNameError('Token name is required'); return false; }
    setNameError(''); return true;
  }
  function validateTicker(v: string) {
    if (!v.trim()) { setTickerError('Ticker is required'); return false; }
    if (v.length > 8) { setTickerError('Max 8 characters'); return false; }
    setTickerError(''); return true;
  }

  async function uploadImage(): Promise<string | undefined> {
    if (!imageFile) return undefined;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(imageFile);
    });
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataUrl, mime: imageFile.type, filename: imageFile.name }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Image upload failed (${res.status})`);
    }
    const { url } = await res.json();
    return url;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nameOk   = validateName(name);
    const tickerOk = validateTicker(ticker);
    if (!nameOk || !tickerOk) return;
    if (!wallet || !walletApi) { setError('Connect your wallet first'); return; }
    if (!TREASURY) { setError('Treasury address not configured'); return; }

    setSubmitting(true);
    setError('');

    try {
      const imageUri = await uploadImage();
      const { launchToken } = await import('@/lib/cardano-tx');
      // Read NEXT_PUBLIC_GRADUATION_ADA at submit time so the registry record
      // matches the validator we just compiled.
      const gradEnv = Number(process.env.NEXT_PUBLIC_GRADUATION_ADA ?? '');
      const graduationAdaLovelace = Number.isFinite(gradEnv) && gradEnv > 0
        ? BigInt(Math.floor(gradEnv * 1_000_000))
        : 21_000_000_000n;

      const result = await launchToken(walletApi, {
        name,
        ticker,
        creatorFeeBps: CREATOR_FEE_BPS,
        devAllocBps: 0,
        initialBuyLovelace: initialBuy ?? 0n,
        graduationAdaLovelace,
        imageUri,
        description: description || undefined,
      }, TREASURY);

      const meta: TokenMeta = {
        policyId:       result.policyId,
        assetName:      result.assetName,
        ticker,
        name,
        curveAddress:   result.curveAddress,
        creatorAddress: wallet.address,
        creatorFeeBps:  CREATOR_FEE_BPS,
        validatorCbor:  result.validatorCbor,
        graduationAdaLovelace: graduationAdaLovelace.toString(),
        imageUri,
        description:    description || undefined,
        website:        website   || undefined,
        twitter:        twitter   || undefined,
        telegram:       telegram  || undefined,
        discord:        discord   || undefined,
        launchedAt:     new Date().toISOString(),
      };
      const regRes = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(meta),
      });
      if (!regRes.ok) {
        // Tx confirmed on-chain but registry write failed — show txHash so user can recover.
        const body = await regRes.json().catch(() => ({}));
        throw new Error(`Token launched (tx: ${result.txHash.slice(0, 16)}…) but registry save failed: ${body.error ?? regRes.status}. Contact support.`);
      }

      setLaunched({ txHash: result.txHash, policyId: result.policyId, assetName: result.assetName });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Launch failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (launched) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center text-2xl mx-auto mb-6"
          style={{ background: 'rgba(92,224,210,0.12)', border: '1px solid var(--teal)', boxShadow: '0 0 32px rgba(92,224,210,0.3)' }}
        >
          🎉
        </div>
        <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-bright)', fontFamily: 'var(--font-outfit)' }}>
          Token launched!
        </h1>
        <p className="text-sm mb-8" style={{ color: 'var(--text-dim)' }}>
          Your token is live on the Cardano bonding curve.
        </p>
        <div
          className="rounded-xl p-4 text-left text-xs mb-8 break-all flex flex-col gap-3"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-mid)', fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--teal)' }}
        >
          <CopyRow label="Tx hash"   value={launched.txHash} />
          <CopyRow label="Policy ID" value={launched.policyId} />
        </div>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => router.push(`/token/${launched.policyId}?asset=${launched.assetName}`)}
            className="inline-flex items-center justify-center rounded-xl text-sm font-semibold"
            style={{ height: 40, padding: '0 20px', background: 'var(--teal)', color: 'var(--bg-deep)', fontFamily: 'var(--font-outfit)', boxShadow: '0 0 20px rgba(92,224,210,0.35)' }}
          >
            View token →
          </button>
          <button
            onClick={() => router.push('/feed')}
            className="inline-flex items-center justify-center rounded-xl text-sm font-semibold"
            style={{ height: 40, padding: '0 20px', background: 'var(--bg-elevated)', color: 'var(--text)', border: '1px solid var(--border-mid)', fontFamily: 'var(--font-outfit)' }}
          >
            Back to feed
          </button>
        </div>
      </div>
    );
  }

  const ctaLabel = !wallet
    ? 'Connect wallet to launch'
    : submitting
      ? 'Awaiting signature…'
      : initialBuy
        ? `Launch + buy ${Number(initialBuy) / 1_000_000} ADA worth`
        : 'Launch Token';

  return (
    <div className="max-w-lg mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-bright)', fontFamily: 'var(--font-outfit)' }}>
        Launch a Token
      </h1>
      <p className="text-sm mb-8" style={{ color: 'var(--text-dim)' }}>
        Fair launch on the Cardano bonding curve.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">

        {/* Image + Name/Ticker */}
        <div className="flex gap-4 items-start">
          <ImageDropzone preview={imagePreview} onFile={handleImageFile} />
          <div className="flex-1 flex flex-col gap-4">
            <Field label="Token name" error={nameError}>
              <TextInput
                placeholder="e.g. Agent Lump"
                value={name}
                hasError={!!nameError}
                onChange={e => { setName(e.target.value); if (nameError) validateName(e.target.value); }}
                onBlur={e => validateName(e.target.value)}
                maxLength={50}
              />
            </Field>
            <Field label="Ticker" error={tickerError}>
              <div className="relative">
                <span
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold pointer-events-none select-none"
                  style={{ color: 'var(--teal)', fontFamily: 'var(--font-jetbrains), monospace' }}
                >
                  $
                </span>
                <TextInput
                  placeholder="LUMP"
                  maxLength={8}
                  value={ticker}
                  hasError={!!tickerError}
                  onChange={e => { const v = e.target.value; setTicker(v); if (tickerError) validateTicker(v); }}
                  onBlur={e => validateTicker(e.target.value)}
                  style={{ ...inputBase, paddingLeft: 44, paddingRight: 40, fontFamily: 'var(--font-jetbrains), monospace', letterSpacing: '0.05em', borderColor: tickerError ? 'var(--lava-bright)' : 'var(--border-subtle)' }}
                />
                <span
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none"
                  style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-jetbrains), monospace' }}
                >
                  {ticker.length}/8
                </span>
              </div>
            </Field>
          </div>
        </div>

        {/* Description */}
        <Field label="Description" hint="(optional)">
          <textarea
            placeholder="What is this token about?"
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            style={{
              ...inputBase,
              height: 'auto',
              padding: '10px 14px',
              resize: 'vertical',
              lineHeight: 1.5,
            }}
            onFocus={e => {
              e.currentTarget.style.borderColor = 'var(--teal)';
              e.currentTarget.style.boxShadow = '0 0 0 2px rgba(92,224,210,0.1)';
            }}
            onBlur={e => {
              e.currentTarget.style.borderColor = 'var(--border-subtle)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          />
        </Field>

        {/* Social links */}
        <Field label="Social links" hint="(optional)">
          <div className="flex flex-col gap-2">
            <SocialInput icon={<WebsiteIcon />} placeholder="https://yoursite.com" value={website} onChange={setWebsite} />
            <SocialInput
              icon={<XIcon />}
              placeholder="@yourhandle"
              value={twitter}
              onChange={v => {
                // Auto-prefix @, but never double it.
                if (!v) { setTwitter(''); return; }
                setTwitter(v.startsWith('@') ? v : `@${v.replace(/^@+/, '')}`);
              }}
            />
            <SocialInput icon={<TelegramIcon />} placeholder="t.me/yourgroup"       value={telegram} onChange={setTelegram} />
            <SocialInput icon={<DiscordIcon />}  placeholder="discord.gg/yourinvite" value={discord} onChange={setDiscord} />
          </div>
        </Field>

        {/* Optional initial buy */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium" style={{ color: 'var(--text)', fontFamily: 'var(--font-outfit)' }}>
              Buy tokens at launch
              <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-dim)' }}>(optional)</span>
            </p>
            {initialBuy && (
              <button
                type="button"
                onClick={() => { setInitialBuy(null); setPickedChip(null); }}
                className="text-xs"
                style={{ color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                clear
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {BUY_CHIPS.map(c => {
              const active = pickedChip === c.lovelace;
              return (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => {
                    if (active) { setPickedChip(null); setInitialBuy(null); }
                    else        { setPickedChip(c.lovelace); setInitialBuy(c.lovelace); }
                  }}
                  aria-pressed={active}
                  style={{
                    flex: 1,
                    minHeight: 36,
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    fontFamily: 'var(--font-outfit)',
                    cursor: 'pointer',
                    border: active ? '1px solid var(--teal)' : '1px solid var(--border-subtle)',
                    background: active ? 'rgba(92,224,210,0.1)' : 'var(--bg-elevated)',
                    color: active ? 'var(--teal)' : 'var(--text-dim)',
                    transition: 'all 150ms',
                  }}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
          <div className="relative">
            <TextInput
              placeholder="Custom amount"
              inputMode="decimal"
              // Always reflect the active amount so a chip click populates this
              // field. Typing here clears the chip highlight (handled below).
              value={initialBuy ? (Number(initialBuy) / 1_000_000).toString() : ''}
              onChange={e => {
                const raw = e.target.value.replace(/[^\d.]/g, '');
                setPickedChip(null);
                if (raw === '') { setInitialBuy(null); return; }
                const n = parseFloat(raw);
                if (!Number.isFinite(n) || n <= 0) { setInitialBuy(null); return; }
                setInitialBuy(BigInt(Math.floor(n * 1_000_000)));
              }}
              style={{ ...inputBase, paddingRight: 44 }}
            />
            <span
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none"
              style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-jetbrains), monospace' }}
            >
              ADA
            </span>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
            Secure your position before others can trade. This ADA goes into the curve immediately.
          </p>
        </div>

        {/* Fee info */}
        <div
          className="rounded-xl p-3 text-xs flex items-start gap-2"
          style={{ background: 'var(--teal-muted)', border: '1px solid rgba(92,224,210,0.12)', color: 'var(--text-dim)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" className="shrink-0 mt-px">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>
            <span style={{ color: 'var(--text)' }}>1 ADA platform fee</span> per trade ·{' '}
            <span style={{ color: 'var(--teal)' }}>1% creator revenue</span> on every buy and sell goes to your wallet
          </span>
        </div>

        {error && (
          <div
            className="rounded-lg px-3 py-2 text-sm flex items-center gap-2"
            style={{ background: 'rgba(255,80,60,0.08)', border: '1px solid rgba(255,80,60,0.25)', color: 'var(--lava-bright)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !wallet}
          style={{
            height: 48,
            borderRadius: 12,
            background: !wallet || submitting ? 'var(--bg-elevated)' : 'var(--teal)',
            color: !wallet || submitting ? 'var(--text-dim)' : 'var(--bg-deep)',
            border: !wallet || submitting ? '1px solid var(--border-subtle)' : 'none',
            boxShadow: !wallet || submitting ? 'none' : '0 0 24px rgba(92,224,210,0.4)',
            cursor: submitting || !wallet ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font-outfit)',
            fontWeight: 600,
            fontSize: 15,
            transition: 'all 200ms var(--ease-in-out)',
            width: '100%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {submitting && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              style={{ animation: 'spin 1s linear infinite' }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
          )}
          {ctaLabel}
        </button>
      </form>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function WebsiteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419-.0188 1.3332-.946 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9554 2.4189-2.1568 2.4189Z"/>
    </svg>
  );
}
