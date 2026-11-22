import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownUp,
  ArrowRightLeft,
  Check,
  Coins,
  Copy,
  Eye,
  EyeOff,
  Flame,
  Fuel,
  Gift,
  KeyRound,
  Layers,
  Loader2,
  LogIn,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type {
  CscAsset,
  CscGasTier,
  CscLocalWalletSecret,
  CscOverviewResponse,
  CscTxType,
} from '../types/csc';
import {
  computeSyncedEnergy,
  computeTapYield,
  CSC_ENERGY_MAX,
  CSC_GAS_FEES,
  formatCscAmount,
  formatCscUsdPrice,
  getHalvingInfo,
  quoteCscSwap,
} from '../utils/cscEconomics';
import {
  createNewCscWalletMaterial,
  importCscWalletMaterial,
  loadLocalCscSecrets,
  saveLocalCscSecret,
} from '../utils/cscWallet';
import {
  bridgeSolToCscNetwork,
  claimCscReferralCode,
  fetchCscOverview,
  registerCscWallet,
  setPrimaryCscWallet,
  submitCscTaps,
  swapCscAssets,
  syncCscWallets,
  transferCscAssets,
} from '../services/csc';
import { formatTimestamp, formatUsd, truncateAddress } from '../utils/chains';
import { CscPriceChart } from './CscPriceChart';

type CscSubTab = 'tap' | 'swap' | 'wallets' | 'ledger';

const PENDING_REF_STORAGE_KEY = 'chainscope_pending_csc_ref_v1';

export function ChainScopeCoinView() {
  const {
    user,
    profile,
    signInWithGoogle,
    setShowOnboardingModal,
    refreshAccount,
  } = useAuth();

  const [subTab, setSubTab] = useState<CscSubTab>('tap');
  const [overview, setOverview] = useState<CscOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Live energy tick + batched tapping
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [queuedTaps, setQueuedTaps] = useState(0);
  const queuedTapsRef = useRef(0);
  const flushTimerRef = useRef<number | null>(null);
  const [tapWalletId, setTapWalletId] = useState<string>('');
  const [lastTapFlash, setLastTapFlash] = useState<string | null>(null);

  // Referrals
  const [refCodeInput, setRefCodeInput] = useState<string>(() => {
    try {
      return localStorage.getItem(PENDING_REF_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });

  // Swap form
  const [swapWalletId, setSwapWalletId] = useState<string>('');
  const [swapAssetIn, setSwapAssetIn] = useState<CscAsset>('CSC');
  const [swapAssetOut, setSwapAssetOut] = useState<CscAsset>('USDT');
  const [swapAmountInput, setSwapAmountInput] = useState<string>('10');
  const [swapGasTier, setSwapGasTier] = useState<CscGasTier>('standard');

  // SOL bridge form
  const [bridgeSolAmount, setBridgeSolAmount] = useState<string>('0.1');
  const [bridgeTargetAsset, setBridgeTargetAsset] = useState<CscAsset>('USDT');

  // Wallet creation & import
  const [newWalletLabel, setNewWalletLabel] = useState<string>('');
  const [importLabel, setImportLabel] = useState<string>('');
  const [importSecretInput, setImportSecretInput] = useState<string>('');
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [localSecrets, setLocalSecrets] = useState<Record<string, CscLocalWalletSecret>>({});
  const [freshCreatedSecret, setFreshCreatedSecret] = useState<CscLocalWalletSecret | null>(null);
  const [revealedAddressSecret, setRevealedAddressSecret] = useState<string | null>(null);

  // Transfer form (Inter-Wallet or External Wallet-to-Wallet)
  const [transferMode, setTransferMode] = useState<'inter' | 'external'>('inter');
  const [transferFromWalletId, setTransferFromWalletId] = useState<string>('');
  const [transferToWalletId, setTransferToWalletId] = useState<string>('');
  const [transferToAddress, setTransferToAddress] = useState<string>('');
  const [transferAsset, setTransferAsset] = useState<CscAsset>('CSC');
  const [transferAmount, setTransferAmount] = useState<string>('5');
  const [transferGasTier, setTransferGasTier] = useState<CscGasTier>('standard');
  const [transferNote, setTransferNote] = useState<string>('');

  // Ledger filter
  const [ledgerFilter, setLedgerFilter] = useState<'all' | CscTxType>('all');

  const copyText = (value: string, key: string) => {
    void navigator.clipboard.writeText(value);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1600);
  };

  const loadOverview = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await fetchCscOverview();
      setOverview(data);
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to load ChainScope Network state',
      });
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview(false);
  }, [loadOverview, user?.uid]);

  useEffect(() => {
    setLocalSecrets(loadLocalCscSecrets(user?.uid));
  }, [user?.uid]);

  // 1-second timer for smooth energy countdown
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Periodic background refresh
  useEffect(() => {
    const id = window.setInterval(() => {
      void loadOverview(true);
    }, 10000);
    return () => window.clearInterval(id);
  }, [loadOverview]);

  // Keep selected wallet IDs aligned with loaded wallets
  useEffect(() => {
    const wallets = overview?.wallets || [];
    if (wallets.length === 0) return;
    const primary = wallets.find((w) => w.isPrimary) || wallets[0];
    if (!tapWalletId || !wallets.some((w) => w.id === tapWalletId)) {
      setTapWalletId(primary.id);
    }
    if (!swapWalletId || !wallets.some((w) => w.id === swapWalletId)) {
      setSwapWalletId(primary.id);
    }
    if (!transferFromWalletId || !wallets.some((w) => w.id === transferFromWalletId)) {
      setTransferFromWalletId(primary.id);
    }
    if (
      wallets.length > 1 &&
      (!transferToWalletId ||
        transferToWalletId === transferFromWalletId ||
        !wallets.some((w) => w.id === transferToWalletId))
    ) {
      const other = wallets.find((w) => w.id !== (transferFromWalletId || primary.id));
      if (other) setTransferToWalletId(other.id);
    }
  }, [overview?.wallets, tapWalletId, swapWalletId, transferFromWalletId, transferToWalletId]);

  const flushQueuedTaps = useCallback(async () => {
    const count = queuedTapsRef.current;
    if (count <= 0 || !user) return;
    queuedTapsRef.current = 0;
    setQueuedTaps(0);
    try {
      const res = await submitCscTaps(count, tapWalletId || undefined);
      setOverview(res);
      if (res.mintedCsc && res.mintedCsc > 0) {
        setLastTapFlash(`+${res.mintedCsc.toFixed(4)} CSC mined`);
      }
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Tap mining failed',
      });
    }
  }, [tapWalletId, user]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current);
    };
  }, []);

  const network = overview?.network ?? null;
  const account = overview?.account ?? null;
  const wallets = overview?.wallets ?? [];

  const liveEnergyState = useMemo(() => {
    if (!account) return { energy: 0, nextEnergyInSec: 0 };
    const synced = computeSyncedEnergy(account.energy, account.lastEnergySyncAt, nowMs);
    const availableAfterQueue = Math.max(0, synced.energy - queuedTaps);
    return {
      energy: availableAfterQueue,
      nextEnergyInSec: synced.nextEnergyInSec,
    };
  }, [account, nowMs, queuedTaps]);

  const tapPreview = useMemo(() => {
    if (!network || !account) return null;
    return computeTapYield({
      taps: 1,
      minedSupply: network.minedSupply,
      rewardPoolRemaining: network.rewardPoolRemaining,
      referralCount: account.referralCount,
    });
  }, [network, account]);

  const halvingInfo = useMemo(() => {
    return getHalvingInfo(network?.minedSupply || 0);
  }, [network?.minedSupply]);

  const handleTapClick = () => {
    if (!user) {
      setBanner({ type: 'err', text: 'Sign in with Google to mine CSC into your ChainScope wallet.' });
      return;
    }
    if (liveEnergyState.energy <= 0) {
      setBanner({
        type: 'err',
        text: `Energy depleted. +1 energy regenerates in ${liveEnergyState.nextEnergyInSec}s.`,
      });
      return;
    }
    queuedTapsRef.current += 1;
    setQueuedTaps(queuedTapsRef.current);
    setBanner(null);

    if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current);
    if (queuedTapsRef.current >= 10) {
      void flushQueuedTaps();
    } else {
      flushTimerRef.current = window.setTimeout(() => {
        void flushQueuedTaps();
      }, 320);
    }
  };

  const handleSyncWallets = async () => {
    if (!user) {
      await loadOverview(false);
      return;
    }
    setBusyAction('sync');
    setBanner(null);
    try {
      const res = await syncCscWallets();
      setOverview(res);
      setBanner({
        type: 'ok',
        text: `Synced ${res.wallets.length} ChainScope wallet(s) at block #${res.network.blockHeight}.`,
      });
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Sync failed' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleClaimReferral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusyAction('referral');
    setBanner(null);
    try {
      const res = await claimCscReferralCode(refCodeInput);
      setOverview(res);
      try {
        localStorage.removeItem(PENDING_REF_STORAGE_KEY);
      } catch {
        // ignore
      }
      setBanner({
        type: 'ok',
        text: 'Referral code activated! Welcome bonus CSC credited to your primary wallet.',
      });
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to apply referral code',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const swapWallet = useMemo(
    () => wallets.find((w) => w.id === swapWalletId) || wallets[0] || null,
    [wallets, swapWalletId]
  );

  const swapQuote = useMemo(() => {
    if (!network) return null;
    const amt = Number(swapAmountInput);
    return quoteCscSwap({
      assetIn: swapAssetIn,
      assetOut: swapAssetOut,
      amountIn: Number.isFinite(amt) && amt > 0 ? amt : 0,
      usdtPool: network.usdtPool,
      usd1Pool: network.usd1Pool,
      gasTier: swapGasTier,
    });
  }, [network, swapAssetIn, swapAssetOut, swapAmountInput, swapGasTier]);

  const handleFlipSwapPair = () => {
    setSwapAssetIn(swapAssetOut);
    setSwapAssetOut(swapAssetIn);
  };

  const getWalletBalanceForAsset = (wallet: typeof swapWallet, asset: CscAsset): number => {
    if (!wallet) return 0;
    if (asset === 'CSC') return wallet.cscBalance;
    if (asset === 'USDT') return wallet.usdtBalance;
    return wallet.usd1Balance;
  };

  const handleExecuteSwap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !swapWallet || !swapQuote) return;
    const amt = Number(swapAmountInput);
    if (!Number.isFinite(amt) || amt <= 0) {
      setBanner({ type: 'err', text: 'Enter a valid positive swap amount.' });
      return;
    }
    setBusyAction('swap');
    setBanner(null);
    try {
      const res = await swapCscAssets({
        walletId: swapWallet.id,
        assetIn: swapAssetIn,
        assetOut: swapAssetOut,
        amountIn: amt,
        gasTier: swapGasTier,
        minAmountOut: Number((swapQuote.amountOut * 0.95).toFixed(6)),
      });
      setOverview(res);
      setBanner({
        type: 'ok',
        text: `Swapped ${formatCscAmount(amt)} ${swapAssetIn} → ${formatCscAmount(swapQuote.amountOut)} ${swapAssetOut} (Gas: ${swapQuote.gasFeeCsc} CSC · Spot: ${formatCscUsdPrice(res.network.spotPriceUsd)})`,
      });
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Swap failed' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleBridgeSol = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !swapWallet) return;
    const amt = Number(bridgeSolAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setBanner({ type: 'err', text: 'Enter a valid SOL amount to bridge.' });
      return;
    }
    setBusyAction('bridge');
    setBanner(null);
    try {
      const res = await bridgeSolToCscNetwork({
        walletId: swapWallet.id,
        solAmount: amt,
        targetAsset: bridgeTargetAsset,
      });
      setOverview(res);
      await refreshAccount();
      setBanner({
        type: 'ok',
        text: `Bridged ${amt.toFixed(3)} Platform SOL into ${bridgeTargetAsset} on "${swapWallet.label}".`,
      });
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'SOL bridge failed' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusyAction('create_wallet');
    setBanner(null);
    try {
      const label = newWalletLabel.trim() || `ChainScope Vault #${wallets.length + 1}`;
      const material = await createNewCscWalletMaterial(label, wallets.length);
      saveLocalCscSecret(material, user.uid);
      setLocalSecrets(loadLocalCscSecrets(user.uid));
      const res = await registerCscWallet({
        address: material.address,
        evmAddress: material.evmAddress,
        label: material.label,
        origin: 'created',
        setPrimary: false,
      });
      setOverview(res);
      setFreshCreatedSecret(material);
      setNewWalletLabel('');
      setBanner({
        type: 'ok',
        text: `Created cryptographic ChainScope wallet "${material.label}" (${truncateAddress(material.address, 8, 6)}).`,
      });
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Wallet creation failed',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleImportWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusyAction('import_wallet');
    setBanner(null);
    try {
      const label = importLabel.trim() || `Imported CSC #${wallets.length + 1}`;
      const material = await importCscWalletMaterial(importSecretInput, label);
      saveLocalCscSecret(material, user.uid);
      setLocalSecrets(loadLocalCscSecrets(user.uid));
      const res = await registerCscWallet({
        address: material.address,
        evmAddress: material.evmAddress,
        label: material.label,
        origin: 'imported',
        setPrimary: false,
      });
      setOverview(res);
      setImportSecretInput('');
      setImportLabel('');
      setShowImportPanel(false);
      setBanner({
        type: 'ok',
        text: `Imported & synced wallet "${material.label}" (${truncateAddress(material.address, 8, 6)}).`,
      });
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Wallet import failed',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSetPrimaryWallet = async (walletId: string) => {
    if (!user) return;
    setBusyAction(`primary_${walletId}`);
    setBanner(null);
    try {
      const res = await setPrimaryCscWallet(walletId);
      setOverview(res);
      setBanner({ type: 'ok', text: 'Updated Primary CSC wallet for taps & referral rewards.' });
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to update primary wallet',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const transferFromWallet = useMemo(
    () => wallets.find((w) => w.id === transferFromWalletId) || wallets[0] || null,
    [wallets, transferFromWalletId]
  );

  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !transferFromWallet) return;
    const amt = Number(transferAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setBanner({ type: 'err', text: 'Enter a valid transfer amount.' });
      return;
    }

    setBusyAction('transfer');
    setBanner(null);
    try {
      const res = await transferCscAssets({
        fromWalletId: transferFromWallet.id,
        toWalletId: transferMode === 'inter' ? transferToWalletId : undefined,
        toAddressOrHandle: transferMode === 'external' ? transferToAddress.trim() : undefined,
        asset: transferAsset,
        amount: amt,
        gasTier: transferGasTier,
        note: transferNote.trim(),
      });
      setOverview(res);
      setTransferNote('');
      if (transferMode === 'external') setTransferToAddress('');
      setBanner({
        type: 'ok',
        text: `Confirmed ${amt} ${transferAsset} transfer at block #${res.network.blockHeight} (Gas: ${CSC_GAS_FEES[transferGasTier]} CSC).`,
      });
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Transfer failed' });
    } finally {
      setBusyAction(null);
    }
  };

  const totalUserBalances = useMemo(() => {
    return wallets.reduce(
      (acc, w) => ({
        csc: acc.csc + w.cscBalance,
        usdt: acc.usdt + w.usdtBalance,
        usd1: acc.usd1 + w.usd1Balance,
      }),
      { csc: 0, usdt: 0, usd1: 0 }
    );
  }, [wallets]);

  const filteredTransactions = useMemo(() => {
    const txs = overview?.transactions || [];
    if (ledgerFilter === 'all') return txs;
    return txs.filter((t) => t.type === ledgerFilter);
  }, [overview?.transactions, ledgerFilter]);

  const inviteUrl = useMemo(() => {
    if (!account?.referralCode || typeof window === 'undefined') return '';
    return `${window.location.origin}/?ref=${encodeURIComponent(account.referralCode)}`;
  }, [account?.referralCode]);

  if (loading && !overview) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 dark:text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2.5 text-blue-500" />
        <span className="text-sm font-medium">Loading ChainScope CSC-1 Network...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Banner / Auth Prompt */}
      {!user && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 dark:bg-blue-500/10 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Sign in to activate your ChainScope (CSC-1) Wallet, Tap Miner & Referral Code
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              Live market curves, AMM pool reserves, and network ledger are visible below. Sign in to mint CSC, create sub-wallets, transfer, and swap to USDT / USD1.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowOnboardingModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 transition-colors"
            >
              <LogIn className="w-3.5 h-3.5" />
              Create / Unlock Wallet
            </button>
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 transition-colors"
            >
              Google (Optional)
            </button>
          </div>
        </div>
      )}

      {banner && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs sm:text-sm flex items-center justify-between gap-3 ${
            banner.type === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
          }`}
        >
          <span>{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-xs opacity-70 hover:opacity-100 whitespace-nowrap shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Hero Network Metrics Strip */}
      {network && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-semibold text-blue-600 dark:text-blue-400">
                  {network.networkName}
                </span>
                <span>·</span>
                <span className="font-mono">Chain ID {network.chainId}</span>
                <span>·</span>
                <span className="font-mono tabular-nums">Block #{network.blockHeight}</span>
                <span>·</span>
                <span className="font-mono">Halving Era {halvingInfo.era}/4</span>
              </div>
              <div className="flex flex-wrap items-baseline gap-3">
                <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  ChainScope Coin (CSC)
                </h1>
                <span className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {formatCscUsdPrice(network.spotPriceUsd)}
                </span>
                <span
                  className={`text-xs font-mono font-semibold tabular-nums ${
                    network.priceChangePct >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {network.priceChangePct >= 0 ? '+' : ''}
                  {network.priceChangePct.toFixed(2)}% vs genesis
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              {user && (
                <div className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-xs font-mono tabular-nums">
                  <span className="text-slate-500 dark:text-slate-400 mr-2">Portfolio:</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {formatCscAmount(totalUserBalances.csc)} CSC
                  </span>
                  <span className="text-slate-400 mx-1.5">·</span>
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {formatCscAmount(totalUserBalances.usdt, 2)} USDT
                  </span>
                  <span className="text-slate-400 mx-1.5">·</span>
                  <span className="text-blue-600 dark:text-blue-400">
                    {formatCscAmount(totalUserBalances.usd1, 2)} USD1
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() => void handleSyncWallets()}
                disabled={busyAction === 'sync'}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'sync' ? 'animate-spin text-blue-500' : ''}`} />
                Sync Wallets
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 pt-4">
            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Market Cap</div>
              <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                {formatUsd(network.marketCapUsd)}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Mined Supply</div>
              <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                {formatCscAmount(network.minedSupply, 2)} / {formatCscAmount(network.maxSupply, 0)}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Gas Burned</div>
              <div className="text-sm font-semibold font-mono tabular-nums text-amber-600 dark:text-amber-400 mt-0.5">
                {formatCscAmount(network.burnedSupply, 4)} CSC
              </div>
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Swap Volume</div>
              <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                {formatUsd(network.totalVolumeUsd)}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Base Tap Yield</div>
              <div className="text-sm font-semibold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-0.5">
                {network.tapBaseReward} CSC / tap
              </div>
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Network Gas</div>
              <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                {network.gasFees.standard} CSC
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Price Fluctuation Chart + Dual AMM Pools */}
      {network && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2">
            <CscPriceChart
              history={network.priceHistory}
              spotPriceUsd={network.spotPriceUsd}
              genesisPriceUsd={network.genesisPriceUsd}
            />
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4 sm:p-5 flex flex-col justify-between space-y-4">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  AMM Liquidity Pools (x · y = k)
                </h2>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  0.30% fee
                </span>
              </div>

              <div className="space-y-3">
                {[network.usdtPool, network.usd1Pool].map((pool) => (
                  <div
                    key={pool.id}
                    className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] p-3"
                  >
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-900 dark:text-slate-100">
                      <span>CSC / {pool.quoteAsset}</span>
                      <span className="font-mono tabular-nums">
                        {formatCscUsdPrice(pool.spotPriceUsd)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-1.5">
                      <span>{formatCscAmount(pool.cscReserve, 0)} CSC</span>
                      <span>{formatUsd(pool.usdReserve)} {pool.quoteAsset}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
              <div className="flex items-center justify-between">
                <span>Gas Split (Deflationary)</span>
                <span className="font-mono text-slate-700 dark:text-slate-300">
                  50% Burn · 30% Tap Pool · 20% LP
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Emission Pool Remaining</span>
                <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                  {formatCscAmount(network.rewardPoolRemaining, 0)} CSC
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Workspace Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
        {(
          [
            { id: 'tap', label: 'Tap & Referrals', icon: Zap },
            { id: 'swap', label: 'Swap (USDT / USD1)', icon: ArrowDownUp },
            { id: 'wallets', label: `Wallets & Transfers (${wallets.length})`, icon: Wallet },
            { id: 'ledger', label: 'Network Ledger', icon: Activity },
          ] as Array<{ id: CscSubTab; label: string; icon: typeof Zap }>
        ).map((tab) => {
          const Icon = tab.icon;
          const active = subTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                active
                  ? 'bg-blue-600 text-white'
                  : 'border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: TAP & REFERRALS */}
      {subTab === 'tap' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Interactive Tap-to-Mine Pad */}
          <div className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Sustainable Tap-to-Mine Engine
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Market-capped halving supply (14M mining pool). Zero gas required to tap.
                </p>
              </div>
              {account && (
                <div className="text-right font-mono tabular-nums">
                  <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    +{tapPreview?.perTapRewardCsc ?? network?.tapBaseReward ?? 0.5} CSC / tap
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Boost: +{account.referralMultiplierPct}%
                  </div>
                </div>
              )}
            </div>

            {user && wallets.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                  Credit Mined CSC to Wallet
                </label>
                <select
                  value={tapWalletId}
                  onChange={(e) => setTapWalletId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs font-mono text-slate-900 dark:text-slate-100"
                >
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label} ({truncateAddress(w.address, 6, 4)}) · {formatCscAmount(w.cscBalance)} CSC
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Interactive Miner Core */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] p-6 flex flex-col items-center text-center space-y-4">
              <button
                type="button"
                onClick={handleTapClick}
                disabled={!user || liveEnergyState.energy <= 0}
                className="w-40 h-40 rounded-full border-4 border-blue-500/30 bg-blue-600 hover:bg-blue-500 active:scale-95 disabled:opacity-50 disabled:active:scale-100 text-white flex flex-col items-center justify-center transition-all shadow-lg shadow-blue-600/20 select-none"
              >
                <Coins className="w-9 h-9 mb-1.5" />
                <span className="font-display text-sm font-bold tracking-tight">TAP TO MINE</span>
                <span className="text-[11px] font-mono opacity-85 mt-0.5">
                  +{tapPreview?.perTapRewardCsc ?? network?.tapBaseReward ?? 0.5} CSC
                </span>
              </button>

              <div className="h-5 text-xs font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                {queuedTaps > 0
                  ? `Syncing ${queuedTaps} tap${queuedTaps > 1 ? 's' : ''} to CSC-1...`
                  : lastTapFlash || (user ? 'Ready to mine' : 'Sign in to start mining')}
              </div>

              {/* Energy Meter */}
              <div className="w-full space-y-1.5 text-left">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-600 dark:text-slate-300">
                    Mining Energy
                  </span>
                  <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {user ? `${liveEnergyState.energy} / ${CSC_ENERGY_MAX}` : '0 / 100'}
                    {user && liveEnergyState.energy < CSC_ENERGY_MAX && (
                      <span className="text-slate-500 dark:text-slate-400 ml-2">
                        (+1 in {liveEnergyState.nextEnergyInSec}s)
                      </span>
                    )}
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all duration-300"
                    style={{
                      width: `${user ? Math.min(100, (liveEnergyState.energy / CSC_ENERGY_MAX) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Halving Era & Personal Stats */}
            <div className="grid grid-cols-3 gap-3 pt-1">
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Your Taps</div>
                <div className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                  {account?.totalTaps ?? 0}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Total Mined</div>
                <div className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                  {formatCscAmount(account?.totalMinedCsc ?? 0, 3)} CSC
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Next Halving</div>
                <div className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                  {formatCscAmount(halvingInfo.nextHalvingAt, 0)}
                </div>
              </div>
            </div>
          </div>

          {/* Right: Referral Growth Engine & Leaderboard */}
          <div className="lg:col-span-6 space-y-6">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-500" />
                    Referral Hash Boost & 5% Commission
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Every invitee grants +10 CSC to them, +15 CSC to you, +10% permanent tap power (up to +150%), and 5% ongoing tap yield.
                  </p>
                </div>
              </div>

              {account && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] p-3.5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Your Referral Code
                      </div>
                      <div className="text-sm font-bold font-mono text-slate-900 dark:text-slate-100">
                        {account.referralCode}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => copyText(account.referralCode, 'refcode')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0"
                      >
                        {copiedKey === 'refcode' ? (
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        Copy Code
                      </button>
                      <button
                        type="button"
                        onClick={() => copyText(inviteUrl, 'refurl')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap shrink-0"
                      >
                        {copiedKey === 'refurl' ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        Copy Invite Link
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
                    <div>
                      <span className="text-slate-500 dark:text-slate-400 block text-[11px]">
                        Invited Miners
                      </span>
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {account.referralCount}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400 block text-[11px]">
                        Tap Multiplier
                      </span>
                      <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                        +{account.referralMultiplierPct}%
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400 block text-[11px]">
                        Bonus Earned
                      </span>
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {formatCscAmount(account.referralBonusCsc, 3)} CSC
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Apply Referral Code */}
              {user && account && (
                account.referredByCode ? (
                  <div className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                    <Gift className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      Linked to sponsor code <span className="font-mono font-semibold">{account.referredByCode}</span> (+10 CSC welcome credited)
                    </span>
                  </div>
                ) : (
                  <form onSubmit={handleClaimReferral} className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={refCodeInput}
                      onChange={(e) => setRefCodeInput(e.target.value.toUpperCase())}
                      placeholder="Enter friend's referral code (e.g. CSC-ANTH7F2A)"
                      className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs font-mono text-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="submit"
                      disabled={busyAction === 'referral' || !refCodeInput.trim()}
                      className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold whitespace-nowrap shrink-0 transition-colors"
                    >
                      {busyAction === 'referral' ? 'Applying...' : 'Claim +10 CSC'}
                    </button>
                  </form>
                )
              )}

              {/* Active Referrals List */}
              {overview && overview.referrals.length > 0 && (
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Your Active Referrals ({overview.referrals.length})
                  </div>
                  <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-40 overflow-y-auto">
                    {overview.referrals.map((r) => (
                      <div
                        key={r.uid}
                        className="py-2 flex items-center justify-between text-xs"
                      >
                        <div>
                          <span className="font-medium text-slate-900 dark:text-slate-100">
                            @{r.handle}
                          </span>
                          <span className="text-slate-500 dark:text-slate-400 ml-2 font-mono">
                            {r.totalTaps} taps
                          </span>
                        </div>
                        <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                          +{r.commissionEarnedCsc} CSC
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Top Miners Leaderboard */}
            {overview && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-amber-500" />
                    CSC Network Holders & Miners
                  </h3>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Live Supabase Ranking
                  </span>
                </div>
                {overview.leaderboard.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    No miners registered yet. Sign in and tap to be #1 on CSC-1!
                  </p>
                ) : (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {overview.leaderboard.slice(0, 6).map((entry, idx) => (
                      <div
                        key={entry.uid}
                        className="py-2 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-5 text-center font-mono font-semibold text-slate-500">
                            #{idx + 1}
                          </span>
                          <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                            @{entry.handle}
                          </span>
                          {entry.referralCount > 0 && (
                            <span className="text-[11px] font-mono text-blue-600 dark:text-blue-400">
                              {entry.referralCount} refs
                            </span>
                          )}
                        </div>
                        <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                          {formatCscAmount(entry.totalCscHeld, 3)} CSC
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: AMM SWAP (CSC <-> USDT / USD1) + SOL BRIDGE */}
      {subTab === 'swap' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleExecuteSwap}
            className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  AMM Swap · CSC ↔ USDT / USD1
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Every swap shifts constant-product pool reserves (x · y = k) and drives live CSC market price.
                </p>
              </div>
              <button
                type="button"
                onClick={handleFlipSwapPair}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0"
              >
                <ArrowDownUp className="w-3.5 h-3.5" />
                Flip Pair
              </button>
            </div>

            {user && wallets.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                  Active ChainScope Wallet
                </label>
                <select
                  value={swapWalletId}
                  onChange={(e) => setSwapWalletId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs font-mono text-slate-900 dark:text-slate-100"
                >
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label} · {formatCscAmount(w.cscBalance)} CSC · {formatCscAmount(w.usdtBalance, 2)} USDT · {formatCscAmount(w.usd1Balance, 2)} USD1
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">You Pay</span>
                  {swapWallet && (
                    <button
                      type="button"
                      onClick={() => {
                        const bal = getWalletBalanceForAsset(swapWallet, swapAssetIn);
                        const gasReserve = swapAssetIn === 'CSC' ? CSC_GAS_FEES[swapGasTier] : 0;
                        setSwapAmountInput(String(Math.max(0, Number((bal - gasReserve).toFixed(4)))));
                      }}
                      className="text-[11px] font-mono text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Bal: {formatCscAmount(getWalletBalanceForAsset(swapWallet, swapAssetIn), 4)} {swapAssetIn}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={swapAmountInput}
                    onChange={(e) => setSwapAmountInput(e.target.value)}
                    className="w-full bg-transparent text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none"
                    placeholder="0.00"
                  />
                  <select
                    value={swapAssetIn}
                    onChange={(e) => {
                      const nextIn = e.target.value as CscAsset;
                      setSwapAssetIn(nextIn);
                      if (nextIn === swapAssetOut) {
                        setSwapAssetOut(nextIn === 'CSC' ? 'USDT' : 'CSC');
                      }
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] text-xs font-semibold text-slate-900 dark:text-slate-100"
                  >
                    <option value="CSC">CSC</option>
                    <option value="USDT">USDT</option>
                    <option value="USD1">USD1</option>
                  </select>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">You Receive (Est.)</span>
                  {swapWallet && (
                    <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                      Bal: {formatCscAmount(getWalletBalanceForAsset(swapWallet, swapAssetOut), 4)} {swapAssetOut}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-full text-lg font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 truncate">
                    {swapQuote ? formatCscAmount(swapQuote.amountOut, 6) : '0'}
                  </div>
                  <select
                    value={swapAssetOut}
                    onChange={(e) => {
                      const nextOut = e.target.value as CscAsset;
                      setSwapAssetOut(nextOut);
                      if (nextOut === swapAssetIn) {
                        setSwapAssetIn(nextOut === 'CSC' ? 'USDT' : 'CSC');
                      }
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] text-xs font-semibold text-slate-900 dark:text-slate-100"
                  >
                    <option value="USDT">USDT</option>
                    <option value="USD1">USD1</option>
                    <option value="CSC">CSC</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Gas Tier Selector */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                  <Fuel className="w-3.5 h-3.5 text-amber-500" />
                  ChainScope Gas Fee Tier (50% Burned)
                </span>
                {swapWallet && (
                  <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    Wallet Gas: {formatCscAmount(swapWallet.cscBalance, 4)} CSC
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(['standard', 'fast', 'turbo'] as CscGasTier[]).map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => setSwapGasTier(tier)}
                    className={`px-3 py-2 rounded-lg border text-xs font-medium capitalize transition-colors ${
                      swapGasTier === tier
                        ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div>{tier}</div>
                    <div className="font-mono text-[11px] opacity-80">
                      {CSC_GAS_FEES[tier]} CSC
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Quote Breakdown */}
            {swapQuote && swapQuote.amountIn > 0 && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] p-3.5 space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Pool Price Impact</span>
                  <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {swapQuote.priceImpactPct.toFixed(3)}%
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">New Pool Spot After Swap</span>
                  <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {formatCscUsdPrice(swapQuote.spotBeforeUsd)} → {formatCscUsdPrice(swapQuote.spotAfterUsd)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">AMM Fee / Gas Burn</span>
                  <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {formatCscAmount(swapQuote.feeAmount, 5)} {swapQuote.feeAsset} · {swapQuote.burnedCsc} CSC burned
                  </span>
                </div>
              </div>
            )}

            {user && swapWallet && swapWallet.cscBalance < CSC_GAS_FEES[swapGasTier] && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex items-center justify-between gap-3 text-xs text-amber-700 dark:text-amber-300">
                <span>
                  Insufficient CSC gas ({CSC_GAS_FEES[swapGasTier]} CSC needed). Tap once to mine free gas!
                </span>
                <button
                  type="button"
                  onClick={handleTapClick}
                  className="px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-semibold whitespace-nowrap shrink-0"
                >
                  Mine Free Gas
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={!user || busyAction === 'swap' || !swapQuote || swapQuote.amountOut <= 0}
              className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold transition-colors"
            >
              {busyAction === 'swap'
                ? 'Executing Swap on CSC-1...'
                : `Swap ${swapAssetIn} → ${swapAssetOut}`}
            </button>
          </form>

          {/* Right: Platform SOL -> USDT / USD1 / CSC Bridge */}
          <form
            onSubmit={handleBridgeSol}
            className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-4"
          >
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-500" />
                Fund USDT / USD1 / CSC from Platform SOL
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Convert SOL from your Launchpad wallet into ChainScope stablecoins or buy CSC directly via the live AMM at ${overview?.solUsdPrice.toFixed(2) ?? '185.00'}/SOL.
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">Available Platform SOL</span>
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {(profile?.solBalance ?? 0).toFixed(4)} SOL
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">Live Oracle Rate</span>
                <span className="font-mono text-slate-700 dark:text-slate-300">
                  1 SOL ≈ ${overview?.solUsdPrice.toFixed(2) ?? '185.00'} USD
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  SOL Amount
                </label>
                <input
                  type="number"
                  step="any"
                  min="0.001"
                  value={bridgeSolAmount}
                  onChange={(e) => setBridgeSolAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs font-mono text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Receive Asset
                </label>
                <select
                  value={bridgeTargetAsset}
                  onChange={(e) => setBridgeTargetAsset(e.target.value as CscAsset)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs font-semibold text-slate-900 dark:text-slate-100"
                >
                  <option value="USDT">USDT (1:1 USD)</option>
                  <option value="USD1">USD1 (1:1 USD)</option>
                  <option value="CSC">CSC (AMM Market Buy)</option>
                </select>
              </div>
            </div>

            <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
              Estimated credit:{' '}
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {(() => {
                  const sAmt = Number(bridgeSolAmount) || 0;
                  const usdVal = sAmt * (overview?.solUsdPrice || 185);
                  if (bridgeTargetAsset === 'CSC' && network) {
                    const q = quoteCscSwap({
                      assetIn: 'USDT',
                      assetOut: 'CSC',
                      amountIn: usdVal,
                      usdtPool: network.usdtPool,
                      usd1Pool: network.usd1Pool,
                      gasTier: 'standard',
                    });
                    return `${formatCscAmount(q.amountOut, 4)} CSC`;
                  }
                  return `${usdVal.toFixed(2)} ${bridgeTargetAsset}`;
                })()}
              </span>
            </div>

            <button
              type="submit"
              disabled={!user || !swapWallet || busyAction === 'bridge'}
              className="w-full py-2.5 px-4 rounded-lg border border-blue-500/40 bg-blue-600/10 hover:bg-blue-600/20 disabled:opacity-50 text-blue-600 dark:text-blue-400 text-xs font-semibold transition-colors"
            >
              {busyAction === 'bridge' ? 'Bridging SOL...' : `Bridge SOL → ${bridgeTargetAsset}`}
            </button>
          </form>
        </div>
      )}

      {/* TAB 3: CHANNELS, WALLET CREATION SYSTEM, INTER-WALLET SYNC & TRANSFERS */}
      {subTab === 'wallets' && (
        <div className="space-y-6">
          {/* Freshly Created Wallet Secret Backup Alert */}
          {freshCreatedSecret && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 sm:p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-2">
                    <KeyRound className="w-4 h-4" />
                    Save Your New ChainScope Wallet Recovery Phrase ({freshCreatedSecret.label})
                  </div>
                  <p className="text-xs text-amber-700/90 dark:text-amber-300/80 mt-0.5">
                    Keys are generated locally in your browser and never sent to Supabase. Back up this 12-word phrase now.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFreshCreatedSecret(null)}
                  className="text-xs font-medium text-amber-700 dark:text-amber-300 hover:underline whitespace-nowrap shrink-0"
                >
                  Done
                </button>
              </div>
              {freshCreatedSecret.mnemonic && (
                <div className="p-3 rounded-lg bg-white/80 dark:bg-[#0B0F17] border border-amber-500/30 font-mono text-xs text-slate-900 dark:text-slate-100 select-all">
                  {freshCreatedSecret.mnemonic}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() =>
                    copyText(freshCreatedSecret.mnemonic || freshCreatedSecret.address, 'freshseed')
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                >
                  {copiedKey === 'freshseed' ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  Copy Recovery Phrase
                </button>
                <span className="font-mono text-amber-800 dark:text-amber-200">
                  CSC-1: {freshCreatedSecret.address}
                </span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Wallet Creation System & Multi-Wallet Synced Vaults */}
            <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    ChainScope Network Wallets (CSC-1)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Create cryptographic BIP-39 sub-wallets, import seeds, and sync inter-wallet balances live.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowImportPanel((v) => !v)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    {showImportPanel ? 'Close Import' : 'Import Seed / Key'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSyncWallets()}
                    disabled={busyAction === 'sync'}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'sync' ? 'animate-spin' : ''}`} />
                    Sync All
                  </button>
                </div>
              </div>

              {/* Create New Wallet Bar */}
              {user && (
                <form onSubmit={handleCreateWallet} className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={newWalletLabel}
                    onChange={(e) => setNewWalletLabel(e.target.value)}
                    placeholder="New wallet label (e.g. Cold Savings, Trading Vault)"
                    className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="submit"
                    disabled={busyAction === 'create_wallet'}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {busyAction === 'create_wallet' ? 'Generating...' : 'Create CSC Wallet'}
                  </button>
                </form>
              )}

              {/* Optional Import Drawer */}
              {showImportPanel && user && (
                <form
                  onSubmit={handleImportWallet}
                  className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] p-4 space-y-3"
                >
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Import Recovery Phrase (12/24 words) or Private Key into CSC-1
                  </div>
                  <input
                    type="text"
                    value={importLabel}
                    onChange={(e) => setImportLabel(e.target.value)}
                    placeholder="Wallet label (optional)"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] text-xs text-slate-900 dark:text-slate-100"
                  />
                  <textarea
                    rows={2}
                    value={importSecretInput}
                    onChange={(e) => setImportSecretInput(e.target.value)}
                    placeholder="Paste 12/24-word mnemonic, EVM 0x private key, or Solana Base58 secret key..."
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] text-xs font-mono text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="submit"
                    disabled={busyAction === 'import_wallet' || !importSecretInput.trim()}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold"
                  >
                    {busyAction === 'import_wallet' ? 'Importing...' : 'Derive & Sync Wallet'}
                  </button>
                </form>
              )}

              {/* Wallet List */}
              {wallets.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
                  Sign in to auto-provision your Primary ChainScope Wallet (`CSC1...`).
                </div>
              ) : (
                <div className="space-y-3">
                  {wallets.map((w) => {
                    const localSecret = localSecrets[w.address];
                    const isRevealed = revealedAddressSecret === w.address;
                    return (
                      <div
                        key={w.id}
                        className={`rounded-lg border p-4 space-y-3 ${
                          w.isPrimary
                            ? 'border-blue-500/40 bg-blue-500/5'
                            : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {w.label}
                              </span>
                              {w.isPrimary && (
                                <span className="px-1.5 py-0.5 rounded bg-blue-600 text-white text-[10px] font-semibold">
                                  Primary
                                </span>
                              )}
                              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                {w.origin} · nonce {w.nonce}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs font-mono text-slate-600 dark:text-slate-300">
                              <span>{truncateAddress(w.address, 10, 8)}</span>
                              <button
                                type="button"
                                onClick={() => copyText(w.address, w.id)}
                                className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                              >
                                {copiedKey === w.id ? (
                                  <>
                                    <Check className="w-3 h-3" /> Copied
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" /> Copy CSC Address
                                  </>
                                )}
                              </button>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {localSecret?.mnemonic && (
                              <button
                                type="button"
                                onClick={() =>
                                  setRevealedAddressSecret(isRevealed ? null : w.address)
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                {isRevealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                {isRevealed ? 'Hide Seed' : 'Seed'}
                              </button>
                            )}
                            {!w.isPrimary && (
                              <button
                                type="button"
                                onClick={() => void handleSetPrimaryWallet(w.id)}
                                disabled={busyAction === `primary_${w.id}`}
                                className="px-2.5 py-1 rounded border border-blue-500/40 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-500/10"
                              >
                                Set Primary
                              </button>
                            )}
                          </div>
                        </div>

                        {isRevealed && localSecret?.mnemonic && (
                          <div className="p-2.5 rounded bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700 text-[11px] font-mono text-slate-800 dark:text-slate-200">
                            {localSecret.mnemonic}
                          </div>
                        )}

                        <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800/80 text-xs font-mono tabular-nums">
                          <div>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-sans">
                              CSC Balance
                            </span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {formatCscAmount(w.cscBalance, 4)} CSC
                            </span>
                          </div>
                          <div>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-sans">
                              USDT Balance
                            </span>
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                              {formatCscAmount(w.usdtBalance, 4)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-sans">
                              USD1 Balance
                            </span>
                            <span className="font-semibold text-blue-600 dark:text-blue-400">
                              {formatCscAmount(w.usd1Balance, 4)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right: Inter-Wallet & Wallet-to-Wallet Transfer Form */}
            <form
              onSubmit={handleTransferSubmit}
              className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-4 h-fit"
            >
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <ArrowRightLeft className="w-4 h-4 text-blue-500" />
                  Wallet-to-Wallet & Inter-Wallet Transfer
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Send CSC, USDT, or USD1 between your own wallets or to any CSC1... network address.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTransferMode('inter')}
                  className={`py-2 px-3 rounded-lg border text-xs font-semibold transition-colors ${
                    transferMode === 'inter'
                      ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Inter-Wallet Sync
                </button>
                <button
                  type="button"
                  onClick={() => setTransferMode('external')}
                  className={`py-2 px-3 rounded-lg border text-xs font-semibold transition-colors ${
                    transferMode === 'external'
                      ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  External CSC-1 Address
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  From Wallet
                </label>
                <select
                  value={transferFromWalletId}
                  onChange={(e) => setTransferFromWalletId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs font-mono text-slate-900 dark:text-slate-100"
                >
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label} · {formatCscAmount(w.cscBalance)} CSC · {formatCscAmount(w.usdtBalance, 2)} USDT
                    </option>
                  ))}
                </select>
              </div>

              {transferMode === 'inter' ? (
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Destination (Your Other Wallet)
                  </label>
                  {wallets.length < 2 ? (
                    <div className="p-2.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
                      Create a second CSC wallet on the left to use one-click Inter-Wallet Transfers.
                    </div>
                  ) : (
                    <select
                      value={transferToWalletId}
                      onChange={(e) => setTransferToWalletId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs font-mono text-slate-900 dark:text-slate-100"
                    >
                      {wallets
                        .filter((w) => w.id !== transferFromWalletId)
                        .map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.label} ({truncateAddress(w.address, 6, 4)})
                          </option>
                        ))}
                    </select>
                  )}
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Recipient CSC1... Address or @handle
                  </label>
                  <input
                    type="text"
                    value={transferToAddress}
                    onChange={(e) => setTransferToAddress(e.target.value)}
                    placeholder="CSC1... or @trader_handle"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs font-mono text-slate-900 dark:text-slate-100"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Asset
                  </label>
                  <select
                    value={transferAsset}
                    onChange={(e) => setTransferAsset(e.target.value as CscAsset)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs font-semibold text-slate-900 dark:text-slate-100"
                  >
                    <option value="CSC">CSC</option>
                    <option value="USDT">USDT</option>
                    <option value="USD1">USD1</option>
                  </select>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      Amount
                    </label>
                    {transferFromWallet && (
                      <button
                        type="button"
                        onClick={() => {
                          const bal = getWalletBalanceForAsset(transferFromWallet, transferAsset);
                          const gas = transferAsset === 'CSC' ? CSC_GAS_FEES[transferGasTier] : 0;
                          setTransferAmount(String(Math.max(0, Number((bal - gas).toFixed(4)))));
                        }}
                        className="text-[11px] font-mono text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Max
                      </button>
                    )}
                  </div>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs font-mono text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Gas Tier (Paid in CSC)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['standard', 'fast', 'turbo'] as CscGasTier[]).map((tier) => (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => setTransferGasTier(tier)}
                      className={`px-2 py-1.5 rounded-lg border text-[11px] font-mono capitalize ${
                        transferGasTier === tier
                          ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                          : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {tier} ({CSC_GAS_FEES[tier]})
                    </button>
                  ))}
                </div>
              </div>

              <input
                type="text"
                value={transferNote}
                onChange={(e) => setTransferNote(e.target.value)}
                placeholder="Optional memo (stored on CSC-1 ledger)"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs text-slate-900 dark:text-slate-100"
              />

              <button
                type="submit"
                disabled={
                  !user ||
                  busyAction === 'transfer' ||
                  (transferMode === 'inter' && wallets.length < 2)
                }
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                {busyAction === 'transfer' ? 'Broadcasting on CSC-1...' : 'Send & Sync Balances'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* TAB 4: NETWORK BLOCK EXPLORER & LEDGER */}
      {subTab === 'ledger' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-500" />
                ChainScope Network Ledger (CSC-1)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Immutable block history of tap emissions, referral payouts, AMM swaps, and wallet-to-wallet transfers.
                {overview?.storageMode === 'snapshot_ledger' && (
                  <span className="ml-1 text-slate-500">
                    (Running on live Supabase ledger · optional normalized SQL tables in supabase/schema.sql)
                  </span>
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'swap', label: 'Swaps' },
                  { id: 'inter_wallet_transfer', label: 'Inter-Wallet' },
                  { id: 'wallet_transfer', label: 'Transfers' },
                  { id: 'tap_mint', label: 'Tap Mints' },
                  { id: 'referral_bonus', label: 'Referrals' },
                  { id: 'sol_bridge', label: 'SOL Bridge' },
                ] as Array<{ id: 'all' | CscTxType; label: string }>
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setLedgerFilter(f.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                    ledgerFilter === f.id
                      ? 'bg-blue-600 text-white'
                      : 'border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {filteredTransactions.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
              No transactions recorded yet for this filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 pr-4 font-medium">Block / Hash</th>
                    <th className="py-2.5 pr-4 font-medium">Type</th>
                    <th className="py-2.5 pr-4 font-medium">From → To</th>
                    <th className="py-2.5 pr-4 font-medium">Value</th>
                    <th className="py-2.5 pr-4 font-medium">Gas / Burn</th>
                    <th className="py-2.5 font-medium text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
                  {filteredTransactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="py-2.5 pr-4 font-mono tabular-nums">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          #{tx.blockHeight}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {truncateAddress(tx.txHash, 8, 6)}
                        </div>
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className="font-medium text-slate-800 dark:text-slate-200 capitalize">
                          {tx.type.replace(/_/g, ' ')}
                        </span>
                        {tx.note && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 max-w-[210px] truncate">
                            {tx.note}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-4">
                        <div className="text-slate-900 dark:text-slate-100 truncate max-w-[220px]">
                          {tx.fromLabel || truncateAddress(tx.fromAddress, 6, 4)}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[220px]">
                          → {tx.toLabel || truncateAddress(tx.toAddress, 6, 4)}
                        </div>
                      </td>
                      <td className="py-2.5 pr-4 font-mono tabular-nums">
                        {tx.type === 'swap' || tx.type === 'sol_bridge' ? (
                          <div>
                            <span className="text-slate-500 dark:text-slate-400">
                              {formatCscAmount(tx.amountIn, 4)} {tx.assetIn}
                            </span>
                            <span className="mx-1 text-slate-400">→</span>
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                              {formatCscAmount(tx.amountOut, 4)} {tx.assetOut}
                            </span>
                          </div>
                        ) : (
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {formatCscAmount(tx.amountOut, 4)} {tx.assetOut}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {tx.gasFeeCsc > 0 ? (
                          <div>
                            <span>{tx.gasFeeCsc} CSC</span>
                            {tx.burnedCsc > 0 && (
                              <span className="text-amber-600 dark:text-amber-400 ml-1.5 inline-flex items-center gap-0.5">
                                <Flame className="w-3 h-3" />
                                {tx.burnedCsc}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">0 gas</span>
                        )}
                      </td>
                      <td className="py-2.5 text-right text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formatTimestamp(tx.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Security Boundary Footer */}
      <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 pt-1">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
        <span>
          Client-generated recovery phrases and private keys stay in local browser storage only. Supabase stores public CSC-1 addresses, pool reserves, and block ledger entries.
        </span>
      </div>
    </div>
  );
}
