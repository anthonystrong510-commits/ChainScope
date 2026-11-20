import { useMemo, useState } from 'react';
import {
  Award,
  Flame,
  Fuel,
  Gift,
  Layers,
  Loader2,
  Package,
  Rocket,
  TrendingDown,
  TrendingUp,
  Trophy,
  Zap,
} from 'lucide-react';
import type {
  GasTier,
  MemeCoin,
  PerpPosition,
  PlatformEconomics,
  RewardClaim,
  UserHolding,
  UserProfile,
} from '../types/launchpad';
import {
  computeGasFee,
  computeLiquidationPrice,
  computeUnrealizedPnl,
  CURVE_TOKEN_ALLOCATION,
  formatCompactTokens,
  formatSolPrice,
  getBondingProgressPct,
  quoteBuy,
  quoteSell,
} from '../utils/bondingCurve';
import { formatTimestamp, formatUsd } from '../utils/chains';
import {
  buyCoinPack,
  claimHolderRewards,
  closePerpPosition,
  openPerpPosition,
} from '../services/launchpad';
import { CoinEmblem } from './CoinEmblem';

function toMillis(ts: unknown): number {
  if (!ts) return Date.now();
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'object' && ts !== null && 'toMillis' in ts) {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

/* ============================================================================
 * 1. HOLDER REWARDS PANEL
 * ==========================================================================*/
export function HolderRewardsPanel({
  userUid,
  coins,
  holdings,
  rewardClaims,
  economics,
  onSelectCoin,
  onMutated,
}: {
  userUid: string;
  coins: MemeCoin[];
  holdings: UserHolding[];
  rewardClaims: RewardClaim[];
  economics: PlatformEconomics;
  onSelectCoin: (coinId: string) => void;
  onMutated?: () => Promise<void> | void;
}) {
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const coinMap = useMemo(() => new Map(coins.map((c) => [c.id, c])), [coins]);

  const totalPoolSol = useMemo(
    () => coins.reduce((acc, c) => acc + (c.holderRewardPoolSol || 0), 0),
    [coins]
  );

  const eligibleRows = useMemo(() => {
    return holdings
      .map((h) => {
        const coin = coinMap.get(h.coinId);
        const poolSol = coin?.holderRewardPoolSol || 0;
        const sharePct = Math.min(100, (h.tokenBalance / CURVE_TOKEN_ALLOCATION) * 100);
        const estClaim =
          poolSol > 0.00001
            ? Math.min(poolSol, poolSol * Math.max(sharePct / 100, 0.05))
            : 0;
        return { holding: h, coin, poolSol, sharePct, estClaim };
      })
      .sort((a, b) => b.estClaim - a.estClaim);
  }, [holdings, coinMap]);

  const handleClaim = async (coinId: string, ticker: string) => {
    setClaimingId(coinId);
    setFeedback(null);
    try {
      const amt = await claimHolderRewards(userUid, coinId);
      await onMutated?.();
      setFeedback({
        type: 'ok',
        text: `Claimed ${amt.toFixed(6)} SOL in holder rewards from $${ticker}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Reward claim failed',
      });
    } finally {
      setClaimingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Total Active Holder Reward Pools
          </div>
          <div className="mt-1.5 text-xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {totalPoolSol.toFixed(4)} SOL
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {(economics.holderRewardBps / 100).toFixed(2)}% of every swap routes to token holders
          </div>
        </div>

        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="text-xs text-slate-500 dark:text-slate-400">Your Claimable Positions</div>
          <div className="mt-1.5 text-xl font-mono font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            {eligibleRows.reduce((s, r) => s + r.estClaim, 0).toFixed(5)} SOL
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Across {eligibleRows.length} held bonding-curve tokens
          </div>
        </div>

        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="text-xs text-slate-500 dark:text-slate-400">Total Claimed Historically</div>
          <div className="mt-1.5 text-xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {rewardClaims.reduce((s, c) => s + c.claimedSol, 0).toFixed(5)} SOL
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {rewardClaims.length} settled reward claims
          </div>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs ${
            feedback.type === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
          }`}
        >
          {feedback.text}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Gift className="w-4 h-4 text-emerald-500" />
              Your Token Reward Eligibility
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Every buy and sell contributes {(economics.holderRewardBps / 100).toFixed(2)}% of trade
              volume into that coin’s reward vault.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4">Token</th>
                <th className="py-3 px-4 text-right">Your Balance</th>
                <th className="py-3 px-4 text-right">Curve Share</th>
                <th className="py-3 px-4 text-right">Coin Pool</th>
                <th className="py-3 px-4 text-right">Est. Claimable</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {eligibleRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    Buy any meme coin on the curve to earn proportional holder rewards from swap
                    volume.
                  </td>
                </tr>
              ) : (
                eligibleRows.map(({ holding, poolSol, sharePct, estClaim }) => (
                  <tr key={holding.coinId} className="h-12 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        onClick={() => onSelectCoin(holding.coinId)}
                        className="flex items-center gap-2.5 text-left hover:underline"
                      >
                        <CoinEmblem
                          icon={holding.emblemIcon}
                          color={holding.emblemColor}
                          size="sm"
                        />
                        <div>
                          <div className="font-semibold">{holding.name}</div>
                          <div className="font-mono text-[11px] text-blue-500">
                            ${holding.ticker}
                          </div>
                        </div>
                      </button>
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {formatCompactTokens(holding.tokenBalance)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-500">
                      {sharePct.toFixed(2)}%
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {poolSol.toFixed(5)} SOL
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                      {estClaim.toFixed(6)} SOL
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        disabled={claimingId === holding.coinId || estClaim <= 0.000001}
                        onClick={() => void handleClaim(holding.coinId, holding.ticker)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-medium transition-colors"
                      >
                        {claimingId === holding.coinId && (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        )}
                        Claim SOL
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {rewardClaims.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
            Recent Reward Claim History
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {rewardClaims.slice(0, 10).map((cl) => (
              <div key={cl.id} className="px-4 py-2.5 flex items-center justify-between">
                <span className="font-mono font-semibold text-blue-500">${cl.ticker}</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">
                  +{cl.claimedSol.toFixed(6)} SOL
                </span>
                <span className="text-slate-500 tabular-nums">
                  {formatTimestamp(toMillis(cl.createdAt))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * 2. PERPS FUTURES PANEL
 * ==========================================================================*/
export function PerpsPanel({
  userUid,
  profile,
  coins,
  perpPositions,
  gasTier,
  economics,
  onMutated,
}: {
  userUid: string;
  profile: UserProfile | null;
  coins: MemeCoin[];
  perpPositions: PerpPosition[];
  gasTier: GasTier;
  economics: PlatformEconomics;
  onMutated?: () => Promise<void> | void;
}) {
  const [selectedCoinId, setSelectedCoinId] = useState<string>(coins[0]?.id || '');
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [collateralInput, setCollateralInput] = useState('0.5');
  const [leverage, setLeverage] = useState(5);
  const [busy, setBusy] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const coinMap = useMemo(() => new Map(coins.map((c) => [c.id, c])), [coins]);
  const activeCoin = useMemo(
    () => coinMap.get(selectedCoinId) || coins[0] || null,
    [coinMap, selectedCoinId, coins]
  );

  const gas = computeGasFee(gasTier, economics);
  const collateralNum = Number(collateralInput) || 0;
  const notionalSol = collateralNum * leverage;
  const estLiqPrice = activeCoin
    ? computeLiquidationPrice(side, activeCoin.priceSol, leverage)
    : 0;

  const handleOpenPerp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCoin) return;
    setBusy(true);
    setFeedback(null);
    try {
      await openPerpPosition({
        userUid,
        coinId: activeCoin.id,
        side,
        collateralSol: collateralNum,
        leverage,
        gasTier,
        economics,
      });
      await onMutated?.();
      setFeedback({
        type: 'ok',
        text: `Opened ${leverage}x ${side.toUpperCase()} on $${activeCoin.ticker} with ${collateralNum.toFixed(3)} SOL margin.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to open perp position',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleClosePerp = async (pos: PerpPosition) => {
    setClosingId(pos.id);
    setFeedback(null);
    try {
      const res = await closePerpPosition({
        userUid,
        posId: pos.id,
        coinId: pos.coinId,
      });
      await onMutated?.();
      setFeedback({
        type: res.liquidated ? 'err' : 'ok',
        text: res.liquidated
          ? `Position on $${pos.ticker} was liquidated.`
          : `Closed $${pos.ticker} ${pos.side.toUpperCase()} (${res.pnlSol >= 0 ? '+' : ''}${res.pnlSol.toFixed(4)} SOL PnL · Paid ${res.payoutSol.toFixed(4)} SOL).`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to close position',
      });
    } finally {
      setClosingId(null);
    }
  };

  const openPositions = perpPositions.filter((p) => p.status === 'open');
  const closedPositions = perpPositions.filter((p) => p.status !== 'open');

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left 5 cols: Order Entry */}
        <form
          onSubmit={handleOpenPerp}
          className="lg:col-span-5 p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-500" />
                Meme Coin Perpetuals (1x–20x)
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Mark price streams directly from the live bonding curve.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Underlying Market
            </label>
            <select
              value={activeCoin?.id || ''}
              onChange={(e) => setSelectedCoinId(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
            >
              {coins.length === 0 ? (
                <option value="">No coins launched yet</option>
              ) : (
                coins.map((c) => (
                  <option key={c.id} value={c.id}>
                    ${c.ticker} — {c.name} ({formatSolPrice(c.priceSol)} SOL)
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17]">
            <button
              type="button"
              onClick={() => setSide('long')}
              className={`py-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                side === 'long'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              Long
            </button>
            <button
              type="button"
              onClick={() => setSide('short')}
              className={`py-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                side === 'short'
                  ? 'bg-red-600 text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <TrendingDown className="w-3.5 h-3.5" />
              Short
            </button>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-slate-600 dark:text-slate-400">Margin Collateral (SOL)</span>
              <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                Bal: {profile ? profile.solBalance.toFixed(4) : '0'} SOL
              </span>
            </div>
            <input
              type="number"
              step="any"
              min="0.01"
              value={collateralInput}
              onChange={(e) => setCollateralInput(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
            />
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-slate-600 dark:text-slate-400">Leverage</span>
              <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                {leverage}x
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={20}
              step={1}
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between text-[11px] font-mono text-slate-500 mt-1">
              {[1, 5, 10, 15, 20].map((lv) => (
                <button
                  key={lv}
                  type="button"
                  onClick={() => setLeverage(lv)}
                  className="hover:text-blue-500"
                >
                  {lv}x
                </button>
              ))}
            </div>
          </div>

          {activeCoin && (
            <div className="p-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] space-y-1.5 text-xs tabular-nums">
              <div className="flex justify-between">
                <span className="text-slate-500">Mark Entry Price</span>
                <span className="font-mono">{formatSolPrice(activeCoin.priceSol)} SOL</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Notional Size</span>
                <span className="font-mono font-semibold">{notionalSol.toFixed(3)} SOL</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Est. Liquidation Price</span>
                <span className="font-mono text-amber-500">{formatSolPrice(estLiqPrice)} SOL</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Network Gas ({gasTier})</span>
                <span className="font-mono">{gas.totalGasSol.toFixed(5)} SOL</span>
              </div>
            </div>
          )}

          {feedback && (
            <div
              className={`p-3 rounded-lg border text-xs ${
                feedback.type === 'ok'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
              }`}
            >
              {feedback.text}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !activeCoin || collateralNum <= 0}
            className={`w-full py-2.5 px-4 rounded-lg text-white text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-40 transition-colors ${
              side === 'long'
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-red-600 hover:bg-red-700'
            }`}
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Open {leverage}x {side === 'long' ? 'Long' : 'Short'}
          </button>
        </form>

        {/* Right 7 cols: Active & Settled Positions */}
        <div className="lg:col-span-7 space-y-5">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold flex items-center justify-between">
              <span>Open Perpetual Positions ({openPositions.length})</span>
              <span className="text-slate-500 font-normal">Live curve mark-to-market</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500">
                    <th className="py-2.5 px-4">Market</th>
                    <th className="py-2.5 px-4">Side</th>
                    <th className="py-2.5 px-4 text-right">Collateral</th>
                    <th className="py-2.5 px-4 text-right">Entry / Mark</th>
                    <th className="py-2.5 px-4 text-right">Unrealized PnL</th>
                    <th className="py-2.5 px-4 text-right">Close</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {openPositions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-500">
                        No open perpetual positions. Open a leveraged Long or Short on the left.
                      </td>
                    </tr>
                  ) : (
                    openPositions.map((pos) => {
                      const coin = coinMap.get(pos.coinId);
                      const mark = coin?.priceSol || pos.entryPriceSol;
                      const pnl = computeUnrealizedPnl(pos, mark);
                      return (
                        <tr key={pos.id} className="h-12">
                          <td className="px-4 py-2 font-mono font-semibold text-blue-500">
                            ${pos.ticker}
                          </td>
                          <td className="px-4 py-2">
                            <span
                              className={`font-semibold ${
                                pos.side === 'long' ? 'text-emerald-500' : 'text-red-500'
                              }`}
                            >
                              {pos.leverage}x {pos.side.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">
                            {pos.collateralSol.toFixed(3)} SOL
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-[11px] tabular-nums">
                            <div>{formatSolPrice(pos.entryPriceSol)}</div>
                            <div className="text-slate-500">{formatSolPrice(mark)}</div>
                          </td>
                          <td
                            className={`px-4 py-2 text-right font-mono font-semibold tabular-nums ${
                              pnl.pnlSol >= 0 ? 'text-emerald-500' : 'text-red-500'
                            }`}
                          >
                            {pnl.pnlSol >= 0 ? '+' : ''}
                            {pnl.pnlSol.toFixed(4)} SOL
                            <div className="text-[11px] font-normal">
                              ({pnl.roiPct >= 0 ? '+' : ''}
                              {pnl.roiPct.toFixed(1)}%)
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right">
                            <button
                              type="button"
                              disabled={closingId === pos.id}
                              onClick={() => void handleClosePerp(pos)}
                              className="px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
                            >
                              {closingId === pos.id ? 'Settling…' : 'Settle'}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {closedPositions.length > 0 && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
                Settled Perp History ({closedPositions.length})
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {closedPositions.slice(0, 8).map((pos) => (
                  <div key={pos.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                    <div className="font-mono">
                      <span className="font-semibold text-blue-500">${pos.ticker}</span> ·{' '}
                      <span>
                        {pos.leverage}x {pos.side.toUpperCase()}
                      </span>
                    </div>
                    <span
                      className={`font-mono font-semibold tabular-nums ${
                        pos.realizedPnlSol >= 0 ? 'text-emerald-500' : 'text-red-500'
                      }`}
                    >
                      {pos.realizedPnlSol >= 0 ? '+' : ''}
                      {pos.realizedPnlSol.toFixed(4)} SOL ({pos.status})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * 3. PACKS BUNDLE PANEL
 * ==========================================================================*/
export function PacksPanel({
  userUid,
  coins,
  gasTier,
  economics,
  onSelectCoin,
  onMutated,
}: {
  userUid: string;
  coins: MemeCoin[];
  gasTier: GasTier;
  economics: PlatformEconomics;
  onSelectCoin: (coinId: string) => void;
  onMutated?: () => Promise<void> | void;
}) {
  const [packBudget, setPackBudget] = useState('1.5');
  const [selectedCustomIds, setSelectedCustomIds] = useState<string[]>([]);
  const [busyPack, setBusyPack] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const curatedPacks = useMemo(() => {
    const mayhemTop = coins
      .filter((c) => c.mode === 'mayhem')
      .sort((a, b) => b.volumeSol - a.volumeSol)
      .slice(0, 3);
    const topVolume = [...coins].sort((a, b) => b.volumeSol - a.volumeSol).slice(0, 3);
    const freshLaunches = [...coins]
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
      .slice(0, 3);
    const nearGrad = [...coins]
      .filter((c) => !c.graduated)
      .sort((a, b) => b.realSol - a.realSol)
      .slice(0, 3);

    return [
      {
        id: 'pack_top_vol',
        title: 'Blue-Chip Volume Trio',
        subtitle: 'Equal split across the top 3 highest-volume meme coins',
        coins: topVolume,
      },
      {
        id: 'pack_mayhem',
        title: 'Mayhem Volatility Pack',
        subtitle: 'High-beta bonding curves with steep price elasticity',
        coins: mayhemTop,
      },
      {
        id: 'pack_fresh',
        title: 'Fresh Mint Basket',
        subtitle: 'Instant diversification into the 3 newest launched tokens',
        coins: freshLaunches,
      },
      {
        id: 'pack_grad',
        title: 'Graduation Sprint Pack',
        subtitle: 'Tokens closest to hitting DEX graduation target',
        coins: nearGrad,
      },
    ];
  }, [coins]);

  const toggleCustomCoin = (coinId: string) => {
    setSelectedCustomIds((prev) =>
      prev.includes(coinId) ? prev.filter((id) => id !== coinId) : [...prev, coinId].slice(0, 5)
    );
  };

  const handleBuyPack = async (packId: string, packCoins: MemeCoin[]) => {
    if (packCoins.length === 0) return;
    const totalBudget = Number(packBudget);
    if (!Number.isFinite(totalBudget) || totalBudget <= 0) {
      setFeedback({ type: 'err', text: 'Enter a valid SOL allocation budget.' });
      return;
    }

    const perCoin = Number((totalBudget / packCoins.length).toFixed(4));
    setBusyPack(packId);
    setFeedback(null);
    try {
      await buyCoinPack({
        userUid,
        allocations: packCoins.map((c) => ({ coinId: c.id, solAmount: perCoin })),
        gasTier,
        economics,
      });
      await onMutated?.();
      setFeedback({
        type: 'ok',
        text: `Executed ${packCoins.length}-coin Pack buy (${perCoin} SOL each across ${packCoins.map((c) => `$${c.ticker}`).join(', ')}).`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Pack purchase failed',
      });
    } finally {
      setBusyPack(null);
    }
  };

  const customCoins = coins.filter((c) => selectedCustomIds.includes(c.id));

  return (
    <div className="space-y-5">
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Package className="w-4 h-4 text-blue-500" />
            Curated & Custom Meme Coin Packs
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Split a single SOL budget across multiple bonding curves in one workflow.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Pack Budget (SOL):</span>
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={packBudget}
            onChange={(e) => setPackBudget(e.target.value)}
            className="w-28 px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]"
          />
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs ${
            feedback.type === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
          }`}
        >
          {feedback.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {curatedPacks.map((pack) => (
          <div
            key={pack.id}
            className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-col justify-between gap-4"
          >
            <div className="space-y-3">
              <div>
                <h4 className="text-sm font-semibold">{pack.title}</h4>
                <p className="text-xs text-slate-500 mt-0.5">{pack.subtitle}</p>
              </div>

              {pack.coins.length === 0 ? (
                <div className="py-4 text-xs text-slate-500">
                  No eligible coins in this category yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {pack.coins.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onSelectCoin(c.id)}
                      className="w-full p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B0F17] flex items-center justify-between text-xs hover:border-blue-500/50 transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <CoinEmblem icon={c.emblemIcon} color={c.emblemColor} size="sm" />
                        <span className="font-semibold">{c.name}</span>
                        <span className="font-mono text-blue-500">${c.ticker}</span>
                      </div>
                      <span className="font-mono text-slate-500 tabular-nums">
                        {c.marketCapSol.toFixed(1)} SOL MCap
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={pack.coins.length === 0 || busyPack === pack.id}
              onClick={() => void handleBuyPack(pack.id, pack.coins)}
              className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              {busyPack === pack.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Buy Pack ({packBudget} SOL across {pack.coins.length} coins)
            </button>
          </div>
        ))}
      </div>

      {/* Custom Basket Builder */}
      {coins.length > 0 && (
        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold">Custom Pack Builder (Pick up to 5)</h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Select coins below to execute an atomic multi-curve purchase.
              </p>
            </div>
            <button
              type="button"
              disabled={customCoins.length === 0 || busyPack === 'custom'}
              onClick={() => void handleBuyPack('custom', customCoins)}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold inline-flex items-center gap-1.5"
            >
              {busyPack === 'custom' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Buy Custom Pack ({customCoins.length} selected)
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {coins.slice(0, 18).map((c) => {
              const picked = selectedCustomIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleCustomCoin(c.id)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-2 transition-colors ${
                    picked
                      ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <span className="font-mono font-semibold">${c.ticker}</span>
                  <span className="text-[11px] text-slate-500">{c.marketCapSol.toFixed(1)} SOL</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * 4. LEADERBOARD PANEL
 * ==========================================================================*/
export function LeaderboardPanel({
  traders,
  coins,
  solUsdPrice,
  onSelectCoin,
}: {
  traders: UserProfile[];
  coins: MemeCoin[];
  solUsdPrice: number;
  onSelectCoin: (coinId: string) => void;
}) {
  const [boardTab, setBoardTab] = useState<'traders' | 'creators' | 'coins'>('traders');

  const topTraders = useMemo(
    () => [...traders].sort((a, b) => b.solBalance - a.solBalance).slice(0, 25),
    [traders]
  );

  const topCreators = useMemo(() => {
    const map = new Map<
      string,
      { handle: string; coinsCount: number; totalVolSol: number; maxMcapSol: number }
    >();
    for (const c of coins) {
      const cur = map.get(c.creatorUid) || {
        handle: c.creatorHandle,
        coinsCount: 0,
        totalVolSol: 0,
        maxMcapSol: 0,
      };
      cur.coinsCount += 1;
      cur.totalVolSol += c.volumeSol;
      cur.maxMcapSol = Math.max(cur.maxMcapSol, c.marketCapSol);
      map.set(c.creatorUid, cur);
    }
    return Array.from(map.entries())
      .map(([uid, stats]) => ({ uid, ...stats }))
      .sort((a, b) => b.totalVolSol - a.totalVolSol);
  }, [coins]);

  const topCoins = useMemo(
    () => [...coins].sort((a, b) => b.marketCapSol - a.marketCapSol).slice(0, 25),
    [coins]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" />
            Live Pump Arena Leaderboard
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time rankings across registered traders, token creators, and bonding curves.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17]">
          {[
            { id: 'traders', label: 'Top Traders' },
            { id: 'creators', label: 'Top Creators' },
            { id: 'coins', label: 'Top Market Cap' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setBoardTab(tab.id as 'traders' | 'creators' | 'coins')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                boardTab === tab.id
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
        {boardTab === 'traders' && (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500">
                <th className="py-3 px-4">Rank</th>
                <th className="py-3 px-4">Trader</th>
                <th className="py-3 px-4 text-right">SOL Liquidity</th>
                <th className="py-3 px-4 text-right">Est. USD</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {topTraders.map((t, idx) => (
                <tr key={t.uid} className="h-11">
                  <td className="px-4 py-2 font-mono font-bold text-slate-500">#{idx + 1}</td>
                  <td className="px-4 py-2">
                    <span className="font-semibold">@{t.handle}</span>
                    <span className="text-slate-500 ml-2">{t.displayName}</span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-semibold tabular-nums">
                    {t.solBalance.toFixed(4)} SOL
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-slate-500 tabular-nums">
                    {solUsdPrice > 0 ? formatUsd(t.solBalance * solUsdPrice) : '—'}
                  </td>
                </tr>
              ))}
              {topTraders.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-500">
                    No traders registered yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {boardTab === 'creators' && (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500">
                <th className="py-3 px-4">Rank</th>
                <th className="py-3 px-4">Creator</th>
                <th className="py-3 px-4 text-right">Coins Launched</th>
                <th className="py-3 px-4 text-right">Peak MCap</th>
                <th className="py-3 px-4 text-right">Total Volume</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {topCreators.map((cr, idx) => (
                <tr key={cr.uid} className="h-11">
                  <td className="px-4 py-2 font-mono font-bold text-slate-500">#{idx + 1}</td>
                  <td className="px-4 py-2 font-semibold">@{cr.handle}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{cr.coinsCount}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">
                    {cr.maxMcapSol.toFixed(2)} SOL
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-semibold text-emerald-500 tabular-nums">
                    {cr.totalVolSol.toFixed(2)} SOL
                  </td>
                </tr>
              ))}
              {topCreators.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-500">
                    No coin creators yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {boardTab === 'coins' && (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500">
                <th className="py-3 px-4">Rank</th>
                <th className="py-3 px-4">Token</th>
                <th className="py-3 px-4">Mode</th>
                <th className="py-3 px-4 text-right">Market Cap</th>
                <th className="py-3 px-4 text-right">Volume</th>
                <th className="py-3 px-4 text-right">Curve</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {topCoins.map((c, idx) => (
                <tr
                  key={c.id}
                  onClick={() => onSelectCoin(c.id)}
                  className="h-12 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer"
                >
                  <td className="px-4 py-2 font-mono font-bold text-slate-500">#{idx + 1}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2.5">
                      <CoinEmblem icon={c.emblemIcon} color={c.emblemColor} size="sm" />
                      <span className="font-semibold">{c.name}</span>
                      <span className="font-mono text-blue-500">${c.ticker}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 capitalize">
                    {c.mode === 'mayhem' ? (
                      <span className="text-orange-500 font-semibold">Mayhem</span>
                    ) : (
                      'Standard'
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-semibold tabular-nums">
                    {c.marketCapSol.toFixed(2)} SOL
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">
                    {c.volumeSol.toFixed(2)} SOL
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">
                    {getBondingProgressPct(c.realSol, c.mode || 'standard').toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
 * 5. INTERACTIVE COIN CREATION, PRICING & GAS MECHANICS SIMULATOR
 * ==========================================================================*/
export function MechanicsExplainerPanel({ economics }: { economics: PlatformEconomics }) {
  const [simMode, setSimMode] = useState<'standard' | 'mayhem'>('standard');
  const [simSolIn, setSimSolIn] = useState('2.0');
  const [simGasTier, setSimGasTier] = useState<GasTier>('fast');

  const buySim = useMemo(() => {
    const vSol = simMode === 'mayhem' ? 15 : 30;
    const vTok = 1_073_000_000;
    return quoteBuy(vSol, vTok, 0, Math.max(0.01, Number(simSolIn) || 0), simMode, simGasTier, economics);
  }, [simMode, simSolIn, simGasTier, economics]);

  const sellSim = useMemo(() => {
    return quoteSell(
      buySim.newVirtualSol,
      buySim.newVirtualTokens,
      buySim.newRealSol,
      buySim.tokensOut * 0.5,
      simGasTier,
      economics
    );
  }, [buySim, simGasTier, economics]);

  const gas = computeGasFee(simGasTier, economics);

  return (
    <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Award className="w-4 h-4 text-blue-500" />
            Bonding-Curve Pricing, Buy/Sell Impact & Gas Fee Engine
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Live constant-product AMM simulator showing how coins launch, how buys/sells shift spot
            price, and how gas & holder rewards split.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setSimMode('standard')}
            className={`px-3 py-1.5 rounded-lg border font-medium ${
              simMode === 'standard'
                ? 'border-blue-500 bg-blue-500/10 text-blue-500'
                : 'border-slate-200 dark:border-slate-800 text-slate-500'
            }`}
          >
            Standard (30v SOL · 85 Target)
          </button>
          <button
            type="button"
            onClick={() => setSimMode('mayhem')}
            className={`px-3 py-1.5 rounded-lg border font-medium ${
              simMode === 'mayhem'
                ? 'border-orange-500 bg-orange-500/10 text-orange-500'
                : 'border-slate-200 dark:border-slate-800 text-slate-500'
            }`}
          >
            Mayhem (15v SOL · 45 Target)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        <div className="p-4 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] space-y-2">
          <div className="font-semibold flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
            <Rocket className="w-3.5 h-3.5 text-blue-500" />
            1. How Coins Are Created
          </div>
          <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
            Every coin mints a fixed <span className="font-mono">1,000,000,000</span> supply
            (<span className="font-mono">800M</span> on the curve, <span className="font-mono">200M</span>{' '}
            reserved for DEX graduation). Deployment charges{' '}
            <span className="font-mono">{economics.creationFeeSol} SOL</span> + gas and seeds{' '}
            <span className="font-mono">x · y = k</span> virtual reserves.
          </p>
        </div>

        <div className="p-4 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] space-y-2">
          <div className="font-semibold flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
            <Flame className="w-3.5 h-3.5 text-emerald-500" />
            2. Buy vs. Sell Price Influence
          </div>
          <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
            Spot price is <span className="font-mono">P = virtualSol / virtualTokens</span>. Buying
            adds SOL to <span className="font-mono">virtualSol</span> and drains{' '}
            <span className="font-mono">virtualTokens</span>, driving price up quadratically.
            Selling returns tokens to <span className="font-mono">virtualTokens</span> and pulls SOL
            out, lowering price.
          </p>
        </div>

        <div className="p-4 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] space-y-2">
          <div className="font-semibold flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
            <Fuel className="w-3.5 h-3.5 text-amber-500" />
            3. Gas Fees & Revenue Split
          </div>
          <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
            Gas equals <span className="font-mono">(Base + PriorityTip) × {economics.congestionMultiplier}x</span>.
            Swap fees split into{' '}
            <span className="font-mono">{(economics.protocolFeeBps / 100).toFixed(2)}%</span>{' '}
            Protocol,{' '}
            <span className="font-mono">{(economics.holderRewardBps / 100).toFixed(2)}%</span>{' '}
            Holder Rewards, and{' '}
            <span className="font-mono">{(economics.creatorFeeBps / 100).toFixed(2)}%</span>{' '}
            Creator royalties.
          </p>
        </div>
      </div>

      {/* Interactive Live Simulator */}
      <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-[#0B0F17] grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs tabular-nums">
        <div className="space-y-2.5">
          <div className="font-semibold flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-blue-500" />
            Simulate Trade Input
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={simSolIn}
              onChange={(e) => setSimSolIn(e.target.value)}
              className="w-28 px-2.5 py-1.5 font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
            />
            <span className="text-slate-500">SOL Buy</span>
          </div>
          <div className="flex items-center gap-1.5">
            {(['standard', 'fast', 'turbo'] as const).map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => setSimGasTier(tier)}
                className={`px-2.5 py-1 rounded border capitalize ${
                  simGasTier === tier
                    ? 'border-blue-500 bg-blue-500/10 text-blue-500 font-semibold'
                    : 'border-slate-200 dark:border-slate-800 text-slate-500'
                }`}
              >
                {tier}
              </button>
            ))}
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            Gas Fee: {gas.totalGasSol.toFixed(5)} SOL ({gas.baseGasSol.toFixed(5)} base +{' '}
            {gas.priorityTipSol.toFixed(5)} tip)
          </div>
        </div>

        <div className="space-y-1.5 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 pt-3 lg:pt-0 lg:pl-4">
          <div className="font-semibold text-emerald-500">After {simSolIn || 0} SOL Buy</div>
          <div className="flex justify-between">
            <span className="text-slate-500">Tokens Received</span>
            <span className="font-mono font-semibold">{formatCompactTokens(buySim.tokensOut)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Price Push</span>
            <span className="font-mono text-emerald-500">+{buySim.priceImpactPct.toFixed(2)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">To Holder Pool / Creator</span>
            <span className="font-mono">
              {buySim.holderRewardFeeSol.toFixed(5)} / {buySim.creatorFeeSol.toFixed(5)} SOL
            </span>
          </div>
        </div>

        <div className="space-y-1.5 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 pt-3 lg:pt-0 lg:pl-4">
          <div className="font-semibold text-red-500">If Selling 50% Back Immediately</div>
          <div className="flex justify-between">
            <span className="text-slate-500">Net SOL Returned</span>
            <span className="font-mono font-semibold">{sellSim.netSolOut.toFixed(4)} SOL</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Price Drop</span>
            <span className="font-mono text-red-500">-{sellSim.priceImpactPct.toFixed(2)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">New Spot Price</span>
            <span className="font-mono">{formatSolPrice(sellSim.newPriceSol)} SOL</span>
          </div>
        </div>
      </div>
    </div>
  );
}
