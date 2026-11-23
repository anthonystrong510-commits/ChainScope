export type P2PAsset = 'USDT' | 'USD1' | 'CSC' | 'SOL' | 'ETH' | 'BNB';

export type P2PAdSide = 'sell' | 'buy';

export type P2PAdVisibility = 'public' | 'private';

export type P2PPriceType = 'fixed' | 'floating';

export type P2PEscrowMode = 'vault_balance' | 'onchain_proof';

export type P2POrderStatus =
  | 'awaiting_escrow'
  | 'escrow_locked'
  | 'fiat_paid'
  | 'released'
  | 'disputed'
  | 'cancelled'
  | 'resolved_buyer'
  | 'resolved_seller';

export type P2PPrivateRequestStatus = 'pending' | 'approved' | 'declined' | 'converted';

export type P2PRegion =
  | 'Africa'
  | 'North America'
  | 'Europe'
  | 'Middle East'
  | 'Asia-Pacific'
  | 'Latin America'
  | 'Global';

export interface P2PPaymentMethodDef {
  id: string;
  name: string;
  category: 'mobile_money' | 'bank_transfer' | 'instant_app' | 'card_wallet' | 'cash_remittance';
  fieldsHint: string;
}

export interface P2PCountryConfig {
  code: string;
  name: string;
  currency: string;
  currencySymbol: string;
  region: P2PRegion;
  ratePerUsd: number;
  methods: P2PPaymentMethodDef[];
}

export interface P2PSavedPaymentMethod {
  id: string;
  ownerUid: string;
  countryCode: string;
  currency: string;
  methodId: string;
  methodName: string;
  accountHolder: string;
  accountDetails: string;
  instructions: string;
  createdAt: number;
  updatedAt: number;
}

export interface P2PMakerStats {
  completedOrders: number;
  completionRatePct: number;
  avgReleaseMins: number;
  verifiedWallet: boolean;
}

export interface P2PAd {
  id: string;
  makerUid: string;
  makerUsername: string;
  makerDisplayName: string;
  makerWalletAddress: string;
  makerEvmAddress: string;
  makerSolanaAddress: string;
  makerCscAddress: string;
  side: P2PAdSide;
  visibility: P2PAdVisibility;
  privateCode?: string;
  allowedUsernames?: string[];
  asset: P2PAsset;
  countryCode: string;
  fiatCurrency: string;
  priceType: P2PPriceType;
  fixedPriceFiat: number;
  floatingMarginPct: number;
  effectivePriceFiat: number;
  spotPriceUsd: number;
  availableCryptoAmount: number;
  preFundedEscrow: boolean;
  escrowLockedBalance: number;
  escrowDepositMode?: P2PEscrowMode;
  escrowDepositTxHash?: string;
  minFiatOrder: number;
  maxFiatOrder: number;
  paymentMethodIds: string[];
  paymentMethodNames: string[];
  paymentWindowMins: number;
  escrowMode: P2PEscrowMode;
  terms: string;
  status: 'active' | 'paused' | 'closed';
  makerStats: P2PMakerStats;
  createdAt: number;
  updatedAt: number;
}

export interface P2PPrivateRequest {
  id: string;
  adId: string;
  adPrivateCode: string;
  adSide: P2PAdSide;
  makerUid: string;
  makerUsername: string;
  requesterUid: string;
  requesterUsername: string;
  requesterWalletAddress: string;
  requesterCompletedTrades: number;
  asset: P2PAsset;
  countryCode: string;
  fiatCurrency: string;
  unitPriceFiat: number;
  requestedFiatAmount: number;
  requestedCryptoAmount: number;
  paymentMethodId: string;
  paymentMethodName: string;
  note: string;
  status: P2PPrivateRequestStatus;
  orderId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface P2PEscrowReceivingWallet {
  id: string;
  label: string;
  chain: 'evm' | 'solana' | 'csc';
  walletType: 'cold_public' | 'hot_escrow';
  publicAddress: string;
  active: boolean;
  createdAt: number;
}

export interface P2PAdminSettings {
  minCompletedTradesToBuy: number;
  whitelistedBuyerUsernames: string[];
  autoMarkPaidOnProof: boolean;
  autoReleaseEnabled: boolean;
  autoReleaseAfterMins: number;
  escrowReceivingWallets: P2PEscrowReceivingWallet[];
  updatedAt: number;
  updatedByHandle: string;
}

export interface P2POrder {
  id: string;
  adId: string;
  isPrivateOrder?: boolean;
  asset: P2PAsset;
  countryCode: string;
  fiatCurrency: string;
  unitPriceFiat: number;
  cryptoAmount: number;
  fiatAmount: number;
  feeCrypto: number;
  netBuyerCrypto: number;
  buyerUid: string;
  buyerUsername: string;
  buyerWalletAddress: string;
  sellerUid: string;
  sellerUsername: string;
  sellerWalletAddress: string;
  paymentMethodId: string;
  paymentMethodName: string;
  paymentSnapshot: {
    accountHolder: string;
    accountDetails: string;
    instructions: string;
  };
  escrowMode: P2PEscrowMode;
  escrowAssetLocked: boolean;
  escrowLockedAmount: number;
  escrowTxHash: string;
  escrowSignature: string;
  escrowVaultAddress: string;
  fiatProofRef: string;
  fiatProofImage: string;
  fiatProofNote: string;
  status: P2POrderStatus;
  disputeReason: string;
  disputedByUid: string;
  adminResolutionNote: string;
  resolvedByUid: string;
  resolvedByHandle: string;
  paymentDeadlineAt: number;
  createdAt: number;
  updatedAt: number;
  escrowLockedAt?: number;
  fiatPaidAt?: number;
  completedAt?: number;
}

export interface P2PChatMessage {
  id: string;
  orderId: string;
  senderUid: string;
  senderUsername: string;
  senderRole: 'buyer' | 'seller' | 'admin' | 'system';
  kind: 'text' | 'payment_proof' | 'escrow_proof' | 'system';
  text: string;
  attachmentImage?: string;
  txHash?: string;
  createdAt: number;
}

export interface P2PTradeEligibility {
  completedTrades: number;
  minCompletedTradesToBuy: number;
  canBuy: boolean;
  whitelisted: boolean;
  verifiedWallet: boolean;
  boundWalletAddress: string;
}

export interface P2POverviewResponse {
  ads: P2PAd[];
  myPrivateAds: P2PAd[];
  myPrivateRequests: P2PPrivateRequest[];
  myOrders: P2POrder[];
  myPaymentProfiles: P2PSavedPaymentMethod[];
  spotPricesUsd: Record<P2PAsset, number>;
  escrowVaults: {
    evm: string;
    solana: string;
    csc: string;
  };
  escrowReceivingWallets: P2PEscrowReceivingWallet[];
  buyGate: {
    minCompletedTradesToBuy: number;
    autoMarkPaidOnProof: boolean;
    autoReleaseEnabled: boolean;
    autoReleaseAfterMins: number;
  };
  myTradeEligibility: P2PTradeEligibility | null;
  countryLiquidity: Record<string, { adsCount: number; assets: P2PAsset[] }>;
  stats: {
    activeAds: number;
    privateAdsCount: number;
    openOrders: number;
    completedTrades: number;
    countriesSupported: number;
    paymentMethodsCount: number;
  };
}
