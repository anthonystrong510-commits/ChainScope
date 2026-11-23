import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Gavel,
  ImagePlus,
  Loader2,
  Lock,
  Paperclip,
  Send,
  ShieldCheck,
  Unlock,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useP2PWebSocket } from '../hooks/useP2PWebSocket';
import {
  cancelP2POrder,
  compressPaymentProofImage,
  disputeP2POrder,
  fetchP2POrderDetail,
  lockP2PEscrow,
  markP2PFiatPaid,
  releaseP2PEscrow,
} from '../services/p2p';
import { formatFiatAmount, getCountryByCode } from '../data/p2pPayments';
import type { P2PEscrowMode, P2POrder } from '../types/p2p';
import { formatTimestamp, truncateAddress } from '../utils/chains';

interface P2PTradeRoomProps {
  initialOrder: P2POrder;
  onBack: () => void;
  onOrderChanged: (order: P2POrder) => void;
}

function statusLabel(status: P2POrder['status']): string {
  switch (status) {
    case 'awaiting_escrow':
      return 'Awaiting Seller Escrow Lock';
    case 'escrow_locked':
      return 'Escrow Locked — Pay Fiat';
    case 'fiat_paid':
      return 'Fiat Proof Submitted — Verify & Release';
    case 'released':
      return 'Completed (Escrow Released)';
    case 'disputed':
      return 'Disputed — KingAdmin Moderating';
    case 'cancelled':
      return 'Cancelled';
    case 'resolved_buyer':
      return 'Resolved by Admin (Released to Buyer)';
    case 'resolved_seller':
      return 'Resolved by Admin (Refunded to Seller)';
  }
}

export function P2PTradeRoom({
  initialOrder,
  onBack,
  onOrderChanged,
}: P2PTradeRoomProps) {
  const { user, walletAccount } = useAuth();
  const [order, setOrder] = useState<P2POrder>(initialOrder);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<'escrow' | 'chat'>('escrow');

  // Escrow Lock form (Seller)
  const [escrowModeInput, setEscrowModeInput] = useState<P2PEscrowMode>(initialOrder.escrowMode);
  const [escrowTxHashInput, setEscrowTxHashInput] = useState('');
  const [escrowSigInput, setEscrowSigInput] = useState('');
  const [sellerPayHolder, setSellerPayHolder] = useState(
    initialOrder.paymentSnapshot.accountHolder || ''
  );
  const [sellerPayDetails, setSellerPayDetails] = useState(
    initialOrder.paymentSnapshot.accountDetails || ''
  );

  // Fiat Proof form (Buyer)
  const [fiatProofRef, setFiatProofRef] = useState('');
  const [fiatProofNote, setFiatProofNote] = useState('');
  const [fiatProofImage, setFiatProofImage] = useState('');

  // Dispute form
  const [showDisputeBox, setShowDisputeBox] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');

  // Chat composer
  const [chatText, setChatText] = useState('');
  const [chatImage, setChatImage] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const {
    connected,
    messages,
    typingUsers,
    onlineUsers,
    wsError,
    emitTyping,
    sendMessage,
    seedMessages,
  } = useP2PWebSocket(order.id, user?.uid || null, (updated) => {
    setOrder(updated);
    onOrderChanged(updated);
  });

  useEffect(() => {
    let active = true;
    fetchP2POrderDetail(initialOrder.id)
      .then((res) => {
        if (!active) return;
        setOrder(res.order);
        seedMessages(res.messages);
        onOrderChanged(res.order);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [initialOrder.id, seedMessages, onOrderChanged]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages.length, typingUsers.length]);

  const isSeller = user?.uid === order.sellerUid;
  const isBuyer = user?.uid === order.buyerUid;
  const country = useMemo(() => getCountryByCode(order.countryCode), [order.countryCode]);
  const vaultCapable = ['CSC', 'USDT', 'USD1', 'SOL'].includes(order.asset);

  const copyVal = (text: string, key: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
  };

  const handleSignEscrowWithEvmWallet = async () => {
    setBanner(null);
    if (!escrowTxHashInput.trim()) {
      setBanner({ type: 'err', text: 'Enter your on-chain TX hash before signing proof.' });
      return;
    }
    const eth = (window as unknown as { ethereum?: { request: (a: unknown) => Promise<unknown> } })
      .ethereum;
    if (!eth) {
      setBanner({ type: 'err', text: 'No injected browser wallet found to sign proof.' });
      return;
    }
    try {
      const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
      if (!accounts?.[0]) throw new Error('No wallet account authorized.');
      const message = `ChainScope P2P Escrow Lock\nOrder: ${order.id}\nAmount: ${order.cryptoAmount} ${order.asset}\nTX: ${escrowTxHashInput.trim()}`;
      const sig = (await eth.request({
        method: 'personal_sign',
        params: [message, accounts[0]],
      })) as string;
      setEscrowSigInput(sig);
      setBanner({ type: 'ok', text: 'Signed escrow proof with your bound wallet.' });
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Wallet signature declined.',
      });
    }
  };

  const handleLockEscrow = async () => {
    setBusyAction('lock');
    setBanner(null);
    try {
      const updated = await lockP2PEscrow(order.id, {
        mode: escrowModeInput,
        txHash: escrowTxHashInput.trim() || undefined,
        signature: escrowSigInput.trim() || undefined,
        sellerPaymentDetails: sellerPayDetails.trim()
          ? {
              accountHolder: sellerPayHolder.trim() || `@${order.sellerUsername}`,
              accountDetails: sellerPayDetails.trim(),
            }
          : undefined,
      });
      setOrder(updated);
      onOrderChanged(updated);
      setBanner({ type: 'ok', text: 'Crypto locked inside ChainScope Escrow.' });
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Lock failed' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleUploadProofFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
    target: 'fiat_proof' | 'chat'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBanner(null);
    try {
      const compressed = await compressPaymentProofImage(file);
      if (target === 'fiat_proof') setFiatProofImage(compressed);
      else setChatImage(compressed);
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Invalid image' });
    }
  };

  const handleMarkFiatPaid = async () => {
    setBusyAction('paid');
    setBanner(null);
    try {
      const updated = await markP2PFiatPaid(order.id, {
        fiatProofRef: fiatProofRef.trim(),
        fiatProofImage: fiatProofImage || undefined,
        fiatProofNote: fiatProofNote.trim() || undefined,
      });
      setOrder(updated);
      onOrderChanged(updated);
      setBanner({
        type: 'ok',
        text: 'Payment proof recorded. Seller notified to verify & release escrow.',
      });
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Submit failed' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleReleaseEscrow = async () => {
    setBusyAction('release');
    setBanner(null);
    try {
      const updated = await releaseP2PEscrow(order.id);
      setOrder(updated);
      onOrderChanged(updated);
      setBanner({
        type: 'ok',
        text: `Released ${updated.netBuyerCrypto} ${updated.asset} from Escrow to @${updated.buyerUsername}.`,
      });
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Release failed' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleCancelOrder = async () => {
    setBusyAction('cancel');
    setBanner(null);
    try {
      const updated = await cancelP2POrder(order.id);
      setOrder(updated);
      onOrderChanged(updated);
      setBanner({ type: 'ok', text: 'Order cancelled and any locked escrow refunded.' });
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Cancel failed' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleEscalateDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyAction('dispute');
    setBanner(null);
    try {
      const updated = await disputeP2POrder(order.id, disputeReason);
      setOrder(updated);
      onOrderChanged(updated);
      setShowDisputeBox(false);
      setDisputeReason('');
      setBanner({
        type: 'ok',
        text: 'Dispute escalated to KingAdmin Moderation. Escrow stays frozen until ruling.',
      });
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Dispute failed' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!chatText.trim() && !chatImage) || sendingChat) return;
    setSendingChat(true);
    try {
      await sendMessage({
        text: chatText.trim(),
        attachmentImage: chatImage || undefined,
      });
      setChatText('');
      setChatImage('');
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Chat send failed' });
    } finally {
      setSendingChat(false);
    }
  };

  const steps = [
    { key: 'open', label: 'Order Created', done: true },
    {
      key: 'escrow',
      label: 'Escrow Locked',
      done: order.escrowAssetLocked || order.status !== 'awaiting_escrow',
    },
    {
      key: 'fiat',
      label: 'Fiat Paid + Proof',
      done: ['fiat_paid', 'released', 'disputed', 'resolved_buyer', 'resolved_seller'].includes(
        order.status
      ),
    },
    {
      key: 'settled',
      label: 'Finalized',
      done: ['released', 'resolved_buyer', 'resolved_seller', 'cancelled'].includes(order.status),
    },
  ];

  return (
    <div className="space-y-5">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium min-h-[36px]"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            All P2P Offers
          </button>
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Trade #{order.id.slice(-8)} · {order.cryptoAmount} {order.asset}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {statusLabel(order.status)} · {country.name} ({order.paymentMethodName})
            </p>
          </div>
        </div>

        <div className="text-left sm:text-right text-xs font-mono tabular-nums">
          <div className="text-slate-500 dark:text-slate-400">Order Total</div>
          <div className="text-base font-bold text-slate-900 dark:text-slate-100">
            {formatFiatAmount(order.fiatAmount, order.fiatCurrency)}
          </div>
        </div>
      </div>

      {/* 4-Step Pipeline */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {steps.map((st, idx) => (
          <div
            key={st.key}
            className={`px-3 py-2.5 rounded-lg border text-xs flex items-center gap-2 ${
              st.done
                ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-slate-500'
            }`}
          >
            <span className="font-mono font-bold text-[11px]">0{idx + 1}.</span>
            <span className="font-medium truncate">{st.label}</span>
          </div>
        ))}
      </div>

      {banner && (
        <div
          className={`px-4 py-3 rounded-lg border text-xs font-medium flex items-center justify-between ${
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

      {/* Mobile Pane Switcher (< lg) */}
      <div className="lg:hidden grid grid-cols-2 gap-1 p-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-xs">
        <button
          type="button"
          onClick={() => setMobilePane('escrow')}
          className={`py-2 px-3 rounded-lg font-semibold transition-colors ${
            mobilePane === 'escrow'
              ? 'bg-blue-600 text-white'
              : 'text-slate-600 dark:text-slate-300'
          }`}
        >
          Escrow &amp; Proof
        </button>
        <button
          type="button"
          onClick={() => setMobilePane('chat')}
          className={`py-2 px-3 rounded-lg font-semibold transition-colors flex items-center justify-center gap-1.5 ${
            mobilePane === 'chat'
              ? 'bg-blue-600 text-white'
              : 'text-slate-600 dark:text-slate-300'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              connected ? 'bg-emerald-400' : 'bg-amber-400'
            }`}
          />
          <span>Live Chat ({messages.length})</span>
        </button>
      </div>

      {/* Split Workspace: Left Escrow & Proof Controls | Right Real-Time Chat */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* LEFT: Escrow, Counterparties & Proof Controls */}
        <div
          className={`${
            mobilePane === 'escrow' ? 'block' : 'hidden lg:block'
          } lg:col-span-6 space-y-4`}
        >
          {/* Counterparties 1:1 Identity */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-900 dark:text-slate-100">
              <span>1:1 Bound Counterparties</span>
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                <ShieldCheck className="w-3.5 h-3.5" />
                Escrow Protected
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] space-y-1">
                <div className="text-[11px] text-slate-500">Seller (Releases {order.asset})</div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  @{order.sellerUsername} {isSeller ? '(You)' : ''}
                </div>
                <div className="font-mono text-[11px] text-slate-500">
                  {truncateAddress(order.sellerWalletAddress, 8, 6)}
                </div>
              </div>

              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] space-y-1">
                <div className="text-[11px] text-slate-500">Buyer (Sends {order.fiatCurrency})</div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  @{order.buyerUsername} {isBuyer ? '(You)' : ''}
                </div>
                <div className="font-mono text-[11px] text-slate-500">
                  {truncateAddress(order.buyerWalletAddress, 8, 6)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs font-mono tabular-nums">
              <div>
                <div className="text-[11px] text-slate-500 font-sans">Unit Price</div>
                <div className="font-semibold">
                  {formatFiatAmount(order.unitPriceFiat, order.fiatCurrency)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 font-sans">Escrow Fee (0.25%)</div>
                <div className="font-semibold">
                  {order.feeCrypto} {order.asset}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 font-sans">Buyer Receives</div>
                <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {order.netBuyerCrypto} {order.asset}
                </div>
              </div>
            </div>
          </div>

          {/* Payment Rail Details */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                Fiat Settlement Method: {order.paymentMethodName}
              </span>
              <span className="font-mono text-[11px] text-slate-500">{country.name}</span>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Recipient Name</span>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {order.paymentSnapshot.accountHolder}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Account / Number</span>
                <button
                  type="button"
                  onClick={() => copyVal(order.paymentSnapshot.accountDetails, 'pay')}
                  className="inline-flex items-center gap-1 font-mono font-semibold text-blue-600 dark:text-blue-400 hover:underline text-right"
                >
                  {order.paymentSnapshot.accountDetails}
                  {copiedKey === 'pay' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
              {order.paymentSnapshot.instructions && (
                <div className="pt-1 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                  {order.paymentSnapshot.instructions}
                </div>
              )}
            </div>
          </div>

          {/* STEP 1 ACTION: SELLER LOCKS CRYPTO IN ESCROW */}
          {order.status === 'awaiting_escrow' && (
            <div className="p-4 rounded-xl border border-amber-500/30 bg-white dark:bg-[#111827] space-y-3 text-xs">
              <div className="flex items-center gap-2 font-semibold text-amber-600 dark:text-amber-400">
                <Lock className="w-4 h-4" />
                Step 1: Seller Must Lock {order.cryptoAmount} {order.asset} Into Escrow
              </div>

              {isSeller ? (
                <div className="space-y-3">
                  <div className="flex gap-1.5 p-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17]">
                    {vaultCapable && (
                      <button
                        type="button"
                        onClick={() => setEscrowModeInput('vault_balance')}
                        className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                          escrowModeInput === 'vault_balance'
                            ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                            : 'text-slate-500'
                        }`}
                      >
                        Platform Vault Lock (Instant)
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setEscrowModeInput('onchain_proof')}
                      className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                        escrowModeInput === 'onchain_proof'
                          ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                          : 'text-slate-500'
                      }`}
                    >
                      Self-Custody On-Chain TX
                    </button>
                  </div>

                  {!order.paymentSnapshot.accountDetails ||
                  order.paymentSnapshot.accountDetails.startsWith('Share receiving') ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={sellerPayHolder}
                        onChange={(e) => setSellerPayHolder(e.target.value)}
                        placeholder="Your Legal / Account Name"
                        className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
                      />
                      <input
                        type="text"
                        value={sellerPayDetails}
                        onChange={(e) => setSellerPayDetails(e.target.value)}
                        placeholder={`Your ${order.paymentMethodName} details`}
                        className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
                      />
                    </div>
                  ) : null}

                  {escrowModeInput === 'onchain_proof' && (
                    <div className="space-y-2 p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800">
                      <div className="text-[11px] text-slate-500">
                        Send {order.cryptoAmount} {order.asset} from your wallet ({truncateAddress(walletAccount?.evmAddress || order.sellerWalletAddress, 6, 4)}) to ChainScope Escrow Vault:
                      </div>
                      <button
                        type="button"
                        onClick={() => copyVal(order.escrowVaultAddress, 'vault')}
                        className="flex items-center justify-between w-full px-2.5 py-1.5 rounded bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700 font-mono text-[11px]"
                      >
                        <span className="truncate">{order.escrowVaultAddress}</span>
                        {copiedKey === 'vault' ? (
                          <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 shrink-0" />
                        )}
                      </button>
                      <input
                        type="text"
                        value={escrowTxHashInput}
                        onChange={(e) => setEscrowTxHashInput(e.target.value)}
                        placeholder="Paste on-chain TX hash (0x... or Solana signature)"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] font-mono"
                      />
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <input
                          type="text"
                          value={escrowSigInput}
                          onChange={(e) => setEscrowSigInput(e.target.value)}
                          placeholder="Optional personal_sign signature"
                          className="w-full sm:flex-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] font-mono text-[11px]"
                        />
                        <button
                          type="button"
                          onClick={() => void handleSignEscrowWithEvmWallet()}
                          className="w-full sm:w-auto px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium whitespace-nowrap"
                        >
                          Sign Proof
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <button
                      type="button"
                      disabled={busyAction === 'lock'}
                      onClick={() => void handleLockEscrow()}
                      className="flex-1 py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold flex items-center justify-center gap-2"
                    >
                      {busyAction === 'lock' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Lock className="w-4 h-4" />
                      )}
                      Lock {order.cryptoAmount} {order.asset} in Escrow
                    </button>
                    <button
                      type="button"
                      disabled={busyAction === 'cancel'}
                      onClick={() => void handleCancelOrder()}
                      className="py-2.5 px-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 text-slate-600 dark:text-slate-300">
                  <p>
                    Do NOT send fiat yet. Waiting for @{order.sellerUsername} to lock{' '}
                    <span className="font-mono font-semibold">
                      {order.cryptoAmount} {order.asset}
                    </span>{' '}
                    into ChainScope Escrow.
                  </p>
                  <button
                    type="button"
                    disabled={busyAction === 'cancel'}
                    onClick={() => void handleCancelOrder()}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Cancel Order
                  </button>
                </div>
              )}
            </div>
          )}

          {/* STEP 2 ACTION: ESCROW LOCKED -> BUYER PAYS FIAT & SUBMITS PROOF */}
          {order.status === 'escrow_locked' && (
            <div className="p-4 rounded-xl border border-emerald-500/30 bg-white dark:bg-[#111827] space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
                  <Lock className="w-4 h-4" />
                  Escrow Locked ({order.escrowLockedAmount} {order.asset})
                </span>
                <span className="font-mono text-[11px] text-slate-500">
                  TX: {truncateAddress(order.escrowTxHash, 8, 6)}
                </span>
              </div>

              {isBuyer ? (
                <div className="space-y-3">
                  <p className="text-slate-600 dark:text-slate-300">
                    Send exactly{' '}
                    <strong className="font-mono text-slate-900 dark:text-slate-100">
                      {formatFiatAmount(order.fiatAmount, order.fiatCurrency)}
                    </strong>{' '}
                    via {order.paymentMethodName}, then attach your transfer reference or receipt screenshot below.
                  </p>

                  <input
                    type="text"
                    value={fiatProofRef}
                    onChange={(e) => setFiatProofRef(e.target.value)}
                    placeholder="Payment Reference / M-Pesa Code / Transaction ID"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] font-mono"
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer font-medium">
                      <ImagePlus className="w-3.5 h-3.5" />
                      {fiatProofImage ? 'Change Receipt Image' : 'Attach Receipt Screenshot'}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => void handleUploadProofFile(e, 'fiat_proof')}
                      />
                    </label>
                    {fiatProofImage && (
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                        Receipt screenshot attached
                      </span>
                    )}
                  </div>

                  <input
                    type="text"
                    value={fiatProofNote}
                    onChange={(e) => setFiatProofNote(e.target.value)}
                    placeholder="Optional note (e.g. Sent from M-Pesa 07xx...)"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
                  />

                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <button
                      type="button"
                      disabled={busyAction === 'paid'}
                      onClick={() => void handleMarkFiatPaid()}
                      className="flex-1 py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold flex items-center justify-center gap-2"
                    >
                      {busyAction === 'paid' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                      I Have Sent Fiat + Submit Proof
                    </button>
                    <button
                      type="button"
                      disabled={busyAction === 'cancel'}
                      onClick={() => void handleCancelOrder()}
                      className="py-2.5 px-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 text-slate-600 dark:text-slate-300">
                  <p>
                    Escrow is locked! Waiting for Buyer @{order.buyerUsername} to pay{' '}
                    <span className="font-mono font-semibold">
                      {formatFiatAmount(order.fiatAmount, order.fiatCurrency)}
                    </span>{' '}
                    and submit receipt proof.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowDisputeBox((v) => !v)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Escalate Dispute
                  </button>
                </div>
              )}
            </div>
          )}

          {/* STEP 3 ACTION: FIAT PROOF SUBMITTED -> SELLER VERIFIES & RELEASES */}
          {order.status === 'fiat_paid' && (
            <div className="p-4 rounded-xl border border-blue-500/30 bg-white dark:bg-[#111827] space-y-3 text-xs">
              <div className="font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                Fiat Payment Proof Submitted (Cancellation Locked)
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 space-y-2">
                {order.fiatProofRef && (
                  <div>
                    <span className="text-slate-500">Reference ID: </span>
                    <span className="font-mono font-semibold">{order.fiatProofRef}</span>
                  </div>
                )}
                {order.fiatProofNote && (
                  <div className="text-slate-600 dark:text-slate-300">{order.fiatProofNote}</div>
                )}
                {order.fiatProofImage && (
                  <button
                    type="button"
                    onClick={() => setLightboxImg(order.fiatProofImage)}
                    className="block rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 max-w-[220px]"
                  >
                    <img
                      src={order.fiatProofImage}
                      alt="Fiat payment receipt"
                      className="w-full h-auto object-cover"
                    />
                  </button>
                )}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                {isSeller && (
                  <button
                    type="button"
                    disabled={busyAction === 'release'}
                    onClick={() => void handleReleaseEscrow()}
                    className="flex-1 py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold flex items-center justify-center gap-2"
                  >
                    {busyAction === 'release' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Unlock className="w-4 h-4" />
                    )}
                    Verify Receipt & Release {order.netBuyerCrypto} {order.asset}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowDisputeBox((v) => !v)}
                  className="py-2.5 px-3 rounded-lg border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 font-medium flex items-center justify-center gap-1.5"
                >
                  <Gavel className="w-3.5 h-3.5" />
                  Open Dispute
                </button>
              </div>
            </div>
          )}

          {/* DISPUTED OR COMPLETED BANNER */}
          {(order.status === 'disputed' ||
            order.status === 'released' ||
            order.status === 'resolved_buyer' ||
            order.status === 'resolved_seller' ||
            order.status === 'cancelled') && (
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-2 text-xs">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                {statusLabel(order.status)}
              </div>
              {order.disputeReason && (
                <div className="text-amber-600 dark:text-amber-400">
                  Dispute Reason: {order.disputeReason}
                </div>
              )}
              {order.adminResolutionNote && (
                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800">
                  KingAdmin @{order.resolvedByHandle}: {order.adminResolutionNote}
                </div>
              )}
            </div>
          )}

          {/* Dispute Escalation Drawer */}
          {showDisputeBox && ['escrow_locked', 'fiat_paid'].includes(order.status) && (
            <form
              onSubmit={(e) => void handleEscalateDispute(e)}
              className="p-4 rounded-xl border border-red-500/30 bg-white dark:bg-[#111827] space-y-3 text-xs"
            >
              <div className="font-semibold text-red-600 dark:text-red-400">
                Escalate Trade to KingAdmin Moderation
              </div>
              <textarea
                rows={3}
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                placeholder="Explain clearly what went wrong (e.g. Paid via M-Pesa 20m ago with receipt attached, Seller offline)..."
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
                required
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowDisputeBox(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={busyAction === 'dispute'}
                  className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold"
                >
                  Freeze Escrow & Summon Admin
                </button>
              </div>
            </form>
          )}
        </div>

        {/* RIGHT: RESPONSIVE REAL-TIME WEBSOCKET TRADE CHAT */}
        <div
          className={`${
            mobilePane === 'chat' ? 'flex' : 'hidden lg:flex'
          } lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex-col h-[64dvh] min-h-[380px] lg:h-[580px]`}
        >
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Encrypted Proof Trade Chat
              </div>
              <div className="text-[11px] text-slate-500 flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      connected ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                  />
                  {connected ? 'Live WebSocket' : 'Reconnecting…'}
                </span>
                {onlineUsers.length > 0 && (
                  <span>
                    · Online: {onlineUsers.map((u) => `@${u.username}`).join(', ')}
                  </span>
                )}
              </div>
            </div>
            {wsError && <span className="text-[11px] text-red-500">{wsError}</span>}
          </div>

          <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((m) => {
              if (m.senderRole === 'system') {
                return (
                  <div
                    key={m.id}
                    className="mx-auto max-w-[92%] px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-300 space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span className="font-semibold text-blue-600 dark:text-blue-400">
                        ChainScope Escrow System
                      </span>
                      <span className="font-mono tabular-nums">{formatTimestamp(m.createdAt)}</span>
                    </div>
                    <div>{m.text}</div>
                    {m.txHash && (
                      <div className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400 break-all">
                        Escrow TX: {m.txHash}
                      </div>
                    )}
                    {m.attachmentImage && (
                      <button
                        type="button"
                        onClick={() => setLightboxImg(m.attachmentImage || null)}
                        className="block rounded overflow-hidden border border-slate-200 dark:border-slate-700 max-w-[180px]"
                      >
                        <img
                          src={m.attachmentImage}
                          alt="Escrow receipt proof"
                          className="w-full h-auto"
                        />
                      </button>
                    )}
                  </div>
                );
              }

              const mine = m.senderUid === user?.uid;
              return (
                <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                  <div className="text-[10px] text-slate-400 mb-0.5 px-1">
                    @{m.senderUsername} ({m.senderRole}) · {formatTimestamp(m.createdAt)}
                  </div>
                  <div
                    className={`max-w-[82%] rounded-xl px-3.5 py-2 text-xs space-y-2 ${
                      m.senderRole === 'admin'
                        ? 'bg-amber-500/15 border border-amber-500/30 text-slate-900 dark:text-slate-100'
                        : mine
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    {m.text && <div className="whitespace-pre-wrap break-words">{m.text}</div>}
                    {m.attachmentImage && (
                      <button
                        type="button"
                        onClick={() => setLightboxImg(m.attachmentImage || null)}
                        className="block rounded-lg overflow-hidden border border-white/20 max-w-[210px]"
                      >
                        <img
                          src={m.attachmentImage}
                          alt="Chat attachment"
                          className="w-full h-auto"
                        />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {typingUsers.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 px-1">
                <span className="inline-flex gap-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" />
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce"
                    style={{ animationDelay: '120ms' }}
                  />
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce"
                    style={{ animationDelay: '240ms' }}
                  />
                </span>
                <span>
                  {typingUsers.map((t) => `@${t.username}`).join(', ')}{' '}
                  {typingUsers.length === 1 ? 'is' : 'are'} typing…
                </span>
              </div>
            )}
          </div>

          {chatImage && (
            <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs bg-slate-50 dark:bg-[#0B0F17]">
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                Receipt image ready to send
              </span>
              <button type="button" onClick={() => setChatImage('')} className="text-slate-500">
                Remove
              </button>
            </div>
          )}

          <form
            onSubmit={(e) => void handleSendChat(e)}
            className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2"
          >
            <label
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 cursor-pointer shrink-0"
              title="Attach payment screenshot"
            >
              <Paperclip className="w-4 h-4" />
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void handleUploadProofFile(e, 'chat')}
              />
            </label>
            <input
              type="text"
              value={chatText}
              onChange={(e) => {
                setChatText(e.target.value);
                emitTyping(e.target.value.trim().length > 0);
              }}
              onBlur={() => emitTyping(false)}
              placeholder="Message counterparty or paste payment proof…"
              className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs"
            />
            <button
              type="submit"
              disabled={sendingChat || (!chatText.trim() && !chatImage)}
              className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
            >
              {sendingChat ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              Send
            </button>
          </form>
        </div>
      </div>

      {/* Receipt Lightbox */}
      {lightboxImg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4"
          onClick={() => setLightboxImg(null)}
        >
          <div className="relative max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setLightboxImg(null)}
              className="absolute -top-10 right-0 p-2 rounded-lg bg-white/10 text-white hover:bg-white/20"
            >
              <X className="w-4 h-4" />
            </button>
            <img
              src={lightboxImg}
              alt="Enlarged payment proof"
              className="w-full max-h-[82vh] object-contain rounded-xl border border-slate-700"
            />
          </div>
        </div>
      )}
    </div>
  );
}
