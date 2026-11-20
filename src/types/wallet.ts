export type ChainId =
  | 'ethereum'
  | 'polygon'
  | 'arbitrum'
  | 'base'
  | 'optimism'
  | 'bsc'
  | 'solana';

export type WalletOrigin =
  | 'seed'
  | 'private-key'
  | 'keystore'
  | 'browser-evm'
  | 'browser-solana'
  | 'watch';

export interface WalletEntry {
  id: string;
  label: string;
  origin: WalletOrigin;
  evmAddress?: string;
  solanaAddress?: string;
  accountIndex?: number;
  wordCount?: 12 | 24;
  createdAt: number;
  isShowcase?: boolean;
}

export interface TokenHolding {
  chainId: ChainId;
  symbol: string;
  name: string;
  balance: number;
  usdPrice: number;
  usdValue: number;
  change24h: number;
  isNative: boolean;
  contractAddress?: string;
}

export interface ChainTransaction {
  hash: string;
  chainId: ChainId;
  from: string;
  to: string;
  valueFormatted: string;
  symbol: string;
  feeFormatted: string;
  timestamp: number;
  status: 'confirmed' | 'failed' | 'pending';
  direction: 'in' | 'out' | 'self';
  method?: string;
  blockNumber?: number;
  walletId?: string;
  walletLabel?: string;
}

export interface ChainScanResult {
  chainId: ChainId;
  status: 'ok' | 'error';
  address: string;
  nativeSymbol: string;
  nativeBalance: number;
  nativeUsdPrice: number;
  nativeUsdValue: number;
  nativeChange24h: number;
  totalUsd: number;
  blockNumber: number;
  rpcSource: string;
  latencyMs: number;
  error?: string;
  tokens: TokenHolding[];
  transactions: ChainTransaction[];
}

export interface WalletScanState {
  walletId: string;
  scanning: boolean;
  lastScannedAt: number | null;
  priceSource: string;
  chains: Partial<Record<ChainId, ChainScanResult>>;
  error?: string;
}

export type ActiveTab = 'portfolio' | 'transactions' | 'launchpad' | 'import' | 'seed-studio';
