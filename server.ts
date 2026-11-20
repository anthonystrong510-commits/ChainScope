import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';
import { registerSupabaseRoutes } from './server/supabaseDb.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type EvmChainKey = 'ethereum' | 'polygon' | 'arbitrum' | 'base' | 'optimism' | 'bsc';

interface EvmChainServerConfig {
  id: EvmChainKey;
  chainId: number;
  name: string;
  symbol: string;
  priceId: string;
  rpcs: string[];
  blockscoutApi?: string;
}

const EVM_CHAINS: Record<EvmChainKey, EvmChainServerConfig> = {
  ethereum: {
    id: 'ethereum',
    chainId: 1,
    name: 'Ethereum',
    symbol: 'ETH',
    priceId: 'ethereum',
    rpcs: [
      'https://ethereum-rpc.publicnode.com',
      'https://eth.llamarpc.com',
      'https://1rpc.io/eth',
      'https://cloudflare-eth.com',
    ],
    blockscoutApi: 'https://eth.blockscout.com/api/v2',
  },
  polygon: {
    id: 'polygon',
    chainId: 137,
    name: 'Polygon',
    symbol: 'POL',
    priceId: 'matic-network',
    rpcs: [
      'https://polygon-bor-rpc.publicnode.com',
      'https://polygon-rpc.com',
      'https://1rpc.io/matic',
    ],
    blockscoutApi: 'https://polygon.blockscout.com/api/v2',
  },
  arbitrum: {
    id: 'arbitrum',
    chainId: 42161,
    name: 'Arbitrum',
    symbol: 'ETH',
    priceId: 'ethereum',
    rpcs: [
      'https://arbitrum-one-rpc.publicnode.com',
      'https://arb1.arbitrum.io/rpc',
      'https://1rpc.io/arb',
    ],
    blockscoutApi: 'https://arbitrum.blockscout.com/api/v2',
  },
  base: {
    id: 'base',
    chainId: 8453,
    name: 'Base',
    symbol: 'ETH',
    priceId: 'ethereum',
    rpcs: [
      'https://base-rpc.publicnode.com',
      'https://mainnet.base.org',
      'https://1rpc.io/base',
    ],
    blockscoutApi: 'https://base.blockscout.com/api/v2',
  },
  optimism: {
    id: 'optimism',
    chainId: 10,
    name: 'Optimism',
    symbol: 'ETH',
    priceId: 'ethereum',
    rpcs: [
      'https://optimism-rpc.publicnode.com',
      'https://mainnet.optimism.io',
      'https://1rpc.io/op',
    ],
    blockscoutApi: 'https://optimism.blockscout.com/api/v2',
  },
  bsc: {
    id: 'bsc',
    chainId: 56,
    name: 'BNB Chain',
    symbol: 'BNB',
    priceId: 'binancecoin',
    rpcs: [
      'https://bsc-rpc.publicnode.com',
      'https://bsc-dataseed.binance.org',
      'https://1rpc.io/bnb',
    ],
  },
};

const SOLANA_RPCS = [
  'https://solana-rpc.publicnode.com',
  'https://api.mainnet-beta.solana.com',
  'https://rpc.ankr.com/solana',
];

// Known SPL token mints for clean labels & price mapping
const KNOWN_SPL_MINTS: Record<string, { symbol: string; name: string; priceId: string }> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', name: 'USD Coin', priceId: 'usd-coin' },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', name: 'Tether USD', priceId: 'tether' },
  So11111111111111111111111111111111111111112: { symbol: 'wSOL', name: 'Wrapped SOL', priceId: 'solana' },
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: { symbol: 'mSOL', name: 'Marinade Staked SOL', priceId: 'msol' },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: { symbol: 'JUP', name: 'Jupiter', priceId: 'jupiter-exchange-solana' },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { symbol: 'BONK', name: 'Bonk', priceId: 'bonk' },
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': { symbol: 'WETH', name: 'Wrapped Ether (Wormhole)', priceId: 'ethereum' },
};

interface PriceEntry {
  usd: number;
  usd_24h_change: number;
}

let priceCache: { data: Record<string, PriceEntry>; fetchedAt: number; source: string } = {
  data: {},
  fetchedAt: 0,
  source: 'uninitialized',
};

const SYMBOL_TO_PRICE_ID: Record<string, string> = {
  ETH: 'ethereum',
  WETH: 'ethereum',
  STETH: 'staked-ether',
  WSTETH: 'staked-ether',
  POL: 'matic-network',
  MATIC: 'matic-network',
  WMATIC: 'matic-network',
  BNB: 'binancecoin',
  WBNB: 'binancecoin',
  SOL: 'solana',
  WSOL: 'solana',
  MSOL: 'msol',
  USDC: 'usd-coin',
  'USDC.E': 'usd-coin',
  USDT: 'tether',
  DAI: 'dai',
  WBTC: 'wrapped-bitcoin',
  LINK: 'chainlink',
  UNI: 'uniswap',
  AAVE: 'aave',
  JUP: 'jupiter-exchange-solana',
  BONK: 'bonk',
  ARB: 'arbitrum',
  OP: 'optimism',
};

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 6500): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getLivePrices(): Promise<{ prices: Record<string, PriceEntry>; source: string }> {
  const now = Date.now();
  if (now - priceCache.fetchedAt < 45_000 && Object.keys(priceCache.data).length > 0) {
    return { prices: priceCache.data, source: priceCache.source };
  }

  const ids = [
    'ethereum',
    'matic-network',
    'binancecoin',
    'solana',
    'usd-coin',
    'tether',
    'dai',
    'wrapped-bitcoin',
    'chainlink',
    'uniswap',
    'aave',
    'staked-ether',
    'arbitrum',
    'optimism',
    'jupiter-exchange-solana',
    'bonk',
    'msol',
  ].join(',');

  try {
    const res = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      { headers: { Accept: 'application/json' } },
      6000
    );
    if (res.ok) {
      const json = (await res.json()) as Record<string, { usd?: number; usd_24h_change?: number }>;
      const normalized: Record<string, PriceEntry> = {};
      for (const [k, v] of Object.entries(json)) {
        if (typeof v?.usd === 'number') {
          normalized[k] = {
            usd: v.usd,
            usd_24h_change: typeof v.usd_24h_change === 'number' ? v.usd_24h_change : 0,
          };
        }
      }
      if (Object.keys(normalized).length >= 4) {
        priceCache = { data: normalized, fetchedAt: now, source: 'coingecko' };
        return { prices: normalized, source: 'coingecko' };
      }
    }
  } catch {
    // Fall through to CryptoCompare fallback
  }

  try {
    const ccRes = await fetchWithTimeout(
      'https://min-api.cryptocompare.com/data/pricemultifull?fsyms=ETH,MATIC,BNB,SOL,USDC,USDT,DAI,WBTC,LINK,UNI,AAVE,ARB,OP&tsyms=USD',
      { headers: { Accept: 'application/json' } },
      6000
    );
    if (ccRes.ok) {
      const ccJson = (await ccRes.json()) as {
        RAW?: Record<string, { USD?: { PRICE?: number; CHANGEPCT24HOUR?: number } }>;
      };
      const raw = ccJson.RAW || {};
      const mapEntry = (sym: string, id: string, target: Record<string, PriceEntry>) => {
        const entry = raw[sym]?.USD;
        if (entry && typeof entry.PRICE === 'number') {
          target[id] = {
            usd: entry.PRICE,
            usd_24h_change: typeof entry.CHANGEPCT24HOUR === 'number' ? entry.CHANGEPCT24HOUR : 0,
          };
        }
      };
      const normalized: Record<string, PriceEntry> = {};
      mapEntry('ETH', 'ethereum', normalized);
      mapEntry('MATIC', 'matic-network', normalized);
      mapEntry('BNB', 'binancecoin', normalized);
      mapEntry('SOL', 'solana', normalized);
      mapEntry('USDC', 'usd-coin', normalized);
      mapEntry('USDT', 'tether', normalized);
      mapEntry('DAI', 'dai', normalized);
      mapEntry('WBTC', 'wrapped-bitcoin', normalized);
      mapEntry('LINK', 'chainlink', normalized);
      mapEntry('UNI', 'uniswap', normalized);
      mapEntry('AAVE', 'aave', normalized);
      mapEntry('ARB', 'arbitrum', normalized);
      mapEntry('OP', 'optimism', normalized);
      if (Object.keys(normalized).length >= 3) {
        priceCache = { data: normalized, fetchedAt: now, source: 'cryptocompare' };
        return { prices: normalized, source: 'cryptocompare' };
      }
    }
  } catch {
    // Fall through to cached or safe fallback
  }

  if (Object.keys(priceCache.data).length > 0) {
    return { prices: priceCache.data, source: `${priceCache.source}-cached` };
  }

  // Last-resort offline fallback only if all price feeds are blocked
  return {
    prices: {
      ethereum: { usd: 3150, usd_24h_change: 0 },
      'matic-network': { usd: 0.55, usd_24h_change: 0 },
      binancecoin: { usd: 620, usd_24h_change: 0 },
      solana: { usd: 185, usd_24h_change: 0 },
      'usd-coin': { usd: 1, usd_24h_change: 0 },
      tether: { usd: 1, usd_24h_change: 0 },
      dai: { usd: 1, usd_24h_change: 0 },
    },
    source: 'fallback',
  };
}

async function callJsonRpc(rpcs: string[], payload: unknown): Promise<{ result: unknown; rpcUrl: string }> {
  let lastErr: Error | null = null;
  for (const rpcUrl of rpcs) {
    try {
      const res = await fetchWithTimeout(
        rpcUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        6000
      );
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} from ${rpcUrl}`);
        continue;
      }
      const data = (await res.json()) as { result?: unknown; error?: { message?: string } } | Array<unknown>;
      if (Array.isArray(data)) {
        return { result: data, rpcUrl };
      }
      if (data.error) {
        lastErr = new Error(data.error.message || 'RPC error');
        continue;
      }
      return { result: data.result, rpcUrl };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr || new Error('All RPC endpoints failed');
}

async function fetchBlockscoutData(baseUrl: string, address: string) {
  const tokens: Array<{
    symbol: string;
    name: string;
    balance: number;
    decimals: number;
    contractAddress: string;
    usdPrice?: number;
  }> = [];
  const transactions: Array<{
    hash: string;
    from: string;
    to: string;
    valueFormatted: string;
    symbol: string;
    feeFormatted: string;
    timestamp: number;
    status: 'confirmed' | 'failed' | 'pending';
    method?: string;
    blockNumber?: number;
  }> = [];

  try {
    const [tokRes, txRes] = await Promise.allSettled([
      fetchWithTimeout(`${baseUrl}/addresses/${address}/tokens?type=ERC-20`, { headers: { Accept: 'application/json' } }, 5500),
      fetchWithTimeout(`${baseUrl}/addresses/${address}/transactions`, { headers: { Accept: 'application/json' } }, 5500),
    ]);

    if (tokRes.status === 'fulfilled' && tokRes.value.ok) {
      const tokJson = (await tokRes.value.json()) as {
        items?: Array<{
          value?: string;
          token?: {
            symbol?: string;
            name?: string;
            decimals?: string;
            address?: string;
            exchange_rate?: string | null;
          };
        }>;
      };
      for (const item of (tokJson.items || []).slice(0, 20)) {
        const decimals = Number(item.token?.decimals ?? '18');
        const rawVal = item.value ?? '0';
        const symbol = (item.token?.symbol || 'TOKEN').slice(0, 14);
        const name = item.token?.name || symbol;
        if (!Number.isFinite(decimals) || decimals > 36) continue;
        try {
          const balance = Number(ethers.formatUnits(rawVal, decimals));
          if (balance <= 0) continue;
          const exchangeRate = item.token?.exchange_rate ? Number(item.token.exchange_rate) : undefined;
          tokens.push({
            symbol,
            name,
            balance,
            decimals,
            contractAddress: item.token?.address || '',
            usdPrice: exchangeRate && Number.isFinite(exchangeRate) ? exchangeRate : undefined,
          });
        } catch {
          // ignore malformed token amount
        }
      }
    }

    if (txRes.status === 'fulfilled' && txRes.value.ok) {
      const txJson = (await txRes.value.json()) as {
        items?: Array<{
          hash?: string;
          from?: { hash?: string };
          to?: { hash?: string } | null;
          value?: string;
          fee?: { value?: string };
          timestamp?: string;
          status?: string;
          result?: string;
          method?: string | null;
          block_number?: number;
        }>;
      };
      for (const tx of (txJson.items || []).slice(0, 15)) {
        if (!tx.hash) continue;
        let valStr = '0';
        let feeStr = '0';
        try {
          valStr = ethers.formatEther(tx.value || '0');
        } catch {
          valStr = '0';
        }
        try {
          feeStr = ethers.formatEther(tx.fee?.value || '0');
        } catch {
          feeStr = '0';
        }
        const ts = tx.timestamp ? Date.parse(tx.timestamp) : Date.now();
        const isFailed = tx.status === 'error' || tx.result === 'reverted';
        transactions.push({
          hash: tx.hash,
          from: tx.from?.hash || '',
          to: tx.to?.hash || 'Contract Creation',
          valueFormatted: Number(valStr).toFixed(6).replace(/\.?0+$/, '') || '0',
          symbol: '',
          feeFormatted: Number(feeStr).toFixed(6).replace(/\.?0+$/, '') || '0',
          timestamp: Number.isFinite(ts) ? ts : Date.now(),
          status: isFailed ? 'failed' : 'confirmed',
          method: tx.method || undefined,
          blockNumber: tx.block_number,
        });
      }
    }
  } catch {
    // non-fatal; native RPC balance still succeeds
  }

  return { tokens, transactions };
}

async function scanSingleEvmChain(
  config: EvmChainServerConfig,
  address: string,
  prices: Record<string, PriceEntry>
) {
  const startedAt = Date.now();
  try {
    const batchPayload = [
      { jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] },
      { jsonrpc: '2.0', id: 2, method: 'eth_blockNumber', params: [] },
    ];
    const { result, rpcUrl } = await callJsonRpc(config.rpcs, batchPayload);
    const arr = Array.isArray(result) ? (result as Array<{ id: number; result?: string }>) : [];
    const balHex = arr.find((r) => r.id === 1)?.result || '0x0';
    const blkHex = arr.find((r) => r.id === 2)?.result || '0x0';

    const nativeBalance = Number(ethers.formatEther(BigInt(balHex)));
    const blockNumber = parseInt(blkHex, 16) || 0;
    const priceInfo = prices[config.priceId] || { usd: 0, usd_24h_change: 0 };
    const nativeUsd = nativeBalance * priceInfo.usd;

    let explorerData: Awaited<ReturnType<typeof fetchBlockscoutData>> = { tokens: [], transactions: [] };
    if (config.blockscoutApi) {
      explorerData = await fetchBlockscoutData(config.blockscoutApi, address);
    }

    const tokenHoldings = explorerData.tokens.map((t) => {
      const upper = t.symbol.toUpperCase();
      const mappedPriceId = SYMBOL_TO_PRICE_ID[upper];
      const livePrice =
        typeof t.usdPrice === 'number'
          ? t.usdPrice
          : mappedPriceId && prices[mappedPriceId]
          ? prices[mappedPriceId].usd
          : 0;
      const change24h = mappedPriceId && prices[mappedPriceId] ? prices[mappedPriceId].usd_24h_change : 0;
      return {
        chainId: config.id,
        symbol: t.symbol,
        name: t.name,
        balance: t.balance,
        usdPrice: livePrice,
        usdValue: t.balance * livePrice,
        change24h,
        isNative: false,
        contractAddress: t.contractAddress,
      };
    });

    const totalUsd = nativeUsd + tokenHoldings.reduce((sum, t) => sum + t.usdValue, 0);

    const transactions = explorerData.transactions.map((tx) => ({
      ...tx,
      chainId: config.id,
      symbol: config.symbol,
      direction:
        tx.from.toLowerCase() === address.toLowerCase()
          ? ('out' as const)
          : tx.to.toLowerCase() === address.toLowerCase()
          ? ('in' as const)
          : ('self' as const),
    }));

    return {
      chainId: config.id,
      status: 'ok' as const,
      address,
      nativeSymbol: config.symbol,
      nativeBalance,
      nativeUsdPrice: priceInfo.usd,
      nativeUsdValue: nativeUsd,
      nativeChange24h: priceInfo.usd_24h_change,
      totalUsd,
      blockNumber,
      rpcSource: new URL(rpcUrl).hostname,
      latencyMs: Date.now() - startedAt,
      tokens: tokenHoldings,
      transactions,
    };
  } catch (err) {
    return {
      chainId: config.id,
      status: 'error' as const,
      address,
      nativeSymbol: config.symbol,
      nativeBalance: 0,
      nativeUsdPrice: prices[config.priceId]?.usd || 0,
      nativeUsdValue: 0,
      nativeChange24h: prices[config.priceId]?.usd_24h_change || 0,
      totalUsd: 0,
      blockNumber: 0,
      rpcSource: 'unavailable',
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : 'Scan failed',
      tokens: [],
      transactions: [],
    };
  }
}

async function scanSolanaChain(address: string, prices: Record<string, PriceEntry>) {
  const startedAt = Date.now();
  try {
    const batchPayload = [
      { jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address, { commitment: 'confirmed' }] },
      { jsonrpc: '2.0', id: 2, method: 'getSlot', params: [{ commitment: 'confirmed' }] },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'getTokenAccountsByOwner',
        params: [
          address,
          { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
          { encoding: 'jsonParsed', commitment: 'confirmed' },
        ],
      },
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'getSignaturesForAddress',
        params: [address, { limit: 12 }],
      },
    ];

    const { result, rpcUrl } = await callJsonRpc(SOLANA_RPCS, batchPayload);
    const arr = Array.isArray(result) ? (result as Array<{ id: number; result?: unknown }>) : [];

    const balResult = arr.find((r) => r.id === 1)?.result as { value?: number } | undefined;
    const slotResult = arr.find((r) => r.id === 2)?.result as number | undefined;
    const tokenResult = arr.find((r) => r.id === 3)?.result as {
      value?: Array<{
        account?: {
          data?: {
            parsed?: {
              info?: {
                mint?: string;
                tokenAmount?: { uiAmount?: number | null; decimals?: number };
              };
            };
          };
        };
      }>;
    } | undefined;
    const sigsResult = (arr.find((r) => r.id === 4)?.result as Array<{
      signature: string;
      slot: number;
      err: unknown;
      blockTime?: number | null;
    }>) || [];

    const lamports = balResult?.value ?? 0;
    const nativeBalance = lamports / 1_000_000_000;
    const priceInfo = prices['solana'] || { usd: 0, usd_24h_change: 0 };
    const nativeUsd = nativeBalance * priceInfo.usd;

    const tokens = (tokenResult?.value || [])
      .map((entry) => {
        const info = entry.account?.data?.parsed?.info;
        const mint = info?.mint || '';
        const uiAmount = info?.tokenAmount?.uiAmount ?? 0;
        if (!mint || !uiAmount || uiAmount <= 0) return null;
        const known = KNOWN_SPL_MINTS[mint];
        const symbol = known?.symbol || `${mint.slice(0, 4)}…${mint.slice(-3)}`;
        const name = known?.name || 'SPL Token';
        const mappedPrice = known?.priceId && prices[known.priceId] ? prices[known.priceId] : undefined;
        const usdPrice = mappedPrice?.usd ?? 0;
        return {
          chainId: 'solana' as const,
          symbol,
          name,
          balance: uiAmount,
          usdPrice,
          usdValue: uiAmount * usdPrice,
          change24h: mappedPrice?.usd_24h_change ?? 0,
          isNative: false,
          contractAddress: mint,
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .slice(0, 20);

    // Fetch parsed details for top 8 recent Solana signatures in one batch
    const transactions: Array<{
      hash: string;
      chainId: 'solana';
      from: string;
      to: string;
      valueFormatted: string;
      symbol: string;
      feeFormatted: string;
      timestamp: number;
      status: 'confirmed' | 'failed' | 'pending';
      direction: 'in' | 'out' | 'self';
      method?: string;
      blockNumber?: number;
    }> = [];

    const topSigs = sigsResult.slice(0, 8);
    if (topSigs.length > 0) {
      try {
        const txBatch = topSigs.map((s, idx) => ({
          jsonrpc: '2.0',
          id: idx + 1,
          method: 'getTransaction',
          params: [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
        }));
        const txRes = await callJsonRpc([rpcUrl, ...SOLANA_RPCS], txBatch);
        const txArr = Array.isArray(txRes.result)
          ? (txRes.result as Array<{
              id: number;
              result?: {
                meta?: {
                  err?: unknown;
                  fee?: number;
                  preBalances?: number[];
                  postBalances?: number[];
                };
                transaction?: {
                  message?: {
                    accountKeys?: Array<{ pubkey?: string } | string>;
                  };
                };
              } | null;
            }>)
          : [];

        for (let i = 0; i < topSigs.length; i++) {
          const sigInfo = topSigs[i];
          const parsed = txArr.find((r) => r.id === i + 1)?.result;
          const keys = (parsed?.transaction?.message?.accountKeys || []).map((k) =>
            typeof k === 'string' ? k : k.pubkey || ''
          );
          const ownerIdx = keys.findIndex((k) => k === address);
          const pre = parsed?.meta?.preBalances?.[ownerIdx] ?? 0;
          const post = parsed?.meta?.postBalances?.[ownerIdx] ?? 0;
          const feeLamports = parsed?.meta?.fee ?? 5000;
          const deltaSol = ownerIdx >= 0 ? (post - pre) / 1_000_000_000 : 0;
          const direction: 'in' | 'out' | 'self' = deltaSol > 0 ? 'in' : deltaSol < 0 ? 'out' : 'self';
          const counterparty = keys.find((k) => k && k !== address) || address;

          transactions.push({
            hash: sigInfo.signature,
            chainId: 'solana',
            from: direction === 'in' ? counterparty : address,
            to: direction === 'in' ? address : counterparty,
            valueFormatted: Math.abs(deltaSol).toFixed(6).replace(/\.?0+$/, '') || '0',
            symbol: 'SOL',
            feeFormatted: (feeLamports / 1_000_000_000).toFixed(6).replace(/\.?0+$/, '') || '0',
            timestamp: sigInfo.blockTime ? sigInfo.blockTime * 1000 : Date.now(),
            status: sigInfo.err ? 'failed' : 'confirmed',
            direction,
            blockNumber: sigInfo.slot,
          });
        }
      } catch {
        // Fallback to signature summaries if getTransaction batch is throttled
        for (const sigInfo of topSigs) {
          transactions.push({
            hash: sigInfo.signature,
            chainId: 'solana',
            from: address,
            to: address,
            valueFormatted: '0',
            symbol: 'SOL',
            feeFormatted: '0.000005',
            timestamp: sigInfo.blockTime ? sigInfo.blockTime * 1000 : Date.now(),
            status: sigInfo.err ? 'failed' : 'confirmed',
            direction: 'self',
            blockNumber: sigInfo.slot,
          });
        }
      }
    }

    const totalUsd = nativeUsd + tokens.reduce((sum, t) => sum + t.usdValue, 0);

    return {
      chainId: 'solana' as const,
      status: 'ok' as const,
      address,
      nativeSymbol: 'SOL',
      nativeBalance,
      nativeUsdPrice: priceInfo.usd,
      nativeUsdValue: nativeUsd,
      nativeChange24h: priceInfo.usd_24h_change,
      totalUsd,
      blockNumber: slotResult ?? 0,
      rpcSource: new URL(rpcUrl).hostname,
      latencyMs: Date.now() - startedAt,
      tokens,
      transactions,
    };
  } catch (err) {
    return {
      chainId: 'solana' as const,
      status: 'error' as const,
      address,
      nativeSymbol: 'SOL',
      nativeBalance: 0,
      nativeUsdPrice: prices['solana']?.usd || 0,
      nativeUsdValue: 0,
      nativeChange24h: prices['solana']?.usd_24h_change || 0,
      totalUsd: 0,
      blockNumber: 0,
      rpcSource: 'unavailable',
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : 'Solana RPC unavailable',
      tokens: [],
      transactions: [],
    };
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/prices', async (_req, res) => {
    try {
      const result = await getLivePrices();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load prices' });
    }
  });

  app.post('/api/scan/evm', async (req, res) => {
    const { address, chains } = (req.body || {}) as { address?: string; chains?: EvmChainKey[] };
    if (!address || !ethers.isAddress(address)) {
      res.status(400).json({ error: 'Valid EVM 0x address is required' });
      return;
    }

    const targetKeys: EvmChainKey[] =
      Array.isArray(chains) && chains.length > 0
        ? chains.filter((c): c is EvmChainKey => c in EVM_CHAINS)
        : (['ethereum', 'polygon', 'arbitrum', 'base', 'optimism', 'bsc'] as EvmChainKey[]);

    const { prices, source } = await getLivePrices();
    const results = await Promise.all(
      targetKeys.map((key) => scanSingleEvmChain(EVM_CHAINS[key], ethers.getAddress(address), prices))
    );

    res.json({
      address: ethers.getAddress(address),
      priceSource: source,
      scannedAt: Date.now(),
      chains: results,
    });
  });

  app.post('/api/scan/solana', async (req, res) => {
    const { address } = (req.body || {}) as { address?: string };
    if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address.trim())) {
      res.status(400).json({ error: 'Valid Solana base58 address is required' });
      return;
    }

    const { prices, source } = await getLivePrices();
    const chainResult = await scanSolanaChain(address.trim(), prices);

    res.json({
      address: address.trim(),
      priceSource: source,
      scannedAt: Date.now(),
      chain: chainResult,
    });
  });

  app.get('/api/resolve-ens', async (req, res) => {
    const name = String(req.query.name || '').trim().toLowerCase();
    if (!name.endsWith('.eth') || name.length < 5) {
      res.status(400).json({ error: 'Invalid .eth ENS name' });
      return;
    }

    for (const rpcUrl of EVM_CHAINS.ethereum.rpcs) {
      try {
        const provider = new ethers.JsonRpcProvider(rpcUrl, 1, { staticNetwork: true });
        const resolved = await provider.resolveName(name);
        if (resolved) {
          res.json({ name, address: resolved });
          return;
        }
      } catch {
        // try next rpc
      }
    }
    res.status(404).json({ error: `Could not resolve ${name}` });
  });

  async function verifyWalletChainBalance(chain: string, address: string): Promise<{
    ok: boolean;
    chain: string;
    address: string;
    symbol: string;
    balance: number;
    assetUsd: number;
    solUsd: number;
    error?: string;
  }> {
    const { prices } = await getLivePrices();
    const solUsd = prices['solana']?.usd || 185;
    const cleanChain = chain.trim().toLowerCase();
    const cleanAddr = address.trim();

    if (cleanChain === 'solana') {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(cleanAddr)) {
        return {
          ok: false,
          chain: 'solana',
          address: cleanAddr,
          symbol: 'SOL',
          balance: 0,
          assetUsd: solUsd,
          solUsd,
          error: 'Invalid Solana public address.',
        };
      }
      try {
        const { result } = await callJsonRpc(SOLANA_RPCS, {
          jsonrpc: '2.0',
          id: 1,
          method: 'getBalance',
          params: [cleanAddr, { commitment: 'confirmed' }],
        });
        const lamports = (result as { value?: number } | undefined)?.value ?? 0;
        return {
          ok: true,
          chain: 'solana',
          address: cleanAddr,
          symbol: 'SOL',
          balance: lamports / 1_000_000_000,
          assetUsd: solUsd,
          solUsd,
        };
      } catch (err) {
        return {
          ok: false,
          chain: 'solana',
          address: cleanAddr,
          symbol: 'SOL',
          balance: 0,
          assetUsd: solUsd,
          solUsd,
          error: err instanceof Error ? err.message : 'Solana RPC balance check failed.',
        };
      }
    }

    if (cleanChain in EVM_CHAINS) {
      const cfg = EVM_CHAINS[cleanChain as EvmChainKey];
      if (!ethers.isAddress(cleanAddr)) {
        return {
          ok: false,
          chain: cleanChain,
          address: cleanAddr,
          symbol: cfg.symbol,
          balance: 0,
          assetUsd: prices[cfg.priceId]?.usd || 0,
          solUsd,
          error: `Invalid ${cfg.name} 0x address.`,
        };
      }
      try {
        const checksumAddr = ethers.getAddress(cleanAddr);
        const { result } = await callJsonRpc(cfg.rpcs, {
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getBalance',
          params: [checksumAddr, 'latest'],
        });
        const balance = Number(ethers.formatEther(BigInt(String(result || '0x0'))));
        return {
          ok: true,
          chain: cleanChain,
          address: checksumAddr,
          symbol: cfg.symbol,
          balance,
          assetUsd: prices[cfg.priceId]?.usd || 0,
          solUsd,
        };
      } catch (err) {
        return {
          ok: false,
          chain: cleanChain,
          address: cleanAddr,
          symbol: cfg.symbol,
          balance: 0,
          assetUsd: prices[cfg.priceId]?.usd || 0,
          solUsd,
          error: err instanceof Error ? err.message : `${cfg.name} RPC balance check failed.`,
        };
      }
    }

    return {
      ok: false,
      chain: cleanChain,
      address: cleanAddr,
      symbol: 'UNKNOWN',
      balance: 0,
      assetUsd: 0,
      solUsd,
      error: `Unsupported chain "${cleanChain}".`,
    };
  }

  // --- SUPABASE POSTGRESQL PRIMARY DATA ENGINE ---
  registerSupabaseRoutes(app, __dirname, { verifyWalletChainBalance });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('/{*splat}', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`ChainScope server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ChainScope server:', err);
  process.exit(1);
});
