import { getAuthHeaders, getLegacyFirestoreDb } from '../firebase';
import type { ChainScanResult } from '../types/wallet';

export type SupabaseTableKey =
  | 'users'
  | 'coins'
  | 'trades'
  | 'comments'
  | 'holdings'
  | 'perp_positions'
  | 'reward_claims'
  | 'admin_wallets'
  | 'emergency_funds'
  | 'admins'
  | 'audit_logs'
  | 'economics'
  | 'wallet_snapshots'
  | 'p2p_payment_profiles'
  | 'p2p_ads'
  | 'p2p_orders'
  | 'p2p_messages';

export interface FirestoreMigrationResult {
  migrated: boolean;
  counts: {
    users: number;
    coins: number;
    trades: number;
    comments: number;
    holdings: number;
    perpPositions: number;
    rewardClaims: number;
    adminWallets: number;
    emergencyFunds: number;
    admins: number;
    auditLogs: number;
  };
}

export async function syncWalletSnapshotToSupabase(snapshot: {
  walletId: string;
  label: string;
  evmAddress?: string;
  solanaAddress?: string;
  totalUsd: number;
  chains: Record<
    string,
    Pick<ChainScanResult, 'status' | 'nativeSymbol' | 'nativeBalance' | 'totalUsd'>
  >;
  scannedAt: number;
}) {
  try {
    await fetch('/api/supabase/sync/wallet-snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
  } catch {
    // Non-blocking background snapshot
  }
}

export async function fetchSupabaseRecords(table: SupabaseTableKey): Promise<{
  table: string;
  rows: Array<Record<string, unknown>>;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/supabase/records/${encodeURIComponent(table)}`, {
    headers,
  });
  const json = (await res.json()) as {
    table?: string;
    rows?: Array<Record<string, unknown>>;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(json.error || 'Failed to query Supabase table');
  }
  return {
    table: json.table || table,
    rows: Array.isArray(json.rows) ? json.rows : [],
  };
}

export interface SupabaseTableHealth {
  key: SupabaseTableKey;
  table: string;
  ok: boolean;
  count: number;
  error?: string;
}

export interface SupabaseHealthReport {
  configured: boolean;
  connected: boolean;
  urlHost: string;
  keyMode: 'service_role' | 'anon' | 'none';
  checkedAt: number;
  readyCount: number;
  totalTables: number;
  allTablesReady: boolean;
  economicsSeeded: boolean;
  tables: SupabaseTableHealth[];
  error?: string;
}

export async function validateSupabaseConnection(): Promise<SupabaseHealthReport> {
  const res = await fetch('/api/supabase/health');
  const json = (await res.json()) as SupabaseHealthReport;
  return json;
}

export async function fetchSupabaseSchemaSql(): Promise<string> {
  const res = await fetch('/api/supabase/schema');
  const json = (await res.json()) as { sql?: string; error?: string };
  if (!res.ok) {
    throw new Error(json.error || 'Failed to load schema SQL');
  }
  return json.sql || '';
}

function serializeFirestoreValue(val: unknown): unknown {
  if (val && typeof val === 'object' && 'toMillis' in val && typeof (val as { toMillis: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  return val;
}

function serializeDoc(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = serializeFirestoreValue(v);
  }
  return out;
}

export async function migrateFirestoreToSupabase(): Promise<FirestoreMigrationResult> {
  const [legacyDb, firestoreMod, headers] = await Promise.all([
    getLegacyFirestoreDb(),
    import('firebase/firestore'),
    getAuthHeaders(),
  ]);
  const { collection, doc, getDoc, getDocs } = firestoreMod;

  const [
    usersSnap,
    coinsSnap,
    walletsSnap,
    fundsSnap,
    adminsSnap,
    auditSnap,
    econSnap,
  ] = await Promise.all([
    getDocs(collection(legacyDb, 'userProfiles')),
    getDocs(collection(legacyDb, 'memeCoins')),
    getDocs(collection(legacyDb, 'adminWallets')),
    getDocs(collection(legacyDb, 'emergencyFunds')),
    getDocs(collection(legacyDb, 'admins')),
    getDocs(collection(legacyDb, 'adminAuditLogs')),
    getDoc(doc(legacyDb, 'platformConfig', 'economics')),
  ]);

  const users = usersSnap.docs.map((d) => serializeDoc(d.data() as Record<string, unknown>));
  const coins = coinsSnap.docs.map((d) => serializeDoc(d.data() as Record<string, unknown>));

  const trades: Array<Record<string, unknown>> = [];
  const comments: Array<Record<string, unknown>> = [];
  for (const coinDoc of coinsSnap.docs) {
    const [tSnap, cSnap] = await Promise.all([
      getDocs(collection(legacyDb, 'memeCoins', coinDoc.id, 'trades')),
      getDocs(collection(legacyDb, 'memeCoins', coinDoc.id, 'comments')),
    ]);
    tSnap.docs.forEach((d) => trades.push(serializeDoc(d.data() as Record<string, unknown>)));
    cSnap.docs.forEach((d) => comments.push(serializeDoc(d.data() as Record<string, unknown>)));
  }

  const holdings: Array<Record<string, unknown>> = [];
  const perpPositions: Array<Record<string, unknown>> = [];
  const rewardClaims: Array<Record<string, unknown>> = [];
  for (const userDoc of usersSnap.docs) {
    const [hSnap, pSnap, rSnap] = await Promise.all([
      getDocs(collection(legacyDb, 'userProfiles', userDoc.id, 'holdings')),
      getDocs(collection(legacyDb, 'userProfiles', userDoc.id, 'perpPositions')),
      getDocs(collection(legacyDb, 'userProfiles', userDoc.id, 'rewardClaims')),
    ]);
    hSnap.docs.forEach((d) => holdings.push(serializeDoc(d.data() as Record<string, unknown>)));
    pSnap.docs.forEach((d) =>
      perpPositions.push(serializeDoc(d.data() as Record<string, unknown>))
    );
    rSnap.docs.forEach((d) =>
      rewardClaims.push(serializeDoc(d.data() as Record<string, unknown>))
    );
  }

  const res = await fetch('/api/db/admin/import-from-firestore', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      users,
      coins,
      trades,
      comments,
      holdings,
      perpPositions,
      rewardClaims,
      adminWallets: walletsSnap.docs.map((d) =>
        serializeDoc(d.data() as Record<string, unknown>)
      ),
      emergencyFunds: fundsSnap.docs.map((d) =>
        serializeDoc(d.data() as Record<string, unknown>)
      ),
      admins: adminsSnap.docs.map((d) => serializeDoc(d.data() as Record<string, unknown>)),
      auditLogs: auditSnap.docs.map((d) => serializeDoc(d.data() as Record<string, unknown>)),
      economics: econSnap.exists()
        ? serializeDoc(econSnap.data() as Record<string, unknown>)
        : null,
    }),
  });

  const json = (await res.json()) as FirestoreMigrationResult & { error?: string };
  if (!res.ok) {
    throw new Error(json.error || 'Failed to migrate legacy Firestore data to Supabase');
  }
  return json;
}
