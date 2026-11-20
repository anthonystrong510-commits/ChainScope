import { getAuthHeaders } from '../firebase';
import type {
  AdminAuditLog,
  AdminRecord,
  AdminWallet,
  AdminWalletTier,
  EmergencyFund,
  MemeCoin,
  PlatformEconomics,
  UserProfile,
} from '../types/launchpad';

interface ActorInfo {
  uid: string;
  handle: string;
}

export interface AdminStateResponse {
  users: UserProfile[];
  coins: MemeCoin[];
  adminWallets: AdminWallet[];
  emergencyFunds: EmergencyFund[];
  adminRecords: AdminRecord[];
  auditLogs: AdminAuditLog[];
  economics: PlatformEconomics;
}

async function adminApi<T>(url: string, init?: RequestInit): Promise<T> {
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
    throw new Error(`Admin API error (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(
      typeof json.error === 'string' ? json.error : `Admin request failed (${res.status})`
    );
  }
  return json as T;
}

export async function fetchAdminState(): Promise<AdminStateResponse> {
  return adminApi('/api/db/admin/state');
}

export async function adminAdjustUserBalance(
  actor: ActorInfo,
  targetUid: string,
  targetHandle: string,
  newBalance: number,
  reason: string
) {
  return adminApi(`/api/db/admin/users/${encodeURIComponent(targetUid)}/balance`, {
    method: 'POST',
    body: JSON.stringify({ actor, targetHandle, newBalance, reason }),
  });
}

export async function adminUpdateUserProfile(
  actor: ActorInfo,
  targetUid: string,
  updates: { handle: string; displayName: string; linkedWallet: string }
) {
  return adminApi(`/api/db/admin/users/${encodeURIComponent(targetUid)}/profile`, {
    method: 'PATCH',
    body: JSON.stringify({ actor, ...updates }),
  });
}

export async function adminUpdateMemeCoin(
  actor: ActorInfo,
  coin: MemeCoin,
  updates: { description: string; website: string; twitter: string; graduated: boolean }
) {
  return adminApi(`/api/db/admin/coins/${encodeURIComponent(coin.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ actor, ticker: coin.ticker, ...updates }),
  });
}

export async function adminDeleteMemeCoin(actor: ActorInfo, coin: MemeCoin) {
  return adminApi(`/api/db/admin/coins/${encodeURIComponent(coin.id)}`, {
    method: 'DELETE',
    body: JSON.stringify({
      actor,
      name: coin.name,
      ticker: coin.ticker,
      creatorHandle: coin.creatorHandle,
    }),
  });
}

export async function adminDeleteCoinComment(
  actor: ActorInfo,
  coinId: string,
  commentId: string,
  authorHandle: string
) {
  return adminApi(
    `/api/db/admin/coins/${encodeURIComponent(coinId)}/comments/${encodeURIComponent(commentId)}`,
    {
      method: 'DELETE',
      body: JSON.stringify({ actor, authorHandle }),
    }
  );
}

export async function adminGrantAdminRole(
  actor: ActorInfo,
  targetUid: string,
  handle: string,
  role: 'superadmin' | 'moderator'
) {
  return adminApi('/api/db/admin/roles', {
    method: 'POST',
    body: JSON.stringify({ actor, targetUid, handle, role }),
  });
}

export async function adminRevokeAdminRole(
  actor: ActorInfo,
  targetUid: string,
  handle: string
) {
  return adminApi(`/api/db/admin/roles/${encodeURIComponent(targetUid)}`, {
    method: 'DELETE',
    body: JSON.stringify({ actor, handle }),
  });
}

// --- ADMIN HOT / COLD / EMERGENCY WALLETS ---

export async function adminCreateOrImportWallet(
  actor: ActorInfo,
  input: {
    label: string;
    tier: AdminWalletTier;
    origin: 'created' | 'imported';
    evmAddress: string;
    solanaAddress: string;
    treasurySol: number;
    assignedUid?: string;
    assignedHandle?: string;
  }
): Promise<string> {
  const res = await adminApi<{ walletId: string }>('/api/db/admin/wallets', {
    method: 'POST',
    body: JSON.stringify({ actor, ...input }),
  });
  return res.walletId;
}

export async function adminAssignWallet(
  actor: ActorInfo,
  wallet: AdminWallet,
  targetUser: UserProfile | null
) {
  return adminApi(`/api/db/admin/wallets/${encodeURIComponent(wallet.id)}/assign`, {
    method: 'POST',
    body: JSON.stringify({
      actor,
      walletLabel: wallet.label,
      walletTier: wallet.tier,
      solanaAddress: wallet.solanaAddress,
      evmAddress: wallet.evmAddress,
      targetUser: targetUser ? { uid: targetUser.uid, handle: targetUser.handle } : null,
    }),
  });
}

export async function adminUpdateWalletStatusAndTreasury(
  actor: ActorInfo,
  wallet: AdminWallet,
  updates: {
    status?: 'active' | 'frozen';
    tier?: AdminWalletTier;
    treasurySol?: number;
    label?: string;
  }
) {
  return adminApi(`/api/db/admin/wallets/${encodeURIComponent(wallet.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      actor,
      currentLabel: wallet.label,
      ...updates,
    }),
  });
}

export async function adminDeleteWallet(actor: ActorInfo, wallet: AdminWallet) {
  return adminApi(`/api/db/admin/wallets/${encodeURIComponent(wallet.id)}`, {
    method: 'DELETE',
    body: JSON.stringify({
      actor,
      label: wallet.label,
      tier: wallet.tier,
    }),
  });
}

// --- EMERGENCY FUNDS ---

export async function adminCreateEmergencyFund(
  actor: ActorInfo,
  input: {
    name: string;
    purpose: string;
    allocatedSol: number;
    sourceWalletId: string;
  }
): Promise<string> {
  const res = await adminApi<{ fundId: string }>('/api/db/admin/emergency-funds', {
    method: 'POST',
    body: JSON.stringify({ actor, ...input }),
  });
  return res.fundId;
}

export async function adminDisburseEmergencyFund(
  actor: ActorInfo,
  fund: EmergencyFund,
  target:
    | { kind: 'user'; user: UserProfile; amountSol: number; reason: string }
    | { kind: 'coin'; coin: MemeCoin; amountSol: number; reason: string }
) {
  return adminApi(`/api/db/admin/emergency-funds/${encodeURIComponent(fund.id)}/disburse`, {
    method: 'POST',
    body: JSON.stringify({
      actor,
      kind: target.kind,
      targetId: target.kind === 'user' ? target.user.uid : target.coin.id,
      amountSol: target.amountSol,
      reason: target.reason,
    }),
  });
}

// --- PLATFORM GAS & FEE ECONOMICS ---

export async function adminSavePlatformEconomics(
  actor: ActorInfo,
  econ: Omit<PlatformEconomics, 'id' | 'updatedBy' | 'updatedAt'>
) {
  return adminApi('/api/db/admin/economics', {
    method: 'PUT',
    body: JSON.stringify({ actor, ...econ }),
  });
}
