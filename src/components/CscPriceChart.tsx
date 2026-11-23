import { useMemo, useState } from 'react';
import type { CscPricePoint } from '../types/csc';
import { formatCscUsdPrice } from '../utils/cscEconomics';

interface CscPriceChartProps {
  history: CscPricePoint[];
  spotPriceUsd: number;
  genesisPriceUsd: number;
}

export function CscPriceChart({
  history,
  spotPriceUsd,
  genesisPriceUsd,
}: CscPriceChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const points = useMemo(() => {
    if (history.length >= 2) return history;
    const now = Date.now();
    return [
      { ts: now - 600_000, blockHeight: 1000, priceUsd: genesisPriceUsd, volumeUsd: 0, event: 'genesis' as const },
      { ts: now, blockHeight: 1001, priceUsd: spotPriceUsd, volumeUsd: 0, event: 'emission' as const },
    ];
  }, [history, spotPriceUsd, genesisPriceUsd]);

  const { minPrice, maxPrice, pathD, areaD, coords, isUp } = useMemo(() => {
    const prices = points.map((p) => p.priceUsd);
    const rawMin = Math.min(...prices, spotPriceUsd);
    const rawMax = Math.max(...prices, spotPriceUsd);
    const pad = Math.max(0.002, (rawMax - rawMin) * 0.18 || rawMax * 0.04);
    const lo = Math.max(0.0001, rawMin - pad);
    const hi = rawMax + pad;
    const span = Math.max(1e-9, hi - lo);

    const W = 720;
    const H = 200;
    const pxLeft = 10;
    const pxRight = W - 10;
    const pyTop = 16;
    const pyBot = H - 22;

    const list = points.map((p, idx) => {
      const x =
        points.length === 1
          ? (pxLeft + pxRight) / 2
          : pxLeft + (idx / (points.length - 1)) * (pxRight - pxLeft);
      const y = pyBot - ((p.priceUsd - lo) / span) * (pyBot - pyTop);
      return { x, y, point: p };
    });

    const d = list
      .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
      .join(' ');
    const area =
      list.length > 0
        ? `${d} L ${list[list.length - 1].x.toFixed(1)} ${pyBot} L ${list[0].x.toFixed(1)} ${pyBot} Z`
        : '';

    const up = points[points.length - 1].priceUsd >= points[0].priceUsd;

    return {
      minPrice: rawMin,
      maxPrice: rawMax,
      pathD: d,
      areaD: area,
      coords: list,
      isUp: up,
    };
  }, [points, spotPriceUsd]);

  const activeCoord =
    hoverIdx !== null && coords[hoverIdx] ? coords[hoverIdx] : coords[coords.length - 1];
  const strokeColor = isUp ? '#10B981' : '#EF4444';

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            AMM Spot Curve · CSC / USD (USDT + USD1 Depth)
          </div>
          <div className="flex items-baseline gap-2.5 mt-0.5">
            <span className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {formatCscUsdPrice(activeCoord ? activeCoord.point.priceUsd : spotPriceUsd)}
            </span>
            {activeCoord && (
              <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                Block #{activeCoord.point.blockHeight} ·{' '}
                {activeCoord.point.event.replace('_', ' ')}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
          <span>Low: {formatCscUsdPrice(minPrice)}</span>
          <span>High: {formatCscUsdPrice(maxPrice)}</span>
        </div>
      </div>

      <div className="relative w-full h-40 sm:h-48">
        <svg
          viewBox="0 0 720 200"
          className="w-full h-full overflow-visible select-none"
          preserveAspectRatio="none"
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id="cscAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity="0.22" />
              <stop offset="100%" stopColor={strokeColor} stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {[40, 90, 140].map((yLine) => (
            <line
              key={yLine}
              x1="10"
              y1={yLine}
              x2="710"
              y2={yLine}
              stroke="currentColor"
              className="text-slate-200 dark:text-slate-800"
              strokeDasharray="3 4"
              strokeWidth="1"
            />
          ))}

          {areaD && <path d={areaD} fill="url(#cscAreaGrad)" />}
          {pathD && (
            <path
              d={pathD}
              fill="none"
              stroke={strokeColor}
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {activeCoord && (
            <>
              <line
                x1={activeCoord.x}
                y1={14}
                x2={activeCoord.x}
                y2={178}
                stroke={strokeColor}
                strokeOpacity="0.35"
                strokeDasharray="3 3"
              />
              <circle
                cx={activeCoord.x}
                cy={activeCoord.y}
                r="4.5"
                fill={strokeColor}
                stroke="#ffffff"
                strokeWidth="1.5"
              />
            </>
          )}

          {coords.map((c, idx) => (
            <rect
              key={`${c.point.ts}-${idx}`}
              x={Math.max(0, c.x - 720 / Math.max(2, coords.length * 2))}
              y={0}
              width={720 / Math.max(1, coords.length)}
              height={200}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(idx)}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
