import { pathToFileURL } from 'url';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import {
  type CircuitContext,
  type CoinPublicKey,
  createConstructorContext,
  CostModel,
  dummyContractAddress,
  QueryContext,
} from '@midnight-ntwrk/compact-runtime';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const COMPILED_DIR = resolve(__dirname, '../../contracts/managed/lump_launch');

// Minimal subset of the compiled contract module we care about.
interface CompiledModule {
  Contract: new (witnesses: Record<string, unknown>) => CompiledContract;
  ledger: (state: unknown) => LedgerView;
}

// The parts of the generated Contract class we actually invoke.
interface CompiledContract {
  initialState: (
    ctx: ReturnType<typeof createConstructorContext>,
    name: string,
    symbol: string,
    decimals: bigint,
    image_uri: string,
    creator: Uint8Array,
    base_price: bigint,
    slope: bigint,
    max_supply: bigint,
    fee_bps: bigint,
    p_bps: bigint,
    c_bps: bigint,
    r_bps: bigint,
    platform_recip: Uint8Array,
    creator_recip: Uint8Array,
  ) => {
    currentContractState: { data: unknown };
    currentPrivateState: Record<string, unknown>;
    currentZswapLocalState: unknown;
  };
  circuits: Record<string, (...args: unknown[]) => {
    result: unknown;
    context: CircuitContext<Record<string, unknown>>;
  }>;
}

// Mirrors the compiled Ledger type — we only declare the fields we read.
export interface LedgerView {
  readonly name: string;
  readonly symbol: string;
  readonly decimals: bigint;
  readonly image_uri: string;
  readonly creator_pubkey: Uint8Array;
  readonly base_price_night: bigint;
  readonly slope_night: bigint;
  readonly max_supply: bigint;
  readonly fee_bps: bigint;
  readonly platform_share_bps: bigint;
  readonly creator_share_bps: bigint;
  readonly referral_share_bps: bigint;
  readonly platform_recipient: Uint8Array;
  readonly creator_recipient: Uint8Array;
  readonly tokens_sold: bigint;
  readonly night_reserve: bigint;
  readonly platform_accrued: bigint;
  readonly creator_accrued: bigint;
  referrals_accrued: {
    member(key: Uint8Array): boolean;
    lookup(key: Uint8Array): bigint;
  };
  balances: {
    member(key: Uint8Array): boolean;
    lookup(key: Uint8Array): bigint;
  };
}

export async function loadCompiledLumpLaunch(): Promise<CompiledModule> {
  return (await import(
    pathToFileURL(`${COMPILED_DIR}/contract/index.js`).href
  )) as CompiledModule;
}

export interface DeployOpts {
  name?: string;
  symbol?: string;
  decimals?: bigint;
  imageUri?: string;
  creator?: Uint8Array;
  basePrice?: bigint;
  slope?: bigint;
  maxSupply?: bigint;
  feeBps?: number;
  pBps?: number;
  cBps?: number;
  rBps?: number;
  platformRecipient?: Uint8Array;
  creatorRecipient?: Uint8Array;
}

export interface BuyArgs {
  buyer: Uint8Array;
  nTokens: bigint;
  curveCost: bigint;
  feeTotal: bigint;
  pCut: bigint;
  cCut: bigint;
  rCut: bigint;
  remainder: bigint;
  hasReferral: boolean;
  referral: Uint8Array;
}

export interface SimulatorHandle {
  buy(args: BuyArgs): void;
  getLedger(): LedgerView;
}

function bytes32(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

// Dummy 32-byte hex public key string (all zeroes) used as the caller on
// construction. CoinPublicKey is a 64-char hex string.
const DEFAULT_COIN_PK: CoinPublicKey = '0'.repeat(64) as CoinPublicKey;

export async function deployInSimulator(
  opts: DeployOpts = {},
): Promise<SimulatorHandle> {
  const mod = await loadCompiledLumpLaunch();
  const contract = new mod.Contract({});

  const {
    name = 'TestToken',
    symbol = 'TT',
    decimals = 9n,
    imageUri = '',
    creator = bytes32(1),
    basePrice = 1000n,
    slope = 1n,
    maxSupply = 1_000_000n,
    feeBps = 100,
    pBps = 5000,
    cBps = 4000,
    rBps = 1000,
    platformRecipient = bytes32(2),
    creatorRecipient = bytes32(3),
  } = opts;

  const constructorCtx = createConstructorContext({}, DEFAULT_COIN_PK);

  const initResult = contract.initialState(
    constructorCtx,
    name,
    symbol,
    decimals,
    imageUri,
    creator,
    basePrice,
    slope,
    maxSupply,
    BigInt(feeBps),
    BigInt(pBps),
    BigInt(cBps),
    BigInt(rBps),
    platformRecipient,
    creatorRecipient,
  );

  // Wrap the initial ledger state into a CircuitContext we can mutate across
  // circuit calls (same shape as createCircuitContext produces).
  let context: CircuitContext<Record<string, unknown>> = {
    currentPrivateState: initResult.currentPrivateState,
    currentZswapLocalState:
      initResult.currentZswapLocalState as CircuitContext<Record<string, unknown>>['currentZswapLocalState'],
    currentQueryContext: new QueryContext(
      // ContractState.data is a ChargedState instance — QueryContext accepts it.
      initResult.currentContractState.data as Parameters<
        typeof QueryContext
      >[0],
      dummyContractAddress(),
    ),
    costModel: CostModel.initialCostModel(),
  };

  return {
    buy(args: BuyArgs) {
      const {
        buyer,
        nTokens,
        curveCost,
        feeTotal,
        pCut,
        cCut,
        rCut,
        remainder,
        hasReferral,
        referral,
      } = args;
      const { context: nextCtx } = contract.circuits.buy!(
        context,
        buyer,
        nTokens,
        curveCost,
        feeTotal,
        pCut,
        cCut,
        rCut,
        remainder,
        hasReferral,
        referral,
      );
      context = nextCtx;
    },
    getLedger(): LedgerView {
      return mod.ledger(context.currentQueryContext.state);
    },
  };
}
