import { useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Coins,
  Copy,
  ExternalLink,
  Loader2,
  QrCode,
  RefreshCw,
  Search,
  Wallet,
} from 'lucide-react';
import type {
  ActiveTab,
  ChainId,
  ChainScanResult,
  TokenHolding,
  WalletEntry,
  WalletScanState,
} from '../types/wallet';
import {
  CHAIN_META,
  CHAIN_ORDER,
  formatTimestamp,
  formatTokenBalance,
  formatUsd,
  truncateAddress,
} from '../utils/chains';
import { ChainIcon } from './ChainIcon';

interface PortfolioViewProps {
  wallets: WalletEntry[];
  selectedWalletId: string | 'all';
  scanStates: Record<string, WalletScanState>;
  autoRefreshSec: number;
  onChangeAutoRefresh: (sec: number) => void;
  onScanActive: () => void;
  onNavigate: (tab: ActiveTab) => void;
  onOpenReceive: (wallet: WalletEntry) => void;
  onOpenDeposit?: (wallet?: WalletEntry) => void;
}

export function PortfolioView({
  wallets,
  selectedWalletId,
  scanStates,
  autoRefreshSec,
  onChangeAutoRefresh,
  onScanActive,
  onNavigate,
  onOpenReceive,
  onOpenDeposit,
}: PortfolioViewProps) {
  const [chainFilter, setChainFilter] = useState<ChainId | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [hideDust, setHideDust] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);

  const activeWallets = useMemo(() => {
    if (selectedWalletId === 'all') return wallets;
    return wallets.filter((w) => w.id === selectedWalletId);
  }, [wallets, selectedWalletId]);

  const isAnyScanning = activeWallets.some((w) => scanStates[w.id]?.scanning);

  const lastScannedAt = useMemo(() => {
    let latest = 0;
    for (const w of activeWallets) {
      const t = scanStates[w.id]?.lastScannedAt || 0;
      if (t > latest) latest = t;
    }
    return latest || null;
  }, [activeWallets, scanStates]);

  // Aggregate per-chain totals across active wallets
  const aggregatedChains = useMemo(() => {
    const map: Record<
      ChainId,
      {
        chainId: ChainId;
        nativeBalance: number;
        nativeUsdValue: number;
        nativeUsdPrice: number;
        nativeChange24h: number;
        totalUsd: number;
        blockNumber: number;
        rpcSource: string;
        hasData: boolean;
        hasError: boolean;
        errorMsg?: string;
        tokenCount: number;
      }
    > = {} as never;

    for (const cid of CHAIN_ORDER) {
      map[cid] = {
        chainId: cid,
        nativeBalance: 0,
        nativeUsdValue: 0,
        nativeUsdPrice: 0,
        nativeChange24h: 0,
        totalUsd: 0,
        blockNumber: 0,
        rpcSource: '',
        hasData: false,
        hasError: false,
        tokenCount: 0,
      };
    }

    for (const w of activeWallets) {
      const st = scanStates[w.id];
      if (!st) continue;
      for (const cid of CHAIN_ORDER) {
        const res: ChainScanResult | undefined = st.chains[cid];
        if (!res) continue;
        const bucket = map[cid];
        if (res.status === 'ok') {
          bucket.hasData = true;
          bucket.nativeBalance += res.nativeBalance;
          bucket.nativeUsdValue += res.nativeUsdValue;
          bucket.nativeUsdPrice = res.nativeUsdPrice;
          bucket.nativeChange24h = res.nativeChange24h;
          bucket.totalUsd += res.totalUsd;
          bucket.blockNumber = Math.max(bucket.blockNumber, res.blockNumber);
          bucket.rpcSource = res.rpcSource;
          bucket.tokenCount += res.tokens.length;
        } else {
          bucket.hasError = true;
          bucket.errorMsg = res.error;
        }
      }
    }

    return CHAIN_ORDER.map((cid) => map[cid]);
  }, [activeWallets, scanStates]);

  // Flatten all holdings (native + tokens) for the Asset Matrix
  const allHoldings = useMemo(() => {
    const rows: Array<
      TokenHolding & {
        walletId: string;
        walletLabel: string;
        address: string;
      }
    > = [];

    for (const w of activeWallets) {
      const st = scanStates[w.id];
      if (!st) continue;
      for (const cid of CHAIN_ORDER) {
        const res = st.chains[cid];
        if (!res || res.status !== 'ok') continue;
        const meta = CHAIN_META[cid];
        rows.push({
          chainId: cid,
          symbol: meta.symbol,
          name: `${meta.name} Native`,
          balance: res.nativeBalance,
          usdPrice: res.nativeUsdPrice,
          usdValue: res.nativeUsdValue,
          change24h: res.nativeChange24h,
          isNative: true,
          walletId: w.id,
          walletLabel: w.label,
          address: res.address,
        });
        for (const tok of res.tokens) {
          rows.push({
            ...tok,
            walletId: w.id,
            walletLabel: w.label,
            address: res.address,
          });
        }
      }
    }

    return rows
      .filter((r) => (chainFilter === 'all' ? true : r.chainId === chainFilter))
      .filter((r) => (!hideDust ? true : r.usdValue >= 1 || r.balance > 0))
      .filter((r) => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return true;
        return (
          r.symbol.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          CHAIN_META[r.chainId].name.toLowerCase().includes(q) ||
          r.walletLabel.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.usdValue - a.usdValue || b.balance - a.balance);
  }, [activeWallets, scanStates, chainFilter, hideDust, searchQuery]);

  const totalNetWorth = useMemo(
    () => aggregatedChains.reduce((sum, c) => sum + c.totalUsd, 0),
    [aggregatedChains]
  );

  const weighted24hChange = useMemo(() => {
    if (totalNetWorth <= 0) return 0;
    const weighted = allHoldings.reduce(
      (sum, h) => sum + h.usdValue * (Number.isFinite(h.change24h) ? h.change24h : 0),
      0
    );
    return weighted / totalNetWorth;
  }, [allHoldings, totalNetWorth]);

  const activeNetworksCount = useMemo(
    () => aggregatedChains.filter((c) => c.hasData).length,
    [aggregatedChains]
  );

  const nonZeroAssetsCount = useMemo(
    () => allHoldings.filter((h) => h.balance > 0).length,
    [allHoldings]
  );

  const handleCopy = async (addr: string) => {
    await navigator.clipboard.writeText(addr);
    setCopiedAddr(addr);
    setTimeout(() => setCopiedAddr(null), 1500);
  };

  if (wallets.length === 0) {
    return (
      <div className="max-w-2xl mx-auto my-12 p-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-center">
        <div className="w-12 h-12 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto mb-4">
          <Wallet className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          Create or Import a Real Wallet
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 max-w-md mx-auto leading-relaxed">
          No wallets are currently loaded. Import a 12 or 24-word recovery phrase, paste your EVM or
          Solana private key, connect MetaMask or Phantom, or create a brand-new wallet in Seed
          Phrase Studio.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate('import')}
            className="px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
          >
            Import or Connect Wallet
          </button>
          <button
            type="button"
            onClick={() => onNavigate('seed-studio')}
            className="px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-sm font-medium transition-colors"
          >
            Create New Wallet (12/24 Words)
          </button>
        </div>
      </div>
    );
  }

  const singleWallet = activeWallets.length === 1 ? activeWallets[0] : null;

  return (
    <div className="space-y-6">
      {/* Wallet Address Strip when viewing a single wallet */}
      {singleWallet && (
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 min-w-0">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Active Profile</div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {singleWallet.label}
              </div>
            </div>
            {singleWallet.evmAddress && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-500 dark:text-slate-400">EVM:</span>
                <span className="font-mono text-slate-800 dark:text-slate-200">
                  {truncateAddress(singleWallet.evmAddress, 8, 6)}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(singleWallet.evmAddress!)}
                  className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                  aria-label="Copy EVM address"
                >
                  {copiedAddr === singleWallet.evmAddress ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            )}
            {singleWallet.solanaAddress && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-500 dark:text-slate-400">Solana:</span>
                <span className="font-mono text-slate-800 dark:text-slate-200">
                  {truncateAddress(singleWallet.solanaAddress, 8, 6)}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(singleWallet.solanaAddress!)}
                  className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                  aria-label="Copy Solana address"
                >
                  {copiedAddr === singleWallet.solanaAddress ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onOpenDeposit && singleWallet.origin !== 'watch' && (
              <button
                type="button"
                onClick={() => onOpenDeposit(singleWallet)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium whitespace-nowrap transition-colors"
              >
                <Coins className="w-3.5 h-3.5" />
                Add to Platform Wallet
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenReceive(singleWallet)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap transition-colors"
            >
              <QrCode className="w-3.5 h-3.5" />
              Receive QR
            </button>
          </div>
        </div>
      )}

      {/* Top 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Total Portfolio Value
          </div>
          <div className="mt-2 text-2xl font-display font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {formatUsd(totalNetWorth)}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs tabular-nums">
            {weighted24hChange >= 0 ? (
              <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-medium">
                <ArrowUpRight className="w-3.5 h-3.5" />+{weighted24hChange.toFixed(2)}%
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400 font-medium">
                <ArrowDownRight className="w-3.5 h-3.5" />
                {weighted24hChange.toFixed(2)}%
              </span>
            )}
            <span className="text-slate-400">·</span>
            <span className="text-slate-500 dark:text-slate-400">24h weighted</span>
          </div>
        </div>

        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Active Networks
          </div>
          <div className="mt-2 text-2xl font-display font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {activeNetworksCount} / {CHAIN_ORDER.length}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            Ethereum, Polygon, Solana & L2s
          </div>
        </div>

        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Detected Non-Zero Balances
          </div>
          <div className="mt-2 text-2xl font-display font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {nonZeroAssetsCount}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            Native coins & ERC-20 / SPL tokens
          </div>
        </div>

        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Real-Time Scanner
            </span>
            <select
              value={autoRefreshSec}
              onChange={(e) => onChangeAutoRefresh(Number(e.target.value))}
              aria-label="Auto scan interval"
              className="text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 px-2 py-1"
            >
              <option value={0}>Manual</option>
              <option value={15}>Every 15s</option>
              <option value={30}>Every 30s</option>
              <option value={60}>Every 60s</option>
            </select>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="text-xs text-slate-600 dark:text-slate-300 tabular-nums">
              {isAnyScanning ? (
                <span className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-medium">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Scanning RPCs…
                </span>
              ) : lastScannedAt ? (
                `Updated ${formatTimestamp(lastScannedAt)}`
              ) : (
                'Ready to scan'
              )}
            </div>
            <button
              type="button"
              onClick={onScanActive}
              disabled={isAnyScanning}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium whitespace-nowrap transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isAnyScanning ? 'animate-spin' : ''}`} />
              Scan Now
            </button>
          </div>
        </div>
      </div>

      {/* Allocation Bar across Networks */}
      {totalNetWorth > 0 && (
        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Cross-Chain Capital Distribution
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {formatUsd(totalNetWorth)} total
            </span>
          </div>
          <div className="h-2.5 w-full rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800 flex">
            {aggregatedChains
              .filter((c) => c.totalUsd > 0)
              .map((c) => {
                const pct = (c.totalUsd / totalNetWorth) * 100;
                return (
                  <div
                    key={c.chainId}
                    style={{
                      width: `${Math.max(pct, 1.2)}%`,
                      backgroundColor: CHAIN_META[c.chainId].accentHex,
                    }}
                    title={`${CHAIN_META[c.chainId].name}: ${formatUsd(c.totalUsd)} (${pct.toFixed(1)}%)`}
                  />
                );
              })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
            {aggregatedChains
              .filter((c) => c.totalUsd > 0)
              .map((c) => {
                const pct = (c.totalUsd / totalNetWorth) * 100;
                return (
                  <div key={c.chainId} className="flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-xs shrink-0"
                      style={{ backgroundColor: CHAIN_META[c.chainId].accentHex }}
                    />
                    <span className="text-slate-700 dark:text-slate-300 font-medium">
                      {CHAIN_META[c.chainId].name}
                    </span>
                    <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Multi-Chain Balance Cards Grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Network Balances
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Click a network to filter holdings below
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
          {aggregatedChains.map((c) => {
            const meta = CHAIN_META[c.chainId];
            const isSelected = chainFilter === c.chainId;
            return (
              <button
                key={c.chainId}
                type="button"
                onClick={() => setChainFilter(isSelected ? 'all' : c.chainId)}
                className={`text-left p-4 rounded-xl border transition-colors ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-500/10'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ChainIcon chainId={c.chainId} size={24} className="shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {meta.name}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
                        {c.hasData && c.blockNumber > 0
                          ? `Block #${c.blockNumber.toLocaleString()}`
                          : c.hasError
                          ? 'RPC unavailable'
                          : isAnyScanning
                          ? 'Scanning…'
                          : 'Not queried'}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                      {formatUsd(c.totalUsd)}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                      {formatTokenBalance(c.nativeBalance)} {meta.symbol}
                    </div>
                  </div>
                </div>
                <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="truncate">{c.rpcSource || meta.family.toUpperCase()}</span>
                  <span className="tabular-nums shrink-0">
                    {c.tokenCount > 0 ? `${c.tokenCount} tokens` : 'Native only'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Unified Asset Holdings Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Asset Holdings
            </h3>
            {chainFilter !== 'all' && (
              <button
                type="button"
                onClick={() => setChainFilter('all')}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
              >
                Clear {CHAIN_META[chainFilter].name} filter
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideDust}
                onChange={(e) => setHideDust(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500"
              />
              Hide zero balances
            </label>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter asset or network…"
                className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4">Asset</th>
                <th className="py-3 px-4">Network</th>
                {selectedWalletId === 'all' && <th className="py-3 px-4">Wallet</th>}
                <th className="py-3 px-4 text-right">Spot Price</th>
                <th className="py-3 px-4 text-right">24h</th>
                <th className="py-3 px-4 text-right">Balance</th>
                <th className="py-3 px-4 text-right">Value (USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
              {isAnyScanning && allHoldings.length === 0 ? (
                Array.from({ length: 5 }).map((_, idx) => (
                  <tr key={idx} className="h-11">
                    <td className="px-4 py-2.5" colSpan={selectedWalletId === 'all' ? 7 : 6}>
                      <div className="h-4 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : allHoldings.length === 0 ? (
                <tr>
                  <td
                    colSpan={selectedWalletId === 'all' ? 7 : 6}
                    className="py-10 px-4 text-center text-slate-500 dark:text-slate-400"
                  >
                    No assets match your current filters.
                  </td>
                </tr>
              ) : (
                allHoldings.map((item, idx) => {
                  const meta = CHAIN_META[item.chainId];
                  const explorerUrl = item.contractAddress
                    ? meta.explorerAddressUrl(item.contractAddress)
                    : meta.explorerAddressUrl(item.address);
                  return (
                    <tr
                      key={`${item.walletId}-${item.chainId}-${item.symbol}-${item.contractAddress || 'native'}-${idx}`}
                      className="h-11 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <ChainIcon chainId={item.chainId} size={20} className="shrink-0" />
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                              <span>{item.symbol}</span>
                              {item.contractAddress && (
                                <a
                                  href={explorerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-slate-400 hover:text-blue-500"
                                  title="View token contract"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[180px]">
                              {item.name}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {meta.name}
                      </td>
                      {selectedWalletId === 'all' && (
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {item.walletLabel}
                        </td>
                      )}
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {item.usdPrice > 0 ? formatUsd(item.usdPrice) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                        {item.usdPrice > 0 ? (
                          <span
                            className={
                              item.change24h >= 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-red-600 dark:text-red-400'
                            }
                          >
                            {item.change24h >= 0 ? '+' : ''}
                            {item.change24h.toFixed(2)}%
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {formatTokenBalance(item.balance)} {item.symbol}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {formatUsd(item.usdValue)}
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
  );
}
