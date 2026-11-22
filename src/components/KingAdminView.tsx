import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Coins,
  Crown,
  Database,
  Eye,
  FileText,
  Fuel,
  LayoutDashboard,
  Loader2,
  LogIn,
  LogOut,
  Pencil,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Users,
  Vault,
  X,
} from 'lucide-react';
import { BOOTSTRAPPED_ADMIN_EMAIL, useAuth } from '../context/AuthContext';
import type {
  AdminAuditLog,
  AdminRecord,
  AdminWallet,
  CoinComment,
  CoinTrade,
  EmergencyFund,
  MemeCoin,
  UserProfile,
} from '../types/launchpad';
import {
  adminAdjustUserBalance,
  adminDeleteCoinComment,
  adminDeleteMemeCoin,
  adminGrantAdminRole,
  adminRevokeAdminRole,
  adminUpdateMemeCoin,
  adminUpdateUserProfile,
  fetchAdminState,
} from '../services/admin';
import { fetchCoinDetail } from '../services/launchpad';
import { formatCompactTokens, getBondingProgressPct } from '../utils/bondingCurve';
import { formatTimestamp, formatUsd, truncateAddress } from '../utils/chains';
import { CoinEmblem } from './CoinEmblem';
import {
  AdminWalletsPanel,
  EmergencyFundsPanel,
  GasEconomicsPanel,
} from './KingAdminVaults';
import { KingAdminSupabase } from './KingAdminSupabase';

interface KingAdminViewProps {
  onNavigateApp: () => void;
}

type AdminSection =
  | 'overview'
  | 'users'
  | 'coins'
  | 'wallets'
  | 'emergency'
  | 'economics'
  | 'supabase'
  | 'access'
  | 'audit';

function toMillis(ts: unknown): number {
  if (!ts) return Date.now();
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'object' && ts !== null && 'toMillis' in ts) {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

export function KingAdminView({ onNavigateApp }: KingAdminViewProps) {
  const {
    user,
    authReady,
    profile,
    economics,
    isAdmin,
    adminChecking,
    authError,
    dbError,
    signInWithGoogle,
    signOutUser,
    refreshAccount,
  } = useAuth();

  const [section, setSection] = useState<AdminSection>('overview');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [coins, setCoins] = useState<MemeCoin[]>([]);
  const [adminWallets, setAdminWallets] = useState<AdminWallet[]>([]);
  const [emergencyFunds, setEmergencyFunds] = useState<EmergencyFund[]>([]);
  const [adminRecords, setAdminRecords] = useState<AdminRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [solUsdPrice, setSolUsdPrice] = useState(0);
  const [adminLoadError, setAdminLoadError] = useState<string | null>(null);

  // Filters
  const [userSearch, setUserSearch] = useState('');
  const [coinSearch, setCoinSearch] = useState('');
  const [auditSearch, setAuditSearch] = useState('');

  // Action feedback
  const [bannerMsg, setBannerMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // User balance / profile modal
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [newSolBalance, setNewSolBalance] = useState('');
  const [adjustReason, setAdjustReason] = useState('Admin liquidity grant');
  const [editUserHandle, setEditUserHandle] = useState('');
  const [editUserName, setEditUserName] = useState('');
  const [editUserWallet, setEditUserWallet] = useState('');
  const [userActionBusy, setUserActionBusy] = useState(false);

  // Coin edit / inspect modal
  const [editingCoin, setEditingCoin] = useState<MemeCoin | null>(null);
  const [editCoinDesc, setEditCoinDesc] = useState('');
  const [editCoinWeb, setEditCoinWeb] = useState('');
  const [editCoinTw, setEditCoinTw] = useState('');
  const [editCoinGrad, setEditCoinGrad] = useState(false);
  const [coinActionBusy, setCoinActionBusy] = useState(false);

  const [inspectCoin, setInspectCoin] = useState<MemeCoin | null>(null);
  const [inspectTrades, setInspectTrades] = useState<CoinTrade[]>([]);
  const [inspectComments, setInspectComments] = useState<CoinComment[]>([]);

  // Grant admin form
  const [grantUid, setGrantUid] = useState('');
  const [grantHandle, setGrantHandle] = useState('');
  const [grantRole, setGrantRole] = useState<'superadmin' | 'moderator'>('moderator');
  const [grantBusy, setGrantBusy] = useState(false);

  const actorInfo = useMemo(
    () => ({
      uid: user?.uid || '',
      handle: profile?.handle || user?.email?.split('@')[0] || 'kingadmin',
    }),
    [user, profile]
  );

  useEffect(() => {
    fetch('/api/prices')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { prices?: { solana?: { usd?: number } } } | null) => {
        if (typeof data?.prices?.solana?.usd === 'number') {
          setSolUsdPrice(data.prices.solana.usd);
        }
      })
      .catch(() => {});
  }, []);

  const refreshAdmin = useCallback(async () => {
    if (!authReady || !user || !isAdmin) return;
    try {
      const data = await fetchAdminState();
      setUsers(data.users);
      setCoins(data.coins);
      setAdminWallets(data.adminWallets);
      setEmergencyFunds(data.emergencyFunds);
      setAdminRecords(data.adminRecords);
      setAuditLogs(data.auditLogs);
      setAdminLoadError(null);
      void refreshAccount();
    } catch (err) {
      setAdminLoadError(
        err instanceof Error ? err.message : 'Unable to load KingAdmin data from Supabase'
      );
    }
  }, [authReady, user, isAdmin, refreshAccount]);

  const refreshInspectCoin = useCallback(
    async (coinId: string) => {
      if (!authReady || !user || !isAdmin) return;
      try {
        const detail = await fetchCoinDetail(coinId);
        setInspectTrades(detail.trades);
        setInspectComments(detail.comments);
      } catch {
        // Ignore transient inspect error
      }
    },
    [authReady, user, isAdmin]
  );

  // Load and poll all admin state from Supabase ONLY when verified admin
  useEffect(() => {
    if (!authReady || !user || !isAdmin) return;
    void refreshAdmin();
    const timer = window.setInterval(() => {
      void refreshAdmin();
    }, 6000);
    return () => window.clearInterval(timer);
  }, [authReady, user, isAdmin, refreshAdmin]);

  // Inspect selected coin's trades & comments from Supabase
  useEffect(() => {
    if (!authReady || !user || !isAdmin || !inspectCoin) {
      setInspectTrades([]);
      setInspectComments([]);
      return;
    }
    void refreshInspectCoin(inspectCoin.id);
    const timer = window.setInterval(() => {
      void refreshInspectCoin(inspectCoin.id);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [authReady, user, isAdmin, inspectCoin, refreshInspectCoin]);

  const metrics = useMemo(() => {
    const totalSolVolume = coins.reduce((s, c) => s + c.volumeSol, 0);
    const totalSolLiquidity = users.reduce((s, u) => s + u.solBalance, 0);
    const graduatedCount = coins.filter((c) => c.graduated).length;
    const totalTrades = coins.reduce((s, c) => s + c.tradeCount, 0);
    const totalTreasurySol = adminWallets.reduce((s, w) => s + w.treasurySol, 0);
    const emergencyRemainingSol = emergencyFunds.reduce(
      (s, f) => s + Math.max(0, f.allocatedSol - f.disbursedSol),
      0
    );
    return {
      totalSolVolume,
      totalSolLiquidity,
      graduatedCount,
      totalTrades,
      totalTreasurySol,
      emergencyRemainingSol,
    };
  }, [coins, users, adminWallets, emergencyFunds]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.handle.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q) ||
        u.uid.toLowerCase().includes(q) ||
        u.linkedWallet.toLowerCase().includes(q)
    );
  }, [users, userSearch]);

  const filteredCoins = useMemo(() => {
    const q = coinSearch.trim().toLowerCase();
    if (!q) return coins;
    return coins.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.ticker.toLowerCase().includes(q) ||
        c.creatorHandle.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
    );
  }, [coins, coinSearch]);

  const filteredAudit = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter(
      (l) =>
        l.action.toLowerCase().includes(q) ||
        l.actorHandle.toLowerCase().includes(q) ||
        l.details.toLowerCase().includes(q) ||
        l.targetId.toLowerCase().includes(q)
    );
  }, [auditLogs, auditSearch]);

  const openUserModal = (u: UserProfile) => {
    setEditingUser(u);
    setNewSolBalance(String(u.solBalance));
    setAdjustReason('Admin balance adjustment');
    setEditUserHandle(u.handle);
    setEditUserName(u.displayName);
    setEditUserWallet(u.linkedWallet || '');
  };

  const handleSaveUserBalance = async () => {
    if (!editingUser) return;
    setUserActionBusy(true);
    try {
      await adminAdjustUserBalance(
        actorInfo,
        editingUser.uid,
        editingUser.handle,
        Number(newSolBalance),
        adjustReason
      );
      await refreshAdmin();
      setBannerMsg({
        type: 'ok',
        text: `Updated @${editingUser.handle} balance to ${Number(newSolBalance).toFixed(4)} SOL.`,
      });
      setEditingUser(null);
    } catch (err) {
      setBannerMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to adjust balance',
      });
    } finally {
      setUserActionBusy(false);
    }
  };

  const handleSaveUserProfile = async () => {
    if (!editingUser) return;
    setUserActionBusy(true);
    try {
      await adminUpdateUserProfile(actorInfo, editingUser.uid, {
        handle: editUserHandle,
        displayName: editUserName,
        linkedWallet: editUserWallet,
      });
      await refreshAdmin();
      setBannerMsg({ type: 'ok', text: `Updated profile for @${editUserHandle}.` });
      setEditingUser(null);
    } catch (err) {
      setBannerMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to update user profile',
      });
    } finally {
      setUserActionBusy(false);
    }
  };

  const openCoinModal = (c: MemeCoin) => {
    setEditingCoin(c);
    setEditCoinDesc(c.description);
    setEditCoinWeb(c.website || '');
    setEditCoinTw(c.twitter || '');
    setEditCoinGrad(c.graduated);
  };

  const handleSaveCoin = async () => {
    if (!editingCoin) return;
    setCoinActionBusy(true);
    try {
      await adminUpdateMemeCoin(actorInfo, editingCoin, {
        description: editCoinDesc,
        website: editCoinWeb,
        twitter: editCoinTw,
        graduated: editCoinGrad,
      });
      await refreshAdmin();
      setBannerMsg({ type: 'ok', text: `Updated $${editingCoin.ticker} settings.` });
      setEditingCoin(null);
    } catch (err) {
      setBannerMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to update coin',
      });
    } finally {
      setCoinActionBusy(false);
    }
  };

  const handleDeleteCoin = async (coin: MemeCoin) => {
    try {
      await adminDeleteMemeCoin(actorInfo, coin);
      await refreshAdmin();
      setBannerMsg({ type: 'ok', text: `Removed ${coin.name} ($${coin.ticker}).` });
      if (inspectCoin?.id === coin.id) setInspectCoin(null);
    } catch (err) {
      setBannerMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to remove coin',
      });
    }
  };

  const handleGrantAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setGrantBusy(true);
    try {
      await adminGrantAdminRole(actorInfo, grantUid, grantHandle, grantRole);
      await refreshAdmin();
      setBannerMsg({ type: 'ok', text: `Granted ${grantRole} role to ${grantUid}.` });
      setGrantUid('');
      setGrantHandle('');
    } catch (err) {
      setBannerMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to grant admin role',
      });
    } finally {
      setGrantBusy(false);
    }
  };

  const handleRevokeAdmin = async (rec: AdminRecord) => {
    try {
      await adminRevokeAdminRole(actorInfo, rec.uid, rec.handle);
      await refreshAdmin();
      setBannerMsg({ type: 'ok', text: `Revoked admin privileges from @${rec.handle}.` });
    } catch (err) {
      setBannerMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to revoke role',
      });
    }
  };

  // --- Loading Auth ---
  if (!authReady || adminChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0B0F17] text-slate-600 dark:text-slate-300 text-xs">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Verifying KingAdmin authorization…
      </div>
    );
  }

  // --- Unauthenticated Gate ---
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0B0F17] p-6">
        <div className="max-w-md w-full p-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-center space-y-5">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center mx-auto">
            <Crown className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-mono text-slate-500 dark:text-slate-400">/kingadmin</div>
            <h1 className="text-xl font-display font-bold text-slate-900 dark:text-slate-100 mt-1">
              KingAdmin Control Panel
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
              Sign in with an authorized administrator Google account to manage Hot/Cold vaults,
              Emergency Funds, Gas Economics, traders, and bonding-curve coins.
            </p>
          </div>
          {authError && (
            <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-600 dark:text-red-400">
              {authError}
            </div>
          )}
          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center justify-center gap-2 transition-colors"
            >
              <LogIn className="w-4 h-4" />
              Sign In with Google
            </button>
            <button
              type="button"
              onClick={onNavigateApp}
              className="w-full py-2 px-4 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors"
            >
              Return to ChainScope (/)
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Unauthorized Non-Admin Gate ---
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0B0F17] p-6">
        <div className="max-w-md w-full p-8 rounded-xl border border-red-500/30 bg-white dark:bg-[#111827] text-center space-y-5">
          <div className="w-12 h-12 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-mono text-red-500">403 · Access Restricted</div>
            <h1 className="text-xl font-display font-bold text-slate-900 dark:text-slate-100 mt-1">
              Administrator Privileges Required
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
              Your account ({user.email}) does not currently hold a KingAdmin role grant. Ask a
              superadmin to grant access to your UID below.
            </p>
          </div>
          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-[11px] font-mono text-slate-700 dark:text-slate-300 break-all">
            UID: {user.uid}
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onNavigateApp}
              className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors"
            >
              Return to ChainScope (/)
            </button>
            <button
              type="button"
              onClick={() => void signOutUser()}
              className="w-full py-2 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Switch Account
            </button>
          </div>
        </div>
      </div>
    );
  }

  const navItems: Array<{ id: AdminSection; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'wallets', label: `Hot & Cold Wallets (${adminWallets.length})`, icon: Vault },
    { id: 'emergency', label: `Emergency Funds (${emergencyFunds.length})`, icon: AlertTriangle },
    { id: 'economics', label: 'Gas & Economics', icon: Fuel },
    { id: 'supabase', label: 'Supabase SQL', icon: Database },
    { id: 'users', label: `Traders (${users.length})`, icon: Users },
    { id: 'coins', label: `Meme Coins (${coins.length})`, icon: Coins },
    { id: 'access', label: 'Admin Access', icon: ShieldCheck },
    { id: 'audit', label: 'Audit Trail', icon: FileText },
  ];

  const sectionTitle = navItems.find((n) => n.id === section)?.label.split(' (')[0] || 'Overview';

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100">
      {/* Left Admin Sidebar */}
      <aside className="w-[248px] shrink-0 bg-white dark:bg-[#0F1521] border-r border-slate-200 dark:border-slate-800 flex flex-col">
        <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-lg bg-amber-500 flex items-center justify-center text-slate-950 shrink-0">
              <Crown className="w-4 h-4" />
            </span>
            <span className="font-display text-base font-bold tracking-tight whitespace-nowrap">
              KingAdmin
            </span>
          </div>
        </div>

        <nav className="p-3 space-y-1 flex-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-2 text-[11px] text-slate-500 dark:text-slate-400">
          <div className="font-medium text-slate-700 dark:text-slate-300 truncate">
            {user.email}
          </div>
          <div className="font-mono truncate">Route: /kingadmin</div>
        </div>
      </aside>

      {/* Main Admin Workspace */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 px-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F1521] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <span className="font-semibold">KingAdmin</span>
            <span className="text-slate-400" aria-hidden="true">
              /
            </span>
            <span className="text-slate-500 dark:text-slate-400 truncate">{sectionTitle}</span>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onNavigateApp}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium whitespace-nowrap transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to App
            </button>
            <button
              type="button"
              onClick={() => void signOutUser()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white text-xs font-medium whitespace-nowrap transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 max-w-[1440px] w-full mx-auto space-y-6">
          {(dbError || adminLoadError) && (
            <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{adminLoadError || dbError}</span>
              </div>
              {section !== 'supabase' && (
                <button
                  type="button"
                  onClick={() => setSection('supabase')}
                  className="px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 font-medium whitespace-nowrap"
                >
                  Open Supabase SQL
                </button>
              )}
            </div>
          )}

          {bannerMsg && (
            <div
              className={`p-3.5 rounded-xl border text-xs flex items-center justify-between gap-3 ${
                bannerMsg.type === 'ok'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
              }`}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{bannerMsg.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setBannerMsg(null)}
                className="p-1 rounded hover:bg-black/10"
                aria-label="Dismiss notification"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* OVERVIEW */}
          {section === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Registered Accounts
                  </div>
                  <div className="mt-2 text-2xl font-display font-bold tabular-nums">
                    {users.length}
                  </div>
                  <div className="mt-1 text-xs text-slate-500 tabular-nums">
                    {metrics.totalSolLiquidity.toFixed(2)} SOL total user liquidity
                  </div>
                </div>

                <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Admin Vault Treasury
                  </div>
                  <div className="mt-2 text-2xl font-display font-bold tabular-nums">
                    {metrics.totalTreasurySol.toFixed(2)} SOL
                  </div>
                  <div className="mt-1 text-xs text-slate-500 tabular-nums">
                    {adminWallets.length} hot/cold wallets ·{' '}
                    {metrics.emergencyRemainingSol.toFixed(1)} SOL emergency
                  </div>
                </div>

                <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Launched Meme Coins
                  </div>
                  <div className="mt-2 text-2xl font-display font-bold tabular-nums">
                    {coins.length}
                  </div>
                  <div className="mt-1 text-xs text-slate-500 tabular-nums">
                    {metrics.graduatedCount} graduated · {metrics.totalSolVolume.toFixed(2)} SOL vol
                  </div>
                </div>

                <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Live Gas & Fee Schedule
                  </div>
                  <div className="mt-2 text-2xl font-display font-bold tabular-nums">
                    {((economics.protocolFeeBps + economics.holderRewardBps + economics.creatorFeeBps) / 100).toFixed(2)}%
                  </div>
                  <div className="mt-1 text-xs text-slate-500 tabular-nums">
                    Base gas {economics.baseGasSol} SOL · {economics.congestionMultiplier}x mult
                    {solUsdPrice > 0 && ` · SOL ${formatUsd(solUsdPrice)}`}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
                  <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">Recent Meme Coin Launches</h2>
                    <button
                      type="button"
                      onClick={() => setSection('coins')}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Manage All
                    </button>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                    {coins.slice(0, 6).map((c) => (
                      <div key={c.id} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <CoinEmblem icon={c.emblemIcon} color={c.emblemColor} size="sm" />
                          <div className="min-w-0">
                            <div className="font-semibold truncate">
                              {c.name}{' '}
                              <span className="font-mono text-blue-500">${c.ticker}</span>
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">
                              @{c.creatorHandle} · {c.tradeCount} trades
                            </div>
                          </div>
                        </div>
                        <div className="text-right font-mono tabular-nums shrink-0">
                          <div className="font-semibold">{c.marketCapSol.toFixed(2)} SOL</div>
                          <div className="text-[11px] text-slate-500">
                            {getBondingProgressPct(c.realSol, c.mode || 'standard').toFixed(1)}%
                            curve
                          </div>
                        </div>
                      </div>
                    ))}
                    {coins.length === 0 && (
                      <div className="py-8 text-center text-slate-500">
                        No meme coins launched yet.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
                  <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">Recent Admin Audit Trail</h2>
                    <button
                      type="button"
                      onClick={() => setSection('audit')}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      View Full Log
                    </button>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                    {auditLogs.slice(0, 6).map((log) => (
                      <div key={log.id} className="px-4 py-3 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">
                            {log.action}
                          </span>
                          <span className="text-[11px] text-slate-500 tabular-nums">
                            {formatTimestamp(toMillis(log.createdAt))}
                          </span>
                        </div>
                        <div className="text-slate-600 dark:text-slate-300">{log.details}</div>
                      </div>
                    ))}
                    {auditLogs.length === 0 && (
                      <div className="py-8 text-center text-slate-500">
                        No admin actions recorded yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* HOT & COLD WALLETS */}
          {section === 'wallets' && (
            <AdminWalletsPanel
              actor={actorInfo}
              adminWallets={adminWallets}
              users={users}
              onBanner={setBannerMsg}
              onMutated={refreshAdmin}
            />
          )}

          {/* EMERGENCY FUNDS */}
          {section === 'emergency' && (
            <EmergencyFundsPanel
              actor={actorInfo}
              emergencyFunds={emergencyFunds}
              adminWallets={adminWallets}
              users={users}
              coins={coins}
              onBanner={setBannerMsg}
              onMutated={refreshAdmin}
            />
          )}

          {/* GAS & ECONOMICS */}
          {section === 'economics' && (
            <GasEconomicsPanel
              actor={actorInfo}
              economics={economics}
              onBanner={setBannerMsg}
              onMutated={refreshAdmin}
            />
          )}

          {/* SUPABASE POSTGRESQL SYNC */}
          {section === 'supabase' && (
            <KingAdminSupabase
              users={users}
              coins={coins}
              adminWallets={adminWallets}
              emergencyFunds={emergencyFunds}
              economics={economics}
              onBanner={setBannerMsg}
              onRefresh={refreshAdmin}
            />
          )}

          {/* TRADERS & BALANCES */}
          {section === 'users' && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
              <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Registered Traders & Balances</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Inspect trader profiles, edit handles, or adjust bonding-curve SOL liquidity.
                  </p>
                </div>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search @handle, UID, wallet…"
                    className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] w-60"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                      <th className="py-3 px-4">Trader</th>
                      <th className="py-3 px-4">UID</th>
                      <th className="py-3 px-4">Linked Wallet</th>
                      <th className="py-3 px-4 text-right">SOL Balance</th>
                      <th className="py-3 px-4 text-right">Joined</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {filteredUsers.map((u) => (
                      <tr key={u.uid} className="h-11 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2.5">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            @{u.handle}
                          </div>
                          <div className="text-[11px] text-slate-500">{u.displayName}</div>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-500">
                          {truncateAddress(u.uid, 8, 5)}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-600 dark:text-slate-300">
                          {u.linkedWallet ? truncateAddress(u.linkedWallet, 6, 4) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">
                          {u.solBalance.toFixed(4)} SOL
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                          {formatTimestamp(toMillis(u.createdAt))}
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openUserModal(u)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium transition-colors"
                          >
                            <SlidersHorizontal className="w-3 h-3" />
                            Manage
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* MEME COINS MODERATION */}
          {section === 'coins' && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
              <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Meme Coins & Bonding Curves</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Edit token metadata, override graduation state, inspect trades/comments, or
                    remove spam launches.
                  </p>
                </div>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={coinSearch}
                    onChange={(e) => setCoinSearch(e.target.value)}
                    placeholder="Search coin, $TICKER, @creator…"
                    className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] w-60"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                      <th className="py-3 px-4">Token</th>
                      <th className="py-3 px-4">Creator</th>
                      <th className="py-3 px-4">Mode</th>
                      <th className="py-3 px-4 text-right">MCap (SOL)</th>
                      <th className="py-3 px-4 text-right">Volume</th>
                      <th className="py-3 px-4 text-right">Curve</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {filteredCoins.map((c) => (
                      <tr key={c.id} className="h-12 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2.5">
                            <CoinEmblem icon={c.emblemIcon} color={c.emblemColor} size="sm" />
                            <div>
                              <div className="font-semibold">
                                {c.name}{' '}
                                <span className="font-mono text-blue-500">${c.ticker}</span>
                              </div>
                              <div className="text-[11px] text-slate-500 truncate max-w-[200px]">
                                {c.description}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-slate-700 dark:text-slate-300">
                          @{c.creatorHandle}
                        </td>
                        <td className="px-4 py-2 capitalize">
                          {c.mode === 'mayhem' ? (
                            <span className="text-orange-500 font-semibold">Mayhem</span>
                          ) : (
                            'Standard'
                          )}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums font-semibold">
                          {c.marketCapSol.toFixed(2)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">
                          {c.volumeSol.toFixed(2)} SOL
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">
                          {c.graduated ? (
                            <span className="text-emerald-500 font-semibold">Graduated</span>
                          ) : (
                            <span>
                              {getBondingProgressPct(c.realSol, c.mode || 'standard').toFixed(1)}%
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setInspectCoin(c)}
                              className="p-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                              title="Inspect trades & comments"
                              aria-label={`Inspect ${c.name}`}
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => openCoinModal(c)}
                              className="p-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                              title="Edit coin"
                              aria-label={`Edit ${c.name}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteCoin(c)}
                              className="p-1.5 rounded border border-red-500/30 text-red-500 hover:bg-red-500/10"
                              title="Delete coin"
                              aria-label={`Delete ${c.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ADMIN ACCESS CONTROL */}
          {section === 'access' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              <div className="lg:col-span-5 p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
                <div>
                  <h2 className="text-sm font-semibold">Grant KingAdmin Role</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Delegate superadmin or moderator access to another verified user UID.
                  </p>
                </div>

                <form onSubmit={handleGrantAdmin} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Quick-Pick Registered User
                    </label>
                    <select
                      value=""
                      onChange={(e) => {
                        const chosen = users.find((u) => u.uid === e.target.value);
                        if (chosen) {
                          setGrantUid(chosen.uid);
                          setGrantHandle(chosen.handle);
                        }
                      }}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
                    >
                      <option value="">Select user from directory…</option>
                      {users.map((u) => (
                        <option key={u.uid} value={u.uid}>
                          @{u.handle} ({truncateAddress(u.uid, 6, 4)})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Target Firebase UID
                    </label>
                    <input
                      type="text"
                      required
                      value={grantUid}
                      onChange={(e) => setGrantUid(e.target.value)}
                      placeholder="User UID"
                      className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Handle Label
                      </label>
                      <input
                        type="text"
                        required
                        minLength={2}
                        value={grantHandle}
                        onChange={(e) => setGrantHandle(e.target.value)}
                        placeholder="handle"
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Role
                      </label>
                      <select
                        value={grantRole}
                        onChange={(e) =>
                          setGrantRole(e.target.value as 'superadmin' | 'moderator')
                        }
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
                      >
                        <option value="moderator">Moderator</option>
                        <option value="superadmin">Superadmin</option>
                      </select>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={grantBusy}
                    className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium transition-colors"
                  >
                    {grantBusy ? 'Granting…' : 'Grant Admin Role'}
                  </button>
                </form>
              </div>

              <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
                <div className="p-4 border-b border-slate-200 dark:border-slate-800">
                  <h2 className="text-sm font-semibold">Active Administrators</h2>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  <div className="px-4 py-3.5 flex items-center justify-between gap-3 bg-amber-500/5">
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {BOOTSTRAPPED_ADMIN_EMAIL}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Bootstrapped Superadmin · Verified Email Policy
                      </div>
                    </div>
                    <span className="font-mono text-amber-600 dark:text-amber-400 font-semibold">
                      Root Admin
                    </span>
                  </div>

                  {adminRecords.map((rec) => (
                    <div key={rec.uid} className="px-4 py-3.5 flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold">
                          @{rec.handle}{' '}
                          <span className="font-mono text-[11px] text-slate-500">
                            ({truncateAddress(rec.uid, 8, 5)})
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 capitalize">
                          Role: {rec.role} · Added {formatTimestamp(toMillis(rec.createdAt))}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleRevokeAdmin(rec)}
                        disabled={rec.uid === user.uid}
                        className="px-2.5 py-1.5 rounded border border-red-500/30 text-red-500 hover:bg-red-500/10 disabled:opacity-40 text-xs font-medium"
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* AUDIT TRAIL */}
          {section === 'audit' && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
              <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Immutable Admin Audit Trail</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Append-only log of every vault assignment, emergency disbursement, balance
                    change, and RBAC grant.
                  </p>
                </div>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    placeholder="Filter action, actor, target…"
                    className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] w-60"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                      <th className="py-3 px-4">Action</th>
                      <th className="py-3 px-4">Actor</th>
                      <th className="py-3 px-4">Target</th>
                      <th className="py-3 px-4">Details</th>
                      <th className="py-3 px-4 text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {filteredAudit.map((l) => (
                      <tr key={l.id} className="h-11 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2 font-mono font-semibold text-blue-600 dark:text-blue-400 whitespace-nowrap">
                          {l.action}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">@{l.actorHandle}</td>
                        <td className="px-4 py-2 font-mono text-slate-500 whitespace-nowrap">
                          {truncateAddress(l.targetId, 8, 6)}
                        </td>
                        <td className="px-4 py-2 text-slate-700 dark:text-slate-300">{l.details}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-500 whitespace-nowrap">
                          {formatTimestamp(toMillis(l.createdAt))}
                        </td>
                      </tr>
                    ))}
                    {filteredAudit.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-10 text-center text-slate-500">
                          No audit entries match your search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* MODAL: MANAGE USER BALANCE & PROFILE */}
      {editingUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Manage @{editingUser.handle}</h3>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] space-y-3">
              <div className="text-xs font-semibold">SOL Liquidity Adjustment</div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="any"
                  min="0"
                  max="1000000"
                  value={newSolBalance}
                  onChange={(e) => setNewSolBalance(e.target.value)}
                  className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                />
                <button
                  type="button"
                  onClick={() =>
                    setNewSolBalance(String(Number(newSolBalance || 0) + 50))
                  }
                  className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-mono"
                >
                  +50
                </button>
              </div>
              <input
                type="text"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="Audit reason"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
              />
              <button
                type="button"
                onClick={handleSaveUserBalance}
                disabled={userActionBusy}
                className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium"
              >
                Apply SOL Balance
              </button>
            </div>

            <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="text-xs font-semibold">Profile Metadata</div>
              <input
                type="text"
                value={editUserHandle}
                onChange={(e) => setEditUserHandle(e.target.value)}
                placeholder="Handle"
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
              />
              <input
                type="text"
                value={editUserName}
                onChange={(e) => setEditUserName(e.target.value)}
                placeholder="Display Name"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
              />
              <input
                type="text"
                value={editUserWallet}
                onChange={(e) => setEditUserWallet(e.target.value)}
                placeholder="Linked Public Wallet"
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
              />
              <button
                type="button"
                onClick={handleSaveUserProfile}
                disabled={userActionBusy}
                className="w-full py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
              >
                Save Profile Metadata
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EDIT MEME COIN */}
      {editingCoin && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">
                Edit {editingCoin.name} (${editingCoin.ticker})
              </h3>
              <button
                type="button"
                onClick={() => setEditingCoin(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Description</label>
                <textarea
                  rows={3}
                  maxLength={280}
                  value={editCoinDesc}
                  onChange={(e) => setEditCoinDesc(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Website</label>
                <input
                  type="text"
                  value={editCoinWeb}
                  onChange={(e) => setEditCoinWeb(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">X / Twitter</label>
                <input
                  type="text"
                  value={editCoinTw}
                  onChange={(e) => setEditCoinTw(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
                />
              </div>
              <label className="inline-flex items-center gap-2 text-xs cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={editCoinGrad}
                  onChange={(e) => setEditCoinGrad(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                Mark as Graduated (DEX Milestone)
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingCoin(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCoin}
                disabled={coinActionBusy}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium"
              >
                {coinActionBusy ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: INSPECT COIN TRADES & MODERATE COMMENTS */}
      {inspectCoin && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <CoinEmblem
                  icon={inspectCoin.emblemIcon}
                  color={inspectCoin.emblemColor}
                  size="sm"
                />
                <h3 className="text-base font-semibold">
                  Inspect {inspectCoin.name} (${inspectCoin.ticker})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectCoin(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <div className="text-xs font-semibold mb-2">
                Recent Bonding-Curve Swaps ({inspectTrades.length})
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-[11px] text-slate-500">
                      <th className="py-2 px-3">Trader</th>
                      <th className="py-2 px-3">Side</th>
                      <th className="py-2 px-3 text-right">SOL</th>
                      <th className="py-2 px-3 text-right">Tokens</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {inspectTrades.map((t) => (
                      <tr key={t.id}>
                        <td className="py-2 px-3">@{t.traderHandle}</td>
                        <td
                          className={`py-2 px-3 font-semibold ${
                            t.side === 'buy' ? 'text-emerald-500' : 'text-red-500'
                          }`}
                        >
                          {t.side.toUpperCase()}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {t.solAmount.toFixed(4)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {formatCompactTokens(t.tokenAmount)}
                        </td>
                      </tr>
                    ))}
                    {inspectTrades.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-5 text-center text-slate-500">
                          No swaps recorded.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold mb-2">
                Community Thread Moderation ({inspectComments.length})
              </div>
              <div className="space-y-2">
                {inspectComments.map((c) => (
                  <div
                    key={c.id}
                    className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] flex items-start justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="font-semibold">@{c.authorHandle}</div>
                      <div className="text-slate-600 dark:text-slate-300 mt-0.5">{c.text}</div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await adminDeleteCoinComment(
                            actorInfo,
                            inspectCoin.id,
                            c.id,
                            c.authorHandle
                          );
                          await Promise.all([
                            refreshInspectCoin(inspectCoin.id),
                            refreshAdmin(),
                          ]);
                        } catch (err) {
                          setBannerMsg({
                            type: 'err',
                            text:
                              err instanceof Error
                                ? err.message
                                : 'Failed to moderate comment',
                          });
                        }
                      }}
                      className="p-1.5 rounded text-red-500 hover:bg-red-500/10 shrink-0"
                      title="Delete comment"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {inspectComments.length === 0 && (
                  <div className="py-4 text-center text-xs text-slate-500">
                    No comments on this token.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
