import { getAuthHeaders } from '../firebase';
import type {
  CoinComment,
  CoinMode,
  CoinTrade,
  EmblemIconName,
  GasTier,
  LaunchChain,
  MemeCoin,
  PlatformEconomics,
  UserProfile,
} from '../types/launchpad';
import { DEFAULT_PLATFORM_ECONOMICS } from '../utils/bondingCurve';

export interface LaunchCoinInput {
  name: string;
  ticker: string;
  description: string;
  chain: LaunchChain;
  mode: CoinMode;
  emblemIcon: EmblemIconName;
  emblemColor: string;
  website: string;
  twitter: string;
  initialBuySol: number;
  gasTier?: GasTier;
}

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(url, {
    ...init,
    headers: { ...headers, ...(init?.headers || {}) },
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`Server error (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(
      typeof json.error === 'string' ? json.error : `Request failed (${res.status})`
    );
  }
  return json as T;
}

export async function fetchLaunchpadOverview(): Promise<{
  coins: MemeCoin[];
  traders: UserProfile[];
  economics: PlatformEconomics;
}> {
  return apiRequest('/api/db/launchpad/overview');
}

export async function fetchCoinDetail(coinId: string): Promise<{
  trades: CoinTrade[];
  comments: CoinComment[];
}> {
  return apiRequest(`/api/db/launchpad/coins/${encodeURIComponent(coinId)}/detail`);
}

export async function launchMemeCoin(
  _profile: UserProfile,
  input: LaunchCoinInput,
  _economics: PlatformEconomics = DEFAULT_PLATFORM_ECONOMICS
): Promise<string> {
  const res = await apiRequest<{ coinId: string }>('/api/db/launchpad/coins', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.coinId;
}

export async function executeBondingCurveSwap(params: {
  coinId: string;
  userUid: string;
  side: 'buy' | 'sell';
  amount: number;
  gasTier?: GasTier;
  economics?: PlatformEconomics;
}) {
  return apiRequest<{ ok: boolean; tradeId: string }>(
    `/api/db/launchpad/coins/${encodeURIComponent(params.coinId)}/swap`,
    {
      method: 'POST',
      body: JSON.stringify({
        side: params.side,
        amount: params.amount,
        gasTier: params.gasTier || 'standard',
      }),
    }
  );
}

export async function claimHolderRewards(_userUid: string, coinId: string): Promise<number> {
  const res = await apiRequest<{ claimedAmount: number }>(
    `/api/db/launchpad/coins/${encodeURIComponent(coinId)}/claim-rewards`,
    {
      method: 'POST',
    }
  );
  return res.claimedAmount;
}

export async function openPerpPosition(params: {
  userUid: string;
  coinId: string;
  side: 'long' | 'short';
  collateralSol: number;
  leverage: number;
  gasTier?: GasTier;
  economics?: PlatformEconomics;
}): Promise<string> {
  const res = await apiRequest<{ posId: string }>('/api/db/launchpad/perps', {
    method: 'POST',
    body: JSON.stringify({
      coinId: params.coinId,
      side: params.side,
      collateralSol: params.collateralSol,
      leverage: params.leverage,
      gasTier: params.gasTier || 'standard',
    }),
  });
  return res.posId;
}

export async function closePerpPosition(params: {
  userUid: string;
  posId: string;
  coinId: string;
}): Promise<{ pnlSol: number; payoutSol: number; liquidated: boolean }> {
  return apiRequest(`/api/db/launchpad/perps/${encodeURIComponent(params.posId)}/close`, {
    method: 'POST',
  });
}

export async function buyCoinPack(params: {
  userUid: string;
  allocations: Array<{ coinId: string; solAmount: number }>;
  gasTier?: GasTier;
  economics?: PlatformEconomics;
}) {
  const cleanAllocations = params.allocations.filter(
    (a) => Number.isFinite(a.solAmount) && a.solAmount > 0
  );
  if (cleanAllocations.length === 0) {
    throw new Error('Select at least one coin with a positive SOL allocation.');
  }
  for (const item of cleanAllocations) {
    await executeBondingCurveSwap({
      coinId: item.coinId,
      userUid: params.userUid,
      side: 'buy',
      amount: item.solAmount,
      gasTier: params.gasTier,
      economics: params.economics,
    });
  }
}

export async function postCoinComment(params: {
  coinId: string;
  profile: UserProfile;
  text: string;
}) {
  return apiRequest<{ commentId: string }>(
    `/api/db/launchpad/coins/${encodeURIComponent(params.coinId)}/comments`,
    {
      method: 'POST',
      body: JSON.stringify({ text: params.text }),
    }
  );
}

export async function deleteCoinComment(coinId: string, commentId: string) {
  return apiRequest<{ ok: boolean }>(
    `/api/db/launchpad/coins/${encodeURIComponent(coinId)}/comments/${encodeURIComponent(commentId)}`,
    {
      method: 'DELETE',
    }
  );
}

export async function depositFromConnectedWallet(params: {
  walletId: string;
  walletLabel: string;
  walletOrigin: string;
  sourceAddress: string;
  chain: string;
  nativeAmount: number;
  signature?: string;
}): Promise<{
  profile: UserProfile;
  solCredited: number;
  nativeAmount: number;
  symbol: string;
  chain: string;
  verifiedBalance: number;
}> {
  return apiRequest('/api/db/account/deposit', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function transferPlatformSol(params: {
  recipientHandle: string;
  amountSol: number;
  memo?: string;
}): Promise<{
  profile: UserProfile;
  recipientHandle: string;
  amountSol: number;
}> {
  return apiRequest('/api/db/account/transfer', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export interface LaunchpadActivityItem extends CoinTrade {
  coinName: string;
  coinTicker: string;
  emblemIcon: EmblemIconName;
  emblemColor: string;
}

export async function fetchLaunchpadActivity(): Promise<{
  activity: LaunchpadActivityItem[];
}> {
  return apiRequest('/api/db/launchpad/activity');
}
