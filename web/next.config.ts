import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents requires every data access inside Suspense; use standard fetch revalidation instead

  // Cardano libs ship native wasm modules that Turbopack can't trace into a
  // standalone bundle. Externalise them so they're loaded from node_modules at
  // runtime instead of being embedded in the build output.
  serverExternalPackages: [
    '@lucid-evolution/lucid',
    '@spacebudz/lucid',
    '@minswap/sdk',
    '@blockfrost/blockfrost-js',
    '@anastasia-labs/cardano-multiplatform-lib-nodejs',
    '@midnight-ntwrk/ledger-v8',
    '@midnight-ntwrk/wallet-sdk-hd',
    '@midnight-ntwrk/wallet-sdk-address-format',
  ],
};

export default nextConfig;
