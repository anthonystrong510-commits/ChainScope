import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Gavel,
  Loader2,
  RefreshCw,
  Send,
  ShieldAlert,
  Unlock,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useP2PWebSocket } from '../hooks/useP2PWebSocket';
import { formatFiatAmount, getCountryByCode } from '../data/p2pPayments';
import { fetchAdminP2POrders, resolveAdminP2POrder } from '../services/p2p';
import type { P2PChatMessage, P2POrder } from '../types/p2p';
import { formatTimestamp, truncateAddress } from '../utils/chains';

interface KingAdminP2PPanelProps {
  onNotify: (msg: { type: 'ok' | 'err'; text: string }) => void;
}

export function KingAdminP2PPanel({ onNotify }: KingAdminP2PPanelProps) {
  const { user } = useAuth();
  const [orders, setOrders] = useState<P2POrder[]>([]);
  const [messagesByOrder, setMessagesByOrder] = useState<Record<string, P2PChatMessage[]>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'disputed' | 'active' | 'all'>('disputed');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolving, setResolving] = useState<string | null>(null);
  const [adminMsgInput, setAdminMsgInput] = useState('');
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAdminP2POrders();
      setOrders(res.orders);
      setMessagesByOrder(res.messagesByOrder);
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
  }, [onNotify, selectedOrderId]);

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

  const handleResolve = async (decision: 'release_to_buyer' | 'refund_to_seller') => {
    if (!selectedOrder) return;
    setResolving(decision);
    try {
      const updated = await resolveAdminP2POrder(selectedOrder.id, decision, resolutionNote.trim());
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      setResolutionNote('');
      onNotify({
        type: 'ok',
        text: `Trade #${updated.id.slice(-8)} resolved (${decision === 'release_to_buyer' ? 'Released to Buyer' : 'Refunded to Seller'}).`,
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

  return (
    <div className="space-y-5">
      {/* Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-xs">
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

        <button
          type="button"
          onClick={() => void loadQueue()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Queue
        </button>
      </div>

      {/* Split Inspector */}
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
            <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-[600px] overflow-y-auto">
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

        {/* Right: Dispute Evidence, Admin Chat & Verdict */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-4">
          {!selectedOrder ? (
            <div className="py-16 text-center text-xs text-slate-500">
              Select a P2P order to inspect escrow proof, fiat receipts, and chat logs.
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
                    TX: {selectedOrder.escrowTxHash || 'None'}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 space-y-1.5">
                  <div className="font-semibold">Fiat Receipt Proof</div>
                  <div>Ref: {selectedOrder.fiatProofRef || 'None submitted'}</div>
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
                <div className="max-h-56 overflow-y-auto p-3 space-y-2 text-xs">
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

              {/* Admin Verdict Controls */}
              {['disputed', 'fiat_paid', 'escrow_locked'].includes(selectedOrder.status) ? (
                <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <input
                    type="text"
                    value={resolutionNote}
                    onChange={(e) => setResolutionNote(e.target.value)}
                    placeholder="Moderation ruling note for immutable audit trail…"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      disabled={resolving !== null}
                      onClick={() => void handleResolve('release_to_buyer')}
                      className="py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2"
                    >
                      {resolving === 'release_to_buyer' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Unlock className="w-4 h-4" />
                      )}
                      Rule: Release Escrow to Buyer
                    </button>
                    <button
                      type="button"
                      disabled={resolving !== null}
                      onClick={() => void handleResolve('refund_to_seller')}
                      className="py-2.5 px-4 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2"
                    >
                      {resolving === 'refund_to_seller' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Gavel className="w-4 h-4" />
                      )}
                      Rule: Refund Escrow to Seller
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 font-medium">
                  <CheckCircle2 className="w-4 h-4" />
                  Finalized: {selectedOrder.status}
                  {selectedOrder.adminResolutionNote ? ` — ${selectedOrder.adminResolutionNote}` : ''}
                </div>
              )}
            </>
          )}
        </div>
      </div>

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
