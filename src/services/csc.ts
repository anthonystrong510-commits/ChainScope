import { getAuthHeaders, hasActiveAuthSession } from '../firebase';
import type { CscAsset, CscGasTier, CscOverviewResponse } from '../types/csc';

async function cscFetch<T>(
  url: string,
  options: RequestInit = {},
  requireAuth = true
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (hasActiveAuthSession() || requireAuth) {
    const authHeaders = await getAuthHeaders();
    Object.assign(headers, authHeaders);
  }

  const res = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`Unexpected response (${res.status})`);
  }

  if (!res.ok) {
    throw new Error(
      typeof parsed.error === 'string' ? parsed.error : `Request failed (${res.status})`
    );
  }

  return parsed as T;
}

export async function fetchCscOverview(): Promise<CscOverviewResponse> {
  return cscFetch<CscOverviewResponse>('/api/db/csc/overview', { method: 'GET' }, false);
}

export async function syncCscWallets(): Promise<CscOverviewResponse> {
  return cscFetch<CscOverviewResponse>('/api/db/csc/sync', { method: 'POST' });
}

export async function registerCscWallet(params: {
  address: string;
  evmAddress: string;
  label: string;
  origin: 'created' | 'imported';
  setPrimary?: boolean;
}): Promise<CscOverviewResponse> {
  return cscFetch<CscOverviewResponse>('/api/db/csc/wallets', {
    method: 'POST',
    body: JSON.stringify({ action: 'create', ...params }),
  });
}

export async function setPrimaryCscWallet(walletId: string): Promise<CscOverviewResponse> {
  return cscFetch<CscOverviewResponse>('/api/db/csc/wallets', {
    method: 'POST',
    body: JSON.stringify({ action: 'set_primary', walletId }),
  });
}

export async function renameCscWallet(
  walletId: string,
  label: string
): Promise<CscOverviewResponse> {
  return cscFetch<CscOverviewResponse>('/api/db/csc/wallets', {
    method: 'POST',
    body: JSON.stringify({ action: 'rename', walletId, label }),
  });
}

export async function submitCscTaps(
  taps: number,
  walletId?: string
): Promise<CscOverviewResponse & { mintedCsc?: number; executedTaps?: number }> {
  return cscFetch<CscOverviewResponse & { mintedCsc?: number; executedTaps?: number }>(
    '/api/db/csc/tap',
    {
      method: 'POST',
      body: JSON.stringify({ taps, walletId }),
    }
  );
}

export async function claimCscReferralCode(code: string): Promise<CscOverviewResponse> {
  return cscFetch<CscOverviewResponse>('/api/db/csc/referral/claim', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export async function transferCscAssets(params: {
  fromWalletId: string;
  toWalletId?: string;
  toAddressOrHandle?: string;
  asset: CscAsset;
  amount: number;
  gasTier: CscGasTier;
  note?: string;
}): Promise<CscOverviewResponse> {
  return cscFetch<CscOverviewResponse>('/api/db/csc/transfer', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function swapCscAssets(params: {
  walletId: string;
  assetIn: CscAsset;
  assetOut: CscAsset;
  amountIn: number;
  gasTier: CscGasTier;
  minAmountOut?: number;
}): Promise<CscOverviewResponse> {
  return cscFetch<CscOverviewResponse>('/api/db/csc/swap', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function bridgeSolToCscNetwork(params: {
  walletId: string;
  solAmount: number;
  targetAsset: CscAsset;
}): Promise<CscOverviewResponse> {
  return cscFetch<CscOverviewResponse>('/api/db/csc/bridge-sol', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}
