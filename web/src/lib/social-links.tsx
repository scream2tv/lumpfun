'use client';

import * as React from 'react';

// ── URL normalisers ─────────────────────────────────────────────────────────
// Accept either bare handles ("@agentlump") or full URLs and emit a canonical
// https URL — or null if the input is empty after trimming.

export function normalizeWebsite(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

export function normalizeTwitter(v: string): string | null {
  const t = v.trim().replace(/^@/, '');
  if (!t) return null;
  if (/^https?:\/\//i.test(v)) return v.trim();
  if (/^(x\.com|twitter\.com)\//i.test(t)) return `https://${t}`;
  return `https://x.com/${t}`;
}

export function normalizeTelegram(v: string): string | null {
  const t = v.trim().replace(/^@/, '');
  if (!t) return null;
  if (/^https?:\/\//i.test(v)) return v.trim();
  if (/^t\.me\//i.test(t)) return `https://${t}`;
  return `https://t.me/${t}`;
}

export function normalizeDiscord(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^discord\.(gg|com)\//i.test(t)) return `https://${t}`;
  return `https://discord.gg/${t.replace(/^\//, '')}`;
}

// ── Icons ───────────────────────────────────────────────────────────────────

export function GlobeIcon({ size = 14 }: { size?: number } = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

export function XIcon({ size = 14 }: { size?: number } = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function TelegramIcon({ size = 14 }: { size?: number } = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.146.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.022c.242-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.642-.204-.66-.642.135-.95l11.566-4.458c.538-.196 1.006.128.832.953z" />
    </svg>
  );
}

export function DiscordIcon({ size = 14 }: { size?: number } = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419-.0188 1.3332-.946 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9554 2.4189-2.1568 2.4189Z" />
    </svg>
  );
}

// ── Shared component ────────────────────────────────────────────────────────
//
// Renders icon links for any non-empty social fields. When `nested` is true,
// uses <button onClick={window.open}> instead of <a> so the component can be
// safely placed inside another <Link> (e.g. on a TokenCard) without producing
// invalid <a><a></a></a> markup. Stops propagation so clicking an icon does
// NOT navigate the wrapping link.

export interface SocialLinksProps {
  website?:  string;
  twitter?:  string;
  telegram?: string;
  discord?:  string;
  size?:     number;       // icon px (default 14)
  cell?:     number;       // cell px (default 26)
  nested?:   boolean;      // true when rendered inside another <Link>
}

export function SocialLinks({
  website,
  twitter,
  telegram,
  discord,
  size = 14,
  cell = 26,
  nested = false,
}: SocialLinksProps) {
  const links = [
    { url: website  ? normalizeWebsite(website)   : null, Icon: GlobeIcon,    label: 'Website'     },
    { url: twitter  ? normalizeTwitter(twitter)   : null, Icon: XIcon,        label: 'Twitter / X' },
    { url: telegram ? normalizeTelegram(telegram) : null, Icon: TelegramIcon, label: 'Telegram'    },
    { url: discord  ? normalizeDiscord(discord)   : null, Icon: DiscordIcon,  label: 'Discord'     },
  ].filter((l): l is { url: string; Icon: (p?: { size?: number }) => React.JSX.Element; label: string } => !!l.url);
  if (links.length === 0) return null;

  const sharedStyle: React.CSSProperties = {
    width: cell,
    height: cell,
    borderRadius: 6,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-subtle)',
    color: 'var(--text-dim)',
    transition: 'all 150ms',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  return (
    <div className="flex items-center gap-1.5">
      {links.map(({ url, Icon, label }) =>
        nested ? (
          <button
            key={label}
            type="button"
            aria-label={label}
            title={label}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(url, '_blank', 'noopener,noreferrer');
            }}
            style={{ ...sharedStyle, cursor: 'pointer', padding: 0 }}
          >
            <Icon size={size} />
          </button>
        ) : (
          <a
            key={label}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            title={label}
            style={sharedStyle}
          >
            <Icon size={size} />
          </a>
        ),
      )}
    </div>
  );
}
