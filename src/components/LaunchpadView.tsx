import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Coins,
  Compass,
  Copy,
  Crown,
  ExternalLink,
  Flame,
  Fuel,
  Gift,
  Globe,
  Home,
  Layers,
  Loader2,
  LogIn,
  LogOut,
  MessageSquare,
  Package,
  Plus,
  Rocket,
  Search,
  Send,
  Settings2,
  Star,
  Trash2,
  TrendingUp,
  Trophy,
  UserCheck,
  X,
  Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { WalletEntry, WalletScanState } from '../types/wallet';
import type {
  CoinComment,
  CoinMode,
  CoinTrade,
  EmblemIconName,
  GasTier,
  LaunchChain,
  MemeCoin,
  UserProfile,
} from '../types/launchpad';
import {
  computeGasFee,
  formatCompactTokens,
  formatSolPrice,
  getBondingProgressPct,
  getCurveParams,
  getInitialCurveState,
  quoteBuy,
  quoteSell,
} from '../utils/bondingCurve';
import { formatTimestamp, formatUsd } from '../utils/chains';
import {
  deleteCoinComment,
  executeBondingCurveSwap,
  fetchCoinDetail,
  fetchLaunchpadActivity,
  fetchLaunchpadOverview,
  launchMemeCoin,
  postCoinComment,
  transferPlatformSol,
  type LaunchpadActivityItem,
} from '../services/launchpad';
import { CoinEmblem } from './CoinEmblem';
import { BondingCurveChart } from './BondingCurveChart';
import { DepositToPlatformModal } from './DepositToPlatformModal';
import {
  HolderRewardsPanel,
  LeaderboardPanel,
  MechanicsExplainerPanel,
  PacksPanel,
  PerpsPanel,
} from './LaunchpadSubPanels';

interface LaunchpadViewProps {
  wallets: WalletEntry[];
  scanStates?: Record<string, WalletScanState>;
  onOpenConnect?: () => void;
}

type ArenaTab =
  | 'home'
  | 'explore'
  | 'go'
  | 'mayhem'
  | 'rewards'
  | 'perps'
  | 'packs'
  | 'leaderboard';

const EMBLEM_ICONS: EmblemIconName[] = [
  'rocket',
  'flame',
  'zap',
  'crown',
  'gem',
  'ghost',
  'cat',
  'dog',
];

const EMBLEM_COLORS = [
  '#3B82F6',
  '#10B981',
  '#8B5CF6',
  '#F59E0B',
  '#EF4444',
  '#06B6D4',
  '#EC4899',
  '#84CC16',
];

const CHAIN_LABELS: Record<LaunchChain, string> = {
  solana: 'Solana',
  base: 'Base',
  ethereum: 'Ethereum',
  polygon: 'Polygon',
};

function toMillis(ts: unknown): number {
  if (!ts) return Date.now();
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'object' && ts !== null && 'toMillis' in ts) {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

export function LaunchpadView({ wallets, scanStates = {}, onOpenConnect }: LaunchpadViewProps) {
  const {
    user,
    authReady,
    profile,
    holdings,
    perpPositions,
    rewardClaims,
    economics,
    loadingProfile,
    authError,
    dbError,
    signInWithGoogle,
    signInWithBrowserRedirect,
    signOutUser,
    refreshAccount,
    updateAccountProfile,
    requestFaucetSol,
  } = useAuth();

  const [arenaTab, setArenaTab] = useState<ArenaTab>('home');
  const [showMechanics, setShowMechanics] = useState(false);

  const [solUsdPrice, setSolUsdPrice] = useState<number>(0);
  const [coins, setCoins] = useState<MemeCoin[]>([]);
  const [traders, setTraders] = useState<UserProfile[]>([]);
  const [activityFeed, setActivityFeed] = useState<LaunchpadActivityItem[]>([]);
  const [loadingCoins, setLoadingCoins] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // Arena Filters
  const [selectedCoinId, setSelectedCoinId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [chainFilter, setChainFilter] = useState<LaunchChain | 'all'>('all');
  const [modeFilter, setModeFilter] = useState<'all' | CoinMode>('all');
  const [sortBy, setSortBy] = useState<'trending' | 'mcap' | 'newest' | 'graduating'>('trending');
  const [onlyMyHoldings, setOnlyMyHoldings] = useState(false);
  const [onlyStarred, setOnlyStarred] = useState(false);
  const [starredIds, setStarredIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('chainscope_starred_coins_v1');
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferHandle, setTransferHandle] = useState('');
  const [transferAmount, setTransferAmount] = useState('0.5');
  const [transferMemo, setTransferMemo] = useState('');
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferFeedback, setTransferFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [copiedLoginUrl, setCopiedLoginUrl] = useState(false);

  // Create Coin Form State
  const [coinName, setCoinName] = useState('');
  const [coinTicker, setCoinTicker] = useState('');
  const [coinDesc, setCoinDesc] = useState('');
  const [coinChain, setCoinChain] = useState<LaunchChain>('solana');
  const [coinMode, setCoinMode] = useState<CoinMode>('standard');
  const [coinIcon, setCoinIcon] = useState<EmblemIconName>('rocket');
  const [coinColor, setCoinColor] = useState('#3B82F6');
  const [coinWebsite, setCoinWebsite] = useState('');
  const [coinTwitter, setCoinTwitter] = useState('');
  const [devBuySol, setDevBuySol] = useState('0.5');
  const [launchGasTier, setLaunchGasTier] = useState<GasTier>('standard');
  const [launchBusy, setLaunchBusy] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  // GO Quick-Launch & Quick-Ape State
  const [goName, setGoName] = useState('');
  const [goTicker, setGoTicker] = useState('');
  const [goLore, setGoLore] = useState('');
  const [goMode, setGoMode] = useState<CoinMode>('standard');
  const [goBuySol, setGoBuySol] = useState('0.25');
  const [goBusy, setGoBusy] = useState(false);
  const [goQuickBuyKey, setGoQuickBuyKey] = useState<string | null>(null);
  const [goFeedback, setGoFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Profile Form State
  const [editHandle, setEditHandle] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editLinkedWallet, setEditLinkedWallet] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [faucetBusy, setFaucetBusy] = useState(false);

  // Selected Coin Detail State
  const [coinTrades, setCoinTrades] = useState<CoinTrade[]>([]);
  const [coinComments, setCoinComments] = useState<CoinComment[]>([]);
  const [detailTab, setDetailTab] = useState<'trades' | 'comments'>('trades');
  const [swapSide, setSwapSide] = useState<'buy' | 'sell'>('buy');
  const [swapAmountInput, setSwapAmountInput] = useState('0.5');
  const [gasTier, setGasTier] = useState<GasTier>('standard');
  const [swapBusy, setSwapBusy] = useState(false);
  const [swapFeedback, setSwapFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );
  const [commentInput, setCommentInput] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);

  // Fetch live SOL spot USD price from backend proxy
  useEffect(() => {
    let active = true;
    fetch('/api/prices')
      .then((r) => r.json())
      .then((data: { prices?: { solana?: { usd?: number } } }) => {
        if (active && typeof data?.prices?.solana?.usd === 'number') {
          setSolUsdPrice(data.prices.solana.usd);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const refreshOverview = useCallback(async (showSpinner = false) => {
    if (!user) return;
    if (showSpinner) setLoadingCoins(true);
    try {
      const [data, act] = await Promise.all([
        fetchLaunchpadOverview(),
        fetchLaunchpadActivity().catch(() => ({ activity: [] })),
      ]);
      setCoins(data.coins);
      setTraders(data.traders);
      setActivityFeed(act.activity);
      setOverviewError(null);
    } catch (err) {
      setOverviewError(
        err instanceof Error ? err.message : 'Unable to load Launchpad data from Supabase'
      );
    } finally {
      if (showSpinner) setLoadingCoins(false);
    }
  }, [user]);

  const refreshDetail = useCallback(
    async (coinId: string | null) => {
      if (!user || !coinId) {
        setCoinTrades([]);
        setCoinComments([]);
        return;
      }
      try {
        const detail = await fetchCoinDetail(coinId);
        setCoinTrades(detail.trades);
        setCoinComments(detail.comments);
      } catch {
        // Keep current detail if transient poll fails
      }
    },
    [user]
  );

  const refreshAll = useCallback(async () => {
    await Promise.all([
      refreshAccount(),
      refreshOverview(false),
      selectedCoinId ? refreshDetail(selectedCoinId) : Promise.resolve(),
    ]);
  }, [refreshAccount, refreshOverview, refreshDetail, selectedCoinId]);

  // Load and poll launched meme coins & trader leaderboard from Supabase
  useEffect(() => {
    if (!authReady || !user) {
      setCoins([]);
      setTraders([]);
      setOverviewError(null);
      return;
    }

    void refreshOverview(true);
    const timer = window.setInterval(() => {
      void refreshOverview(false);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [authReady, user, refreshOverview]);

  // Load and poll selected coin's live trades and comments from Supabase
  useEffect(() => {
    if (!authReady || !user || !selectedCoinId) {
      setCoinTrades([]);
      setCoinComments([]);
      return;
    }

    void refreshDetail(selectedCoinId);
    const timer = window.setInterval(() => {
      void refreshDetail(selectedCoinId);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [authReady, user, selectedCoinId, refreshDetail]);

  const selectedCoin = useMemo(
    () => coins.find((c) => c.id === selectedCoinId) || null,
    [coins, selectedCoinId]
  );

  const selectedHolding = useMemo(
    () => holdings.find((h) => h.coinId === selectedCoinId) || null,
    [holdings, selectedCoinId]
  );

  const holdingCoinIds = useMemo(() => new Set(holdings.map((h) => h.coinId)), [holdings]);

  const kingOfTheHill = useMemo(() => {
    if (coins.length === 0) return null;
    return [...coins].sort((a, b) => b.volumeSol - a.volumeSol || b.marketCapSol - a.marketCapSol)[0];
  }, [coins]);

  const mayhemCoins = useMemo(
    () =>
      coins
        .filter((c) => c.mode === 'mayhem')
        .sort((a, b) => b.volumeSol - a.volumeSol || toMillis(b.createdAt) - toMillis(a.createdAt)),
    [coins]
  );

  const starredSet = useMemo(() => new Set(starredIds), [starredIds]);

  const toggleStarCoin = (coinId: string) => {
    setStarredIds((prev) => {
      const next = prev.includes(coinId)
        ? prev.filter((id) => id !== coinId)
        : [coinId, ...prev];
      try {
        localStorage.setItem('chainscope_starred_coins_v1', JSON.stringify(next));
      } catch {
        // ignore quota errors
      }
      return next;
    });
  };

  const filteredCoins = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = coins
      .filter((c) => (chainFilter === 'all' ? true : c.chain === chainFilter))
      .filter((c) => (modeFilter === 'all' ? true : (c.mode || 'standard') === modeFilter))
      .filter((c) => (!onlyMyHoldings ? true : holdingCoinIds.has(c.id)))
      .filter((c) => (!onlyStarred ? true : starredSet.has(c.id)))
      .filter((c) => {
        if (!q) return true;
        return (
          c.name.toLowerCase().includes(q) ||
          c.ticker.toLowerCase().includes(q) ||
          c.creatorHandle.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q)
        );
      });

    return [...list].sort((a, b) => {
      if (sortBy === 'mcap') return b.marketCapSol - a.marketCapSol;
      if (sortBy === 'newest') return toMillis(b.createdAt) - toMillis(a.createdAt);
      if (sortBy === 'graduating') return b.realSol - a.realSol;
      return b.volumeSol - a.volumeSol || b.tradeCount - a.tradeCount;
    });
  }, [coins, chainFilter, modeFilter, onlyMyHoldings, onlyStarred, starredSet, holdingCoinIds, searchQuery, sortBy]);

  // Live quote preview for swap form
  const swapQuote = useMemo(() => {
    if (!selectedCoin) return null;
    const amt = Number(swapAmountInput);
    const mode: CoinMode = selectedCoin.mode === 'mayhem' ? 'mayhem' : 'standard';
    if (swapSide === 'buy') {
      return {
        side: 'buy' as const,
        quote: quoteBuy(
          selectedCoin.virtualSol,
          selectedCoin.virtualTokens,
          selectedCoin.realSol,
          amt,
          mode,
          gasTier,
          economics
        ),
      };
    }
    return {
      side: 'sell' as const,
      quote: quoteSell(
        selectedCoin.virtualSol,
        selectedCoin.virtualTokens,
        selectedCoin.realSol,
        amt,
        gasTier,
        economics
      ),
    };
  }, [selectedCoin, swapSide, swapAmountInput, gasTier, economics]);

  // Launch preview
  const devBuyPreview = useMemo(() => {
    const init = getInitialCurveState(coinMode);
    const amt = Number(devBuySol) || 0;
    return quoteBuy(
      init.virtualSol,
      init.virtualTokens,
      init.realSol,
      Math.max(0, amt),
      coinMode,
      launchGasTier,
      economics
    );
  }, [devBuySol, coinMode, launchGasTier, economics]);

  const currentGasInfo = useMemo(
    () => computeGasFee(gasTier, economics),
    [gasTier, economics]
  );

  const walletAddresses = useMemo(() => {
    const list: Array<{ label: string; address: string }> = [];
    for (const w of wallets) {
      if (w.solanaAddress) list.push({ label: `${w.label} (Solana)`, address: w.solanaAddress });
      if (w.evmAddress) list.push({ label: `${w.label} (EVM)`, address: w.evmAddress });
    }
    return list;
  }, [wallets]);

  const openCreateModalWithMode = (mode: CoinMode = 'standard') => {
    setCoinMode(mode);
    if (mode === 'mayhem') {
      setCoinColor('#F97316');
      setCoinIcon('flame');
    } else {
      setCoinColor('#3B82F6');
      setCoinIcon('rocket');
    }
    setLaunchError(null);
    setShowCreateModal(true);
  };

  const handleOpenProfileModal = () => {
    if (!profile) return;
    setEditHandle(profile.handle);
    setEditDisplayName(profile.displayName);
    setEditLinkedWallet(profile.linkedWallet || '');
    setProfileMsg(null);
    setShowProfileModal(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileBusy(true);
    setProfileMsg(null);
    try {
      await updateAccountProfile({
        handle: editHandle,
        displayName: editDisplayName,
        linkedWallet: editLinkedWallet,
      });
      await refreshAll();
      setProfileMsg('Profile saved.');
      setTimeout(() => setShowProfileModal(false), 600);
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setProfileBusy(false);
    }
  };

  const handleFaucet = async () => {
    setFaucetBusy(true);
    setSwapFeedback(null);
    try {
      await requestFaucetSol();
      await refreshOverview(false);
    } catch (err) {
      setSwapFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Faucet failed',
      });
    } finally {
      setFaucetBusy(false);
    }
  };

  const handleLaunchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setLaunchBusy(true);
    setLaunchError(null);
    try {
      const newCoinId = await launchMemeCoin(
        profile,
        {
          name: coinName,
          ticker: coinTicker,
          description: coinDesc,
          chain: coinChain,
          mode: coinMode,
          emblemIcon: coinIcon,
          emblemColor: coinColor,
          website: coinWebsite,
          twitter: coinTwitter,
          initialBuySol: Number(devBuySol) || 0,
          gasTier: launchGasTier,
        },
        economics
      );
      await refreshAll();
      setShowCreateModal(false);
      setCoinName('');
      setCoinTicker('');
      setCoinDesc('');
      setCoinWebsite('');
      setCoinTwitter('');
      setDevBuySol('0.5');
      setSelectedCoinId(newCoinId);
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : 'Launch failed');
    } finally {
      setLaunchBusy(false);
    }
  };

  const handleGoLaunch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setGoBusy(true);
    setGoFeedback(null);
    try {
      const newCoinId = await launchMemeCoin(
        profile,
        {
          name: goName,
          ticker: goTicker,
          description: goLore.trim() || `${goName} rapid GO bonding-curve launch.`,
          chain: 'solana',
          mode: goMode,
          emblemIcon: goMode === 'mayhem' ? 'flame' : 'zap',
          emblemColor: goMode === 'mayhem' ? '#F97316' : '#3B82F6',
          website: '',
          twitter: '',
          initialBuySol: Number(goBuySol) || 0,
          gasTier,
        },
        economics
      );
      await refreshAll();
      setGoName('');
      setGoTicker('');
      setGoLore('');
      setGoFeedback({ type: 'ok', text: `Instant GO launch live! Opening terminal…` });
      setSelectedCoinId(newCoinId);
    } catch (err) {
      setGoFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'GO launch failed',
      });
    } finally {
      setGoBusy(false);
    }
  };

  const handleGoQuickBuy = async (coin: MemeCoin, solAmt: number) => {
    if (!user) return;
    const key = `${coin.id}_${solAmt}`;
    setGoQuickBuyKey(key);
    setGoFeedback(null);
    try {
      await executeBondingCurveSwap({
        coinId: coin.id,
        userUid: user.uid,
        side: 'buy',
        amount: solAmt,
        gasTier,
        economics,
      });
      await refreshAll();
      setGoFeedback({
        type: 'ok',
        text: `Instant buy filled: ${solAmt} SOL into $${coin.ticker}`,
      });
    } catch (err) {
      setGoFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Quick buy failed',
      });
    } finally {
      setGoQuickBuyKey(null);
    }
  };

  const handleExecuteSwap = async () => {
    if (!user || !selectedCoin) return;
    const amt = Number(swapAmountInput);
    if (!Number.isFinite(amt) || amt <= 0) {
      setSwapFeedback({ type: 'err', text: 'Enter an amount greater than 0.' });
      return;
    }

    setSwapBusy(true);
    setSwapFeedback(null);
    try {
      await executeBondingCurveSwap({
        coinId: selectedCoin.id,
        userUid: user.uid,
        side: swapSide,
        amount: amt,
        gasTier,
        economics,
      });
      await refreshAll();
      setSwapFeedback({
        type: 'ok',
        text:
          swapSide === 'buy'
            ? `Bought $${selectedCoin.ticker} for ${amt} SOL (${gasTier} gas)`
            : `Sold ${formatCompactTokens(amt)} $${selectedCoin.ticker} (${gasTier} gas)`,
      });
    } catch (err) {
      setSwapFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Trade execution failed',
      });
    } finally {
      setSwapBusy(false);
    }
  };

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !selectedCoin || !commentInput.trim()) return;
    setCommentBusy(true);
    try {
      await postCoinComment({
        coinId: selectedCoin.id,
        profile,
        text: commentInput,
      });
      setCommentInput('');
      await refreshDetail(selectedCoin.id);
    } finally {
      setCommentBusy(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!selectedCoin) return;
    try {
      await deleteCoinComment(selectedCoin.id, commentId);
      await refreshDetail(selectedCoin.id);
    } catch (err) {
      setSwapFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to delete comment',
      });
    }
  };

  const renderCoinCard = (coin: MemeCoin, allowQuickBuy = false) => {
    const mode: CoinMode = coin.mode === 'mayhem' ? 'mayhem' : 'standard';
    const progress = getBondingProgressPct(coin.realSol, mode);
    const myPos = holdings.find((h) => h.coinId === coin.id);

    return (
      <div
        key={coin.id}
        className={`p-5 rounded-xl border bg-white dark:bg-[#111827] transition-colors flex flex-col justify-between gap-4 ${
          mode === 'mayhem'
            ? 'border-orange-500/30 hover:border-orange-500/70'
            : 'border-slate-200 dark:border-slate-800 hover:border-blue-500/60'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              setSelectedCoinId(coin.id);
              setSwapFeedback(null);
            }}
            className="text-left space-y-2.5 flex-1 min-w-0"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <CoinEmblem icon={coin.emblemIcon} color={coin.emblemColor} size="md" />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {coin.name}
                    </span>
                    <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400 shrink-0">
                      ${coin.ticker}
                    </span>
                    {mode === 'mayhem' && (
                      <span className="text-[11px] font-semibold text-orange-500">· Mayhem</span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {CHAIN_LABELS[coin.chain]} · @{coin.creatorHandle} ·{' '}
                    {formatTimestamp(toMillis(coin.createdAt))}
                  </div>
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 leading-relaxed">
              {coin.description}
            </p>
          </button>

          <button
            type="button"
            onClick={() => toggleStarCoin(coin.id)}
            title={starredSet.has(coin.id) ? 'Remove from watchlist' : 'Star to watchlist'}
            aria-label={starredSet.has(coin.id) ? 'Remove from watchlist' : 'Star to watchlist'}
            className={`p-1.5 rounded-lg transition-colors shrink-0 ${
              starredSet.has(coin.id)
                ? 'text-amber-500 bg-amber-500/10'
                : 'text-slate-400 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Star className={`w-4 h-4 ${starredSet.has(coin.id) ? 'fill-amber-500' : ''}`} />
          </button>
        </div>

        <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80">
          <div className="flex items-center justify-between text-xs tabular-nums">
            <span className="text-slate-500">
              MCap:{' '}
              <strong className="font-mono text-slate-900 dark:text-slate-100">
                {coin.marketCapSol.toFixed(2)} SOL
              </strong>
              {solUsdPrice > 0 && (
                <span className="text-slate-400 ml-1">
                  ({formatUsd(coin.marketCapSol * solUsdPrice)})
                </span>
              )}
            </span>
            <span className="font-mono text-[11px] text-slate-500">
              Vol {coin.volumeSol.toFixed(2)} SOL
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between text-[11px] mb-1 tabular-nums">
              <span className="text-slate-500">
                {coin.graduated
                  ? 'Graduated'
                  : mode === 'mayhem'
                  ? 'Mayhem Curve'
                  : 'Bonding Curve'}
              </span>
              <span
                className={`font-mono font-medium ${
                  mode === 'mayhem' ? 'text-orange-500' : 'text-blue-600 dark:text-blue-400'
                }`}
              >
                {progress.toFixed(1)}%
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className={`h-full ${
                  coin.graduated
                    ? 'bg-emerald-500'
                    : mode === 'mayhem'
                    ? 'bg-orange-500'
                    : 'bg-blue-600'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
            <span>Rewards Pool: {(coin.holderRewardPoolSol || 0).toFixed(4)} SOL</span>
            {myPos && (
              <span className="font-mono text-emerald-600 dark:text-emerald-400">
                Held: {formatCompactTokens(myPos.tokenBalance)}
              </span>
            )}
          </div>

          {allowQuickBuy && (
            <div className="grid grid-cols-3 gap-1.5 pt-1">
              {[0.1, 0.5, 1.0].map((amt) => {
                const key = `${coin.id}_${amt}`;
                return (
                  <button
                    key={amt}
                    type="button"
                    disabled={goQuickBuyKey === key}
                    onClick={() => void handleGoQuickBuy(coin, amt)}
                    className="py-1.5 rounded-lg bg-emerald-600/10 hover:bg-emerald-600 text-emerald-600 dark:text-emerald-400 hover:text-white border border-emerald-500/30 text-[11px] font-mono font-semibold transition-colors"
                  >
                    {goQuickBuyKey === key ? '…' : `Ape ${amt} SOL`}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  // --- Unauthenticated Account Gate ---
  if (!authReady) {
    return (
      <div className="py-20 flex items-center justify-center text-xs text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Checking account session…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto my-10 p-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-center space-y-5">
        <div className="w-12 h-12 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto">
          <Rocket className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Create Your Account to Launch & Trade Meme Coins
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 max-w-md mx-auto leading-relaxed">
            Sign in with Google to create your persistent trader account, receive 10.00 SOL in
            bonding-curve liquidity, launch Standard or Mayhem meme coins, trade Perps & Packs, and
            claim Holder Rewards.
          </p>
        </div>

        {authError && (
          <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-600 dark:text-red-400">
            {authError}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={() => void signInWithGoogle()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
          >
            <LogIn className="w-4 h-4" />
            Sign In / Create Account with Google
          </button>

          <button
            type="button"
            onClick={() => void signInWithBrowserRedirect()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm font-medium transition-colors"
          >
            <Globe className="w-4 h-4 text-emerald-500" />
            Sign In With Browser (Mobile / Wallet App)
          </button>
        </div>

        <div className="pt-2 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>Inside a phone wallet app or popup blocked?</span>
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') {
                void navigator.clipboard.writeText(window.location.href);
                setCopiedLoginUrl(true);
                setTimeout(() => setCopiedLoginUrl(false), 1800);
              }
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium"
          >
            {copiedLoginUrl ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            {copiedLoginUrl ? 'Link Copied' : 'Copy Link for Safari / Chrome'}
          </button>
        </div>
      </div>
    );
  }

  const arenaNav: Array<{
    id: ArenaTab;
    label: string;
    icon: typeof Home;
    badge?: string;
  }> = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'explore', label: 'Explore', icon: Compass },
    { id: 'go', label: 'GO', icon: Zap },
    { id: 'mayhem', label: 'Mayhem', icon: Flame },
    { id: 'rewards', label: 'Holder Rewards', icon: Gift },
    { id: 'perps', label: 'Perps', icon: Layers, badge: 'New' },
    { id: 'packs', label: 'Packs', icon: Package, badge: 'New' },
    { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
  ];

  return (
    <div className="space-y-5">
      {/* Account & Launchpad Action Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Trader Account</div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>
                {profile ? `@${profile.handle}` : loadingProfile ? 'Initializing…' : 'Account'}
              </span>
            </div>
          </div>

          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Trading Liquidity</div>
            <div className="text-sm font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {profile ? `${profile.solBalance.toFixed(4)} SOL` : '—'}
              {profile && solUsdPrice > 0 && (
                <span className="ml-1.5 text-xs font-normal text-slate-500">
                  ({formatUsd(profile.solBalance * solUsdPrice)})
                </span>
              )}
            </div>
          </div>

          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Positions · Perps</div>
            <div className="text-sm font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {holdings.length} · {perpPositions.filter((p) => p.status === 'open').length}
            </div>
          </div>

          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Live Gas ({gasTier})
            </div>
            <div className="text-xs font-mono text-slate-700 dark:text-slate-300 tabular-nums">
              {currentGasInfo.totalGasSol.toFixed(5)} SOL · {economics.congestionMultiplier}x
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowMechanics((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors ${
              showMechanics
                ? 'border-blue-500 bg-blue-500/10 text-blue-500'
                : 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
            }`}
          >
            <Fuel className="w-3.5 h-3.5" />
            Curve & Gas Math
          </button>

          <button
            type="button"
            onClick={() => setShowDepositModal(true)}
            disabled={!profile}
            title="Deposit verified funds from your connected wallets into your platform trading balance"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/15 disabled:opacity-40 text-xs font-medium text-emerald-600 dark:text-emerald-400 whitespace-nowrap transition-colors"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
            Add Coins from Wallet
          </button>

          <button
            type="button"
            onClick={() => {
              setTransferFeedback(null);
              setShowTransferModal(true);
            }}
            disabled={!profile}
            title="Send SOL from your platform trading balance to another trader @handle"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap transition-colors"
          >
            <Send className="w-3.5 h-3.5 text-blue-500" />
            Send SOL
          </button>

          <button
            type="button"
            onClick={handleFaucet}
            disabled={faucetBusy || !profile || profile.solBalance >= 100}
            title="Add 10 SOL for bonding-curve trading (available under 100 SOL)"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap transition-colors"
          >
            <Coins className="w-3.5 h-3.5 text-amber-500" />
            {faucetBusy ? 'Adding…' : '+10 SOL Faucet'}
          </button>

          <button
            type="button"
            onClick={handleOpenProfileModal}
            disabled={!profile}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap transition-colors"
          >
            <Settings2 className="w-3.5 h-3.5" />
            Profile
          </button>

          <button
            type="button"
            onClick={() => openCreateModalWithMode('standard')}
            disabled={!profile}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-medium whitespace-nowrap transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Launch Coin
          </button>

          <button
            type="button"
            onClick={() => void signOutUser()}
            title="Sign out"
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
            aria-label="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {(dbError || overviewError) && (
        <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{dbError || overviewError}</span>
        </div>
      )}

      {showMechanics && <MechanicsExplainerPanel economics={economics} />}

      {/* Pump.fun Arena Sub-Navigation (when not inspecting a single coin) */}
      {!selectedCoin && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="flex flex-wrap items-center gap-1">
            {arenaNav.map((tab) => {
              const Icon = tab.icon;
              const active = arenaTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setArenaTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                    active
                      ? tab.id === 'mayhem'
                        ? 'bg-orange-600 text-white'
                        : 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                  {tab.badge && (
                    <span
                      className={`text-[10px] font-semibold uppercase ${
                        active ? 'text-blue-100' : 'text-emerald-500'
                      }`}
                    >
                      · {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 px-2 text-[11px] text-slate-500">
            <span>Gas:</span>
            {(['standard', 'fast', 'turbo'] as const).map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => setGasTier(tier)}
                className={`px-2 py-1 rounded capitalize ${
                  gasTier === tier
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-semibold'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {tier}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* VIEW A: SELECTED COIN TRADING TERMINAL */}
      {selectedCoin ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setSelectedCoinId(null);
                setSwapFeedback(null);
              }}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Pump Arena
            </button>

            <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
              <span>Network: {CHAIN_LABELS[selectedCoin.chain]}</span>
              <span aria-hidden="true">·</span>
              <span>
                Mode:{' '}
                <strong
                  className={
                    selectedCoin.mode === 'mayhem' ? 'text-orange-500' : 'text-blue-500'
                  }
                >
                  {selectedCoin.mode === 'mayhem' ? 'Mayhem' : 'Standard'}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>Created by @{selectedCoin.creatorHandle}</span>
              {selectedCoin.website && (
                <>
                  <span aria-hidden="true">·</span>
                  <a
                    href={
                      selectedCoin.website.startsWith('http')
                        ? selectedCoin.website
                        : `https://${selectedCoin.website}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Website <ExternalLink className="w-3 h-3" />
                  </a>
                </>
              )}
            </div>
          </div>

          {/* Coin Header Summary */}
          <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-wrap items-center justify-between gap-5">
            <div className="flex items-center gap-3.5 min-w-0">
              <CoinEmblem
                icon={selectedCoin.emblemIcon}
                color={selectedCoin.emblemColor}
                size="lg"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-display font-bold text-slate-900 dark:text-slate-100">
                    {selectedCoin.name}
                  </h2>
                  <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">
                    ${selectedCoin.ticker}
                  </span>
                  {selectedCoin.mode === 'mayhem' && (
                    <span className="text-xs font-semibold text-orange-500">· Mayhem Curve</span>
                  )}
                  {selectedCoin.graduated && (
                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      · Graduated
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 max-w-xl">
                  {selectedCoin.description}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 shrink-0">
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Market Cap</div>
                <div className="text-sm font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                  {selectedCoin.marketCapSol.toFixed(2)} SOL
                </div>
                {solUsdPrice > 0 && (
                  <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                    {formatUsd(selectedCoin.marketCapSol * solUsdPrice)}
                  </div>
                )}
              </div>
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Volume</div>
                <div className="text-sm font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                  {selectedCoin.volumeSol.toFixed(2)} SOL
                </div>
                <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                  {selectedCoin.tradeCount} trades
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Holder Pool</div>
                <div className="text-sm font-mono font-bold text-emerald-600 dark:text-emerald-400 tabular-nums mt-0.5">
                  {(selectedCoin.holderRewardPoolSol || 0).toFixed(4)} SOL
                </div>
                <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                  Creator: {(selectedCoin.creatorFeesSol || 0).toFixed(4)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Curve Fill</div>
                <div className="text-sm font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                  {getBondingProgressPct(
                    selectedCoin.realSol,
                    selectedCoin.mode || 'standard'
                  ).toFixed(1)}
                  %
                </div>
                <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                  {selectedCoin.realSol.toFixed(2)} /{' '}
                  {getCurveParams(selectedCoin.mode || 'standard').graduationTargetSol} SOL
                </div>
              </div>
            </div>
          </div>

          {/* Trading Terminal Two-Column Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <div className="lg:col-span-8 space-y-5">
              <BondingCurveChart coin={selectedCoin} trades={coinTrades} />

              {/* Trades & Thread Panel */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17]">
                    <button
                      type="button"
                      onClick={() => setDetailTab('trades')}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                        detailTab === 'trades'
                          ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      Trade Tape ({coinTrades.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailTab('comments')}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                        detailTab === 'comments'
                          ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      Thread ({coinComments.length})
                    </button>
                  </div>
                </div>

                {detailTab === 'trades' ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                          <th className="py-2.5 px-4">Trader</th>
                          <th className="py-2.5 px-4">Side</th>
                          <th className="py-2.5 px-4 text-right">SOL</th>
                          <th className="py-2.5 px-4 text-right">{selectedCoin.ticker}</th>
                          <th className="py-2.5 px-4 text-right">Gas</th>
                          <th className="py-2.5 px-4 text-right">Price (SOL)</th>
                          <th className="py-2.5 px-4 text-right">Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                        {coinTrades.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-8 text-center text-slate-500">
                              No trades yet. Be the first to buy ${selectedCoin.ticker} on the
                              curve.
                            </td>
                          </tr>
                        ) : (
                          coinTrades.map((t) => (
                            <tr
                              key={t.id}
                              className="h-10 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                            >
                              <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-200">
                                @{t.traderHandle}
                              </td>
                              <td className="px-4 py-2">
                                <span
                                  className={`font-semibold ${
                                    t.side === 'buy'
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : 'text-red-600 dark:text-red-400'
                                  }`}
                                >
                                  {t.side === 'buy' ? 'Buy' : 'Sell'}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-right font-mono tabular-nums">
                                {t.solAmount.toFixed(4)}
                              </td>
                              <td className="px-4 py-2 text-right font-mono tabular-nums">
                                {formatCompactTokens(t.tokenAmount)}
                              </td>
                              <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-500">
                                {(t.gasSol ?? economics.baseGasSol).toFixed(5)}
                              </td>
                              <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-500">
                                {formatSolPrice(t.priceSol)}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                                {formatTimestamp(toMillis(t.createdAt))}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-4 space-y-4">
                    <form onSubmit={handlePostComment} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={commentInput}
                        onChange={(e) => setCommentInput(e.target.value)}
                        maxLength={280}
                        placeholder={`Post a comment on $${selectedCoin.ticker}…`}
                        className="flex-1 min-w-0 px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="submit"
                        disabled={commentBusy || !commentInput.trim()}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-medium whitespace-nowrap transition-colors"
                      >
                        <Send className="w-3.5 h-3.5" />
                        Post
                      </button>
                    </form>

                    <div className="space-y-2.5">
                      {coinComments.length === 0 ? (
                        <div className="py-6 text-center text-xs text-slate-500">
                          <MessageSquare className="w-5 h-5 mx-auto mb-1.5 opacity-60" />
                          No comments yet. Start the discussion!
                        </div>
                      ) : (
                        coinComments.map((c) => (
                          <div
                            key={c.id}
                            className="p-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B0F17] text-xs"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-slate-900 dark:text-slate-100">
                                @{c.authorHandle}
                              </span>
                              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                                <span>{formatTimestamp(toMillis(c.createdAt))}</span>
                                {c.authorUid === user.uid && (
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteComment(c.id)}
                                    className="text-slate-400 hover:text-red-500"
                                    aria-label="Delete comment"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <p className="mt-1 text-slate-700 dark:text-slate-300 leading-relaxed">
                              {c.text}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right 4 cols: Bonding-Curve Swap Panel & Progress */}
            <div className="lg:col-span-4 space-y-4">
              <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
                <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17]">
                  <button
                    type="button"
                    onClick={() => {
                      setSwapSide('buy');
                      setSwapAmountInput('0.5');
                      setSwapFeedback(null);
                    }}
                    className={`py-2 rounded-md text-xs font-semibold transition-colors ${
                      swapSide === 'buy'
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    Buy
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSwapSide('sell');
                      setSwapAmountInput(
                        selectedHolding
                          ? Math.floor(selectedHolding.tokenBalance * 0.5).toString()
                          : '0'
                      );
                      setSwapFeedback(null);
                    }}
                    className={`py-2 rounded-md text-xs font-semibold transition-colors ${
                      swapSide === 'sell'
                        ? 'bg-red-600 text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    Sell
                  </button>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-slate-600 dark:text-slate-400">
                      {swapSide === 'buy' ? 'Amount (SOL)' : `Amount (${selectedCoin.ticker})`}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                      {swapSide === 'buy'
                        ? `Bal: ${profile ? profile.solBalance.toFixed(4) : '0'} SOL`
                        : `Bal: ${formatCompactTokens(selectedHolding?.tokenBalance || 0)} ${selectedCoin.ticker}`}
                    </span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={swapAmountInput}
                    onChange={(e) => setSwapAmountInput(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Quick Presets */}
                <div className="grid grid-cols-4 gap-1.5">
                  {swapSide === 'buy'
                    ? ['0.1', '0.5', '1.0', '5.0'].map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setSwapAmountInput(val)}
                          className="py-1.5 rounded-md border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-mono text-slate-700 dark:text-slate-300 transition-colors"
                        >
                          {val} SOL
                        </button>
                      ))
                    : [0.25, 0.5, 0.75, 1].map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => {
                            const bal = selectedHolding?.tokenBalance || 0;
                            setSwapAmountInput(
                              pct === 1 ? String(bal) : String(Math.floor(bal * pct))
                            );
                          }}
                          className="py-1.5 rounded-md border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-mono text-slate-700 dark:text-slate-300 transition-colors"
                        >
                          {pct * 100}%
                        </button>
                      ))}
                </div>

                {/* Gas Priority Tier */}
                <div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1.5">
                    <span>Priority Gas Tier</span>
                    <span className="font-mono">
                      {currentGasInfo.totalGasSol.toFixed(5)} SOL
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['standard', 'fast', 'turbo'] as const).map((tier) => (
                      <button
                        key={tier}
                        type="button"
                        onClick={() => setGasTier(tier)}
                        className={`py-1.5 rounded-md border text-[11px] capitalize font-medium ${
                          gasTier === tier
                            ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                            : 'border-slate-200 dark:border-slate-800 text-slate-500'
                        }`}
                      >
                        {tier}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quote Breakdown */}
                {swapQuote && (
                  <div className="p-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] space-y-1.5 text-xs tabular-nums">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Estimated Output</span>
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {swapQuote.side === 'buy'
                          ? `${formatCompactTokens(swapQuote.quote.tokensOut)} ${selectedCoin.ticker}`
                          : `${swapQuote.quote.netSolOut.toFixed(4)} SOL`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">
                        Fee Split (Proto / Holder / Creator)
                      </span>
                      <span className="font-mono text-slate-600 dark:text-slate-400">
                        {swapQuote.quote.protocolFeeSol.toFixed(4)} /{' '}
                        {swapQuote.quote.holderRewardFeeSol.toFixed(4)} /{' '}
                        {swapQuote.quote.creatorFeeSol.toFixed(4)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">Network Gas Fee</span>
                      <span className="font-mono text-slate-600 dark:text-slate-400">
                        {swapQuote.quote.gasSol.toFixed(5)} SOL
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">Curve Price Shift</span>
                      <span
                        className={`font-mono font-semibold ${
                          swapQuote.side === 'buy' ? 'text-emerald-500' : 'text-red-500'
                        }`}
                      >
                        {swapQuote.side === 'buy' ? '+' : '-'}
                        {swapQuote.quote.priceImpactPct.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                )}

                {swapFeedback && (
                  <div
                    className={`p-3 rounded-lg border text-xs ${
                      swapFeedback.type === 'ok'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
                    }`}
                  >
                    {swapFeedback.text}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleExecuteSwap}
                  disabled={swapBusy}
                  className={`w-full py-2.5 px-4 rounded-lg text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 ${
                    swapSide === 'buy'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {swapBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {swapSide === 'buy'
                    ? `Buy $${selectedCoin.ticker}`
                    : `Sell $${selectedCoin.ticker}`}
                </button>
              </div>

              {/* Bonding Curve Graduation Progress */}
              <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    Bonding Curve Progress
                  </span>
                  <span className="font-mono font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
                    {getBondingProgressPct(
                      selectedCoin.realSol,
                      selectedCoin.mode || 'standard'
                    ).toFixed(1)}
                    %
                  </span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      selectedCoin.mode === 'mayhem' ? 'bg-orange-500' : 'bg-blue-600'
                    }`}
                    style={{
                      width: `${getBondingProgressPct(
                        selectedCoin.realSol,
                        selectedCoin.mode || 'standard'
                      )}%`,
                    }}
                  />
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  {selectedCoin.graduated
                    ? `Graduated! ${getCurveParams(selectedCoin.mode || 'standard').graduationTargetSol} SOL liquidity threshold reached. Continuous AMM trading active.`
                    : `When ${getCurveParams(selectedCoin.mode || 'standard').graduationTargetSol} SOL is collected in the curve (${selectedCoin.realSol.toFixed(2)} SOL raised so far), ${selectedCoin.ticker} reaches DEX graduation.`}
                </p>
              </div>

              {selectedHolding && (
                <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-2 text-xs">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    Your ${selectedCoin.ticker} Position
                  </div>
                  <div className="flex items-center justify-between tabular-nums">
                    <span className="text-slate-500">Token Balance</span>
                    <span className="font-mono font-semibold">
                      {formatCompactTokens(selectedHolding.tokenBalance)} {selectedCoin.ticker}
                    </span>
                  </div>
                  <div className="flex items-center justify-between tabular-nums">
                    <span className="text-slate-500">Current Value</span>
                    <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                      {(selectedHolding.tokenBalance * selectedCoin.priceSol).toFixed(4)} SOL
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* VIEW B: PUMP ARENA MODULES */
        <div className="space-y-5">
          {/* 1. HOME MODULE */}
          {arenaTab === 'home' && (
            <div className="space-y-5">
              {kingOfTheHill ? (
                <div className="p-5 rounded-xl border border-amber-500/30 bg-white dark:bg-[#111827] flex flex-wrap items-center justify-between gap-5">
                  <div className="flex items-center gap-4 min-w-0">
                    <CoinEmblem
                      icon={kingOfTheHill.emblemIcon}
                      color={kingOfTheHill.emblemColor}
                      size="lg"
                    />
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold text-amber-500 flex items-center gap-1.5">
                        <Crown className="w-3.5 h-3.5" />
                        KING OF THE HILL · TOP CURVE LEADER
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <h3 className="text-lg font-display font-bold truncate">
                          {kingOfTheHill.name}
                        </h3>
                        <span className="font-mono text-xs font-semibold text-blue-500">
                          ${kingOfTheHill.ticker}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1 max-w-xl">
                        {kingOfTheHill.description}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-5">
                    <div className="text-xs tabular-nums">
                      <div className="text-slate-500">Market Cap</div>
                      <div className="font-mono font-bold text-sm">
                        {kingOfTheHill.marketCapSol.toFixed(2)} SOL
                      </div>
                    </div>
                    <div className="text-xs tabular-nums">
                      <div className="text-slate-500">24h Volume</div>
                      <div className="font-mono font-bold text-sm">
                        {kingOfTheHill.volumeSol.toFixed(2)} SOL
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedCoinId(kingOfTheHill.id)}
                      className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                    >
                      Trade Leader
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-center space-y-3">
                  <Rocket className="w-8 h-8 text-blue-500 mx-auto" />
                  <h3 className="text-base font-semibold">Launch the First Coin on ChainScope</h3>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Deploy a Standard or Mayhem bonding-curve token, collect holder rewards, and
                    climb to King of the Hill.
                  </p>
                  <button
                    type="button"
                    onClick={() => openCreateModalWithMode('standard')}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Launch Meme Coin
                  </button>
                </div>
              )}

              {/* Quick Module Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
                <button
                  type="button"
                  onClick={() => setArenaTab('go')}
                  className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] hover:border-blue-500/60 transition-colors"
                >
                  <Zap className="w-4 h-4 text-blue-500 mb-2" />
                  <div className="font-semibold">GO Terminal</div>
                  <div className="text-slate-500 mt-0.5">
                    Rapid 10-second coin deploy & 1-click apeing
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setArenaTab('mayhem')}
                  className="text-left p-4 rounded-xl border border-orange-500/30 bg-white dark:bg-[#111827] hover:border-orange-500/70 transition-colors"
                >
                  <Flame className="w-4 h-4 text-orange-500 mb-2" />
                  <div className="font-semibold">Mayhem Mode ({mayhemCoins.length})</div>
                  <div className="text-slate-500 mt-0.5">
                    15 SOL virtual reserve · 2x faster curve velocity
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setArenaTab('perps')}
                  className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] hover:border-blue-500/60 transition-colors"
                >
                  <Layers className="w-4 h-4 text-emerald-500 mb-2" />
                  <div className="font-semibold">Perps · 1x–20x</div>
                  <div className="text-slate-500 mt-0.5">
                    Long or short live meme curves with SOL margin
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setArenaTab('packs')}
                  className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] hover:border-blue-500/60 transition-colors"
                >
                  <Package className="w-4 h-4 text-violet-500 mb-2" />
                  <div className="font-semibold">Packs · Baskets</div>
                  <div className="text-slate-500 mt-0.5">
                    Split SOL across curated or custom 5-coin baskets
                  </div>
                </button>
              </div>

              {coins.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Live Bonding-Curve Spotlight</h3>
                    <button
                      type="button"
                      onClick={() => setArenaTab('explore')}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Explore All ({coins.length})
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {coins.slice(0, 6).map((c) => renderCoinCard(c, false))}
                  </div>
                </div>
              )}

              {activityFeed.length > 0 && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Live Cross-Market Order Tape
                    </h3>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                      Latest {activityFeed.length} trades
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800/80 max-h-72 overflow-y-auto">
                    {activityFeed.slice(0, 15).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedCoinId(item.coinId)}
                        className="w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <CoinEmblem
                            icon={item.emblemIcon}
                            color={item.emblemColor}
                            size="sm"
                          />
                          <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                            @{item.traderHandle}
                          </span>
                          <span
                            className={`font-semibold uppercase ${
                              item.side === 'buy' ? 'text-emerald-500' : 'text-red-500'
                            }`}
                          >
                            {item.side === 'buy' ? 'bought' : 'sold'}
                          </span>
                          <span className="font-mono font-semibold text-blue-600 dark:text-blue-400 truncate">
                            ${item.coinTicker}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 font-mono tabular-nums">
                          <span className="text-slate-900 dark:text-slate-100 font-medium">
                            {item.solAmount.toFixed(3)} SOL
                          </span>
                          <span className="text-slate-400 text-[11px] hidden sm:inline">
                            {formatTimestamp(toMillis(item.createdAt))}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 2. EXPLORE MODULE */}
          {arenaTab === 'explore' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17]">
                  {(['all', 'solana', 'base', 'ethereum', 'polygon'] as const).map((cid) => (
                    <button
                      key={cid}
                      type="button"
                      onClick={() => setChainFilter(cid)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                        chainFilter === cid
                          ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      {cid === 'all' ? 'All Chains' : CHAIN_LABELS[cid]}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <select
                    value={modeFilter}
                    onChange={(e) => setModeFilter(e.target.value as 'all' | CoinMode)}
                    className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] px-2.5 py-1.5"
                  >
                    <option value="all">All Curve Modes</option>
                    <option value="standard">Standard Curve</option>
                    <option value="mayhem">Mayhem Mode</option>
                  </select>

                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={onlyMyHoldings}
                      onChange={(e) => setOnlyMyHoldings(e.target.checked)}
                      className="rounded border-slate-300 dark:border-slate-700 text-blue-600"
                    />
                    My Holdings
                  </label>

                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={onlyStarred}
                      onChange={(e) => setOnlyStarred(e.target.checked)}
                      className="rounded border-slate-300 dark:border-slate-700 text-amber-500"
                    />
                    Starred ({starredIds.length})
                  </label>

                  <select
                    value={sortBy}
                    onChange={(e) =>
                      setSortBy(e.target.value as 'trending' | 'mcap' | 'newest' | 'graduating')
                    }
                    aria-label="Sort meme coins"
                    className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-slate-800 dark:text-slate-200 px-2.5 py-1.5"
                  >
                    <option value="trending">Trending Volume</option>
                    <option value="graduating">Near Graduation</option>
                    <option value="mcap">Highest Market Cap</option>
                    <option value="newest">Newest Launches</option>
                  </select>

                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search coin, ticker, @creator…"
                      className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 w-52 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {loadingCoins ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {Array.from({ length: 6 }).map((_, idx) => (
                    <div
                      key={idx}
                      className="h-44 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] animate-pulse"
                    />
                  ))}
                </div>
              ) : filteredCoins.length === 0 ? (
                <div className="max-w-xl mx-auto my-10 p-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-center space-y-3">
                  <Flame className="w-8 h-8 text-blue-500 mx-auto" />
                  <h3 className="text-base font-semibold">No Coins Match Your Filters</h3>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    Adjust your search filters or launch a fresh bonding-curve coin right now.
                  </p>
                  <button
                    type="button"
                    onClick={() => openCreateModalWithMode('standard')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
                  >
                    <Rocket className="w-3.5 h-3.5" />
                    Launch Meme Coin
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {filteredCoins.map((c) => renderCoinCard(c, false))}
                </div>
              )}
            </div>
          )}

          {/* 3. GO RAPID TERMINAL */}
          {arenaTab === 'go' && (
            <div className="space-y-5">
              <form
                onSubmit={handleGoLaunch}
                className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <Zap className="w-4 h-4 text-blue-500" />
                      GO — Instant Coin Deploy & Fast Ape Terminal
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Deploy a coin in one bar or ape directly into live curves below using your
                      active {gasTier} gas tier.
                    </p>
                  </div>
                  <div className="text-[11px] font-mono text-slate-500">
                    Deploy Fee: {economics.creationFeeSol} SOL + {currentGasInfo.totalGasSol.toFixed(5)}{' '}
                    gas
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={32}
                    value={goName}
                    onChange={(e) => setGoName(e.target.value)}
                    placeholder="Coin Name"
                    className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
                  />
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={10}
                    value={goTicker}
                    onChange={(e) =>
                      setGoTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                    }
                    placeholder="TICKER"
                    className="px-3 py-2 text-xs font-mono uppercase rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
                  />
                  <input
                    type="text"
                    maxLength={280}
                    value={goLore}
                    onChange={(e) => setGoLore(e.target.value)}
                    placeholder="Quick lore (optional)"
                    className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] lg:col-span-2"
                  />
                  <select
                    value={goMode}
                    onChange={(e) => setGoMode(e.target.value as CoinMode)}
                    className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
                  >
                    <option value="standard">Standard Curve</option>
                    <option value="mayhem">Mayhem Curve</option>
                  </select>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="0"
                      max="25"
                      step="0.05"
                      value={goBuySol}
                      onChange={(e) => setGoBuySol(e.target.value)}
                      placeholder="Dev SOL"
                      className="w-20 px-2.5 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
                    />
                    <button
                      type="submit"
                      disabled={goBusy}
                      className="flex-1 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-semibold whitespace-nowrap"
                    >
                      {goBusy ? 'Deploying…' : 'GO Launch'}
                    </button>
                  </div>
                </div>

                {goFeedback && (
                  <div
                    className={`p-3 rounded-lg border text-xs ${
                      goFeedback.type === 'ok'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
                    }`}
                  >
                    {goFeedback.text}
                  </div>
                )}
              </form>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {coins.map((c) => renderCoinCard(c, true))}
              </div>
            </div>
          )}

          {/* 4. MAYHEM ARENA */}
          {arenaTab === 'mayhem' && (
            <div className="space-y-5">
              <div className="p-5 rounded-xl border border-orange-500/30 bg-white dark:bg-[#111827] flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold flex items-center gap-2 text-orange-500">
                    <Flame className="w-4 h-4" />
                    Mayhem Mode — Hyper-Elastic Bonding Curves
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
                    Mayhem tokens seed with <span className="font-mono">15 SOL</span> virtual
                    liquidity instead of 30 SOL and graduate at{' '}
                    <span className="font-mono">45 SOL</span> — producing 2x steeper upward and
                    downward price movement per SOL traded.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => openCreateModalWithMode('mayhem')}
                  className="px-4 py-2.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <Flame className="w-3.5 h-3.5" />
                  Launch Mayhem Coin
                </button>
              </div>

              {mayhemCoins.length === 0 ? (
                <div className="p-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-center space-y-3">
                  <Flame className="w-7 h-7 text-orange-500 mx-auto" />
                  <h4 className="text-sm font-semibold">No Mayhem Coins Launched Yet</h4>
                  <p className="text-xs text-slate-500">
                    Be the first to ignite a high-velocity Mayhem bonding curve.
                  </p>
                  <button
                    type="button"
                    onClick={() => openCreateModalWithMode('mayhem')}
                    className="px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold"
                  >
                    Create Mayhem Coin
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {mayhemCoins.map((c) => renderCoinCard(c, true))}
                </div>
              )}
            </div>
          )}

          {/* 5. HOLDER REWARDS */}
          {arenaTab === 'rewards' && (
            <HolderRewardsPanel
              userUid={user.uid}
              coins={coins}
              holdings={holdings}
              rewardClaims={rewardClaims}
              economics={economics}
              onSelectCoin={(id) => setSelectedCoinId(id)}
              onMutated={refreshAll}
            />
          )}

          {/* 6. PERPS */}
          {arenaTab === 'perps' && (
            <PerpsPanel
              userUid={user.uid}
              profile={profile}
              coins={coins}
              perpPositions={perpPositions}
              gasTier={gasTier}
              economics={economics}
              onMutated={refreshAll}
            />
          )}

          {/* 7. PACKS */}
          {arenaTab === 'packs' && (
            <PacksPanel
              userUid={user.uid}
              coins={coins}
              gasTier={gasTier}
              economics={economics}
              onSelectCoin={(id) => setSelectedCoinId(id)}
              onMutated={refreshAll}
            />
          )}

          {/* 8. LEADERBOARD */}
          {arenaTab === 'leaderboard' && (
            <LeaderboardPanel
              traders={traders}
              coins={coins}
              solUsdPrice={solUsdPrice}
              onSelectCoin={(id) => setSelectedCoinId(id)}
            />
          )}
        </div>
      )}

      {/* MODAL: LAUNCH NEW MEME COIN */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Launch Meme Coin"
        >
          <div className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Launch a Meme Coin on the Bonding Curve
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  1,000,000,000 fixed supply · Fair launch · Creation fee{' '}
                  {economics.creationFeeSol} SOL
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Close launch modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleLaunchSubmit} className="space-y-4">
              {/* Curve Mode Selector */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCoinMode('standard')}
                  className={`p-3 rounded-lg border text-left text-xs transition-colors ${
                    coinMode === 'standard'
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="font-semibold text-blue-500">Standard Curve</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    30v SOL reserve · 85 SOL graduation
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setCoinMode('mayhem')}
                  className={`p-3 rounded-lg border text-left text-xs transition-colors ${
                    coinMode === 'mayhem'
                      ? 'border-orange-500 bg-orange-500/10'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="font-semibold text-orange-500 flex items-center gap-1">
                    <Flame className="w-3.5 h-3.5" />
                    Mayhem Curve
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    15v SOL reserve · 45 SOL graduation (2x volatility)
                  </div>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Coin Name
                  </label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={32}
                    value={coinName}
                    onChange={(e) => setCoinName(e.target.value)}
                    placeholder="e.g., Rocket Frog"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Ticker Symbol
                  </label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={10}
                    value={coinTicker}
                    onChange={(e) =>
                      setCoinTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                    }
                    placeholder="e.g., RFROG"
                    className="w-full px-3 py-2 text-xs font-mono uppercase rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Description / Lore
                </label>
                <textarea
                  required
                  rows={2}
                  maxLength={280}
                  value={coinDesc}
                  onChange={(e) => setCoinDesc(e.target.value)}
                  placeholder="What is the narrative behind this token?"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                    Token Emblem Icon & Accent
                  </label>
                  <div className="flex items-center gap-3">
                    <CoinEmblem icon={coinIcon} color={coinColor} size="lg" />
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        {EMBLEM_ICONS.map((ic) => (
                          <button
                            key={ic}
                            type="button"
                            onClick={() => setCoinIcon(ic)}
                            className={`px-2 py-1 rounded text-[11px] border transition-colors ${
                              coinIcon === ic
                                ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold'
                                : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                            }`}
                          >
                            {ic}
                          </button>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {EMBLEM_COLORS.map((col) => (
                          <button
                            key={col}
                            type="button"
                            onClick={() => setCoinColor(col)}
                            aria-label={`Select color ${col}`}
                            className={`w-5 h-5 rounded-full border-2 ${
                              coinColor === col ? 'border-white scale-110' : 'border-transparent'
                            }`}
                            style={{ backgroundColor: col }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Target Network
                    </label>
                    <select
                      value={coinChain}
                      onChange={(e) => setCoinChain(e.target.value as LaunchChain)}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100"
                    >
                      <option value="solana">Solana</option>
                      <option value="base">Base</option>
                      <option value="ethereum">Ethereum</option>
                      <option value="polygon">Polygon</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Dev Buy (SOL)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="25"
                        step="0.1"
                        value={devBuySol}
                        onChange={(e) => setDevBuySol(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Deploy Gas
                      </label>
                      <select
                        value={launchGasTier}
                        onChange={(e) => setLaunchGasTier(e.target.value as GasTier)}
                        className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
                      >
                        <option value="standard">Standard</option>
                        <option value="fast">Fast</option>
                        <option value="turbo">Turbo</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Website (Optional)
                  </label>
                  <input
                    type="text"
                    maxLength={120}
                    value={coinWebsite}
                    onChange={(e) => setCoinWebsite(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    X / Twitter (Optional)
                  </label>
                  <input
                    type="text"
                    maxLength={64}
                    value={coinTwitter}
                    onChange={(e) => setCoinTwitter(e.target.value)}
                    placeholder="@handle"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              {/* Curve & Cost Preview */}
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-xs space-y-1 tabular-nums">
                <div className="flex justify-between">
                  <span className="text-slate-500">Initial Dev Allocation</span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {formatCompactTokens(devBuyPreview.tokensOut)} {coinTicker || 'TOKEN'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Deploy Fee + Gas</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">
                    {economics.creationFeeSol.toFixed(4)} + {devBuyPreview.gasSol.toFixed(5)} SOL
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Starting Market Cap</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">
                    {devBuyPreview.newMarketCapSol.toFixed(2)} SOL
                  </span>
                </div>
              </div>

              {launchError && (
                <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-600 dark:text-red-400">
                  {launchError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={launchBusy}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium transition-colors"
                >
                  {launchBusy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <TrendingUp className="w-3.5 h-3.5" />
                  )}
                  Deploy Coin Now
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ACCOUNT PROFILE SETTINGS */}
      {showProfileModal && profile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Account Settings"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Trader Account Settings
              </h3>
              <button
                type="button"
                onClick={() => setShowProfileModal(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Close profile modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Handle (alphanumeric & underscore)
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={32}
                  value={editHandle}
                  onChange={(e) => setEditHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  required
                  maxLength={50}
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Linked Public Wallet Address (Optional)
                </label>
                <input
                  type="text"
                  maxLength={64}
                  value={editLinkedWallet}
                  onChange={(e) => setEditLinkedWallet(e.target.value)}
                  placeholder="Paste or pick a ChainScope wallet below"
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100"
                />
                {walletAddresses.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {walletAddresses.map((wa) => (
                      <button
                        key={wa.address}
                        type="button"
                        onClick={() => setEditLinkedWallet(wa.address)}
                        className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] text-slate-600 dark:text-slate-300"
                      >
                        Use {wa.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {profileMsg && (
                <div className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {profileMsg}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowProfileModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={profileBusy}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium"
                >
                  {profileBusy ? 'Saving…' : 'Save Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showDepositModal && (
        <DepositToPlatformModal
          wallets={wallets}
          scanStates={scanStates}
          onClose={() => setShowDepositModal(false)}
          onGoConnectWallet={
            onOpenConnect
              ? () => {
                  setShowDepositModal(false);
                  onOpenConnect();
                }
              : undefined
          }
          onSuccess={() => refreshAll()}
        />
      )}

      {showTransferModal && profile && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Send SOL to Trader Handle
              </h3>
              <button
                type="button"
                onClick={() => setShowTransferModal(false)}
                className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setTransferBusy(true);
                setTransferFeedback(null);
                try {
                  const res = await transferPlatformSol({
                    recipientHandle: transferHandle,
                    amountSol: Number(transferAmount),
                    memo: transferMemo,
                  });
                  await refreshAll();
                  setTransferFeedback({
                    type: 'ok',
                    text: `Sent ${res.amountSol.toFixed(4)} SOL to @${res.recipientHandle}.`,
                  });
                  setTransferHandle('');
                  setTransferMemo('');
                } catch (err) {
                  setTransferFeedback({
                    type: 'err',
                    text: err instanceof Error ? err.message : 'Transfer failed',
                  });
                } finally {
                  setTransferBusy(false);
                }
              }}
              className="p-5 space-y-4 text-xs"
            >
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <span className="text-slate-500">Available Platform Liquidity</span>
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                  {profile.solBalance.toFixed(4)} SOL
                </span>
              </div>

              <div>
                <label className="block text-slate-500 mb-1">Recipient @handle</label>
                <input
                  type="text"
                  required
                  value={transferHandle}
                  onChange={(e) => setTransferHandle(e.target.value)}
                  placeholder="@traderhandle"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-500 mb-1">Amount (SOL)</label>
                <input
                  type="number"
                  required
                  min="0.001"
                  step="any"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] font-mono tabular-nums text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-500 mb-1">Memo (optional)</label>
                <input
                  type="text"
                  maxLength={120}
                  value={transferMemo}
                  onChange={(e) => setTransferMemo(e.target.value)}
                  placeholder="Optional note…"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100"
                />
              </div>

              {transferFeedback && (
                <div
                  className={`p-2.5 rounded-lg ${
                    transferFeedback.type === 'ok'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                      : 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/30'
                  }`}
                >
                  {transferFeedback.text}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowTransferModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 font-medium"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={transferBusy}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium inline-flex items-center gap-1.5"
                >
                  {transferBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  {transferBusy ? 'Sending…' : 'Send SOL'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
