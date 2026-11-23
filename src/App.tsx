import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Coins,
  Layers,
  Lock,
  Menu,
  Plus,
  RefreshCw,
  Rocket,
} from 'lucide-react';
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
import { ChainScopeCoinView } from './components/ChainScopeCoinView';
import { P2PView } from './components/P2PView';
import { WalletOnboardingModal } from './components/WalletOnboardingModal';
import { WalletProfileModal } from './components/WalletProfileModal';
import { AVATAR_PRESET_COLORS } from './utils/walletVault';

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
  const {
    user,
    profile,
    walletAccount,
    isAdmin,
    setShowOnboardingModal,
    setShowProfileModal,
  } = useAuth();
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
    try {
      const params = new URLSearchParams(window.location.search);
      const refCode = params.get('ref');
      if (refCode && refCode.trim().startsWith('CSC-')) {
        localStorage.setItem('chainscope_pending_csc_ref_v1', refCode.trim().toUpperCase());
        setActiveTab('csc');
      }
    } catch {
      // ignore invalid URL params
    }
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

  const attachUsernameWallet = useCallback(
    (username: string, evmAddress: string, solanaAddress: string) => {
      if (!evmAddress && !solanaAddress) return;
      const cleanLabel = `@${username} Wallet`;
      const newEntry: WalletEntry = {
        id: `user_${username.toLowerCase()}_${Date.now()}`,
        label: cleanLabel,
        origin: 'seed',
        evmAddress: evmAddress || undefined,
        solanaAddress: solanaAddress || undefined,
        wordCount: 12,
        accountIndex: 0,
        createdAt: Date.now(),
      };
      setWallets((prev) => {
        const existing = prev.find(
          (w) =>
            (evmAddress && w.evmAddress?.toLowerCase() === evmAddress.toLowerCase()) ||
            (solanaAddress && w.solanaAddress === solanaAddress)
        );
        if (existing) {
          setSelectedWalletId(existing.id);
          void scanWalletById(existing);
          return prev;
        }
        setSelectedWalletId(newEntry.id);
        void scanWalletById(newEntry);
        return [newEntry, ...prev];
      });
    },
    [scanWalletById]
  );

  useEffect(() => {
    const onProvisioned = (ev: Event) => {
      const detail = (ev as CustomEvent<{
        username?: string;
        evmAddress?: string;
        solanaAddress?: string;
      }>).detail;
      if (detail?.username && (detail.evmAddress || detail.solanaAddress)) {
        attachUsernameWallet(
          detail.username,
          detail.evmAddress || '',
          detail.solanaAddress || ''
        );
      }
    };
    window.addEventListener('chainscope:wallet-provisioned', onProvisioned);
    return () => window.removeEventListener('chainscope:wallet-provisioned', onProvisioned);
  }, [attachUsernameWallet]);

  useEffect(() => {
    if (walletAccount?.username && (walletAccount.evmAddress || walletAccount.solanaAddress)) {
      attachUsernameWallet(
        walletAccount.username,
        walletAccount.evmAddress,
        walletAccount.solanaAddress
      );
    }
  }, [walletAccount?.username, walletAccount?.evmAddress, walletAccount?.solanaAddress, attachUsernameWallet]);

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
      case 'csc':
        return 'ChainScope Coin (CSC)';
      case 'p2p':
        return 'Decentralized P2P';
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
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 overflow-x-hidden">
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
        <header className="h-14 sm:h-16 px-3 sm:px-6 border-b border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0F1521] flex items-center justify-between gap-2 sm:gap-4 shrink-0 sticky top-0 z-30 lg:static">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden min-w-[44px] min-h-[44px] -ml-1.5 flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm min-w-0">
              <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                {breadcrumbTitle}
              </span>
              {(activeTab === 'portfolio' || activeTab === 'transactions') && wallets.length > 0 && (
                <>
                  <span className="hidden sm:inline text-slate-400" aria-hidden="true">
                    /
                  </span>
                  <span className="hidden sm:inline text-slate-500 dark:text-slate-400 truncate text-xs sm:text-sm">
                    {activeScopeLabel}
                  </span>
                </>
              )}
              {activeTab === 'launchpad' && user && profile && (
                <>
                  <span className="hidden sm:inline text-slate-400" aria-hidden="true">
                    /
                  </span>
                  <span className="hidden sm:inline text-slate-500 dark:text-slate-400 truncate text-xs sm:text-sm font-mono tabular-nums">
                    @{profile.handle} · {profile.solBalance.toFixed(2)} SOL
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
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
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Connect / Import
            </button>
            {user ? (
              <button
                type="button"
                onClick={() => setShowProfileModal(true)}
                className="inline-flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap shrink-0 transition-colors"
                title="Wallet Profile, Photo & Seed Vault Settings"
              >
                {(walletAccount?.avatarUrl || user.photoURL || '').startsWith('data:image/') ||
                (walletAccount?.avatarUrl || user.photoURL || '').startsWith('http') ? (
                  <img
                    src={walletAccount?.avatarUrl || user.photoURL || ''}
                    alt="Profile"
                    className="w-6 h-6 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0"
                    style={{
                      backgroundColor: (walletAccount?.avatarUrl || '').startsWith('preset:')
                        ? (walletAccount?.avatarUrl || '').slice(7)
                        : AVATAR_PRESET_COLORS[0],
                    }}
                  >
                    {(
                      walletAccount?.username?.[0] ||
                      profile?.handle?.[0] ||
                      user.displayName?.[0] ||
                      'C'
                    ).toUpperCase()}
                  </span>
                )}
                <span className="max-w-[92px] sm:max-w-none truncate">
                  @{walletAccount?.username || profile?.handle || 'wallet'}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowOnboardingModal(true)}
                className="inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 transition-colors"
              >
                <Lock className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Create / Unlock Wallet</span>
                <span className="sm:hidden">Wallet</span>
              </button>
            )}
          </div>
        </header>

        <OfflineIndicator />

        {/* Main Content Viewport */}
        <main className="flex-1 p-3.5 sm:p-6 lg:p-8 pb-24 lg:pb-8 max-w-[1440px] w-full mx-auto">
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

          {activeTab === 'csc' && <ChainScopeCoinView />}

          {activeTab === 'p2p' && <P2PView wallets={wallets} />}

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

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile quick navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-slate-200 dark:border-slate-800/90 bg-white/95 dark:bg-[#0F1521]/95 backdrop-blur-md pb-safe"
      >
        <div className="grid grid-cols-5 h-14">
          {[
            { id: 'portfolio' as ActiveTab, label: 'Portfolio', icon: Layers },
            { id: 'csc' as ActiveTab, label: 'CSC', icon: Coins },
            { id: 'p2p' as ActiveTab, label: 'P2P', icon: ArrowLeftRight },
            { id: 'launchpad' as ActiveTab, label: 'Launch', icon: Rocket },
          ].map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
                  active
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
              ['transactions', 'markets', 'import', 'seed-studio'].includes(activeTab)
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Menu className="w-4 h-4" />
            <span>More</span>
          </button>
        </div>
      </nav>

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

      <WalletOnboardingModal />
      <WalletProfileModal />
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
