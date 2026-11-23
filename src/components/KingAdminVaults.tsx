import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Flame,
  Fuel,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  ShieldAlert,
  Snowflake,
  Trash2,
  Unlock,
  UserPlus,
  Vault,
  Wallet,
  X,
} from 'lucide-react';
import type {
  AdminWallet,
  AdminWalletTier,
  EmergencyFund,
  MemeCoin,
  PlatformEconomics,
  UserProfile,
} from '../types/launchpad';
import {
  adminAssignWallet,
  adminCreateEmergencyFund,
  adminCreateOrImportWallet,
  adminDeleteWallet,
  adminDisburseEmergencyFund,
  adminSavePlatformEconomics,
  adminUpdateWalletStatusAndTreasury,
} from '../services/admin';
import {
  deriveMultiChainFromMnemonic,
  generateRandomMnemonic,
} from '../utils/crypto';
import { scanEvmAddress, scanSolanaAddress } from '../services/scanner';
import { computeGasFee } from '../utils/bondingCurve';
import { truncateAddress } from '../utils/chains';

interface ActorInfo {
  uid: string;
  handle: string;
}

interface GeneratedSecretBackup {
  label: string;
  tier: AdminWalletTier;
  mnemonic: string;
  evmAddress: string;
  evmPrivateKey: string;
  solanaAddress: string;
  solanaPrivateKey: string;
}

/* ============================================================================
 * 1. ADMIN HOT, COLD & EMERGENCY WALLETS PANEL
 * ==========================================================================*/
export function AdminWalletsPanel({
  actor,
  adminWallets,
  users,
  onBanner,
  onMutated,
}: {
  actor: ActorInfo;
  adminWallets: AdminWallet[];
  users: UserProfile[];
  onBanner: (msg: { type: 'ok' | 'err'; text: string }) => void;
  onMutated?: () => Promise<void> | void;
}) {
  const [tierFilter, setTierFilter] = useState<'all' | AdminWalletTier>('all');
  const [modeTab, setModeTab] = useState<'create' | 'import'>('create');

  // Create/Import form
  const [label, setLabel] = useState('');
  const [tier, setTier] = useState<AdminWalletTier>('hot');
  const [treasurySol, setTreasurySol] = useState('25');
  const [assignUid, setAssignUid] = useState('');
  const [importEvm, setImportEvm] = useState('');
  const [importSol, setImportSol] = useState('');
  const [formBusy, setFormBusy] = useState(false);

  // One-time secret reveal modal (never persisted in Firestore)
  const [secretBackup, setSecretBackup] = useState<GeneratedSecretBackup | null>(null);

  // Assign modal
  const [assigningWallet, setAssigningWallet] = useState<AdminWallet | null>(null);
  const [assignTargetUid, setAssignTargetUid] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);

  // Treasury edit modal
  const [editingWallet, setEditingWallet] = useState<AdminWallet | null>(null);
  const [editTreasuryVal, setEditTreasuryVal] = useState('');
  const [editTierVal, setEditTierVal] = useState<AdminWalletTier>('hot');

  // Live on-chain RPC scan cache
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [liveBalances, setLiveBalances] = useState<
    Record<string, { sol: number; evmUsd: number; scannedAt: number }>
  >({});

  const filteredWallets = useMemo(
    () =>
      tierFilter === 'all'
        ? adminWallets
        : adminWallets.filter((w) => w.tier === tierFilter),
    [adminWallets, tierFilter]
  );

  const summary = useMemo(() => {
    const hotSol = adminWallets
      .filter((w) => w.tier === 'hot')
      .reduce((s, w) => s + w.treasurySol, 0);
    const coldSol = adminWallets
      .filter((w) => w.tier === 'cold')
      .reduce((s, w) => s + w.treasurySol, 0);
    const emergencySol = adminWallets
      .filter((w) => w.tier === 'emergency')
      .reduce((s, w) => s + w.treasurySol, 0);
    const assignedCount = adminWallets.filter((w) => Boolean(w.assignedUid)).length;
    return { hotSol, coldSol, emergencySol, assignedCount };
  }, [adminWallets]);

  const handleCreateOrImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormBusy(true);
    try {
      const targetUser = users.find((u) => u.uid === assignUid) || null;
      if (tier === 'cold' && modeTab === 'create') {
        throw new Error(
          'Cold Wallets are strictly Public-Key Only. Import public addresses only — never generate private keys for Cold storage.'
        );
      }
      if (modeTab === 'create') {
        const mnemonic = generateRandomMnemonic(12);
        const derived = await deriveMultiChainFromMnemonic(mnemonic, 0);
        await adminCreateOrImportWallet(actor, {
          label,
          tier,
          origin: 'created',
          evmAddress: derived.evmAddress,
          solanaAddress: derived.solanaAddress,
          treasurySol: Number(treasurySol) || 0,
          assignedUid: targetUser?.uid || '',
          assignedHandle: targetUser?.handle || '',
        });
        setSecretBackup({
          label,
          tier,
          mnemonic,
          evmAddress: derived.evmAddress,
          evmPrivateKey: derived.evmPrivateKey,
          solanaAddress: derived.solanaAddress,
          solanaPrivateKey: derived.solanaPrivateKey,
        });
        onBanner({
          type: 'ok',
          text: `Created ${tier.toUpperCase()} wallet "${label}". Save your one-time recovery backup now.`,
        });
      } else {
        await adminCreateOrImportWallet(actor, {
          label,
          tier,
          origin: 'imported',
          evmAddress: importEvm,
          solanaAddress: importSol,
          treasurySol: Number(treasurySol) || 0,
          assignedUid: targetUser?.uid || '',
          assignedHandle: targetUser?.handle || '',
        });
        onBanner({
          type: 'ok',
          text: `Imported ${tier.toUpperCase()} wallet "${label}" into KingAdmin registry.`,
        });
      }
      await onMutated?.();
      setLabel('');
      setImportEvm('');
      setImportSol('');
      setAssignUid('');
    } catch (err) {
      onBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Wallet operation failed',
      });
    } finally {
      setFormBusy(false);
    }
  };

  const handleScanWalletLive = async (w: AdminWallet) => {
    setScanningId(w.id);
    try {
      let sol = 0;
      let evmUsd = 0;
      const tasks: Promise<void>[] = [];
      if (w.solanaAddress) {
        tasks.push(
          scanSolanaAddress(w.solanaAddress).then((res) => {
            sol = res.chain.nativeBalance;
          })
        );
      }
      if (w.evmAddress) {
        tasks.push(
          scanEvmAddress(w.evmAddress).then((res) => {
            evmUsd = res.chains.reduce((s, c) => s + c.totalUsd, 0);
          })
        );
      }
      await Promise.all(tasks);
      setLiveBalances((prev) => ({
        ...prev,
        [w.id]: { sol, evmUsd, scannedAt: Date.now() },
      }));
    } catch (err) {
      onBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Live RPC balance scan failed',
      });
    } finally {
      setScanningId(null);
    }
  };

  const handleConfirmAssign = async () => {
    if (!assigningWallet) return;
    setAssignBusy(true);
    try {
      const targetUser = users.find((u) => u.uid === assignTargetUid) || null;
      await adminAssignWallet(actor, assigningWallet, targetUser);
      await onMutated?.();
      onBanner({
        type: 'ok',
        text: targetUser
          ? `Assigned "${assigningWallet.label}" to @${targetUser.handle} and updated linked wallet.`
          : `Unassigned "${assigningWallet.label}".`,
      });
      setAssigningWallet(null);
    } catch (err) {
      onBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Assignment failed',
      });
    } finally {
      setAssignBusy(false);
    }
  };

  const handleSaveTreasuryEdit = async () => {
    if (!editingWallet) return;
    try {
      await adminUpdateWalletStatusAndTreasury(actor, editingWallet, {
        tier: editTierVal,
        treasurySol: Number(editTreasuryVal),
      });
      await onMutated?.();
      onBanner({ type: 'ok', text: `Updated treasury parameters for "${editingWallet.label}".` });
      setEditingWallet(null);
    } catch (err) {
      onBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to update wallet',
      });
    }
  };

  const downloadSecretJson = () => {
    if (!secretBackup) return;
    const blob = new Blob([JSON.stringify(secretBackup, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kingadmin-vault-${secretBackup.tier}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Tier Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-orange-500" /> Hot Wallet Liquidity
          </div>
          <div className="mt-1.5 text-xl font-mono font-bold tabular-nums">
            {summary.hotSol.toFixed(2)} SOL
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Active swap & payout operations
          </div>
        </div>
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <Snowflake className="w-3.5 h-3.5 text-cyan-500" /> Cold Vault Reserves
          </div>
          <div className="mt-1.5 text-xl font-mono font-bold tabular-nums">
            {summary.coldSol.toFixed(2)} SOL
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Offline multisig cold storage</div>
        </div>
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-red-500" /> Emergency Backstop
          </div>
          <div className="mt-1.5 text-xl font-mono font-bold tabular-nums">
            {summary.emergencySol.toFixed(2)} SOL
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Dedicated circuit-breaker vaults
          </div>
        </div>
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <UserPlus className="w-3.5 h-3.5 text-blue-500" /> Assigned to Accounts
          </div>
          <div className="mt-1.5 text-xl font-mono font-bold tabular-nums">
            {summary.assignedCount} / {adminWallets.length}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Wallets linked to traders</div>
        </div>
      </div>

      {/* Create or Import Admin Wallet */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <form
          onSubmit={handleCreateOrImport}
          className="lg:col-span-4 p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Vault className="w-4 h-4 text-blue-500" />
              Add Admin Vault Wallet
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17] text-xs">
            <button
              type="button"
              disabled={tier === 'cold'}
              onClick={() => setModeTab('create')}
              title={
                tier === 'cold'
                  ? 'Cold Wallets store public keys only — private key generation is disabled.'
                  : undefined
              }
              className={`py-1.5 rounded-md font-medium disabled:opacity-40 disabled:cursor-not-allowed ${
                modeTab === 'create'
                  ? 'bg-white dark:bg-slate-800 shadow-xs'
                  : 'text-slate-500'
              }`}
            >
              Generate New
            </button>
            <button
              type="button"
              onClick={() => setModeTab('import')}
              className={`py-1.5 rounded-md font-medium ${
                modeTab === 'import'
                  ? 'bg-white dark:bg-slate-800 shadow-xs'
                  : 'text-slate-500'
              }`}
            >
              Import Public
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Wallet Label</label>
            <input
              type="text"
              required
              minLength={2}
              maxLength={50}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g., Hot Ops #1 / Cold Treasury"
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Storage Tier</label>
              <select
                value={tier}
                onChange={(e) => {
                  const next = e.target.value as AdminWalletTier;
                  setTier(next);
                  if (next === 'cold') setModeTab('import');
                }}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
              >
                <option value="hot">Hot Wallet</option>
                <option value="cold">Cold Wallet (Public Keys Only)</option>
                <option value="emergency">Emergency Vault</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Treasury SOL Reserve
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={treasurySol}
                onChange={(e) => setTreasurySol(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
              />
            </div>
          </div>

          {tier === 'cold' && (
            <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-3 py-2 text-[11px] text-cyan-700 dark:text-cyan-300 flex items-start gap-2">
              <Snowflake className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Cold Wallets accept PUBLIC KEYS ONLY (watch &amp; receive-only). Private keys and
                seed phrases are never generated or stored for Cold storage.
              </span>
            </div>
          )}

          {modeTab === 'import' && (
            <div className="space-y-2.5">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Solana Public Address
                </label>
                <input
                  type="text"
                  maxLength={64}
                  value={importSol}
                  onChange={(e) => setImportSol(e.target.value)}
                  placeholder="Solana Base58 address"
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  EVM Public Address
                </label>
                <input
                  type="text"
                  maxLength={64}
                  value={importEvm}
                  onChange={(e) => setImportEvm(e.target.value)}
                  placeholder="0x..."
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Assign to User Account (Optional)
            </label>
            <select
              value={assignUid}
              onChange={(e) => setAssignUid(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
            >
              <option value="">Unassigned (Platform Vault)</option>
              {users.map((u) => (
                <option key={u.uid} value={u.uid}>
                  @{u.handle} ({u.solBalance.toFixed(2)} SOL)
                </option>
              ))}
            </select>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed">
            {modeTab === 'create'
              ? 'Generates real BIP-39 EVM + Solana keys in browser memory. Only public addresses are persisted to Supabase PostgreSQL.'
              : 'Registers existing public vault addresses for treasury tracking, RPC scanning, and user assignment.'}
          </p>

          <button
            type="submit"
            disabled={formBusy}
            className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2"
          >
            {formBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {modeTab === 'create' ? 'Generate & Register Wallet' : 'Import Public Wallet'}
          </button>
        </form>

        {/* Right 8 cols: Admin Wallets Table */}
        <div className="lg:col-span-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Admin Wallets Registry</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Assign vaults to traders, scan real mainnet balances, freeze/unfreeze, or rebalance.
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17] text-xs">
              {(['all', 'hot', 'cold', 'emergency'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTierFilter(t)}
                  className={`px-2.5 py-1 rounded capitalize ${
                    tierFilter === t ? 'bg-white dark:bg-slate-800 font-semibold' : 'text-slate-500'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500">
                  <th className="py-3 px-4">Wallet & Tier</th>
                  <th className="py-3 px-4">Public Addresses</th>
                  <th className="py-3 px-4">Assigned Account</th>
                  <th className="py-3 px-4 text-right">Treasury / On-Chain</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filteredWallets.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-slate-500">
                      No admin wallets registered in this tier yet. Generate or import one on the
                      left.
                    </td>
                  </tr>
                ) : (
                  filteredWallets.map((w) => {
                    const live = liveBalances[w.id];
                    return (
                      <tr key={w.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3">
                          <div className="font-semibold flex items-center gap-1.5">
                            <span>{w.label}</span>
                            {w.status === 'frozen' && (
                              <span className="text-[11px] text-red-500 font-mono">FROZEN</span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 capitalize">
                            {w.tier} · {w.origin}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5">
                          {w.solanaAddress && (
                            <div>SOL: {truncateAddress(w.solanaAddress, 6, 4)}</div>
                          )}
                          {w.evmAddress && <div>EVM: {truncateAddress(w.evmAddress, 6, 4)}</div>}
                        </td>
                        <td className="px-4 py-3">
                          {w.assignedHandle ? (
                            <span className="font-semibold text-blue-500">@{w.assignedHandle}</span>
                          ) : (
                            <span className="text-slate-400">Unassigned</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">
                          <div className="font-semibold">{w.treasurySol.toFixed(2)} SOL</div>
                          {live && (
                            <div className="text-[11px] text-emerald-500">
                              Live: {live.sol.toFixed(4)} SOL · ${live.evmUsd.toFixed(2)}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void handleScanWalletLive(w)}
                              disabled={scanningId === w.id}
                              title="Scan real mainnet balance"
                              className="p-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <RefreshCw
                                className={`w-3.5 h-3.5 ${
                                  scanningId === w.id ? 'animate-spin' : ''
                                }`}
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAssigningWallet(w);
                                setAssignTargetUid(w.assignedUid || '');
                              }}
                              title="Assign wallet to user"
                              className="p-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <UserPlus className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingWallet(w);
                                setEditTreasuryVal(String(w.treasurySol));
                                setEditTierVal(w.tier);
                              }}
                              title="Adjust treasury or tier"
                              className="p-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <Wallet className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await adminUpdateWalletStatusAndTreasury(actor, w, {
                                    status: w.status === 'active' ? 'frozen' : 'active',
                                  });
                                  await onMutated?.();
                                  onBanner({
                                    type: 'ok',
                                    text: `Wallet "${w.label}" ${
                                      w.status === 'active' ? 'frozen' : 'unfrozen'
                                    }.`,
                                  });
                                } catch (err) {
                                  onBanner({
                                    type: 'err',
                                    text:
                                      err instanceof Error
                                        ? err.message
                                        : 'Failed to update wallet status',
                                  });
                                }
                              }}
                              title={w.status === 'active' ? 'Freeze wallet' : 'Unfreeze wallet'}
                              className="p-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              {w.status === 'active' ? (
                                <Lock className="w-3.5 h-3.5 text-amber-500" />
                              ) : (
                                <Unlock className="w-3.5 h-3.5 text-emerald-500" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await adminDeleteWallet(actor, w);
                                  await onMutated?.();
                                  onBanner({
                                    type: 'ok',
                                    text: `Removed wallet "${w.label}".`,
                                  });
                                } catch (err) {
                                  onBanner({
                                    type: 'err',
                                    text:
                                      err instanceof Error ? err.message : 'Failed to delete wallet',
                                  });
                                }
                              }}
                              title="Delete wallet record"
                              className="p-1.5 rounded border border-red-500/30 text-red-500 hover:bg-red-500/10"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ONE-TIME SECRET KEY BACKUP MODAL */}
      {secretBackup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-xl border border-amber-500/40 bg-white dark:bg-[#111827] p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-amber-500 flex items-center gap-1.5">
                  <KeyRound className="w-4 h-4" />
                  ONE-TIME VAULT RECOVERY BACKUP
                </div>
                <h3 className="text-base font-semibold mt-1">
                  {secretBackup.label} ({secretBackup.tier.toUpperCase()})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Private keys and seed phrases are generated locally and NEVER saved to Supabase
                  PostgreSQL. Download or copy this backup before closing.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSecretBackup(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] space-y-2.5 text-xs font-mono">
              <div>
                <div className="text-[11px] text-slate-500 font-sans">12-Word Seed Phrase</div>
                <div className="mt-0.5 break-words text-slate-900 dark:text-slate-100">
                  {secretBackup.mnemonic}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 font-sans">Solana Address</div>
                <div className="break-all">{secretBackup.solanaAddress}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 font-sans">EVM Address</div>
                <div className="break-all">{secretBackup.evmAddress}</div>
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(secretBackup.mnemonic)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                Copy Seed
              </button>
              <button
                type="button"
                onClick={downloadSecretJson}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Download Backup JSON
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ASSIGN WALLET MODAL */}
      {assigningWallet && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Assign "{assigningWallet.label}"</h3>
              <button
                type="button"
                onClick={() => setAssigningWallet(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Assigning links this vault’s public address directly to the user’s profile.
            </p>
            <select
              value={assignTargetUid}
              onChange={(e) => setAssignTargetUid(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
            >
              <option value="">Unassigned (Return to Treasury)</option>
              {users.map((u) => (
                <option key={u.uid} value={u.uid}>
                  @{u.handle} ({u.displayName})
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAssigningWallet(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={assignBusy}
                onClick={handleConfirmAssign}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
              >
                {assignBusy ? 'Saving…' : 'Confirm Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT WALLET TREASURY / TIER MODAL */}
      {editingWallet && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Edit "{editingWallet.label}"</h3>
              <button
                type="button"
                onClick={() => setEditingWallet(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Vault Tier</label>
              <select
                value={editTierVal}
                onChange={(e) => setEditTierVal(e.target.value as AdminWalletTier)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
              >
                <option value="hot">Hot Wallet</option>
                <option value="cold">Cold Wallet</option>
                <option value="emergency">Emergency Vault</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Treasury SOL Reserve
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={editTreasuryVal}
                onChange={(e) => setEditTreasuryVal(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingWallet(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveTreasuryEdit}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
              >
                Save Reserve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * 2. EMERGENCY FUNDS PANEL
 * ==========================================================================*/
export function EmergencyFundsPanel({
  actor,
  emergencyFunds,
  adminWallets,
  users,
  coins,
  onBanner,
  onMutated,
}: {
  actor: ActorInfo;
  emergencyFunds: EmergencyFund[];
  adminWallets: AdminWallet[];
  users: UserProfile[];
  coins: MemeCoin[];
  onBanner: (msg: { type: 'ok' | 'err'; text: string }) => void;
  onMutated?: () => Promise<void> | void;
}) {
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [allocatedSol, setAllocatedSol] = useState('100');
  const [sourceWalletId, setSourceWalletId] = useState('');
  const [createBusy, setCreateBusy] = useState(false);

  // Disburse modal
  const [disbursingFund, setDisbursingFund] = useState<EmergencyFund | null>(null);
  const [targetKind, setTargetKind] = useState<'user' | 'coin'>('user');
  const [targetUserUid, setTargetUserUid] = useState('');
  const [targetCoinId, setTargetCoinId] = useState('');
  const [disburseAmt, setDisburseAmt] = useState('5');
  const [disburseReason, setDisburseReason] = useState('Emergency liquidity relief');
  const [disburseBusy, setDisburseBusy] = useState(false);

  const handleCreateFund = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateBusy(true);
    try {
      await adminCreateEmergencyFund(actor, {
        name,
        purpose,
        allocatedSol: Number(allocatedSol),
        sourceWalletId,
      });
      await onMutated?.();
      onBanner({ type: 'ok', text: `Created Emergency Fund "${name}" (${allocatedSol} SOL).` });
      setName('');
      setPurpose('');
    } catch (err) {
      onBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to create emergency fund',
      });
    } finally {
      setCreateBusy(false);
    }
  };

  const handleDisburse = async () => {
    if (!disbursingFund) return;
    setDisburseBusy(true);
    try {
      if (targetKind === 'user') {
        const targetUser = users.find((u) => u.uid === targetUserUid);
        if (!targetUser) throw new Error('Select a recipient trader.');
        await adminDisburseEmergencyFund(actor, disbursingFund, {
          kind: 'user',
          user: targetUser,
          amountSol: Number(disburseAmt),
          reason: disburseReason,
        });
        await onMutated?.();
        onBanner({
          type: 'ok',
          text: `Disbursed ${disburseAmt} SOL from "${disbursingFund.name}" to @${targetUser.handle}.`,
        });
      } else {
        const targetCoin = coins.find((c) => c.id === targetCoinId);
        if (!targetCoin) throw new Error('Select a target meme coin.');
        await adminDisburseEmergencyFund(actor, disbursingFund, {
          kind: 'coin',
          coin: targetCoin,
          amountSol: Number(disburseAmt),
          reason: disburseReason,
        });
        await onMutated?.();
        onBanner({
          type: 'ok',
          text: `Injected ${disburseAmt} SOL emergency backstop into $${targetCoin.ticker}.`,
        });
      }
      setDisbursingFund(null);
    } catch (err) {
      onBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Emergency disbursement failed',
      });
    } finally {
      setDisburseBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      <form
        onSubmit={handleCreateFund}
        className="lg:col-span-4 p-5 rounded-xl border border-red-500/30 bg-white dark:bg-[#111827] space-y-4"
      >
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2 text-red-500">
            <AlertTriangle className="w-4 h-4" />
            Create Emergency Fund Reserve
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Ring-fence emergency SOL reserves to bail out accounts or backstop meme curves.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Reserve Name</label>
          <input
            type="text"
            required
            minLength={2}
            maxLength={64}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Curve Circuit-Breaker Pool"
            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Mandate / Purpose</label>
          <textarea
            required
            rows={2}
            maxLength={200}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="Incident coverage, liquidity stabilization, or user restitution"
            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Allocation (SOL)
            </label>
            <input
              type="number"
              required
              min="1"
              step="any"
              value={allocatedSol}
              onChange={(e) => setAllocatedSol(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Source Vault</label>
            <select
              value={sourceWalletId}
              onChange={(e) => setSourceWalletId(e.target.value)}
              className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
            >
              <option value="">Treasury Reserve</option>
              {adminWallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label} ({w.tier})
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="submit"
          disabled={createBusy}
          className="w-full py-2.5 px-4 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2"
        >
          {createBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Create Emergency Reserve
        </button>
      </form>

      <div className="lg:col-span-8 space-y-4">
        {emergencyFunds.length === 0 ? (
          <div className="p-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-center text-xs text-slate-500">
            No emergency reserve pools created yet. Use the form to establish an emergency fund.
          </div>
        ) : (
          emergencyFunds.map((fund) => {
            const remaining = Math.max(0, fund.allocatedSol - fund.disbursedSol);
            const pctUsed =
              fund.allocatedSol > 0
                ? Math.min(100, (fund.disbursedSol / fund.allocatedSol) * 100)
                : 0;
            return (
              <div
                key={fund.id}
                className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold">{fund.name}</h4>
                      <span
                        className={`text-[11px] font-mono uppercase font-semibold ${
                          fund.status === 'depleted'
                            ? 'text-slate-400'
                            : fund.status === 'active'
                            ? 'text-amber-500'
                            : 'text-emerald-500'
                        }`}
                      >
                        · {fund.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{fund.purpose}</p>
                  </div>

                  <button
                    type="button"
                    disabled={remaining <= 0}
                    onClick={() => {
                      setDisbursingFund(fund);
                      setTargetUserUid(users[0]?.uid || '');
                      setTargetCoinId(coins[0]?.id || '');
                    }}
                    className="px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-xs font-semibold"
                  >
                    Disburse Funds
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-3 text-xs tabular-nums">
                  <div>
                    <div className="text-slate-500 text-[11px]">Allocated</div>
                    <div className="font-mono font-semibold">{fund.allocatedSol.toFixed(2)} SOL</div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-[11px]">Disbursed</div>
                    <div className="font-mono font-semibold text-amber-500">
                      {fund.disbursedSol.toFixed(2)} SOL
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-[11px]">Remaining</div>
                    <div className="font-mono font-semibold text-emerald-500">
                      {remaining.toFixed(2)} SOL
                    </div>
                  </div>
                </div>

                <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div className="h-full bg-amber-500" style={{ width: `${pctUsed}%` }} />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* DISBURSE MODAL */}
      {disbursingFund && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Disburse: {disbursingFund.name}</h3>
              <button
                type="button"
                onClick={() => setDisbursingFund(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17] text-xs">
              <button
                type="button"
                onClick={() => setTargetKind('user')}
                className={`py-1.5 rounded font-medium ${
                  targetKind === 'user' ? 'bg-white dark:bg-slate-800 shadow-xs' : 'text-slate-500'
                }`}
              >
                Credit Trader Account
              </button>
              <button
                type="button"
                onClick={() => setTargetKind('coin')}
                className={`py-1.5 rounded font-medium ${
                  targetKind === 'coin' ? 'bg-white dark:bg-slate-800 shadow-xs' : 'text-slate-500'
                }`}
              >
                Backstop Meme Coin
              </button>
            </div>

            {targetKind === 'user' ? (
              <select
                value={targetUserUid}
                onChange={(e) => setTargetUserUid(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
              >
                {users.map((u) => (
                  <option key={u.uid} value={u.uid}>
                    @{u.handle} ({u.solBalance.toFixed(2)} SOL)
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={targetCoinId}
                onChange={(e) => setTargetCoinId(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
              >
                {coins.map((c) => (
                  <option key={c.id} value={c.id}>
                    ${c.ticker} — {c.name} ({c.realSol.toFixed(2)} SOL raised)
                  </option>
                ))}
              </select>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Amount (SOL)</label>
                <input
                  type="number"
                  min="0.1"
                  step="any"
                  value={disburseAmt}
                  onChange={(e) => setDisburseAmt(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Audit Note</label>
                <input
                  type="text"
                  value={disburseReason}
                  onChange={(e) => setDisburseReason(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDisbursingFund(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={disburseBusy}
                onClick={handleDisburse}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
              >
                {disburseBusy ? 'Disbursing…' : 'Execute Disbursement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * 3. PLATFORM GAS & FEE ECONOMICS PANEL
 * ==========================================================================*/
export function GasEconomicsPanel({
  actor,
  economics,
  onBanner,
  onMutated,
}: {
  actor: ActorInfo;
  economics: PlatformEconomics;
  onBanner: (msg: { type: 'ok' | 'err'; text: string }) => void;
  onMutated?: () => Promise<void> | void;
}) {
  const [creationFeeSol, setCreationFeeSol] = useState(String(economics.creationFeeSol));
  const [baseGasSol, setBaseGasSol] = useState(String(economics.baseGasSol));
  const [priorityGasSol, setPriorityGasSol] = useState(String(economics.priorityGasSol));
  const [congestionMultiplier, setCongestionMultiplier] = useState(
    String(economics.congestionMultiplier)
  );
  const [protocolFeeBps, setProtocolFeeBps] = useState(String(economics.protocolFeeBps));
  const [holderRewardBps, setHolderRewardBps] = useState(String(economics.holderRewardBps));
  const [creatorFeeBps, setCreatorFeeBps] = useState(String(economics.creatorFeeBps));
  const [busy, setBusy] = useState(false);

  const previewEcon: PlatformEconomics = {
    id: 'economics',
    creationFeeSol: Number(creationFeeSol) || 0,
    baseGasSol: Number(baseGasSol) || 0,
    priorityGasSol: Number(priorityGasSol) || 0,
    congestionMultiplier: Math.max(0.5, Number(congestionMultiplier) || 1),
    protocolFeeBps: Number(protocolFeeBps) || 0,
    holderRewardBps: Number(holderRewardBps) || 0,
    creatorFeeBps: Number(creatorFeeBps) || 0,
  };

  const stdGas = computeGasFee('standard', previewEcon);
  const fastGas = computeGasFee('fast', previewEcon);
  const turboGas = computeGasFee('turbo', previewEcon);
  const totalFeeBps =
    previewEcon.protocolFeeBps + previewEcon.holderRewardBps + previewEcon.creatorFeeBps;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await adminSavePlatformEconomics(actor, previewEcon);
      await onMutated?.();
      onBanner({
        type: 'ok',
        text: 'Saved live platform gas fees, congestion multiplier, and reward fee splits.',
      });
    } catch (err) {
      onBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to update economics',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={handleSave}
      className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Fuel className="w-4 h-4 text-blue-500" />
            Platform Gas Schedule & Bonding-Curve Fee Routing
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Changes sync immediately to every trader terminal across Standard, Fast, and Turbo gas
            tiers.
          </p>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          Publish Live Economics
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
        <div>
          <label className="block font-medium text-slate-500 mb-1">Coin Creation Fee (SOL)</label>
          <input
            type="number"
            min="0"
            max="5"
            step="0.001"
            value={creationFeeSol}
            onChange={(e) => setCreationFeeSol(e.target.value)}
            className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
          />
        </div>
        <div>
          <label className="block font-medium text-slate-500 mb-1">Base Network Gas (SOL)</label>
          <input
            type="number"
            min="0"
            max="1"
            step="0.0001"
            value={baseGasSol}
            onChange={(e) => setBaseGasSol(e.target.value)}
            className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
          />
        </div>
        <div>
          <label className="block font-medium text-slate-500 mb-1">Priority Gas Tip (SOL)</label>
          <input
            type="number"
            min="0"
            max="1"
            step="0.0001"
            value={priorityGasSol}
            onChange={(e) => setPriorityGasSol(e.target.value)}
            className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
          />
        </div>
        <div>
          <label className="block font-medium text-slate-500 mb-1">
            Congestion Multiplier (0.5x–10x)
          </label>
          <input
            type="number"
            min="0.5"
            max="10"
            step="0.1"
            value={congestionMultiplier}
            onChange={(e) => setCongestionMultiplier(e.target.value)}
            className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
        <div>
          <label className="block font-medium text-slate-500 mb-1">
            Protocol Treasury Fee (bps)
          </label>
          <input
            type="number"
            min="0"
            max="1000"
            value={protocolFeeBps}
            onChange={(e) => setProtocolFeeBps(e.target.value)}
            className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
          />
        </div>
        <div>
          <label className="block font-medium text-slate-500 mb-1">
            Holder Rewards Pool Fee (bps)
          </label>
          <input
            type="number"
            min="0"
            max="1000"
            value={holderRewardBps}
            onChange={(e) => setHolderRewardBps(e.target.value)}
            className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
          />
        </div>
        <div>
          <label className="block font-medium text-slate-500 mb-1">Creator Royalty Fee (bps)</label>
          <input
            type="number"
            min="0"
            max="1000"
            value={creatorFeeBps}
            onChange={(e) => setCreatorFeeBps(e.target.value)}
            className="w-full px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 p-4 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-xs tabular-nums">
        <div>
          <div className="text-slate-500">Standard Gas</div>
          <div className="font-mono font-semibold mt-0.5">{stdGas.totalGasSol.toFixed(6)} SOL</div>
        </div>
        <div>
          <div className="text-slate-500">Fast Gas</div>
          <div className="font-mono font-semibold mt-0.5">{fastGas.totalGasSol.toFixed(6)} SOL</div>
        </div>
        <div>
          <div className="text-slate-500">Turbo Gas</div>
          <div className="font-mono font-semibold mt-0.5">{turboGas.totalGasSol.toFixed(6)} SOL</div>
        </div>
        <div>
          <div className="text-slate-500">Total Swap Fee</div>
          <div className="font-mono font-semibold text-blue-500 mt-0.5">
            {(totalFeeBps / 100).toFixed(2)}% ({totalFeeBps} bps)
          </div>
        </div>
      </div>
    </form>
  );
}
