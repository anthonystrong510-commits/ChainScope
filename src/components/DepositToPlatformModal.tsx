import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Coins,
  Loader2,
  RefreshCw,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { ChainId, ChainScanResult, WalletEntry, WalletScanState } from '../types/wallet';
import { CHAIN_META, CHAIN_ORDER, formatTokenBalance, formatUsd, truncateAddress } from '../utils/chains';
import { scanWalletAllChains, signDepositAuthorization } from '../services/scanner';
import { depositFromConnectedWallet } from '../services/launchpad';

interface DepositToPlatformModalProps {
  wallets: WalletEntry[];
  scanStates?: Record<string, WalletScanState>;
  initialWalletId?: string;
  onClose: () => void;
  onGoConnectWallet?: () => void;
  onSuccess?: () => Promise<void> | void;
}

export function DepositToPlatformModal({
  wallets,
  scanStates = {},
  initialWalletId,
  onClose,
  onGoConnectWallet,
  onSuccess,
}: DepositToPlatformModalProps) {
  const { user, profile, refreshAccount, signInWithGoogle, signInWithBrowserRedirect } = useAuth();

  const eligibleWallets = useMemo(
    () => wallets.filter((w) => w.origin !== 'watch'),
    [wallets]
  );

  const [selectedWalletId, setSelectedWalletId] = useState<string>(() => {
    if (initialWalletId && eligibleWallets.some((w) => w.id === initialWalletId)) {
      return initialWalletId;
    }
    return eligibleWallets[0]?.id || '';
  });

  const selectedWallet = useMemo(
    () => eligibleWallets.find((w) => w.id === selectedWalletId) || eligibleWallets[0] || null,
    [eligibleWallets, selectedWalletId]
  );

  const [localScans, setLocalScans] = useState<Record<string, Record<string, ChainScanResult>>>({});
  const [scanningWallet, setScanningWallet] = useState(false);
  const [solUsdPrice, setSolUsdPrice] = useState<number>(185);
  const [selectedChain, setSelectedChain] = useState<ChainId>('solana');
  const [amountInput, setAmountInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/prices')
      .then((r) => r.json())
      .then((d: { prices?: { solana?: { usd?: number } } }) => {
        if (typeof d?.prices?.solana?.usd === 'number' && d.prices.solana.usd > 0) {
          setSolUsdPrice(d.prices.solana.usd);
        }
      })
      .catch(() => {});
  }, []);

  const activeChainsMap = useMemo(() => {
    if (!selectedWallet) return {};
    return localScans[selectedWallet.id] || scanStates[selectedWallet.id]?.chains || {};
  }, [selectedWallet, localScans, scanStates]);

  const availableChainOptions = useMemo(() => {
    if (!selectedWallet) return [];
    const options: Array<{
      chainId: ChainId;
      label: string;
      symbol: string;
      address: string;
      balance: number;
      usdPrice: number;
      usdValue: number;
    }> = [];

    for (const cid of CHAIN_ORDER) {
      const isSol = cid === 'solana';
      const addr = isSol ? selectedWallet.solanaAddress : selectedWallet.evmAddress;
      if (!addr) continue;
      const scanned = activeChainsMap[cid];
      const meta = CHAIN_META[cid];
      options.push({
        chainId: cid,
        label: meta.name,
        symbol: meta.symbol,
        address: addr,
        balance: scanned?.status === 'ok' ? scanned.nativeBalance : 0,
        usdPrice: scanned?.nativeUsdPrice || (isSol ? solUsdPrice : 0),
        usdValue: scanned?.nativeUsdValue || 0,
      });
    }
    return options;
  }, [selectedWallet, activeChainsMap, solUsdPrice]);

  // Auto-scan selected wallet if not already scanned
  const handleRescanSelected = async (targetWallet = selectedWallet) => {
    if (!targetWallet) return;
    setScanningWallet(true);
    try {
      const result = await scanWalletAllChains(targetWallet);
      setLocalScans((prev) => ({
        ...prev,
        [targetWallet.id]: result.chains,
      }));
    } catch {
      // ignore transient scan error
    } finally {
      setScanningWallet(false);
    }
  };

  useEffect(() => {
    if (!selectedWallet) return;
    const hasExisting =
      Object.keys(localScans[selectedWallet.id] || {}).length > 0 ||
      Object.keys(scanStates[selectedWallet.id]?.chains || {}).length > 0;
    if (!hasExisting) {
      void handleRescanSelected(selectedWallet);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWallet?.id]);

  // Pick the best funded chain automatically when options change
  useEffect(() => {
    if (availableChainOptions.length === 0) return;
    const currentValid = availableChainOptions.find((o) => o.chainId === selectedChain);
    if (!currentValid || (currentValid.balance <= 0 && availableChainOptions.some((o) => o.balance > 0))) {
      const funded = availableChainOptions
        .filter((o) => o.balance > 0)
        .sort((a, b) => b.usdValue - a.usdValue)[0];
      setSelectedChain(funded?.chainId || availableChainOptions[0].chainId);
    }
  }, [availableChainOptions, selectedChain]);

  const activeOption = useMemo(
    () => availableChainOptions.find((o) => o.chainId === selectedChain) || availableChainOptions[0] || null,
    [availableChainOptions, selectedChain]
  );

  const amountNum = Number(amountInput) || 0;
  const estSolCredit = useMemo(() => {
    if (!activeOption || amountNum <= 0 || solUsdPrice <= 0) return 0;
    if (activeOption.chainId === 'solana') return amountNum;
    if (activeOption.usdPrice <= 0) return 0;
    return (amountNum * activeOption.usdPrice) / solUsdPrice;
  }, [activeOption, amountNum, solUsdPrice]);

  const handleSetPct = (pct: number) => {
    if (!activeOption || activeOption.balance <= 0) return;
    const raw = activeOption.balance * pct;
    const trimmed = Number(raw.toFixed(6));
    setAmountInput(trimmed > 0 ? String(trimmed) : '');
    setError(null);
  };

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWallet || !activeOption) return;
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError('Enter an amount greater than 0.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      let signature: string | undefined;
      if (
        selectedWallet.origin === 'browser-evm' ||
        selectedWallet.origin === 'browser-solana'
      ) {
        signature = await signDepositAuthorization({
          chain: activeOption.chainId,
          address: activeOption.address,
          amount: amountNum,
          symbol: activeOption.symbol,
          walletLabel: selectedWallet.label,
        });
      }

      const res = await depositFromConnectedWallet({
        walletId: selectedWallet.id,
        walletLabel: selectedWallet.label,
        walletOrigin: selectedWallet.origin,
        sourceAddress: activeOption.address,
        chain: activeOption.chainId,
        nativeAmount: amountNum,
        signature,
      });

      await refreshAccount();
      await onSuccess?.();
      setAmountInput('');
      setSuccessMsg(
        `Added +${res.solCredited.toFixed(4)} SOL (${res.nativeAmount} ${res.symbol} from ${selectedWallet.label}) to your Platform Wallet.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add coins to platform wallet');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add Coins to Platform Wallet"
    >
      <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Coins className="w-4 h-4 text-emerald-500" />
              Add Coins to Platform Wallet
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Move real on-chain balance from your connected or imported wallets into your Supabase
              Launchpad trading liquidity.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Close deposit modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {!user ? (
          <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-center space-y-3">
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Sign in to create or access your persistent Supabase Platform Wallet first.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => void signInWithGoogle()}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
              >
                Sign In with Google
              </button>
              <button
                type="button"
                onClick={() => void signInWithBrowserRedirect()}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
              >
                Sign In With Browser
              </button>
            </div>
          </div>
        ) : eligibleWallets.length === 0 ? (
          <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-center space-y-3">
            <Wallet className="w-6 h-6 mx-auto text-blue-500" />
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              No Connected or Owned Wallets Loaded
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Connect MetaMask, Phantom, Trust Wallet, Coinbase Wallet, or import your seed/private
              key to fund your Platform Wallet. (Watch-only wallets cannot deposit.)
            </p>
            {onGoConnectWallet && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onGoConnectWallet();
                }}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
              >
                Connect or Import Wallet
              </button>
            )}
          </div>
        ) : (
          <form onSubmit={handleDeposit} className="space-y-4">
            {/* Current Platform Balance */}
            {profile && (
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] flex items-center justify-between text-xs">
                <span className="text-slate-500">Current Platform Wallet (@{profile.handle})</span>
                <span className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  {profile.solBalance.toFixed(4)} SOL
                </span>
              </div>
            )}

            {/* Source Connected Wallet Selector */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Source Connected Wallet
                </label>
                <button
                  type="button"
                  onClick={() => void handleRescanSelected()}
                  disabled={scanningWallet}
                  className="inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${scanningWallet ? 'animate-spin' : ''}`} />
                  {scanningWallet ? 'Scanning…' : 'Refresh Balance'}
                </button>
              </div>
              <select
                value={selectedWallet?.id || ''}
                onChange={(e) => {
                  setSelectedWalletId(e.target.value);
                  setError(null);
                  setSuccessMsg(null);
                }}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100"
              >
                {eligibleWallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label} ({truncateAddress(w.solanaAddress || w.evmAddress || '', 6, 4)})
                  </option>
                ))}
              </select>
            </div>

            {/* Chain / Asset Selector */}
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                Network & Asset to Transfer
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-0.5">
                {availableChainOptions.map((opt) => {
                  const active = opt.chainId === activeOption?.chainId;
                  return (
                    <button
                      key={opt.chainId}
                      type="button"
                      onClick={() => {
                        setSelectedChain(opt.chainId);
                        setError(null);
                      }}
                      className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                        active
                          ? 'border-blue-500 bg-blue-500/10'
                          : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between font-semibold">
                        <span>{opt.label}</span>
                        <span className="font-mono text-blue-500">{opt.symbol}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] font-mono text-slate-500 tabular-nums">
                        <span>
                          {formatTokenBalance(opt.balance)} {opt.symbol}
                        </span>
                        <span>{opt.usdValue > 0 ? formatUsd(opt.usdValue) : '—'}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Amount Input */}
            {activeOption && (
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <label className="font-medium text-slate-600 dark:text-slate-400">
                    Amount ({activeOption.symbol})
                  </label>
                  <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                    Verified Balance: {formatTokenBalance(activeOption.balance)} {activeOption.symbol}
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={amountInput}
                    onChange={(e) => {
                      setAmountInput(e.target.value);
                      setError(null);
                    }}
                    placeholder={`0.00 ${activeOption.symbol}`}
                    className="flex-1 min-w-0 px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {[0.25, 0.5, 1].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      disabled={activeOption.balance <= 0}
                      onClick={() => handleSetPct(pct)}
                      className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 text-[11px] font-mono font-medium"
                    >
                      {pct === 1 ? 'MAX' : `${pct * 100}%`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Conversion Summary */}
            {activeOption && (
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-xs space-y-1.5 tabular-nums">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Source Address</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">
                    {truncateAddress(activeOption.address, 8, 6)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Live SOL Equivalent Credited</span>
                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    +{estSolCredit.toFixed(4)} SOL
                  </span>
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {successMsg && (
              <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-600 dark:text-emerald-400 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{successMsg}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={submitting || !activeOption || amountNum <= 0}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
              >
                {submitting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ArrowRight className="w-3.5 h-3.5" />
                )}
                {submitting ? 'Verifying & Crediting…' : 'Add to Platform Wallet'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
