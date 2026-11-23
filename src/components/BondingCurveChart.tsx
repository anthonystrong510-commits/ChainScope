import { useMemo, useState } from 'react';
import type { CoinTrade, MemeCoin } from '../types/launchpad';
import { formatSolPrice, getCurveParams } from '../utils/bondingCurve';

interface BondingCurveChartProps {
  coin: MemeCoin;
  trades: CoinTrade[];
}

export function BondingCurveChart({ coin, trades }: BondingCurveChartProps) {
  const [chartTab, setChartTab] = useState<'price' | 'curve'>('price');
  const curveParams = getCurveParams(coin.mode || 'standard');

  // Chronological price series (oldest -> newest)
  const priceSeries = useMemo(() => {
    const sorted = [...trades].reverse();
    const initialPrice = curveParams.initialVirtualSol / curveParams.initialVirtualTokens;
    const pts: Array<{ label: string; price: number; side: 'buy' | 'sell' }> = [
      { label: 'Launch', price: initialPrice, side: 'buy' },
    ];
    for (const t of sorted) {
      pts.push({
        label: t.side === 'buy' ? 'Buy' : 'Sell',
        price: t.priceSol,
        side: t.side,
      });
    }
    if (pts.length === 1) {
      pts.push({ label: 'Current', price: coin.priceSol, side: 'buy' });
    }
    return pts;
  }, [trades, coin.priceSol, curveParams.initialVirtualSol, curveParams.initialVirtualTokens]);

  // Constant-product curve points across realSol = 0 .. graduationTargetSol
  const curveSeries = useMemo(() => {
    const k = curveParams.initialVirtualSol * curveParams.initialVirtualTokens;
    const steps = 28;
    const points: Array<{ realSol: number; priceSol: number }> = [];
    for (let i = 0; i <= steps; i++) {
      const rSol = (curveParams.graduationTargetSol * i) / steps;
      const vSol = curveParams.initialVirtualSol + rSol;
      const vTok = k / vSol;
      points.push({ realSol: rSol, priceSol: vSol / vTok });
    }
    return points;
  }, [
    curveParams.graduationTargetSol,
    curveParams.initialVirtualSol,
    curveParams.initialVirtualTokens,
  ]);

  const width = 640;
  const height = 220;
  const padX = 18;
  const padY = 20;

  const renderPriceChart = () => {
    const prices = priceSeries.map((p) => p.price);
    const minP = Math.min(...prices) * 0.96;
    const maxP = Math.max(...prices) * 1.04;
    const span = Math.max(maxP - minP, 1e-12);

    const coords = priceSeries.map((p, idx) => {
      const x =
        padX +
        (priceSeries.length > 1
          ? (idx / (priceSeries.length - 1)) * (width - padX * 2)
          : (width - padX * 2) / 2);
      const y = height - padY - ((p.price - minP) / span) * (height - padY * 2);
      return { x, y, ...p };
    });

    const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
    const areaPath = `${linePath} L ${coords[coords.length - 1].x} ${height - padY} L ${coords[0].x} ${height - padY} Z`;

    const last = coords[coords.length - 1];
    const first = coords[0];
    const isUp = last.price >= first.price;
    const strokeColor = isUp ? '#10B981' : '#EF4444';

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44 sm:h-56 overflow-visible">
        <defs>
          <linearGradient id={`priceArea-${coin.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.24" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {[0.2, 0.5, 0.8].map((frac) => {
          const y = padY + frac * (height - padY * 2);
          return (
            <line
              key={frac}
              x1={padX}
              x2={width - padX}
              y1={y}
              y2={y}
              stroke="currentColor"
              className="text-slate-200 dark:text-slate-800"
              strokeDasharray="3 4"
            />
          );
        })}

        <path d={areaPath} fill={`url(#priceArea-${coin.id})`} />
        <path d={linePath} fill="none" stroke={strokeColor} strokeWidth="2.25" strokeLinejoin="round" />

        {coords.map((c, idx) => (
          <circle
            key={idx}
            cx={c.x}
            cy={c.y}
            r={idx === coords.length - 1 ? 4.5 : 2.5}
            fill={c.side === 'sell' ? '#EF4444' : '#10B981'}
          />
        ))}
      </svg>
    );
  };

  const renderCurveChart = () => {
    const maxP = curveSeries[curveSeries.length - 1].priceSol;
    const minP = curveSeries[0].priceSol;
    const span = Math.max(maxP - minP, 1e-12);

    const coords = curveSeries.map((pt) => {
      const x = padX + (pt.realSol / curveParams.graduationTargetSol) * (width - padX * 2);
      const y = height - padY - ((pt.priceSol - minP) / span) * (height - padY * 2);
      return { x, y, ...pt };
    });

    const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
    const clampedReal = Math.min(coin.realSol, curveParams.graduationTargetSol);
    const spotX = padX + (clampedReal / curveParams.graduationTargetSol) * (width - padX * 2);
    const spotY =
      height - padY - ((Math.min(coin.priceSol, maxP) - minP) / span) * (height - padY * 2);
    const curveColor = coin.mode === 'mayhem' ? '#F97316' : '#3B82F6';

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44 sm:h-56 overflow-visible">
        {[0.25, 0.5, 0.75].map((frac) => {
          const y = padY + frac * (height - padY * 2);
          return (
            <line
              key={frac}
              x1={padX}
              x2={width - padX}
              y1={y}
              y2={y}
              stroke="currentColor"
              className="text-slate-200 dark:text-slate-800"
              strokeDasharray="3 4"
            />
          );
        })}

        <path d={linePath} fill="none" stroke={curveColor} strokeWidth="2.25" />
        <line
          x1={spotX}
          x2={spotX}
          y1={padY}
          y2={height - padY}
          stroke={curveColor}
          strokeDasharray="3 3"
          strokeOpacity="0.6"
        />
        <circle cx={spotX} cy={spotY} r="5.5" fill={curveColor} stroke="#FFFFFF" strokeWidth="2" />
      </svg>
    );
  };

  return (
    <div className="p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {chartTab === 'price'
              ? 'Spot Execution Price (SOL)'
              : `${coin.mode === 'mayhem' ? 'Mayhem ' : ''}Bonding Curve Trajectory (x · y = k)`}
          </div>
          <div className="text-lg font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
            {formatSolPrice(coin.priceSol)} SOL
          </div>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17]">
          <button
            type="button"
            onClick={() => setChartTab('price')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              chartTab === 'price'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Price Tape
          </button>
          <button
            type="button"
            onClick={() => setChartTab('curve')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              chartTab === 'curve'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Bonding Curve
          </button>
        </div>
      </div>

      {chartTab === 'price' ? renderPriceChart() : renderCurveChart()}

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800/80 tabular-nums">
        <span>
          Virtual Reserves: {coin.virtualSol.toFixed(2)} SOL ·{' '}
          {(coin.virtualTokens / 1_000_000).toFixed(1)}M {coin.ticker}
        </span>
        <span>
          {coin.mode === 'mayhem' ? 'Mayhem Target' : 'Graduation Target'}:{' '}
          {curveParams.graduationTargetSol} SOL
        </span>
      </div>
    </div>
  );
}
