export type LaunchChain = 'solana' | 'base' | 'ethereum' | 'polygon';

export type CoinMode = 'standard' | 'mayhem';

export type GasTier = 'standard' | 'fast' | 'turbo';

export type EmblemIconName =
  | 'rocket'
  | 'flame'
  | 'zap'
  | 'crown'
  | 'gem'
  | 'ghost'
  | 'cat'
  | 'dog';

export interface UserProfile {
  uid: string;
  handle: string;
  displayName: string;
  linkedWallet: string;
  solBalance: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface UserHolding {
  coinId: string;
  ownerUid: string;
  ticker: string;
  name: string;
  emblemIcon: EmblemIconName;
  emblemColor: string;
  tokenBalance: number;
  avgBuyPriceSol: number;
  updatedAt: unknown;
}

export interface MemeCoin {
  id: string;
  name: string;
  ticker: string;
  description: string;
  chain: LaunchChain;
  emblemIcon: EmblemIconName;
  emblemColor: string;
  website: string;
  twitter: string;
  creatorUid: string;
  creatorHandle: string;
  virtualSol: number;
  virtualTokens: number;
  realSol: number;
  totalSupply: number;
  priceSol: number;
  marketCapSol: number;
  volumeSol: number;
  tradeCount: number;
  graduated: boolean;
  mode?: CoinMode;
  holderRewardPoolSol?: number;
  creatorFeesSol?: number;
  gasCollectedSol?: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface CoinTrade {
  id: string;
  coinId: string;
  traderUid: string;
  traderHandle: string;
  side: 'buy' | 'sell';
  solAmount: number;
  tokenAmount: number;
  priceSol: number;
  gasSol?: number;
  createdAt: unknown;
}

export interface CoinComment {
  id: string;
  coinId: string;
  authorUid: string;
  authorHandle: string;
  text: string;
  createdAt: unknown;
}

export interface PerpPosition {
  id: string;
  ownerUid: string;
  coinId: string;
  ticker: string;
  side: 'long' | 'short';
  collateralSol: number;
  leverage: number;
  entryPriceSol: number;
  liquidationPriceSol: number;
  status: 'open' | 'closed' | 'liquidated';
  realizedPnlSol: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface RewardClaim {
  id: string;
  ownerUid: string;
  coinId: string;
  ticker: string;
  claimedSol: number;
  createdAt: unknown;
}

export interface AdminRecord {
  uid: string;
  handle: string;
  role: 'superadmin' | 'moderator';
  grantedBy: string;
  createdAt: unknown;
}

export interface AdminAuditLog {
  id: string;
  actorUid: string;
  actorHandle: string;
  action: string;
  targetId: string;
  details: string;
  createdAt: unknown;
}

export type AdminWalletTier = 'hot' | 'cold' | 'emergency';

export interface AdminWallet {
  id: string;
  label: string;
  tier: AdminWalletTier;
  origin: 'created' | 'imported';
  evmAddress: string;
  solanaAddress: string;
  assignedUid: string;
  assignedHandle: string;
  treasurySol: number;
  status: 'active' | 'frozen';
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface EmergencyFund {
  id: string;
  name: string;
  purpose: string;
  allocatedSol: number;
  disbursedSol: number;
  sourceWalletId: string;
  status: 'standby' | 'active' | 'depleted';
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface PlatformEconomics {
  id: string;
  creationFeeSol: number;
  baseGasSol: number;
  priorityGasSol: number;
  protocolFeeBps: number;
  holderRewardBps: number;
  creatorFeeBps: number;
  congestionMultiplier: number;
  updatedBy?: string;
  updatedAt?: unknown;
}
