import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Express, NextFunction, Request, Response } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  CoinMode,
  GasTier,
  PlatformEconomics,
} from '../src/types/launchpad';
import {
  computeGasFee,
  computeLiquidationPrice,
  computeUnrealizedPnl,
  CURVE_TOKEN_ALLOCATION,
  DEFAULT_PLATFORM_ECONOMICS,
  getInitialCurveState,
  quoteBuy,
  quoteSell,
  TOTAL_SUPPLY,
} from '../src/utils/bondingCurve';

export const BOOTSTRAPPED_ADMIN_EMAIL = 'anthonystrong510@gmail.com';

interface AuthUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

interface AuthedRequest extends Request {
  authUser?: AuthUser;
}

function loadFirebaseProjectId(rootDir: string): string {
  try {
    const cfgPath = path.resolve(rootDir, 'firebase-applet-config.json');
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const parsed = JSON.parse(raw) as { projectId?: string };
    return parsed.projectId || '';
  } catch {
    return '';
  }
}

let certCache: { certs: Record<string, string>; expiresAt: number } = {
  certs: {},
  expiresAt: 0,
};

async function getFirebasePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (now < certCache.expiresAt && Object.keys(certCache.certs).length > 0) {
    return certCache.certs;
  }

  const res = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  if (!res.ok) {
    throw new Error('Unable to fetch Google public certificates for token verification.');
  }
  const certs = (await res.json()) as Record<string, string>;
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeMs = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : 3600_000;
  certCache = { certs, expiresAt: now + maxAgeMs };
  return certs;
}

function decodeBase64Url(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  const padded = pad === 0 ? normalized : normalized + '='.repeat(4 - pad);
  return Buffer.from(padded, 'base64');
}

async function verifyFirebaseIdToken(token: string, projectId: string): Promise<AuthUser> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed authorization token.');
  }
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(decodeBase64Url(headerB64).toString('utf8')) as {
    alg?: string;
    kid?: string;
  };
  const payload = JSON.parse(decodeBase64Url(payloadB64).toString('utf8')) as {
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Unsupported token algorithm.');
  }
  if (!projectId || payload.aud !== projectId) {
    throw new Error('Token audience mismatch.');
  }
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error('Token issuer mismatch.');
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('Session expired. Please sign in again.');
  }
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Token missing subject UID.');
  }

  const certs = await getFirebasePublicCerts();
  let pem = certs[header.kid];
  if (!pem) {
    // Force refresh once in case of key rotation
    certCache.expiresAt = 0;
    const fresh = await getFirebasePublicCerts();
    pem = fresh[header.kid];
  }
  if (!pem) {
    throw new Error('Signing certificate not found.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const valid = verifier.verify(pem, decodeBase64Url(sigB64));
  if (!valid) {
    throw new Error('Invalid token signature.');
  }

  return {
    uid: payload.sub,
    email: payload.email || '',
    emailVerified: Boolean(payload.email_verified),
    name: payload.name || '',
  };
}

export function getSupabaseAdminClient(): SupabaseClient | null {
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ''
  ).trim();
  if (!url || !key || !url.startsWith('http') || url.includes('YOUR_PROJECT_REF')) {
    return null;
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function formatSupabaseError(err: { message?: string; code?: string } | null): string {
  if (!err) return 'Database error';
  const msg = err.message || 'Database error';
  if (
    err.code === '42P01' ||
    msg.includes('does not exist') ||
    msg.includes('schema cache')
  ) {
    return 'Supabase schema tables are missing or outdated. Run supabase/schema.sql in your Supabase Dashboard SQL Editor.';
  }
  return msg;
}

function toMs(val: unknown): number {
  if (!val) return Date.now();
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }
  if (typeof val === 'object' && val !== null) {
    const obj = val as { seconds?: number; _seconds?: number };
    const secs = typeof obj.seconds === 'number' ? obj.seconds : obj._seconds;
    if (typeof secs === 'number' && Number.isFinite(secs)) return secs * 1000;
  }
  return Date.now();
}

function toIso(val: unknown): string {
  return new Date(toMs(val)).toISOString();
}

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

function buildDefaultHandle(authUser: AuthUser): string {
  const raw =
    authUser.name ||
    authUser.email?.split('@')[0] ||
    `trader_${authUser.uid.slice(0, 6)}`;
  const cleaned = raw
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (cleaned.length >= 2) return cleaned.slice(0, 24);
  return `trader_${authUser.uid.slice(0, 6)}`;
}

// --- ROW MAPPERS (Postgres snake_case -> Frontend camelCase) ---
function rowToUser(r: Record<string, unknown>) {
  return {
    uid: String(r.uid || ''),
    handle: String(r.handle || ''),
    displayName: String(r.display_name || ''),
    linkedWallet: String(r.linked_wallet || ''),
    solBalance: Number(r.sol_balance ?? 0),
    createdAt: toMs(r.created_at),
    updatedAt: toMs(r.updated_at),
  };
}

function rowToCoin(r: Record<string, unknown>) {
  return {
    id: String(r.id || ''),
    name: String(r.name || ''),
    ticker: String(r.ticker || ''),
    description: String(r.description || ''),
    chain: String(r.chain || 'solana'),
    emblemIcon: String(r.emblem_icon || 'rocket'),
    emblemColor: String(r.emblem_color || '#3B82F6'),
    website: String(r.website || ''),
    twitter: String(r.twitter || ''),
    creatorUid: String(r.creator_uid || ''),
    creatorHandle: String(r.creator_handle || ''),
    virtualSol: Number(r.virtual_sol ?? 30),
    virtualTokens: Number(r.virtual_tokens ?? 1_073_000_000),
    realSol: Number(r.real_sol ?? 0),
    totalSupply: Number(r.total_supply ?? TOTAL_SUPPLY),
    priceSol: Number(r.price_sol ?? 0),
    marketCapSol: Number(r.market_cap_sol ?? 0),
    volumeSol: Number(r.volume_sol ?? 0),
    tradeCount: Number(r.trade_count ?? 0),
    graduated: Boolean(r.graduated),
    mode: (r.mode === 'mayhem' ? 'mayhem' : 'standard') as CoinMode,
    holderRewardPoolSol: Number(r.holder_reward_pool_sol ?? 0),
    creatorFeesSol: Number(r.creator_fees_sol ?? 0),
    gasCollectedSol: Number(r.gas_collected_sol ?? 0),
    createdAt: toMs(r.created_at ?? r.updated_at),
    updatedAt: toMs(r.updated_at),
  };
}

function rowToTrade(r: Record<string, unknown>) {
  return {
    id: String(r.id || ''),
    coinId: String(r.coin_id || ''),
    traderUid: String(r.trader_uid || ''),
    traderHandle: String(r.trader_handle || ''),
    side: r.side === 'sell' ? ('sell' as const) : ('buy' as const),
    solAmount: Number(r.sol_amount ?? 0),
    tokenAmount: Number(r.token_amount ?? 0),
    priceSol: Number(r.price_sol ?? 0),
    gasSol: Number(r.gas_sol ?? 0),
    createdAt: toMs(r.created_at),
  };
}

function rowToComment(r: Record<string, unknown>) {
  return {
    id: String(r.id || ''),
    coinId: String(r.coin_id || ''),
    authorUid: String(r.author_uid || ''),
    authorHandle: String(r.author_handle || ''),
    text: String(r.text || ''),
    createdAt: toMs(r.created_at),
  };
}

function rowToHolding(r: Record<string, unknown>) {
  return {
    coinId: String(r.coin_id || ''),
    ownerUid: String(r.owner_uid || ''),
    ticker: String(r.ticker || ''),
    name: String(r.name || ''),
    emblemIcon: String(r.emblem_icon || 'rocket'),
    emblemColor: String(r.emblem_color || '#3B82F6'),
    tokenBalance: Number(r.token_balance ?? 0),
    avgBuyPriceSol: Number(r.avg_buy_price_sol ?? 0),
    updatedAt: toMs(r.updated_at),
  };
}

function rowToPerp(r: Record<string, unknown>) {
  return {
    id: String(r.id || ''),
    ownerUid: String(r.owner_uid || ''),
    coinId: String(r.coin_id || ''),
    ticker: String(r.ticker || ''),
    side: r.side === 'short' ? ('short' as const) : ('long' as const),
    collateralSol: Number(r.collateral_sol ?? 0),
    leverage: Number(r.leverage ?? 1),
    entryPriceSol: Number(r.entry_price_sol ?? 0),
    liquidationPriceSol: Number(r.liquidation_price_sol ?? 0),
    status: String(r.status || 'open'),
    realizedPnlSol: Number(r.realized_pnl_sol ?? 0),
    createdAt: toMs(r.created_at),
    updatedAt: toMs(r.updated_at),
  };
}

function rowToClaim(r: Record<string, unknown>) {
  return {
    id: String(r.id || ''),
    ownerUid: String(r.owner_uid || ''),
    coinId: String(r.coin_id || ''),
    ticker: String(r.ticker || ''),
    claimedSol: Number(r.claimed_sol ?? 0),
    createdAt: toMs(r.created_at),
  };
}

function rowToAdminRecord(r: Record<string, unknown>) {
  return {
    uid: String(r.uid || ''),
    handle: String(r.handle || ''),
    role: r.role === 'superadmin' ? ('superadmin' as const) : ('moderator' as const),
    grantedBy: String(r.granted_by || ''),
    createdAt: toMs(r.created_at),
  };
}

function rowToAuditLog(r: Record<string, unknown>) {
  return {
    id: String(r.id || ''),
    actorUid: String(r.actor_uid || ''),
    actorHandle: String(r.actor_handle || ''),
    action: String(r.action || ''),
    targetId: String(r.target_id || ''),
    details: String(r.details || ''),
    createdAt: toMs(r.created_at),
  };
}

function rowToAdminWallet(r: Record<string, unknown>) {
  return {
    id: String(r.id || ''),
    label: String(r.label || ''),
    tier: String(r.tier || 'hot'),
    origin: r.origin === 'imported' ? ('imported' as const) : ('created' as const),
    evmAddress: String(r.evm_address || ''),
    solanaAddress: String(r.solana_address || ''),
    assignedUid: String(r.assigned_uid || ''),
    assignedHandle: String(r.assigned_handle || ''),
    treasurySol: Number(r.treasury_sol ?? 0),
    status: r.status === 'frozen' ? ('frozen' as const) : ('active' as const),
    createdBy: String(r.created_by || ''),
    createdAt: toMs(r.created_at ?? r.updated_at),
    updatedAt: toMs(r.updated_at),
  };
}

function rowToEmergencyFund(r: Record<string, unknown>) {
  return {
    id: String(r.id || ''),
    name: String(r.name || ''),
    purpose: String(r.purpose || ''),
    allocatedSol: Number(r.allocated_sol ?? 0),
    disbursedSol: Number(r.disbursed_sol ?? 0),
    sourceWalletId: String(r.source_wallet_id || ''),
    status: String(r.status || 'standby'),
    createdBy: String(r.created_by || ''),
    createdAt: toMs(r.created_at ?? r.updated_at),
    updatedAt: toMs(r.updated_at),
  };
}

function rowToEconomics(r: Record<string, unknown> | null): PlatformEconomics {
  if (!r) return DEFAULT_PLATFORM_ECONOMICS;
  return {
    id: String(r.id || 'economics'),
    creationFeeSol: Number(r.creation_fee_sol ?? DEFAULT_PLATFORM_ECONOMICS.creationFeeSol),
    baseGasSol: Number(r.base_gas_sol ?? DEFAULT_PLATFORM_ECONOMICS.baseGasSol),
    priorityGasSol: Number(r.priority_gas_sol ?? DEFAULT_PLATFORM_ECONOMICS.priorityGasSol),
    protocolFeeBps: Number(r.protocol_fee_bps ?? DEFAULT_PLATFORM_ECONOMICS.protocolFeeBps),
    holderRewardBps: Number(r.holder_reward_bps ?? DEFAULT_PLATFORM_ECONOMICS.holderRewardBps),
    creatorFeeBps: Number(r.creator_fee_bps ?? DEFAULT_PLATFORM_ECONOMICS.creatorFeeBps),
    congestionMultiplier: Number(
      r.congestion_multiplier ?? DEFAULT_PLATFORM_ECONOMICS.congestionMultiplier
    ),
    updatedBy: r.updated_by ? String(r.updated_by) : undefined,
    updatedAt: r.updated_at ? toMs(r.updated_at) : undefined,
  };
}

async function fetchPlatformEconomics(supabase: SupabaseClient): Promise<PlatformEconomics> {
  const { data } = await supabase
    .from('chainscope_platform_economics')
    .select('*')
    .eq('id', 'economics')
    .maybeSingle();
  return rowToEconomics(data as Record<string, unknown> | null);
}

async function checkIsAdmin(supabase: SupabaseClient, authUser: AuthUser): Promise<boolean> {
  if (
    authUser.emailVerified &&
    authUser.email.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL
  ) {
    return true;
  }
  if (!authUser.emailVerified) return false;
  const { data } = await supabase
    .from('chainscope_admins')
    .select('uid')
    .eq('uid', authUser.uid)
    .maybeSingle();
  return Boolean(data);
}

async function writeAuditLog(
  supabase: SupabaseClient,
  actor: { uid: string; handle: string },
  action: string,
  targetId: string,
  details: string
) {
  await supabase.from('chainscope_admin_audit_logs').insert({
    id: makeId('log'),
    actor_uid: actor.uid,
    actor_handle: actor.handle,
    action,
    target_id: targetId,
    details,
    created_at: new Date().toISOString(),
  });
}

export interface VerifyWalletChainBalanceResult {
  ok: boolean;
  chain: string;
  address: string;
  symbol: string;
  balance: number;
  assetUsd: number;
  solUsd: number;
  error?: string;
}

export interface SupabaseRouteDeps {
  verifyWalletChainBalance?: (
    chain: string,
    address: string
  ) => Promise<VerifyWalletChainBalanceResult>;
}

const SUPABASE_TABLE_MAP: Record<string, { table: string; orderCol: string }> = {
  users: { table: 'chainscope_users', orderCol: 'updated_at' },
  coins: { table: 'chainscope_meme_coins', orderCol: 'updated_at' },
  trades: { table: 'chainscope_trades', orderCol: 'created_at' },
  comments: { table: 'chainscope_comments', orderCol: 'created_at' },
  holdings: { table: 'chainscope_holdings', orderCol: 'updated_at' },
  perp_positions: { table: 'chainscope_perp_positions', orderCol: 'created_at' },
  reward_claims: { table: 'chainscope_reward_claims', orderCol: 'created_at' },
  admin_wallets: { table: 'chainscope_admin_wallets', orderCol: 'updated_at' },
  emergency_funds: { table: 'chainscope_emergency_funds', orderCol: 'updated_at' },
  admins: { table: 'chainscope_admins', orderCol: 'created_at' },
  audit_logs: { table: 'chainscope_admin_audit_logs', orderCol: 'created_at' },
  economics: { table: 'chainscope_platform_economics', orderCol: 'updated_at' },
  wallet_snapshots: { table: 'chainscope_wallet_snapshots', orderCol: 'scanned_at' },
};

export function registerSupabaseRoutes(
  app: Express,
  rootDir: string,
  deps: SupabaseRouteDeps = {}
) {
  const projectId = loadFirebaseProjectId(rootDir);

  const requireAuth = async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      res.status(401).json({ error: 'Sign in required.' });
      return;
    }
    try {
      req.authUser = await verifyFirebaseIdToken(token, projectId);
      next();
    } catch (err) {
      res.status(401).json({
        error: err instanceof Error ? err.message : 'Invalid session token.',
      });
    }
  };

  const requireAdmin = async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({
        error: 'Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in AI Studio Secrets.',
      });
      return;
    }
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    try {
      const ok = await checkIsAdmin(supabase, req.authUser);
      if (!ok) {
        res.status(403).json({ error: 'Administrator privileges required.' });
        return;
      }
      next();
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Admin check failed.' });
    }
  };

  // --- SCHEMA EXPORT & LIVE SUPABASE VALIDATION ---
  app.get('/api/supabase/health', async (_req, res) => {
    const url = (process.env.SUPABASE_URL || '').trim();
    const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const anonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
    const supabase = getSupabaseAdminClient();

    let urlHost = '';
    try {
      if (url.startsWith('http')) urlHost = new URL(url).hostname;
    } catch {
      urlHost = '';
    }

    const keyMode = serviceRoleKey ? 'service_role' : anonKey ? 'anon' : 'none';
    const entries = Object.entries(SUPABASE_TABLE_MAP);

    if (!supabase) {
      res.json({
        configured: false,
        connected: false,
        urlHost,
        keyMode,
        checkedAt: Date.now(),
        readyCount: 0,
        totalTables: entries.length,
        allTablesReady: false,
        economicsSeeded: false,
        tables: entries.map(([key, spec]) => ({
          key,
          table: spec.table,
          ok: false,
          count: 0,
          error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured in AI Studio Secrets.',
        })),
        error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in AI Studio Secrets.',
      });
      return;
    }

    try {
      const tableResults = await Promise.all(
        entries.map(async ([key, spec]) => {
          const { count, error } = await supabase
            .from(spec.table)
            .select('*', { count: 'exact', head: true });
          if (error) {
            return {
              key,
              table: spec.table,
              ok: false,
              count: 0,
              error: formatSupabaseError(error),
            };
          }
          return {
            key,
            table: spec.table,
            ok: true,
            count: typeof count === 'number' ? count : 0,
          };
        })
      );

      const econCheck = await supabase
        .from('chainscope_platform_economics')
        .select('id')
        .eq('id', 'economics')
        .maybeSingle();

      const readyCount = tableResults.filter((t) => t.ok).length;
      const connected = tableResults.some((t) => t.ok);
      const allTablesReady = readyCount === entries.length;

      res.json({
        configured: true,
        connected,
        urlHost,
        keyMode,
        checkedAt: Date.now(),
        readyCount,
        totalTables: entries.length,
        allTablesReady,
        economicsSeeded: Boolean(econCheck.data),
        tables: tableResults,
        error: allTablesReady
          ? undefined
          : tableResults.find((t) => !t.ok)?.error || 'Some tables are missing.',
      });
    } catch (err) {
      res.status(500).json({
        configured: true,
        connected: false,
        urlHost,
        keyMode,
        checkedAt: Date.now(),
        readyCount: 0,
        totalTables: entries.length,
        allTablesReady: false,
        economicsSeeded: false,
        tables: entries.map(([key, spec]) => ({
          key,
          table: spec.table,
          ok: false,
          count: 0,
          error: err instanceof Error ? err.message : 'Supabase connection error',
        })),
        error: err instanceof Error ? err.message : 'Supabase connection error',
      });
    }
  });

  app.get('/api/supabase/schema', (_req, res) => {
    try {
      const schemaPath = path.resolve(rootDir, 'supabase', 'schema.sql');
      const sql = fs.existsSync(schemaPath) ? fs.readFileSync(schemaPath, 'utf8') : '';
      res.json({ sql, filename: 'schema.sql' });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to read schema' });
    }
  });

  // --- WALLET BALANCE SNAPSHOT MIRROR ---
  app.post('/api/supabase/sync/wallet-snapshot', async (req, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.json({ synced: false, reason: 'not_configured' });
      return;
    }
    const body = (req.body || {}) as {
      walletId?: string;
      label?: string;
      evmAddress?: string;
      solanaAddress?: string;
      totalUsd?: number;
      chains?: Record<string, unknown>;
      scannedAt?: number;
    };
    if (!body.walletId) {
      res.status(400).json({ error: 'walletId is required' });
      return;
    }
    const { error } = await supabase.from('chainscope_wallet_snapshots').upsert(
      {
        id: body.walletId,
        wallet_id: body.walletId,
        label: String(body.label || 'Wallet').slice(0, 64),
        evm_address: String(body.evmAddress || '').slice(0, 64),
        solana_address: String(body.solanaAddress || '').slice(0, 64),
        total_usd: Number(body.totalUsd ?? 0) || 0,
        chains: body.chains || {},
        scanned_at: toIso(body.scannedAt),
      },
      { onConflict: 'id' }
    );
    if (error) {
      res.status(500).json({ error: formatSupabaseError(error) });
      return;
    }
    res.json({ synced: true, walletId: body.walletId });
  });

  // --- SESSION & ACCOUNT ---
  app.post('/api/db/session/init', requireAuth, async (req: AuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({
        error: 'Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in AI Studio Secrets.',
      });
      return;
    }
    const authUser = req.authUser!;

    const { data: existing, error: getErr } = await supabase
      .from('chainscope_users')
      .select('*')
      .eq('uid', authUser.uid)
      .maybeSingle();

    if (getErr) {
      res.status(500).json({ error: formatSupabaseError(getErr) });
      return;
    }

    let profileRow = existing as Record<string, unknown> | null;
    if (!profileRow) {
      const handle = buildDefaultHandle(authUser);
      const displayName = (authUser.name || handle).trim().slice(0, 50) || handle;
      const nowIso = new Date().toISOString();
      const { data: inserted, error: insErr } = await supabase
        .from('chainscope_users')
        .insert({
          uid: authUser.uid,
          email: (authUser.email || `${authUser.uid}@users.local`).slice(0, 254),
          handle,
          display_name: displayName,
          linked_wallet: '',
          sol_balance: 10.0,
          created_at: nowIso,
          updated_at: nowIso,
        })
        .select('*')
        .single();
      if (insErr) {
        res.status(500).json({ error: formatSupabaseError(insErr) });
        return;
      }
      profileRow = inserted as Record<string, unknown>;
    }

    const [isAdmin, economics] = await Promise.all([
      checkIsAdmin(supabase, authUser),
      fetchPlatformEconomics(supabase),
    ]);

    res.json({
      profile: rowToUser(profileRow),
      isAdmin,
      economics,
    });
  });

  app.get('/api/db/account/state', requireAuth, async (req: AuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({
        error: 'Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in AI Studio Secrets.',
      });
      return;
    }
    const authUser = req.authUser!;

    const [profileRes, holdingsRes, perpsRes, claimsRes, econ, isAdmin] = await Promise.all([
      supabase.from('chainscope_users').select('*').eq('uid', authUser.uid).maybeSingle(),
      supabase.from('chainscope_holdings').select('*').eq('owner_uid', authUser.uid),
      supabase
        .from('chainscope_perp_positions')
        .select('*')
        .eq('owner_uid', authUser.uid)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('chainscope_reward_claims')
        .select('*')
        .eq('owner_uid', authUser.uid)
        .order('created_at', { ascending: false })
        .limit(50),
      fetchPlatformEconomics(supabase),
      checkIsAdmin(supabase, authUser),
    ]);

    if (profileRes.error) {
      res.status(500).json({ error: formatSupabaseError(profileRes.error) });
      return;
    }

    res.json({
      profile: profileRes.data ? rowToUser(profileRes.data as Record<string, unknown>) : null,
      holdings: (holdingsRes.data || [])
        .map((r) => rowToHolding(r as Record<string, unknown>))
        .filter((h) => h.tokenBalance > 0),
      perpPositions: (perpsRes.data || []).map((r) => rowToPerp(r as Record<string, unknown>)),
      rewardClaims: (claimsRes.data || []).map((r) => rowToClaim(r as Record<string, unknown>)),
      economics: econ,
      isAdmin,
    });
  });

  app.patch('/api/db/account/profile', requireAuth, async (req: AuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({
        error: 'Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in AI Studio Secrets.',
      });
      return;
    }
    const authUser = req.authUser!;
    const { handle, displayName, linkedWallet } = (req.body || {}) as {
      handle?: string;
      displayName?: string;
      linkedWallet?: string;
    };

    const cleanHandle = String(handle || '')
      .trim()
      .replace(/[^a-zA-Z0-9_]/g, '')
      .slice(0, 32);
    if (cleanHandle.length < 2) {
      res.status(400).json({ error: 'Handle must be at least 2 alphanumeric/underscore characters.' });
      return;
    }
    const cleanName = String(displayName || '').trim().slice(0, 50);
    if (!cleanName) {
      res.status(400).json({ error: 'Display name is required.' });
      return;
    }
    const cleanWallet = String(linkedWallet || '').trim().slice(0, 64);

    const { data, error } = await supabase
      .from('chainscope_users')
      .update({
        handle: cleanHandle,
        display_name: cleanName,
        linked_wallet: cleanWallet,
        updated_at: new Date().toISOString(),
      })
      .eq('uid', authUser.uid)
      .select('*')
      .single();

    if (error) {
      res.status(500).json({ error: formatSupabaseError(error) });
      return;
    }
    res.json({ profile: rowToUser(data as Record<string, unknown>) });
  });

  app.post('/api/db/account/faucet', requireAuth, async (req: AuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({
        error: 'Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in AI Studio Secrets.',
      });
      return;
    }
    const authUser = req.authUser!;

    const { data: userRow, error: getErr } = await supabase
      .from('chainscope_users')
      .select('*')
      .eq('uid', authUser.uid)
      .single();
    if (getErr || !userRow) {
      res.status(404).json({ error: 'Account not ready.' });
      return;
    }

    const currentBal = Number((userRow as Record<string, unknown>).sol_balance ?? 0);
    if (currentBal >= 100) {
      res.status(400).json({
        error: 'Faucet is available when your trading balance is below 100 SOL.',
      });
      return;
    }

    const nextBalance = Number((currentBal + 10).toFixed(6));
    const { data: updated, error: updErr } = await supabase
      .from('chainscope_users')
      .update({
        sol_balance: nextBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('uid', authUser.uid)
      .select('*')
      .single();

    if (updErr) {
      res.status(500).json({ error: formatSupabaseError(updErr) });
      return;
    }
    res.json({ profile: rowToUser(updated as Record<string, unknown>) });
  });

  app.post('/api/db/account/deposit', requireAuth, async (req: AuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({
        error: 'Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in AI Studio Secrets.',
      });
      return;
    }
    const authUser = req.authUser!;
    const {
      walletId,
      walletLabel,
      walletOrigin,
      sourceAddress,
      chain,
      nativeAmount,
      signature,
    } = (req.body || {}) as {
      walletId?: string;
      walletLabel?: string;
      walletOrigin?: string;
      sourceAddress?: string;
      chain?: string;
      nativeAmount?: number;
      signature?: string;
    };

    if (walletOrigin === 'watch') {
      res.status(400).json({
        error: 'Watch-only addresses cannot transfer funds. Connect or import an owned wallet.',
      });
      return;
    }

    const cleanChain = String(chain || '').trim().toLowerCase();
    const cleanAddr = String(sourceAddress || '').trim();
    const amountNum = Number(nativeAmount);
    if (!cleanChain || !cleanAddr) {
      res.status(400).json({ error: 'Source wallet address and chain are required.' });
      return;
    }
    if (!Number.isFinite(amountNum) || amountNum <= 0 || amountNum > 100_000) {
      res.status(400).json({ error: 'Enter a valid positive deposit amount.' });
      return;
    }
    if (!deps.verifyWalletChainBalance) {
      res.status(500).json({ error: 'On-chain balance verifier is unavailable.' });
      return;
    }

    const check = await deps.verifyWalletChainBalance(cleanChain, cleanAddr);
    if (!check.ok) {
      res.status(400).json({ error: check.error || 'Could not verify wallet balance on-chain.' });
      return;
    }
    if (check.balance <= 0) {
      res.status(400).json({
        error: `Connected ${check.symbol} address has 0 ${check.symbol} on ${cleanChain}. Select a funded network or wallet.`,
      });
      return;
    }
    if (amountNum > check.balance + 1e-8) {
      res.status(400).json({
        error: `Requested ${amountNum} ${check.symbol} exceeds verified on-chain balance (${check.balance.toFixed(6)} ${check.symbol}).`,
      });
      return;
    }
    if (check.assetUsd <= 0 || check.solUsd <= 0) {
      res.status(400).json({ error: 'Live conversion price unavailable for this asset.' });
      return;
    }

    const solCredit = Number(((amountNum * check.assetUsd) / check.solUsd).toFixed(6));
    if (!Number.isFinite(solCredit) || solCredit <= 0.000001) {
      res.status(400).json({ error: 'Deposit equivalent is below 0.000001 SOL minimum.' });
      return;
    }

    const { data: userRow, error: getErr } = await supabase
      .from('chainscope_users')
      .select('*')
      .eq('uid', authUser.uid)
      .single();
    if (getErr || !userRow) {
      res.status(404).json({ error: 'Platform trader account not initialized.' });
      return;
    }

    const profile = rowToUser(userRow as Record<string, unknown>);
    const nextBalance = Number((profile.solBalance + solCredit).toFixed(6));
    const nowIso = new Date().toISOString();

    const { data: updated, error: updErr } = await supabase
      .from('chainscope_users')
      .update({
        sol_balance: nextBalance,
        linked_wallet: profile.linkedWallet || check.address,
        updated_at: nowIso,
      })
      .eq('uid', authUser.uid)
      .select('*')
      .single();

    if (updErr || !updated) {
      res.status(500).json({ error: formatSupabaseError(updErr) });
      return;
    }

    await writeAuditLog(
      supabase,
      { uid: profile.uid, handle: profile.handle },
      'PLATFORM_WALLET_DEPOSIT',
      walletId || check.address,
      `Added ${solCredit.toFixed(4)} SOL from ${walletLabel || 'Connected Wallet'} (${amountNum} ${check.symbol} on ${cleanChain}, addr ${check.address.slice(0, 10)}…${signature ? `, signed` : ''})`
    );

    res.json({
      profile: rowToUser(updated as Record<string, unknown>),
      solCredited: solCredit,
      nativeAmount: amountNum,
      symbol: check.symbol,
      chain: cleanChain,
      verifiedBalance: check.balance,
    });
  });

  // --- LAUNCHPAD OVERVIEW & DETAIL ---
  app.get('/api/db/launchpad/overview', requireAuth, async (_req, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({
        error: 'Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in AI Studio Secrets.',
      });
      return;
    }

    const [coinsRes, tradersRes, economics] = await Promise.all([
      supabase
        .from('chainscope_meme_coins')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(120),
      supabase
        .from('chainscope_users')
        .select('*')
        .order('sol_balance', { ascending: false })
        .limit(100),
      fetchPlatformEconomics(supabase),
    ]);

    if (coinsRes.error) {
      res.status(500).json({ error: formatSupabaseError(coinsRes.error) });
      return;
    }

    res.json({
      coins: (coinsRes.data || []).map((r) => rowToCoin(r as Record<string, unknown>)),
      traders: (tradersRes.data || []).map((r) => rowToUser(r as Record<string, unknown>)),
      economics,
    });
  });

  app.get('/api/db/launchpad/coins/:coinId/detail', requireAuth, async (req, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({
        error: 'Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in AI Studio Secrets.',
      });
      return;
    }
    const coinId = String(req.params.coinId || '');

    const [tradesRes, commentsRes] = await Promise.all([
      supabase
        .from('chainscope_trades')
        .select('*')
        .eq('coin_id', coinId)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('chainscope_comments')
        .select('*')
        .eq('coin_id', coinId)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    if (tradesRes.error) {
      res.status(500).json({ error: formatSupabaseError(tradesRes.error) });
      return;
    }

    res.json({
      trades: (tradesRes.data || []).map((r) => rowToTrade(r as Record<string, unknown>)),
      comments: (commentsRes.data || []).map((r) => rowToComment(r as Record<string, unknown>)),
    });
  });

  // --- LAUNCH COIN ---
  app.post('/api/db/launchpad/coins', requireAuth, async (req: AuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({
        error: 'Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in AI Studio Secrets.',
      });
      return;
    }
    const authUser = req.authUser!;
    const input = (req.body || {}) as {
      name?: string;
      ticker?: string;
      description?: string;
      chain?: string;
      mode?: CoinMode;
      emblemIcon?: string;
      emblemColor?: string;
      website?: string;
      twitter?: string;
      initialBuySol?: number;
      gasTier?: GasTier;
    };

    const cleanName = String(input.name || '').trim().slice(0, 32);
    const cleanTicker = String(input.ticker || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 10);
    const cleanDesc = String(input.description || '').trim().slice(0, 280);
    const cleanWebsite = String(input.website || '').trim().slice(0, 120);
    const cleanTwitter = String(input.twitter || '').trim().slice(0, 64);
    const mode: CoinMode = input.mode === 'mayhem' ? 'mayhem' : 'standard';
    const gasTier: GasTier =
      input.gasTier === 'fast' || input.gasTier === 'turbo' ? input.gasTier : 'standard';
    const emblemIcon = String(input.emblemIcon || 'rocket').slice(0, 20);
    const emblemColor = String(input.emblemColor || '#3B82F6').slice(0, 20);
    const chain = ['solana', 'base', 'ethereum', 'polygon'].includes(String(input.chain))
      ? String(input.chain)
      : 'solana';

    if (cleanName.length < 2) {
      res.status(400).json({ error: 'Coin name must be at least 2 characters.' });
      return;
    }
    if (cleanTicker.length < 2) {
      res.status(400).json({ error: 'Ticker must be 2–10 uppercase letters or digits.' });
      return;
    }
    if (cleanDesc.length < 1) {
      res.status(400).json({ error: 'Description is required.' });
      return;
    }

    const [{ data: userRow, error: userErr }, economics] = await Promise.all([
      supabase.from('chainscope_users').select('*').eq('uid', authUser.uid).single(),
      fetchPlatformEconomics(supabase),
    ]);

    if (userErr || !userRow) {
      res.status(404).json({ error: 'Trader profile not initialized.' });
      return;
    }
    const profile = rowToUser(userRow as Record<string, unknown>);

    const devBuy =
      typeof input.initialBuySol === 'number' &&
      Number.isFinite(input.initialBuySol) &&
      input.initialBuySol > 0
        ? Math.min(input.initialBuySol, 25)
        : 0;

    const gas = computeGasFee(gasTier, economics);
    const creationFeeSol = Math.max(0, economics.creationFeeSol || 0);
    const totalRequiredSol = Number((creationFeeSol + gas.totalGasSol + devBuy).toFixed(6));

    if (totalRequiredSol > profile.solBalance) {
      res.status(400).json({
        error: `Insufficient SOL (${profile.solBalance.toFixed(4)} SOL available, ${totalRequiredSol.toFixed(4)} SOL required incl. deploy fee & gas).`,
      });
      return;
    }

    const coinId = makeId('coin');
    const initialCurve = getInitialCurveState(mode);
    const nowIso = new Date().toISOString();

    if (devBuy > 0) {
      const q = quoteBuy(
        initialCurve.virtualSol,
        initialCurve.virtualTokens,
        initialCurve.realSol,
        devBuy,
        mode,
        gasTier,
        economics
      );
      const tradeId = makeId('trd');

      const { error: coinErr } = await supabase.from('chainscope_meme_coins').insert({
        id: coinId,
        name: cleanName,
        ticker: cleanTicker,
        description: cleanDesc,
        chain,
        mode,
        emblem_icon: emblemIcon,
        emblem_color: emblemColor,
        website: cleanWebsite,
        twitter: cleanTwitter,
        creator_uid: profile.uid,
        creator_handle: profile.handle,
        virtual_sol: q.newVirtualSol,
        virtual_tokens: q.newVirtualTokens,
        real_sol: q.newRealSol,
        total_supply: TOTAL_SUPPLY,
        price_sol: q.newPriceSol,
        market_cap_sol: q.newMarketCapSol,
        volume_sol: devBuy,
        trade_count: 1,
        graduated: q.graduated,
        holder_reward_pool_sol: Number(q.holderRewardFeeSol.toFixed(6)),
        creator_fees_sol: Number(q.creatorFeeSol.toFixed(6)),
        gas_collected_sol: Number(gas.totalGasSol.toFixed(6)),
        created_at: nowIso,
        updated_at: nowIso,
      });
      if (coinErr) {
        res.status(500).json({ error: formatSupabaseError(coinErr) });
        return;
      }

      await Promise.all([
        supabase.from('chainscope_trades').insert({
          id: tradeId,
          coin_id: coinId,
          trader_uid: profile.uid,
          trader_handle: profile.handle,
          side: 'buy',
          sol_amount: devBuy,
          token_amount: q.tokensOut,
          price_sol: q.newPriceSol,
          gas_sol: gas.totalGasSol,
          created_at: nowIso,
        }),
        supabase.from('chainscope_holdings').upsert(
          {
            owner_uid: profile.uid,
            coin_id: coinId,
            ticker: cleanTicker,
            name: cleanName,
            emblem_icon: emblemIcon,
            emblem_color: emblemColor,
            token_balance: q.tokensOut,
            avg_buy_price_sol: q.newPriceSol,
            updated_at: nowIso,
          },
          { onConflict: 'owner_uid,coin_id' }
        ),
        supabase
          .from('chainscope_users')
          .update({
            sol_balance: Number((profile.solBalance - totalRequiredSol).toFixed(6)),
            updated_at: nowIso,
          })
          .eq('uid', profile.uid),
      ]);
    } else {
      const { error: coinErr } = await supabase.from('chainscope_meme_coins').insert({
        id: coinId,
        name: cleanName,
        ticker: cleanTicker,
        description: cleanDesc,
        chain,
        mode,
        emblem_icon: emblemIcon,
        emblem_color: emblemColor,
        website: cleanWebsite,
        twitter: cleanTwitter,
        creator_uid: profile.uid,
        creator_handle: profile.handle,
        virtual_sol: initialCurve.virtualSol,
        virtual_tokens: initialCurve.virtualTokens,
        real_sol: 0,
        total_supply: TOTAL_SUPPLY,
        price_sol: initialCurve.priceSol,
        market_cap_sol: initialCurve.marketCapSol,
        volume_sol: 0,
        trade_count: 0,
        graduated: false,
        holder_reward_pool_sol: 0,
        creator_fees_sol: 0,
        gas_collected_sol: Number(gas.totalGasSol.toFixed(6)),
        created_at: nowIso,
        updated_at: nowIso,
      });
      if (coinErr) {
        res.status(500).json({ error: formatSupabaseError(coinErr) });
        return;
      }

      await supabase
        .from('chainscope_users')
        .update({
          sol_balance: Number((profile.solBalance - totalRequiredSol).toFixed(6)),
          updated_at: nowIso,
        })
        .eq('uid', profile.uid);
    }

    res.json({ coinId });
  });

  // --- BONDING CURVE SWAP ---
  app.post('/api/db/launchpad/coins/:coinId/swap', requireAuth, async (req: AuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({
        error: 'Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in AI Studio Secrets.',
      });
      return;
    }
    const authUser = req.authUser!;
    const coinId = String(req.params.coinId || '');
    const { side, amount, gasTier = 'standard' } = (req.body || {}) as {
      side?: 'buy' | 'sell';
      amount?: number;
      gasTier?: GasTier;
    };

    if (side !== 'buy' && side !== 'sell') {
      res.status(400).json({ error: 'Invalid trade side.' });
      return;
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: 'Enter a valid positive trade amount.' });
      return;
    }

    const [coinRes, userRes, holdingRes, economics] = await Promise.all([
      supabase.from('chainscope_meme_coins').select('*').eq('id', coinId).maybeSingle(),
      supabase.from('chainscope_users').select('*').eq('uid', authUser.uid).maybeSingle(),
      supabase
        .from('chainscope_holdings')
        .select('*')
        .eq('owner_uid', authUser.uid)
        .eq('coin_id', coinId)
        .maybeSingle(),
      fetchPlatformEconomics(supabase),
    ]);

    if (!coinRes.data) {
      res.status(404).json({ error: 'Coin no longer exists.' });
      return;
    }
    if (!userRes.data) {
      res.status(404).json({ error: 'Trader profile not initialized.' });
      return;
    }

    const coin = rowToCoin(coinRes.data as Record<string, unknown>);
    const profile = rowToUser(userRes.data as Record<string, unknown>);
    const existingHolding = holdingRes.data
      ? rowToHolding(holdingRes.data as Record<string, unknown>)
      : null;
    const mode: CoinMode = coin.mode === 'mayhem' ? 'mayhem' : 'standard';
    const tradeId = makeId('trd');
    const nowIso = new Date().toISOString();

    if (side === 'buy') {
      const q = quoteBuy(
        coin.virtualSol,
        coin.virtualTokens,
        coin.realSol,
        amount,
        mode,
        gasTier,
        economics
      );
      if (q.totalSolDebited > profile.solBalance) {
        res.status(400).json({
          error: `Insufficient SOL balance. Need ${q.totalSolDebited.toFixed(4)} SOL (incl. ${q.gasSol.toFixed(4)} gas), available ${profile.solBalance.toFixed(4)} SOL.`,
        });
        return;
      }
      if (q.tokensOut <= 0) {
        res.status(400).json({ error: 'Trade size too small.' });
        return;
      }

      const prevBal = existingHolding?.tokenBalance || 0;
      const prevCost = prevBal * (existingHolding?.avgBuyPriceSol || 0);
      const newBal = prevBal + q.tokensOut;
      const newAvgPrice = newBal > 0 ? (prevCost + amount) / newBal : q.newPriceSol;

      const { error: updErr } = await supabase
        .from('chainscope_meme_coins')
        .update({
          virtual_sol: q.newVirtualSol,
          virtual_tokens: q.newVirtualTokens,
          real_sol: q.newRealSol,
          price_sol: q.newPriceSol,
          market_cap_sol: q.newMarketCapSol,
          volume_sol: coin.volumeSol + amount,
          trade_count: coin.tradeCount + 1,
          graduated: coin.graduated || q.graduated,
          holder_reward_pool_sol: Number(
            ((coin.holderRewardPoolSol || 0) + q.holderRewardFeeSol).toFixed(6)
          ),
          creator_fees_sol: Number(
            ((coin.creatorFeesSol || 0) + q.creatorFeeSol).toFixed(6)
          ),
          gas_collected_sol: Number(
            ((coin.gasCollectedSol || 0) + q.gasSol).toFixed(6)
          ),
          updated_at: nowIso,
        })
        .eq('id', coin.id);

      if (updErr) {
        res.status(500).json({ error: formatSupabaseError(updErr) });
        return;
      }

      await Promise.all([
        supabase
          .from('chainscope_users')
          .update({
            sol_balance: Number((profile.solBalance - q.totalSolDebited).toFixed(6)),
            updated_at: nowIso,
          })
          .eq('uid', profile.uid),
        supabase.from('chainscope_holdings').upsert(
          {
            owner_uid: profile.uid,
            coin_id: coin.id,
            ticker: coin.ticker,
            name: coin.name,
            emblem_icon: coin.emblemIcon,
            emblem_color: coin.emblemColor,
            token_balance: newBal,
            avg_buy_price_sol: newAvgPrice,
            updated_at: nowIso,
          },
          { onConflict: 'owner_uid,coin_id' }
        ),
        supabase.from('chainscope_trades').insert({
          id: tradeId,
          coin_id: coin.id,
          trader_uid: profile.uid,
          trader_handle: profile.handle,
          side: 'buy',
          sol_amount: amount,
          token_amount: q.tokensOut,
          price_sol: q.newPriceSol,
          gas_sol: q.gasSol,
          created_at: nowIso,
        }),
      ]);
      res.json({ ok: true, tradeId });
    } else {
      const heldTokens = existingHolding?.tokenBalance || 0;
      if (amount > heldTokens + 1e-6) {
        res.status(400).json({ error: 'Insufficient token balance to sell.' });
        return;
      }
      const sellAmount = Math.min(amount, heldTokens);
      const q = quoteSell(
        coin.virtualSol,
        coin.virtualTokens,
        coin.realSol,
        sellAmount,
        gasTier,
        economics
      );
      if (q.netSolOut <= 0) {
        res.status(400).json({ error: 'Sell output too small.' });
        return;
      }
      if (profile.solBalance + q.netSolOut < q.gasSol) {
        res.status(400).json({ error: 'Insufficient SOL to cover network gas fee.' });
        return;
      }

      const remainingTokens = Math.max(0, heldTokens - sellAmount);
      const netUserCredit = q.netSolOut - q.gasSol;

      const { error: updErr } = await supabase
        .from('chainscope_meme_coins')
        .update({
          virtual_sol: q.newVirtualSol,
          virtual_tokens: q.newVirtualTokens,
          real_sol: q.newRealSol,
          price_sol: q.newPriceSol,
          market_cap_sol: q.newMarketCapSol,
          volume_sol: coin.volumeSol + q.netSolOut,
          trade_count: coin.tradeCount + 1,
          graduated: coin.graduated,
          holder_reward_pool_sol: Number(
            ((coin.holderRewardPoolSol || 0) + q.holderRewardFeeSol).toFixed(6)
          ),
          creator_fees_sol: Number(
            ((coin.creatorFeesSol || 0) + q.creatorFeeSol).toFixed(6)
          ),
          gas_collected_sol: Number(
            ((coin.gasCollectedSol || 0) + q.gasSol).toFixed(6)
          ),
          updated_at: nowIso,
        })
        .eq('id', coin.id);

      if (updErr) {
        res.status(500).json({ error: formatSupabaseError(updErr) });
        return;
      }

      await Promise.all([
        supabase
          .from('chainscope_users')
          .update({
            sol_balance: Number(Math.max(0, profile.solBalance + netUserCredit).toFixed(6)),
            updated_at: nowIso,
          })
          .eq('uid', profile.uid),
        remainingTokens <= 0.0001
          ? supabase
              .from('chainscope_holdings')
              .delete()
              .eq('owner_uid', profile.uid)
              .eq('coin_id', coin.id)
          : supabase
              .from('chainscope_holdings')
              .update({
                token_balance: remainingTokens,
                updated_at: nowIso,
              })
              .eq('owner_uid', profile.uid)
              .eq('coin_id', coin.id),
        supabase.from('chainscope_trades').insert({
          id: tradeId,
          coin_id: coin.id,
          trader_uid: profile.uid,
          trader_handle: profile.handle,
          side: 'sell',
          sol_amount: q.netSolOut,
          token_amount: sellAmount,
          price_sol: q.newPriceSol,
          gas_sol: q.gasSol,
          created_at: nowIso,
        }),
      ]);
      res.json({ ok: true, tradeId });
    }
  });

  // --- HOLDER REWARDS ---
  app.post(
    '/api/db/launchpad/coins/:coinId/claim-rewards',
    requireAuth,
    async (req: AuthedRequest, res) => {
      const supabase = getSupabaseAdminClient();
      if (!supabase) {
        res.status(503).json({
          error: 'Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in AI Studio Secrets.',
        });
        return;
      }
      const authUser = req.authUser!;
      const coinId = String(req.params.coinId || '');

      const [coinRes, userRes, holdingRes] = await Promise.all([
        supabase.from('chainscope_meme_coins').select('*').eq('id', coinId).maybeSingle(),
        supabase.from('chainscope_users').select('*').eq('uid', authUser.uid).maybeSingle(),
        supabase
          .from('chainscope_holdings')
          .select('*')
          .eq('owner_uid', authUser.uid)
          .eq('coin_id', coinId)
          .maybeSingle(),
      ]);

      if (!coinRes.data) {
        res.status(404).json({ error: 'Coin no longer exists.' });
        return;
      }
      if (!userRes.data) {
        res.status(404).json({ error: 'Account profile not ready.' });
        return;
      }
      if (!holdingRes.data) {
        res.status(400).json({ error: 'You do not hold tokens in this pool.' });
        return;
      }

      const coin = rowToCoin(coinRes.data as Record<string, unknown>);
      const profile = rowToUser(userRes.data as Record<string, unknown>);
      const holding = rowToHolding(holdingRes.data as Record<string, unknown>);

      const poolSol = coin.holderRewardPoolSol || 0;
      if (poolSol <= 0.00001) {
        res.status(400).json({ error: 'Reward pool has no claimable SOL yet.' });
        return;
      }

      const shareRatio = Math.min(1, Math.max(0, holding.tokenBalance / CURVE_TOKEN_ALLOCATION));
      const rawClaim = poolSol * Math.max(shareRatio, 0.05);
      const claimedAmount = Number(Math.min(poolSol, rawClaim).toFixed(6));

      if (claimedAmount <= 0.000001) {
        res.status(400).json({ error: 'Claimable reward amount is below minimum threshold.' });
        return;
      }

      const claimId = makeId('clm');
      const nowIso = new Date().toISOString();

      await Promise.all([
        supabase
          .from('chainscope_meme_coins')
          .update({
            holder_reward_pool_sol: Number(Math.max(0, poolSol - claimedAmount).toFixed(6)),
            updated_at: nowIso,
          })
          .eq('id', coin.id),
        supabase
          .from('chainscope_users')
          .update({
            sol_balance: Number((profile.solBalance + claimedAmount).toFixed(6)),
            updated_at: nowIso,
          })
          .eq('uid', profile.uid),
        supabase.from('chainscope_reward_claims').insert({
          id: claimId,
          owner_uid: profile.uid,
          coin_id: coin.id,
          ticker: coin.ticker,
          claimed_sol: claimedAmount,
          created_at: nowIso,
        }),
      ]);

      res.json({ claimedAmount });
    }
  );

  // --- PERPS ---
  app.post('/api/db/launchpad/perps', requireAuth, async (req: AuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({
        error: 'Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in AI Studio Secrets.',
      });
      return;
    }
    const authUser = req.authUser!;
    const { coinId, side, collateralSol, leverage, gasTier = 'standard' } = (req.body || {}) as {
      coinId?: string;
      side?: 'long' | 'short';
      collateralSol?: number;
      leverage?: number;
      gasTier?: GasTier;
    };

    if (!coinId || (side !== 'long' && side !== 'short')) {
      res.status(400).json({ error: 'Valid coinId and side are required.' });
      return;
    }
    if (
      typeof collateralSol !== 'number' ||
      !Number.isFinite(collateralSol) ||
      collateralSol <= 0 ||
      collateralSol > 10_000
    ) {
      res.status(400).json({ error: 'Collateral must be between 0.01 and 10,000 SOL.' });
      return;
    }

    const cleanLev = Math.min(20, Math.max(1, Math.round(Number(leverage) || 1)));
    const [coinRes, userRes, economics] = await Promise.all([
      supabase.from('chainscope_meme_coins').select('*').eq('id', coinId).maybeSingle(),
      supabase.from('chainscope_users').select('*').eq('uid', authUser.uid).maybeSingle(),
      fetchPlatformEconomics(supabase),
    ]);

    if (!coinRes.data) {
      res.status(404).json({ error: 'Coin no longer exists.' });
      return;
    }
    if (!userRes.data) {
      res.status(404).json({ error: 'Trader profile not initialized.' });
      return;
    }

    const coin = rowToCoin(coinRes.data as Record<string, unknown>);
    const profile = rowToUser(userRes.data as Record<string, unknown>);
    const gas = computeGasFee(gasTier, economics);
    const totalDebit = Number((collateralSol + gas.totalGasSol).toFixed(6));

    if (totalDebit > profile.solBalance) {
      res.status(400).json({
        error: `Insufficient SOL balance. Need ${totalDebit.toFixed(4)} SOL (incl. ${gas.totalGasSol.toFixed(4)} gas).`,
      });
      return;
    }

    const posId = makeId('perp');
    const nowIso = new Date().toISOString();
    const liqPrice = computeLiquidationPrice(side, coin.priceSol, cleanLev);

    const { error: insErr } = await supabase.from('chainscope_perp_positions').insert({
      id: posId,
      owner_uid: profile.uid,
      coin_id: coin.id,
      ticker: coin.ticker,
      side,
      collateral_sol: Number(collateralSol.toFixed(6)),
      leverage: cleanLev,
      entry_price_sol: coin.priceSol,
      liquidation_price_sol: liqPrice,
      status: 'open',
      realized_pnl_sol: 0,
      created_at: nowIso,
      updated_at: nowIso,
    });
    if (insErr) {
      res.status(500).json({ error: formatSupabaseError(insErr) });
      return;
    }

    await supabase
      .from('chainscope_users')
      .update({
        sol_balance: Number((profile.solBalance - totalDebit).toFixed(6)),
        updated_at: nowIso,
      })
      .eq('uid', profile.uid);

    res.json({ posId });
  });

  app.post('/api/db/launchpad/perps/:posId/close', requireAuth, async (req: AuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({
        error: 'Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in AI Studio Secrets.',
      });
      return;
    }
    const authUser = req.authUser!;
    const posId = String(req.params.posId || '');

    const { data: posData, error: posErr } = await supabase
      .from('chainscope_perp_positions')
      .select('*')
      .eq('id', posId)
      .eq('owner_uid', authUser.uid)
      .maybeSingle();

    if (posErr || !posData) {
      res.status(404).json({ error: 'Position not found.' });
      return;
    }
    const pos = rowToPerp(posData as Record<string, unknown>);
    if (pos.status !== 'open') {
      res.status(400).json({ error: 'Position is already closed.' });
      return;
    }

    const [coinRes, userRes] = await Promise.all([
      supabase.from('chainscope_meme_coins').select('*').eq('id', pos.coinId).maybeSingle(),
      supabase.from('chainscope_users').select('*').eq('uid', authUser.uid).maybeSingle(),
    ]);
    if (!userRes.data) {
      res.status(404).json({ error: 'Trader profile missing.' });
      return;
    }

    const profile = rowToUser(userRes.data as Record<string, unknown>);
    const markPrice = coinRes.data
      ? rowToCoin(coinRes.data as Record<string, unknown>).priceSol
      : pos.entryPriceSol;

    const calc = computeUnrealizedPnl(
      {
        side: pos.side,
        collateralSol: pos.collateralSol,
        leverage: pos.leverage,
        entryPriceSol: pos.entryPriceSol,
      },
      markPrice
    );
    const payoutSol = calc.liquidated
      ? 0
      : Number(Math.max(0, pos.collateralSol + calc.pnlSol).toFixed(6));
    const pnlSol = Number(calc.pnlSol.toFixed(6));
    const nowIso = new Date().toISOString();

    await supabase
      .from('chainscope_perp_positions')
      .update({
        status: calc.liquidated ? 'liquidated' : 'closed',
        realized_pnl_sol: pnlSol,
        updated_at: nowIso,
      })
      .eq('id', pos.id);

    if (payoutSol > 0) {
      await supabase
        .from('chainscope_users')
        .update({
          sol_balance: Number((profile.solBalance + payoutSol).toFixed(6)),
          updated_at: nowIso,
        })
        .eq('uid', profile.uid);
    }

    res.json({ pnlSol, payoutSol, liquidated: calc.liquidated });
  });

  // --- COMMENTS ---
  app.post('/api/db/launchpad/coins/:coinId/comments', requireAuth, async (req: AuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({
        error: 'Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in AI Studio Secrets.',
      });
      return;
    }
    const authUser = req.authUser!;
    const coinId = String(req.params.coinId || '');
    const cleanText = String((req.body as { text?: string })?.text || '').trim().slice(0, 280);
    if (!cleanText) {
      res.status(400).json({ error: 'Comment cannot be empty.' });
      return;
    }

    const { data: userRow } = await supabase
      .from('chainscope_users')
      .select('handle')
      .eq('uid', authUser.uid)
      .maybeSingle();

    const authorHandle = String((userRow as { handle?: string } | null)?.handle || buildDefaultHandle(authUser));
    const commentId = makeId('cmt');
    const { error } = await supabase.from('chainscope_comments').insert({
      id: commentId,
      coin_id: coinId,
      author_uid: authUser.uid,
      author_handle: authorHandle,
      text: cleanText,
      created_at: new Date().toISOString(),
    });
    if (error) {
      res.status(500).json({ error: formatSupabaseError(error) });
      return;
    }
    res.json({ commentId });
  });

  app.delete(
    '/api/db/launchpad/coins/:coinId/comments/:commentId',
    requireAuth,
    async (req: AuthedRequest, res) => {
      const supabase = getSupabaseAdminClient();
      if (!supabase) {
        res.status(503).json({
          error: 'Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in AI Studio Secrets.',
        });
        return;
      }
      const authUser = req.authUser!;
      const coinId = String(req.params.coinId || '');
      const commentId = String(req.params.commentId || '');

      const { data: cmt } = await supabase
        .from('chainscope_comments')
        .select('*')
        .eq('id', commentId)
        .eq('coin_id', coinId)
        .maybeSingle();

      if (!cmt) {
        res.status(404).json({ error: 'Comment not found.' });
        return;
      }
      const isAuthor = (cmt as { author_uid?: string }).author_uid === authUser.uid;
      const isAdmin = await checkIsAdmin(supabase, authUser);
      if (!isAuthor && !isAdmin) {
        res.status(403).json({ error: 'Cannot delete another user’s comment.' });
        return;
      }

      await supabase.from('chainscope_comments').delete().eq('id', commentId);
      res.json({ ok: true });
    }
  );

  // --- ADMIN ROUTES (/api/db/admin/*) ---
  app.get('/api/db/admin/state', requireAuth, requireAdmin, async (_req, res) => {
    const supabase = getSupabaseAdminClient()!;
    const [usersRes, coinsRes, walletsRes, fundsRes, adminsRes, auditRes, economics] =
      await Promise.all([
        supabase
          .from('chainscope_users')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200),
        supabase
          .from('chainscope_meme_coins')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(200),
        supabase
          .from('chainscope_admin_wallets')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100),
        supabase
          .from('chainscope_emergency_funds')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100),
        supabase
          .from('chainscope_admins')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100),
        supabase
          .from('chainscope_admin_audit_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100),
        fetchPlatformEconomics(supabase),
      ]);

    if (usersRes.error) {
      res.status(500).json({ error: formatSupabaseError(usersRes.error) });
      return;
    }

    res.json({
      users: (usersRes.data || []).map((r) => rowToUser(r as Record<string, unknown>)),
      coins: (coinsRes.data || []).map((r) => rowToCoin(r as Record<string, unknown>)),
      adminWallets: (walletsRes.data || []).map((r) =>
        rowToAdminWallet(r as Record<string, unknown>)
      ),
      emergencyFunds: (fundsRes.data || []).map((r) =>
        rowToEmergencyFund(r as Record<string, unknown>)
      ),
      adminRecords: (adminsRes.data || []).map((r) =>
        rowToAdminRecord(r as Record<string, unknown>)
      ),
      auditLogs: (auditRes.data || []).map((r) => rowToAuditLog(r as Record<string, unknown>)),
      economics,
    });
  });

  app.post(
    '/api/db/admin/users/:uid/balance',
    requireAuth,
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const supabase = getSupabaseAdminClient()!;
      const targetUid = String(req.params.uid || '');
      const { actor, targetHandle, newBalance, reason } = (req.body || {}) as {
        actor?: { uid: string; handle: string };
        targetHandle?: string;
        newBalance?: number;
        reason?: string;
      };
      if (typeof newBalance !== 'number' || !Number.isFinite(newBalance) || newBalance < 0 || newBalance > 1_000_000) {
        res.status(400).json({ error: 'Balance must be between 0 and 1,000,000 SOL.' });
        return;
      }

      const { error } = await supabase
        .from('chainscope_users')
        .update({
          sol_balance: Number(newBalance.toFixed(6)),
          updated_at: new Date().toISOString(),
        })
        .eq('uid', targetUid);
      if (error) {
        res.status(500).json({ error: formatSupabaseError(error) });
        return;
      }
      await writeAuditLog(
        supabase,
        actor || { uid: req.authUser!.uid, handle: 'kingadmin' },
        'ADJUST_BALANCE',
        targetUid,
        `Set @${targetHandle || targetUid} SOL balance to ${newBalance.toFixed(4)} (${String(reason || '').slice(0, 120)})`
      );
      res.json({ ok: true });
    }
  );

  app.patch(
    '/api/db/admin/users/:uid/profile',
    requireAuth,
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const supabase = getSupabaseAdminClient()!;
      const targetUid = String(req.params.uid || '');
      const { actor, handle, displayName, linkedWallet } = (req.body || {}) as {
        actor?: { uid: string; handle: string };
        handle?: string;
        displayName?: string;
        linkedWallet?: string;
      };
      const cleanHandle = String(handle || '')
        .trim()
        .replace(/[^a-zA-Z0-9_]/g, '')
        .slice(0, 32);
      if (cleanHandle.length < 2) {
        res.status(400).json({ error: 'Handle must be at least 2 characters.' });
        return;
      }
      const cleanName = String(displayName || '').trim().slice(0, 50);
      if (!cleanName) {
        res.status(400).json({ error: 'Display name is required.' });
        return;
      }
      const cleanWallet = String(linkedWallet || '').trim().slice(0, 64);

      const { error } = await supabase
        .from('chainscope_users')
        .update({
          handle: cleanHandle,
          display_name: cleanName,
          linked_wallet: cleanWallet,
          updated_at: new Date().toISOString(),
        })
        .eq('uid', targetUid);
      if (error) {
        res.status(500).json({ error: formatSupabaseError(error) });
        return;
      }
      await writeAuditLog(
        supabase,
        actor || { uid: req.authUser!.uid, handle: 'kingadmin' },
        'UPDATE_USER_PROFILE',
        targetUid,
        `Updated profile for @${cleanHandle} (${cleanName})`
      );
      res.json({ ok: true });
    }
  );

  app.patch('/api/db/admin/coins/:coinId', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const supabase = getSupabaseAdminClient()!;
    const coinId = String(req.params.coinId || '');
    const { actor, ticker, description, website, twitter, graduated } = (req.body || {}) as {
      actor?: { uid: string; handle: string };
      ticker?: string;
      description?: string;
      website?: string;
      twitter?: string;
      graduated?: boolean;
    };
    const cleanDesc = String(description || '').trim().slice(0, 280);
    if (!cleanDesc) {
      res.status(400).json({ error: 'Description cannot be empty.' });
      return;
    }

    const { error } = await supabase
      .from('chainscope_meme_coins')
      .update({
        description: cleanDesc,
        website: String(website || '').trim().slice(0, 120),
        twitter: String(twitter || '').trim().slice(0, 64),
        graduated: Boolean(graduated),
        updated_at: new Date().toISOString(),
      })
      .eq('id', coinId);
    if (error) {
      res.status(500).json({ error: formatSupabaseError(error) });
      return;
    }
    await writeAuditLog(
      supabase,
      actor || { uid: req.authUser!.uid, handle: 'kingadmin' },
      'UPDATE_MEME_COIN',
      coinId,
      `Updated $${ticker || coinId} metadata (graduated=${Boolean(graduated)})`
    );
    res.json({ ok: true });
  });

  app.delete('/api/db/admin/coins/:coinId', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const supabase = getSupabaseAdminClient()!;
    const coinId = String(req.params.coinId || '');
    const { actor, name, ticker, creatorHandle } = (req.body || {}) as {
      actor?: { uid: string; handle: string };
      name?: string;
      ticker?: string;
      creatorHandle?: string;
    };

    const { error } = await supabase.from('chainscope_meme_coins').delete().eq('id', coinId);
    if (error) {
      res.status(500).json({ error: formatSupabaseError(error) });
      return;
    }
    await writeAuditLog(
      supabase,
      actor || { uid: req.authUser!.uid, handle: 'kingadmin' },
      'DELETE_MEME_COIN',
      coinId,
      `Removed meme coin ${name || coinId} ($${ticker || ''}) created by @${creatorHandle || 'unknown'}`
    );
    res.json({ ok: true });
  });

  app.delete(
    '/api/db/admin/coins/:coinId/comments/:commentId',
    requireAuth,
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const supabase = getSupabaseAdminClient()!;
      const coinId = String(req.params.coinId || '');
      const commentId = String(req.params.commentId || '');
      const { actor, authorHandle } = (req.body || {}) as {
        actor?: { uid: string; handle: string };
        authorHandle?: string;
      };
      const { error } = await supabase.from('chainscope_comments').delete().eq('id', commentId);
      if (error) {
        res.status(500).json({ error: formatSupabaseError(error) });
        return;
      }
      await writeAuditLog(
        supabase,
        actor || { uid: req.authUser!.uid, handle: 'kingadmin' },
        'MODERATE_COMMENT',
        `${coinId}/${commentId}`,
        `Deleted comment by @${authorHandle || 'user'} on coin ${coinId}`
      );
      res.json({ ok: true });
    }
  );

  app.post('/api/db/admin/roles', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const supabase = getSupabaseAdminClient()!;
    const { actor, targetUid, handle, role } = (req.body || {}) as {
      actor?: { uid: string; handle: string };
      targetUid?: string;
      handle?: string;
      role?: 'superadmin' | 'moderator';
    };
    const cleanUid = String(targetUid || '').trim();
    const cleanHandle = String(handle || '').trim().slice(0, 32) || 'admin';
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cleanUid)) {
      res.status(400).json({ error: 'Invalid target UID format.' });
      return;
    }
    const cleanRole = role === 'superadmin' ? 'superadmin' : 'moderator';

    const { error } = await supabase.from('chainscope_admins').upsert(
      {
        uid: cleanUid,
        handle: cleanHandle,
        role: cleanRole,
        granted_by: req.authUser!.uid,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'uid' }
    );
    if (error) {
      res.status(500).json({ error: formatSupabaseError(error) });
      return;
    }
    await writeAuditLog(
      supabase,
      actor || { uid: req.authUser!.uid, handle: 'kingadmin' },
      'GRANT_ADMIN_ROLE',
      cleanUid,
      `Granted ${cleanRole} role to @${cleanHandle}`
    );
    res.json({ ok: true });
  });

  app.delete('/api/db/admin/roles/:uid', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const supabase = getSupabaseAdminClient()!;
    const targetUid = String(req.params.uid || '');
    const { actor, handle } = (req.body || {}) as {
      actor?: { uid: string; handle: string };
      handle?: string;
    };
    if (targetUid === req.authUser!.uid) {
      res.status(400).json({ error: 'You cannot revoke your own active admin record.' });
      return;
    }
    const { error } = await supabase.from('chainscope_admins').delete().eq('uid', targetUid);
    if (error) {
      res.status(500).json({ error: formatSupabaseError(error) });
      return;
    }
    await writeAuditLog(
      supabase,
      actor || { uid: req.authUser!.uid, handle: 'kingadmin' },
      'REVOKE_ADMIN_ROLE',
      targetUid,
      `Revoked admin privileges from @${handle || targetUid}`
    );
    res.json({ ok: true });
  });

  // --- ADMIN WALLETS ---
  app.post('/api/db/admin/wallets', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const supabase = getSupabaseAdminClient()!;
    const { actor, label, tier, origin, evmAddress, solanaAddress, treasurySol, assignedUid, assignedHandle } =
      (req.body || {}) as {
        actor?: { uid: string; handle: string };
        label?: string;
        tier?: 'hot' | 'cold' | 'emergency';
        origin?: 'created' | 'imported';
        evmAddress?: string;
        solanaAddress?: string;
        treasurySol?: number;
        assignedUid?: string;
        assignedHandle?: string;
      };

    const cleanLabel = String(label || '').trim().slice(0, 50);
    if (cleanLabel.length < 2) {
      res.status(400).json({ error: 'Wallet label must be at least 2 characters.' });
      return;
    }
    const cleanEvm = String(evmAddress || '').trim().slice(0, 64);
    const cleanSol = String(solanaAddress || '').trim().slice(0, 64);
    if (!cleanEvm && !cleanSol) {
      res.status(400).json({ error: 'Provide at least one public EVM or Solana address.' });
      return;
    }

    const treasury =
      typeof treasurySol === 'number' && Number.isFinite(treasurySol) && treasurySol >= 0
        ? Math.min(10_000_000, Number(treasurySol.toFixed(6)))
        : 0;
    const cleanAssignedUid = String(assignedUid || '').trim().slice(0, 128);
    const cleanAssignedHandle = String(assignedHandle || '').trim().slice(0, 32);
    const cleanTier = tier === 'cold' || tier === 'emergency' ? tier : 'hot';
    const cleanOrigin = origin === 'imported' ? 'imported' : 'created';
    const walletId = makeId('wal');
    const nowIso = new Date().toISOString();

    const { error } = await supabase.from('chainscope_admin_wallets').insert({
      id: walletId,
      label: cleanLabel,
      tier: cleanTier,
      origin: cleanOrigin,
      evm_address: cleanEvm,
      solana_address: cleanSol,
      assigned_uid: cleanAssignedUid,
      assigned_handle: cleanAssignedHandle,
      treasury_sol: treasury,
      status: 'active',
      created_by: req.authUser!.uid,
      created_at: nowIso,
      updated_at: nowIso,
    });
    if (error) {
      res.status(500).json({ error: formatSupabaseError(error) });
      return;
    }

    if (cleanAssignedUid && (cleanSol || cleanEvm)) {
      await supabase
        .from('chainscope_users')
        .update({ linked_wallet: cleanSol || cleanEvm, updated_at: nowIso })
        .eq('uid', cleanAssignedUid);
    }

    await writeAuditLog(
      supabase,
      actor || { uid: req.authUser!.uid, handle: 'kingadmin' },
      cleanOrigin === 'created' ? 'CREATE_ADMIN_WALLET' : 'IMPORT_ADMIN_WALLET',
      walletId,
      `${cleanOrigin === 'created' ? 'Created' : 'Imported'} ${cleanTier.toUpperCase()} wallet "${cleanLabel}" (${treasury} SOL)${cleanAssignedHandle ? ` -> @${cleanAssignedHandle}` : ''}`
    );

    res.json({ walletId });
  });

  app.post(
    '/api/db/admin/wallets/:id/assign',
    requireAuth,
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const supabase = getSupabaseAdminClient()!;
      const walletId = String(req.params.id || '');
      const { actor, walletLabel, walletTier, solanaAddress, evmAddress, targetUser } =
        (req.body || {}) as {
          actor?: { uid: string; handle: string };
          walletLabel?: string;
          walletTier?: string;
          solanaAddress?: string;
          evmAddress?: string;
          targetUser?: { uid: string; handle: string } | null;
        };

      const nowIso = new Date().toISOString();
      const assignedUid = targetUser ? targetUser.uid : '';
      const assignedHandle = targetUser ? targetUser.handle : '';

      const { error } = await supabase
        .from('chainscope_admin_wallets')
        .update({
          assigned_uid: assignedUid,
          assigned_handle: assignedHandle,
          updated_at: nowIso,
        })
        .eq('id', walletId);
      if (error) {
        res.status(500).json({ error: formatSupabaseError(error) });
        return;
      }

      if (targetUser) {
        const addr = solanaAddress || evmAddress;
        if (addr) {
          await supabase
            .from('chainscope_users')
            .update({ linked_wallet: addr, updated_at: nowIso })
            .eq('uid', targetUser.uid);
        }
      }

      await writeAuditLog(
        supabase,
        actor || { uid: req.authUser!.uid, handle: 'kingadmin' },
        'ASSIGN_WALLET',
        walletId,
        targetUser
          ? `Assigned ${String(walletTier || 'HOT').toUpperCase()} wallet "${walletLabel || walletId}" to @${targetUser.handle}`
          : `Unassigned ${String(walletTier || 'HOT').toUpperCase()} wallet "${walletLabel || walletId}"`
      );
      res.json({ ok: true });
    }
  );

  app.patch('/api/db/admin/wallets/:id', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const supabase = getSupabaseAdminClient()!;
    const walletId = String(req.params.id || '');
    const { actor, currentLabel, status, tier, treasurySol, label } = (req.body || {}) as {
      actor?: { uid: string; handle: string };
      currentLabel?: string;
      status?: 'active' | 'frozen';
      tier?: 'hot' | 'cold' | 'emergency';
      treasurySol?: number;
      label?: string;
    };

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (status) patch.status = status;
    if (tier) patch.tier = tier;
    if (label !== undefined) patch.label = String(label).trim().slice(0, 50);
    if (typeof treasurySol === 'number' && Number.isFinite(treasurySol) && treasurySol >= 0) {
      patch.treasury_sol = Math.min(10_000_000, Number(treasurySol.toFixed(6)));
    }

    const { error } = await supabase
      .from('chainscope_admin_wallets')
      .update(patch)
      .eq('id', walletId);
    if (error) {
      res.status(500).json({ error: formatSupabaseError(error) });
      return;
    }

    await writeAuditLog(
      supabase,
      actor || { uid: req.authUser!.uid, handle: 'kingadmin' },
      'UPDATE_ADMIN_WALLET',
      walletId,
      `Updated wallet "${patch.label || currentLabel || walletId}"`
    );
    res.json({ ok: true });
  });

  app.delete('/api/db/admin/wallets/:id', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const supabase = getSupabaseAdminClient()!;
    const walletId = String(req.params.id || '');
    const { actor, label, tier } = (req.body || {}) as {
      actor?: { uid: string; handle: string };
      label?: string;
      tier?: string;
    };

    const { error } = await supabase.from('chainscope_admin_wallets').delete().eq('id', walletId);
    if (error) {
      res.status(500).json({ error: formatSupabaseError(error) });
      return;
    }
    await writeAuditLog(
      supabase,
      actor || { uid: req.authUser!.uid, handle: 'kingadmin' },
      'DELETE_ADMIN_WALLET',
      walletId,
      `Removed ${String(tier || 'HOT').toUpperCase()} wallet "${label || walletId}"`
    );
    res.json({ ok: true });
  });

  // --- EMERGENCY FUNDS ---
  app.post(
    '/api/db/admin/emergency-funds',
    requireAuth,
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const supabase = getSupabaseAdminClient()!;
      const { actor, name, purpose, allocatedSol, sourceWalletId } = (req.body || {}) as {
        actor?: { uid: string; handle: string };
        name?: string;
        purpose?: string;
        allocatedSol?: number;
        sourceWalletId?: string;
      };
      const cleanName = String(name || '').trim().slice(0, 64);
      const cleanPurpose = String(purpose || '').trim().slice(0, 200);
      if (cleanName.length < 2) {
        res.status(400).json({ error: 'Fund name must be at least 2 characters.' });
        return;
      }
      if (cleanPurpose.length < 2) {
        res.status(400).json({ error: 'Purpose is required.' });
        return;
      }
      if (
        typeof allocatedSol !== 'number' ||
        !Number.isFinite(allocatedSol) ||
        allocatedSol <= 0 ||
        allocatedSol > 10_000_000
      ) {
        res.status(400).json({ error: 'Allocation must be positive and under 10,000,000 SOL.' });
        return;
      }

      const fundId = makeId('efund');
      const nowIso = new Date().toISOString();
      const { error } = await supabase.from('chainscope_emergency_funds').insert({
        id: fundId,
        name: cleanName,
        purpose: cleanPurpose,
        allocated_sol: Number(allocatedSol.toFixed(6)),
        disbursed_sol: 0,
        source_wallet_id: String(sourceWalletId || '').trim().slice(0, 64),
        status: 'standby',
        created_by: req.authUser!.uid,
        created_at: nowIso,
        updated_at: nowIso,
      });
      if (error) {
        res.status(500).json({ error: formatSupabaseError(error) });
        return;
      }
      await writeAuditLog(
        supabase,
        actor || { uid: req.authUser!.uid, handle: 'kingadmin' },
        'CREATE_EMERGENCY_FUND',
        fundId,
        `Created emergency fund "${cleanName}" with ${allocatedSol.toFixed(2)} SOL reserve`
      );
      res.json({ fundId });
    }
  );

  app.post(
    '/api/db/admin/emergency-funds/:id/disburse',
    requireAuth,
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const supabase = getSupabaseAdminClient()!;
      const fundId = String(req.params.id || '');
      const { actor, kind, targetId, amountSol, reason } = (req.body || {}) as {
        actor?: { uid: string; handle: string };
        kind?: 'user' | 'coin';
        targetId?: string;
        amountSol?: number;
        reason?: string;
      };

      const amount = Number(amountSol);
      if (!Number.isFinite(amount) || amount <= 0) {
        res.status(400).json({ error: 'Disbursement amount must be greater than 0.' });
        return;
      }

      const { data: fundData, error: fundErr } = await supabase
        .from('chainscope_emergency_funds')
        .select('*')
        .eq('id', fundId)
        .maybeSingle();
      if (fundErr || !fundData) {
        res.status(404).json({ error: 'Emergency fund not found.' });
        return;
      }

      const fund = rowToEmergencyFund(fundData as Record<string, unknown>);
      const available = fund.allocatedSol - fund.disbursedSol;
      if (amount > available + 1e-6) {
        res.status(400).json({
          error: `Exceeds remaining emergency reserve (${available.toFixed(4)} SOL available).`,
        });
        return;
      }

      const nextDisbursed = Number((fund.disbursedSol + amount).toFixed(6));
      const remaining = fund.allocatedSol - nextDisbursed;
      const nextStatus = remaining <= 0.0001 ? 'depleted' : 'active';
      const nowIso = new Date().toISOString();

      if (kind === 'user') {
        const { data: userData } = await supabase
          .from('chainscope_users')
          .select('*')
          .eq('uid', targetId || '')
          .maybeSingle();
        if (!userData) {
          res.status(404).json({ error: 'Target trader account not found.' });
          return;
        }
        const u = rowToUser(userData as Record<string, unknown>);
        await supabase
          .from('chainscope_users')
          .update({
            sol_balance: Number((u.solBalance + amount).toFixed(6)),
            updated_at: nowIso,
          })
          .eq('uid', u.uid);
        await writeAuditLog(
          supabase,
          actor || { uid: req.authUser!.uid, handle: 'kingadmin' },
          'DISBURSE_EMERGENCY_FUND',
          u.uid,
          `Disbursed ${amount.toFixed(4)} SOL from "${fund.name}" to @${u.handle} (${String(reason || '').slice(0, 90)})`
        );
      } else {
        const { data: coinData } = await supabase
          .from('chainscope_meme_coins')
          .select('*')
          .eq('id', targetId || '')
          .maybeSingle();
        if (!coinData) {
          res.status(404).json({ error: 'Target meme coin not found.' });
          return;
        }
        const c = rowToCoin(coinData as Record<string, unknown>);
        await supabase
          .from('chainscope_meme_coins')
          .update({
            real_sol: Number((c.realSol + amount).toFixed(6)),
            updated_at: nowIso,
          })
          .eq('id', c.id);
        await writeAuditLog(
          supabase,
          actor || { uid: req.authUser!.uid, handle: 'kingadmin' },
          'INJECT_EMERGENCY_LIQUIDITY',
          c.id,
          `Injected ${amount.toFixed(4)} SOL emergency reserve from "${fund.name}" into $${c.ticker} (${String(reason || '').slice(0, 90)})`
        );
      }

      await supabase
        .from('chainscope_emergency_funds')
        .update({
          disbursed_sol: nextDisbursed,
          status: nextStatus,
          updated_at: nowIso,
        })
        .eq('id', fund.id);

      res.json({ ok: true });
    }
  );

  // --- PLATFORM ECONOMICS ---
  app.put('/api/db/admin/economics', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const supabase = getSupabaseAdminClient()!;
    const { actor, ...econ } = (req.body || {}) as Partial<PlatformEconomics> & {
      actor?: { uid: string; handle: string };
    };

    const row = {
      id: 'economics',
      creation_fee_sol: Math.min(5, Math.max(0, Number(econ.creationFeeSol ?? 0.01))),
      base_gas_sol: Math.min(1, Math.max(0, Number(econ.baseGasSol ?? 0.0005))),
      priority_gas_sol: Math.min(1, Math.max(0, Number(econ.priorityGasSol ?? 0.0015))),
      protocol_fee_bps: Math.min(1000, Math.max(0, Math.round(Number(econ.protocolFeeBps ?? 50)))),
      holder_reward_bps: Math.min(1000, Math.max(0, Math.round(Number(econ.holderRewardBps ?? 30)))),
      creator_fee_bps: Math.min(1000, Math.max(0, Math.round(Number(econ.creatorFeeBps ?? 20)))),
      congestion_multiplier: Math.min(10, Math.max(0.5, Number(econ.congestionMultiplier ?? 1))),
      updated_by: req.authUser!.uid,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('chainscope_platform_economics')
      .upsert(row, { onConflict: 'id' });
    if (error) {
      res.status(500).json({ error: formatSupabaseError(error) });
      return;
    }

    await writeAuditLog(
      supabase,
      actor || { uid: req.authUser!.uid, handle: 'kingadmin' },
      'UPDATE_GAS_ECONOMICS',
      'economics',
      `Updated gas/fees: deploy=${row.creation_fee_sol} SOL, baseGas=${row.base_gas_sol}, priority=${row.priority_gas_sol}, mult=${row.congestion_multiplier}x, fees=${row.protocol_fee_bps + row.holder_reward_bps + row.creator_fee_bps}bps`
    );
    res.json({ ok: true });
  });

  // --- LEGACY FIRESTORE -> SUPABASE ONE-TIME IMPORTER ---
  app.post(
    '/api/db/admin/import-from-firestore',
    requireAuth,
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const supabase = getSupabaseAdminClient()!;
      const {
        users = [],
        coins = [],
        trades = [],
        comments = [],
        holdings = [],
        perpPositions = [],
        rewardClaims = [],
        adminWallets = [],
        emergencyFunds = [],
        admins = [],
        auditLogs = [],
        economics,
      } = (req.body || {}) as {
        users?: Array<Record<string, unknown>>;
        coins?: Array<Record<string, unknown>>;
        trades?: Array<Record<string, unknown>>;
        comments?: Array<Record<string, unknown>>;
        holdings?: Array<Record<string, unknown>>;
        perpPositions?: Array<Record<string, unknown>>;
        rewardClaims?: Array<Record<string, unknown>>;
        adminWallets?: Array<Record<string, unknown>>;
        emergencyFunds?: Array<Record<string, unknown>>;
        admins?: Array<Record<string, unknown>>;
        auditLogs?: Array<Record<string, unknown>>;
        economics?: Record<string, unknown> | null;
      };

      try {
        const counts = {
          users: 0,
          coins: 0,
          trades: 0,
          comments: 0,
          holdings: 0,
          perpPositions: 0,
          rewardClaims: 0,
          adminWallets: 0,
          emergencyFunds: 0,
          admins: 0,
          auditLogs: 0,
        };

        if (users.length > 0) {
          const rows = users.filter((u) => u.uid).map((u) => ({
            uid: String(u.uid),
            email: '',
            handle: String(u.handle || ''),
            display_name: String(u.displayName || ''),
            linked_wallet: String(u.linkedWallet || ''),
            sol_balance: Number(u.solBalance ?? 0),
            created_at: toIso(u.createdAt),
            updated_at: toIso(u.updatedAt),
          }));
          if (rows.length > 0) {
            const { error } = await supabase.from('chainscope_users').upsert(rows, { onConflict: 'uid' });
            if (error) throw new Error(formatSupabaseError(error));
            counts.users = rows.length;
          }
        }

        if (coins.length > 0) {
          const rows = coins.filter((c) => c.id).map((c) => ({
            id: String(c.id),
            name: String(c.name || ''),
            ticker: String(c.ticker || ''),
            description: String(c.description || ''),
            chain: String(c.chain || 'solana'),
            mode: c.mode === 'mayhem' ? 'mayhem' : 'standard',
            emblem_icon: String(c.emblemIcon || 'rocket'),
            emblem_color: String(c.emblemColor || '#3B82F6'),
            website: String(c.website || ''),
            twitter: String(c.twitter || ''),
            creator_uid: String(c.creatorUid || ''),
            creator_handle: String(c.creatorHandle || ''),
            virtual_sol: Number(c.virtualSol ?? 30),
            virtual_tokens: Number(c.virtualTokens ?? 1073000000),
            real_sol: Number(c.realSol ?? 0),
            total_supply: Number(c.totalSupply ?? TOTAL_SUPPLY),
            price_sol: Number(c.priceSol ?? 0),
            market_cap_sol: Number(c.marketCapSol ?? 0),
            volume_sol: Number(c.volumeSol ?? 0),
            trade_count: Math.round(Number(c.tradeCount ?? 0)),
            graduated: Boolean(c.graduated),
            holder_reward_pool_sol: Number(c.holderRewardPoolSol ?? 0),
            creator_fees_sol: Number(c.creatorFeesSol ?? 0),
            gas_collected_sol: Number(c.gasCollectedSol ?? 0),
            created_at: toIso(c.createdAt),
            updated_at: toIso(c.updatedAt),
          }));
          if (rows.length > 0) {
            const { error } = await supabase.from('chainscope_meme_coins').upsert(rows, { onConflict: 'id' });
            if (error) throw new Error(formatSupabaseError(error));
            counts.coins = rows.length;
          }
        }

        if (trades.length > 0) {
          const rows = trades.filter((t) => t.id).map((t) => ({
            id: String(t.id),
            coin_id: String(t.coinId || ''),
            trader_uid: String(t.traderUid || ''),
            trader_handle: String(t.traderHandle || ''),
            side: t.side === 'sell' ? 'sell' : 'buy',
            sol_amount: Number(t.solAmount ?? 0),
            token_amount: Number(t.tokenAmount ?? 0),
            price_sol: Number(t.priceSol ?? 0),
            gas_sol: Number(t.gasSol ?? 0),
            created_at: toIso(t.createdAt),
          }));
          if (rows.length > 0) {
            const { error } = await supabase.from('chainscope_trades').upsert(rows, { onConflict: 'id' });
            if (error) throw new Error(formatSupabaseError(error));
            counts.trades = rows.length;
          }
        }

        if (comments.length > 0) {
          const rows = comments.filter((c) => c.id).map((c) => ({
            id: String(c.id),
            coin_id: String(c.coinId || ''),
            author_uid: String(c.authorUid || ''),
            author_handle: String(c.authorHandle || ''),
            text: String(c.text || ''),
            created_at: toIso(c.createdAt),
          }));
          if (rows.length > 0) {
            const { error } = await supabase.from('chainscope_comments').upsert(rows, { onConflict: 'id' });
            if (error) throw new Error(formatSupabaseError(error));
            counts.comments = rows.length;
          }
        }

        if (holdings.length > 0) {
          const rows = holdings.filter((h) => h.ownerUid && h.coinId).map((h) => ({
            owner_uid: String(h.ownerUid),
            coin_id: String(h.coinId),
            ticker: String(h.ticker || ''),
            name: String(h.name || ''),
            emblem_icon: String(h.emblemIcon || 'rocket'),
            emblem_color: String(h.emblemColor || '#3B82F6'),
            token_balance: Number(h.tokenBalance ?? 0),
            avg_buy_price_sol: Number(h.avgBuyPriceSol ?? 0),
            updated_at: toIso(h.updatedAt),
          }));
          if (rows.length > 0) {
            const { error } = await supabase.from('chainscope_holdings').upsert(rows, { onConflict: 'owner_uid,coin_id' });
            if (error) throw new Error(formatSupabaseError(error));
            counts.holdings = rows.length;
          }
        }

        if (perpPositions.length > 0) {
          const rows = perpPositions.filter((p) => p.id).map((p) => ({
            id: String(p.id),
            owner_uid: String(p.ownerUid || ''),
            coin_id: String(p.coinId || ''),
            ticker: String(p.ticker || ''),
            side: p.side === 'short' ? 'short' : 'long',
            collateral_sol: Number(p.collateralSol ?? 0),
            leverage: Math.round(Number(p.leverage ?? 1)),
            entry_price_sol: Number(p.entryPriceSol ?? 0),
            liquidation_price_sol: Number(p.liquidationPriceSol ?? 0),
            status: String(p.status || 'open'),
            realized_pnl_sol: Number(p.realizedPnlSol ?? 0),
            created_at: toIso(p.createdAt),
            updated_at: toIso(p.updatedAt),
          }));
          if (rows.length > 0) {
            const { error } = await supabase.from('chainscope_perp_positions').upsert(rows, { onConflict: 'id' });
            if (error) throw new Error(formatSupabaseError(error));
            counts.perpPositions = rows.length;
          }
        }

        if (rewardClaims.length > 0) {
          const rows = rewardClaims.filter((r) => r.id).map((r) => ({
            id: String(r.id),
            owner_uid: String(r.ownerUid || ''),
            coin_id: String(r.coinId || ''),
            ticker: String(r.ticker || ''),
            claimed_sol: Number(r.claimedSol ?? 0),
            created_at: toIso(r.createdAt),
          }));
          if (rows.length > 0) {
            const { error } = await supabase.from('chainscope_reward_claims').upsert(rows, { onConflict: 'id' });
            if (error) throw new Error(formatSupabaseError(error));
            counts.rewardClaims = rows.length;
          }
        }

        if (adminWallets.length > 0) {
          const rows = adminWallets.filter((w) => w.id).map((w) => ({
            id: String(w.id),
            label: String(w.label || ''),
            tier: String(w.tier || 'hot'),
            origin: String(w.origin || 'created'),
            evm_address: String(w.evmAddress || ''),
            solana_address: String(w.solanaAddress || ''),
            assigned_uid: String(w.assignedUid || ''),
            assigned_handle: String(w.assignedHandle || ''),
            treasury_sol: Number(w.treasurySol ?? 0),
            status: String(w.status || 'active'),
            created_by: String(w.createdBy || ''),
            created_at: toIso(w.createdAt),
            updated_at: toIso(w.updatedAt),
          }));
          if (rows.length > 0) {
            const { error } = await supabase.from('chainscope_admin_wallets').upsert(rows, { onConflict: 'id' });
            if (error) throw new Error(formatSupabaseError(error));
            counts.adminWallets = rows.length;
          }
        }

        if (emergencyFunds.length > 0) {
          const rows = emergencyFunds.filter((f) => f.id).map((f) => ({
            id: String(f.id),
            name: String(f.name || ''),
            purpose: String(f.purpose || ''),
            allocated_sol: Number(f.allocatedSol ?? 0),
            disbursed_sol: Number(f.disbursedSol ?? 0),
            source_wallet_id: String(f.sourceWalletId || ''),
            status: String(f.status || 'standby'),
            created_by: String(f.createdBy || ''),
            created_at: toIso(f.createdAt),
            updated_at: toIso(f.updatedAt),
          }));
          if (rows.length > 0) {
            const { error } = await supabase.from('chainscope_emergency_funds').upsert(rows, { onConflict: 'id' });
            if (error) throw new Error(formatSupabaseError(error));
            counts.emergencyFunds = rows.length;
          }
        }

        if (admins.length > 0) {
          const rows = admins.filter((a) => a.uid).map((a) => ({
            uid: String(a.uid),
            handle: String(a.handle || ''),
            role: a.role === 'superadmin' ? 'superadmin' : 'moderator',
            granted_by: String(a.grantedBy || ''),
            created_at: toIso(a.createdAt),
          }));
          if (rows.length > 0) {
            const { error } = await supabase.from('chainscope_admins').upsert(rows, { onConflict: 'uid' });
            if (error) throw new Error(formatSupabaseError(error));
            counts.admins = rows.length;
          }
        }

        if (auditLogs.length > 0) {
          const rows = auditLogs.filter((l) => l.id).map((l) => ({
            id: String(l.id),
            actor_uid: String(l.actorUid || ''),
            actor_handle: String(l.actorHandle || ''),
            action: String(l.action || ''),
            target_id: String(l.targetId || ''),
            details: String(l.details || ''),
            created_at: toIso(l.createdAt),
          }));
          if (rows.length > 0) {
            const { error } = await supabase.from('chainscope_admin_audit_logs').upsert(rows, { onConflict: 'id' });
            if (error) throw new Error(formatSupabaseError(error));
            counts.auditLogs = rows.length;
          }
        }

        if (economics) {
          await supabase.from('chainscope_platform_economics').upsert(
            {
              id: 'economics',
              creation_fee_sol: Number(economics.creationFeeSol ?? 0.01),
              base_gas_sol: Number(economics.baseGasSol ?? 0.0005),
              priority_gas_sol: Number(economics.priorityGasSol ?? 0.0015),
              protocol_fee_bps: Math.round(Number(economics.protocolFeeBps ?? 50)),
              holder_reward_bps: Math.round(Number(economics.holderRewardBps ?? 30)),
              creator_fee_bps: Math.round(Number(economics.creatorFeeBps ?? 20)),
              congestion_multiplier: Number(economics.congestionMultiplier ?? 1),
              updated_by: req.authUser!.uid,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'id' }
          );
        }

        res.json({ migrated: true, counts });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Firestore migration to Supabase failed',
        });
      }
    }
  );

  // --- SUPABASE TABLE EXPLORER ---
  app.get('/api/supabase/records/:table', requireAuth, requireAdmin, async (req, res) => {
    const supabase = getSupabaseAdminClient()!;
    const key = String(req.params.table || '').trim();
    const spec = SUPABASE_TABLE_MAP[key];
    if (!spec) {
      res.status(400).json({ error: 'Unknown Supabase table key.' });
      return;
    }
    const { data, error } = await supabase
      .from(spec.table)
      .select('*')
      .order(spec.orderCol, { ascending: false })
      .limit(50);

    if (error) {
      res.status(500).json({ error: formatSupabaseError(error) });
      return;
    }
    res.json({ table: spec.table, rows: data || [] });
  });
}
