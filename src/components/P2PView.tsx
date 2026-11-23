import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Clock,
  CreditCard,
  Globe,
  Loader2,
  Lock,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  formatFiatAmount,
  getAllPaymentMethodsCount,
  getCountryByCode,
  getPaymentMethodsForCountry,
  P2P_COUNTRIES,
} from '../data/p2pPayments';
import {
  createP2PAd,
  createP2POrder,
  deleteP2PPaymentProfile,
  fetchP2POverview,
  saveP2PPaymentProfile,
  updateP2PAdStatus,
} from '../services/p2p';
import type {
  P2PAd,
  P2PAdSide,
  P2PAsset,
  P2PEscrowMode,
  P2POrder,
  P2POverviewResponse,
  P2PPriceType,
} from '../types/p2p';
import type { WalletEntry } from '../types/wallet';
import { formatTimestamp, truncateAddress } from '../utils/chains';
import { P2PTradeRoom } from './P2PTradeRoom';

interface P2PViewProps {
  wallets: WalletEntry[];
}

const P2P_ASSETS: P2PAsset[] = ['USDT', 'USD1', 'CSC', 'SOL', 'ETH', 'BNB'];

export function P2PView({ wallets }: P2PViewProps) {
  const { user, walletAccount, setShowOnboardingModal } = useAuth();
  const [overview, setOverview] = useState<P2POverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Navigation & Active Trade Room
  const [subTab, setSubTab] = useState<'market' | 'orders' | 'my_ads'>('market');
  const [activeOrder, setActiveOrder] = useState<P2POrder | null>(null);

  // Marketplace Filters
  const [intentTab, setIntentTab] = useState<'buy' | 'sell'>('buy');
  const [assetFilter, setAssetFilter] = useState<P2PAsset>('USDT');
  const [countryFilter, setCountryFilter] = useState<string>('ALL');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<string>('ALL');
  const [fiatAmountFilter, setFiatAmountFilter] = useState<string>('');
  const [searchMaker, setSearchMaker] = useState<string>('');

  // Modals
  const [showPostAdModal, setShowPostAdModal] = useState(false);
  const [showPaymentsModal, setShowPaymentsModal] = useState(false);
  const [tradeModalAd, setTradeModalAd] = useState<P2PAd | null>(null);

  // Post Ad Form
  const [adSide, setAdSide] = useState<P2PAdSide>('sell');
  const [adAsset, setAdAsset] = useState<P2PAsset>('USDT');
  const [adCountryCode, setAdCountryCode] = useState<string>('KE');
  const [adPriceType, setAdPriceType] = useState<P2PPriceType>('fixed');
  const [adFixedPrice, setAdFixedPrice] = useState<string>('129.50');
  const [adMarginPct, setAdMarginPct] = useState<string>('0');
  const [adQuantity, setAdQuantity] = useState<string>('250');
  const [adMinFiat, setAdMinFiat] = useState<string>('1000');
  const [adMaxFiat, setAdMaxFiat] = useState<string>('50000');
  const [adMethods, setAdMethods] = useState<string[]>(['ke_mpesa']);
  const [adEscrowMode, setAdEscrowMode] = useState<P2PEscrowMode>('vault_balance');
  const [adWindowMins, setAdWindowMins] = useState<string>('15');
  const [adTerms, setAdTerms] = useState<string>(
    'Fast 1:1 verified release. Attach clear receipt screenshot and payment reference ID.'
  );
  const [submittingAd, setSubmittingAd] = useState(false);

  // Payment Profiles Form
  const [payCountryCode, setPayCountryCode] = useState<string>('KE');
  const [payMethodId, setPayMethodId] = useState<string>('ke_mpesa');
  const [payHolder, setPayHolder] = useState<string>('');
  const [payDetails, setPayDetails] = useState<string>('');
  const [payInstructions, setPayInstructions] = useState<string>('');
  const [savingPayment, setSavingPayment] = useState(false);

  // Open Trade Form
  const [tradeFiatInput, setTradeFiatInput] = useState<string>('');
  const [tradeMethodId, setTradeMethodId] = useState<string>('');
  const [takerSellerHolder, setTakerSellerHolder] = useState<string>('');
  const [takerSellerDetails, setTakerSellerDetails] = useState<string>('');
  const [openingTrade, setOpeningTrade] = useState(false);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchP2POverview();
      setOverview(res);
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to load P2P marketplace',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview, user?.uid]);

  const spotPrices = useMemo(
    () =>
      overview?.spotPricesUsd || {
        USDT: 1,
        USD1: 1,
        CSC: 0.25,
        SOL: 185,
        ETH: 3100,
        BNB: 615,
      },
    [overview]
  );

  // Recalculate suggested price whenever Post Ad country/asset changes
  const handleSelectAdCountry = (code: string) => {
    setAdCountryCode(code);
    const c = getCountryByCode(code);
    const est = (spotPrices[adAsset] || 1) * c.ratePerUsd;
    setAdFixedPrice(est >= 100 ? est.toFixed(0) : est.toFixed(2));
    setAdMinFiat(est >= 100 ? (10 * c.ratePerUsd).toFixed(0) : '10');
    setAdMaxFiat(est >= 100 ? (500 * c.ratePerUsd).toFixed(0) : '1000');
    const available = getPaymentMethodsForCountry(code);
    setAdMethods(available[0] ? [available[0].id] : []);
  };

  const handleSelectAdAsset = (asset: P2PAsset) => {
    setAdAsset(asset);
    const c = getCountryByCode(adCountryCode);
    const est = (spotPrices[asset] || 1) * c.ratePerUsd;
    setAdFixedPrice(est >= 100 ? est.toFixed(0) : est.toFixed(2));
    if (!['CSC', 'USDT', 'USD1', 'SOL'].includes(asset)) {
      setAdEscrowMode('onchain_proof');
    }
  };

  const adCountryMethods = useMemo(
    () => getPaymentMethodsForCountry(adCountryCode),
    [adCountryCode]
  );

  const payCountryMethods = useMemo(
    () => getPaymentMethodsForCountry(payCountryCode),
    [payCountryCode]
  );

  const filterPaymentOptions = useMemo(() => {
    if (countryFilter !== 'ALL') {
      return getPaymentMethodsForCountry(countryFilter);
    }
    const seen = new Map<string, string>();
    for (const c of P2P_COUNTRIES) {
      for (const m of c.methods) {
        if (!seen.has(m.id)) seen.set(m.id, `${m.name} (${c.code})`);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [countryFilter]);

  const filteredAds = useMemo(() => {
    const ads = overview?.ads || [];
    // If user wants to BUY crypto, match makers whose ad.side === 'sell'
    const requiredMakerSide: P2PAdSide = intentTab === 'buy' ? 'sell' : 'buy';
    const fiatAmt = Number(fiatAmountFilter || 0);
    const q = searchMaker.trim().toLowerCase();

    return ads.filter((ad) => {
      if (ad.status !== 'active') return false;
      if (ad.side !== requiredMakerSide) return false;
      if (ad.asset !== assetFilter) return false;
      if (countryFilter !== 'ALL' && ad.countryCode !== countryFilter) return false;
      if (paymentMethodFilter !== 'ALL' && !ad.paymentMethodIds.includes(paymentMethodFilter)) {
        return false;
      }
      if (fiatAmt > 0 && (fiatAmt < ad.minFiatOrder || fiatAmt > ad.maxFiatOrder)) {
        return false;
      }
      if (
        q &&
        !ad.makerUsername.toLowerCase().includes(q) &&
        !ad.makerWalletAddress.toLowerCase().includes(q) &&
        !ad.paymentMethodNames.some((n) => n.toLowerCase().includes(q))
      ) {
        return false;
      }
      return true;
    });
  }, [
    overview,
    intentTab,
    assetFilter,
    countryFilter,
    paymentMethodFilter,
    fiatAmountFilter,
    searchMaker,
  ]);

  const handleToggleAdMethod = (id: string) => {
    setAdMethods((prev) => {
      if (prev.includes(id)) {
        return prev.length > 1 ? prev.filter((x) => x !== id) : prev;
      }
      if (prev.length >= 6) return prev;
      return [...prev, id];
    });
  };

  const handleSubmitAd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setShowOnboardingModal(true);
      return;
    }
    setSubmittingAd(true);
    setBanner(null);
    try {
      await createP2PAd({
        side: adSide,
        asset: adAsset,
        countryCode: adCountryCode,
        priceType: adPriceType,
        fixedPriceFiat: Number(adFixedPrice),
        floatingMarginPct: Number(adMarginPct),
        availableCryptoAmount: Number(adQuantity),
        minFiatOrder: Number(adMinFiat),
        maxFiatOrder: Number(adMaxFiat),
        paymentMethodIds: adMethods,
        paymentWindowMins: Number(adWindowMins),
        escrowMode: adEscrowMode,
        terms: adTerms.trim(),
      });
      setShowPostAdModal(false);
      setBanner({ type: 'ok', text: `Posted verified ${adSide.toUpperCase()} ${adAsset} P2P offer.` });
      await loadOverview();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Unable to post ad' });
    } finally {
      setSubmittingAd(false);
    }
  };

  const handleSavePaymentProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setShowOnboardingModal(true);
      return;
    }
    setSavingPayment(true);
    setBanner(null);
    try {
      await saveP2PPaymentProfile({
        countryCode: payCountryCode,
        methodId: payMethodId,
        accountHolder: payHolder,
        accountDetails: payDetails,
        instructions: payInstructions,
      });
      setPayHolder('');
      setPayDetails('');
      setPayInstructions('');
      setBanner({ type: 'ok', text: 'Saved payment rail to your P2P account.' });
      await loadOverview();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setSavingPayment(false);
    }
  };

  const handleDeletePaymentProfile = async (id: string) => {
    try {
      await deleteP2PPaymentProfile(id);
      await loadOverview();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Delete failed' });
    }
  };

  const handleOpenTradeModal = (ad: P2PAd) => {
    if (!user) {
      setShowOnboardingModal(true);
      return;
    }
    setTradeModalAd(ad);
    setTradeFiatInput(String(ad.minFiatOrder));
    setTradeMethodId(ad.paymentMethodIds[0] || '');
    const saved = overview?.myPaymentProfiles.find((p) =>
      ad.paymentMethodIds.includes(p.methodId)
    );
    setTakerSellerHolder(saved?.accountHolder || walletAccount?.displayName || '');
    setTakerSellerDetails(saved?.accountDetails || '');
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tradeModalAd) return;
    setOpeningTrade(true);
    setBanner(null);
    try {
      const order = await createP2POrder({
        adId: tradeModalAd.id,
        fiatAmount: Number(tradeFiatInput),
        paymentMethodId: tradeMethodId,
        sellerPaymentDetails:
          tradeModalAd.side === 'buy' && takerSellerDetails.trim()
            ? {
                accountHolder: takerSellerHolder.trim(),
                accountDetails: takerSellerDetails.trim(),
              }
            : undefined,
      });
      setTradeModalAd(null);
      setActiveOrder(order);
      await loadOverview();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Order failed' });
    } finally {
      setOpeningTrade(false);
    }
  };

  const handleToggleAdPause = async (ad: P2PAd) => {
    const next = ad.status === 'active' ? 'paused' : 'active';
    try {
      await updateP2PAdStatus(ad.id, next);
      await loadOverview();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Update failed' });
    }
  };

  const boundWalletSummary =
    walletAccount?.evmAddress ||
    walletAccount?.solanaAddress ||
    wallets[0]?.evmAddress ||
    wallets[0]?.solanaAddress ||
    '';

  if (activeOrder) {
    return (
      <P2PTradeRoom
        initialOrder={activeOrder}
        onBack={() => {
          setActiveOrder(null);
          void loadOverview();
        }}
        onOrderChanged={(updated) => {
          setActiveOrder(updated);
          setOverview((prev) => {
            if (!prev) return prev;
            const exists = prev.myOrders.some((o) => o.id === updated.id);
            return {
              ...prev,
              myOrders: exists
                ? prev.myOrders.map((o) => (o.id === updated.id ? updated : o))
                : [updated, ...prev.myOrders],
            };
          });
        }}
      />
    );
  }

  const myOrders = overview?.myOrders || [];
  const myAds = (overview?.ads || []).filter((a) => a.makerUid === user?.uid);
  const myPaymentProfiles = overview?.myPaymentProfiles || [];

  return (
    <div className="space-y-6">
      {/* Top Header Strip */}
      <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
              <ShieldCheck className="w-3.5 h-3.5" />
              1:1 Wallet-Bound Identity
            </span>
            <span aria-hidden="true">·</span>
            <span>Proof-Based Crypto Escrow</span>
            <span aria-hidden="true">·</span>
            <span>
              {overview?.stats.countriesSupported || P2P_COUNTRIES.length} Countries ·{' '}
              {overview?.stats.paymentMethodsCount || getAllPaymentMethodsCount()}+ Payment Rails
            </span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            Decentralized Peer-to-Peer Exchange
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Self-custody trading where Sellers lock crypto in Escrow, Buyers attach fiat receipt proof,
            and KingAdmin moderates disputes over live WebSocket rooms.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              if (!user) {
                setShowOnboardingModal(true);
                return;
              }
              setShowPaymentsModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium whitespace-nowrap"
          >
            <CreditCard className="w-3.5 h-3.5" />
            Payment Methods ({myPaymentProfiles.length})
          </button>

          <button
            type="button"
            onClick={() => {
              if (!user) {
                setShowOnboardingModal(true);
                return;
              }
              setShowPostAdModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            Post P2P Offer
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="text-xs text-slate-500">Active Offers</div>
          <div className="mt-1 text-lg font-mono font-bold tabular-nums">
            {overview?.stats.activeAds ?? 0}
          </div>
        </div>
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="text-xs text-slate-500">Open Escrow Orders</div>
          <div className="mt-1 text-lg font-mono font-bold tabular-nums">
            {overview?.stats.openOrders ?? 0}
          </div>
        </div>
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="text-xs text-slate-500">Completed P2P Trades</div>
          <div className="mt-1 text-lg font-mono font-bold tabular-nums">
            {overview?.stats.completedTrades ?? 0}
          </div>
        </div>
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="text-xs text-slate-500">Your Bound 1:1 Identity</div>
          <div className="mt-1 text-xs font-mono font-semibold truncate">
            {walletAccount?.username
              ? `@${walletAccount.username} · ${truncateAddress(boundWalletSummary, 5, 4)}`
              : user
              ? `@${user.displayName || 'trader'}`
              : 'Sign in to Trade'}
          </div>
        </div>
      </div>

      {banner && (
        <div
          className={`px-4 py-3 rounded-lg border text-xs font-medium flex items-center justify-between ${
            banner.type === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
          }`}
        >
          <span>{banner.text}</span>
          <button type="button" onClick={() => setBanner(null)}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Sub-Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-xs">
          <button
            type="button"
            onClick={() => setSubTab('market')}
            className={`px-3.5 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap ${
              subTab === 'market'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Orderbook Marketplace
          </button>
          <button
            type="button"
            onClick={() => setSubTab('orders')}
            className={`px-3.5 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap ${
              subTab === 'orders'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            My Orders ({myOrders.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('my_ads')}
            className={`px-3.5 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap ${
              subTab === 'my_ads'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            My Posted Ads ({myAds.length})
          </button>
        </div>

        <button
          type="button"
          onClick={() => void loadOverview()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* ORDERBOOK MARKETPLACE */}
      {subTab === 'market' && (
        <div className="space-y-4">
          {/* Filter Controls Bar */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Buy / Sell Segmented Toggle */}
              <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17] text-xs">
                <button
                  type="button"
                  onClick={() => setIntentTab('buy')}
                  className={`px-4 py-1.5 rounded-md font-semibold transition-colors whitespace-nowrap ${
                    intentTab === 'buy'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Buy Crypto
                </button>
                <button
                  type="button"
                  onClick={() => setIntentTab('sell')}
                  className={`px-4 py-1.5 rounded-md font-semibold transition-colors whitespace-nowrap ${
                    intentTab === 'sell'
                      ? 'bg-amber-600 text-white'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Sell Crypto
                </button>
              </div>

              {/* Asset Selector */}
              <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17] text-xs">
                {P2P_ASSETS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setAssetFilter(a)}
                    className={`px-3 py-1.5 rounded-md font-mono font-semibold transition-colors whitespace-nowrap ${
                      assetFilter === a
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">
                  Country & Currency
                </label>
                <div className="relative">
                  <Globe className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <select
                    value={countryFilter}
                    onChange={(e) => {
                      setCountryFilter(e.target.value);
                      setPaymentMethodFilter('ALL');
                    }}
                    className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs"
                  >
                    <option value="ALL">All Countries & Currencies</option>
                    {P2P_COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name} ({c.currency}) — {c.region}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">
                  Payment Method
                </label>
                <select
                  value={paymentMethodFilter}
                  onChange={(e) => setPaymentMethodFilter(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs"
                >
                  <option value="ALL">All Payment Methods</option>
                  {filterPaymentOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">
                  Fiat Amount Filter
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={fiatAmountFilter}
                  onChange={(e) => setFiatAmountFilter(e.target.value)}
                  placeholder="Enter amount (e.g. 5000)"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">
                  Search Maker or Wallet
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchMaker}
                    onChange={(e) => setSearchMaker(e.target.value)}
                    placeholder="@username or 0x..."
                    className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Orderbook Table */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
            {loading && (overview?.ads || []).length === 0 ? (
              <div className="p-12 flex items-center justify-center text-xs text-slate-500 gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading live P2P offers…
              </div>
            ) : filteredAds.length === 0 ? (
              <div className="p-12 text-center space-y-3">
                <ArrowLeftRight className="w-7 h-7 mx-auto text-slate-400" />
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  No matching {intentTab === 'buy' ? 'Sell' : 'Buy'} offers yet
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  Switch country/payment filters or post the first verified P2P offer in this market directly from your 1:1 bound wallet.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (!user) {
                      setShowOnboardingModal(true);
                      return;
                    }
                    setAdSide(intentTab === 'buy' ? 'sell' : 'buy');
                    setShowPostAdModal(true);
                  }}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
                >
                  Post First Offer
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                      <th className="py-3 px-4 font-medium">Maker (1:1 Wallet)</th>
                      <th className="py-3 px-4 font-medium">Unit Price</th>
                      <th className="py-3 px-4 font-medium">Available & Limits</th>
                      <th className="py-3 px-4 font-medium">Payment Methods</th>
                      <th className="py-3 px-4 font-medium text-right">Trade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {filteredAds.map((ad) => {
                      const isOwn = user?.uid === ad.makerUid;
                      return (
                        <tr
                          key={ad.id}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="py-3.5 px-4 align-top">
                            <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                              <span>@{ad.makerUsername}</span>
                              {ad.makerStats.verifiedWallet && (
                                <span title="1:1 Verified Bound Wallet" className="inline-flex">
                                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                              {truncateAddress(ad.makerWalletAddress, 6, 4)}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
                              {ad.makerStats.completedOrders} orders · {ad.makerStats.completionRatePct}% · ~{ad.makerStats.avgReleaseMins}m
                            </div>
                          </td>

                          <td className="py-3.5 px-4 align-top">
                            <div className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                              {formatFiatAmount(ad.effectivePriceFiat, ad.fiatCurrency)}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              per {ad.asset} · {ad.priceType === 'floating' ? `Float ${ad.floatingMarginPct >= 0 ? '+' : ''}${ad.floatingMarginPct}%` : 'Fixed'}
                            </div>
                          </td>

                          <td className="py-3.5 px-4 align-top font-mono tabular-nums">
                            <div className="text-slate-900 dark:text-slate-100 font-medium">
                              {ad.availableCryptoAmount.toFixed(4)} {ad.asset}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              {formatFiatAmount(ad.minFiatOrder, ad.fiatCurrency)} –{' '}
                              {formatFiatAmount(ad.maxFiatOrder, ad.fiatCurrency)}
                            </div>
                          </td>

                          <td className="py-3.5 px-4 align-top max-w-[260px]">
                            <div className="text-slate-700 dark:text-slate-300 leading-relaxed">
                              {ad.paymentMethodNames.join(' · ')}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {ad.paymentWindowMins}m window · {getCountryByCode(ad.countryCode).name}
                            </div>
                          </td>

                          <td className="py-3.5 px-4 align-top text-right">
                            <button
                              type="button"
                              disabled={isOwn}
                              onClick={() => handleOpenTradeModal(ad)}
                              className={`px-4 py-2 rounded-lg text-xs font-semibold text-white whitespace-nowrap transition-colors disabled:opacity-40 ${
                                intentTab === 'buy'
                                  ? 'bg-emerald-600 hover:bg-emerald-700'
                                  : 'bg-amber-600 hover:bg-amber-700'
                              }`}
                            >
                              {isOwn
                                ? 'Your Ad'
                                : intentTab === 'buy'
                                ? `Buy ${ad.asset}`
                                : `Sell ${ad.asset}`}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MY ACTIVE & PAST ORDERS */}
      {subTab === 'orders' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
          {myOrders.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-500">
              You have no P2P escrow orders yet. Open a trade from the Orderbook Marketplace.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {myOrders.map((ord) => {
                const role = ord.sellerUid === user?.uid ? 'Selling' : 'Buying';
                return (
                  <div
                    key={ord.id}
                    className="p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <div className="space-y-1 text-xs">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {role} {ord.cryptoAmount} {ord.asset} for{' '}
                        <span className="font-mono">
                          {formatFiatAmount(ord.fiatAmount, ord.fiatCurrency)}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        #{ord.id.slice(-8)} · {ord.paymentMethodName} · Seller @{ord.sellerUsername} · Buyer @{ord.buyerUsername} · {formatTimestamp(ord.updatedAt)}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span
                        className={`text-xs font-semibold ${
                          ord.status === 'disputed'
                            ? 'text-red-500'
                            : ord.status === 'released' || ord.status === 'resolved_buyer'
                            ? 'text-emerald-500'
                            : 'text-blue-500'
                        }`}
                      >
                        {ord.status}
                      </span>
                      <button
                        type="button"
                        onClick={() => setActiveOrder(ord)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        Open Trade Room
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MY POSTED ADS */}
      {subTab === 'my_ads' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
          {myAds.length === 0 ? (
            <div className="p-12 text-center space-y-3 text-xs text-slate-500">
              <div>You haven&apos;t posted any P2P offers yet.</div>
              <button
                type="button"
                onClick={() => setShowPostAdModal(true)}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold"
              >
                Post Your First P2P Offer
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {myAds.map((ad) => (
                <div
                  key={ad.id}
                  className="p-4 flex flex-wrap items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-1">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {ad.side.toUpperCase()} {ad.asset} ·{' '}
                      <span className="font-mono">
                        {formatFiatAmount(ad.effectivePriceFiat, ad.fiatCurrency)}
                      </span>{' '}
                      ({getCountryByCode(ad.countryCode).name})
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Available: {ad.availableCryptoAmount} {ad.asset} · Rails:{' '}
                      {ad.paymentMethodNames.join(', ')} · Status: {ad.status}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleToggleAdPause(ad)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
                    >
                      {ad.status === 'active' ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void updateP2PAdStatus(ad.id, 'closed').then(loadOverview)}
                      className="px-3 py-1.5 rounded-lg border border-red-500/30 text-red-500 hover:bg-red-500/10 font-medium"
                    >
                      Close
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODAL: POST P2P AD */}
      {showPostAdModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold">Post Decentralized P2P Offer</h3>
                <p className="text-xs text-slate-500">
                  Bound to @{walletAccount?.username || 'trader'} ({truncateAddress(boundWalletSummary, 6, 4)})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPostAdModal(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSubmitAd(e)} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                    I Want To
                  </label>
                  <select
                    value={adSide}
                    onChange={(e) => setAdSide(e.target.value as P2PAdSide)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
                  >
                    <option value="sell">Sell Crypto (Lock Escrow, Receive Fiat)</option>
                    <option value="buy">Buy Crypto (Send Fiat, Receive Crypto)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Crypto Asset
                  </label>
                  <select
                    value={adAsset}
                    onChange={(e) => handleSelectAdAsset(e.target.value as P2PAsset)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] font-mono"
                  >
                    {P2P_ASSETS.map((a) => (
                      <option key={a} value={a}>
                        {a} (~${(spotPrices[a] || 1).toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Country & Local Fiat
                  </label>
                  <select
                    value={adCountryCode}
                    onChange={(e) => handleSelectAdCountry(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
                  >
                    {P2P_COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name} ({c.currency})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Pricing Mode
                  </label>
                  <select
                    value={adPriceType}
                    onChange={(e) => setAdPriceType(e.target.value as P2PPriceType)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
                  >
                    <option value="fixed">Fixed Unit Price</option>
                    <option value="floating">Floating Spot Margin (%)</option>
                  </select>
                </div>

                {adPriceType === 'fixed' ? (
                  <div>
                    <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Price ({getCountryByCode(adCountryCode).currency} per {adAsset})
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0.0001"
                      value={adFixedPrice}
                      onChange={(e) => setAdFixedPrice(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] font-mono"
                      required
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Floating Margin (-25% to +25%)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="-25"
                      max="25"
                      value={adMarginPct}
                      onChange={(e) => setAdMarginPct(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] font-mono"
                      required
                    />
                  </div>
                )}

                <div>
                  <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Available {adAsset} Liquidity
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0.0001"
                    value={adQuantity}
                    onChange={(e) => setAdQuantity(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] font-mono"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Min Order ({getCountryByCode(adCountryCode).currency})
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="1"
                    value={adMinFiat}
                    onChange={(e) => setAdMinFiat(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Max Order ({getCountryByCode(adCountryCode).currency})
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="1"
                    value={adMaxFiat}
                    onChange={(e) => setAdMaxFiat(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Payment Window (Mins)
                  </label>
                  <input
                    type="number"
                    min="10"
                    max="60"
                    value={adWindowMins}
                    onChange={(e) => setAdWindowMins(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Escrow Settlement Mode
                </label>
                <select
                  value={adEscrowMode}
                  onChange={(e) => setAdEscrowMode(e.target.value as P2PEscrowMode)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
                >
                  {['CSC', 'USDT', 'USD1', 'SOL'].includes(adAsset) && (
                    <option value="vault_balance">
                      Platform Vault Atomic Escrow (Instant Lock & Release)
                    </option>
                  )}
                  <option value="onchain_proof">
                    Self-Custody On-Chain TX Proof Escrow (External Wallet)
                  </option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                  Supported Payment Rails (Select up to 6)
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]">
                  {adCountryMethods.map((m) => {
                    const checked = adMethods.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleToggleAdMethod(m.id)}
                        className={`text-left px-2.5 py-1.5 rounded border transition-colors ${
                          checked
                            ? 'border-blue-500 bg-blue-600/10 text-blue-600 dark:text-blue-400 font-semibold'
                            : 'border-transparent hover:bg-slate-200/60 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {m.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Trade Terms & Verification Notes
                </label>
                <textarea
                  rows={2}
                  value={adTerms}
                  onChange={(e) => setAdTerms(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPostAdModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAd}
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold inline-flex items-center gap-2"
                >
                  {submittingAd && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Publish P2P Offer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: MANAGE SAVED PAYMENT RAILS */}
      {showPaymentsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">Global P2P Payment Methods</h3>
              <button
                type="button"
                onClick={() => setShowPaymentsModal(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSavePaymentProfile(e)} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Country / Currency
                  </label>
                  <select
                    value={payCountryCode}
                    onChange={(e) => {
                      const code = e.target.value;
                      setPayCountryCode(code);
                      const first = getPaymentMethodsForCountry(code)[0];
                      if (first) setPayMethodId(first.id);
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
                  >
                    {P2P_COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name} ({c.currency})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Payment Rail
                  </label>
                  <select
                    value={payMethodId}
                    onChange={(e) => setPayMethodId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
                  >
                    {payCountryMethods.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <input
                type="text"
                value={payHolder}
                onChange={(e) => setPayHolder(e.target.value)}
                placeholder="Registered Account Holder Full Name"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
                required
              />

              <input
                type="text"
                value={payDetails}
                onChange={(e) => setPayDetails(e.target.value)}
                placeholder={
                  payCountryMethods.find((m) => m.id === payMethodId)?.fieldsHint ||
                  'Phone, IBAN, UPI ID, or Account Number'
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
                required
              />

              <input
                type="text"
                value={payInstructions}
                onChange={(e) => setPayInstructions(e.target.value)}
                placeholder="Optional note for buyers (e.g. No crypto words in memo)"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
              />

              <button
                type="submit"
                disabled={savingPayment}
                className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold"
              >
                {savingPayment ? 'Saving…' : 'Save Receiving Method'}
              </button>
            </form>

            <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
              <div className="font-semibold">Saved Accounts ({myPaymentProfiles.length})</div>
              {myPaymentProfiles.length === 0 ? (
                <div className="text-slate-500">No saved receiving methods yet.</div>
              ) : (
                myPaymentProfiles.map((p) => (
                  <div
                    key={p.id}
                    className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="font-semibold">
                        {p.methodName} ({p.currency})
                      </div>
                      <div className="text-slate-500 font-mono text-[11px]">
                        {p.accountHolder} · {p.accountDetails}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDeletePaymentProfile(p.id)}
                      className="p-1.5 rounded hover:bg-red-500/10 text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: OPEN TRADE AGAINST AD */}
      {tradeModalAd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">
                {tradeModalAd.side === 'sell' ? 'Buy' : 'Sell'} {tradeModalAd.asset} with @
                {tradeModalAd.makerUsername}
              </h3>
              <button
                type="button"
                onClick={() => setTradeModalAd(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Rate</span>
                <span className="font-mono font-semibold">
                  {formatFiatAmount(tradeModalAd.effectivePriceFiat, tradeModalAd.fiatCurrency)} /{' '}
                  {tradeModalAd.asset}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Limits</span>
                <span className="font-mono">
                  {formatFiatAmount(tradeModalAd.minFiatOrder, tradeModalAd.fiatCurrency)} –{' '}
                  {formatFiatAmount(tradeModalAd.maxFiatOrder, tradeModalAd.fiatCurrency)}
                </span>
              </div>
            </div>

            <form onSubmit={(e) => void handleCreateOrder(e)} className="space-y-3">
              <div>
                <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Fiat Amount ({tradeModalAd.fiatCurrency})
                </label>
                <input
                  type="number"
                  step="any"
                  min={tradeModalAd.minFiatOrder}
                  max={tradeModalAd.maxFiatOrder}
                  value={tradeFiatInput}
                  onChange={(e) => setTradeFiatInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] font-mono text-sm"
                  required
                />
                <div className="mt-1 text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                  Estimated Crypto:{' '}
                  {(
                    Number(tradeFiatInput || 0) / Math.max(0.00001, tradeModalAd.effectivePriceFiat)
                  ).toFixed(4)}{' '}
                  {tradeModalAd.asset}
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Payment Method
                </label>
                <select
                  value={tradeMethodId}
                  onChange={(e) => setTradeMethodId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
                >
                  {tradeModalAd.paymentMethodIds.map((id, i) => (
                    <option key={id} value={id}>
                      {tradeModalAd.paymentMethodNames[i] || id}
                    </option>
                  ))}
                </select>
              </div>

              {tradeModalAd.side === 'buy' && (
                <div className="space-y-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
                  <div className="font-semibold text-amber-600 dark:text-amber-400">
                    Your Receiving Fiat Details (You Are Selling {tradeModalAd.asset})
                  </div>
                  <input
                    type="text"
                    value={takerSellerHolder}
                    onChange={(e) => setTakerSellerHolder(e.target.value)}
                    placeholder="Account Holder Name"
                    className="w-full px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                    required
                  />
                  <input
                    type="text"
                    value={takerSellerDetails}
                    onChange={(e) => setTakerSellerDetails(e.target.value)}
                    placeholder="Phone / IBAN / Account Number"
                    className="w-full px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                    required
                  />
                </div>
              )}

              {tradeModalAd.terms && (
                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B0F17] text-[11px] text-slate-500">
                  Maker Terms: {tradeModalAd.terms}
                </div>
              )}

              <button
                type="submit"
                disabled={openingTrade}
                className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold inline-flex items-center justify-center gap-2"
              >
                {openingTrade ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Lock className="w-4 h-4" />
                )}
                Open Escrow Trade & Chat Room
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
