import crypto from 'crypto';
import type { Server as HttpServer } from 'http';
import type { Express, NextFunction, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import { WebSocket, WebSocketServer } from 'ws';
import type {
  P2PAd,
  P2PAdSide,
  P2PAsset,
  P2PChatMessage,
  P2PEscrowMode,
  P2POrder,
  P2POrderStatus,
  P2POverviewResponse,
  P2PPriceType,
  P2PSavedPaymentMethod,
} from '../src/types/p2p.ts';
import {
  getAllPaymentMethodsCount,
  getCountryByCode,
  getPaymentMethodById,
  P2P_COUNTRIES,
} from '../src/data/p2pPayments.ts';
import { executeCscVaultEscrowOp, getCscSpotPriceUsd } from './cscSystem.ts';
import { resolveWalletAuthByUid } from './walletAuth.ts';

export interface P2PAuthUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export interface P2PAuthedRequest extends Request {
  authUser?: P2PAuthUser;
}

export interface P2PRouteDeps {
  httpServer?: HttpServer;
  getSupabaseAdminClient: () => SupabaseClient | null;
  authenticateToken: (token: string) => Promise<P2PAuthUser>;
  requireAuth: (req: P2PAuthedRequest, res: Response, next: NextFunction) => Promise<void> | void;
  requireAdmin: (req: P2PAuthedRequest, res: Response, next: NextFunction) => Promise<void> | void;
  isUserAdmin: (supabase: SupabaseClient, user: P2PAuthUser) => Promise<boolean>;
  getLiveSpotPricesUsd: () => Promise<Record<string, number>>;
}

interface StoredP2PState {
  paymentProfiles: Record<string, P2PSavedPaymentMethod>;
  ads: Record<string, P2PAd>;
  orders: Record<string, P2POrder>;
  messages: Record<string, P2PChatMessage[]>;
}

const SNAPSHOT_P2P_ID = 'p2p_exchange_state_v1';
const P2P_ESCROW_FEE_RATE = 0.0025; // 0.25% protocol escrow fee on released trade
const SUPPORTED_ASSETS: P2PAsset[] = ['USDT', 'USD1', 'CSC', 'SOL', 'ETH', 'BNB'];

const ESCROW_VAULTS = {
  evm: '0x71C0B4D91E2A8F44E89B10A95C78E042A1B90C5E',
  solana: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
  csc: 'CSC1_P2P_ESCROW_VAULT',
};

let p2pQueue: Promise<unknown> = Promise.resolve();
function withP2PLock<T>(task: () => Promise<T>): Promise<T> {
  const next = p2pQueue.then(task, task);
  p2pQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function toMs(val: unknown): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const p = Date.parse(val);
    return Number.isFinite(p) ? p : Date.now();
  }
  return Date.now();
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

function validateProofImageDataUrl(raw: unknown): string {
  const str = String(raw || '').trim();
  if (!str) return '';
  if (
    /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(str) &&
    str.length <= 320_000
  ) {
    return str;
  }
  throw new Error('Receipt image must be PNG/JPG/WEBP under 240 KB.');
}

async function detectNormalizedP2P(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await supabase
    .from('chainscope_p2p_ads')
    .select('id', { count: 'exact', head: true });
  return !isMissingRelationError(error);
}

function rowToPaymentProfile(r: Record<string, unknown>): P2PSavedPaymentMethod {
  return {
    id: String(r.id),
    ownerUid: String(r.owner_uid || ''),
    countryCode: String(r.country_code || 'US'),
    currency: String(r.currency || 'USD'),
    methodId: String(r.method_id || ''),
    methodName: String(r.method_name || ''),
    accountHolder: String(r.account_holder || ''),
    accountDetails: String(r.account_details || ''),
    instructions: String(r.instructions || ''),
    createdAt: toMs(r.created_at),
    updatedAt: toMs(r.updated_at),
  };
}

function rowToOrder(r: Record<string, unknown>): P2POrder {
  const snap = (r.payment_snapshot || {}) as {
    accountHolder?: string;
    accountDetails?: string;
    instructions?: string;
  };
  return {
    id: String(r.id),
    adId: String(r.ad_id || ''),
    asset: (String(r.asset || 'USDT') as P2PAsset),
    countryCode: String(r.country_code || 'US'),
    fiatCurrency: String(r.fiat_currency || 'USD'),
    unitPriceFiat: Number(r.unit_price_fiat ?? 0),
    cryptoAmount: Number(r.crypto_amount ?? 0),
    fiatAmount: Number(r.fiat_amount ?? 0),
    feeCrypto: Number(r.fee_crypto ?? 0),
    netBuyerCrypto: Number(r.net_buyer_crypto ?? 0),
    buyerUid: String(r.buyer_uid || ''),
    buyerUsername: String(r.buyer_username || ''),
    buyerWalletAddress: String(r.buyer_wallet_address || ''),
    sellerUid: String(r.seller_uid || ''),
    sellerUsername: String(r.seller_username || ''),
    sellerWalletAddress: String(r.seller_wallet_address || ''),
    paymentMethodId: String(r.payment_method_id || ''),
    paymentMethodName: String(r.payment_method_name || ''),
    paymentSnapshot: {
      accountHolder: String(snap.accountHolder || ''),
      accountDetails: String(snap.accountDetails || ''),
      instructions: String(snap.instructions || ''),
    },
    escrowMode: (String(r.escrow_mode || 'vault_balance') as P2PEscrowMode),
    escrowAssetLocked: Boolean(r.escrow_asset_locked),
    escrowLockedAmount: Number(r.escrow_locked_amount ?? 0),
    escrowTxHash: String(r.escrow_tx_hash || ''),
    escrowSignature: String(r.escrow_signature || ''),
    escrowVaultAddress: String(r.escrow_vault_address || ''),
    fiatProofRef: String(r.fiat_proof_ref || ''),
    fiatProofImage: String(r.fiat_proof_image || ''),
    fiatProofNote: String(r.fiat_proof_note || ''),
    status: (String(r.status || 'awaiting_escrow') as P2POrderStatus),
    disputeReason: String(r.dispute_reason || ''),
    disputedByUid: String(r.disputed_by_uid || ''),
    adminResolutionNote: String(r.admin_resolution_note || ''),
    resolvedByUid: String(r.resolved_by_uid || ''),
    resolvedByHandle: String(r.resolved_by_handle || ''),
    paymentDeadlineAt: toMs(r.payment_deadline_at),
    createdAt: toMs(r.created_at),
    updatedAt: toMs(r.updated_at),
    escrowLockedAt: r.escrow_locked_at ? toMs(r.escrow_locked_at) : undefined,
    fiatPaidAt: r.fiat_paid_at ? toMs(r.fiat_paid_at) : undefined,
    completedAt: r.completed_at ? toMs(r.completed_at) : undefined,
  };
}

function rowToMessage(r: Record<string, unknown>): P2PChatMessage {
  return {
    id: String(r.id),
    orderId: String(r.order_id || ''),
    senderUid: String(r.sender_uid || ''),
    senderUsername: String(r.sender_username || ''),
    senderRole: (String(r.sender_role || 'buyer') as P2PChatMessage['senderRole']),
    kind: (String(r.kind || 'text') as P2PChatMessage['kind']),
    text: String(r.text || ''),
    attachmentImage: r.attachment_image ? String(r.attachment_image) : undefined,
    txHash: r.tx_hash ? String(r.tx_hash) : undefined,
    createdAt: toMs(r.created_at),
  };
}

function rowToAdBase(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    makerUid: String(r.maker_uid || ''),
    makerUsername: String(r.maker_username || ''),
    makerDisplayName: String(r.maker_display_name || ''),
    makerWalletAddress: String(r.maker_wallet_address || ''),
    makerEvmAddress: String(r.maker_evm_address || ''),
    makerSolanaAddress: String(r.maker_solana_address || ''),
    makerCscAddress: String(r.maker_csc_address || ''),
    side: (String(r.side || 'sell') as P2PAdSide),
    asset: (String(r.asset || 'USDT') as P2PAsset),
    countryCode: String(r.country_code || 'US'),
    fiatCurrency: String(r.fiat_currency || 'USD'),
    priceType: (String(r.price_type || 'fixed') as P2PPriceType),
    fixedPriceFiat: Number(r.fixed_price_fiat ?? 0),
    floatingMarginPct: Number(r.floating_margin_pct ?? 0),
    availableCryptoAmount: Number(r.available_crypto_amount ?? 0),
    minFiatOrder: Number(r.min_fiat_order ?? 10),
    maxFiatOrder: Number(r.max_fiat_order ?? 5000),
    paymentMethodIds: Array.isArray(r.payment_method_ids)
      ? (r.payment_method_ids as unknown[]).map(String)
      : [],
    paymentMethodNames: Array.isArray(r.payment_method_names)
      ? (r.payment_method_names as unknown[]).map(String)
      : [],
    paymentWindowMins: Number(r.payment_window_mins ?? 15),
    escrowMode: (String(r.escrow_mode || 'vault_balance') as P2PEscrowMode),
    terms: String(r.terms || ''),
    status: (String(r.status || 'active') as P2PAd['status']),
    createdAt: toMs(r.created_at),
    updatedAt: toMs(r.updated_at),
  };
}

async function loadP2PState(
  supabase: SupabaseClient
): Promise<{ state: StoredP2PState; mode: 'normalized' | 'snapshot' }> {
  const normalized = await detectNormalizedP2P(supabase);
  if (normalized) {
    const [profRes, adRes, ordRes, msgRes] = await Promise.all([
      supabase.from('chainscope_p2p_payment_profiles').select('*'),
      supabase.from('chainscope_p2p_ads').select('*').order('updated_at', { ascending: false }),
      supabase.from('chainscope_p2p_orders').select('*').order('updated_at', { ascending: false }),
      supabase.from('chainscope_p2p_messages').select('*').order('created_at', { ascending: true }),
    ]);

    if (!profRes.error && !adRes.error && !ordRes.error && !msgRes.error) {
      const paymentProfiles: Record<string, P2PSavedPaymentMethod> = {};
      for (const row of (profRes.data || []) as Array<Record<string, unknown>>) {
        const p = rowToPaymentProfile(row);
        paymentProfiles[p.id] = p;
      }

      const orders: Record<string, P2POrder> = {};
      for (const row of (ordRes.data || []) as Array<Record<string, unknown>>) {
        const o = rowToOrder(row);
        orders[o.id] = o;
      }

      const ads: Record<string, P2PAd> = {};
      for (const row of (adRes.data || []) as Array<Record<string, unknown>>) {
        const base = rowToAdBase(row);
        ads[base.id] = {
          ...base,
          effectivePriceFiat: base.fixedPriceFiat,
          spotPriceUsd: 1,
          makerStats: {
            completedOrders: 0,
            completionRatePct: 100,
            avgReleaseMins: 4,
            verifiedWallet: Boolean(base.makerWalletAddress),
          },
        };
      }

      const messages: Record<string, P2PChatMessage[]> = {};
      for (const row of (msgRes.data || []) as Array<Record<string, unknown>>) {
        const m = rowToMessage(row);
        if (!messages[m.orderId]) messages[m.orderId] = [];
        messages[m.orderId].push(m);
      }

      return { state: { paymentProfiles, ads, orders, messages }, mode: 'normalized' };
    }
  }

  const { data } = await supabase
    .from('chainscope_wallet_snapshots')
    .select('chains')
    .eq('id', SNAPSHOT_P2P_ID)
    .maybeSingle();

  const raw = (data?.chains || null) as Partial<StoredP2PState> | null;
  return {
    state: {
      paymentProfiles: raw?.paymentProfiles || {},
      ads: raw?.ads || {},
      orders: raw?.orders || {},
      messages: raw?.messages || {},
    },
    mode: 'snapshot',
  };
}

async function saveP2PSnapshot(supabase: SupabaseClient, state: StoredP2PState) {
  const { error } = await supabase.from('chainscope_wallet_snapshots').upsert(
    {
      id: SNAPSHOT_P2P_ID,
      wallet_id: 'p2p_exchange_state',
      label: 'ChainScope Decentralized P2P State',
      evm_address: '',
      solana_address: '',
      total_usd: Object.keys(state.orders).length,
      chains: state,
      scanned_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );
  if (error) throw new Error(error.message);
}

async function persistProfile(
  supabase: SupabaseClient,
  state: StoredP2PState,
  mode: 'normalized' | 'snapshot',
  prof: P2PSavedPaymentMethod
) {
  state.paymentProfiles[prof.id] = prof;
  if (mode === 'normalized') {
    const { error } = await supabase.from('chainscope_p2p_payment_profiles').upsert(
      {
        id: prof.id,
        owner_uid: prof.ownerUid,
        country_code: prof.countryCode,
        currency: prof.currency,
        method_id: prof.methodId,
        method_name: prof.methodName,
        account_holder: prof.accountHolder,
        account_details: prof.accountDetails,
        instructions: prof.instructions,
        created_at: new Date(prof.createdAt).toISOString(),
        updated_at: new Date(prof.updatedAt).toISOString(),
      },
      { onConflict: 'id' }
    );
    if (error) throw new Error(error.message);
  } else {
    await saveP2PSnapshot(supabase, state);
  }
}

async function deletePersistedProfile(
  supabase: SupabaseClient,
  state: StoredP2PState,
  mode: 'normalized' | 'snapshot',
  id: string
) {
  delete state.paymentProfiles[id];
  if (mode === 'normalized') {
    const { error } = await supabase
      .from('chainscope_p2p_payment_profiles')
      .delete()
      .eq('id', id);
    if (error) throw new Error(error.message);
  } else {
    await saveP2PSnapshot(supabase, state);
  }
}

async function persistAd(
  supabase: SupabaseClient,
  state: StoredP2PState,
  mode: 'normalized' | 'snapshot',
  ad: P2PAd
) {
  state.ads[ad.id] = ad;
  if (mode === 'normalized') {
    const { error } = await supabase.from('chainscope_p2p_ads').upsert(
      {
        id: ad.id,
        maker_uid: ad.makerUid,
        maker_username: ad.makerUsername,
        maker_display_name: ad.makerDisplayName,
        maker_wallet_address: ad.makerWalletAddress,
        maker_evm_address: ad.makerEvmAddress,
        maker_solana_address: ad.makerSolanaAddress,
        maker_csc_address: ad.makerCscAddress,
        side: ad.side,
        asset: ad.asset,
        country_code: ad.countryCode,
        fiat_currency: ad.fiatCurrency,
        price_type: ad.priceType,
        fixed_price_fiat: ad.fixedPriceFiat,
        floating_margin_pct: ad.floatingMarginPct,
        available_crypto_amount: ad.availableCryptoAmount,
        min_fiat_order: ad.minFiatOrder,
        max_fiat_order: ad.maxFiatOrder,
        payment_method_ids: ad.paymentMethodIds,
        payment_method_names: ad.paymentMethodNames,
        payment_window_mins: ad.paymentWindowMins,
        escrow_mode: ad.escrowMode,
        terms: ad.terms,
        status: ad.status,
        created_at: new Date(ad.createdAt).toISOString(),
        updated_at: new Date(ad.updatedAt).toISOString(),
      },
      { onConflict: 'id' }
    );
    if (error) throw new Error(error.message);
  } else {
    await saveP2PSnapshot(supabase, state);
  }
}

async function persistOrder(
  supabase: SupabaseClient,
  state: StoredP2PState,
  mode: 'normalized' | 'snapshot',
  order: P2POrder
) {
  state.orders[order.id] = order;
  if (mode === 'normalized') {
    const { error } = await supabase.from('chainscope_p2p_orders').upsert(
      {
        id: order.id,
        ad_id: order.adId,
        asset: order.asset,
        country_code: order.countryCode,
        fiat_currency: order.fiatCurrency,
        unit_price_fiat: order.unitPriceFiat,
        crypto_amount: order.cryptoAmount,
        fiat_amount: order.fiatAmount,
        fee_crypto: order.feeCrypto,
        net_buyer_crypto: order.netBuyerCrypto,
        buyer_uid: order.buyerUid,
        buyer_username: order.buyerUsername,
        buyer_wallet_address: order.buyerWalletAddress,
        seller_uid: order.sellerUid,
        seller_username: order.sellerUsername,
        seller_wallet_address: order.sellerWalletAddress,
        payment_method_id: order.paymentMethodId,
        payment_method_name: order.paymentMethodName,
        payment_snapshot: order.paymentSnapshot,
        escrow_mode: order.escrowMode,
        escrow_asset_locked: order.escrowAssetLocked,
        escrow_locked_amount: order.escrowLockedAmount,
        escrow_tx_hash: order.escrowTxHash,
        escrow_signature: order.escrowSignature,
        escrow_vault_address: order.escrowVaultAddress,
        fiat_proof_ref: order.fiatProofRef,
        fiat_proof_image: order.fiatProofImage,
        fiat_proof_note: order.fiatProofNote,
        status: order.status,
        dispute_reason: order.disputeReason,
        disputed_by_uid: order.disputedByUid,
        admin_resolution_note: order.adminResolutionNote,
        resolved_by_uid: order.resolvedByUid,
        resolved_by_handle: order.resolvedByHandle,
        payment_deadline_at: new Date(order.paymentDeadlineAt).toISOString(),
        created_at: new Date(order.createdAt).toISOString(),
        updated_at: new Date(order.updatedAt).toISOString(),
        escrow_locked_at: order.escrowLockedAt ? new Date(order.escrowLockedAt).toISOString() : null,
        fiat_paid_at: order.fiatPaidAt ? new Date(order.fiatPaidAt).toISOString() : null,
        completed_at: order.completedAt ? new Date(order.completedAt).toISOString() : null,
      },
      { onConflict: 'id' }
    );
    if (error) throw new Error(error.message);
  } else {
    await saveP2PSnapshot(supabase, state);
  }
}

async function persistMessage(
  supabase: SupabaseClient,
  state: StoredP2PState,
  mode: 'normalized' | 'snapshot',
  msg: P2PChatMessage
) {
  if (!state.messages[msg.orderId]) state.messages[msg.orderId] = [];
  const existing = state.messages[msg.orderId];
  if (!existing.some((m) => m.id === msg.id)) {
    existing.push(msg);
  }

  if (mode === 'normalized') {
    const { error } = await supabase.from('chainscope_p2p_messages').upsert(
      {
        id: msg.id,
        order_id: msg.orderId,
        sender_uid: msg.senderUid,
        sender_username: msg.senderUsername,
        sender_role: msg.senderRole,
        kind: msg.kind,
        text: msg.text,
        attachment_image: msg.attachmentImage || '',
        tx_hash: msg.txHash || '',
        created_at: new Date(msg.createdAt).toISOString(),
      },
      { onConflict: 'id' }
    );
    if (error) throw new Error(error.message);
  } else {
    await saveP2PSnapshot(supabase, state);
  }
}

async function resolveBoundTraderIdentity(
  supabase: SupabaseClient,
  user: P2PAuthUser
): Promise<{
  uid: string;
  username: string;
  displayName: string;
  evmAddress: string;
  solanaAddress: string;
  cscAddress: string;
  primaryWallet: string;
  verifiedWallet: boolean;
}> {
  const [walletAuth, userRowRes] = await Promise.all([
    resolveWalletAuthByUid(supabase, user.uid),
    supabase.from('chainscope_users').select('*').eq('uid', user.uid).maybeSingle(),
  ]);

  const userRow = userRowRes.data as Record<string, unknown> | null;
  const username =
    walletAuth?.username ||
    String(userRow?.handle || user.name || `trader_${user.uid.slice(0, 6)}`)
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .slice(0, 24);
  const displayName =
    walletAuth?.displayName || String(userRow?.display_name || user.name || username);
  const evmAddress = walletAuth?.evmAddress || String(userRow?.linked_wallet || '');
  const solanaAddress = walletAuth?.solanaAddress || '';
  const cscAddress = walletAuth?.cscAddress || '';
  const primaryWallet = evmAddress || solanaAddress || cscAddress || '';

  return {
    uid: user.uid,
    username,
    displayName,
    evmAddress,
    solanaAddress,
    cscAddress,
    primaryWallet,
    verifiedWallet: Boolean(primaryWallet),
  };
}

function getVaultAddressForAsset(asset: P2PAsset): string {
  if (asset === 'SOL') return ESCROW_VAULTS.solana;
  if (asset === 'ETH' || asset === 'BNB') return ESCROW_VAULTS.evm;
  return ESCROW_VAULTS.csc;
}

function isVaultCapableAsset(asset: P2PAsset): boolean {
  return asset === 'CSC' || asset === 'USDT' || asset === 'USD1' || asset === 'SOL';
}

function enrichAd(
  ad: P2PAd,
  allOrders: P2POrder[],
  spotPricesUsd: Record<P2PAsset, number>
): P2PAd {
  const spotUsd = spotPricesUsd[ad.asset] || 1;
  const country = getCountryByCode(ad.countryCode);
  const baseFiat = spotUsd * (ad.fiatCurrency === country.currency ? country.ratePerUsd : 1);
  const effectivePriceFiat =
    ad.priceType === 'floating'
      ? Number((baseFiat * (1 + ad.floatingMarginPct / 100)).toFixed(4))
      : ad.fixedPriceFiat;

  const makerOrders = allOrders.filter(
    (o) => o.sellerUid === ad.makerUid || o.buyerUid === ad.makerUid
  );
  const completed = makerOrders.filter(
    (o) => o.status === 'released' || o.status === 'resolved_buyer'
  );
  const terminal = makerOrders.filter(
    (o) =>
      o.status === 'released' ||
      o.status === 'resolved_buyer' ||
      o.status === 'resolved_seller' ||
      o.status === 'cancelled'
  );
  const completionRatePct =
    terminal.length > 0 ? Math.round((completed.length / terminal.length) * 100) : 100;

  const avgReleaseMins =
    completed.length > 0
      ? Math.max(
          1,
          Math.round(
            completed.reduce((sum, o) => {
              const start = o.fiatPaidAt || o.createdAt;
              const end = o.completedAt || o.updatedAt;
              return sum + Math.max(60_000, end - start);
            }, 0) /
              completed.length /
              60_000
          )
        )
      : 4;

  return {
    ...ad,
    effectivePriceFiat,
    spotPriceUsd: spotUsd,
    makerStats: {
      completedOrders: completed.length,
      completionRatePct,
      avgReleaseMins,
      verifiedWallet: Boolean(ad.makerWalletAddress),
    },
  };
}

export function registerP2PRoutes(app: Express, deps: P2PRouteDeps) {
  const {
    httpServer,
    getSupabaseAdminClient,
    authenticateToken,
    requireAuth,
    requireAdmin,
    isUserAdmin,
    getLiveSpotPricesUsd,
  } = deps;

  async function buildSpotPrices(supabase: SupabaseClient | null): Promise<Record<P2PAsset, number>> {
    const [live, cscUsd] = await Promise.all([
      getLiveSpotPricesUsd().catch(() => ({}) as Record<string, number>),
      getCscSpotPriceUsd(supabase),
    ]);
    return {
      USDT: live.tether || 1.0,
      USD1: 1.0,
      CSC: cscUsd,
      SOL: live.solana || 185,
      ETH: live.ethereum || 3100,
      BNB: live.binancecoin || 615,
    };
  }

  // --- REAL-TIME WEBSOCKET CHAT & ESCROW HUB (/ws/p2p) ---
  interface WsClientMeta {
    ws: WebSocket;
    user: P2PAuthUser;
    username: string;
    isAdmin: boolean;
    rooms: Set<string>;
  }

  const roomSubscribers = new Map<string, Set<WsClientMeta>>();
  const roomTyping = new Map<string, Map<string, { username: string; expiresAt: number }>>();

  function getActiveTypingList(roomId: string): Array<{ uid: string; username: string }> {
    const map = roomTyping.get(roomId);
    if (!map) return [];
    const now = Date.now();
    const list: Array<{ uid: string; username: string }> = [];
    for (const [uid, entry] of map.entries()) {
      if (entry.expiresAt <= now) {
        map.delete(uid);
      } else {
        list.push({ uid, username: entry.username });
      }
    }
    return list;
  }

  function broadcastToRoom(roomId: string, payload: unknown) {
    const subs = roomSubscribers.get(roomId);
    if (!subs || subs.size === 0) return;
    const raw = JSON.stringify(payload);
    for (const client of subs) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(raw);
      }
    }
  }

  function broadcastPresence(roomId: string) {
    const subs = roomSubscribers.get(roomId);
    if (!subs) return;
    const seen = new Map<string, { uid: string; username: string; isAdmin: boolean }>();
    for (const c of subs) {
      seen.set(c.user.uid, { uid: c.user.uid, username: c.username, isAdmin: c.isAdmin });
    }
    broadcastToRoom(roomId, {
      type: 'room:presence',
      orderId: roomId,
      onlineUsers: Array.from(seen.values()),
    });
  }

  function leaveRoom(client: WsClientMeta, roomId: string) {
    client.rooms.delete(roomId);
    const subs = roomSubscribers.get(roomId);
    if (subs) {
      subs.delete(client);
      if (subs.size === 0) roomSubscribers.delete(roomId);
    }
    const typers = roomTyping.get(roomId);
    if (typers?.has(client.user.uid)) {
      typers.delete(client.user.uid);
      broadcastToRoom(roomId, {
        type: 'chat:typing',
        orderId: roomId,
        typingUsers: getActiveTypingList(roomId),
      });
    }
    broadcastPresence(roomId);
  }

  if (httpServer) {
    const wss = new WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (request, socket, head) => {
      try {
        const reqUrl = new URL(request.url || '/', 'http://localhost');
        if (reqUrl.pathname !== '/ws/p2p') return;

        const token = reqUrl.searchParams.get('token') || '';
        if (!token) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        void (async () => {
          try {
            const user = await authenticateToken(token);
            const supabase = getSupabaseAdminClient();
            const [identity, adminFlag] = supabase
              ? await Promise.all([
                  resolveBoundTraderIdentity(supabase, user),
                  isUserAdmin(supabase, user),
                ])
              : [{ username: user.name || 'trader' }, false];

            wss.handleUpgrade(request, socket, head, (ws) => {
              const clientMeta: WsClientMeta = {
                ws,
                user,
                username: identity.username,
                isAdmin: adminFlag,
                rooms: new Set(),
              };

              ws.send(
                JSON.stringify({
                  type: 'ws:ready',
                  uid: user.uid,
                  username: identity.username,
                  isAdmin: adminFlag,
                })
              );

              ws.on('message', (rawBuf) => {
                void (async () => {
                  let parsed: Record<string, unknown>;
                  try {
                    parsed = JSON.parse(rawBuf.toString('utf8')) as Record<string, unknown>;
                  } catch {
                    return;
                  }

                  const evType = String(parsed.type || '');
                  const orderId = String(parsed.orderId || '').trim();
                  if (!orderId) return;

                  const sb = getSupabaseAdminClient();
                  if (!sb) return;

                  if (evType === 'room:join') {
                    const { state } = await loadP2PState(sb);
                    const order = state.orders[orderId];
                    if (!order) {
                      ws.send(JSON.stringify({ type: 'ws:error', error: 'Order not found.' }));
                      return;
                    }
                    const allowed =
                      order.buyerUid === user.uid ||
                      order.sellerUid === user.uid ||
                      clientMeta.isAdmin;
                    if (!allowed) {
                      ws.send(JSON.stringify({ type: 'ws:error', error: 'Access denied to trade room.' }));
                      return;
                    }

                    clientMeta.rooms.add(orderId);
                    if (!roomSubscribers.has(orderId)) roomSubscribers.set(orderId, new Set());
                    roomSubscribers.get(orderId)!.add(clientMeta);

                    ws.send(
                      JSON.stringify({
                        type: 'room:init',
                        orderId,
                        order,
                        messages: state.messages[orderId] || [],
                        typingUsers: getActiveTypingList(orderId),
                      })
                    );
                    broadcastPresence(orderId);
                    return;
                  }

                  if (evType === 'room:leave') {
                    leaveRoom(clientMeta, orderId);
                    return;
                  }

                  if (evType === 'chat:typing') {
                    if (!clientMeta.rooms.has(orderId)) return;
                    const isTyping = Boolean(parsed.isTyping);
                    if (!roomTyping.has(orderId)) roomTyping.set(orderId, new Map());
                    const map = roomTyping.get(orderId)!;
                    if (isTyping) {
                      map.set(user.uid, {
                        username: clientMeta.username,
                        expiresAt: Date.now() + 3500,
                      });
                    } else {
                      map.delete(user.uid);
                    }
                    broadcastToRoom(orderId, {
                      type: 'chat:typing',
                      orderId,
                      typingUsers: getActiveTypingList(orderId),
                    });
                    return;
                  }

                  if (evType === 'chat:send') {
                    const text = String(parsed.text || '').trim().slice(0, 1200);
                    const txHash = String(parsed.txHash || '').trim().slice(0, 128);
                    let attachmentImage = '';
                    if (parsed.attachmentImage) {
                      attachmentImage = validateProofImageDataUrl(parsed.attachmentImage);
                    }
                    if (!text && !attachmentImage && !txHash) return;

                    const clientMsgId = String(parsed.clientId || '').trim();
                    const msg = await withP2PLock(async () => {
                      const { state, mode } = await loadP2PState(sb);
                      const order = state.orders[orderId];
                      if (!order) throw new Error('Order not found.');
                      const isParticipant =
                        order.buyerUid === user.uid ||
                        order.sellerUid === user.uid ||
                        clientMeta.isAdmin;
                      if (!isParticipant) throw new Error('Unauthorized room message.');

                      const existingList = state.messages[orderId] || [];
                      if (clientMsgId) {
                        const dup = existingList.find((m) => m.id === clientMsgId);
                        if (dup) return dup;
                      }

                      const senderRole: P2PChatMessage['senderRole'] =
                        order.buyerUid === user.uid
                          ? 'buyer'
                          : order.sellerUid === user.uid
                          ? 'seller'
                          : 'admin';

                      const created: P2PChatMessage = {
                        id: clientMsgId || makeId('p2pm'),
                        orderId,
                        senderUid: user.uid,
                        senderUsername: clientMeta.username,
                        senderRole,
                        kind: attachmentImage ? 'payment_proof' : txHash ? 'escrow_proof' : 'text',
                        text,
                        attachmentImage: attachmentImage || undefined,
                        txHash: txHash || undefined,
                        createdAt: Date.now(),
                      };

                      await persistMessage(sb, state, mode, created);
                      return created;
                    });

                    // Clear typer upon sending
                    const typers = roomTyping.get(orderId);
                    if (typers?.delete(user.uid)) {
                      broadcastToRoom(orderId, {
                        type: 'chat:typing',
                        orderId,
                        typingUsers: getActiveTypingList(orderId),
                      });
                    }

                    broadcastToRoom(orderId, {
                      type: 'chat:message',
                      orderId,
                      message: msg,
                    });
                  }
                })().catch((err) => {
                  ws.send(
                    JSON.stringify({
                      type: 'ws:error',
                      error: err instanceof Error ? err.message : 'WebSocket operation failed.',
                    })
                  );
                });
              });

              ws.on('close', () => {
                for (const rid of Array.from(clientMeta.rooms)) {
                  leaveRoom(clientMeta, rid);
                }
              });
            });
          } catch {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
          }
        })();
      } catch {
        socket.destroy();
      }
    });

    // Sweep stale typing indicators periodically
    const typingSweep = setInterval(() => {
      const now = Date.now();
      for (const [roomId, map] of roomTyping.entries()) {
        let changed = false;
        for (const [uid, entry] of map.entries()) {
          if (entry.expiresAt <= now) {
            map.delete(uid);
            changed = true;
          }
        }
        if (changed) {
          broadcastToRoom(roomId, {
            type: 'chat:typing',
            orderId: roomId,
            typingUsers: getActiveTypingList(roomId),
          });
        }
      }
    }, 2000);
    typingSweep.unref();
  }

  async function appendSystemMessageAndBroadcast(
    supabase: SupabaseClient,
    state: StoredP2PState,
    mode: 'normalized' | 'snapshot',
    order: P2POrder,
    text: string,
    extra: Partial<Pick<P2PChatMessage, 'kind' | 'attachmentImage' | 'txHash'>> = {}
  ) {
    const sysMsg: P2PChatMessage = {
      id: makeId('p2pm'),
      orderId: order.id,
      senderUid: 'system',
      senderUsername: 'ChainScope Escrow',
      senderRole: 'system',
      kind: extra.kind || 'system',
      text,
      attachmentImage: extra.attachmentImage,
      txHash: extra.txHash,
      createdAt: Date.now(),
    };
    await persistMessage(supabase, state, mode, sysMsg);
    broadcastToRoom(order.id, { type: 'chat:message', orderId: order.id, message: sysMsg });
    broadcastToRoom(order.id, { type: 'order:updated', orderId: order.id, order });
  }

  // --- 1. PUBLIC/AUTHED MARKETPLACE OVERVIEW ---
  app.get('/api/db/p2p/overview', async (req, res) => {
    const supabase = getSupabaseAdminClient();
    const spotPricesUsd = await buildSpotPrices(supabase);

    if (!supabase) {
      const empty: P2POverviewResponse = {
        ads: [],
        myOrders: [],
        myPaymentProfiles: [],
        spotPricesUsd,
        escrowVaults: ESCROW_VAULTS,
        stats: {
          activeAds: 0,
          openOrders: 0,
          completedTrades: 0,
          countriesSupported: P2P_COUNTRIES.length,
          paymentMethodsCount: getAllPaymentMethodsCount(),
        },
      };
      res.json(empty);
      return;
    }

    let authUser: P2PAuthUser | null = null;
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (token) {
      try {
        authUser = await authenticateToken(token);
      } catch {
        authUser = null;
      }
    }

    try {
      const { state } = await loadP2PState(supabase);
      const allOrders = Object.values(state.orders).sort((a, b) => b.updatedAt - a.updatedAt);
      const allAds = Object.values(state.ads)
        .filter((a) => a.status !== 'closed')
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((ad) => enrichAd(ad, allOrders, spotPricesUsd));

      const myOrders = authUser
        ? allOrders.filter((o) => o.buyerUid === authUser!.uid || o.sellerUid === authUser!.uid)
        : [];
      const myPaymentProfiles = authUser
        ? Object.values(state.paymentProfiles)
            .filter((p) => p.ownerUid === authUser!.uid)
            .sort((a, b) => b.updatedAt - a.updatedAt)
        : [];

      res.json({
        ads: allAds,
        myOrders,
        myPaymentProfiles,
        spotPricesUsd,
        escrowVaults: ESCROW_VAULTS,
        stats: {
          activeAds: allAds.filter((a) => a.status === 'active').length,
          openOrders: allOrders.filter(
            (o) =>
              o.status === 'awaiting_escrow' ||
              o.status === 'escrow_locked' ||
              o.status === 'fiat_paid' ||
              o.status === 'disputed'
          ).length,
          completedTrades: allOrders.filter(
            (o) => o.status === 'released' || o.status === 'resolved_buyer'
          ).length,
          countriesSupported: P2P_COUNTRIES.length,
          paymentMethodsCount: getAllPaymentMethodsCount(),
        },
      } satisfies P2POverviewResponse);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Unable to load P2P marketplace',
      });
    }
  });

  // --- 2. SAVED PAYMENT RAILS (ANY COUNTRY / METHOD) ---
  app.post('/api/db/p2p/payment-profiles', requireAuth, async (req: P2PAuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase not configured.' });
      return;
    }

    const body = (req.body || {}) as {
      countryCode?: string;
      methodId?: string;
      accountHolder?: string;
      accountDetails?: string;
      instructions?: string;
    };

    const country = getCountryByCode(String(body.countryCode || 'US'));
    const methodDef = getPaymentMethodById(String(body.methodId || ''), country.code);
    if (!methodDef) {
      res.status(400).json({ error: 'Select a valid payment method.' });
      return;
    }
    const accountHolder = String(body.accountHolder || '').trim().slice(0, 96);
    const accountDetails = String(body.accountDetails || '').trim().slice(0, 280);
    if (!accountHolder || !accountDetails) {
      res.status(400).json({ error: 'Account holder name and payment details are required.' });
      return;
    }

    try {
      const saved = await withP2PLock(async () => {
        const { state, mode } = await loadP2PState(supabase);
        const now = Date.now();
        const prof: P2PSavedPaymentMethod = {
          id: makeId('p2ppay'),
          ownerUid: req.authUser!.uid,
          countryCode: country.code,
          currency: country.currency,
          methodId: methodDef.id,
          methodName: methodDef.name,
          accountHolder,
          accountDetails,
          instructions: String(body.instructions || '').trim().slice(0, 240),
          createdAt: now,
          updatedAt: now,
        };
        await persistProfile(supabase, state, mode, prof);
        return prof;
      });
      res.json({ paymentProfile: saved });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to save payment rail' });
    }
  });

  app.delete('/api/db/p2p/payment-profiles/:id', requireAuth, async (req: P2PAuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase not configured.' });
      return;
    }
    const id = String(req.params.id || '');
    try {
      await withP2PLock(async () => {
        const { state, mode } = await loadP2PState(supabase);
        const existing = state.paymentProfiles[id];
        if (!existing || existing.ownerUid !== req.authUser!.uid) {
          throw new Error('Payment profile not found.');
        }
        await deletePersistedProfile(supabase, state, mode, id);
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Delete failed' });
    }
  });

  // --- 3. POST A P2P OFFER AD ---
  app.post('/api/db/p2p/ads', requireAuth, async (req: P2PAuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase not configured.' });
      return;
    }

    const body = (req.body || {}) as {
      side?: P2PAdSide;
      asset?: P2PAsset;
      countryCode?: string;
      priceType?: P2PPriceType;
      fixedPriceFiat?: number;
      floatingMarginPct?: number;
      availableCryptoAmount?: number;
      minFiatOrder?: number;
      maxFiatOrder?: number;
      paymentMethodIds?: string[];
      paymentWindowMins?: number;
      escrowMode?: P2PEscrowMode;
      terms?: string;
    };

    const side: P2PAdSide = body.side === 'buy' ? 'buy' : 'sell';
    const asset = String(body.asset || 'USDT').toUpperCase() as P2PAsset;
    if (!SUPPORTED_ASSETS.includes(asset)) {
      res.status(400).json({ error: 'Unsupported P2P crypto asset.' });
      return;
    }

    const country = getCountryByCode(String(body.countryCode || 'US'));
    const priceType: P2PPriceType = body.priceType === 'floating' ? 'floating' : 'fixed';
    const fixedPriceFiat = Number(body.fixedPriceFiat ?? 0);
    const floatingMarginPct = Math.max(-25, Math.min(25, Number(body.floatingMarginPct ?? 0)));
    const availableCryptoAmount = Number(body.availableCryptoAmount ?? 0);
    const minFiatOrder = Number(body.minFiatOrder ?? 10);
    const maxFiatOrder = Number(body.maxFiatOrder ?? 5000);
    const paymentWindowMins = Math.max(10, Math.min(60, Math.round(Number(body.paymentWindowMins ?? 15))));

    if (priceType === 'fixed' && (!Number.isFinite(fixedPriceFiat) || fixedPriceFiat <= 0)) {
      res.status(400).json({ error: 'Enter a valid fixed fiat price.' });
      return;
    }
    if (!Number.isFinite(availableCryptoAmount) || availableCryptoAmount <= 0) {
      res.status(400).json({ error: 'Enter a valid crypto quantity.' });
      return;
    }
    if (!Number.isFinite(minFiatOrder) || minFiatOrder <= 0 || maxFiatOrder < minFiatOrder) {
      res.status(400).json({ error: 'Order fiat limits are invalid (Max must be >= Min).' });
      return;
    }

    const rawMethodIds = Array.isArray(body.paymentMethodIds) ? body.paymentMethodIds.slice(0, 6) : [];
    const resolvedMethods = rawMethodIds
      .map((id) => getPaymentMethodById(String(id), country.code))
      .filter((m): m is NonNullable<typeof m> => Boolean(m));

    if (resolvedMethods.length === 0) {
      res.status(400).json({ error: 'Select at least 1 supported payment method.' });
      return;
    }

    const requestedEscrow: P2PEscrowMode =
      body.escrowMode === 'onchain_proof' ? 'onchain_proof' : 'vault_balance';
    const escrowMode: P2PEscrowMode = isVaultCapableAsset(asset) ? requestedEscrow : 'onchain_proof';

    try {
      const identity = await resolveBoundTraderIdentity(supabase, req.authUser!);
      if (!identity.verifiedWallet) {
        res.status(400).json({
          error:
            'Your @username must have a bound wallet address before posting P2P offers. Connect or create your 1:1 wallet first.',
        });
        return;
      }

      const spotPricesUsd = await buildSpotPrices(supabase);
      const created = await withP2PLock(async () => {
        const { state, mode } = await loadP2PState(supabase);
        const now = Date.now();
        const ad: P2PAd = {
          id: makeId('p2pad'),
          makerUid: identity.uid,
          makerUsername: identity.username,
          makerDisplayName: identity.displayName,
          makerWalletAddress: identity.primaryWallet,
          makerEvmAddress: identity.evmAddress,
          makerSolanaAddress: identity.solanaAddress,
          makerCscAddress: identity.cscAddress,
          side,
          asset,
          countryCode: country.code,
          fiatCurrency: country.currency,
          priceType,
          fixedPriceFiat: priceType === 'fixed' ? fixedPriceFiat : 0,
          floatingMarginPct: priceType === 'floating' ? floatingMarginPct : 0,
          effectivePriceFiat: fixedPriceFiat,
          spotPriceUsd: spotPricesUsd[asset] || 1,
          availableCryptoAmount: Number(availableCryptoAmount.toFixed(6)),
          minFiatOrder: Number(minFiatOrder.toFixed(2)),
          maxFiatOrder: Number(maxFiatOrder.toFixed(2)),
          paymentMethodIds: resolvedMethods.map((m) => m.id),
          paymentMethodNames: resolvedMethods.map((m) => m.name),
          paymentWindowMins,
          escrowMode,
          terms: String(body.terms || '').trim().slice(0, 600),
          status: 'active',
          makerStats: {
            completedOrders: 0,
            completionRatePct: 100,
            avgReleaseMins: 4,
            verifiedWallet: true,
          },
          createdAt: now,
          updatedAt: now,
        };

        await persistAd(supabase, state, mode, ad);
        return enrichAd(ad, Object.values(state.orders), spotPricesUsd);
      });

      res.json({ ad: created });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to post P2P offer' });
    }
  });

  app.patch('/api/db/p2p/ads/:id/status', requireAuth, async (req: P2PAuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase not configured.' });
      return;
    }
    const id = String(req.params.id || '');
    const status = String((req.body as { status?: string } | undefined)?.status || '');
    if (!['active', 'paused', 'closed'].includes(status)) {
      res.status(400).json({ error: 'Invalid status.' });
      return;
    }
    try {
      const updated = await withP2PLock(async () => {
        const { state, mode } = await loadP2PState(supabase);
        const ad = state.ads[id];
        if (!ad) throw new Error('Offer not found.');
        const admin = await isUserAdmin(supabase, req.authUser!);
        if (ad.makerUid !== req.authUser!.uid && !admin) {
          throw new Error('Only the ad owner or KingAdmin can modify this offer.');
        }
        ad.status = status as P2PAd['status'];
        ad.updatedAt = Date.now();
        await persistAd(supabase, state, mode, ad);
        return ad;
      });
      res.json({ ad: updated });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Update failed' });
    }
  });

  // --- 4. OPEN TRADE ORDER FROM AD ---
  app.post('/api/db/p2p/orders', requireAuth, async (req: P2PAuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase not configured.' });
      return;
    }

    const body = (req.body || {}) as {
      adId?: string;
      fiatAmount?: number;
      paymentMethodId?: string;
      sellerPaymentDetails?: {
        accountHolder?: string;
        accountDetails?: string;
        instructions?: string;
      };
    };

    try {
      const takerIdentity = await resolveBoundTraderIdentity(supabase, req.authUser!);
      if (!takerIdentity.verifiedWallet) {
        res.status(400).json({
          error:
            'Your @username must have a bound wallet address to trade on Decentralized P2P.',
        });
        return;
      }

      const spotPricesUsd = await buildSpotPrices(supabase);

      const order = await withP2PLock(async () => {
        const { state, mode } = await loadP2PState(supabase);
        const rawAd = state.ads[String(body.adId || '')];
        if (!rawAd || rawAd.status !== 'active') {
          throw new Error('This P2P offer is no longer active.');
        }
        if (rawAd.makerUid === takerIdentity.uid) {
          throw new Error('You cannot trade against your own P2P offer.');
        }

        const ad = enrichAd(rawAd, Object.values(state.orders), spotPricesUsd);
        const fiatAmount = Number(body.fiatAmount ?? 0);
        if (!Number.isFinite(fiatAmount) || fiatAmount < ad.minFiatOrder || fiatAmount > ad.maxFiatOrder) {
          throw new Error(
            `Order amount must be between ${ad.minFiatOrder} and ${ad.maxFiatOrder} ${ad.fiatCurrency}.`
          );
        }

        const cryptoAmount = Number((fiatAmount / Math.max(0.000001, ad.effectivePriceFiat)).toFixed(6));
        if (cryptoAmount <= 0 || cryptoAmount > ad.availableCryptoAmount + 1e-6) {
          throw new Error(
            `Requested ${cryptoAmount} ${ad.asset} exceeds ad availability (${ad.availableCryptoAmount} ${ad.asset}).`
          );
        }

        const chosenMethodId =
          ad.paymentMethodIds.find((m) => m === body.paymentMethodId) || ad.paymentMethodIds[0];
        const chosenMethodName =
          getPaymentMethodById(chosenMethodId, ad.countryCode)?.name ||
          ad.paymentMethodNames[0] ||
          chosenMethodId;

        // If ad.side === 'sell', maker is selling crypto (maker = seller, taker = buyer).
        // If ad.side === 'buy', maker is buying crypto (maker = buyer, taker = seller).
        const sellerUid = ad.side === 'sell' ? ad.makerUid : takerIdentity.uid;
        const sellerUsername = ad.side === 'sell' ? ad.makerUsername : takerIdentity.username;
        const sellerWalletAddress =
          ad.side === 'sell' ? ad.makerWalletAddress : takerIdentity.primaryWallet;

        const buyerUid = ad.side === 'sell' ? takerIdentity.uid : ad.makerUid;
        const buyerUsername = ad.side === 'sell' ? takerIdentity.username : ad.makerUsername;
        const buyerWalletAddress =
          ad.side === 'sell' ? takerIdentity.primaryWallet : ad.makerWalletAddress;

        const sellerSavedProfile = Object.values(state.paymentProfiles).find(
          (p) => p.ownerUid === sellerUid && p.methodId === chosenMethodId
        );

        const paymentSnapshot = {
          accountHolder:
            String(body.sellerPaymentDetails?.accountHolder || '').trim() ||
            sellerSavedProfile?.accountHolder ||
            `@${sellerUsername}`,
          accountDetails:
            String(body.sellerPaymentDetails?.accountDetails || '').trim() ||
            sellerSavedProfile?.accountDetails ||
            'Share receiving details in trade chat before sending fiat.',
          instructions:
            String(body.sellerPaymentDetails?.instructions || '').trim() ||
            sellerSavedProfile?.instructions ||
            ad.terms ||
            'Include the Order ID in payment notes only if required; avoid crypto keywords.',
        };

        const feeCrypto = Number((cryptoAmount * P2P_ESCROW_FEE_RATE).toFixed(6));
        const netBuyerCrypto = Number(Math.max(0, cryptoAmount - feeCrypto).toFixed(6));
        const now = Date.now();

        const createdOrder: P2POrder = {
          id: makeId('p2po'),
          adId: ad.id,
          asset: ad.asset,
          countryCode: ad.countryCode,
          fiatCurrency: ad.fiatCurrency,
          unitPriceFiat: ad.effectivePriceFiat,
          cryptoAmount,
          fiatAmount: Number(fiatAmount.toFixed(2)),
          feeCrypto,
          netBuyerCrypto,
          buyerUid,
          buyerUsername,
          buyerWalletAddress,
          sellerUid,
          sellerUsername,
          sellerWalletAddress,
          paymentMethodId: chosenMethodId,
          paymentMethodName: chosenMethodName,
          paymentSnapshot,
          escrowMode: ad.escrowMode,
          escrowAssetLocked: false,
          escrowLockedAmount: 0,
          escrowTxHash: '',
          escrowSignature: '',
          escrowVaultAddress: getVaultAddressForAsset(ad.asset),
          fiatProofRef: '',
          fiatProofImage: '',
          fiatProofNote: '',
          status: 'awaiting_escrow',
          disputeReason: '',
          disputedByUid: '',
          adminResolutionNote: '',
          resolvedByUid: '',
          resolvedByHandle: '',
          paymentDeadlineAt: now + ad.paymentWindowMins * 60_000,
          createdAt: now,
          updatedAt: now,
        };

        // Reserve liquidity from ad
        rawAd.availableCryptoAmount = Number(
          Math.max(0, rawAd.availableCryptoAmount - cryptoAmount).toFixed(6)
        );
        if (rawAd.availableCryptoAmount <= 0.000001) {
          rawAd.status = 'paused';
        }
        rawAd.updatedAt = now;

        await persistAd(supabase, state, mode, rawAd);
        await persistOrder(supabase, state, mode, createdOrder);
        await appendSystemMessageAndBroadcast(
          supabase,
          state,
          mode,
          createdOrder,
          `Trade opened between Buyer @${buyerUsername} and Seller @${sellerUsername} for ${cryptoAmount} ${ad.asset} (${createdOrder.fiatAmount} ${createdOrder.fiatCurrency} via ${chosenMethodName}). Step 1: Seller locks ${cryptoAmount} ${ad.asset} into Escrow before Buyer sends fiat.`
        );

        return createdOrder;
      });

      res.json({ order });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to create trade order' });
    }
  });

  // --- 5. FETCH SINGLE ORDER & CHAT MESSAGES ---
  app.get('/api/db/p2p/orders/:id', requireAuth, async (req: P2PAuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase not configured.' });
      return;
    }
    const id = String(req.params.id || '');
    try {
      const [{ state }, admin] = await Promise.all([
        loadP2PState(supabase),
        isUserAdmin(supabase, req.authUser!),
      ]);
      const order = state.orders[id];
      if (!order) {
        res.status(404).json({ error: 'Order not found.' });
        return;
      }
      if (
        order.buyerUid !== req.authUser!.uid &&
        order.sellerUid !== req.authUser!.uid &&
        !admin
      ) {
        res.status(403).json({ error: 'Forbidden.' });
        return;
      }
      res.json({ order, messages: state.messages[id] || [] });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Load order failed' });
    }
  });

  // --- 6. SELLER LOCKS CRYPTO IN ESCROW (VAULT OR ON-CHAIN PROOF) ---
  app.post('/api/db/p2p/orders/:id/lock-escrow', requireAuth, async (req: P2PAuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase not configured.' });
      return;
    }
    const id = String(req.params.id || '');
    const body = (req.body || {}) as {
      mode?: P2PEscrowMode;
      txHash?: string;
      signature?: string;
      sellerPaymentDetails?: {
        accountHolder?: string;
        accountDetails?: string;
        instructions?: string;
      };
    };

    try {
      const order = await withP2PLock(async () => {
        const { state, mode } = await loadP2PState(supabase);
        const ord = state.orders[id];
        if (!ord) throw new Error('Order not found.');
        if (ord.sellerUid !== req.authUser!.uid) {
          throw new Error('Only the Seller can lock crypto into Escrow.');
        }
        if (ord.status !== 'awaiting_escrow') {
          throw new Error(`Cannot lock escrow from state "${ord.status}".`);
        }

        const chosenMode: P2PEscrowMode =
          body.mode === 'onchain_proof'
            ? 'onchain_proof'
            : isVaultCapableAsset(ord.asset)
            ? 'vault_balance'
            : 'onchain_proof';

        if (body.sellerPaymentDetails?.accountDetails?.trim()) {
          ord.paymentSnapshot = {
            accountHolder:
              String(body.sellerPaymentDetails.accountHolder || '').trim() ||
              ord.paymentSnapshot.accountHolder,
            accountDetails: body.sellerPaymentDetails.accountDetails.trim(),
            instructions:
              String(body.sellerPaymentDetails.instructions || '').trim() ||
              ord.paymentSnapshot.instructions,
          };
        }

        let txHash = '';
        let signature = '';

        if (chosenMode === 'vault_balance') {
          if (ord.asset === 'SOL') {
            const { data: userRow, error: userErr } = await supabase
              .from('chainscope_users')
              .select('sol_balance')
              .eq('uid', ord.sellerUid)
              .maybeSingle();
            if (userErr) throw new Error(userErr.message);
            const curSol = Number(userRow?.sol_balance ?? 0);
            if (curSol + 1e-9 < ord.cryptoAmount) {
              throw new Error(
                `Insufficient SOL vault balance (${curSol.toFixed(4)} SOL available). Switch to On-Chain Wallet TX Escrow or deposit coins.`
              );
            }
            const nextSol = Number((curSol - ord.cryptoAmount).toFixed(6));
            const { error: updErr } = await supabase
              .from('chainscope_users')
              .update({ sol_balance: nextSol, updated_at: new Date().toISOString() })
              .eq('uid', ord.sellerUid);
            if (updErr) throw new Error(updErr.message);
            txHash = `vault_sol_${crypto.randomBytes(12).toString('hex')}`;
          } else {
            const op = await executeCscVaultEscrowOp(supabase, {
              action: 'debit',
              uid: ord.sellerUid,
              handle: ord.sellerUsername,
              asset: ord.asset as 'CSC' | 'USDT' | 'USD1',
              amount: ord.cryptoAmount,
              note: `P2P Escrow Lock #${ord.id} for @${ord.buyerUsername}`,
            });
            txHash = op.txHash;
          }
        } else {
          const cleanHash = String(body.txHash || '').trim();
          if (cleanHash.length < 24 || !/^(0x[a-fA-F0-9]{20,}|[1-9A-HJ-NP-Za-km-z]{32,120})$/.test(cleanHash)) {
            throw new Error(
              'Provide a valid on-chain transaction hash (0x... or Solana TX signature) transferring coins to the Escrow Vault.'
            );
          }
          txHash = cleanHash;
          signature = String(body.signature || '').trim().slice(0, 260);
          if (signature && ethers.isAddress(ord.sellerWalletAddress)) {
            try {
              const expectedMsg = `ChainScope P2P Escrow Lock\nOrder: ${ord.id}\nAmount: ${ord.cryptoAmount} ${ord.asset}\nTX: ${txHash}`;
              const recovered = ethers.verifyMessage(expectedMsg, signature);
              if (recovered.toLowerCase() !== ord.sellerWalletAddress.toLowerCase()) {
                throw new Error('Wallet signature does not match Seller bound 1:1 wallet.');
              }
            } catch (sigErr) {
              if (sigErr instanceof Error && sigErr.message.includes('1:1 wallet')) {
                throw sigErr;
              }
            }
          }
        }

        const now = Date.now();
        ord.escrowMode = chosenMode;
        ord.escrowAssetLocked = true;
        ord.escrowLockedAmount = ord.cryptoAmount;
        ord.escrowTxHash = txHash;
        ord.escrowSignature = signature;
        ord.status = 'escrow_locked';
        ord.escrowLockedAt = now;
        ord.paymentDeadlineAt = now + 20 * 60_000;
        ord.updatedAt = now;

        await persistOrder(supabase, state, mode, ord);
        await appendSystemMessageAndBroadcast(
          supabase,
          state,
          mode,
          ord,
          `Seller @${ord.sellerUsername} locked ${ord.cryptoAmount} ${ord.asset} into ChainScope Escrow (${chosenMode === 'vault_balance' ? 'Atomic Vault Lock' : 'On-Chain Wallet TX'}). Buyer @${ord.buyerUsername} may now send ${ord.fiatAmount} ${ord.fiatCurrency} and upload receipt proof.`,
          { kind: 'escrow_proof', txHash }
        );
        return ord;
      });

      res.json({ order });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to lock escrow' });
    }
  });

  // --- 7. BUYER SUBMITS FIAT PAYMENT PROOF ---
  app.post('/api/db/p2p/orders/:id/mark-paid', requireAuth, async (req: P2PAuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase not configured.' });
      return;
    }
    const id = String(req.params.id || '');
    const body = (req.body || {}) as {
      fiatProofRef?: string;
      fiatProofImage?: string;
      fiatProofNote?: string;
    };

    const ref = String(body.fiatProofRef || '').trim().slice(0, 120);
    const note = String(body.fiatProofNote || '').trim().slice(0, 500);
    if (!ref && !body.fiatProofImage) {
      res.status(400).json({ error: 'Attach a payment reference ID or receipt screenshot proof.' });
      return;
    }

    try {
      const img = body.fiatProofImage ? validateProofImageDataUrl(body.fiatProofImage) : '';
      const order = await withP2PLock(async () => {
        const { state, mode } = await loadP2PState(supabase);
        const ord = state.orders[id];
        if (!ord) throw new Error('Order not found.');
        if (ord.buyerUid !== req.authUser!.uid) {
          throw new Error('Only the Buyer can mark fiat as paid.');
        }
        if (ord.status !== 'escrow_locked') {
          throw new Error('Escrow must be locked before marking payment.');
        }

        const now = Date.now();
        ord.fiatProofRef = ref;
        ord.fiatProofImage = img;
        ord.fiatProofNote = note;
        ord.status = 'fiat_paid';
        ord.fiatPaidAt = now;
        ord.updatedAt = now;

        await persistOrder(supabase, state, mode, ord);
        await appendSystemMessageAndBroadcast(
          supabase,
          state,
          mode,
          ord,
          `Buyer @${ord.buyerUsername} submitted fiat payment proof${ref ? ` (Ref: ${ref})` : ''}. Cancellation is now locked. Seller @${ord.sellerUsername}: verify funds received and release Escrow.`,
          { kind: 'payment_proof', attachmentImage: img || undefined }
        );
        return ord;
      });
      res.json({ order });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to submit proof' });
    }
  });

  // --- HELPER: SETTLE ESCROW FUNDS TO BUYER OR SELLER ---
  async function settleEscrowCredit(
    supabase: SupabaseClient,
    ord: P2POrder,
    recipientUid: string,
    recipientHandle: string,
    grossOrNetAmount: number,
    note: string
  ) {
    if (ord.escrowMode === 'vault_balance') {
      if (ord.asset === 'SOL') {
        const { data: userRow } = await supabase
          .from('chainscope_users')
          .select('sol_balance')
          .eq('uid', recipientUid)
          .maybeSingle();
        const nextSol = Number((Number(userRow?.sol_balance ?? 0) + grossOrNetAmount).toFixed(6));
        await supabase
          .from('chainscope_users')
          .update({ sol_balance: nextSol, updated_at: new Date().toISOString() })
          .eq('uid', recipientUid);
      } else {
        await executeCscVaultEscrowOp(supabase, {
          action: 'credit',
          uid: recipientUid,
          handle: recipientHandle,
          asset: ord.asset as 'CSC' | 'USDT' | 'USD1',
          amount: grossOrNetAmount,
          note,
        });
      }
    }
  }

  // --- 8. SELLER RELEASES ESCROW TO BUYER ---
  app.post('/api/db/p2p/orders/:id/release', requireAuth, async (req: P2PAuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase not configured.' });
      return;
    }
    const id = String(req.params.id || '');
    try {
      const order = await withP2PLock(async () => {
        const { state, mode } = await loadP2PState(supabase);
        const ord = state.orders[id];
        if (!ord) throw new Error('Order not found.');
        if (ord.sellerUid !== req.authUser!.uid) {
          throw new Error('Only the Seller can release escrowed crypto.');
        }
        if (ord.status !== 'fiat_paid' && ord.status !== 'escrow_locked') {
          throw new Error(`Cannot release escrow from state "${ord.status}".`);
        }

        await settleEscrowCredit(
          supabase,
          ord,
          ord.buyerUid,
          ord.buyerUsername,
          ord.netBuyerCrypto,
          `P2P Escrow Release #${ord.id} from @${ord.sellerUsername}`
        );

        const now = Date.now();
        ord.status = 'released';
        ord.completedAt = now;
        ord.updatedAt = now;

        await persistOrder(supabase, state, mode, ord);
        await appendSystemMessageAndBroadcast(
          supabase,
          state,
          mode,
          ord,
          `Seller @${ord.sellerUsername} released ${ord.netBuyerCrypto} ${ord.asset} from Escrow to Buyer @${ord.buyerUsername} (${ord.feeCrypto} ${ord.asset} protocol escrow fee). Trade completed!`
        );
        return ord;
      });
      res.json({ order });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to release escrow' });
    }
  });

  // --- 9. CANCEL ORDER (ONLY BEFORE FIAT_PAID, REFUNDS SELLER ESCROW IF LOCKED) ---
  app.post('/api/db/p2p/orders/:id/cancel', requireAuth, async (req: P2PAuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase not configured.' });
      return;
    }
    const id = String(req.params.id || '');
    try {
      const order = await withP2PLock(async () => {
        const { state, mode } = await loadP2PState(supabase);
        const ord = state.orders[id];
        if (!ord) throw new Error('Order not found.');
        if (ord.buyerUid !== req.authUser!.uid && ord.sellerUid !== req.authUser!.uid) {
          throw new Error('Unauthorized.');
        }
        if (ord.status === 'fiat_paid' || ord.status === 'disputed') {
          throw new Error('Cannot cancel after fiat proof is submitted. Open or resolve via KingAdmin moderation.');
        }
        if (ord.status !== 'awaiting_escrow' && ord.status !== 'escrow_locked') {
          throw new Error(`Cannot cancel order in state "${ord.status}".`);
        }

        if (ord.status === 'escrow_locked' && ord.buyerUid !== req.authUser!.uid) {
          throw new Error('Once escrow is locked, only the Buyer may cancel (or open a Dispute).');
        }

        if (ord.escrowAssetLocked && ord.escrowLockedAmount > 0) {
          await settleEscrowCredit(
            supabase,
            ord,
            ord.sellerUid,
            ord.sellerUsername,
            ord.escrowLockedAmount,
            `P2P Cancel Escrow Refund #${ord.id}`
          );
          ord.escrowAssetLocked = false;
        }

        // Restore ad liquidity
        const ad = state.ads[ord.adId];
        if (ad) {
          ad.availableCryptoAmount = Number((ad.availableCryptoAmount + ord.cryptoAmount).toFixed(6));
          if (ad.status === 'paused' && ad.availableCryptoAmount > 0) {
            ad.status = 'active';
          }
          ad.updatedAt = Date.now();
          await persistAd(supabase, state, mode, ad);
        }

        const now = Date.now();
        ord.status = 'cancelled';
        ord.completedAt = now;
        ord.updatedAt = now;

        await persistOrder(supabase, state, mode, ord);
        await appendSystemMessageAndBroadcast(
          supabase,
          state,
          mode,
          ord,
          `Order cancelled. ${ord.escrowLockedAmount > 0 ? 'Locked escrow refunded to Seller.' : 'Ad liquidity restored.'}`
        );
        return ord;
      });
      res.json({ order });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to cancel order' });
    }
  });

  // --- 10. ESCALATE DISPUTE TO KINGADMIN ---
  app.post('/api/db/p2p/orders/:id/dispute', requireAuth, async (req: P2PAuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase not configured.' });
      return;
    }
    const id = String(req.params.id || '');
    const reason = String((req.body as { reason?: string } | undefined)?.reason || '').trim().slice(0, 500);
    if (!reason) {
      res.status(400).json({ error: 'Provide a clear dispute reason for the moderator.' });
      return;
    }

    try {
      const order = await withP2PLock(async () => {
        const { state, mode } = await loadP2PState(supabase);
        const ord = state.orders[id];
        if (!ord) throw new Error('Order not found.');
        if (ord.buyerUid !== req.authUser!.uid && ord.sellerUid !== req.authUser!.uid) {
          throw new Error('Unauthorized.');
        }
        if (!['escrow_locked', 'fiat_paid'].includes(ord.status)) {
          throw new Error('Disputes can only be opened while escrow is locked.');
        }

        ord.status = 'disputed';
        ord.disputeReason = reason;
        ord.disputedByUid = req.authUser!.uid;
        ord.updatedAt = Date.now();

        await persistOrder(supabase, state, mode, ord);
        await appendSystemMessageAndBroadcast(
          supabase,
          state,
          mode,
          ord,
          `DISPUTE ESCALATED to KingAdmin Moderation. Escrow is frozen until Admin reviews chat & payment proof. Reason: "${reason}"`
        );
        return ord;
      });
      res.json({ order });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Dispute escalation failed' });
    }
  });

  // --- 11. REST FALLBACK FOR CHAT MESSAGES ---
  app.post('/api/db/p2p/orders/:id/messages', requireAuth, async (req: P2PAuthedRequest, res) => {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({ error: 'Supabase not configured.' });
      return;
    }
    const id = String(req.params.id || '');
    const body = (req.body || {}) as {
      text?: string;
      attachmentImage?: string;
      txHash?: string;
      clientId?: string;
    };

    try {
      const [identity, admin] = await Promise.all([
        resolveBoundTraderIdentity(supabase, req.authUser!),
        isUserAdmin(supabase, req.authUser!),
      ]);
      const attachmentImage = body.attachmentImage
        ? validateProofImageDataUrl(body.attachmentImage)
        : '';
      const text = String(body.text || '').trim().slice(0, 1200);
      const txHash = String(body.txHash || '').trim().slice(0, 128);
      if (!text && !attachmentImage && !txHash) {
        res.status(400).json({ error: 'Empty message.' });
        return;
      }

      const msg = await withP2PLock(async () => {
        const { state, mode } = await loadP2PState(supabase);
        const ord = state.orders[id];
        if (!ord) throw new Error('Order not found.');
        if (ord.buyerUid !== req.authUser!.uid && ord.sellerUid !== req.authUser!.uid && !admin) {
          throw new Error('Unauthorized.');
        }

        const role: P2PChatMessage['senderRole'] =
          ord.buyerUid === req.authUser!.uid
            ? 'buyer'
            : ord.sellerUid === req.authUser!.uid
            ? 'seller'
            : 'admin';

        const created: P2PChatMessage = {
          id: body.clientId || makeId('p2pm'),
          orderId: id,
          senderUid: req.authUser!.uid,
          senderUsername: identity.username,
          senderRole: role,
          kind: attachmentImage ? 'payment_proof' : txHash ? 'escrow_proof' : 'text',
          text,
          attachmentImage: attachmentImage || undefined,
          txHash: txHash || undefined,
          createdAt: Date.now(),
        };
        await persistMessage(supabase, state, mode, created);
        return created;
      });

      broadcastToRoom(id, { type: 'chat:message', orderId: id, message: msg });
      res.json({ message: msg });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Message failed' });
    }
  });

  // --- 12. KINGADMIN P2P MODERATION QUEUE & ESCROW RESOLUTION ---
  app.get('/api/db/admin/p2p/orders', requireAuth, requireAdmin, async (_req, res) => {
    const supabase = getSupabaseAdminClient()!;
    try {
      const { state } = await loadP2PState(supabase);
      const orders = Object.values(state.orders).sort((a, b) => {
        if (a.status === 'disputed' && b.status !== 'disputed') return -1;
        if (b.status === 'disputed' && a.status !== 'disputed') return 1;
        return b.updatedAt - a.updatedAt;
      });
      res.json({ orders, messagesByOrder: state.messages });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load admin P2P queue' });
    }
  });

  app.post(
    '/api/db/admin/p2p/orders/:id/resolve',
    requireAuth,
    requireAdmin,
    async (req: P2PAuthedRequest, res) => {
      const supabase = getSupabaseAdminClient()!;
      const id = String(req.params.id || '');
      const body = (req.body || {}) as {
        decision?: 'release_to_buyer' | 'refund_to_seller';
        note?: string;
      };
      if (body.decision !== 'release_to_buyer' && body.decision !== 'refund_to_seller') {
        res.status(400).json({ error: 'Decision must be release_to_buyer or refund_to_seller.' });
        return;
      }

      try {
        const adminIdentity = await resolveBoundTraderIdentity(supabase, req.authUser!);
        const order = await withP2PLock(async () => {
          const { state, mode } = await loadP2PState(supabase);
          const ord = state.orders[id];
          if (!ord) throw new Error('Order not found.');
          if (!['disputed', 'fiat_paid', 'escrow_locked'].includes(ord.status)) {
            throw new Error(`Order "${ord.status}" is already finalized.`);
          }

          if (body.decision === 'release_to_buyer') {
            if (ord.escrowAssetLocked) {
              await settleEscrowCredit(
                supabase,
                ord,
                ord.buyerUid,
                ord.buyerUsername,
                ord.netBuyerCrypto,
                `KingAdmin Verdict Release #${ord.id}`
              );
            }
            ord.status = 'resolved_buyer';
          } else {
            if (ord.escrowAssetLocked && ord.escrowLockedAmount > 0) {
              await settleEscrowCredit(
                supabase,
                ord,
                ord.sellerUid,
                ord.sellerUsername,
                ord.escrowLockedAmount,
                `KingAdmin Verdict Refund #${ord.id}`
              );
              ord.escrowAssetLocked = false;
            }
            ord.status = 'resolved_seller';
          }

          const now = Date.now();
          ord.adminResolutionNote =
            String(body.note || '').trim().slice(0, 500) ||
            (body.decision === 'release_to_buyer'
              ? 'Admin verified valid fiat proof and released escrow to Buyer.'
              : 'Admin verified Seller claim and refunded escrow to Seller.');
          ord.resolvedByUid = req.authUser!.uid;
          ord.resolvedByHandle = adminIdentity.username;
          ord.completedAt = now;
          ord.updatedAt = now;

          await persistOrder(supabase, state, mode, ord);
          await appendSystemMessageAndBroadcast(
            supabase,
            state,
            mode,
            ord,
            `KingAdmin @${adminIdentity.username} ruled: ${
              body.decision === 'release_to_buyer' ? 'RELEASE TO BUYER' : 'REFUND TO SELLER'
            }. Note: ${ord.adminResolutionNote}`
          );

          await supabase.from('chainscope_admin_audit_logs').insert({
            id: makeId('audit'),
            actor_uid: req.authUser!.uid,
            actor_handle: adminIdentity.username,
            action: 'P2P_DISPUTE_RESOLVED',
            target_id: ord.id,
            details: `${body.decision} (${ord.cryptoAmount} ${ord.asset}) — ${ord.adminResolutionNote}`,
            created_at: new Date(now).toISOString(),
          });

          return ord;
        });

        res.json({ order });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Admin resolution failed' });
      }
    }
  );
}
