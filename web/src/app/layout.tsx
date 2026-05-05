import type { Metadata } from 'next';
import { Outfit, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Nav } from '@/components/nav';
import { Providers } from '@/lib/providers';
import { WalletProvider } from '@/lib/wallet';

const outfit = Outfit({
  variable: '--font-outfit',
  subsets: ['latin'],
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'lumpfun — Cardano token launcher',
  description: 'Launch and trade tokens on the Cardano bonding curve. Fair launch, creator revenue share.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${jetbrainsMono.variable} dark h-full`}
    >
      <body className="min-h-full flex flex-col bg-[var(--bg-base)] text-[var(--text)]">
        <WalletProvider>
          <Providers>
            <Nav />
            <main className="flex-1">{children}</main>
          </Providers>
        </WalletProvider>
      </body>
    </html>
  );
}
