import crypto from 'crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';

export interface WalletAuthRecord {
  uid: string;
  username: string;
  usernameLower: string;
  displayName: string;
  avatarUrl: string;
  passwordHash: string;
  evmAddress: string;
  solanaAddress: string;
  cscAddress: string;
  linkedGoogleUid: string;
  linkedGoogleEmail: string;
  createdAt: number;
  updatedAt: number;
}

export interface WalletAuthUserInfo {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
  username: string;
  avatarUrl: string;
  linkedGoogleEmail: string;
  hasPassword: boolean;
}

export interface WalletAuthRouteDeps {
  getSupabaseAdminClient: () => SupabaseClient | null;
  verifyFirebaseIdToken: (
    token: string
  ) => Promise<{ uid: string; email: string; emailVerified: boolean; name: string }>;
  requireAuth: (req: Request & { authUser?: { uid: string; email: string; emailVerified: boolean; name: string } }, res: Response, next: NextFunction) => Promise<void> | void;
}

const SNAPSHOT_AUTH_ID = 'wallet_auth_registry_v1';
const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

let authRegistryQueue: Promise<unknown> = Promise.resolve();

function withAuthLock<T>(task: () => Promise<T>): Promise<T> {
  const next = authRegistryQueue.then(task, task);
  authRegistryQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function getSessionSecret(): Buffer {
  const raw =
    (process.env.SESSION_SECRET || '').trim() ||
    (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim() ||
    'chainscope-dev-local-session-secret';
  return crypto.createHash('sha256').update(`chainscope_wallet_session:${raw}`).digest();
}

export function signWalletSessionToken(uid: string, username: string): string {
  const payload = {
    uid,
    username,
    iat: Date.now(),
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payloadB64)
    .digest('base64url');
  return `cs1.${payloadB64}.${sig}`;
}

export function verifyWalletSessionToken(
  token: string
): { uid: string; username: string } | null {
  if (!token.startsWith('cs1.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payloadB64)
    .digest('base64url');

  const sigBuf = Buffer.from(sigB64);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8')
    ) as { uid?: string; username?: string; exp?: number };
    if (!payload.uid || !payload.exp || payload.exp <= Date.now()) {
      return null;
    }
    return { uid: payload.uid, username: payload.username || '' };
  } catch {
    return null;
  }
}

export function hashPasswordScrypt(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPasswordScrypt(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function isMissingRelationError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return (
    err.code === '42P01' ||
    err.code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('schema cache') ||
    msg.includes('could not find the table')
  );
}

function toMs(val: unknown): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const p = Date.parse(val);
    return Number.isFinite(p) ? p : Date.now();
  }
  return Date.now();
}

interface AuthRegistry {
  byUid: Record<string, WalletAuthRecord>;
}

async function loadRegistry(
  supabase: SupabaseClient
): Promise<{ registry: AuthRegistry; mode: 'normalized' | 'snapshot' }> {
  const probe = await supabase
    .from('chainscope_wallet_auth')
    .select('*');

  if (!probe.error) {
    const byUid: Record<string, WalletAuthRecord> = {};
    for (const r of (probe.data || []) as Array<Record<string, unknown>>) {
      const uid = String(r.uid || '');
      if (!uid) continue;
      byUid[uid] = {
        uid,
        username: String(r.username || ''),
        usernameLower: String(r.username_lower || ''),
        displayName: String(r.display_name || ''),
        avatarUrl: String(r.avatar_url || ''),
        passwordHash: String(r.password_hash || ''),
        evmAddress: String(r.evm_address || ''),
        solanaAddress: String(r.solana_address || ''),
        cscAddress: String(r.csc_address || ''),
        linkedGoogleUid: String(r.linked_google_uid || ''),
        linkedGoogleEmail: String(r.linked_google_email || ''),
        createdAt: toMs(r.created_at),
        updatedAt: toMs(r.updated_at),
      };
    }
    return { registry: { byUid }, mode: 'normalized' };
  }

  if (!isMissingRelationError(probe.error)) {
    throw new Error(probe.error.message);
  }

  const { data } = await supabase
    .from('chainscope_wallet_snapshots')
    .select('chains')
    .eq('id', SNAPSHOT_AUTH_ID)
    .maybeSingle();

  const raw = (data?.chains || null) as { byUid?: Record<string, WalletAuthRecord> } | null;
  return {
    registry: { byUid: raw?.byUid && typeof raw.byUid === 'object' ? raw.byUid : {} },
    mode: 'snapshot',
  };
}

async function saveRecord(
  supabase: SupabaseClient,
  registry: AuthRegistry,
  mode: 'normalized' | 'snapshot',
  rec: WalletAuthRecord
) {
  registry.byUid[rec.uid] = rec;

  if (mode === 'normalized') {
    const { error } = await supabase.from('chainscope_wallet_auth').upsert(
      {
        uid: rec.uid,
        username: rec.username,
        username_lower: rec.usernameLower,
        display_name: rec.displayName,
        avatar_url: rec.avatarUrl,
        password_hash: rec.passwordHash,
        evm_address: rec.evmAddress,
        solana_address: rec.solanaAddress,
        csc_address: rec.cscAddress,
        linked_google_uid: rec.linkedGoogleUid,
        linked_google_email: rec.linkedGoogleEmail,
        created_at: new Date(rec.createdAt).toISOString(),
        updated_at: new Date(rec.updatedAt).toISOString(),
      },
      { onConflict: 'uid' }
    );
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase.from('chainscope_wallet_snapshots').upsert(
    {
      id: SNAPSHOT_AUTH_ID,
      wallet_id: 'wallet_auth_registry',
      label: 'ChainScope Wallet Auth Directory',
      evm_address: '',
      solana_address: '',
      total_usd: Object.keys(registry.byUid).length,
      chains: registry,
      scanned_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );
  if (error) throw new Error(error.message);
}

export async function resolveWalletAuthByUid(
  supabase: SupabaseClient,
  uid: string
): Promise<WalletAuthRecord | null> {
  const { registry } = await loadRegistry(supabase);
  return registry.byUid[uid] || null;
}

export async function resolveUnifiedUidForGoogle(
  supabase: SupabaseClient,
  googleUid: string
): Promise<WalletAuthRecord | null> {
  const { registry } = await loadRegistry(supabase);
  return (
    Object.values(registry.byUid).find((r) => r.linkedGoogleUid === googleUid) || null
  );
}

function validateUsername(raw: string): { ok: boolean; clean: string; error?: string } {
  const clean = raw.trim().replace(/^@/, '');
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(clean)) {
    return {
      ok: false,
      clean,
      error: 'Username must be 3–24 characters using only letters, numbers, or underscores.',
    };
  }
  const reserved = new Set(['admin', 'kingadmin', 'system', 'chainscope', 'support', 'root']);
  if (reserved.has(clean.toLowerCase())) {
    return { ok: false, clean, error: 'This username is reserved.' };
  }
  return { ok: true, clean };
}

function validateAvatarDataUrl(raw: unknown): string {
  const str = String(raw || '').trim();
  if (!str) return '';
  if (str.startsWith('preset:')) return str.slice(0, 32);
  if (
    /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(str) &&
    str.length <= 120_000
  ) {
    return str;
  }
  return '';
}

function toPublicWalletInfo(rec: WalletAuthRecord) {
  return {
    uid: rec.uid,
    username: rec.username,
    displayName: rec.displayName,
    avatarUrl: rec.avatarUrl,
    evmAddress: rec.evmAddress,
    solanaAddress: rec.solanaAddress,
    cscAddress: rec.cscAddress,
    linkedGoogleEmail: rec.linkedGoogleEmail,
    hasPassword: Boolean(rec.passwordHash),
    createdAt: rec.createdAt,
  };
}

export function registerWalletAuthRoutes(app: Express, deps: WalletAuthRouteDeps) {
  const { getSupabaseAdminClient, verifyFirebaseIdToken, requireAuth } = deps;

  // 1. Live Username Availability Check
  app.get('/api/db/wallet-auth/check-username', async (req, res) => {
    const supabase = getSupabaseAdminClient();
    const raw = String(req.query.username || '');
    const check = validateUsername(raw);
    if (!check.ok) {
      res.json({ available: false, username: check.clean, error: check.error });
      return;
    }
    if (!supabase) {
      res.status(503).json({ available: false, error: 'Supabase not configured.' });
      return;
    }

    try {
      const lower = check.clean.toLowerCase();
      const [{ registry }, usersRes] = await Promise.all([
        loadRegistry(supabase),
        supabase.from('chainscope_users').select('uid,handle').ilike('handle', lower),
      ]);

      const takenInAuth = Object.values(registry.byUid).some(
        (r) => r.usernameLower === lower
      );
      const takenInUsers = (usersRes.data || []).some(
        (u) => String(u.handle || '').toLowerCase() === lower
      );

      res.json({
        available: !takenInAuth && !takenInUsers,
        username: check.clean,
        error: takenInAuth || takenInUsers ? `@${check.clean} is already taken.` : undefined,
      });
    } catch (err) {
      res.status(500).json({
        available: false,
        error: err instanceof Error ? err.message : 'Unable to check username',
      });
    }
  });

  // 2. Register New Username + Password + Derived Wallet + Optional Avatar
  app.post('/api/db/wallet-auth/register', async (req, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase is not configured.' });
      return;
    }

    const body = (req.body || {}) as {
      username?: string;
      password?: string;
      displayName?: string;
      avatarUrl?: string;
      evmAddress?: string;
      solanaAddress?: string;
      cscAddress?: string;
    };

    const userCheck = validateUsername(String(body.username || ''));
    if (!userCheck.ok) {
      res.status(400).json({ error: userCheck.error });
      return;
    }
    const password = String(body.password || '');
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters.' });
      return;
    }

    const evmAddress = String(body.evmAddress || '').trim();
    const solanaAddress = String(body.solanaAddress || '').trim();
    const cscAddress = String(body.cscAddress || '').trim();
    if (!ethers.isAddress(evmAddress)) {
      res.status(400).json({ error: 'Valid derived EVM address is required.' });
      return;
    }
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solanaAddress)) {
      res.status(400).json({ error: 'Valid derived Solana address is required.' });
      return;
    }

    try {
      const result = await withAuthLock(async () => {
        const lower = userCheck.clean.toLowerCase();
        const [{ registry, mode }, usersRes] = await Promise.all([
          loadRegistry(supabase),
          supabase.from('chainscope_users').select('uid,handle').ilike('handle', lower),
        ]);

        const takenInAuth = Object.values(registry.byUid).some(
          (r) => r.usernameLower === lower
        );
        const takenInUsers = (usersRes.data || []).some(
          (u) => String(u.handle || '').toLowerCase() === lower
        );
        if (takenInAuth || takenInUsers) {
          throw new Error(`Username @${userCheck.clean} is already taken.`);
        }

        const now = Date.now();
        const nowIso = new Date(now).toISOString();
        const uid = `wallet_${crypto.randomBytes(10).toString('hex')}`;
        const displayName =
          String(body.displayName || '').trim().slice(0, 48) || userCheck.clean;
        const avatarUrl = validateAvatarDataUrl(body.avatarUrl);
        const passwordHash = hashPasswordScrypt(password);

        const rec: WalletAuthRecord = {
          uid,
          username: userCheck.clean,
          usernameLower: lower,
          displayName,
          avatarUrl,
          passwordHash,
          evmAddress: ethers.getAddress(evmAddress),
          solanaAddress,
          cscAddress: cscAddress || `CSC1${solanaAddress}`,
          linkedGoogleUid: '',
          linkedGoogleEmail: '',
          createdAt: now,
          updatedAt: now,
        };

        // Insert unified profile row into chainscope_users
        const { error: userInsErr } = await supabase.from('chainscope_users').insert({
          uid,
          email: '',
          handle: userCheck.clean,
          display_name: displayName,
          linked_wallet: rec.evmAddress,
          sol_balance: 10.0,
          created_at: nowIso,
          updated_at: nowIso,
        });
        if (userInsErr) {
          throw new Error(userInsErr.message);
        }

        await saveRecord(supabase, registry, mode, rec);
        const token = signWalletSessionToken(uid, userCheck.clean);
        return { token, walletAccount: toPublicWalletInfo(rec) };
      });

      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Unable to register wallet account',
      });
    }
  });

  // 3. Login with Username + Password
  app.post('/api/db/wallet-auth/login', async (req, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase is not configured.' });
      return;
    }

    const body = (req.body || {}) as { username?: string; password?: string };
    const clean = String(body.username || '').trim().replace(/^@/, '').toLowerCase();
    const password = String(body.password || '');

    if (!clean || !password) {
      res.status(400).json({ error: 'Enter your username and password.' });
      return;
    }

    try {
      const { registry } = await loadRegistry(supabase);
      const rec = Object.values(registry.byUid).find((r) => r.usernameLower === clean);
      if (!rec || !rec.passwordHash) {
        res.status(401).json({ error: 'Invalid username or password.' });
        return;
      }

      if (!verifyPasswordScrypt(password, rec.passwordHash)) {
        res.status(401).json({ error: 'Invalid username or password.' });
        return;
      }

      const token = signWalletSessionToken(rec.uid, rec.username);
      res.json({ token, walletAccount: toPublicWalletInfo(rec) });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Login failed',
      });
    }
  });

  // 4. Fetch Current Wallet Account Metadata (works for both Wallet & Google sessions)
  app.get(
    '/api/db/wallet-auth/me',
    requireAuth,
    async (
      req: Request & {
        authUser?: { uid: string; email: string; emailVerified: boolean; name: string };
      },
      res
    ) => {
      const supabase = getSupabaseAdminClient();
      if (!supabase) {
        res.status(503).json({ error: 'Supabase is not configured.' });
        return;
      }

      try {
        const rec = await resolveWalletAuthByUid(supabase, req.authUser!.uid);
        res.json({ walletAccount: rec ? toPublicWalletInfo(rec) : null });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Unable to load wallet account',
        });
      }
    }
  );

  // 5. Update Wallet Profile Photo, Display Name, or Claim Username (works for Google users too!)
  app.patch(
    '/api/db/wallet-auth/profile',
    requireAuth,
    async (
      req: Request & {
        authUser?: { uid: string; email: string; emailVerified: boolean; name: string };
      },
      res
    ) => {
      const supabase = getSupabaseAdminClient();
      if (!supabase) {
        res.status(503).json({ error: 'Supabase is not configured.' });
        return;
      }

      const body = (req.body || {}) as {
        displayName?: string;
        avatarUrl?: string;
        username?: string;
        evmAddress?: string;
        solanaAddress?: string;
        cscAddress?: string;
      };

      try {
        const updated = await withAuthLock(async () => {
          const { registry, mode } = await loadRegistry(supabase);
          const uid = req.authUser!.uid;
          const now = Date.now();

          let rec = registry.byUid[uid];
          if (!rec) {
            const { data: userRow } = await supabase
              .from('chainscope_users')
              .select('*')
              .eq('uid', uid)
              .maybeSingle();

            const fallbackHandle = String(userRow?.handle || req.authUser!.name || `user_${uid.slice(0, 6)}`)
              .replace(/[^a-zA-Z0-9_]/g, '_')
              .slice(0, 24);
            rec = {
              uid,
              username: fallbackHandle,
              usernameLower: fallbackHandle.toLowerCase(),
              displayName: String(userRow?.display_name || req.authUser!.name || fallbackHandle),
              avatarUrl: '',
              passwordHash: '',
              evmAddress: String(userRow?.linked_wallet || ''),
              solanaAddress: '',
              cscAddress: '',
              linkedGoogleUid: req.authUser!.email ? uid : '',
              linkedGoogleEmail: req.authUser!.email || '',
              createdAt: now,
              updatedAt: now,
            };
          }

          if (body.username && body.username.trim().toLowerCase() !== rec.usernameLower) {
            const check = validateUsername(body.username);
            if (!check.ok) throw new Error(check.error);
            const lower = check.clean.toLowerCase();
            const collision = Object.values(registry.byUid).some(
              (r) => r.uid !== uid && r.usernameLower === lower
            );
            if (collision) throw new Error(`@${check.clean} is already taken.`);
            rec.username = check.clean;
            rec.usernameLower = lower;
          }

          if (typeof body.displayName === 'string' && body.displayName.trim()) {
            rec.displayName = body.displayName.trim().slice(0, 48);
          }
          if (typeof body.avatarUrl === 'string') {
            rec.avatarUrl = validateAvatarDataUrl(body.avatarUrl);
          }
          if (body.evmAddress && ethers.isAddress(body.evmAddress)) {
            rec.evmAddress = ethers.getAddress(body.evmAddress);
          }
          if (body.solanaAddress) rec.solanaAddress = body.solanaAddress.trim();
          if (body.cscAddress) rec.cscAddress = body.cscAddress.trim();
          rec.updatedAt = now;

          await supabase
            .from('chainscope_users')
            .update({
              handle: rec.username,
              display_name: rec.displayName,
              linked_wallet: rec.evmAddress || undefined,
              updated_at: new Date(now).toISOString(),
            })
            .eq('uid', uid);

          await saveRecord(supabase, registry, mode, rec);
          return toPublicWalletInfo(rec);
        });

        res.json({ walletAccount: updated });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Unable to update wallet profile',
        });
      }
    }
  );

  // 6. Connect Optional Google Account to Existing Wallet Account
  app.post(
    '/api/db/wallet-auth/link-google',
    requireAuth,
    async (
      req: Request & {
        authUser?: { uid: string; email: string; emailVerified: boolean; name: string };
      },
      res
    ) => {
      const supabase = getSupabaseAdminClient();
      if (!supabase) {
        res.status(503).json({ error: 'Supabase is not configured.' });
        return;
      }
      const googleIdToken = String((req.body as { googleIdToken?: string } | undefined)?.googleIdToken || '').trim();
      if (!googleIdToken) {
        res.status(400).json({ error: 'Google ID token is required.' });
        return;
      }

      try {
        const googleUser = await verifyFirebaseIdToken(googleIdToken);
        const updated = await withAuthLock(async () => {
          const { registry, mode } = await loadRegistry(supabase);
          const rec = registry.byUid[req.authUser!.uid];
          if (!rec) {
            throw new Error('Wallet account not found.');
          }

          const conflict = Object.values(registry.byUid).find(
            (r) => r.uid !== rec.uid && r.linkedGoogleUid === googleUser.uid
          );
          if (conflict) {
            throw new Error(
              `Google account ${googleUser.email} is already linked to @${conflict.username}.`
            );
          }

          rec.linkedGoogleUid = googleUser.uid;
          rec.linkedGoogleEmail = googleUser.email;
          rec.updatedAt = Date.now();

          await supabase
            .from('chainscope_users')
            .update({
              email: googleUser.email,
              updated_at: new Date(rec.updatedAt).toISOString(),
            })
            .eq('uid', rec.uid);

          await saveRecord(supabase, registry, mode, rec);
          return toPublicWalletInfo(rec);
        });

        res.json({ walletAccount: updated });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Unable to link Google account',
        });
      }
    }
  );

  // 7. Unlink Google Account (requires password set so user is never locked out)
  app.post(
    '/api/db/wallet-auth/unlink-google',
    requireAuth,
    async (
      req: Request & {
        authUser?: { uid: string; email: string; emailVerified: boolean; name: string };
      },
      res
    ) => {
      const supabase = getSupabaseAdminClient();
      if (!supabase) {
        res.status(503).json({ error: 'Supabase is not configured.' });
        return;
      }

      try {
        const updated = await withAuthLock(async () => {
          const { registry, mode } = await loadRegistry(supabase);
          const rec = registry.byUid[req.authUser!.uid];
          if (!rec) throw new Error('Wallet account not found.');
          if (!rec.passwordHash) {
            throw new Error('Set a wallet password before disconnecting Google.');
          }
          rec.linkedGoogleUid = '';
          rec.linkedGoogleEmail = '';
          rec.updatedAt = Date.now();
          await saveRecord(supabase, registry, mode, rec);
          return toPublicWalletInfo(rec);
        });
        res.json({ walletAccount: updated });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Unable to disconnect Google account',
        });
      }
    }
  );

  // 8. Change or Set Wallet Password
  app.post(
    '/api/db/wallet-auth/change-password',
    requireAuth,
    async (
      req: Request & {
        authUser?: { uid: string; email: string; emailVerified: boolean; name: string };
      },
      res
    ) => {
      const supabase = getSupabaseAdminClient();
      if (!supabase) {
        res.status(503).json({ error: 'Supabase is not configured.' });
        return;
      }

      const body = (req.body || {}) as { currentPassword?: string; newPassword?: string };
      const newPassword = String(body.newPassword || '');
      if (newPassword.length < 8) {
        res.status(400).json({ error: 'New password must be at least 8 characters.' });
        return;
      }

      try {
        await withAuthLock(async () => {
          const { registry, mode } = await loadRegistry(supabase);
          const rec = registry.byUid[req.authUser!.uid];
          if (!rec) throw new Error('Wallet account not found.');
          if (rec.passwordHash && !verifyPasswordScrypt(String(body.currentPassword || ''), rec.passwordHash)) {
            throw new Error('Current password is incorrect.');
          }
          rec.passwordHash = hashPasswordScrypt(newPassword);
          rec.updatedAt = Date.now();
          await saveRecord(supabase, registry, mode, rec);
        });
        res.json({ ok: true });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Unable to update password',
        });
      }
    }
  );
}
