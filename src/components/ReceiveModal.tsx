import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, ExternalLink, X } from 'lucide-react';
import type { WalletEntry } from '../types/wallet';

interface ReceiveModalProps {
  wallet: WalletEntry;
  onClose: () => void;
}

export function ReceiveModal({ wallet, onClose }: ReceiveModalProps) {
  const hasBoth = Boolean(wallet.evmAddress && wallet.solanaAddress);
  const [selectedFamily, setSelectedFamily] = useState<'evm' | 'solana'>(
    wallet.evmAddress ? 'evm' : 'solana'
  );
  const [copied, setCopied] = useState(false);

  const activeAddress =
    selectedFamily === 'evm' ? wallet.evmAddress || '' : wallet.solanaAddress || '';

  const handleCopy = async () => {
    if (!activeAddress) return;
    await navigator.clipboard.writeText(activeAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Receive addresses for ${wallet.label}`}
    >
      <div className="w-full max-w-md max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4 sm:p-6 pb-safe">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Receive Assets
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {wallet.label}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {hasBoth && (
          <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 mb-5">
            <button
              type="button"
              onClick={() => setSelectedFamily('evm')}
              className={`py-2 px-3 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                selectedFamily === 'evm'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              EVM (ETH / POL / L2s)
            </button>
            <button
              type="button"
              onClick={() => setSelectedFamily('solana')}
              className={`py-2 px-3 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                selectedFamily === 'solana'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Solana (SPL)
            </button>
          </div>
        )}

        <div className="flex flex-col items-center py-5 px-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]">
          <div className="p-3 bg-white rounded-lg">
            <QRCodeSVG value={activeAddress} size={172} level="M" />
          </div>
          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400 text-center">
            {selectedFamily === 'evm'
              ? 'Compatible with Ethereum, Polygon, Arbitrum, Base, Optimism, and BNB Chain'
              : 'Compatible with Solana Mainnet and SPL tokens'}
          </p>
        </div>

        <div className="mt-4">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
            {selectedFamily === 'evm' ? 'EVM Public Address' : 'Solana Public Key'}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={activeAddress}
              className="flex-1 min-w-0 px-3 py-2.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 select-all"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="px-3.5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <a
            href={
              selectedFamily === 'evm'
                ? `https://etherscan.io/address/${activeAddress}`
                : `https://solscan.io/account/${activeAddress}`
            }
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            View on Explorer
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
