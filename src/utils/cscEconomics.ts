import type { CscAsset, CscGasTier, CscPoolState } from '../types/csc';

export const CSC_CHAIN_ID = 7860;
export const CSC_NETWORK_CODE = 'CSC-1';
export const CSC_NETWORK_NAME = 'ChainScope Mainnet';

export const CSC_MAX_SUPPLY = 21_000_000;
export const CSC_MINING_ALLOCATION = 14_000_000;
export const CSC_INITIAL_LP_PER_POOL_CSC = 500_000;
export const CSC_INITIAL_LP_PER_POOL_USD = 125_000; // Initial spot price = $0.2500 / CSC
export const CSC_GENESIS_PRICE_USD = CSC_INITIAL_LP_PER_POOL_USD / CSC_INITIAL_LP_PER_POOL_CSC;

export const CSC_ENERGY_MAX = 100;
export const CSC_ENERGY_REGEN_SEC = 3;

export const CSC_REFERRAL_INVITEE_BONUS = 10;
export const CSC_REFERRAL_INVITER_BONUS = 15;
export const CSC_REFERRAL_COMMISSION_RATE = 0.05; // 5% ongoing tap commission
export const CSC_REFERRAL_BOOST_PER_USER_PCT = 10; // +10% tap power per referral
export const CSC_REFERRAL_MAX_BOOST_PCT = 150; // capped at +150%

export const CSC_SWAP_FEE_BPS = 30; // 0.30%
export const CSC_STABLE_SWAP_FEE_BPS = 5; // 0.05%

export const CSC_GAS_FEES: Record<CscGasTier, number> = {
  standard: 0.002,
  fast: 0.005,
  turbo: 0.012,
};

export const HALVING_STEP = 3_500_000; // Every 3.5M mined halves tap yield

export function getHalvingInfo(minedSupply: number): {
  era: number;
  baseTapReward: number;
  nextHalvingAt: number;
  eraProgressPct: number;
} {
  const safeMined = Math.max(0, minedSupply);
  const eraIndex = Math.min(3, Math.floor(safeMined / HALVING_STEP));
  const era = eraIndex + 1;
  const baseTapReward = Number((0.5 / Math.pow(2, eraIndex)).toFixed(6));
  const nextHalvingAt = Math.min(CSC_MINING_ALLOCATION, (eraIndex + 1) * HALVING_STEP);
  const eraFloor = eraIndex * HALVING_STEP;
  const eraSpan = Math.max(1, nextHalvingAt - eraFloor);
  const eraProgressPct = Math.min(100, Math.max(0, ((safeMined - eraFloor) / eraSpan) * 100));

  return {
    era,
    baseTapReward,
    nextHalvingAt,
    eraProgressPct,
  };
}

export function computeSyncedEnergy(
  storedEnergy: number,
  lastSyncAt: number,
  nowMs: number = Date.now()
): {
  energy: number;
  nextEnergyInSec: number;
  syncedAt: number;
} {
  const clampedStored = Math.min(CSC_ENERGY_MAX, Math.max(0, Math.floor(storedEnergy)));
  if (clampedStored >= CSC_ENERGY_MAX) {
    return { energy: CSC_ENERGY_MAX, nextEnergyInSec: 0, syncedAt: nowMs };
  }
  const elapsedMs = Math.max(0, nowMs - (lastSyncAt || nowMs));
  const regenTicks = Math.floor(elapsedMs / (CSC_ENERGY_REGEN_SEC * 1000));
  const nextEnergy = Math.min(CSC_ENERGY_MAX, clampedStored + regenTicks);
  if (nextEnergy >= CSC_ENERGY_MAX) {
    return { energy: CSC_ENERGY_MAX, nextEnergyInSec: 0, syncedAt: nowMs };
  }
  const remainderMs = elapsedMs % (CSC_ENERGY_REGEN_SEC * 1000);
  const nextEnergyInSec = Math.max(1, Math.ceil((CSC_ENERGY_REGEN_SEC * 1000 - remainderMs) / 1000));
  const syncedAt = regenTicks > 0 ? (lastSyncAt || nowMs) + regenTicks * CSC_ENERGY_REGEN_SEC * 1000 : lastSyncAt || nowMs;
  return {
    energy: nextEnergy,
    nextEnergyInSec,
    syncedAt,
  };
}

export function computeTapYield(params: {
  taps: number;
  minedSupply: number;
  rewardPoolRemaining: number;
  referralCount: number;
}): {
  perTapRewardCsc: number;
  grossMintedCsc: number;
  referralMultiplierPct: number;
  halvingEra: number;
} {
  const { era, baseTapReward } = getHalvingInfo(params.minedSupply);
  const boostPct = Math.min(
    CSC_REFERRAL_MAX_BOOST_PCT,
    Math.max(0, Math.floor(params.referralCount) * CSC_REFERRAL_BOOST_PER_USER_PCT)
  );
  const perTapRewardCsc = Number((baseTapReward * (1 + boostPct / 100)).toFixed(6));
  const rawTotal = perTapRewardCsc * Math.max(0, params.taps);
  const grossMintedCsc = Number(Math.min(Math.max(0, params.rewardPoolRemaining), rawTotal).toFixed(6));
  return {
    perTapRewardCsc,
    grossMintedCsc,
    referralMultiplierPct: boostPct,
    halvingEra: era,
  };
}

export interface CscSwapQuote {
  assetIn: CscAsset;
  assetOut: CscAsset;
  amountIn: number;
  amountOut: number;
  feeAmount: number;
  feeAsset: CscAsset;
  gasFeeCsc: number;
  burnedCsc: number;
  spotBeforeUsd: number;
  spotAfterUsd: number;
  executionPriceUsd: number;
  priceImpactPct: number;
  nextCscReserve: number;
  nextUsdReserve: number;
}

export function quoteCscSwap(params: {
  assetIn: CscAsset;
  assetOut: CscAsset;
  amountIn: number;
  usdtPool: CscPoolState;
  usd1Pool: CscPoolState;
  gasTier: CscGasTier;
}): CscSwapQuote {
  const { assetIn, assetOut, amountIn, usdtPool, usd1Pool, gasTier } = params;
  const gasFeeCsc = CSC_GAS_FEES[gasTier] ?? CSC_GAS_FEES.standard;
  const burnedCsc = Number((gasFeeCsc * 0.5).toFixed(6));

  if (!Number.isFinite(amountIn) || amountIn <= 0 || assetIn === assetOut) {
    const spot = (usdtPool.spotPriceUsd + usd1Pool.spotPriceUsd) / 2;
    return {
      assetIn,
      assetOut,
      amountIn: 0,
      amountOut: 0,
      feeAmount: 0,
      feeAsset: assetIn,
      gasFeeCsc,
      burnedCsc,
      spotBeforeUsd: spot,
      spotAfterUsd: spot,
      executionPriceUsd: spot,
      priceImpactPct: 0,
      nextCscReserve: usdtPool.cscReserve,
      nextUsdReserve: usdtPool.usdReserve,
    };
  }

  // Stablecoin bridge swap: USDT <-> USD1
  if (
    (assetIn === 'USDT' && assetOut === 'USD1') ||
    (assetIn === 'USD1' && assetOut === 'USDT')
  ) {
    const feeAmount = Number(((amountIn * CSC_STABLE_SWAP_FEE_BPS) / 10_000).toFixed(6));
    const amountOut = Number(Math.max(0, amountIn - feeAmount).toFixed(6));
    const spot = (usdtPool.spotPriceUsd + usd1Pool.spotPriceUsd) / 2;
    return {
      assetIn,
      assetOut,
      amountIn,
      amountOut,
      feeAmount,
      feeAsset: assetIn,
      gasFeeCsc,
      burnedCsc,
      spotBeforeUsd: spot,
      spotAfterUsd: spot,
      executionPriceUsd: 1,
      priceImpactPct: 0,
      nextCscReserve: usdtPool.cscReserve,
      nextUsdReserve: usdtPool.usdReserve,
    };
  }

  // Constant-product AMM swap on CSC/USDT or CSC/USD1
  const pool = assetIn === 'USD1' || assetOut === 'USD1' ? usd1Pool : usdtPool;
  const xCsc = Math.max(1, pool.cscReserve);
  const yUsd = Math.max(1, pool.usdReserve);
  const k = xCsc * yUsd;
  const spotBeforeUsd = yUsd / xCsc;

  const feeAmount = Number(((amountIn * CSC_SWAP_FEE_BPS) / 10_000).toFixed(6));
  const netIn = Math.max(0, amountIn - feeAmount);

  if (assetIn === 'CSC') {
    // Selling CSC into pool for USDT or USD1 -> increases cscReserve, reduces usdReserve -> price drops
    const nextCscReserve = xCsc + netIn;
    const nextUsdReserve = k / nextCscReserve;
    const amountOut = Number(Math.max(0, yUsd - nextUsdReserve).toFixed(6));
    // Retain 50% of protocol fee inside LP to deepen liquidity sustainably
    const lpBonusCsc = feeAmount * 0.5;
    const finalCscReserve = nextCscReserve + lpBonusCsc;
    const spotAfterUsd = nextUsdReserve / finalCscReserve;
    const executionPriceUsd = amountIn > 0 ? amountOut / amountIn : spotBeforeUsd;
    const priceImpactPct =
      spotBeforeUsd > 0 ? Math.abs(((spotAfterUsd - spotBeforeUsd) / spotBeforeUsd) * 100) : 0;

    return {
      assetIn,
      assetOut,
      amountIn,
      amountOut,
      feeAmount,
      feeAsset: 'CSC',
      gasFeeCsc,
      burnedCsc,
      spotBeforeUsd,
      spotAfterUsd,
      executionPriceUsd,
      priceImpactPct,
      nextCscReserve: finalCscReserve,
      nextUsdReserve,
    };
  } else {
    // Buying CSC with USDT or USD1 -> increases usdReserve, reduces cscReserve -> price rises
    const nextUsdReserve = yUsd + netIn;
    const nextCscReserve = k / nextUsdReserve;
    const amountOut = Number(Math.max(0, xCsc - nextCscReserve).toFixed(6));
    const lpBonusUsd = feeAmount * 0.5;
    const finalUsdReserve = nextUsdReserve + lpBonusUsd;
    const spotAfterUsd = finalUsdReserve / nextCscReserve;
    const executionPriceUsd = amountOut > 0 ? amountIn / amountOut : spotBeforeUsd;
    const priceImpactPct =
      spotBeforeUsd > 0 ? Math.abs(((spotAfterUsd - spotBeforeUsd) / spotBeforeUsd) * 100) : 0;

    return {
      assetIn,
      assetOut,
      amountIn,
      amountOut,
      feeAmount,
      feeAsset: assetIn,
      gasFeeCsc,
      burnedCsc,
      spotBeforeUsd,
      spotAfterUsd,
      executionPriceUsd,
      priceImpactPct,
      nextCscReserve,
      nextUsdReserve: finalUsdReserve,
    };
  }
}

export function formatCscAmount(val: number, decimals = 4): string {
  if (!Number.isFinite(val)) return '0';
  if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (Math.abs(val) >= 10_000) return `${(val / 1_000).toFixed(2)}K`;
  return val.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

export function formatCscUsdPrice(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return '$0.0000';
  if (price >= 1) return `$${price.toFixed(4)}`;
  if (price >= 0.01) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(6)}`;
}
