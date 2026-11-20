import { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Download,
  ExternalLink,
  RefreshCw,
  Repeat,
  Search,
  XCircle,
} from 'lucide-react';
import type { ChainId, ChainTransaction, WalletEntry, WalletScanState } from '../types/wallet';
import {
  CHAIN_META,
  CHAIN_ORDER,
  formatTimestamp,
  truncateAddress,
} from '../utils/chains';
import { ChainIcon } from './ChainIcon';

interface TransactionsViewProps {
  wallets: WalletEntry[];
  selectedWalletId: string | 'all';
  scanStates: Record<string, WalletScanState>;
  onScanActive: () => void;
}

export function TransactionsView({
  wallets,
  selectedWalletId,
  scanStates,
  onScanActive,
}: TransactionsViewProps) {
  const [chainFilter, setChainFilter] = useState<ChainId | 'all'>('all');
  const [directionFilter, setDirectionFilter] = useState<'all' | 'in' | 'out'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const activeWallets = useMemo(() => {
    if (selectedWalletId === 'all') return wallets;
    return wallets.filter((w) => w.id === selectedWalletId);
  }, [wallets, selectedWalletId]);

  const isScanning = activeWallets.some((w) => scanStates[w.id]?.scanning);

  const transactions = useMemo(() => {
    const list: ChainTransaction[] = [];
    for (const w of activeWallets) {
      const st = scanStates[w.id];
      if (!st) continue;
      for (const cid of CHAIN_ORDER) {
        const res = st.chains[cid];
        if (!res || res.status !== 'ok') continue;
        for (const tx of res.transactions) {
          list.push({
            ...tx,
            walletId: w.id,
            walletLabel: w.label,
          });
        }
      }
    }

    return list
      .filter((tx) => (chainFilter === 'all' ? true : tx.chainId === chainFilter))
      .filter((tx) => (directionFilter === 'all' ? true : tx.direction === directionFilter))
      .filter((tx) => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return true;
        return (
          tx.hash.toLowerCase().includes(q) ||
          tx.from.toLowerCase().includes(q) ||
          tx.to.toLowerCase().includes(q) ||
          (tx.method || '').toLowerCase().includes(q) ||
          CHAIN_META[tx.chainId].name.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [activeWallets, scanStates, chainFilter, directionFilter, searchQuery]);

  return (
    <div className="space-y-5">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Cross-Chain Transaction Ledger
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Live transaction activity pulled from Ethereum, Polygon, Arbitrum, Base, Optimism, and
            Solana mainnet explorers and RPCs.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (transactions.length === 0) return;
              const header = [
                'Timestamp',
                'Network',
                'Wallet',
                'Direction',
                'Amount',
                'Symbol',
                'Fee',
                'Status',
                'From',
                'To',
                'Hash',
              ];
              const rows = transactions.map((tx) => [
                new Date(tx.timestamp).toISOString(),
                CHAIN_META[tx.chainId].name,
                `"${(tx.walletLabel || '').replace(/"/g, '""')}"`,
                tx.direction,
                tx.valueFormatted,
                tx.symbol,
                tx.feeFormatted,
                tx.status,
                tx.from,
                tx.to,
                tx.hash,
              ]);
              const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `chainscope-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            disabled={transactions.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Download CSV
          </button>
          <button
            type="button"
            onClick={onScanActive}
            disabled={isScanning}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium whitespace-nowrap transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
            {isScanning ? 'Syncing Ledger…' : 'Refresh Ledger'}
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
        {/* Chain Segmented Tabs */}
        <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17]">
          <button
            type="button"
            onClick={() => setChainFilter('all')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              chainFilter === 'all'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            All Chains
          </button>
          {(['ethereum', 'polygon', 'solana', 'arbitrum', 'base', 'optimism'] as ChainId[]).map(
            (cid) => (
              <button
                key={cid}
                type="button"
                onClick={() => setChainFilter(cid)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  chainFilter === cid
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {CHAIN_META[cid].name}
              </button>
            )
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17]">
            {(['all', 'in', 'out'] as const).map((dir) => (
              <button
                key={dir}
                type="button"
                onClick={() => setDirectionFilter(dir)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  directionFilter === dir
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {dir === 'all' ? 'All Flow' : dir === 'in' ? 'Incoming' : 'Outgoing'}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search hash or address…"
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 w-52"
            />
          </div>
        </div>
      </div>

      {/* Ledger Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4">Network & Method</th>
                <th className="py-3 px-4">Tx Hash</th>
                <th className="py-3 px-4">Flow & Counterparty</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Amount</th>
                <th className="py-3 px-4 text-right">Fee</th>
                <th className="py-3 px-4 text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
              {isScanning && transactions.length === 0 ? (
                Array.from({ length: 6 }).map((_, idx) => (
                  <tr key={idx} className="h-11">
                    <td className="px-4 py-2.5" colSpan={7}>
                      <div className="h-4 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 px-4 text-center text-slate-500 dark:text-slate-400">
                    No on-chain transactions found for this filter. Freshly generated wallets show zero
                    transactions until funded on mainnet.
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => {
                  const meta = CHAIN_META[tx.chainId];
                  const counterparty = tx.direction === 'in' ? tx.from : tx.to;
                  return (
                    <tr
                      key={`${tx.chainId}-${tx.hash}`}
                      className="h-11 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <ChainIcon chainId={tx.chainId} size={20} className="shrink-0" />
                          <div>
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {meta.name}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {tx.method || (tx.direction === 'in' ? 'Receive' : tx.direction === 'out' ? 'Transfer' : 'Contract Call')}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-2.5 font-mono whitespace-nowrap">
                        <a
                          href={meta.explorerTxUrl(tx.hash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {truncateAddress(tx.hash, 8, 6)}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </td>

                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {tx.direction === 'in' ? (
                            <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          ) : tx.direction === 'out' ? (
                            <ArrowUpRight className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          ) : (
                            <Repeat className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          )}
                          <span className="text-slate-500 dark:text-slate-400">
                            {tx.direction === 'in' ? 'From' : 'To'}
                          </span>
                          <span className="font-mono text-slate-800 dark:text-slate-200">
                            {truncateAddress(counterparty, 6, 4)}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {tx.status === 'confirmed' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Confirmed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 font-medium">
                            <XCircle className="w-3.5 h-3.5" />
                            Failed
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                        <span
                          className={
                            tx.direction === 'in'
                              ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                              : 'text-slate-900 dark:text-slate-100 font-medium'
                          }
                        >
                          {tx.direction === 'in' ? '+' : tx.direction === 'out' ? '-' : ''}
                          {tx.valueFormatted} {tx.symbol}
                        </span>
                      </td>

                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {tx.feeFormatted} {tx.symbol}
                      </td>

                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formatTimestamp(tx.timestamp)}
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
