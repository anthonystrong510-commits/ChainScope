import type { ChainId } from '../types/wallet';

export interface ChainMeta {
  id: ChainId;
  name: string;
  shortName: string;
  symbol: string;
  family: 'evm' | 'solana';
  explorerTxUrl: (hash: string) => string;
  explorerAddressUrl: (addr: string) => string;
  accentHex: string;
}

export const CHAIN_ORDER: ChainId[] = [
  'ethereum',
  'polygon',
  'solana',
  'arbitrum',
  'base',
  'optimism',
  'bsc',
];

export const CHAIN_META: Record<ChainId, ChainMeta> = {
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum',
    shortName: 'ETH',
    symbol: 'ETH',
    family: 'evm',
    explorerTxUrl: (h) => `https://etherscan.io/tx/${h}`,
    explorerAddressUrl: (a) => `https://etherscan.io/address/${a}`,
    accentHex: '#627EEA',
  },
  polygon: {
    id: 'polygon',
    name: 'Polygon',
    shortName: 'POL',
    symbol: 'POL',
    family: 'evm',
    explorerTxUrl: (h) => `https://polygonscan.com/tx/${h}`,
    explorerAddressUrl: (a) => `https://polygonscan.com/address/${a}`,
    accentHex: '#8247E5',
  },
  solana: {
    id: 'solana',
    name: 'Solana',
    shortName: 'SOL',
    symbol: 'SOL',
    family: 'solana',
    explorerTxUrl: (h) => `https://solscan.io/tx/${h}`,
    explorerAddressUrl: (a) => `https://solscan.io/account/${a}`,
    accentHex: '#14F195',
  },
  arbitrum: {
    id: 'arbitrum',
    name: 'Arbitrum',
    shortName: 'ARB',
    symbol: 'ETH',
    family: 'evm',
    explorerTxUrl: (h) => `https://arbiscan.io/tx/${h}`,
    explorerAddressUrl: (a) => `https://arbiscan.io/address/${a}`,
    accentHex: '#28A0F0',
  },
  base: {
    id: 'base',
    name: 'Base',
    shortName: 'BASE',
    symbol: 'ETH',
    family: 'evm',
    explorerTxUrl: (h) => `https://basescan.org/tx/${h}`,
    explorerAddressUrl: (a) => `https://basescan.org/address/${a}`,
    accentHex: '#0052FF',
  },
  optimism: {
    id: 'optimism',
    name: 'Optimism',
    shortName: 'OP',
    symbol: 'ETH',
    family: 'evm',
    explorerTxUrl: (h) => `https://optimistic.etherscan.io/tx/${h}`,
    explorerAddressUrl: (a) => `https://optimistic.etherscan.io/address/${a}`,
    accentHex: '#FF0420',
  },
  bsc: {
    id: 'bsc',
    name: 'BNB Chain',
    shortName: 'BSC',
    symbol: 'BNB',
    family: 'evm',
    explorerTxUrl: (h) => `https://bscscan.com/tx/${h}`,
    explorerAddressUrl: (a) => `https://bscscan.com/address/${a}`,
    accentHex: '#F3BA2F',
  },
};

export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return '$0.00';
  if (amount > 0 && amount < 0.01) {
    return `$${amount.toFixed(4)}`;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatTokenBalance(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return '0.0000';
  if (amount < 0.0001) return '<0.0001';
  if (amount >= 1000) {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }
  return amount.toFixed(4);
}

export function truncateAddress(addr: string, start = 6, end = 4): string {
  if (!addr) return '';
  if (addr.length <= start + end + 2) return addr;
  return `${addr.slice(0, start)}…${addr.slice(-end)}`;
}

export function formatTimestamp(ts: number): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return `${Math.max(diffSec, 1)}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
