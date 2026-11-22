export type CscGasTier = 'standard' | 'fast' | 'turbo';
export type CscAsset = 'CSC' | 'USDT' | 'USD1';

export type CscTxType =
  | 'tap_mint'
  | 'referral_bonus'
  | 'inter_wallet_transfer'
  | 'wallet_transfer'
  | 'swap'
  | 'sol_bridge';

export interface CscPoolState {
  id: 'CSC_USDT' | 'CSC_USD1';
  quoteAsset: 'USDT' | 'USD1';
  cscReserve: number;
  usdReserve: number;
  spotPriceUsd: number;
  volumeUsd: number;
  feesCollectedUsd: number;
  swapCount: number;
}

export interface CscPricePoint {
  ts: number;
  blockHeight: number;
  priceUsd: number;
  volumeUsd: number;
  event: 'genesis' | 'swap_buy' | 'swap_sell' | 'emission';
}

export interface CscNetworkStats {
  chainId: number;
  networkCode: string;
  networkName: string;
  blockHeight: number;
  maxSupply: number;
  miningAllocation: number;
  minedSupply: number;
  rewardPoolRemaining: number;
  burnedSupply: number;
  circulatingSupply: number;
  halvingEra: number;
  tapBaseReward: number;
  nextHalvingAt: number;
  spotPriceUsd: number;
  genesisPriceUsd: number;
  priceChangePct: number;
  marketCapUsd: number;
  totalVolumeUsd: number;
  totalTxCount: number;
  totalTaps: number;
  usdtPool: CscPoolState;
  usd1Pool: CscPoolState;
  gasFees: Record<CscGasTier, number>;
  priceHistory: CscPricePoint[];
  updatedAt: number;
}

export interface CscWallet {
  id: string;
  ownerUid: string;
  ownerHandle: string;
  label: string;
  address: string;
  evmAddress: string;
  origin: 'genesis' | 'created' | 'imported';
  isPrimary: boolean;
  cscBalance: number;
  usdtBalance: number;
  usd1Balance: number;
  nonce: number;
  createdAt: number;
  updatedAt: number;
  lastSyncedAt: number;
}

export interface CscUserAccount {
  uid: string;
  handle: string;
  referralCode: string;
  referredByUid: string;
  referredByCode: string;
  referralCount: number;
  referralBonusCsc: number;
  referralMultiplierPct: number;
  energy: number;
  maxEnergy: number;
  energyRegenSec: number;
  nextEnergyInSec: number;
  lastEnergySyncAt: number;
  totalTaps: number;
  totalMinedCsc: number;
  totalGasPaidCsc: number;
  primaryWalletId: string;
}

export interface CscTransaction {
  id: string;
  txHash: string;
  blockHeight: number;
  type: CscTxType;
  fromAddress: string;
  toAddress: string;
  fromLabel: string;
  toLabel: string;
  assetIn: CscAsset | 'SOL';
  amountIn: number;
  assetOut: CscAsset;
  amountOut: number;
  gasFeeCsc: number;
  burnedCsc: number;
  priceUsdAtTx: number;
  note: string;
  actorUid: string;
  actorHandle: string;
  createdAt: number;
}

export interface CscReferralMember {
  uid: string;
  handle: string;
  joinedAt: number;
  totalTaps: number;
  commissionEarnedCsc: number;
}

export interface CscLeaderboardEntry {
  uid: string;
  handle: string;
  totalMinedCsc: number;
  referralCount: number;
  totalCscHeld: number;
}

export interface CscOverviewResponse {
  network: CscNetworkStats;
  account: CscUserAccount | null;
  wallets: CscWallet[];
  transactions: CscTransaction[];
  referrals: CscReferralMember[];
  leaderboard: CscLeaderboardEntry[];
  storageMode: 'normalized' | 'snapshot_ledger';
  solUsdPrice: number;
}

export interface CscLocalWalletSecret {
  address: string;
  evmAddress: string;
  label: string;
  mnemonic?: string;
  evmPrivateKey?: string;
  solanaPrivateKey?: string;
  createdAt: number;
}
