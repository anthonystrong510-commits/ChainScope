import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Gavel,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Settings,
  ShieldAlert,
  Snowflake,
  Trash2,
  Unlock,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useP2PWebSocket } from '../hooks/useP2PWebSocket';
import { formatFiatAmount, getCountryByCode } from '../data/p2pPayments';
import {
  adminMarkP2POrderPaid,
  adminReleaseP2POrder,
  fetchAdminP2POrders,
  resolveAdminP2POrder,
  saveAdminP2PSettings,
} from '../services/p2p';
import type {
  P2PAdminSettings,
  P2PChatMessage,
  P2PEscrowReceivingWallet,
  P2POrder,
} from '../types/p2p';
import { formatTimestamp, truncateAddress } from '../utils/chains';

interface KingAdminP2PPanelProps {
  onNotify: (msg: { type: 'ok' | 'err'; text: string }) => void;
}

const DEFAULT_SETTINGS: P2PAdminSettings = {
  minCompletedTradesToBuy: 0,
  whitelistedBuyerUsernames: [],
  autoMarkPaidOnProof: true,
  autoReleaseEnabled: false,
  autoReleaseAfterMins: 15,
  escrowReceivingWallets: [],
  updatedAt: 0,
  updatedByHandle: 'system',
};

export function KingAdminP2PPanel({ onNotify }: KingAdminP2PPanelProps) {
  const { user } = useAuth();
  const [sectionTab, setSectionTab] = useState<'queue' | 'automation' | 'wallets'>('queue');
  const [orders, setOrders] = useState<P2POrder[]>([]);
  const [messagesByOrder, setMessagesByOrder] = useState<Record<string, P2PChatMessage[]>>({});
  const [settings, setSettings] = useState<P2PAdminSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'disputed' | 'active' | 'all'>('disputed');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolving, setResolving] = useState<string | null>(null);
  const [adminMsgInput, setAdminMsgInput] = useState('');
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Automation & Buy Gate form state
  const [minTradesInput, setMinTradesInput] = useState('0');
  const [whitelistInput, setWhitelistInput] = useState('');
  const [autoMarkPaid, setAutoMarkPaid] = useState(true);
  const [autoReleaseEnabled, setAutoReleaseEnabled] = useState(false);
  const [autoReleaseMins, setAutoReleaseMins] = useState('15');
  const [savingSettings, setSavingSettings] = useState(false);

  // Receiving Wallets form state (Cold Wallets = Public Keys Only)
  const [receivingWallets, setReceivingWallets] = useState<P2PEscrowReceivingWallet[]>([]);
  const [newWalletLabel, setNewWalletLabel] = useState('');
  const [newWalletChain, setNewWalletChain] = useState<'evm' | 'solana' | 'csc'>('evm');
  const [newWalletType, setNewWalletType] = useState<'cold_public' | 'hot_escrow'>('cold_public');
  const [newWalletPublicAddr, setNewWalletPublicAddr] = useState('');

  const syncSettingsToForm = useCallback((s: P2PAdminSettings) => {
    setSettings(s);
    setMinTradesInput(String(s.minCompletedTradesToBuy ?? 0));
    setWhitelistInput((s.whitelistedBuyerUsernames || []).join(', '));
    setAutoMarkPaid(Boolean(s.autoMarkPaidOnProof));
    setAutoReleaseEnabled(Boolean(s.autoReleaseEnabled));
    setAutoReleaseMins(String(s.autoReleaseAfterMins ?? 15));
    setReceivingWallets(s.escrowReceivingWallets || []);
  }, []);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAdminP2POrders();
      setOrders(res.orders);
      setMessagesByOrder(res.messagesByOrder);
      if (res.settings) {
        syncSettingsToForm(res.settings);
      }
      if (!selectedOrderId && res.orders.length > 0) {
        const firstDisputed = res.orders.find((o) => o.status === 'disputed');
        setSelectedOrderId(firstDisputed?.id || res.orders[0].id);
      }
    } catch (err) {
      onNotify({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to load P2P moderation queue',
      });
    } finally {
      setLoading(false);
    }
  }, [onNotify, selectedOrderId, syncSettingsToForm]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const selectedOrder = useMemo(
    () => orders.find((o) => o.id === selectedOrderId) || null,
    [orders, selectedOrderId]
  );

  const { connected, messages: wsMessages, typingUsers, emitTyping, sendMessage, seedMessages } =
    useP2PWebSocket(selectedOrder?.id || null, user?.uid || null, (updated) => {
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    });

  useEffect(() => {
    if (selectedOrder && messagesByOrder[selectedOrder.id]) {
      seedMessages(messagesByOrder[selectedOrder.id]);
    }
  }, [selectedOrder, messagesByOrder, seedMessages]);

  const filteredOrders = useMemo(() => {
    if (filter === 'disputed') return orders.filter((o) => o.status === 'disputed');
    if (filter === 'active') {
      return orders.filter((o) =>
        ['awaiting_escrow', 'escrow_locked', 'fiat_paid', 'disputed'].includes(o.status)
      );
    }
    return orders;
  }, [orders, filter]);

  const disputedCount = orders.filter((o) => o.status === 'disputed').length;

  const copyAddr = (val: string, id: string) => {
    void navigator.clipboard.writeText(val);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
  };

  const handleAdminMarkPaid = async () => {
    if (!selectedOrder) return;
    setResolving('mark_paid');
    try {
      const updated = await adminMarkP2POrderPaid(selectedOrder.id, resolutionNote.trim());
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      setResolutionNote('');
      onNotify({
        type: 'ok',
        text: `Marked Trade #${updated.id.slice(-8)} as FIAT PAID.`,
      });
    } catch (err) {
      onNotify({
        type: 'err',
        text: err instanceof Error ? err.message : 'Admin mark-paid failed',
      });
    } finally {
      setResolving(null);
    }
  };

  const handleAdminDirectRelease = async () => {
    if (!selectedOrder) return;
    setResolving('direct_release');
    try {
      const updated = await adminReleaseP2POrder(selectedOrder.id, resolutionNote.trim());
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      setResolutionNote('');
      onNotify({
        type: 'ok',
        text: `Released ${updated.netBuyerCrypto} ${updated.asset} from Escrow to Buyer @${updated.buyerUsername}.`,
      });
    } catch (err) {
      onNotify({
        type: 'err',
        text: err instanceof Error ? err.message : 'Admin release failed',
      });
    } finally {
      setResolving(null);
    }
  };

  const handleResolve = async (decision: 'release_to_buyer' | 'refund_to_seller') => {
    if (!selectedOrder) return;
    setResolving(decision);
    try {
      const updated = await resolveAdminP2POrder(
        selectedOrder.id,
        decision,
        resolutionNote.trim()
      );
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      setResolutionNote('');
      onNotify({
        type: 'ok',
        text: `Trade #${updated.id.slice(-8)} resolved (${
          decision === 'release_to_buyer' ? 'Released to Buyer' : 'Refunded to Seller'
        }).`,
      });
    } catch (err) {
      onNotify({
        type: 'err',
        text: err instanceof Error ? err.message : 'Moderation verdict failed',
      });
    } finally {
      setResolving(null);
    }
  };

  const handleSendAdminChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminMsgInput.trim()) return;
    try {
      await sendMessage({ text: adminMsgInput.trim() });
      setAdminMsgInput('');
    } catch (err) {
      onNotify({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to message trade room',
      });
    }
  };

  const handleSaveAutomationSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const saved = await saveAdminP2PSettings({
        minCompletedTradesToBuy: Math.max(0, Math.round(Number(minTradesInput || 0))),
        whitelistedBuyerUsernames: whitelistInput
          .split(',')
          .map((x) => x.trim().replace(/^@/, '').toLowerCase())
          .filter(Boolean),
        autoMarkPaidOnProof: autoMarkPaid,
        autoReleaseEnabled,
        autoReleaseAfterMins: Math.max(1, Math.round(Number(autoReleaseMins || 15))),
        escrowReceivingWallets: receivingWallets,
      });
      syncSettingsToForm(saved);
      onNotify({
        type: 'ok',
        text: `Saved P2P Buy Gate (${saved.minCompletedTradesToBuy} min trades) & Automation rules.`,
      });
    } catch (err) {
      onNotify({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to save P2P rules',
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const persistWallets = async (nextWallets: P2PEscrowReceivingWallet[], msg: string) => {
    setSavingSettings(true);
    try {
      const saved = await saveAdminP2PSettings({
        escrowReceivingWallets: nextWallets,
      });
      syncSettingsToForm(saved);
      onNotify({ type: 'ok', text: msg });
    } catch (err) {
      onNotify({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to update receiving wallets',
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddReceivingWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    const addr = newWalletPublicAddr.trim();
    if (!addr) return;
    const entry: P2PEscrowReceivingWallet = {
      id: `escw_${Date.now()}`,
      label: newWalletLabel.trim() || `${newWalletChain.toUpperCase()} Escrow Vault`,
      chain: newWalletChain,
      walletType: newWalletType,
      publicAddress: addr,
      active: true,
      createdAt: Date.now(),
    };
    await persistWallets(
      [...receivingWallets, entry],
      `Added ${
        newWalletType === 'cold_public' ? 'Cold Public-Key-Only' : 'Hot Escrow'
      } receiving wallet.`
    );
    setNewWalletLabel('');
    setNewWalletPublicAddr('');
  };

  return (
    <div className="space-y-5">
      {/* Top P2P Controls Strip */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17] text-xs">
          <button
            type="button"
            onClick={() => setSectionTab('queue')}
            className={`px-3.5 py-1.5 rounded-md font-medium transition-colors inline-flex items-center gap-1.5 ${
              sectionTab === 'queue'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                : 'text-slate-500'
            }`}
          >
            <Gavel className="w-3.5 h-3.5" />
            Moderation Queue ({orders.length})
          </button>
          <button
            type="button"
            onClick={() => setSectionTab('automation')}
            className={`px-3.5 py-1.5 rounded-md font-medium transition-colors inline-flex items-center gap-1.5 ${
              sectionTab === 'automation'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                : 'text-slate-500'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            Buy Rules &amp; Automation
          </button>
          <button
            type="button"
            onClick={() => setSectionTab('wallets')}
            className={`px-3.5 py-1.5 rounded-md font-medium transition-colors inline-flex items-center gap-1.5 ${
              sectionTab === 'wallets'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                : 'text-slate-500'
            }`}
          >
            <Wallet className="w-3.5 h-3.5" />
            Escrow Receiving Wallets ({receivingWallets.filter((w) => w.active).length})
          </button>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono">
          <span>Buy Min Trades: {settings.minCompletedTradesToBuy}</span>
          <span>·</span>
          <span>Auto-Release: {settings.autoReleaseEnabled ? `${settings.autoReleaseAfterMins}m` : 'Off'}</span>
          <button
            type="button"
            onClick={() => void loadQueue()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-sans font-medium text-slate-700 dark:text-slate-200"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* SECTION 1: MODERATION QUEUE + DIRECT RELEASE / MARK PAID */}
      {sectionTab === 'queue' && (
        <div className="space-y-4">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-xs w-fit">
            <button
              type="button"
              onClick={() => setFilter('disputed')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                filter === 'disputed'
                  ? 'bg-red-600 text-white'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Disputes ({disputedCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('active')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                filter === 'active'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Active Escrow
            </button>
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                filter === 'all'
                  ? 'bg-slate-900 dark:bg-slate-700 text-white'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              All Orders ({orders.length})
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
                P2P Escrow Queue
              </div>
              {loading && orders.length === 0 ? (
                <div className="p-8 flex items-center justify-center text-xs text-slate-500 gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading P2P orders…
                </div>
              ) : filteredOrders.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No {filter} P2P orders found.
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-[620px] overflow-y-auto">
                  {filteredOrders.map((ord) => (
                    <button
                      key={ord.id}
                      type="button"
                      onClick={() => setSelectedOrderId(ord.id)}
                      className={`w-full text-left px-4 py-3 text-xs transition-colors ${
                        selectedOrderId === ord.id
                          ? 'bg-blue-50 dark:bg-blue-500/10'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                          #{ord.id.slice(-8)} · {ord.cryptoAmount} {ord.asset}
                        </span>
                        <span
                          className={`font-semibold ${
                            ord.status === 'disputed'
                              ? 'text-red-500'
                              : ord.status === 'released' || ord.status === 'resolved_buyer'
                              ? 'text-emerald-500'
                              : 'text-amber-500'
                          }`}
                        >
                          {ord.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">
                        @{ord.sellerUsername} → @{ord.buyerUsername} ·{' '}
                        {formatFiatAmount(ord.fiatAmount, ord.fiatCurrency)} ({ord.paymentMethodName})
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-4">
              {!selectedOrder ? (
                <div className="py-16 text-center text-xs text-slate-500">
                  Select a P2P order to mark paid, inspect proof, release coins, or resolve disputes.
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
                    <div>
                      <h3 className="text-sm font-bold">
                        Order #{selectedOrder.id.slice(-8)} ·{' '}
                        {getCountryByCode(selectedOrder.countryCode).name}
                      </h3>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Seller @{selectedOrder.sellerUsername} ({truncateAddress(selectedOrder.sellerWalletAddress, 6, 4)}) · Buyer @{selectedOrder.buyerUsername} ({truncateAddress(selectedOrder.buyerWalletAddress, 6, 4)})
                      </div>
                    </div>
                    <div className="text-xs font-mono font-semibold tabular-nums">
                      {selectedOrder.cryptoAmount} {selectedOrder.asset} ⇄{' '}
                      {formatFiatAmount(selectedOrder.fiatAmount, selectedOrder.fiatCurrency)}
                    </div>
                  </div>

                  {selectedOrder.disputeReason && (
                    <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
                      <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold">Dispute Claim</div>
                        <div>{selectedOrder.disputeReason}</div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 space-y-1">
                      <div className="font-semibold">Escrow Proof</div>
                      <div>Mode: {selectedOrder.escrowMode}</div>
                      <div>Locked: {selectedOrder.escrowAssetLocked ? 'YES' : 'NO'}</div>
                      <div className="font-mono text-[11px] break-all text-slate-500">
                        Vault: {truncateAddress(selectedOrder.escrowVaultAddress, 8, 6)}
                      </div>
                      <div className="font-mono text-[11px] break-all text-slate-500">
                        TX: {selectedOrder.escrowTxHash || 'None'}
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 space-y-1.5">
                      <div className="font-semibold">Fiat Receipt Proof</div>
                      <div>Ref: {selectedOrder.fiatProofRef || 'None submitted'}</div>
                      {selectedOrder.fiatProofNote && (
                        <div className="text-[11px] text-slate-500">{selectedOrder.fiatProofNote}</div>
                      )}
                      {selectedOrder.fiatProofImage && (
                        <button
                          type="button"
                          onClick={() => setLightboxImg(selectedOrder.fiatProofImage)}
                          className="text-blue-600 dark:text-blue-400 underline text-[11px]"
                        >
                          Inspect Receipt Screenshot
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Moderator Live Chat Log */}
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] overflow-hidden">
                    <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
                      <span>Live Trade Room Transcript</span>
                      <span>{connected ? 'Live WS Connected' : 'Snapshot Transcript'}</span>
                    </div>
                    <div className="max-h-52 overflow-y-auto p-3 space-y-2 text-xs">
                      {(wsMessages.length > 0 ? wsMessages : messagesByOrder[selectedOrder.id] || []).map(
                        (m) => (
                          <div key={m.id} className="space-y-0.5">
                            <div className="text-[10px] text-slate-400">
                              @{m.senderUsername} ({m.senderRole}) · {formatTimestamp(m.createdAt)}
                            </div>
                            <div className="text-slate-800 dark:text-slate-200">{m.text}</div>
                            {m.attachmentImage && (
                              <button
                                type="button"
                                onClick={() => setLightboxImg(m.attachmentImage || null)}
                                className="text-[11px] text-blue-500 underline"
                              >
                                View Attached Screenshot
                              </button>
                            )}
                          </div>
                        )
                      )}
                      {typingUsers.length > 0 && (
                        <div className="text-[11px] text-blue-500">
                          {typingUsers.map((t) => `@${t.username}`).join(', ')} typing…
                        </div>
                      )}
                    </div>
                    <form
                      onSubmit={(e) => void handleSendAdminChat(e)}
                      className="p-2 border-t border-slate-200 dark:border-slate-800 flex gap-2"
                    >
                      <input
                        type="text"
                        value={adminMsgInput}
                        onChange={(e) => {
                          setAdminMsgInput(e.target.value);
                          emitTyping(e.target.value.trim().length > 0);
                        }}
                        placeholder="Message Buyer & Seller as KingAdmin…"
                        className="flex-1 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] text-xs"
                      />
                      <button
                        type="submit"
                        className="px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-semibold inline-flex items-center gap-1"
                      >
                        <Send className="w-3 h-3" />
                        Send
                      </button>
                    </form>
                  </div>

                  {/* Admin Mark Paid / Direct Release / Dispute Verdict */}
                  {['awaiting_escrow', 'escrow_locked', 'fiat_paid', 'disputed'].includes(
                    selectedOrder.status
                  ) ? (
                    <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                      <input
                        type="text"
                        value={resolutionNote}
                        onChange={(e) => setResolutionNote(e.target.value)}
                        placeholder="Admin audit note (optional for mark-paid/release, recommended for disputes)…"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs"
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        {['awaiting_escrow', 'escrow_locked'].includes(selectedOrder.status) && (
                          <button
                            type="button"
                            disabled={resolving !== null}
                            onClick={() => void handleAdminMarkPaid()}
                            className="py-2.5 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
                          >
                            {resolving === 'mark_paid' ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            )}
                            Mark Fiat Paid
                          </button>
                        )}

                        {['escrow_locked', 'fiat_paid', 'disputed'].includes(selectedOrder.status) && (
                          <button
                            type="button"
                            disabled={resolving !== null}
                            onClick={() => void handleAdminDirectRelease()}
                            className="py-2.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
                          >
                            {resolving === 'direct_release' ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Unlock className="w-3.5 h-3.5" />
                            )}
                            Release Coins to Buyer
                          </button>
                        )}

                        {['escrow_locked', 'fiat_paid', 'disputed'].includes(selectedOrder.status) && (
                          <button
                            type="button"
                            disabled={resolving !== null}
                            onClick={() => void handleResolve('refund_to_seller')}
                            className="py-2.5 px-3 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
                          >
                            {resolving === 'refund_to_seller' ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Gavel className="w-3.5 h-3.5" />
                            )}
                            Refund to Seller
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 font-medium">
                      <CheckCircle2 className="w-4 h-4" />
                      Finalized: {selectedOrder.status}
                      {selectedOrder.adminResolutionNote
                        ? ` — ${selectedOrder.adminResolutionNote}`
                        : ''}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: BUY GATE & AUTOMATION SETTINGS */}
      {sectionTab === 'automation' && (
        <form
          onSubmit={(e) => void handleSaveAutomationSettings(e)}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-5 max-w-2xl text-xs"
        >
          <div>
            <h3 className="text-sm font-bold">P2P Buy Gate &amp; Settlement Automation</h3>
            <p className="text-slate-500 mt-0.5">
              Set the minimum completed trades required before users can open Buy orders, and
              automate payment marking &amp; escrow release.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold mb-1">
                Minimum Completed Trades to Start Buying
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={minTradesInput}
                onChange={(e) => setMinTradesInput(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] font-mono"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Set to 0 to allow everyone, or e.g. 2 so new accounts complete Sell trades first.
              </p>
            </div>

            <div>
              <label className="block font-semibold mb-1">
                Auto-Release Wait Timer (Minutes)
              </label>
              <input
                type="number"
                min="1"
                max="1440"
                value={autoReleaseMins}
                onChange={(e) => setAutoReleaseMins(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] font-mono"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Used when Automated Escrow Release is turned on below.
              </p>
            </div>
          </div>

          <div>
            <label className="block font-semibold mb-1">
              Whitelisted Buyer @Usernames (Bypass Buy Trade Gate)
            </label>
            <input
              type="text"
              value={whitelistInput}
              onChange={(e) => setWhitelistInput(e.target.value)}
              placeholder="alice, bob_trader, @merchant1"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] font-mono"
            />
          </div>

          <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={autoMarkPaid}
                onChange={(e) => setAutoMarkPaid(e.target.checked)}
                className="mt-0.5"
              />
              <div>
                <div className="font-semibold">Auto-Mark Fiat Paid on Proof Upload</div>
                <div className="text-[11px] text-slate-500">
                  Transitions escrow_locked orders directly to fiat_paid when Buyer submits a valid
                  receipt screenshot or payment reference ID.
                </div>
              </div>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={autoReleaseEnabled}
                onChange={(e) => setAutoReleaseEnabled(e.target.checked)}
                className="mt-0.5"
              />
              <div>
                <div className="font-semibold">Automate Escrow Release After Proof Window</div>
                <div className="text-[11px] text-slate-500">
                  Automatically releases escrowed crypto to the Buyer if a fiat_paid order receives
                  no Seller dispute within {autoReleaseMins || 15} minutes.
                </div>
              </div>
            </label>
          </div>

          <button
            type="submit"
            disabled={savingSettings}
            className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold inline-flex items-center gap-2"
          >
            {savingSettings && <Loader2 className="w-4 h-4 animate-spin" />}
            Save Buy Gate &amp; Automation Rules
          </button>
        </form>
      )}

      {/* SECTION 3: ESCROW RECEIVING WALLETS (COLD WALLETS = PUBLIC KEYS ONLY) */}
      {sectionTab === 'wallets' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start text-xs">
          <form
            onSubmit={(e) => void handleAddReceivingWallet(e)}
            className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-3.5"
          >
            <div>
              <h3 className="text-sm font-bold">Add Escrow Receiving Wallet</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Configure public wallet addresses where P2P Sellers deposit escrow funds.
              </p>
            </div>

            <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-3 py-2 text-[11px] text-cyan-700 dark:text-cyan-300 flex items-start gap-2">
              <Snowflake className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Cold Wallets store PUBLIC KEYS ONLY — never enter or store private keys or seed
                phrases. Any private key payload is blocked by the server.
              </span>
            </div>

            <div>
              <label className="block font-medium text-slate-500 mb-1">Wallet Label</label>
              <input
                type="text"
                required
                value={newWalletLabel}
                onChange={(e) => setNewWalletLabel(e.target.value)}
                placeholder="e.g., Cold Hardware EVM Escrow #1"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block font-medium text-slate-500 mb-1">Chain</label>
                <select
                  value={newWalletChain}
                  onChange={(e) => setNewWalletChain(e.target.value as 'evm' | 'solana' | 'csc')}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
                >
                  <option value="evm">EVM (USDT / ETH / BNB / USD1)</option>
                  <option value="solana">Solana (SOL)</option>
                  <option value="csc">CSC-1 Native</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-500 mb-1">Custody Tier</label>
                <select
                  value={newWalletType}
                  onChange={(e) =>
                    setNewWalletType(e.target.value as 'cold_public' | 'hot_escrow')
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
                >
                  <option value="cold_public">Cold Wallet (Public Key Only)</option>
                  <option value="hot_escrow">Hot Escrow Vault</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block font-medium text-slate-500 mb-1">
                Public Receiving Address (No Private Key)
              </label>
              <input
                type="text"
                required
                value={newWalletPublicAddr}
                onChange={(e) => setNewWalletPublicAddr(e.target.value)}
                placeholder={
                  newWalletChain === 'evm'
                    ? '0x...'
                    : newWalletChain === 'solana'
                    ? 'Solana Base58 public address'
                    : 'CSC1...'
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] font-mono"
              />
            </div>

            <button
              type="submit"
              disabled={savingSettings}
              className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold flex items-center justify-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Public Receiving Wallet
            </button>
          </form>

          <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 font-semibold">
              Configured P2P Escrow Receiving Wallets
            </div>
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {receivingWallets.map((w) => (
                <div
                  key={w.id}
                  className="p-4 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="font-semibold flex items-center gap-2">
                      <span>{w.label}</span>
                      <span className="text-[11px] font-mono uppercase text-blue-500">
                        {w.chain}
                      </span>
                      <span className="text-[11px] text-cyan-600 dark:text-cyan-400">
                        {w.walletType === 'cold_public' ? 'Cold Public Key Only' : 'Hot Escrow'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyAddr(w.publicAddress, w.id)}
                      className="inline-flex items-center gap-1.5 font-mono text-[11px] text-slate-500 hover:text-blue-500 break-all text-left"
                    >
                      <span>{w.publicAddress}</span>
                      {copiedId === w.id ? (
                        <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                      ) : (
                        <Copy className="w-3 h-3 shrink-0" />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={savingSettings}
                      onClick={() =>
                        void persistWallets(
                          receivingWallets.map((item) =>
                            item.id === w.id ? { ...item, active: !item.active } : item
                          ),
                          `Updated "${w.label}" status.`
                        )
                      }
                      className={`px-2.5 py-1 rounded border font-medium ${
                        w.active
                          ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                          : 'border-slate-300 dark:border-slate-700 text-slate-500'
                      }`}
                    >
                      {w.active ? 'Active' : 'Disabled'}
                    </button>
                    {receivingWallets.length > 1 && (
                      <button
                        type="button"
                        disabled={savingSettings}
                        onClick={() =>
                          void persistWallets(
                            receivingWallets.filter((item) => item.id !== w.id),
                            `Removed "${w.label}".`
                          )
                        }
                        className="p-1.5 rounded border border-red-500/30 text-red-500 hover:bg-red-500/10"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {lightboxImg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4"
          onClick={() => setLightboxImg(null)}
        >
          <div className="relative max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setLightboxImg(null)}
              className="absolute -top-10 right-0 p-2 rounded-lg bg-white/10 text-white"
            >
              <X className="w-4 h-4" />
            </button>
            <img
              src={lightboxImg}
              alt="Dispute proof screenshot"
              className="w-full max-h-[82vh] object-contain rounded-xl border border-slate-700"
            />
          </div>
        </div>
      )}
    </div>
  );
}
