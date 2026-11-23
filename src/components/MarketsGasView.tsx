import { useCallback, useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import {
  AlertCircle,
  ArrowUpDown,
  Check,
  CheckCircle2,
  Copy,
  FileSignature,
  Fuel,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { ChainId, WalletEntry, WalletScanState } from '../types/wallet';
import { formatUsd, truncateAddress } from '../utils/chains';
import { ChainIcon } from './ChainIcon';
import { signCustomMessageWithWallet } from '../services/scanner';

interface NetworkGasRow {
  chainId: ChainId;
  name: string;
  symbol: string;
  status: 'ok' | 'error';
  blockNumber: number;
  gasUnitLabel: string;
  standardFeeValue: number;
  fastFeeValue: number;
  nativeUsdPrice: number;
  transferNative: number;
  transferUsd: number;
  tokenTransferUsd: number;
  swapUsd: number;
  latencyMs: number;
  rpcSource: string;
  error?: string;
}

interface PriceEntry {
  usd: number;
  usd_24h_change: number;
}

interface GasTrackerPayload {
  fetchedAt: number;
  priceSource: string;
  prices: Record<string, PriceEntry>;
  networks: NetworkGasRow[];
}

interface MarketsGasViewProps {
  wallets: WalletEntry[];
  selectedWalletId: string | 'all';
  scanStates: Record<string, WalletScanState>;
}

const CONVERTER_ASSETS: Array<{ id: string; symbol: string; name: string }> = [
  { id: 'solana', symbol: 'SOL', name: 'Solana' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  { id: 'wrapped-bitcoin', symbol: 'WBTC', name: 'Wrapped Bitcoin' },
  { id: 'binancecoin', symbol: 'BNB', name: 'BNB' },
  { id: 'matic-network', symbol: 'POL', name: 'Polygon' },
  { id: 'usd-coin', symbol: 'USDC', name: 'USD Coin' },
  { id: 'tether', symbol: 'USDT', name: 'Tether' },
  { id: 'arbitrum', symbol: 'ARB', name: 'Arbitrum' },
  { id: 'optimism', symbol: 'OP', name: 'Optimism' },
  { id: 'chainlink', symbol: 'LINK', name: 'Chainlink' },
  { id: 'uniswap', symbol: 'UNI', name: 'Uniswap' },
  { id: 'aave', symbol: 'AAVE', name: 'Aave' },
  { id: 'jupiter-exchange-solana', symbol: 'JUP', name: 'Jupiter' },
  { id: 'bonk', symbol: 'BONK', name: 'Bonk' },
];

export function MarketsGasView({
  wallets,
  selectedWalletId,
  scanStates,
}: MarketsGasViewProps) {
  const [data, setData] = useState<GasTrackerPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Converter state
  const [fromAssetId, setFromAssetId] = useState('ethereum');
  const [toAssetId, setToAssetId] = useState('solana');
  const [fromAmount, setFromAmount] = useState('1');

  // Signer & Verifier state
  const [signWalletId, setSignWalletId] = useState<string>(
    () => wallets.find((w) => w.origin === 'browser-evm' || w.origin === 'browser-solana')?.id || ''
  );
  const [signMessageText, setSignMessageText] = useState(
    'ChainScope Wallet Ownership Verification'
  );
  const [signedOutput, setSignedOutput] = useState('');
  const [signingBusy, setSigningBusy] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [copiedSig, setCopiedSig] = useState(false);

  const [verifyMsg, setVerifyMsg] = useState('ChainScope Wallet Ownership Verification');
  const [verifySig, setVerifySig] = useState('');
  const [verifyResult, setVerifyResult] = useState<{
    valid: boolean;
    signer?: string;
    error?: string;
  } | null>(null);

  const fetchGas = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const res = await fetch('/api/gas-tracker');
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Gas tracker unavailable (HTTP ${res.status})`);
      }
      const json = (await res.json()) as GasTrackerPayload & { error?: string };
      if (!res.ok) {
        throw new Error(json.error || 'Failed to fetch live gas tracker');
      }
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach gas tracker');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchGas(true);
  }, [fetchGas]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      void fetchGas(false);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, fetchGas]);

  const activeWallets = useMemo(() => {
    if (selectedWalletId === 'all') return wallets;
    return wallets.filter((w) => w.id === selectedWalletId);
  }, [wallets, selectedWalletId]);

  const getWalletGasReadiness = useCallback(
    (chainId: ChainId, requiredNativeForSwap: number) => {
      if (activeWallets.length === 0) {
        return { label: 'No wallet loaded', tone: 'muted' as const, balance: 0 };
      }
      let maxBal = 0;
      let hasScanned = false;
      for (const w of activeWallets) {
        const chainRes = scanStates[w.id]?.chains[chainId];
        if (chainRes && chainRes.status === 'ok') {
          hasScanned = true;
          if (chainRes.nativeBalance > maxBal) {
            maxBal = chainRes.nativeBalance;
          }
        }
      }
      if (!hasScanned) {
        return { label: 'Scan wallet', tone: 'muted' as const, balance: 0 };
      }
      const minThreshold = Math.max(requiredNativeForSwap * 2, 1e-7);
      if (maxBal >= minThreshold) {
        return { label: 'Gas ready', tone: 'ok' as const, balance: maxBal };
      }
      if (maxBal > 0) {
        return { label: 'Low gas', tone: 'warn' as const, balance: maxBal };
      }
      return { label: '0 balance', tone: 'warn' as const, balance: 0 };
    },
    [activeWallets, scanStates]
  );

  // Spot converter math
  const conversionResult = useMemo(() => {
    const prices = data?.prices || {};
    const fromPrice = prices[fromAssetId]?.usd || 0;
    const toPrice = prices[toAssetId]?.usd || 0;
    const amt = Number(fromAmount);
    if (!Number.isFinite(amt) || amt <= 0 || fromPrice <= 0 || toPrice <= 0) {
      return { usdValue: 0, outputAmount: 0, rate: 0 };
    }
    const usdValue = amt * fromPrice;
    return {
      usdValue,
      outputAmount: usdValue / toPrice,
      rate: fromPrice / toPrice,
    };
  }, [data?.prices, fromAssetId, toAssetId, fromAmount]);

  const signableWallets = useMemo(
    () => wallets.filter((w) => w.origin === 'browser-evm' || w.origin === 'browser-solana'),
    [wallets]
  );

  const handleSignMessage = async () => {
    const target = signableWallets.find((w) => w.id === signWalletId) || signableWallets[0];
    if (!target) {
      setSignError('Connect a browser or mobile wallet extension first to sign messages.');
      return;
    }
    if (!signMessageText.trim()) {
      setSignError('Enter a message to sign.');
      return;
    }
    setSigningBusy(true);
    setSignError(null);
    try {
      const sig = await signCustomMessageWithWallet(target, signMessageText);
      setSignedOutput(sig);
      if (target.origin !== 'browser-solana') {
        setVerifyMsg(signMessageText);
        setVerifySig(sig);
      }
    } catch (err) {
      setSignError(err instanceof Error ? err.message : 'Message signature cancelled or failed.');
    } finally {
      setSigningBusy(false);
    }
  };

  const handleVerifyEvmSig = () => {
    if (!verifyMsg.trim() || !verifySig.trim()) {
      setVerifyResult({ valid: false, error: 'Provide both the exact message and 0x signature.' });
      return;
    }
    try {
      const recovered = ethers.verifyMessage(verifyMsg, verifySig.trim());
      setVerifyResult({ valid: true, signer: recovered });
    } catch (err) {
      setVerifyResult({
        valid: false,
        error: err instanceof Error ? err.message : 'Invalid EVM ECDSA signature format.',
      });
    }
  };

  const fromMeta = CONVERTER_ASSETS.find((a) => a.id === fromAssetId);
  const toMeta = CONVERTER_ASSETS.find((a) => a.id === toAssetId);

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Multi-Chain Gas Station & Market Tools
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Live RPC gas prices across 7 networks · Spot asset converter · Cryptographic signature verifier
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAutoRefresh((v) => !v)}
            className={`px-3 py-2 rounded-lg border text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              autoRefresh
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {autoRefresh ? 'Auto-Refresh: 15s' : 'Auto-Refresh: Off'}
          </button>

          <button
            type="button"
            onClick={() => void fetchGas(true)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium whitespace-nowrap shrink-0 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Live Gas
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl border border-red-500/30 bg-red-500/10 text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 1. Live 7-Chain Gas Tracker Table */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Fuel className="w-4 h-4 text-blue-500" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Live Network Gas & Fee Estimates
            </h2>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {data
              ? `Prices: ${data.priceSource} · Updated ${new Date(data.fetchedAt).toLocaleTimeString()}`
              : 'Querying live RPC nodes…'}
          </div>
        </div>

        {/* Mobile Gas Cards (< md) */}
        <div className="md:hidden divide-y divide-slate-200/70 dark:divide-slate-800/80 text-xs">
          {loading && !data ? (
            <div className="py-10 px-4 text-center text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
              Measuring live gas across Ethereum, Polygon, Arbitrum, Base, Optimism, BSC &amp; Solana…
            </div>
          ) : (
            (data?.networks || []).map((row) => {
              const swapNativeCost =
                row.nativeUsdPrice > 0 ? row.swapUsd / row.nativeUsdPrice : row.transferNative;
              const readiness = getWalletGasReadiness(row.chainId, swapNativeCost);
              return (
                <div key={`m-${row.chainId}`} className="p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ChainIcon chainId={row.chainId} size={20} className="shrink-0" />
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {row.name}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono truncate">
                          {row.rpcSource} · {row.latencyMs}ms
                        </div>
                      </div>
                    </div>
                    <div className="text-right font-mono tabular-nums shrink-0">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {row.status === 'ok'
                          ? `${
                              row.standardFeeValue >= 100
                                ? Math.round(row.standardFeeValue).toLocaleString()
                                : row.standardFeeValue.toFixed(row.standardFeeValue < 1 ? 3 : 2)
                            } ${row.gasUnitLabel}`
                          : 'Offline'}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {row.nativeUsdPrice > 0 ? formatUsd(row.nativeUsdPrice) : '—'}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1.5 border-t border-slate-100 dark:border-slate-800/70 font-mono tabular-nums text-[11px]">
                    <div>
                      <span className="text-slate-500 block font-sans">Transfer</span>
                      <span>{row.status === 'ok' ? formatUsd(row.transferUsd) : '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block font-sans">DEX Swap</span>
                      <span>{row.status === 'ok' ? formatUsd(row.swapUsd) : '—'}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-slate-500 block font-sans">Status</span>
                      <span
                        className={
                          readiness.tone === 'ok'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : readiness.tone === 'warn'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-slate-400'
                        }
                      >
                        {readiness.label}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4">Network</th>
                <th className="py-3 px-4 text-right">Spot Price</th>
                <th className="py-3 px-4 text-right">Standard Fee</th>
                <th className="py-3 px-4 text-right">Transfer (21k)</th>
                <th className="py-3 px-4 text-right">Token Tx</th>
                <th className="py-3 px-4 text-right">DEX Swap</th>
                <th className="py-3 px-4 text-right">Latest Block</th>
                <th className="py-3 px-4 text-right">Wallet Readiness</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/80 text-xs">
              {loading && !data ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                    Measuring live gas across Ethereum, Polygon, Arbitrum, Base, Optimism, BSC & Solana…
                  </td>
                </tr>
              ) : (
                (data?.networks || []).map((row) => {
                  const swapNativeCost =
                    row.nativeUsdPrice > 0 ? row.swapUsd / row.nativeUsdPrice : row.transferNative;
                  const readiness = getWalletGasReadiness(row.chainId, swapNativeCost);
                  return (
                    <tr
                      key={row.chainId}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <ChainIcon chainId={row.chainId} size={22} />
                          <div>
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {row.name}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                              {row.rpcSource} · {row.latencyMs}ms
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {row.nativeUsdPrice > 0 ? formatUsd(row.nativeUsdPrice) : '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {row.status === 'ok'
                          ? `${
                              row.standardFeeValue >= 100
                                ? Math.round(row.standardFeeValue).toLocaleString()
                                : row.standardFeeValue.toFixed(row.standardFeeValue < 1 ? 3 : 2)
                            } ${row.gasUnitLabel}`
                          : 'Offline'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {row.status === 'ok' ? formatUsd(row.transferUsd) : '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {row.status === 'ok' ? formatUsd(row.tokenTransferUsd) : '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                        {row.status === 'ok' ? formatUsd(row.swapUsd) : '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {row.blockNumber > 0 ? `#${row.blockNumber.toLocaleString()}` : '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {readiness.tone === 'ok' && (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                            {readiness.label} ({readiness.balance.toFixed(4)} {row.symbol})
                          </span>
                        )}
                        {readiness.tone === 'warn' && (
                          <span className="text-amber-600 dark:text-amber-400 font-medium">
                            {readiness.label}
                          </span>
                        )}
                        {readiness.tone === 'muted' && (
                          <span className="text-slate-400">{readiness.label}</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 2. Split Grid: Live Asset Converter + Web3 Message Signer & Verifier */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* Live Multi-Asset Converter */}
        <section className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-col justify-between space-y-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Cross-Chain Spot Price Converter
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                Live USD Spot
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 items-end">
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">
                  From Asset
                </label>
                <select
                  value={fromAssetId}
                  onChange={(e) => setFromAssetId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs font-medium text-slate-900 dark:text-slate-100"
                >
                  {CONVERTER_ASSETS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.symbol} — {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => {
                  setFromAssetId(toAssetId);
                  setToAssetId(fromAssetId);
                }}
                title="Swap assets"
                className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 self-end justify-self-center transition-colors"
              >
                <ArrowUpDown className="w-4 h-4" />
              </button>

              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">
                  To Asset
                </label>
                <select
                  value={toAssetId}
                  onChange={(e) => setToAssetId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs font-medium text-slate-900 dark:text-slate-100"
                >
                  {CONVERTER_ASSETS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.symbol} — {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">
                Amount ({fromMeta?.symbol})
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={fromAmount}
                onChange={(e) => setFromAmount(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="p-4 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200/80 dark:border-slate-800 space-y-1.5">
              <div className="text-xs text-slate-500 dark:text-slate-400">Converted Equivalent</div>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {conversionResult.outputAmount.toLocaleString(undefined, {
                  maximumFractionDigits: conversionResult.outputAmount < 1 ? 6 : 4,
                })}{' '}
                {toMeta?.symbol}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                {formatUsd(conversionResult.usdValue)} · 1 {fromMeta?.symbol} ={' '}
                {conversionResult.rate.toFixed(6)} {toMeta?.symbol}
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800 grid grid-cols-3 gap-3 text-xs">
            {['solana', 'ethereum', 'wrapped-bitcoin'].map((id) => {
              const p = data?.prices?.[id];
              const label = id === 'solana' ? 'SOL' : id === 'ethereum' ? 'ETH' : 'BTC';
              const chg = p?.usd_24h_change || 0;
              return (
                <div key={id}>
                  <div className="text-slate-500 dark:text-slate-400">{label} Spot</div>
                  <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {p ? formatUsd(p.usd) : '—'}
                  </div>
                  <div
                    className={`font-mono text-[11px] tabular-nums ${
                      chg >= 0 ? 'text-emerald-500' : 'text-red-500'
                    }`}
                  >
                    {chg >= 0 ? '+' : ''}
                    {chg.toFixed(2)}%
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Web3 Message Signer & Signature Verifier */}
        <section className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileSignature className="w-4 h-4 text-blue-500" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Message Signer & Signature Verifier
              </h2>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">ECDSA / Ed25519</span>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                  Connected Browser Wallet
                </label>
                <select
                  value={signWalletId}
                  onChange={(e) => setSignWalletId(e.target.value)}
                  disabled={signableWallets.length === 0}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs text-slate-900 dark:text-slate-100 disabled:opacity-50"
                >
                  {signableWallets.length === 0 ? (
                    <option value="">No browser/mobile wallet connected</option>
                  ) : (
                    signableWallets.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.label} ({truncateAddress(w.evmAddress || w.solanaAddress || '', 5, 4)})
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => void handleSignMessage()}
                  disabled={signingBusy || signableWallets.length === 0}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-medium whitespace-nowrap transition-colors"
                >
                  {signingBusy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-3.5 h-3.5" />
                  )}
                  Sign Message
                </button>
              </div>
            </div>

            <input
              type="text"
              value={signMessageText}
              onChange={(e) => setSignMessageText(e.target.value)}
              placeholder="Message to sign with wallet…"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs text-slate-900 dark:text-slate-100"
            />

            {signError && (
              <div className="text-xs text-red-500">{signError}</div>
            )}

            {signedOutput && (
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono text-slate-700 dark:text-slate-300 truncate">
                  {signedOutput}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(signedOutput);
                    setCopiedSig(true);
                    setTimeout(() => setCopiedSig(false), 1500);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-[11px] shrink-0"
                >
                  {copiedSig ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  {copiedSig ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-200/70 dark:border-slate-800 space-y-2.5">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Verify Any EVM Signature (ECDSA Recovery)
            </div>
            <input
              type="text"
              value={verifyMsg}
              onChange={(e) => setVerifyMsg(e.target.value)}
              placeholder="Original plain-text message"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs text-slate-900 dark:text-slate-100"
            />
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={verifySig}
                onChange={(e) => setVerifySig(e.target.value)}
                placeholder="0x signature hex…"
                className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs font-mono text-slate-900 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={handleVerifyEvmSig}
                className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap shrink-0 transition-colors"
              >
                Verify Signer
              </button>
            </div>

            {verifyResult && (
              <div
                className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${
                  verifyResult.valid
                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                    : 'bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400'
                }`}
              >
                {verifyResult.valid ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span className="font-mono break-all">
                      Recovered Signer: {verifyResult.signer}
                    </span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{verifyResult.error}</span>
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
