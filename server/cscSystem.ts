import crypto from 'crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import bs58 from 'bs58';
import { ethers } from 'ethers';
import type {
  CscAsset,
  CscGasTier,
  CscLeaderboardEntry,
  CscNetworkStats,
  CscOverviewResponse,
  CscPoolState,
  CscPricePoint,
  CscReferralMember,
  CscTransaction,
  CscUserAccount,
  CscWallet,
} from '../src/types/csc';
import {
  computeSyncedEnergy,
  computeTapYield,
  CSC_CHAIN_ID,
  CSC_ENERGY_MAX,
  CSC_ENERGY_REGEN_SEC,
  CSC_GAS_FEES,
  CSC_GENESIS_PRICE_USD,
  CSC_INITIAL_LP_PER_POOL_CSC,
  CSC_INITIAL_LP_PER_POOL_USD,
  CSC_MAX_SUPPLY,
  CSC_MINING_ALLOCATION,
  CSC_NETWORK_CODE,
  CSC_NETWORK_NAME,
  CSC_REFERRAL_COMMISSION_RATE,
  CSC_REFERRAL_INVITEE_BONUS,
  CSC_REFERRAL_INVITER_BONUS,
  getHalvingInfo,
  quoteCscSwap,
} from '../src/utils/cscEconomics';

export interface CscAuthUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export interface CscAuthedRequest extends Request {
  authUser?: CscAuthUser;
}

export interface CscRouteDeps {
  getSupabaseAdminClient: () => SupabaseClient | null;
  requireAuth: (req: CscAuthedRequest, res: Response, next: NextFunction) => Promise<void> | void;
  tryParseAuthUser: (req: Request) => Promise<CscAuthUser | null>;
  getSolUsdPrice: () => Promise<number>;
}

interface CscNetworkInternal {
  id: string;
  chainId: number;
  blockHeight: number;
  minedSupply: number;
  rewardPoolRemaining: number;
  burnedSupply: number;
  usdtPoolCsc: number;
  usdtPoolUsd: number;
  usdtVolumeUsd: number;
  usdtFeesUsd: number;
  usdtSwapCount: number;
  usd1PoolCsc: number;
  usd1PoolUsd: number;
  usd1VolumeUsd: number;
  usd1FeesUsd: number;
  usd1SwapCount: number;
  totalTxCount: number;
  totalTaps: number;
  priceHistory: CscPricePoint[];
  updatedAt: number;
}

interface CscAccountInternal {
  uid: string;
  handle: string;
  referralCode: string;
  referredByUid: string;
  referredByCode: string;
  referralCount: number;
  referralBonusCsc: number;
  energy: number;
  lastEnergySyncAt: number;
  totalTaps: number;
  totalMinedCsc: number;
  totalGasPaidCsc: number;
  primaryWalletId: string;
  createdAt: number;
  updatedAt: number;
}

interface StoredCscLedger {
  network: CscNetworkInternal;
  accounts: Record<string, CscAccountInternal>;
  wallets: Record<string, CscWallet>;
  transactions: CscTransaction[];
}

const SNAPSHOT_LEDGER_ID = 'csc_network_ledger_v1';
const MAX_HISTORY_POINTS = 140;
const MAX_TX_LOG = 250;
const GENESIS_GAS_STIPEND_CSC = 0.05;

let ledgerQueue: Promise<unknown> = Promise.resolve();

function withLedgerLock<T>(task: () => Promise<T>): Promise<T> {
  const next = ledgerQueue.then(task, task);
  ledgerQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function makeTxHash(seed: string): string {
  const raw = `${seed}:${Date.now()}:${crypto.randomBytes(16).toString('hex')}`;
  return `0x${crypto.createHash('sha256').update(raw).digest('hex')}`;
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function makeDeterministicGenesisKeys(uid: string): { address: string; evmAddress: string } {
  const pubSeed = crypto.createHash('sha256').update(`CSC-1:PUB:${uid}`).digest();
  const address = `CSC1${bs58.encode(pubSeed)}`;
  const evmSeed = crypto.createHash('sha256').update(`CSC-1:EVM:${uid}`).digest().subarray(0, 20);
  const evmAddress = ethers.getAddress(`0x${evmSeed.toString('hex')}`);
  return { address, evmAddress };
}

function makeReferralCode(uid: string, handle: string): string {
  const cleanHandle = handle.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 4) || 'USER';
  const digest = crypto
    .createHash('sha256')
    .update(`CSC-REF:${uid}`)
    .digest('hex')
    .slice(0, 4)
    .toUpperCase();
  return `CSC-${cleanHandle}${digest}`;
}

function buildDefaultLedger(): StoredCscLedger {
  const now = Date.now();
  return {
    network: {
      id: 'mainnet',
      chainId: CSC_CHAIN_ID,
      blockHeight: 1000,
      minedSupply: 0,
      rewardPoolRemaining: CSC_MINING_ALLOCATION,
      burnedSupply: 0,
      usdtPoolCsc: CSC_INITIAL_LP_PER_POOL_CSC,
      usdtPoolUsd: CSC_INITIAL_LP_PER_POOL_USD,
      usdtVolumeUsd: 0,
      usdtFeesUsd: 0,
      usdtSwapCount: 0,
      usd1PoolCsc: CSC_INITIAL_LP_PER_POOL_CSC,
      usd1PoolUsd: CSC_INITIAL_LP_PER_POOL_USD,
      usd1VolumeUsd: 0,
      usd1FeesUsd: 0,
      usd1SwapCount: 0,
      totalTxCount: 0,
      totalTaps: 0,
      priceHistory: [
        {
          ts: now - 3600_000,
          blockHeight: 1000,
          priceUsd: CSC_GENESIS_PRICE_USD,
          volumeUsd: 0,
          event: 'genesis',
        },
      ],
      updatedAt: now,
    },
    accounts: {},
    wallets: {},
    transactions: [],
  };
}

function isMissingRelationError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return (
    err.code === '42P01' ||
    err.code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('schema cache') ||
    msg.includes('could not find the table')
  );
}

async function detectNormalizedCscTables(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await supabase
    .from('chainscope_csc_network')
    .select('id', { count: 'exact', head: true });
  return !isMissingRelationError(error);
}

function toMs(val: unknown): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }
  return Date.now();
}

async function loadLedgerFromSupabase(
  supabase: SupabaseClient
): Promise<{ ledger: StoredCscLedger; storageMode: 'normalized' | 'snapshot_ledger' }> {
  const hasNormalized = await detectNormalizedCscTables(supabase);

  if (hasNormalized) {
    const [netRes, accRes, walRes, txRes] = await Promise.all([
      supabase.from('chainscope_csc_network').select('*').eq('id', 'mainnet').maybeSingle(),
      supabase.from('chainscope_csc_accounts').select('*'),
      supabase.from('chainscope_csc_wallets').select('*'),
      supabase
        .from('chainscope_csc_transactions')
        .select('*')
        .order('block_height', { ascending: false })
        .limit(MAX_TX_LOG),
    ]);

    if (!netRes.error && !accRes.error && !walRes.error && !txRes.error) {
      const defaults = buildDefaultLedger();
      const nr = netRes.data as Record<string, unknown> | null;
      const network: CscNetworkInternal = nr
        ? {
            id: 'mainnet',
            chainId: Number(nr.chain_id ?? CSC_CHAIN_ID),
            blockHeight: Number(nr.block_height ?? 1000),
            minedSupply: Number(nr.mined_supply ?? 0),
            rewardPoolRemaining: Number(nr.reward_pool_remaining ?? CSC_MINING_ALLOCATION),
            burnedSupply: Number(nr.burned_supply ?? 0),
            usdtPoolCsc: Number(nr.usdt_pool_csc ?? CSC_INITIAL_LP_PER_POOL_CSC),
            usdtPoolUsd: Number(nr.usdt_pool_usd ?? CSC_INITIAL_LP_PER_POOL_USD),
            usdtVolumeUsd: Number(nr.usdt_volume_usd ?? 0),
            usdtFeesUsd: 0,
            usdtSwapCount: 0,
            usd1PoolCsc: Number(nr.usd1_pool_csc ?? CSC_INITIAL_LP_PER_POOL_CSC),
            usd1PoolUsd: Number(nr.usd1_pool_usd ?? CSC_INITIAL_LP_PER_POOL_USD),
            usd1VolumeUsd: Number(nr.usd1_volume_usd ?? 0),
            usd1FeesUsd: 0,
            usd1SwapCount: 0,
            totalTxCount: Number(nr.total_tx_count ?? 0),
            totalTaps: Number(nr.total_taps ?? 0),
            priceHistory: Array.isArray(nr.price_history)
              ? (nr.price_history as CscPricePoint[])
              : defaults.network.priceHistory,
            updatedAt: toMs(nr.updated_at),
          }
        : defaults.network;

      const accounts: Record<string, CscAccountInternal> = {};
      for (const row of (accRes.data || []) as Array<Record<string, unknown>>) {
        const uid = String(row.uid || '');
        if (!uid) continue;
        accounts[uid] = {
          uid,
          handle: String(row.handle || ''),
          referralCode: String(row.referral_code || makeReferralCode(uid, String(row.handle || ''))),
          referredByUid: String(row.referred_by_uid || ''),
          referredByCode: String(row.referred_by_code || ''),
          referralCount: Number(row.referral_count ?? 0),
          referralBonusCsc: Number(row.referral_bonus_csc ?? 0),
          energy: Number(row.energy ?? CSC_ENERGY_MAX),
          lastEnergySyncAt: toMs(row.last_energy_sync_at),
          totalTaps: Number(row.total_taps ?? 0),
          totalMinedCsc: Number(row.total_mined_csc ?? 0),
          totalGasPaidCsc: Number(row.total_gas_paid_csc ?? 0),
          primaryWalletId: String(row.primary_wallet_id || ''),
          createdAt: toMs(row.updated_at),
          updatedAt: toMs(row.updated_at),
        };
      }

      const wallets: Record<string, CscWallet> = {};
      for (const row of (walRes.data || []) as Array<Record<string, unknown>>) {
        const id = String(row.id || '');
        if (!id) continue;
        wallets[id] = {
          id,
          ownerUid: String(row.owner_uid || ''),
          ownerHandle: String(row.owner_handle || ''),
          label: String(row.label || 'CSC Wallet'),
          address: String(row.address || ''),
          evmAddress: String(row.evm_address || ''),
          origin:
            row.origin === 'created' || row.origin === 'imported'
              ? row.origin
              : 'genesis',
          isPrimary: Boolean(row.is_primary),
          cscBalance: Number(row.csc_balance ?? 0),
          usdtBalance: Number(row.usdt_balance ?? 0),
          usd1Balance: Number(row.usd1_balance ?? 0),
          nonce: Number(row.nonce ?? 0),
          createdAt: toMs(row.created_at),
          updatedAt: toMs(row.updated_at),
          lastSyncedAt: toMs(row.last_synced_at),
        };
      }

      const transactions: CscTransaction[] = ((txRes.data || []) as Array<Record<string, unknown>>).map(
        (row) => ({
          id: String(row.id || ''),
          txHash: String(row.tx_hash || ''),
          blockHeight: Number(row.block_height ?? 1000),
          type: String(row.tx_type || 'tap_mint') as CscTransaction['type'],
          fromAddress: String(row.from_address || ''),
          toAddress: String(row.to_address || ''),
          fromLabel: String(row.from_label || ''),
          toLabel: String(row.to_label || ''),
          assetIn: String(row.asset_in || 'CSC') as CscTransaction['assetIn'],
          amountIn: Number(row.amount_in ?? 0),
          assetOut: String(row.asset_out || 'CSC') as CscAsset,
          amountOut: Number(row.amount_out ?? 0),
          gasFeeCsc: Number(row.gas_fee_csc ?? 0),
          burnedCsc: Number(row.burned_csc ?? 0),
          priceUsdAtTx: Number(row.price_usd_at_tx ?? CSC_GENESIS_PRICE_USD),
          note: String(row.note || ''),
          actorUid: String(row.actor_uid || ''),
          actorHandle: String(row.actor_handle || ''),
          createdAt: toMs(row.created_at),
        })
      );

      return {
        ledger: { network, accounts, wallets, transactions },
        storageMode: 'normalized',
      };
    }
  }

  // Fallback / default resilient mode: stored in chainscope_wallet_snapshots.chains JSONB
  const { data, error } = await supabase
    .from('chainscope_wallet_snapshots')
    .select('chains')
    .eq('id', SNAPSHOT_LEDGER_ID)
    .maybeSingle();

  if (error && !isMissingRelationError(error)) {
    throw new Error(error.message || 'Unable to load ChainScope CSC ledger from Supabase');
  }

  const rawChains = (data?.chains || null) as Partial<StoredCscLedger> | null;
  if (rawChains && rawChains.network && rawChains.accounts && rawChains.wallets) {
    return {
      ledger: {
        network: rawChains.network,
        accounts: rawChains.accounts,
        wallets: rawChains.wallets,
        transactions: Array.isArray(rawChains.transactions) ? rawChains.transactions : [],
      },
      storageMode: 'snapshot_ledger',
    };
  }

  const fresh = buildDefaultLedger();
  await saveLedgerToSupabase(supabase, fresh, 'snapshot_ledger');
  return { ledger: fresh, storageMode: 'snapshot_ledger' };
}

async function saveLedgerToSupabase(
  supabase: SupabaseClient,
  ledger: StoredCscLedger,
  storageMode: 'normalized' | 'snapshot_ledger',
  dirtyAccountUids?: string[],
  dirtyWalletIds?: string[],
  newTransactions?: CscTransaction[]
): Promise<void> {
  if (storageMode === 'normalized') {
    const netRow = {
      id: 'mainnet',
      chain_id: ledger.network.chainId,
      block_height: ledger.network.blockHeight,
      mined_supply: ledger.network.minedSupply,
      reward_pool_remaining: ledger.network.rewardPoolRemaining,
      burned_supply: ledger.network.burnedSupply,
      usdt_pool_csc: ledger.network.usdtPoolCsc,
      usdt_pool_usd: ledger.network.usdtPoolUsd,
      usdt_volume_usd: ledger.network.usdtVolumeUsd,
      usd1_pool_csc: ledger.network.usd1PoolCsc,
      usd1_pool_usd: ledger.network.usd1PoolUsd,
      usd1_volume_usd: ledger.network.usd1VolumeUsd,
      total_tx_count: ledger.network.totalTxCount,
      total_taps: ledger.network.totalTaps,
      price_history: ledger.network.priceHistory.slice(-MAX_HISTORY_POINTS),
      updated_at: new Date(ledger.network.updatedAt).toISOString(),
    };
    const { error: netErr } = await supabase
      .from('chainscope_csc_network')
      .upsert(netRow, { onConflict: 'id' });
    if (netErr) throw new Error(netErr.message);

    const accIds = dirtyAccountUids ?? Object.keys(ledger.accounts);
    if (accIds.length > 0) {
      const accRows = accIds
        .map((uid) => ledger.accounts[uid])
        .filter(Boolean)
        .map((a) => ({
          uid: a.uid,
          handle: a.handle,
          referral_code: a.referralCode,
          referred_by_uid: a.referredByUid,
          referred_by_code: a.referredByCode,
          referral_count: a.referralCount,
          referral_bonus_csc: a.referralBonusCsc,
          energy: a.energy,
          last_energy_sync_at: new Date(a.lastEnergySyncAt).toISOString(),
          total_taps: a.totalTaps,
          total_mined_csc: a.totalMinedCsc,
          total_gas_paid_csc: a.totalGasPaidCsc,
          primary_wallet_id: a.primaryWalletId,
          updated_at: new Date(a.updatedAt).toISOString(),
        }));
      if (accRows.length > 0) {
        const { error: accErr } = await supabase
          .from('chainscope_csc_accounts')
          .upsert(accRows, { onConflict: 'uid' });
        if (accErr) throw new Error(accErr.message);
      }
    }

    const walIds = dirtyWalletIds ?? Object.keys(ledger.wallets);
    if (walIds.length > 0) {
      const walRows = walIds
        .map((id) => ledger.wallets[id])
        .filter(Boolean)
        .map((w) => ({
          id: w.id,
          owner_uid: w.ownerUid,
          owner_handle: w.ownerHandle,
          label: w.label,
          address: w.address,
          evm_address: w.evmAddress,
          origin: w.origin,
          is_primary: w.isPrimary,
          csc_balance: w.cscBalance,
          usdt_balance: w.usdtBalance,
          usd1_balance: w.usd1Balance,
          nonce: w.nonce,
          created_at: new Date(w.createdAt).toISOString(),
          updated_at: new Date(w.updatedAt).toISOString(),
          last_synced_at: new Date(w.lastSyncedAt).toISOString(),
        }));
      if (walRows.length > 0) {
        const { error: walErr } = await supabase
          .from('chainscope_csc_wallets')
          .upsert(walRows, { onConflict: 'id' });
        if (walErr) throw new Error(walErr.message);
      }
    }

    if (newTransactions && newTransactions.length > 0) {
      const txRows = newTransactions.map((t) => ({
        id: t.id,
        tx_hash: t.txHash,
        block_height: t.blockHeight,
        tx_type: t.type,
        from_address: t.fromAddress,
        to_address: t.toAddress,
        from_label: t.fromLabel,
        to_label: t.toLabel,
        asset_in: t.assetIn,
        amount_in: t.amountIn,
        asset_out: t.assetOut,
        amount_out: t.amountOut,
        gas_fee_csc: t.gasFeeCsc,
        burned_csc: t.burnedCsc,
        price_usd_at_tx: t.priceUsdAtTx,
        note: t.note,
        actor_uid: t.actorUid,
        actor_handle: t.actorHandle,
        created_at: new Date(t.createdAt).toISOString(),
      }));
      const { error: txErr } = await supabase
        .from('chainscope_csc_transactions')
        .upsert(txRows, { onConflict: 'id' });
      if (txErr) throw new Error(txErr.message);
    }
    return;
  }

  const trimmedLedger: StoredCscLedger = {
    ...ledger,
    network: {
      ...ledger.network,
      priceHistory: ledger.network.priceHistory.slice(-MAX_HISTORY_POINTS),
    },
    transactions: ledger.transactions.slice(0, MAX_TX_LOG),
  };

  const spot = buildNetworkStats(trimmedLedger).spotPriceUsd;
  const { error } = await supabase.from('chainscope_wallet_snapshots').upsert(
    {
      id: SNAPSHOT_LEDGER_ID,
      wallet_id: 'chainscope_mainnet',
      label: 'ChainScope CSC-1 Network Ledger',
      evm_address: '',
      solana_address: '',
      total_usd: Number((trimmedLedger.network.minedSupply * spot).toFixed(4)),
      chains: trimmedLedger,
      scanned_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );
  if (error) {
    throw new Error(error.message || 'Unable to persist ChainScope CSC ledger to Supabase');
  }
}

function buildPools(net: CscNetworkInternal): { usdtPool: CscPoolState; usd1Pool: CscPoolState } {
  const usdtSpot = net.usdtPoolUsd / Math.max(1, net.usdtPoolCsc);
  const usd1Spot = net.usd1PoolUsd / Math.max(1, net.usd1PoolCsc);
  return {
    usdtPool: {
      id: 'CSC_USDT',
      quoteAsset: 'USDT',
      cscReserve: Number(net.usdtPoolCsc.toFixed(6)),
      usdReserve: Number(net.usdtPoolUsd.toFixed(6)),
      spotPriceUsd: Number(usdtSpot.toFixed(6)),
      volumeUsd: Number(net.usdtVolumeUsd.toFixed(4)),
      feesCollectedUsd: Number(net.usdtFeesUsd.toFixed(4)),
      swapCount: net.usdtSwapCount,
    },
    usd1Pool: {
      id: 'CSC_USD1',
      quoteAsset: 'USD1',
      cscReserve: Number(net.usd1PoolCsc.toFixed(6)),
      usdReserve: Number(net.usd1PoolUsd.toFixed(6)),
      spotPriceUsd: Number(usd1Spot.toFixed(6)),
      volumeUsd: Number(net.usd1VolumeUsd.toFixed(4)),
      feesCollectedUsd: Number(net.usd1FeesUsd.toFixed(4)),
      swapCount: net.usd1SwapCount,
    },
  };
}

function buildNetworkStats(ledger: StoredCscLedger): CscNetworkStats {
  const net = ledger.network;
  const { usdtPool, usd1Pool } = buildPools(net);
  const spotPriceUsd = Number(((usdtPool.spotPriceUsd + usd1Pool.spotPriceUsd) / 2).toFixed(6));
  const { era, baseTapReward, nextHalvingAt } = getHalvingInfo(net.minedSupply);

  const allWalletCsc = Object.values(ledger.wallets).reduce((s, w) => s + w.cscBalance, 0);
  const circulatingSupply = Number(
    Math.max(0, allWalletCsc + Math.max(0, CSC_INITIAL_LP_PER_POOL_CSC * 2 - (net.usdtPoolCsc + net.usd1PoolCsc))).toFixed(4)
  );
  const effectiveSupply = Math.max(allWalletCsc, net.minedSupply - net.burnedSupply);
  const marketCapUsd = Number((Math.max(1, effectiveSupply) * spotPriceUsd).toFixed(2));
  const priceChangePct = Number(
    (((spotPriceUsd - CSC_GENESIS_PRICE_USD) / CSC_GENESIS_PRICE_USD) * 100).toFixed(2)
  );

  return {
    chainId: net.chainId || CSC_CHAIN_ID,
    networkCode: CSC_NETWORK_CODE,
    networkName: CSC_NETWORK_NAME,
    blockHeight: net.blockHeight,
    maxSupply: CSC_MAX_SUPPLY,
    miningAllocation: CSC_MINING_ALLOCATION,
    minedSupply: Number(net.minedSupply.toFixed(6)),
    rewardPoolRemaining: Number(net.rewardPoolRemaining.toFixed(6)),
    burnedSupply: Number(net.burnedSupply.toFixed(6)),
    circulatingSupply: Number(Math.max(circulatingSupply, effectiveSupply).toFixed(6)),
    halvingEra: era,
    tapBaseReward: baseTapReward,
    nextHalvingAt,
    spotPriceUsd,
    genesisPriceUsd: CSC_GENESIS_PRICE_USD,
    priceChangePct,
    marketCapUsd,
    totalVolumeUsd: Number((net.usdtVolumeUsd + net.usd1VolumeUsd).toFixed(2)),
    totalTxCount: net.totalTxCount,
    totalTaps: net.totalTaps,
    usdtPool,
    usd1Pool,
    gasFees: CSC_GAS_FEES,
    priceHistory: net.priceHistory.slice(-MAX_HISTORY_POINTS),
    updatedAt: net.updatedAt,
  };
}

function appendPricePoint(
  net: CscNetworkInternal,
  volumeUsd: number,
  event: CscPricePoint['event']
) {
  const { usdtPool, usd1Pool } = buildPools(net);
  const priceUsd = Number(((usdtPool.spotPriceUsd + usd1Pool.spotPriceUsd) / 2).toFixed(6));
  net.priceHistory.push({
    ts: Date.now(),
    blockHeight: net.blockHeight,
    priceUsd,
    volumeUsd: Number(volumeUsd.toFixed(2)),
    event,
  });
  if (net.priceHistory.length > MAX_HISTORY_POINTS) {
    net.priceHistory = net.priceHistory.slice(-MAX_HISTORY_POINTS);
  }
}

async function resolveUserHandle(
  supabase: SupabaseClient,
  authUser: CscAuthUser
): Promise<string> {
  const { data } = await supabase
    .from('chainscope_users')
    .select('handle')
    .eq('uid', authUser.uid)
    .maybeSingle();
  if (data?.handle) return String(data.handle);
  const raw =
    authUser.name || authUser.email?.split('@')[0] || `miner_${authUser.uid.slice(0, 6)}`;
  return raw.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 24) || `miner_${authUser.uid.slice(0, 6)}`;
}

async function ensureUserProvisioned(
  supabase: SupabaseClient,
  ledger: StoredCscLedger,
  authUser: CscAuthUser
): Promise<{
  account: CscAccountInternal;
  changed: boolean;
  dirtyAccountUids: string[];
  dirtyWalletIds: string[];
  newTransactions: CscTransaction[];
}> {
  const now = Date.now();
  const handle = await resolveUserHandle(supabase, authUser);
  let changed = false;
  const dirtyAccountUids: string[] = [];
  const dirtyWalletIds: string[] = [];
  const newTransactions: CscTransaction[] = [];

  let account = ledger.accounts[authUser.uid];
  if (!account) {
    const keys = makeDeterministicGenesisKeys(authUser.uid);
    const walletId = makeId('cscw');
    const stipend = Math.min(GENESIS_GAS_STIPEND_CSC, ledger.network.rewardPoolRemaining);

    ledger.network.minedSupply = Number((ledger.network.minedSupply + stipend).toFixed(6));
    ledger.network.rewardPoolRemaining = Number(
      Math.max(0, ledger.network.rewardPoolRemaining - stipend).toFixed(6)
    );
    ledger.network.blockHeight += 1;
    ledger.network.totalTxCount += 1;
    ledger.network.updatedAt = now;

    const genesisWallet: CscWallet = {
      id: walletId,
      ownerUid: authUser.uid,
      ownerHandle: handle,
      label: 'Primary CSC Wallet',
      address: keys.address,
      evmAddress: keys.evmAddress,
      origin: 'genesis',
      isPrimary: true,
      cscBalance: stipend,
      usdtBalance: 0,
      usd1Balance: 0,
      nonce: 0,
      createdAt: now,
      updatedAt: now,
      lastSyncedAt: now,
    };
    ledger.wallets[walletId] = genesisWallet;
    dirtyWalletIds.push(walletId);

    account = {
      uid: authUser.uid,
      handle,
      referralCode: makeReferralCode(authUser.uid, handle),
      referredByUid: '',
      referredByCode: '',
      referralCount: 0,
      referralBonusCsc: 0,
      energy: CSC_ENERGY_MAX,
      lastEnergySyncAt: now,
      totalTaps: 0,
      totalMinedCsc: stipend,
      totalGasPaidCsc: 0,
      primaryWalletId: walletId,
      createdAt: now,
      updatedAt: now,
    };
    ledger.accounts[authUser.uid] = account;
    dirtyAccountUids.push(authUser.uid);

    const netStats = buildNetworkStats(ledger);
    const tx: CscTransaction = {
      id: makeId('csctx'),
      txHash: makeTxHash(`${authUser.uid}:genesis`),
      blockHeight: ledger.network.blockHeight,
      type: 'tap_mint',
      fromAddress: 'CSC1_GENESIS_GAS_RESERVE',
      toAddress: genesisWallet.address,
      fromLabel: 'CSC-1 Genesis Stipend',
      toLabel: `${handle} (${genesisWallet.label})`,
      assetIn: 'CSC',
      amountIn: stipend,
      assetOut: 'CSC',
      amountOut: stipend,
      gasFeeCsc: 0,
      burnedCsc: 0,
      priceUsdAtTx: netStats.spotPriceUsd,
      note: 'Starter gas allocation for ChainScope wallet activation',
      actorUid: authUser.uid,
      actorHandle: handle,
      createdAt: now,
    };
    ledger.transactions.unshift(tx);
    newTransactions.push(tx);
    changed = true;
  } else {
    if (account.handle !== handle) {
      account.handle = handle;
      account.updatedAt = now;
      dirtyAccountUids.push(account.uid);
      changed = true;
    }
    const synced = computeSyncedEnergy(account.energy, account.lastEnergySyncAt, now);
    if (synced.energy !== account.energy) {
      account.energy = synced.energy;
      account.lastEnergySyncAt = synced.syncedAt;
      account.updatedAt = now;
      if (!dirtyAccountUids.includes(account.uid)) dirtyAccountUids.push(account.uid);
      changed = true;
    }
    const userWallets = Object.values(ledger.wallets).filter((w) => w.ownerUid === authUser.uid);
    if (userWallets.length > 0 && !ledger.wallets[account.primaryWalletId]) {
      userWallets[0].isPrimary = true;
      account.primaryWalletId = userWallets[0].id;
      dirtyWalletIds.push(userWallets[0].id);
      if (!dirtyAccountUids.includes(account.uid)) dirtyAccountUids.push(account.uid);
      changed = true;
    }
  }

  return { account, changed, dirtyAccountUids, dirtyWalletIds, newTransactions };
}

function buildAccountDto(account: CscAccountInternal): CscUserAccount {
  const synced = computeSyncedEnergy(account.energy, account.lastEnergySyncAt, Date.now());
  const yieldPreview = computeTapYield({
    taps: 1,
    minedSupply: 0,
    rewardPoolRemaining: CSC_MINING_ALLOCATION,
    referralCount: account.referralCount,
  });
  return {
    uid: account.uid,
    handle: account.handle,
    referralCode: account.referralCode,
    referredByUid: account.referredByUid,
    referredByCode: account.referredByCode,
    referralCount: account.referralCount,
    referralBonusCsc: Number(account.referralBonusCsc.toFixed(6)),
    referralMultiplierPct: yieldPreview.referralMultiplierPct,
    energy: synced.energy,
    maxEnergy: CSC_ENERGY_MAX,
    energyRegenSec: CSC_ENERGY_REGEN_SEC,
    nextEnergyInSec: synced.nextEnergyInSec,
    lastEnergySyncAt: synced.syncedAt,
    totalTaps: account.totalTaps,
    totalMinedCsc: Number(account.totalMinedCsc.toFixed(6)),
    totalGasPaidCsc: Number(account.totalGasPaidCsc.toFixed(6)),
    primaryWalletId: account.primaryWalletId,
  };
}

function buildOverviewResponse(
  ledger: StoredCscLedger,
  storageMode: 'normalized' | 'snapshot_ledger',
  uid: string | null,
  solUsdPrice: number
): CscOverviewResponse {
  const network = buildNetworkStats(ledger);
  const account = uid && ledger.accounts[uid] ? buildAccountDto(ledger.accounts[uid]) : null;
  const wallets = uid
    ? Object.values(ledger.wallets)
        .filter((w) => w.ownerUid === uid)
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.createdAt - b.createdAt)
    : [];

  const referrals: CscReferralMember[] = uid
    ? Object.values(ledger.accounts)
        .filter((a) => a.referredByUid === uid)
        .map((a) => ({
          uid: a.uid,
          handle: a.handle,
          joinedAt: a.createdAt,
          totalTaps: a.totalTaps,
          commissionEarnedCsc: Number(
            (a.totalMinedCsc * CSC_REFERRAL_COMMISSION_RATE).toFixed(4)
          ),
        }))
        .sort((a, b) => b.joinedAt - a.joinedAt)
    : [];

  const walletCscByUid = new Map<string, number>();
  for (const w of Object.values(ledger.wallets)) {
    walletCscByUid.set(w.ownerUid, (walletCscByUid.get(w.ownerUid) || 0) + w.cscBalance);
  }

  const leaderboard: CscLeaderboardEntry[] = Object.values(ledger.accounts)
    .map((a) => ({
      uid: a.uid,
      handle: a.handle,
      totalMinedCsc: Number(a.totalMinedCsc.toFixed(4)),
      referralCount: a.referralCount,
      totalCscHeld: Number((walletCscByUid.get(a.uid) || 0).toFixed(4)),
    }))
    .sort((a, b) => b.totalCscHeld - a.totalCscHeld || b.totalMinedCsc - a.totalMinedCsc)
    .slice(0, 20);

  return {
    network,
    account,
    wallets,
    transactions: ledger.transactions.slice(0, 80),
    referrals,
    leaderboard,
    storageMode,
    solUsdPrice,
  };
}

function isValidCscAddressServer(addr: string): boolean {
  const clean = addr.trim();
  if (/^CSC1[1-9A-HJ-NP-Za-km-z]{30,48}$/.test(clean)) return true;
  return ethers.isAddress(clean);
}

function normalizeGasTier(tier: unknown): CscGasTier {
  if (tier === 'fast' || tier === 'turbo') return tier;
  return 'standard';
}

export function registerCscRoutes(app: Express, deps: CscRouteDeps) {
  const { getSupabaseAdminClient, requireAuth, tryParseAuthUser, getSolUsdPrice } = deps;

  // 1. Overview (public network state + authenticated user wallets/account/referrals)
  app.get('/api/db/csc/overview', async (req, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase is not configured.' });
      return;
    }

    try {
      const [authUser, solUsd] = await Promise.all([tryParseAuthUser(req), getSolUsdPrice()]);
      const overview = await withLedgerLock(async () => {
        const { ledger, storageMode } = await loadLedgerFromSupabase(supabase);
        if (authUser) {
          const prov = await ensureUserProvisioned(supabase, ledger, authUser);
          if (prov.changed) {
            await saveLedgerToSupabase(
              supabase,
              ledger,
              storageMode,
              prov.dirtyAccountUids,
              prov.dirtyWalletIds,
              prov.newTransactions
            );
          }
        }
        return buildOverviewResponse(ledger, storageMode, authUser?.uid || null, solUsd);
      });
      res.json(overview);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to load ChainScope Coin state',
      });
    }
  });

  // 2. Create / Import / Manage User ChainScope Wallets
  app.post('/api/db/csc/wallets', requireAuth, async (req: CscAuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase is not configured.' });
      return;
    }

    const body = (req.body || {}) as {
      action?: 'create' | 'set_primary' | 'rename';
      walletId?: string;
      label?: string;
      address?: string;
      evmAddress?: string;
      origin?: 'created' | 'imported';
      setPrimary?: boolean;
    };

    try {
      const solUsd = await getSolUsdPrice();
      const result = await withLedgerLock(async () => {
        const { ledger, storageMode } = await loadLedgerFromSupabase(supabase);
        const prov = await ensureUserProvisioned(supabase, ledger, req.authUser!);
        const account = prov.account;
        const now = Date.now();
        const dirtyAccounts = new Set(prov.dirtyAccountUids);
        const dirtyWallets = new Set(prov.dirtyWalletIds);

        if (body.action === 'set_primary') {
          const target = body.walletId ? ledger.wallets[body.walletId] : null;
          if (!target || target.ownerUid !== req.authUser!.uid) {
            throw new Error('Wallet not found in your ChainScope account.');
          }
          for (const w of Object.values(ledger.wallets)) {
            if (w.ownerUid === req.authUser!.uid) {
              const nextPrimary = w.id === target.id;
              if (w.isPrimary !== nextPrimary) {
                w.isPrimary = nextPrimary;
                w.updatedAt = now;
                dirtyWallets.add(w.id);
              }
            }
          }
          account.primaryWalletId = target.id;
          account.updatedAt = now;
          dirtyAccounts.add(account.uid);
          await saveLedgerToSupabase(
            supabase,
            ledger,
            storageMode,
            Array.from(dirtyAccounts),
            Array.from(dirtyWallets),
            prov.newTransactions
          );
          return buildOverviewResponse(ledger, storageMode, req.authUser!.uid, solUsd);
        }

        if (body.action === 'rename') {
          const target = body.walletId ? ledger.wallets[body.walletId] : null;
          if (!target || target.ownerUid !== req.authUser!.uid) {
            throw new Error('Wallet not found in your ChainScope account.');
          }
          const cleanLabel = String(body.label || '').trim().slice(0, 32);
          if (cleanLabel.length < 2) throw new Error('Wallet label must be at least 2 characters.');
          target.label = cleanLabel;
          target.updatedAt = now;
          dirtyWallets.add(target.id);
          await saveLedgerToSupabase(
            supabase,
            ledger,
            storageMode,
            Array.from(dirtyAccounts),
            Array.from(dirtyWallets),
            prov.newTransactions
          );
          return buildOverviewResponse(ledger, storageMode, req.authUser!.uid, solUsd);
        }

        // Create or import wallet
        const address = String(body.address || '').trim();
        const evmAddress = String(body.evmAddress || '').trim();
        const cleanLabel = String(body.label || 'CSC Vault').trim().slice(0, 32) || 'CSC Vault';
        const origin = body.origin === 'imported' ? 'imported' : 'created';

        if (!isValidCscAddressServer(address)) {
          throw new Error('Valid ChainScope CSC1... address is required.');
        }

        const existingByAddr = Object.values(ledger.wallets).find(
          (w) => w.address.toLowerCase() === address.toLowerCase()
        );
        if (existingByAddr) {
          if (existingByAddr.ownerUid === req.authUser!.uid) {
            existingByAddr.lastSyncedAt = now;
            existingByAddr.updatedAt = now;
            if (body.setPrimary) {
              for (const w of Object.values(ledger.wallets)) {
                if (w.ownerUid === req.authUser!.uid) {
                  w.isPrimary = w.id === existingByAddr.id;
                  dirtyWallets.add(w.id);
                }
              }
              account.primaryWalletId = existingByAddr.id;
              dirtyAccounts.add(account.uid);
            }
            dirtyWallets.add(existingByAddr.id);
            await saveLedgerToSupabase(
              supabase,
              ledger,
              storageMode,
              Array.from(dirtyAccounts),
              Array.from(dirtyWallets),
              prov.newTransactions
            );
            return buildOverviewResponse(ledger, storageMode, req.authUser!.uid, solUsd);
          }
          throw new Error('This ChainScope address is already registered to another account.');
        }

        const userWalletsCount = Object.values(ledger.wallets).filter(
          (w) => w.ownerUid === req.authUser!.uid
        ).length;
        if (userWalletsCount >= 12) {
          throw new Error('Maximum of 12 ChainScope wallets per account.');
        }

        const makePrimary = Boolean(body.setPrimary);
        if (makePrimary) {
          for (const w of Object.values(ledger.wallets)) {
            if (w.ownerUid === req.authUser!.uid && w.isPrimary) {
              w.isPrimary = false;
              w.updatedAt = now;
              dirtyWallets.add(w.id);
            }
          }
        }

        const walletId = makeId('cscw');
        const createdWallet: CscWallet = {
          id: walletId,
          ownerUid: req.authUser!.uid,
          ownerHandle: account.handle,
          label: cleanLabel,
          address,
          evmAddress: ethers.isAddress(evmAddress) ? ethers.getAddress(evmAddress) : '',
          origin,
          isPrimary: makePrimary,
          cscBalance: 0,
          usdtBalance: 0,
          usd1Balance: 0,
          nonce: 0,
          createdAt: now,
          updatedAt: now,
          lastSyncedAt: now,
        };
        ledger.wallets[walletId] = createdWallet;
        dirtyWallets.add(walletId);
        if (makePrimary) {
          account.primaryWalletId = walletId;
          account.updatedAt = now;
          dirtyAccounts.add(account.uid);
        }

        await saveLedgerToSupabase(
          supabase,
          ledger,
          storageMode,
          Array.from(dirtyAccounts),
          Array.from(dirtyWallets),
          prov.newTransactions
        );
        return buildOverviewResponse(ledger, storageMode, req.authUser!.uid, solUsd);
      });

      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Unable to save ChainScope wallet',
      });
    }
  });

  // 3. Inter-Wallet Balance & Ledger Sync
  app.post('/api/db/csc/sync', requireAuth, async (req: CscAuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase is not configured.' });
      return;
    }
    try {
      const solUsd = await getSolUsdPrice();
      const overview = await withLedgerLock(async () => {
        const { ledger, storageMode } = await loadLedgerFromSupabase(supabase);
        const prov = await ensureUserProvisioned(supabase, ledger, req.authUser!);
        const now = Date.now();
        const dirtyWallets = new Set(prov.dirtyWalletIds);

        for (const w of Object.values(ledger.wallets)) {
          if (w.ownerUid === req.authUser!.uid) {
            w.lastSyncedAt = now;
            dirtyWallets.add(w.id);
          }
        }
        await saveLedgerToSupabase(
          supabase,
          ledger,
          storageMode,
          prov.dirtyAccountUids,
          Array.from(dirtyWallets),
          prov.newTransactions
        );
        return buildOverviewResponse(ledger, storageMode, req.authUser!.uid, solUsd);
      });
      res.json(overview);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Sync failed' });
    }
  });

  // 4. Tap-to-Mine Sustainable Emission + Referral Commission
  app.post('/api/db/csc/tap', requireAuth, async (req: CscAuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase is not configured.' });
      return;
    }
    const body = (req.body || {}) as { taps?: number; walletId?: string };
    const requestedTaps = Math.min(25, Math.max(1, Math.floor(Number(body.taps ?? 1))));

    try {
      const solUsd = await getSolUsdPrice();
      const response = await withLedgerLock(async () => {
        const { ledger, storageMode } = await loadLedgerFromSupabase(supabase);
        const prov = await ensureUserProvisioned(supabase, ledger, req.authUser!);
        const account = prov.account;
        const now = Date.now();
        const synced = computeSyncedEnergy(account.energy, account.lastEnergySyncAt, now);

        if (synced.energy <= 0) {
          throw new Error(
            `Tap energy depleted. Next energy regenerates in ${synced.nextEnergyInSec}s.`
          );
        }
        if (ledger.network.rewardPoolRemaining <= 0) {
          throw new Error('Community mining emission pool is exhausted.');
        }

        const executableTaps = Math.min(requestedTaps, synced.energy);
        const targetWallet =
          (body.walletId &&
            ledger.wallets[body.walletId]?.ownerUid === req.authUser!.uid &&
            ledger.wallets[body.walletId]) ||
          ledger.wallets[account.primaryWalletId];

        if (!targetWallet) {
          throw new Error('No ChainScope wallet available for mining reward.');
        }

        const yieldRes = computeTapYield({
          taps: executableTaps,
          minedSupply: ledger.network.minedSupply,
          rewardPoolRemaining: ledger.network.rewardPoolRemaining,
          referralCount: account.referralCount,
        });

        const minerAmount = yieldRes.grossMintedCsc;
        if (minerAmount <= 0) {
          throw new Error('Mining emission pool exhausted.');
        }

        // Calculate referral 5% ongoing bonus if user was referred and pool supports it
        const referrerAccount =
          account.referredByUid && ledger.accounts[account.referredByUid]
            ? ledger.accounts[account.referredByUid]
            : null;
        const referrerWallet =
          referrerAccount && ledger.wallets[referrerAccount.primaryWalletId]
            ? ledger.wallets[referrerAccount.primaryWalletId]
            : null;

        const remainingAfterMiner = Math.max(0, ledger.network.rewardPoolRemaining - minerAmount);
        const rawReferralCommission = referrerWallet
          ? Number((minerAmount * CSC_REFERRAL_COMMISSION_RATE).toFixed(6))
          : 0;
        const referralCommission = Math.min(remainingAfterMiner, rawReferralCommission);

        // Apply state mutations
        const totalEmitted = Number((minerAmount + referralCommission).toFixed(6));
        ledger.network.minedSupply = Number((ledger.network.minedSupply + totalEmitted).toFixed(6));
        ledger.network.rewardPoolRemaining = Number(
          Math.max(0, ledger.network.rewardPoolRemaining - totalEmitted).toFixed(6)
        );
        ledger.network.blockHeight += 1;
        ledger.network.totalTaps += executableTaps;
        ledger.network.totalTxCount += 1;
        ledger.network.updatedAt = now;

        account.energy = Math.max(0, synced.energy - executableTaps);
        account.lastEnergySyncAt = now;
        account.totalTaps += executableTaps;
        account.totalMinedCsc = Number((account.totalMinedCsc + minerAmount).toFixed(6));
        account.updatedAt = now;

        targetWallet.cscBalance = Number((targetWallet.cscBalance + minerAmount).toFixed(6));
        targetWallet.updatedAt = now;
        targetWallet.lastSyncedAt = now;

        const dirtyAccounts = new Set([...prov.dirtyAccountUids, account.uid]);
        const dirtyWallets = new Set([...prov.dirtyWalletIds, targetWallet.id]);
        const newTransactions = [...prov.newTransactions];

        const spotPriceUsd = buildNetworkStats(ledger).spotPriceUsd;
        const tapTx: CscTransaction = {
          id: makeId('csctx'),
          txHash: makeTxHash(`${account.uid}:tap:${ledger.network.blockHeight}`),
          blockHeight: ledger.network.blockHeight,
          type: 'tap_mint',
          fromAddress: 'CSC1_MINING_POOL',
          toAddress: targetWallet.address,
          fromLabel: `CSC-1 Era ${yieldRes.halvingEra} Pool`,
          toLabel: `${account.handle} (${targetWallet.label})`,
          assetIn: 'CSC',
          amountIn: minerAmount,
          assetOut: 'CSC',
          amountOut: minerAmount,
          gasFeeCsc: 0,
          burnedCsc: 0,
          priceUsdAtTx: spotPriceUsd,
          note: `${executableTaps}x tap mine (${yieldRes.referralMultiplierPct}% ref boost)`,
          actorUid: account.uid,
          actorHandle: account.handle,
          createdAt: now,
        };
        ledger.transactions.unshift(tapTx);
        newTransactions.push(tapTx);

        if (referrerAccount && referrerWallet && referralCommission > 0) {
          referrerWallet.cscBalance = Number(
            (referrerWallet.cscBalance + referralCommission).toFixed(6)
          );
          referrerWallet.updatedAt = now;
          referrerWallet.lastSyncedAt = now;
          referrerAccount.referralBonusCsc = Number(
            (referrerAccount.referralBonusCsc + referralCommission).toFixed(6)
          );
          referrerAccount.updatedAt = now;
          dirtyAccounts.add(referrerAccount.uid);
          dirtyWallets.add(referrerWallet.id);
        }

        if (ledger.network.totalTaps % 10 === 0) {
          appendPricePoint(ledger.network, 0, 'emission');
        }

        await saveLedgerToSupabase(
          supabase,
          ledger,
          storageMode,
          Array.from(dirtyAccounts),
          Array.from(dirtyWallets),
          newTransactions
        );

        return {
          ...buildOverviewResponse(ledger, storageMode, account.uid, solUsd),
          mintedCsc: minerAmount,
          executedTaps: executableTaps,
        };
      });

      res.json(response);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Tap mining failed',
      });
    }
  });

  // 5. Claim Referral Code
  app.post('/api/db/csc/referral/claim', requireAuth, async (req: CscAuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase is not configured.' });
      return;
    }
    const cleanCode = String((req.body as { code?: string } | undefined)?.code || '')
      .trim()
      .toUpperCase();
    if (!cleanCode) {
      res.status(400).json({ error: 'Enter a valid referral code.' });
      return;
    }

    try {
      const solUsd = await getSolUsdPrice();
      const overview = await withLedgerLock(async () => {
        const { ledger, storageMode } = await loadLedgerFromSupabase(supabase);
        const prov = await ensureUserProvisioned(supabase, ledger, req.authUser!);
        const account = prov.account;
        const now = Date.now();

        if (account.referredByUid) {
          throw new Error(`Referral code ${account.referredByCode} already applied to your account.`);
        }
        if (account.referralCode.toUpperCase() === cleanCode) {
          throw new Error('You cannot apply your own referral code.');
        }

        const referrer = Object.values(ledger.accounts).find(
          (a) => a.referralCode.toUpperCase() === cleanCode
        );
        if (!referrer) {
          throw new Error('Referral code not found on ChainScope Network.');
        }

        const inviteeWallet = ledger.wallets[account.primaryWalletId];
        const referrerWallet = ledger.wallets[referrer.primaryWalletId];
        if (!inviteeWallet || !referrerWallet) {
          throw new Error('Primary ChainScope wallet required to credit referral bonus.');
        }

        const needed = CSC_REFERRAL_INVITEE_BONUS + CSC_REFERRAL_INVITER_BONUS;
        if (ledger.network.rewardPoolRemaining < needed) {
          throw new Error('Referral reward pool exhausted.');
        }

        account.referredByUid = referrer.uid;
        account.referredByCode = referrer.referralCode;
        account.totalMinedCsc = Number((account.totalMinedCsc + CSC_REFERRAL_INVITEE_BONUS).toFixed(6));
        account.updatedAt = now;

        referrer.referralCount += 1;
        referrer.referralBonusCsc = Number(
          (referrer.referralBonusCsc + CSC_REFERRAL_INVITER_BONUS).toFixed(6)
        );
        referrer.updatedAt = now;

        inviteeWallet.cscBalance = Number(
          (inviteeWallet.cscBalance + CSC_REFERRAL_INVITEE_BONUS).toFixed(6)
        );
        inviteeWallet.updatedAt = now;
        inviteeWallet.lastSyncedAt = now;

        referrerWallet.cscBalance = Number(
          (referrerWallet.cscBalance + CSC_REFERRAL_INVITER_BONUS).toFixed(6)
        );
        referrerWallet.updatedAt = now;
        referrerWallet.lastSyncedAt = now;

        ledger.network.minedSupply = Number((ledger.network.minedSupply + needed).toFixed(6));
        ledger.network.rewardPoolRemaining = Number(
          Math.max(0, ledger.network.rewardPoolRemaining - needed).toFixed(6)
        );
        ledger.network.blockHeight += 1;
        ledger.network.totalTxCount += 1;
        ledger.network.updatedAt = now;

        const spotPrice = buildNetworkStats(ledger).spotPriceUsd;
        const tx: CscTransaction = {
          id: makeId('csctx'),
          txHash: makeTxHash(`${account.uid}:ref:${referrer.uid}`),
          blockHeight: ledger.network.blockHeight,
          type: 'referral_bonus',
          fromAddress: 'CSC1_REFERRAL_POOL',
          toAddress: inviteeWallet.address,
          fromLabel: `Referral ${referrer.referralCode}`,
          toLabel: `${account.handle} (+${CSC_REFERRAL_INVITEE_BONUS}) & @${referrer.handle} (+${CSC_REFERRAL_INVITER_BONUS})`,
          assetIn: 'CSC',
          amountIn: needed,
          assetOut: 'CSC',
          amountOut: CSC_REFERRAL_INVITEE_BONUS,
          gasFeeCsc: 0,
          burnedCsc: 0,
          priceUsdAtTx: spotPrice,
          note: `Two-sided referral activation (+10% tap boost to @${referrer.handle})`,
          actorUid: account.uid,
          actorHandle: account.handle,
          createdAt: now,
        };
        ledger.transactions.unshift(tx);

        const dirtyAccounts = Array.from(
          new Set([...prov.dirtyAccountUids, account.uid, referrer.uid])
        );
        const dirtyWallets = Array.from(
          new Set([...prov.dirtyWalletIds, inviteeWallet.id, referrerWallet.id])
        );

        await saveLedgerToSupabase(
          supabase,
          ledger,
          storageMode,
          dirtyAccounts,
          dirtyWallets,
          [...prov.newTransactions, tx]
        );
        return buildOverviewResponse(ledger, storageMode, account.uid, solUsd);
      });

      res.json(overview);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Unable to apply referral code',
      });
    }
  });

  // 6. Wallet-to-Wallet & Inter-Wallet Transfers (CSC, USDT, USD1 + CSC Gas Fee)
  app.post('/api/db/csc/transfer', requireAuth, async (req: CscAuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase is not configured.' });
      return;
    }

    const body = (req.body || {}) as {
      fromWalletId?: string;
      toWalletId?: string;
      toAddressOrHandle?: string;
      asset?: CscAsset;
      amount?: number;
      gasTier?: CscGasTier;
      note?: string;
    };

    const asset: CscAsset =
      body.asset === 'USDT' || body.asset === 'USD1' ? body.asset : 'CSC';
    const amount = Number(body.amount ?? 0);
    const gasTier = normalizeGasTier(body.gasTier);

    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: 'Transfer amount must be greater than zero.' });
      return;
    }

    try {
      const solUsd = await getSolUsdPrice();
      const overview = await withLedgerLock(async () => {
        const { ledger, storageMode } = await loadLedgerFromSupabase(supabase);
        const prov = await ensureUserProvisioned(supabase, ledger, req.authUser!);
        const account = prov.account;
        const now = Date.now();

        const fromWallet = body.fromWalletId
          ? ledger.wallets[body.fromWalletId]
          : ledger.wallets[account.primaryWalletId];

        if (!fromWallet || fromWallet.ownerUid !== req.authUser!.uid) {
          throw new Error('Source ChainScope wallet not found.');
        }

        let toWallet: CscWallet | null = null;
        if (body.toWalletId) {
          toWallet = ledger.wallets[body.toWalletId] || null;
        } else {
          const target = String(body.toAddressOrHandle || '').trim();
          if (!target) {
            throw new Error('Enter a destination CSC1... address or @handle.');
          }
          if (target.startsWith('@') || !isValidCscAddressServer(target)) {
            const cleanHandle = target.replace(/^@/, '').toLowerCase();
            const targetAccount = Object.values(ledger.accounts).find(
              (a) => a.handle.toLowerCase() === cleanHandle
            );
            if (!targetAccount) {
              throw new Error(`No ChainScope user found for "${target}".`);
            }
            toWallet = ledger.wallets[targetAccount.primaryWalletId] || null;
          } else {
            toWallet =
              Object.values(ledger.wallets).find(
                (w) => w.address.toLowerCase() === target.toLowerCase()
              ) || null;
          }
        }

        if (!toWallet) {
          throw new Error('Destination ChainScope wallet address not registered on CSC-1.');
        }
        if (toWallet.id === fromWallet.id) {
          throw new Error('Source and destination wallets must be different.');
        }

        const gasFeeCsc = CSC_GAS_FEES[gasTier];
        const burnedCsc = Number((gasFeeCsc * 0.5).toFixed(6));
        const poolReturnCsc = Number((gasFeeCsc * 0.3).toFixed(6));
        const lpBoostCsc = Number((gasFeeCsc - burnedCsc - poolReturnCsc).toFixed(6));

        // Verify CSC gas + asset balance
        if (asset === 'CSC') {
          if (fromWallet.cscBalance < amount + gasFeeCsc) {
            throw new Error(
              `Insufficient CSC in "${fromWallet.label}". Need ${(amount + gasFeeCsc).toFixed(4)} CSC (incl. ${gasFeeCsc} CSC gas).`
            );
          }
          fromWallet.cscBalance = Number((fromWallet.cscBalance - amount - gasFeeCsc).toFixed(6));
          toWallet.cscBalance = Number((toWallet.cscBalance + amount).toFixed(6));
        } else {
          if (fromWallet.cscBalance < gasFeeCsc) {
            throw new Error(
              `Insufficient CSC for network gas fee (${gasFeeCsc} CSC). Tap once to mine free CSC gas!`
            );
          }
          const field = asset === 'USDT' ? 'usdtBalance' : 'usd1Balance';
          if (fromWallet[field] < amount) {
            throw new Error(`Insufficient ${asset} in "${fromWallet.label}".`);
          }
          fromWallet.cscBalance = Number((fromWallet.cscBalance - gasFeeCsc).toFixed(6));
          fromWallet[field] = Number((fromWallet[field] - amount).toFixed(6));
          toWallet[field] = Number((toWallet[field] + amount).toFixed(6));
        }

        fromWallet.nonce += 1;
        fromWallet.updatedAt = now;
        fromWallet.lastSyncedAt = now;
        toWallet.updatedAt = now;
        toWallet.lastSyncedAt = now;

        account.totalGasPaidCsc = Number((account.totalGasPaidCsc + gasFeeCsc).toFixed(6));
        account.updatedAt = now;

        ledger.network.burnedSupply = Number((ledger.network.burnedSupply + burnedCsc).toFixed(6));
        ledger.network.rewardPoolRemaining = Number(
          (ledger.network.rewardPoolRemaining + poolReturnCsc).toFixed(6)
        );
        ledger.network.usdtPoolCsc = Number((ledger.network.usdtPoolCsc + lpBoostCsc).toFixed(6));
        ledger.network.blockHeight += 1;
        ledger.network.totalTxCount += 1;
        ledger.network.updatedAt = now;

        const isInterWallet = toWallet.ownerUid === fromWallet.ownerUid;
        const spotPriceUsd = buildNetworkStats(ledger).spotPriceUsd;
        const tx: CscTransaction = {
          id: makeId('csctx'),
          txHash: makeTxHash(`${fromWallet.address}:${toWallet.address}:${ledger.network.blockHeight}`),
          blockHeight: ledger.network.blockHeight,
          type: isInterWallet ? 'inter_wallet_transfer' : 'wallet_transfer',
          fromAddress: fromWallet.address,
          toAddress: toWallet.address,
          fromLabel: `${fromWallet.ownerHandle} (${fromWallet.label})`,
          toLabel: `${toWallet.ownerHandle} (${toWallet.label})`,
          assetIn: asset,
          amountIn: amount,
          assetOut: asset,
          amountOut: amount,
          gasFeeCsc,
          burnedCsc,
          priceUsdAtTx: spotPriceUsd,
          note:
            String(body.note || '').trim().slice(0, 80) ||
            (isInterWallet ? 'Inter-wallet balance sync transfer' : 'CSC-1 peer wallet transfer'),
          actorUid: account.uid,
          actorHandle: account.handle,
          createdAt: now,
        };
        ledger.transactions.unshift(tx);

        const dirtyAccounts = Array.from(new Set([...prov.dirtyAccountUids, account.uid]));
        const dirtyWallets = Array.from(
          new Set([...prov.dirtyWalletIds, fromWallet.id, toWallet.id])
        );

        await saveLedgerToSupabase(
          supabase,
          ledger,
          storageMode,
          dirtyAccounts,
          dirtyWallets,
          [...prov.newTransactions, tx]
        );
        return buildOverviewResponse(ledger, storageMode, account.uid, solUsd);
      });

      res.json(overview);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Transfer failed',
      });
    }
  });

  // 7. AMM Swap (CSC <-> USDT / USD1 and USDT <-> USD1 with live price fluctuation & CSC gas)
  app.post('/api/db/csc/swap', requireAuth, async (req: CscAuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase is not configured.' });
      return;
    }

    const body = (req.body || {}) as {
      walletId?: string;
      assetIn?: CscAsset;
      assetOut?: CscAsset;
      amountIn?: number;
      gasTier?: CscGasTier;
      minAmountOut?: number;
    };

    const assetIn: CscAsset =
      body.assetIn === 'USDT' || body.assetIn === 'USD1' ? body.assetIn : 'CSC';
    const assetOut: CscAsset =
      body.assetOut === 'USDT' || body.assetOut === 'USD1' ? body.assetOut : 'CSC';
    const amountIn = Number(body.amountIn ?? 0);
    const gasTier = normalizeGasTier(body.gasTier);

    if (assetIn === assetOut) {
      res.status(400).json({ error: 'Select two different assets to swap.' });
      return;
    }
    if (!Number.isFinite(amountIn) || amountIn <= 0) {
      res.status(400).json({ error: 'Swap amount must be greater than zero.' });
      return;
    }

    try {
      const solUsd = await getSolUsdPrice();
      const overview = await withLedgerLock(async () => {
        const { ledger, storageMode } = await loadLedgerFromSupabase(supabase);
        const prov = await ensureUserProvisioned(supabase, ledger, req.authUser!);
        const account = prov.account;
        const now = Date.now();

        const wallet = body.walletId
          ? ledger.wallets[body.walletId]
          : ledger.wallets[account.primaryWalletId];
        if (!wallet || wallet.ownerUid !== req.authUser!.uid) {
          throw new Error('Selected ChainScope wallet not found.');
        }

        const { usdtPool, usd1Pool } = buildPools(ledger.network);
        const quote = quoteCscSwap({
          assetIn,
          assetOut,
          amountIn,
          usdtPool,
          usd1Pool,
          gasTier,
        });

        if (quote.amountOut <= 0) {
          throw new Error('Swap output is too small.');
        }
        if (body.minAmountOut && quote.amountOut < Number(body.minAmountOut)) {
          throw new Error('Slippage exceeded: output fell below minimum requested amount.');
        }

        const gasFeeCsc = quote.gasFeeCsc;
        const burnedCsc = quote.burnedCsc;
        const poolReturnCsc = Number((gasFeeCsc * 0.5).toFixed(6));

        // Verify CSC gas + assetIn balance
        if (assetIn === 'CSC') {
          if (wallet.cscBalance < amountIn + gasFeeCsc) {
            throw new Error(
              `Insufficient CSC balance. Need ${(amountIn + gasFeeCsc).toFixed(4)} CSC (swap + ${gasFeeCsc} CSC gas).`
            );
          }
          wallet.cscBalance = Number((wallet.cscBalance - amountIn - gasFeeCsc).toFixed(6));
        } else {
          if (wallet.cscBalance < gasFeeCsc) {
            throw new Error(
              `Need ${gasFeeCsc} CSC for network gas fee. Tap once to mine free CSC gas!`
            );
          }
          const inField = assetIn === 'USDT' ? 'usdtBalance' : 'usd1Balance';
          if (wallet[inField] < amountIn) {
            throw new Error(`Insufficient ${assetIn} balance in "${wallet.label}".`);
          }
          wallet.cscBalance = Number((wallet.cscBalance - gasFeeCsc).toFixed(6));
          wallet[inField] = Number((wallet[inField] - amountIn).toFixed(6));
        }

        // Credit assetOut
        if (assetOut === 'CSC') {
          wallet.cscBalance = Number((wallet.cscBalance + quote.amountOut).toFixed(6));
        } else if (assetOut === 'USDT') {
          wallet.usdtBalance = Number((wallet.usdtBalance + quote.amountOut).toFixed(6));
        } else {
          wallet.usd1Balance = Number((wallet.usd1Balance + quote.amountOut).toFixed(6));
        }

        wallet.nonce += 1;
        wallet.updatedAt = now;
        wallet.lastSyncedAt = now;

        // Update AMM Pool reserves & price chart
        let volumeUsd = 0;
        if (assetIn === 'USDT' || assetOut === 'USDT') {
          if (assetIn === 'USD1' || assetOut === 'USD1') {
            volumeUsd = amountIn;
            ledger.network.usdtVolumeUsd += volumeUsd * 0.5;
            ledger.network.usd1VolumeUsd += volumeUsd * 0.5;
          } else {
            ledger.network.usdtPoolCsc = quote.nextCscReserve;
            ledger.network.usdtPoolUsd = quote.nextUsdReserve;
            volumeUsd = assetIn === 'USDT' ? amountIn : quote.amountOut;
            ledger.network.usdtVolumeUsd += volumeUsd;
            ledger.network.usdtSwapCount += 1;
            ledger.network.usdtFeesUsd +=
              assetIn === 'USDT' ? quote.feeAmount : quote.feeAmount * quote.spotAfterUsd;
          }
        } else {
          ledger.network.usd1PoolCsc = quote.nextCscReserve;
          ledger.network.usd1PoolUsd = quote.nextUsdReserve;
          volumeUsd = assetIn === 'USD1' ? amountIn : quote.amountOut;
          ledger.network.usd1VolumeUsd += volumeUsd;
          ledger.network.usd1SwapCount += 1;
          ledger.network.usd1FeesUsd +=
            assetIn === 'USD1' ? quote.feeAmount : quote.feeAmount * quote.spotAfterUsd;
        }

        ledger.network.burnedSupply = Number((ledger.network.burnedSupply + burnedCsc).toFixed(6));
        ledger.network.rewardPoolRemaining = Number(
          (ledger.network.rewardPoolRemaining + poolReturnCsc).toFixed(6)
        );
        ledger.network.blockHeight += 1;
        ledger.network.totalTxCount += 1;
        ledger.network.updatedAt = now;

        account.totalGasPaidCsc = Number((account.totalGasPaidCsc + gasFeeCsc).toFixed(6));
        account.updatedAt = now;

        if (assetIn === 'CSC' && (assetOut === 'USDT' || assetOut === 'USD1')) {
          appendPricePoint(ledger.network, volumeUsd, 'swap_sell');
        } else if (assetOut === 'CSC' && (assetIn === 'USDT' || assetIn === 'USD1')) {
          appendPricePoint(ledger.network, volumeUsd, 'swap_buy');
        }

        const spotAfter = buildNetworkStats(ledger).spotPriceUsd;
        const tx: CscTransaction = {
          id: makeId('csctx'),
          txHash: makeTxHash(`${wallet.address}:swap:${ledger.network.blockHeight}`),
          blockHeight: ledger.network.blockHeight,
          type: 'swap',
          fromAddress: wallet.address,
          toAddress:
            assetIn === 'USD1' || assetOut === 'USD1'
              ? 'CSC1_AMM_USD1_POOL'
              : 'CSC1_AMM_USDT_POOL',
          fromLabel: `${account.handle} (${wallet.label})`,
          toLabel: `${assetIn} → ${assetOut} AMM`,
          assetIn,
          amountIn,
          assetOut,
          amountOut: quote.amountOut,
          gasFeeCsc,
          burnedCsc,
          priceUsdAtTx: spotAfter,
          note: `AMM swap (${quote.priceImpactPct.toFixed(2)}% impact)`,
          actorUid: account.uid,
          actorHandle: account.handle,
          createdAt: now,
        };
        ledger.transactions.unshift(tx);

        const dirtyAccounts = Array.from(new Set([...prov.dirtyAccountUids, account.uid]));
        const dirtyWallets = Array.from(new Set([...prov.dirtyWalletIds, wallet.id]));

        await saveLedgerToSupabase(
          supabase,
          ledger,
          storageMode,
          dirtyAccounts,
          dirtyWallets,
          [...prov.newTransactions, tx]
        );
        return buildOverviewResponse(ledger, storageMode, account.uid, solUsd);
      });

      res.json(overview);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'AMM swap failed',
      });
    }
  });

  // 8. Bridge Platform SOL -> USDT / USD1 / CSC on ChainScope Network
  app.post('/api/db/csc/bridge-sol', requireAuth, async (req: CscAuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase is not configured.' });
      return;
    }

    const body = (req.body || {}) as {
      walletId?: string;
      solAmount?: number;
      targetAsset?: CscAsset;
    };
    const solAmount = Number(body.solAmount ?? 0);
    const targetAsset: CscAsset =
      body.targetAsset === 'USD1' || body.targetAsset === 'CSC' ? body.targetAsset : 'USDT';

    if (!Number.isFinite(solAmount) || solAmount <= 0 || solAmount > 500) {
      res.status(400).json({ error: 'Enter a valid SOL amount between 0.001 and 500 SOL.' });
      return;
    }

    try {
      const solUsd = await getSolUsdPrice();
      const usdEquivalent = Number((solAmount * solUsd).toFixed(4));

      // Check & debit platform SOL balance in chainscope_users
      const { data: userRow, error: userErr } = await supabase
        .from('chainscope_users')
        .select('sol_balance')
        .eq('uid', req.authUser!.uid)
        .maybeSingle();

      if (userErr) throw new Error(userErr.message);
      const currentSol = Number(userRow?.sol_balance ?? 0);
      if (currentSol < solAmount) {
        res.status(400).json({
          error: `Insufficient platform SOL (${currentSol.toFixed(4)} SOL available). Deposit SOL or use Launchpad faucet first.`,
        });
        return;
      }

      const nextSol = Number((currentSol - solAmount).toFixed(6));
      const { error: debitErr } = await supabase
        .from('chainscope_users')
        .update({ sol_balance: nextSol, updated_at: new Date().toISOString() })
        .eq('uid', req.authUser!.uid);
      if (debitErr) throw new Error(debitErr.message);

      try {
        const overview = await withLedgerLock(async () => {
          const { ledger, storageMode } = await loadLedgerFromSupabase(supabase);
          const prov = await ensureUserProvisioned(supabase, ledger, req.authUser!);
          const account = prov.account;
          const now = Date.now();

          const wallet = body.walletId
            ? ledger.wallets[body.walletId]
            : ledger.wallets[account.primaryWalletId];
          if (!wallet || wallet.ownerUid !== req.authUser!.uid) {
            throw new Error('Destination ChainScope wallet not found.');
          }

          let amountOut = usdEquivalent;
          if (targetAsset === 'CSC') {
            const { usdtPool, usd1Pool } = buildPools(ledger.network);
            const quote = quoteCscSwap({
              assetIn: 'USDT',
              assetOut: 'CSC',
              amountIn: usdEquivalent,
              usdtPool,
              usd1Pool,
              gasTier: 'standard',
            });
            amountOut = quote.amountOut;
            ledger.network.usdtPoolCsc = quote.nextCscReserve;
            ledger.network.usdtPoolUsd = quote.nextUsdReserve;
            ledger.network.usdtVolumeUsd += usdEquivalent;
            ledger.network.usdtSwapCount += 1;
            wallet.cscBalance = Number((wallet.cscBalance + amountOut).toFixed(6));
            appendPricePoint(ledger.network, usdEquivalent, 'swap_buy');
          } else if (targetAsset === 'USDT') {
            wallet.usdtBalance = Number((wallet.usdtBalance + amountOut).toFixed(6));
          } else {
            wallet.usd1Balance = Number((wallet.usd1Balance + amountOut).toFixed(6));
          }

          wallet.updatedAt = now;
          wallet.lastSyncedAt = now;
          ledger.network.blockHeight += 1;
          ledger.network.totalTxCount += 1;
          ledger.network.updatedAt = now;

          const spotAfter = buildNetworkStats(ledger).spotPriceUsd;
          const tx: CscTransaction = {
            id: makeId('csctx'),
            txHash: makeTxHash(`${wallet.address}:bridge:${ledger.network.blockHeight}`),
            blockHeight: ledger.network.blockHeight,
            type: 'sol_bridge',
            fromAddress: `SOL_PLATFORM:${account.handle}`,
            toAddress: wallet.address,
            fromLabel: `Platform SOL ($${solUsd.toFixed(2)}/SOL)`,
            toLabel: `${account.handle} (${wallet.label})`,
            assetIn: 'SOL',
            amountIn: solAmount,
            assetOut: targetAsset,
            amountOut,
            gasFeeCsc: 0,
            burnedCsc: 0,
            priceUsdAtTx: spotAfter,
            note: `Bridged ${solAmount.toFixed(4)} SOL → ${amountOut.toFixed(4)} ${targetAsset}`,
            actorUid: account.uid,
            actorHandle: account.handle,
            createdAt: now,
          };
          ledger.transactions.unshift(tx);

          await saveLedgerToSupabase(
            supabase,
            ledger,
            storageMode,
            Array.from(new Set([...prov.dirtyAccountUids, account.uid])),
            Array.from(new Set([...prov.dirtyWalletIds, wallet.id])),
            [...prov.newTransactions, tx]
          );
          return buildOverviewResponse(ledger, storageMode, account.uid, solUsd);
        });

        res.json(overview);
      } catch (innerErr) {
        // Refund SOL if ledger save failed
        await supabase
          .from('chainscope_users')
          .update({ sol_balance: currentSol, updated_at: new Date().toISOString() })
          .eq('uid', req.authUser!.uid);
        throw innerErr;
      }
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'SOL bridge failed',
      });
    }
  });
}
