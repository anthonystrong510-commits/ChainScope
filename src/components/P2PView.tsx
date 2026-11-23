import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Check,
  Clock,
  Compass,
  Copy,
  CreditCard,
  EyeOff,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  detectCountryFromBrowser,
  formatFiatAmount,
  getAllPaymentMethodsCount,
  getCountryByCode,
  getPaymentMethodsForCountry,
  P2P_COUNTRIES,
} from '../data/p2pPayments';
import {
  createP2PAd,
  createP2POrder,
  createPrivateP2PRequest,
  deleteP2PPaymentProfile,
  fetchP2POverview,
  lookupPrivateP2PAds,
  respondPrivateP2PRequest,
  saveP2PPaymentProfile,
  updateP2PAdStatus,
} from '../services/p2p';
import type {
  P2PAd,
  P2PAdSide,
  P2PAdVisibility,
  P2PAsset,
  P2PCountryConfig,
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
  const { user, walletAccount, setShowOnboardingModal, setShowProfileModal } = useAuth();
  const [overview, setOverview] = useState<P2POverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Navigation & Active Trade Room
  const [subTab, setSubTab] = useState<'market' | 'private' | 'orders' | 'my_ads'>('market');
  const [activeOrder, setActiveOrder] = useState<P2POrder | null>(null);

  // Country & Currency Scanner State
  const [showCountryScanner, setShowCountryScanner] = useState(false);
  const [scannedInfo, setScannedInfo] = useState<{
    country: P2PCountryConfig;
    source: string;
    detectedTimeZone: string;
    detectedLocale: string;
  } | null>(null);
  const [scannerCountryCode, setScannerCountryCode] = useState<string>('KE');

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
  const [privateReqModalAd, setPrivateReqModalAd] = useState<P2PAd | null>(null);

  // Post Ad Form
  const [adSide, setAdSide] = useState<P2PAdSide>('sell');
  const [adVisibility, setAdVisibility] = useState<P2PAdVisibility>('public');
  const [adAllowedUsernames, setAdAllowedUsernames] = useState<string>('');
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
  const [adDepositTxHash, setAdDepositTxHash] = useState<string>('');
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

  // Open Public Trade Form
  const [tradeFiatInput, setTradeFiatInput] = useState<string>('');
  const [tradeMethodId, setTradeMethodId] = useState<string>('');
  const [takerSellerHolder, setTakerSellerHolder] = useState<string>('');
  const [takerSellerDetails, setTakerSellerDetails] = useState<string>('');
  const [sellEscrowMode, setSellEscrowMode] = useState<P2PEscrowMode>('vault_balance');
  const [sellEscrowTxHash, setSellEscrowTxHash] = useState<string>('');
  const [openingTrade, setOpeningTrade] = useState(false);

  // Private Ads Lookup & Request Form
  const [privateLookupQuery, setPrivateLookupQuery] = useState<string>('');
  const [privateLookupResults, setPrivateLookupResults] = useState<P2PAd[]>([]);
  const [searchingPrivate, setSearchingPrivate] = useState(false);
  const [privateReqFiat, setPrivateReqFiat] = useState<string>('');
  const [privateReqMethodId, setPrivateReqMethodId] = useState<string>('');
  const [privateReqNote, setPrivateReqNote] = useState<string>('');
  const [submittingPrivateReq, setSubmittingPrivateReq] = useState(false);
  const [respondingReqId, setRespondingReqId] = useState<string | null>(null);

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

  useEffect(() => {
    const scan = detectCountryFromBrowser();
    setScannedInfo(scan);
    setScannerCountryCode(scan.country.code);
  }, []);

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

  const isWalletBound = useMemo(() => {
    if (overview?.myTradeEligibility) return overview.myTradeEligibility.verifiedWallet;
    return Boolean(
      walletAccount?.evmAddress || walletAccount?.solanaAddress || walletAccount?.cscAddress
    );
  }, [overview, walletAccount]);

  const copyValue = (text: string, key: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 1500);
  };

  const getEscrowWalletForAsset = useCallback(
    (asset: P2PAsset): { address: string; label: string; isCold: boolean } => {
      const chain = asset === 'SOL' ? 'solana' : asset === 'CSC' ? 'csc' : 'evm';
      const custom = overview?.escrowReceivingWallets?.find(
        (w) => w.active && w.chain === chain
      );
      if (custom) {
        return {
          address: custom.publicAddress,
          label: custom.label,
          isCold: custom.walletType === 'cold_public',
        };
      }
      return {
        address:
          overview?.escrowVaults?.[chain] || '0x71C0B4D91E2A8F44E89B10A95C78E042A1B90C5E',
        label: `ChainScope ${chain.toUpperCase()} Escrow Vault`,
        isCold: chain !== 'csc',
      };
    },
    [overview]
  );

  const handleWalletBindRedirect = useCallback(
    (reason?: string): boolean => {
      if (!user) {
        if (reason) setBanner({ type: 'err', text: reason });
        setShowOnboardingModal(true);
        return false;
      }
      if (!isWalletBound) {
        setBanner({
          type: 'err',
          text:
            reason ||
            'Your @username needs a bound 1:1 wallet address first. Opened Wallet Profile so you can generate or bind it in 1 click.',
        });
        setShowProfileModal(true);
        return false;
      }
      return true;
    },
    [user, isWalletBound, setShowOnboardingModal, setShowProfileModal]
  );

  const handleRunBrowserCountryScan = () => {
    const scan = detectCountryFromBrowser();
    setScannedInfo(scan);
    setScannerCountryCode(scan.country.code);
    setShowCountryScanner(true);
  };

  const scannedCountry = useMemo(
    () => getCountryByCode(scannerCountryCode),
    [scannerCountryCode]
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
    const requiredMakerSide: P2PAdSide = intentTab === 'buy' ? 'sell' : 'buy';
    const fiatAmt = Number(fiatAmountFilter || 0);
    const q = searchMaker.trim().toLowerCase();

    return ads.filter((ad) => {
      if (ad.status !== 'active') return false;
      if (ad.visibility === 'private') return false;
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
    if (!handleWalletBindRedirect()) return;

    setSubmittingAd(true);
    setBanner(null);
    try {
      const created = await createP2PAd({
        side: adSide,
        visibility: adVisibility,
        allowedUsernames:
          adVisibility === 'private' && adAllowedUsernames.trim()
            ? adAllowedUsernames
                .split(',')
                .map((u) => u.trim().replace(/^@/, ''))
                .filter(Boolean)
            : [],
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
        escrowDepositTxHash:
          adSide === 'sell' && adEscrowMode === 'onchain_proof'
            ? adDepositTxHash.trim()
            : undefined,
        terms: adTerms.trim(),
      });
      setShowPostAdModal(false);
      setAdDepositTxHash('');
      setAdAllowedUsernames('');
      if (created.visibility === 'private') {
        setSubTab('my_ads');
        setBanner({
          type: 'ok',
          text: `Published PRIVATE offer (${created.privateCode}). Share that Private Code or your @username so buyers/sellers can request trades.`,
        });
      } else {
        setBanner({
          type: 'ok',
          text:
            adSide === 'sell'
              ? `Deposited ${created.availableCryptoAmount} ${created.asset} upfront into Escrow and published Sell offer.`
              : `Posted verified BUY ${adAsset} P2P offer.`,
        });
      }
      await loadOverview();
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'WALLET_BIND_REQUIRED') {
        setShowPostAdModal(false);
        setShowProfileModal(true);
      }
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
    if (!handleWalletBindRedirect()) return;
    if (ad.side === 'sell' && overview?.myTradeEligibility && !overview.myTradeEligibility.canBuy) {
      setBanner({
        type: 'err',
        text: `Buy Gate Active: You need ${overview.myTradeEligibility.minCompletedTradesToBuy} completed trade(s) to buy crypto (currently ${overview.myTradeEligibility.completedTrades}). Complete a Sell trade or ask KingAdmin to whitelist @${walletAccount?.username || 'you'}.`,
      });
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
    const vaultCapable = ['CSC', 'USDT', 'USD1', 'SOL'].includes(ad.asset);
    setSellEscrowMode(vaultCapable ? 'vault_balance' : 'onchain_proof');
    setSellEscrowTxHash('');
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
        sellEscrowMode: tradeModalAd.side === 'buy' ? sellEscrowMode : undefined,
        sellEscrowTxHash:
          tradeModalAd.side === 'buy' && sellEscrowMode === 'onchain_proof'
            ? sellEscrowTxHash.trim()
            : undefined,
      });
      setTradeModalAd(null);
      setActiveOrder(order);
      await loadOverview();
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'WALLET_BIND_REQUIRED') {
        setTradeModalAd(null);
        setShowProfileModal(true);
      }
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Order failed' });
    } finally {
      setOpeningTrade(false);
    }
  };

  const handleSearchPrivateAds = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setShowOnboardingModal(true);
      return;
    }
    setSearchingPrivate(true);
    setBanner(null);
    try {
      const ads = await lookupPrivateP2PAds(privateLookupQuery.trim());
      setPrivateLookupResults(ads);
      if (ads.length === 0) {
        setBanner({
          type: 'err',
          text: `No active private offers found for "${privateLookupQuery.trim()}" (or your @username is not on its invite list).`,
        });
      }
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Private ad lookup failed',
      });
    } finally {
      setSearchingPrivate(false);
    }
  };

  const handleOpenPrivateRequestModal = (ad: P2PAd) => {
    if (!handleWalletBindRedirect()) return;
    setPrivateReqModalAd(ad);
    setPrivateReqFiat(String(ad.minFiatOrder));
    setPrivateReqMethodId(ad.paymentMethodIds[0] || '');
    setPrivateReqNote('');
  };

  const handleSubmitPrivateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!privateReqModalAd) return;
    setSubmittingPrivateReq(true);
    setBanner(null);
    try {
      await createPrivateP2PRequest({
        adId: privateReqModalAd.id,
        fiatAmount: Number(privateReqFiat),
        paymentMethodId: privateReqMethodId,
        note: privateReqNote.trim(),
      });
      setPrivateReqModalAd(null);
      setBanner({
        type: 'ok',
        text: `Private trade request sent to @${privateReqModalAd.makerUsername}. Once approved, your Escrow Trade Room opens automatically.`,
      });
      await loadOverview();
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'WALLET_BIND_REQUIRED') {
        setPrivateReqModalAd(null);
        setShowProfileModal(true);
      }
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Private trade request failed',
      });
    } finally {
      setSubmittingPrivateReq(false);
    }
  };

  const handleRespondPrivateRequest = async (id: string, decision: 'approve' | 'decline') => {
    setRespondingReqId(id);
    setBanner(null);
    try {
      const res = await respondPrivateP2PRequest(id, decision);
      await loadOverview();
      if (decision === 'approve' && res.order) {
        setActiveOrder(res.order);
      } else {
        setBanner({ type: 'ok', text: 'Private request declined.' });
      }
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to respond to request',
      });
    } finally {
      setRespondingReqId(null);
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
    overview?.myTradeEligibility?.boundWalletAddress ||
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
  const myAds = useMemo(() => {
    const map = new Map<string, P2PAd>();
    for (const a of overview?.ads || []) {
      if (a.makerUid === user?.uid) map.set(a.id, a);
    }
    for (const a of overview?.myPrivateAds || []) {
      map.set(a.id, a);
    }
    return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [overview, user?.uid]);

  const myPaymentProfiles = overview?.myPaymentProfiles || [];
  const incomingPrivateReqs = (overview?.myPrivateRequests || []).filter(
    (r) => r.makerUid === user?.uid
  );
  const sentPrivateReqs = (overview?.myPrivateRequests || []).filter(
    (r) => r.requesterUid === user?.uid
  );
  const pendingPrivateIncomingCount = incomingPrivateReqs.filter(
    (r) => r.status === 'pending'
  ).length;

  const buyEligibility = overview?.myTradeEligibility;
  const buyGateMin = overview?.buyGate.minCompletedTradesToBuy ?? 0;

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
            <span>Upfront Seller Escrow</span>
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
            Self-custody P2P trading with upfront seller escrow deposits, local currency scanners,
            invite-only private offers, and live WebSocket moderation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowCountryScanner((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors ${
              showCountryScanner
                ? 'border-blue-500 bg-blue-600/10 text-blue-600 dark:text-blue-400'
                : 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            Country &amp; Currency Scanner
          </button>

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
              if (!handleWalletBindRedirect()) return;
              setShowPostAdModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            Post P2P Offer
          </button>
        </div>
      </div>

      {/* Straightforward 1:1 Wallet Bind Redirect Banner */}
      {user && overview && !isWalletBound && (
        <div className="p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-start gap-2.5 max-w-2xl">
            <Wallet className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-slate-900 dark:text-slate-100">
                1:1 Bound Wallet Required Before Trading or Posting Offers
              </div>
              <p className="text-slate-600 dark:text-slate-300 mt-0.5">
                Every @username must hold one permanent EVM, Solana, or CSC-1 address to keep P2P
                escrow tamper-proof. Generate or bind yours in 1 click inside Wallet Settings.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowProfileModal(true)}
            className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold whitespace-nowrap shrink-0"
          >
            Bind 1:1 Wallet Now →
          </button>
        </div>
      )}

      {/* Country & Currency Scanner Panel */}
      {showCountryScanner && (
        <div className="p-5 rounded-xl border border-blue-500/30 bg-white dark:bg-[#111827] space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-bold text-sm flex items-center gap-2">
                <Compass className="w-4 h-4 text-blue-500" />
                Live Country Scanner &amp; Local Currency Matrix
              </div>
              {scannedInfo && (
                <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                  {scannedInfo.source}: {scannedInfo.country.name} ({scannedInfo.country.currency}) ·{' '}
                  {scannedInfo.detectedTimeZone || scannedInfo.detectedLocale || 'Browser Locale'}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleRunBrowserCountryScan}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium inline-flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Re-Scan Browser Country
              </button>
              <select
                value={scannerCountryCode}
                onChange={(e) => setScannerCountryCode(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
              >
                {P2P_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} ({c.currency})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  setCountryFilter(scannedCountry.code);
                  setPaymentMethodFilter('ALL');
                  setSubTab('market');
                }}
                className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold"
              >
                Filter Orderbook ({overview?.countryLiquidity[scannedCountry.code]?.adsCount ?? 0} Ads)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {P2P_ASSETS.map((asset) => {
              const usdPrice = spotPrices[asset] || 1;
              const localPrice = usdPrice * scannedCountry.ratePerUsd;
              return (
                <div
                  key={asset}
                  className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
                >
                  <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                    <span className="font-bold text-slate-900 dark:text-slate-100">{asset}</span>
                    <span>${usdPrice >= 10 ? usdPrice.toFixed(2) : usdPrice.toFixed(4)}</span>
                  </div>
                  <div className="mt-1 text-sm font-mono font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {formatFiatAmount(localPrice, scannedCountry.currency)}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 pt-1 border-t border-slate-200 dark:border-slate-800">
            <div>
              Active Local Rails in {scannedCountry.name}:{' '}
              <span className="text-slate-700 dark:text-slate-300 font-medium">
                {getPaymentMethodsForCountry(scannedCountry.code)
                  .slice(0, 5)
                  .map((m) => m.name)
                  .join(' · ')}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!handleWalletBindRedirect()) return;
                handleSelectAdCountry(scannedCountry.code);
                setShowPostAdModal(true);
              }}
              className="text-blue-600 dark:text-blue-400 font-semibold hover:underline"
            >
              Post {scannedCountry.currency} Offer →
            </button>
          </div>
        </div>
      )}

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
          <div className="text-xs text-slate-500">Buy Access Eligibility</div>
          <div className="mt-1 text-xs font-mono font-semibold tabular-nums">
            {!user ? (
              'Sign in to Check'
            ) : buyGateMin <= 0 ? (
              <span className="text-emerald-600 dark:text-emerald-400">Open (0 min trades)</span>
            ) : buyEligibility?.canBuy ? (
              <span className="text-emerald-600 dark:text-emerald-400">
                Unlocked ({buyEligibility.completedTrades}/{buyGateMin} trades)
              </span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400">
                Need {buyGateMin} Trades ({buyEligibility?.completedTrades ?? 0}/{buyGateMin})
              </span>
            )}
          </div>
        </div>
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="text-xs text-slate-500">Your Bound 1:1 Identity</div>
          <div className="mt-1 text-xs font-mono font-semibold truncate">
            {walletAccount?.username
              ? `@${walletAccount.username} · ${truncateAddress(boundWalletSummary, 5, 4)}`
              : user
              ? `@${user.displayName || 'trader'} (Unbound)`
              : 'Sign in to Trade'}
          </div>
        </div>
      </div>

      {banner && (
        <div
          className={`px-4 py-3 rounded-lg border text-xs font-medium flex items-center justify-between gap-3 ${
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
        <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-xs">
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
            onClick={() => setSubTab('private')}
            className={`px-3.5 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap inline-flex items-center gap-1.5 ${
              subTab === 'private'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <EyeOff className="w-3.5 h-3.5" />
            Private Offers &amp; Requests
            {pendingPrivateIncomingCount > 0 && (
              <span className="font-mono text-blue-600 dark:text-blue-400 font-bold">
                ({pendingPrivateIncomingCount})
              </span>
            )}
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
          {user &&
            intentTab === 'buy' &&
            buyGateMin > 0 &&
            buyEligibility &&
            !buyEligibility.canBuy && (
              <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/5 text-xs flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-semibold text-amber-700 dark:text-amber-300">
                    Buy Minimum Trades Gate Active:
                  </span>{' '}
                  KingAdmin requires <strong>{buyGateMin} completed trade(s)</strong> before
                  opening Buy orders (your progress: {buyEligibility.completedTrades}/{buyGateMin}).
                  Switch to <strong>Sell Crypto</strong> first to build trade history.
                </div>
                <button
                  type="button"
                  onClick={() => setIntentTab('sell')}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 text-white font-semibold"
                >
                  Switch to Sell Crypto →
                </button>
              </div>
            )}

          {/* Filter Controls Bar */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
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
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-medium text-slate-500">
                    Country &amp; Currency
                  </label>
                  {scannedInfo && countryFilter !== scannedInfo.country.code && (
                    <button
                      type="button"
                      onClick={() => {
                        setCountryFilter(scannedInfo.country.code);
                        setPaymentMethodFilter('ALL');
                      }}
                      className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold hover:underline"
                    >
                      Use {scannedInfo.country.code} ({scannedInfo.country.currency})
                    </button>
                  )}
                </div>
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
                    <option value="ALL">All Countries &amp; Currencies</option>
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
                  Switch country/payment filters or post the first verified P2P offer in this market
                  directly from your 1:1 bound wallet.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (!handleWalletBindRedirect()) return;
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
                      <th className="py-3 px-4 font-medium">Available &amp; Limits</th>
                      <th className="py-3 px-4 font-medium">Payment Methods</th>
                      <th className="py-3 px-4 font-medium text-right">Trade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {filteredAds.map((ad) => {
                      const isOwn = user?.uid === ad.makerUid;
                      const buyBlocked =
                        intentTab === 'buy' &&
                        Boolean(user && buyEligibility && !buyEligibility.canBuy);
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
                              {ad.makerStats.completedOrders} orders ·{' '}
                              {ad.makerStats.completionRatePct}% · ~{ad.makerStats.avgReleaseMins}m
                            </div>
                          </td>

                          <td className="py-3.5 px-4 align-top">
                            <div className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                              {formatFiatAmount(ad.effectivePriceFiat, ad.fiatCurrency)}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              per {ad.asset} ·{' '}
                              {ad.priceType === 'floating'
                                ? `Float ${ad.floatingMarginPct >= 0 ? '+' : ''}${
                                    ad.floatingMarginPct
                                  }%`
                                : 'Fixed'}
                            </div>
                          </td>

                          <td className="py-3.5 px-4 align-top font-mono tabular-nums">
                            <div className="text-slate-900 dark:text-slate-100 font-medium flex items-center gap-1.5">
                              <span>
                                {ad.availableCryptoAmount.toFixed(4)} {ad.asset}
                              </span>
                              {ad.preFundedEscrow && (
                                <span
                                  title="Pre-Funded Escrow Deposited Upfront"
                                  className="text-[10px] font-sans text-emerald-600 dark:text-emerald-400"
                                >
                                  (Escrow Funded)
                                </span>
                              )}
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
                                buyBlocked
                                  ? 'bg-slate-600 hover:bg-slate-700'
                                  : intentTab === 'buy'
                                  ? 'bg-emerald-600 hover:bg-emerald-700'
                                  : 'bg-amber-600 hover:bg-amber-700'
                              }`}
                            >
                              {isOwn
                                ? 'Your Ad'
                                : buyBlocked
                                ? `Need ${buyGateMin} Trades`
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

      {/* PRIVATE OFFERS & USERNAME REQUESTS */}
      {subTab === 'private' && (
        <div className="space-y-5">
          {/* Private Offer Lookup */}
          <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
            <div>
              <h3 className="text-sm font-bold flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-blue-500" />
                Request a Private P2P Offer (Invite-Only)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Private offers stay completely hidden from the public orderbook. Enter the Seller or
                Buyer&apos;s Private Code (e.g. PRIV-A1B2C3) or @username to inspect and request a
                trade.
              </p>
            </div>

            <form onSubmit={(e) => void handleSearchPrivateAds(e)} className="flex flex-wrap gap-2">
              <input
                type="text"
                required
                value={privateLookupQuery}
                onChange={(e) => setPrivateLookupQuery(e.target.value)}
                placeholder="Enter Private Code (PRIV-...) or @username"
                className="flex-1 min-w-[220px] px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs font-mono"
              />
              <button
                type="submit"
                disabled={searchingPrivate}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5"
              >
                {searchingPrivate ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Search className="w-3.5 h-3.5" />
                )}
                Find Private Offer
              </button>
            </form>

            {privateLookupResults.length > 0 && (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800">
                {privateLookupResults.map((ad) => (
                  <div
                    key={ad.id}
                    className="p-4 flex flex-wrap items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="font-semibold flex items-center gap-2">
                        <span>
                          @{ad.makerUsername} · {ad.side === 'sell' ? 'Selling' : 'Buying'}{' '}
                          {ad.availableCryptoAmount} {ad.asset}
                        </span>
                        {ad.privateCode && (
                          <span className="font-mono text-blue-600 dark:text-blue-400">
                            {ad.privateCode}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        Price: {formatFiatAmount(ad.effectivePriceFiat, ad.fiatCurrency)} · Limits:{' '}
                        {formatFiatAmount(ad.minFiatOrder, ad.fiatCurrency)} –{' '}
                        {formatFiatAmount(ad.maxFiatOrder, ad.fiatCurrency)} ·{' '}
                        {ad.paymentMethodNames.join(', ')}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={user?.uid === ad.makerUid}
                      onClick={() => handleOpenPrivateRequestModal(ad)}
                      className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-semibold"
                    >
                      {user?.uid === ad.makerUid ? 'Your Private Ad' : 'Request Trade →'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            {/* Incoming Requests (For Maker's Private Ads) */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 text-blue-500" />
                  Incoming Private Requests ({incomingPrivateReqs.length})
                </span>
              </div>
              {incomingPrivateReqs.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No incoming requests yet. Post a Private Offer in &ldquo;Post P2P Offer&rdquo; and
                  share its Private Code.
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {incomingPrivateReqs.map((r) => (
                    <div key={r.id} className="p-4 space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">
                          @{r.requesterUsername} ({r.requesterCompletedTrades} trades)
                        </span>
                        <span className="font-mono text-[11px] uppercase text-blue-500">
                          {r.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {r.requestedCryptoAmount} {r.asset} ⇄{' '}
                        {formatFiatAmount(r.requestedFiatAmount, r.fiatCurrency)} ·{' '}
                        {r.paymentMethodName} · Code {r.adPrivateCode}
                      </div>
                      {r.note && (
                        <div className="text-[11px] text-slate-600 dark:text-slate-300">
                          Note: {r.note}
                        </div>
                      )}
                      {r.status === 'pending' && (
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            disabled={respondingReqId === r.id}
                            onClick={() => void handleRespondPrivateRequest(r.id, 'approve')}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                          >
                            {respondingReqId === r.id
                              ? 'Opening Escrow…'
                              : 'Approve & Open Trade Room'}
                          </button>
                          <button
                            type="button"
                            disabled={respondingReqId === r.id}
                            onClick={() => void handleRespondPrivateRequest(r.id, 'decline')}
                            className="px-3 py-1.5 rounded-lg border border-red-500/30 text-red-500 hover:bg-red-500/10 font-medium"
                          >
                            Decline
                          </button>
                        </div>
                      )}
                      {r.status === 'converted' && r.orderId && (
                        <button
                          type="button"
                          onClick={() => {
                            const ord = myOrders.find((o) => o.id === r.orderId);
                            if (ord) setActiveOrder(ord);
                            else setSubTab('orders');
                          }}
                          className="text-blue-600 dark:text-blue-400 font-semibold hover:underline"
                        >
                          Open Trade Room →
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Outgoing Private Requests */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
                My Sent Private Requests ({sentPrivateReqs.length})
              </div>
              {sentPrivateReqs.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  You haven&apos;t sent any private offer requests yet.
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {sentPrivateReqs.map((r) => (
                    <div key={r.id} className="p-4 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">
                          To @{r.makerUsername} ({r.adPrivateCode})
                        </span>
                        <span
                          className={`font-mono text-[11px] uppercase ${
                            r.status === 'converted'
                              ? 'text-emerald-500'
                              : r.status === 'declined'
                              ? 'text-red-500'
                              : 'text-amber-500'
                          }`}
                        >
                          {r.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {r.requestedCryptoAmount} {r.asset} ⇄{' '}
                        {formatFiatAmount(r.requestedFiatAmount, r.fiatCurrency)} ·{' '}
                        {r.paymentMethodName}
                      </div>
                      {r.status === 'converted' && r.orderId && (
                        <button
                          type="button"
                          onClick={() => {
                            const ord = myOrders.find((o) => o.id === r.orderId);
                            if (ord) setActiveOrder(ord);
                            else setSubTab('orders');
                          }}
                          className="text-blue-600 dark:text-blue-400 font-semibold hover:underline"
                        >
                          Enter Approved Escrow Trade Room →
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
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
                        #{ord.id.slice(-8)} · {ord.paymentMethodName} · Seller @{ord.sellerUsername}{' '}
                        · Buyer @{ord.buyerUsername} · {formatTimestamp(ord.updatedAt)}
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

      {/* MY POSTED ADS (PUBLIC + PRIVATE WITH SHARE CODE) */}
      {subTab === 'my_ads' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
          {myAds.length === 0 ? (
            <div className="p-12 text-center space-y-3 text-xs text-slate-500">
              <div>You haven&apos;t posted any P2P offers yet.</div>
              <button
                type="button"
                onClick={() => {
                  if (!handleWalletBindRedirect()) return;
                  setShowPostAdModal(true);
                }}
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
                    <div className="font-semibold text-slate-900 dark:text-slate-100 flex flex-wrap items-center gap-2">
                      <span>
                        {ad.side.toUpperCase()} {ad.asset} ·{' '}
                        <span className="font-mono">
                          {formatFiatAmount(ad.effectivePriceFiat, ad.fiatCurrency)}
                        </span>{' '}
                        ({getCountryByCode(ad.countryCode).name})
                      </span>
                      {ad.visibility === 'private' && ad.privateCode && (
                        <button
                          type="button"
                          onClick={() => copyValue(ad.privateCode || '', ad.id)}
                          className="inline-flex items-center gap-1 font-mono text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          Private Code: {ad.privateCode}
                          {copiedKey === ad.id ? (
                            <Check className="w-3 h-3 text-emerald-500" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Available: {ad.availableCryptoAmount} {ad.asset}
                      {ad.preFundedEscrow
                        ? ` (Pre-Funded Escrow Reserve: ${ad.escrowLockedBalance} ${ad.asset})`
                        : ''}{' '}
                      · Visibility: {ad.visibility} · Rails: {ad.paymentMethodNames.join(', ')} ·
                      Status: {ad.status}
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
                      Close &amp; Refund
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
                  Bound to @{walletAccount?.username || 'trader'} (
                  {truncateAddress(boundWalletSummary, 6, 4)})
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                    I Want To
                  </label>
                  <select
                    value={adSide}
                    onChange={(e) => setAdSide(e.target.value as P2PAdSide)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
                  >
                    <option value="sell">Sell Crypto (Deposit Escrow Upfront, Receive Fiat)</option>
                    <option value="buy">Buy Crypto (Send Fiat, Receive Crypto)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Offer Visibility
                  </label>
                  <select
                    value={adVisibility}
                    onChange={(e) => setAdVisibility(e.target.value as P2PAdVisibility)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
                  >
                    <option value="public">Public Orderbook (Visible to Everyone)</option>
                    <option value="private">Private Invite-Only (Request by Code / @Username)</option>
                  </select>
                </div>
              </div>

              {adSide === 'buy' &&
                buyGateMin > 0 &&
                buyEligibility &&
                !buyEligibility.canBuy && (
                  <div className="p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                    Buy Gate: Admin requires {buyGateMin} completed trade(s) to post Buy offers (you
                    currently have {buyEligibility.completedTrades}). Complete a Sell offer first.
                  </div>
                )}

              {adVisibility === 'private' && (
                <div>
                  <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Optional Allowed @Usernames (comma-separated, leave blank for anyone with Private Code)
                  </label>
                  <input
                    type="text"
                    value={adAllowedUsernames}
                    onChange={(e) => setAdAllowedUsernames(e.target.value)}
                    placeholder="@alice, @bob (optional)"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] font-mono"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                    Country &amp; Local Fiat
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
                      Platform Vault Atomic Escrow (Instant Lock &amp; Release)
                    </option>
                  )}
                  <option value="onchain_proof">
                    Self-Custody On-Chain TX Proof Escrow (Send to Escrow Receiving Wallet)
                  </option>
                </select>
              </div>

              {adSide === 'sell' && (
                <div className="p-3.5 rounded-lg border border-amber-500/30 bg-amber-500/5 space-y-2.5">
                  <div className="font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5" />
                    Upfront Sell Escrow Deposit Required ({adQuantity || '0'} {adAsset})
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300">
                    {adEscrowMode === 'vault_balance'
                      ? `Publishing this Sell offer immediately debits ${adQuantity || '0'} ${adAsset} from your Platform Vault into Escrow. Closing the offer refunds all unfilled coins automatically.`
                      : `Transfer ${adQuantity || '0'} ${adAsset} to the Admin Escrow Receiving Wallet below and paste the TX hash before publishing.`}
                  </p>
                  {adEscrowMode === 'onchain_proof' && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() =>
                          copyValue(getEscrowWalletForAsset(adAsset).address, 'ad_escrow_wallet')
                        }
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] font-mono text-[11px]"
                      >
                        <span className="truncate">
                          {getEscrowWalletForAsset(adAsset).label}:{' '}
                          {getEscrowWalletForAsset(adAsset).address}
                        </span>
                        {copiedKey === 'ad_escrow_wallet' ? (
                          <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 shrink-0" />
                        )}
                      </button>
                      <input
                        type="text"
                        required
                        value={adDepositTxHash}
                        onChange={(e) => setAdDepositTxHash(e.target.value)}
                        placeholder="Paste on-chain deposit TX hash (0x... or Solana signature)"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] font-mono"
                      />
                    </div>
                  )}
                </div>
              )}

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
                  Trade Terms &amp; Verification Notes
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
                  {adSide === 'sell' ? 'Deposit Escrow & Publish Offer' : 'Publish P2P Offer'}
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

      {/* MODAL: OPEN TRADE AGAINST PUBLIC AD */}
      {tradeModalAd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-4 text-xs">
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
                    Number(tradeFiatInput || 0) /
                    Math.max(0.00001, tradeModalAd.effectivePriceFiat)
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
                <>
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

                  <div className="space-y-2 p-3 rounded-lg border border-blue-500/30 bg-blue-500/5">
                    <div className="font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5" />
                      Upfront Sell Escrow Deposit Required
                    </div>
                    <select
                      value={sellEscrowMode}
                      onChange={(e) => setSellEscrowMode(e.target.value as P2PEscrowMode)}
                      className="w-full px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                    >
                      {['CSC', 'USDT', 'USD1', 'SOL'].includes(tradeModalAd.asset) && (
                        <option value="vault_balance">
                          Debit Platform Vault Immediately
                        </option>
                      )}
                      <option value="onchain_proof">
                        On-Chain Deposit to Escrow Receiving Wallet
                      </option>
                    </select>
                    {sellEscrowMode === 'onchain_proof' && (
                      <div className="space-y-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            copyValue(
                              getEscrowWalletForAsset(tradeModalAd.asset).address,
                              'order_escrow_wallet'
                            )
                          }
                          className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] font-mono text-[11px]"
                        >
                          <span className="truncate">
                            {getEscrowWalletForAsset(tradeModalAd.asset).address}
                          </span>
                          {copiedKey === 'order_escrow_wallet' ? (
                            <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                          ) : (
                            <Copy className="w-3 h-3 shrink-0" />
                          )}
                        </button>
                        <input
                          type="text"
                          required
                          value={sellEscrowTxHash}
                          onChange={(e) => setSellEscrowTxHash(e.target.value)}
                          placeholder="Paste deposit TX hash (0x... or Solana signature)"
                          className="w-full px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] font-mono"
                        />
                      </div>
                    )}
                  </div>
                </>
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
                {tradeModalAd.side === 'buy'
                  ? 'Deposit Escrow & Open Sell Order'
                  : 'Open Escrow Trade & Chat Room'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: REQUEST PRIVATE P2P OFFER */}
      {privateReqModalAd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">
                Request Private Trade with @{privateReqModalAd.makerUsername}
              </h3>
              <button
                type="button"
                onClick={() => setPrivateReqModalAd(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSubmitPrivateRequest(e)} className="space-y-3">
              <div>
                <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Fiat Amount ({privateReqModalAd.fiatCurrency})
                </label>
                <input
                  type="number"
                  step="any"
                  min={privateReqModalAd.minFiatOrder}
                  max={privateReqModalAd.maxFiatOrder}
                  value={privateReqFiat}
                  onChange={(e) => setPrivateReqFiat(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] font-mono"
                  required
                />
              </div>

              <div>
                <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Payment Method
                </label>
                <select
                  value={privateReqMethodId}
                  onChange={(e) => setPrivateReqMethodId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
                >
                  {privateReqModalAd.paymentMethodIds.map((id, i) => (
                    <option key={id} value={id}>
                      {privateReqModalAd.paymentMethodNames[i] || id}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Message to Maker (Optional)
                </label>
                <input
                  type="text"
                  value={privateReqNote}
                  onChange={(e) => setPrivateReqNote(e.target.value)}
                  placeholder="e.g. Ready to pay immediately via M-Pesa"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
                />
              </div>

              <button
                type="submit"
                disabled={submittingPrivateReq}
                className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold"
              >
                {submittingPrivateReq ? 'Submitting Request…' : 'Send Private Trade Request'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
