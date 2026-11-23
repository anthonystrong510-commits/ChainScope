import {
  Activity,
  ArrowLeftRight,
  Coins,
  Crown,
  Fuel,
  KeyRound,
  Layers,
  Moon,
  Plus,
  QrCode,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sun,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import type { ActiveTab, WalletEntry, WalletScanState } from '../types/wallet';
import { formatUsd, truncateAddress } from '../utils/chains';
import { PWAInstallButton } from './PWAInstallButton';

interface SidebarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  wallets: WalletEntry[];
  selectedWalletId: string | 'all';
  onSelectWallet: (id: string | 'all') => void;
  scanStates: Record<string, WalletScanState>;
  onScanWallet: (walletId: string) => void;
  onDeleteWallet: (walletId: string) => void;
  onOpenReceive: (wallet: WalletEntry) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onOpenAdmin?: () => void;
}

function getOriginLabel(origin: WalletEntry['origin']): string {
  switch (origin) {
    case 'seed':
      return 'Seed Phrase';
    case 'private-key':
      return 'Private Key';
    case 'keystore':
      return 'Keystore';
    case 'browser-evm':
      return 'EVM Extension';
    case 'browser-solana':
      return 'Solana Extension';
    case 'watch':
      return 'Watch-Only';
  }
}

export function Sidebar({
  activeTab,
  onSelectTab,
  wallets,
  selectedWalletId,
  onSelectWallet,
  scanStates,
  onScanWallet,
  onDeleteWallet,
  onOpenReceive,
  theme,
  onToggleTheme,
  mobileOpen,
  onCloseMobile,
  onOpenAdmin,
}: SidebarProps) {
  const getWalletUsdTotal = (walletId: string) => {
    const st = scanStates[walletId];
    if (!st) return 0;
    return Object.values(st.chains).reduce((sum, c) => sum + (c?.totalUsd ?? 0), 0);
  };

  const combinedTotalUsd = wallets.reduce((sum, w) => sum + getWalletUsdTotal(w.id), 0);

  const navItems: Array<{ id: ActiveTab; label: string; icon: typeof Layers }> = [
    { id: 'portfolio', label: 'Portfolio & Scanner', icon: Layers },
    { id: 'transactions', label: 'Transaction Ledger', icon: Activity },
    { id: 'csc', label: 'ChainScope Coin (CSC)', icon: Coins },
    { id: 'p2p', label: 'P2P Exchange', icon: ArrowLeftRight },
    { id: 'launchpad', label: 'Meme Launchpad', icon: Rocket },
    { id: 'markets', label: 'Gas & Markets', icon: Fuel },
    { id: 'import', label: 'Import & Connect', icon: Plus },
    { id: 'seed-studio', label: 'Seed Phrase Studio', icon: KeyRound },
  ];

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white dark:bg-[#0F1521] border-r border-slate-200 dark:border-slate-800/90 w-[280px] max-w-[85vw] lg:w-[264px]">
      {/* Brand Wordmark */}
      <div className="h-14 sm:h-16 px-4 sm:px-5 flex items-center justify-between border-b border-slate-200 dark:border-slate-800/90 shrink-0">
        <button
          type="button"
          onClick={() => {
            onSelectTab('portfolio');
            onCloseMobile();
          }}
          className="flex items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-md"
        >
          <span className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </span>
          <span className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
            ChainScope
          </span>
        </button>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleTheme}
            className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            className="lg:hidden p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close navigation menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Primary Navigation */}
      <nav className="px-3 py-3 space-y-1 border-b border-slate-200 dark:border-slate-800/90 overflow-y-auto shrink-0 max-h-[48vh]">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectTab(item.id);
                onCloseMobile();
              }}
              className={`w-full min-h-[44px] flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                active
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Multi-Wallet Switcher */}
      <div className="flex-1 min-h-0 flex flex-col px-3 py-4">
        <div className="flex items-center justify-between px-2 mb-2.5">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            Wallets ({wallets.length})
          </span>
          <button
            type="button"
            onClick={() => {
              onSelectTab('import');
              onCloseMobile();
            }}
            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
          >
            Add Wallet
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1 pr-0.5">
          {wallets.length > 1 && (
            <button
              type="button"
              onClick={() => {
                onSelectWallet('all');
                if (activeTab === 'import' || activeTab === 'seed-studio' || activeTab === 'launchpad') {
                  onSelectTab('portfolio');
                }
                onCloseMobile();
              }}
              className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                selectedWalletId === 'all'
                  ? 'border-blue-500/40 bg-blue-50 dark:bg-blue-500/10 text-slate-900 dark:text-slate-100'
                  : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold truncate">All Wallets Combined</span>
                <span className="text-xs font-mono font-semibold tabular-nums">
                  {formatUsd(combinedTotalUsd)}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {wallets.length} active profiles
              </div>
            </button>
          )}

          {wallets.length === 0 ? (
            <div className="px-3 py-6 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
              <Wallet className="w-5 h-5 mx-auto text-slate-400 mb-2" />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No wallets added yet.
              </p>
              <button
                type="button"
                onClick={() => {
                  onSelectTab('import');
                  onCloseMobile();
                }}
                className="mt-2.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors"
              >
                Import or Connect
              </button>
            </div>
          ) : (
            wallets.map((w) => {
              const isSelected = selectedWalletId === w.id;
              const st = scanStates[w.id];
              const usd = getWalletUsdTotal(w.id);
              const primaryAddr = w.evmAddress || w.solanaAddress || '';
              return (
                <div
                  key={w.id}
                  className={`group rounded-lg border transition-colors ${
                    isSelected
                      ? 'border-blue-500/40 bg-blue-50/70 dark:bg-blue-500/10'
                      : 'border-transparent hover:bg-slate-100/80 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectWallet(w.id);
                      if (activeTab === 'import' || activeTab === 'seed-studio' || activeTab === 'launchpad') {
                        onSelectTab('portfolio');
                      }
                      onCloseMobile();
                    }}
                    className="w-full text-left px-3 pt-2.5 pb-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {w.label}
                      </span>
                      <span className="text-xs font-mono font-medium text-slate-900 dark:text-slate-100 tabular-nums shrink-0">
                        {formatUsd(usd)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="font-mono truncate">{truncateAddress(primaryAddr, 6, 4)}</span>
                      <span className="shrink-0">{getOriginLabel(w.origin)}</span>
                    </div>
                  </button>

                  <div className="flex items-center justify-between px-3 pb-2 pt-0.5 text-[11px] text-slate-400">
                    <span className="truncate">
                      {w.evmAddress && w.solanaAddress
                        ? 'EVM + Solana'
                        : w.evmAddress
                        ? 'EVM Networks'
                        : 'Solana'}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onOpenReceive(w)}
                        title="Receive QR"
                        aria-label={`Show receive QR for ${w.label}`}
                        className="p-2 lg:p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onScanWallet(w.id)}
                        disabled={st?.scanning}
                        title="Rescan balances"
                        aria-label={`Rescan ${w.label}`}
                        className="p-2 lg:p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${st?.scanning ? 'animate-spin text-blue-500' : ''}`} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteWallet(w.id)}
                        title="Remove wallet"
                        aria-label={`Remove ${w.label}`}
                        className="p-2 lg:p-1 rounded hover:bg-red-100 dark:hover:bg-red-950/60 text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Security Boundary Note + Phone Shortcut + Admin Link (Admins Only) */}
      <div className="px-4 py-3 pb-safe border-t border-slate-200 dark:border-slate-800/90 space-y-2.5 shrink-0">
        <PWAInstallButton variant="sidebar" />
        {onOpenAdmin && (
          <button
            type="button"
            onClick={() => {
              onOpenAdmin();
              onCloseMobile();
            }}
            className="w-full min-h-[40px] flex items-center justify-between px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15 text-xs font-medium text-amber-600 dark:text-amber-400 transition-colors"
          >
            <span className="flex items-center gap-2">
              <Crown className="w-3.5 h-3.5" />
              KingAdmin Panel
            </span>
            <span className="font-mono text-[10px]">/kingadmin</span>
          </button>
        )}
        <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
          Keys stay strictly in browser memory. Only public addresses are queried on-chain.
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block shrink-0">{sidebarContent}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-50 h-full">{sidebarContent}</div>
        </div>
      )}
    </>
  );
}
