import type {
  CoinMode,
  GasTier,
  PerpPosition,
  PlatformEconomics,
} from '../types/launchpad';

export const TOTAL_SUPPLY = 1_000_000_000;
export const CURVE_TOKEN_ALLOCATION = 800_000_000;
export const INITIAL_VIRTUAL_SOL = 30;
export const MAYHEM_VIRTUAL_SOL = 15;
export const INITIAL_VIRTUAL_TOKENS = 1_073_000_000;
export const GRADUATION_SOL_TARGET = 85;
export const MAYHEM_GRADUATION_SOL_TARGET = 45;

export const DEFAULT_PLATFORM_ECONOMICS: PlatformEconomics = {
  id: 'economics',
  creationFeeSol: 0.01,
  baseGasSol: 0.0005,
  priorityGasSol: 0.0015,
  protocolFeeBps: 50, // 0.50%
  holderRewardBps: 30, // 0.30%
  creatorFeeBps: 20, // 0.20%
  congestionMultiplier: 1.0,
};

export interface GasFeeBreakdown {
  tier: GasTier;
  baseGasSol: number;
  priorityTipSol: number;
  congestionMultiplier: number;
  totalGasSol: number;
}

export interface FeeSplitBreakdown {
  totalFeeSol: number;
  protocolFeeSol: number;
  holderRewardFeeSol: number;
  creatorFeeSol: number;
  totalBps: number;
}

export interface BuyQuote {
  solIn: number;
  gasSol: number;
  totalSolDebited: number;
  feeSol: number;
  protocolFeeSol: number;
  holderRewardFeeSol: number;
  creatorFeeSol: number;
  netSol: number;
  tokensOut: number;
  newVirtualSol: number;
  newVirtualTokens: number;
  newRealSol: number;
  oldPriceSol: number;
  newPriceSol: number;
  newMarketCapSol: number;
  priceImpactPct: number;
  graduated: boolean;
}

export interface SellQuote {
  tokensIn: number;
  grossSolOut: number;
  gasSol: number;
  feeSol: number;
  protocolFeeSol: number;
  holderRewardFeeSol: number;
  creatorFeeSol: number;
  netSolOut: number;
  newVirtualSol: number;
  newVirtualTokens: number;
  newRealSol: number;
  oldPriceSol: number;
  newPriceSol: number;
  newMarketCapSol: number;
  priceImpactPct: number;
}

export function getCurveParams(mode: CoinMode = 'standard') {
  if (mode === 'mayhem') {
    return {
      initialVirtualSol: MAYHEM_VIRTUAL_SOL,
      initialVirtualTokens: INITIAL_VIRTUAL_TOKENS,
      graduationTargetSol: MAYHEM_GRADUATION_SOL_TARGET,
    };
  }
  return {
    initialVirtualSol: INITIAL_VIRTUAL_SOL,
    initialVirtualTokens: INITIAL_VIRTUAL_TOKENS,
    graduationTargetSol: GRADUATION_SOL_TARGET,
  };
}

export function getInitialCurveState(mode: CoinMode = 'standard') {
  const params = getCurveParams(mode);
  const priceSol = params.initialVirtualSol / params.initialVirtualTokens;
  return {
    virtualSol: params.initialVirtualSol,
    virtualTokens: params.initialVirtualTokens,
    realSol: 0,
    totalSupply: TOTAL_SUPPLY,
    priceSol,
    marketCapSol: priceSol * TOTAL_SUPPLY,
    graduationTargetSol: params.graduationTargetSol,
  };
}

export function computeGasFee(
  tier: GasTier = 'standard',
  economics: PlatformEconomics = DEFAULT_PLATFORM_ECONOMICS
): GasFeeBreakdown {
  const mult = Math.max(0.5, economics.congestionMultiplier || 1);
  const baseGasSol = economics.baseGasSol * mult;
  let priorityTipSol = 0;
  if (tier === 'fast') {
    priorityTipSol = economics.priorityGasSol * mult;
  } else if (tier === 'turbo') {
    priorityTipSol = economics.priorityGasSol * 3 * mult;
  }
  const totalGasSol = Number((baseGasSol + priorityTipSol).toFixed(6));
  return {
    tier,
    baseGasSol: Number(baseGasSol.toFixed(6)),
    priorityTipSol: Number(priorityTipSol.toFixed(6)),
    congestionMultiplier: mult,
    totalGasSol,
  };
}

export function computeFeeSplit(
  grossSol: number,
  economics: PlatformEconomics = DEFAULT_PLATFORM_ECONOMICS
): FeeSplitBreakdown {
  const pBps = Math.max(0, economics.protocolFeeBps || 0);
  const hBps = Math.max(0, economics.holderRewardBps || 0);
  const cBps = Math.max(0, economics.creatorFeeBps || 0);
  const totalBps = pBps + hBps + cBps;
  const protocolFeeSol = grossSol * (pBps / 10_000);
  const holderRewardFeeSol = grossSol * (hBps / 10_000);
  const creatorFeeSol = grossSol * (cBps / 10_000);
  const totalFeeSol = protocolFeeSol + holderRewardFeeSol + creatorFeeSol;
  return {
    totalFeeSol,
    protocolFeeSol,
    holderRewardFeeSol,
    creatorFeeSol,
    totalBps,
  };
}

export function quoteBuy(
  virtualSol: number,
  virtualTokens: number,
  realSol: number,
  solIn: number,
  mode: CoinMode = 'standard',
  gasTier: GasTier = 'standard',
  economics: PlatformEconomics = DEFAULT_PLATFORM_ECONOMICS
): BuyQuote {
  const { graduationTargetSol } = getCurveParams(mode);
  const gas = computeGasFee(gasTier, economics);
  const oldPriceSol = virtualSol / virtualTokens;

  if (!Number.isFinite(solIn) || solIn <= 0) {
    return {
      solIn: 0,
      gasSol: gas.totalGasSol,
      totalSolDebited: gas.totalGasSol,
      feeSol: 0,
      protocolFeeSol: 0,
      holderRewardFeeSol: 0,
      creatorFeeSol: 0,
      netSol: 0,
      tokensOut: 0,
      newVirtualSol: virtualSol,
      newVirtualTokens: virtualTokens,
      newRealSol: realSol,
      oldPriceSol,
      newPriceSol: oldPriceSol,
      newMarketCapSol: oldPriceSol * TOTAL_SUPPLY,
      priceImpactPct: 0,
      graduated: realSol >= graduationTargetSol,
    };
  }

  const k = virtualSol * virtualTokens;
  const split = computeFeeSplit(solIn, economics);
  const netSol = Math.max(0, solIn - split.totalFeeSol);

  const newVirtualSol = virtualSol + netSol;
  const newVirtualTokens = k / newVirtualSol;
  const tokensOut = Math.max(0, virtualTokens - newVirtualTokens);
  const newRealSol = realSol + netSol;
  const newPriceSol = newVirtualSol / newVirtualTokens;
  const newMarketCapSol = newPriceSol * TOTAL_SUPPLY;
  const priceImpactPct = ((newPriceSol - oldPriceSol) / oldPriceSol) * 100;

  return {
    solIn,
    gasSol: gas.totalGasSol,
    totalSolDebited: solIn + gas.totalGasSol,
    feeSol: split.totalFeeSol,
    protocolFeeSol: split.protocolFeeSol,
    holderRewardFeeSol: split.holderRewardFeeSol,
    creatorFeeSol: split.creatorFeeSol,
    netSol,
    tokensOut,
    newVirtualSol,
    newVirtualTokens,
    newRealSol,
    oldPriceSol,
    newPriceSol,
    newMarketCapSol,
    priceImpactPct,
    graduated: newRealSol >= graduationTargetSol,
  };
}

export function quoteSell(
  virtualSol: number,
  virtualTokens: number,
  realSol: number,
  tokensIn: number,
  gasTier: GasTier = 'standard',
  economics: PlatformEconomics = DEFAULT_PLATFORM_ECONOMICS
): SellQuote {
  const gas = computeGasFee(gasTier, economics);
  const oldPriceSol = virtualSol / virtualTokens;

  if (!Number.isFinite(tokensIn) || tokensIn <= 0) {
    return {
      tokensIn: 0,
      grossSolOut: 0,
      gasSol: gas.totalGasSol,
      feeSol: 0,
      protocolFeeSol: 0,
      holderRewardFeeSol: 0,
      creatorFeeSol: 0,
      netSolOut: 0,
      newVirtualSol: virtualSol,
      newVirtualTokens: virtualTokens,
      newRealSol: realSol,
      oldPriceSol,
      newPriceSol: oldPriceSol,
      newMarketCapSol: oldPriceSol * TOTAL_SUPPLY,
      priceImpactPct: 0,
    };
  }

  const k = virtualSol * virtualTokens;
  const newVirtualTokens = virtualTokens + tokensIn;
  const newVirtualSol = k / newVirtualTokens;
  const grossSolOut = Math.max(0, virtualSol - newVirtualSol);
  const split = computeFeeSplit(grossSolOut, economics);
  const netSolOut = Math.max(0, grossSolOut - split.totalFeeSol);
  const newRealSol = Math.max(0, realSol - grossSolOut);
  const newPriceSol = newVirtualSol / newVirtualTokens;
  const newMarketCapSol = newPriceSol * TOTAL_SUPPLY;
  const priceImpactPct = Math.abs(((newPriceSol - oldPriceSol) / oldPriceSol) * 100);

  return {
    tokensIn,
    grossSolOut,
    gasSol: gas.totalGasSol,
    feeSol: split.totalFeeSol,
    protocolFeeSol: split.protocolFeeSol,
    holderRewardFeeSol: split.holderRewardFeeSol,
    creatorFeeSol: split.creatorFeeSol,
    netSolOut,
    newVirtualSol,
    newVirtualTokens,
    newRealSol,
    oldPriceSol,
    newPriceSol,
    newMarketCapSol,
    priceImpactPct,
  };
}

export function getBondingProgressPct(
  realSol: number,
  mode: CoinMode = 'standard'
): number {
  const { graduationTargetSol } = getCurveParams(mode);
  return Math.min(100, Math.max(0, (realSol / graduationTargetSol) * 100));
}

export function computeLiquidationPrice(
  side: 'long' | 'short',
  entryPriceSol: number,
  leverage: number
): number {
  const marginRatio = 0.9 / Math.max(1, leverage);
  if (side === 'long') {
    return Math.max(0, entryPriceSol * (1 - marginRatio));
  }
  return entryPriceSol * (1 + marginRatio);
}

export function computeUnrealizedPnl(
  position: Pick<PerpPosition, 'side' | 'collateralSol' | 'leverage' | 'entryPriceSol'>,
  markPriceSol: number
): { pnlSol: number; roiPct: number; liquidated: boolean } {
  if (position.entryPriceSol <= 0 || markPriceSol <= 0) {
    return { pnlSol: 0, roiPct: 0, liquidated: false };
  }
  const priceMovePct = (markPriceSol - position.entryPriceSol) / position.entryPriceSol;
  const directionalMove = position.side === 'long' ? priceMovePct : -priceMovePct;
  const rawPnl = position.collateralSol * position.leverage * directionalMove;
  if (rawPnl <= -position.collateralSol * 0.95) {
    return {
      pnlSol: -position.collateralSol,
      roiPct: -100,
      liquidated: true,
    };
  }
  return {
    pnlSol: rawPnl,
    roiPct: directionalMove * position.leverage * 100,
    liquidated: false,
  };
}

export function formatSolPrice(priceSol: number): string {
  if (!Number.isFinite(priceSol) || priceSol <= 0) return '0.00000000';
  if (priceSol < 0.0001) return priceSol.toFixed(9);
  if (priceSol < 1) return priceSol.toFixed(6);
  return priceSol.toFixed(4);
}

export function formatCompactTokens(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '0';
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(2)}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(2)}K`;
  return amount.toFixed(2);
}
