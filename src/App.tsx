import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu, Plus, RefreshCw, Rocket } from 'lucide-react';
import type { ActiveTab, ChainScanResult, WalletEntry, WalletScanState } from './types/wallet';
import { scanWalletAllChains } from './services/scanner';
import { syncWalletSnapshotToSupabase } from './services/supabaseSync';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Sidebar } from './components/Sidebar';
import { PortfolioView } from './components/PortfolioView';
import { TransactionsView } from './components/TransactionsView';
import { ImportConnectView } from './components/ImportConnectView';
import { SeedStudioView } from './components/SeedStudioView';
import { LaunchpadView } from './components/LaunchpadView';
import { KingAdminView } from './components/KingAdminView';
import { ReceiveModal } from './components/ReceiveModal';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { DepositToPlatformModal } from './components/DepositToPlatformModal';
import { MarketsGasView } from './components/MarketsGasView';

const STORAGE_KEY = 'chainscope_wallets_v1';

function loadInitialWallets(): WalletEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as WalletEntry[];
      if (Array.isArray(parsed)) {
        return parsed.filter((w) => !w.isShowcase);
      }
    }
  } catch {
    // ignore corrupted localStorage
  }
  return [];
}

function ChainScopeShell() {
  const { user, profile, isAdmin } = useAuth();
  const [pathname, setPathname] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.pathname : '/'
  );
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [activeTab, setActiveTab] = useState<ActiveTab>('portfolio');
  const [wallets, setWallets] = useState<WalletEntry[]>(loadInitialWallets);
  const [selectedWalletId, setSelectedWalletId] = useState<string | 'all'>('all');
  const [scanStates, setScanStates] = useState<Record<string, WalletScanState>>({});
  const [autoRefreshSec, setAutoRefreshSec] = useState<number>(0);
  const [receiveWallet, setReceiveWallet] = useState<WalletEntry | null>(null);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositInitialWalletId, setDepositInitialWalletId] = useState<string | undefined>(undefined);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;

  useEffect(() => {
    const onPopState = () => {
      setPathname(window.location.pathname);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigatePath = useCallback((targetPath: string) => {
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
      setPathname(targetPath);
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
    } catch {
      // ignore quota errors
    }
  }, [wallets]);

  const scanWalletById = useCallback(async (wallet: WalletEntry) => {
    setScanStates((prev) => ({
      ...prev,
      [wallet.id]: {
        walletId: wallet.id,
        scanning: true,
        lastScannedAt: prev[wallet.id]?.lastScannedAt ?? null,
        priceSource: prev[wallet.id]?.priceSource ?? 'live',
        chains: prev[wallet.id]?.chains ?? {},
      },
    }));

    try {
      const result = await scanWalletAllChains(wallet);
      setScanStates((prev) => ({
        ...prev,
        [wallet.id]: {
          walletId: wallet.id,
          scanning: false,
          lastScannedAt: result.scannedAt,
          priceSource: result.priceSource,
          chains: result.chains,
        },
      }));

      const chainEntries = Object.entries(result.chains) as Array<[string, ChainScanResult]>;
      const totalUsd = chainEntries.reduce((sum, [, c]) => sum + (c?.totalUsd || 0), 0);
      const compactChains: Record<
        string,
        Pick<ChainScanResult, 'status' | 'nativeSymbol' | 'nativeBalance' | 'totalUsd'>
      > = {};
      for (const [key, chain] of chainEntries) {
        if (chain) {
          compactChains[key] = {
            status: chain.status,
            nativeSymbol: chain.nativeSymbol,
            nativeBalance: chain.nativeBalance,
            totalUsd: chain.totalUsd,
          };
        }
      }
      void syncWalletSnapshotToSupabase({
        walletId: wallet.id,
        label: wallet.label,
        evmAddress: wallet.evmAddress,
        solanaAddress: wallet.solanaAddress,
        totalUsd,
        chains: compactChains,
        scannedAt: result.scannedAt,
      });
    } catch (err) {
      setScanStates((prev) => ({
        ...prev,
        [wallet.id]: {
          walletId: wallet.id,
          scanning: false,
          lastScannedAt: prev[wallet.id]?.lastScannedAt ?? null,
          priceSource: prev[wallet.id]?.priceSource ?? 'error',
          chains: prev[wallet.id]?.chains ?? {},
          error: err instanceof Error ? err.message : 'Scan failed',
        },
      }));
    }
  }, []);

  const scanActiveWallets = useCallback(() => {
    const list =
      selectedWalletId === 'all'
        ? walletsRef.current
        : walletsRef.current.filter((w) => w.id === selectedWalletId);
    list.forEach((w) => {
      void scanWalletById(w);
    });
  }, [selectedWalletId, scanWalletById]);

  useEffect(() => {
    walletsRef.current.forEach((w) => {
      void scanWalletById(w);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (autoRefreshSec <= 0) return;
    const timer = setInterval(() => {
      scanActiveWallets();
    }, autoRefreshSec * 1000);
    return () => clearInterval(timer);
  }, [autoRefreshSec, scanActiveWallets]);

  const handleImportWallet = (wallet: WalletEntry) => {
    setWallets((prev) => {
      const exists = prev.find(
        (w) =>
          wallet.evmAddress &&
          w.evmAddress?.toLowerCase() === wallet.evmAddress.toLowerCase() &&
          (wallet.solanaAddress || '') === (w.solanaAddress || '') &&
          w.origin === wallet.origin
      );
      if (exists) {
        setSelectedWalletId(exists.id);
        setActiveTab('portfolio');
        void scanWalletById(exists);
        return prev;
      }
      return [wallet, ...prev];
    });
    setSelectedWalletId(wallet.id);
    setActiveTab('portfolio');
    void scanWalletById(wallet);
  };

  const handleDeleteWallet = (walletId: string) => {
    setWallets((prev) => {
      const next = prev.filter((w) => w.id !== walletId);
      if (selectedWalletId === walletId) {
        setSelectedWalletId(next.length > 1 ? 'all' : next[0]?.id ?? 'all');
      }
      return next;
    });
    setScanStates((prev) => {
      const copy = { ...prev };
      delete copy[walletId];
      return copy;
    });
  };

  const breadcrumbTitle = useMemo(() => {
    switch (activeTab) {
      case 'portfolio':
        return 'Portfolio & Scanner';
      case 'transactions':
        return 'Transaction Ledger';
      case 'launchpad':
        return 'Meme Coin Launchpad';
      case 'markets':
        return 'Gas & Market Tools';
      case 'import':
        return 'Import & Connect';
      case 'seed-studio':
        return 'Seed Phrase Studio';
    }
  }, [activeTab]);

  const activeScopeLabel = useMemo(() => {
    if (selectedWalletId === 'all') return `All Wallets (${wallets.length})`;
    return wallets.find((w) => w.id === selectedWalletId)?.label || 'Wallet';
  }, [selectedWalletId, wallets]);

  const isAnyScanning = wallets.some((w) => scanStates[w.id]?.scanning);

  const isKingAdminRoute =
    pathname === '/kingadmin' || pathname.startsWith('/kingadmin/');

  if (isKingAdminRoute) {
    return <KingAdminView onNavigateApp={() => navigatePath('/')} />;
  }

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        wallets={wallets}
        selectedWalletId={selectedWalletId}
        onSelectWallet={setSelectedWalletId}
        scanStates={scanStates}
        onScanWallet={(id) => {
          const w = wallets.find((x) => x.id === id);
          if (w) void scanWalletById(w);
        }}
        onDeleteWallet={handleDeleteWallet}
        onOpenReceive={(w) => setReceiveWallet(w)}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        onOpenAdmin={isAdmin ? () => navigatePath('/kingadmin') : undefined}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract: Contextual Breadcrumb Left — Max 2 Primary Actions Right */}
        <header className="h-16 px-4 sm:px-6 border-b border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0F1521] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                {breadcrumbTitle}
              </span>
              {(activeTab === 'portfolio' || activeTab === 'transactions') && wallets.length > 0 && (
                <>
                  <span className="text-slate-400" aria-hidden="true">
                    /
                  </span>
                  <span className="text-slate-500 dark:text-slate-400 truncate text-xs sm:text-sm">
                    {activeScopeLabel}
                  </span>
                </>
              )}
              {activeTab === 'launchpad' && user && profile && (
                <>
                  <span className="text-slate-400" aria-hidden="true">
                    /
                  </span>
                  <span className="text-slate-500 dark:text-slate-400 truncate text-xs sm:text-sm font-mono tabular-nums">
                    @{profile.handle} · {profile.solBalance.toFixed(2)} SOL
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton variant="header" />
            {activeTab !== 'launchpad' ? (
              <button
                type="button"
                onClick={() => setActiveTab('launchpad')}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 transition-colors"
              >
                <Rocket className="w-3.5 h-3.5 text-blue-500" />
                {profile ? `Launchpad (${profile.solBalance.toFixed(1)} SOL)` : 'Meme Launchpad'}
              </button>
            ) : (
              wallets.length > 0 && (
                <button
                  type="button"
                  onClick={scanActiveWallets}
                  disabled={isAnyScanning}
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isAnyScanning ? 'animate-spin text-blue-500' : ''}`} />
                  Scan Wallets
                </button>
              )
            )}
            <button
              type="button"
              onClick={() => setActiveTab('import')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap shrink-0 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Connect / Import
            </button>
          </div>
        </header>

        <OfflineIndicator />

        {/* Main Content Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {activeTab === 'portfolio' && (
            <PortfolioView
              wallets={wallets}
              selectedWalletId={selectedWalletId}
              scanStates={scanStates}
              autoRefreshSec={autoRefreshSec}
              onChangeAutoRefresh={setAutoRefreshSec}
              onScanActive={scanActiveWallets}
              onNavigate={setActiveTab}
              onOpenReceive={(w) => setReceiveWallet(w)}
              onOpenDeposit={(w) => {
                setDepositInitialWalletId(w?.id);
                setShowDepositModal(true);
              }}
            />
          )}

          {activeTab === 'transactions' && (
            <TransactionsView
              wallets={wallets}
              selectedWalletId={selectedWalletId}
              scanStates={scanStates}
              onScanActive={scanActiveWallets}
            />
          )}

          {activeTab === 'launchpad' && (
            <LaunchpadView
              wallets={wallets}
              scanStates={scanStates}
              onOpenConnect={() => setActiveTab('import')}
            />
          )}

          {activeTab === 'markets' && (
            <MarketsGasView
              wallets={wallets}
              selectedWalletId={selectedWalletId}
              scanStates={scanStates}
            />
          )}

          {activeTab === 'import' && <ImportConnectView onImportWallet={handleImportWallet} />}

          {activeTab === 'seed-studio' && (
            <SeedStudioView onImportGeneratedWallet={handleImportWallet} />
          )}
        </main>
      </div>

      {receiveWallet && (
        <ReceiveModal wallet={receiveWallet} onClose={() => setReceiveWallet(null)} />
      )}

      {showDepositModal && (
        <DepositToPlatformModal
          wallets={wallets}
          scanStates={scanStates}
          initialWalletId={depositInitialWalletId}
          onClose={() => {
            setShowDepositModal(false);
            setDepositInitialWalletId(undefined);
          }}
          onGoConnectWallet={() => {
            setShowDepositModal(false);
            setDepositInitialWalletId(undefined);
            setActiveTab('import');
          }}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ChainScopeShell />
    </AuthProvider>
  );
}
