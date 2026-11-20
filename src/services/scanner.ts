import type { ChainScanResult, WalletEntry } from '../types/wallet';

export interface EvmScanResponse {
  address: string;
  priceSource: string;
  scannedAt: number;
  chains: ChainScanResult[];
}

export interface SolanaScanResponse {
  address: string;
  priceSource: string;
  scannedAt: number;
  chain: ChainScanResult;
}

export async function scanEvmAddress(address: string, chains?: string[]): Promise<EvmScanResponse> {
  const res = await fetch('/api/scan/evm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, chains }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'EVM scan failed' }));
    throw new Error(err.error || 'EVM scan failed');
  }
  return res.json();
}

export async function scanSolanaAddress(address: string): Promise<SolanaScanResponse> {
  const res = await fetch('/api/scan/solana', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Solana scan failed' }));
    throw new Error(err.error || 'Solana scan failed');
  }
  return res.json();
}

export async function resolveEnsName(name: string): Promise<{ name: string; address: string }> {
  const res = await fetch(`/api/resolve-ens?name=${encodeURIComponent(name.trim())}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'ENS resolution failed' }));
    throw new Error(err.error || 'ENS resolution failed');
  }
  return res.json();
}

export async function scanWalletAllChains(wallet: WalletEntry): Promise<{
  chains: Record<string, ChainScanResult>;
  priceSource: string;
  scannedAt: number;
}> {
  const chains: Record<string, ChainScanResult> = {};
  let priceSource = 'live';

  const tasks: Promise<void>[] = [];

  if (wallet.evmAddress) {
    tasks.push(
      scanEvmAddress(wallet.evmAddress).then((evmRes) => {
        priceSource = evmRes.priceSource;
        for (const c of evmRes.chains) {
          chains[c.chainId] = c;
        }
      })
    );
  }

  if (wallet.solanaAddress) {
    tasks.push(
      scanSolanaAddress(wallet.solanaAddress).then((solRes) => {
        priceSource = solRes.priceSource || priceSource;
        chains[solRes.chain.chainId] = solRes.chain;
      })
    );
  }

  await Promise.all(tasks);

  return {
    chains,
    priceSource,
    scannedAt: Date.now(),
  };
}

export interface Eip1193Provider {
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isRabby?: boolean;
  isTrust?: boolean;
  isTrustWallet?: boolean;
  isRainbow?: boolean;
  isOkxWallet?: boolean;
  isPhantom?: boolean;
  isBraveWallet?: boolean;
  providers?: Eip1193Provider[];
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
}

export interface SolanaInjectedProvider {
  isPhantom?: boolean;
  isSolflare?: boolean;
  isTrust?: boolean;
  isBackpack?: boolean;
  isCoinbaseWallet?: boolean;
  isOkxWallet?: boolean;
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  signMessage?: (message: Uint8Array, display?: string) => Promise<{ signature: Uint8Array }>;
  publicKey?: { toString: () => string } | null;
}

export interface DetectedWalletOption {
  id: string;
  family: 'evm' | 'solana';
  name: string;
  icon?: string;
  rdns?: string;
  evmProvider?: Eip1193Provider;
  solanaProvider?: SolanaInjectedProvider;
}

export interface MobileWalletDeepLink {
  id: string;
  name: string;
  subtitle: string;
  chains: string;
  href: string;
}

export interface DeviceEnvironment {
  os: 'ios' | 'android' | 'desktop';
  isMobile: boolean;
  isSafari: boolean;
  isInWalletBrowser: boolean;
  walletBrowserName: string | null;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
    solana?: SolanaInjectedProvider;
    solflare?: SolanaInjectedProvider;
    phantom?: { solana?: SolanaInjectedProvider; ethereum?: Eip1193Provider };
    trustwallet?: { solana?: SolanaInjectedProvider; ethereum?: Eip1193Provider };
    coinbaseSolana?: SolanaInjectedProvider;
    backpack?: SolanaInjectedProvider;
    okxwallet?: Eip1193Provider & { solana?: SolanaInjectedProvider };
  }
}

export function detectDeviceEnvironment(): DeviceEnvironment {
  if (typeof navigator === 'undefined') {
    return {
      os: 'desktop',
      isMobile: false,
      isSafari: false,
      isInWalletBrowser: false,
      walletBrowserName: null,
    };
  }

  const ua = navigator.userAgent || '';
  const isIPadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const isIOS = /iPad|iPhone|iPod/i.test(ua) || isIPadOs;
  const isAndroid = /android/i.test(ua);
  const os: DeviceEnvironment['os'] = isIOS ? 'ios' : isAndroid ? 'android' : 'desktop';
  const isMobile = isIOS || isAndroid;

  const isSafari =
    isIOS && /safari/i.test(ua) && !/crios|fxios|opios|edgios|metamask|phantom|trust/i.test(ua);

  let walletBrowserName: string | null = null;
  if (/MetaMaskMobile/i.test(ua) || (isMobile && window.ethereum?.isMetaMask)) {
    walletBrowserName = 'MetaMask';
  } else if (/Phantom/i.test(ua) || (isMobile && window.phantom?.solana?.isPhantom)) {
    walletBrowserName = 'Phantom';
  } else if (
    /Trust/i.test(ua) ||
    (isMobile && (window.ethereum?.isTrust || window.ethereum?.isTrustWallet))
  ) {
    walletBrowserName = 'Trust Wallet';
  } else if (/CoinbaseWallet/i.test(ua) || (isMobile && window.ethereum?.isCoinbaseWallet)) {
    walletBrowserName = 'Coinbase Wallet';
  } else if (/Solflare/i.test(ua) || (isMobile && window.solflare?.isSolflare)) {
    walletBrowserName = 'Solflare';
  } else if (/Rainbow/i.test(ua) || (isMobile && window.ethereum?.isRainbow)) {
    walletBrowserName = 'Rainbow';
  } else if (/OKApp|OKX/i.test(ua) || (isMobile && window.okxwallet)) {
    walletBrowserName = 'OKX Wallet';
  }

  return {
    os,
    isMobile,
    isSafari,
    isInWalletBrowser: Boolean(walletBrowserName),
    walletBrowserName,
  };
}

function getEvmProviderName(p: Eip1193Provider): string {
  if (p.isRabby) return 'Rabby Wallet';
  if (p.isTrust || p.isTrustWallet) return 'Trust Wallet';
  if (p.isCoinbaseWallet) return 'Coinbase Wallet';
  if (p.isRainbow) return 'Rainbow';
  if (p.isPhantom) return 'Phantom (EVM)';
  if (p.isOkxWallet) return 'OKX Wallet';
  if (p.isBraveWallet) return 'Brave Wallet';
  if (p.isMetaMask) return 'MetaMask';
  return 'Browser EVM Wallet';
}

export function detectInjectedProviders() {
  const hasEvm = typeof window !== 'undefined' && Boolean(window.ethereum || window.okxwallet);
  const evmLabel = window?.ethereum ? getEvmProviderName(window.ethereum) : 'Browser EVM Wallet';

  const solProvider =
    typeof window !== 'undefined'
      ? window.phantom?.solana ||
        window.solflare ||
        window.solana ||
        window.trustwallet?.solana ||
        window.backpack ||
        window.okxwallet?.solana
      : undefined;
  const hasSolana = Boolean(solProvider);
  const solanaLabel = solProvider?.isPhantom
    ? 'Phantom'
    : solProvider?.isSolflare
    ? 'Solflare'
    : solProvider?.isTrust
    ? 'Trust Wallet'
    : solProvider?.isBackpack
    ? 'Backpack'
    : solProvider?.isOkxWallet
    ? 'OKX Solana'
    : 'Solana Browser Wallet';

  return { hasEvm, evmLabel, hasSolana, solanaLabel };
}

export function collectDetectedWalletsSync(): DetectedWalletOption[] {
  if (typeof window === 'undefined') return [];
  const list: DetectedWalletOption[] = [];
  const seenNames = new Set<string>();

  const pushEvm = (id: string, name: string, provider: Eip1193Provider, rdns?: string, icon?: string) => {
    const key = `evm:${name}`;
    if (seenNames.has(key)) return;
    seenNames.add(key);
    list.push({ id, family: 'evm', name, evmProvider: provider, rdns, icon });
  };

  const pushSol = (id: string, name: string, provider: SolanaInjectedProvider) => {
    const key = `sol:${name}`;
    if (seenNames.has(key)) return;
    seenNames.add(key);
    list.push({ id, family: 'solana', name, solanaProvider: provider });
  };

  if (window.ethereum) {
    const subProviders = Array.isArray(window.ethereum.providers)
      ? window.ethereum.providers
      : [window.ethereum];
    subProviders.forEach((p, idx) => {
      if (p && typeof p.request === 'function') {
        const name = getEvmProviderName(p);
        pushEvm(`evm-legacy-${idx}-${name}`, name, p);
      }
    });
  }
  if (window.phantom?.ethereum) {
    pushEvm('evm-phantom', 'Phantom (EVM)', window.phantom.ethereum);
  }
  if (window.trustwallet?.ethereum) {
    pushEvm('evm-trust', 'Trust Wallet', window.trustwallet.ethereum);
  }
  if (window.okxwallet && typeof window.okxwallet.request === 'function') {
    pushEvm('evm-okx', 'OKX Wallet', window.okxwallet);
  }

  if (window.phantom?.solana) {
    pushSol('sol-phantom', 'Phantom (Solana)', window.phantom.solana);
  }
  if (window.solflare) {
    pushSol('sol-solflare', 'Solflare (Solana)', window.solflare);
  }
  if (window.solana) {
    const name = window.solana.isPhantom
      ? 'Phantom (Solana)'
      : window.solana.isSolflare
      ? 'Solflare (Solana)'
      : window.solana.isTrust
      ? 'Trust Wallet (Solana)'
      : 'Solana Wallet';
    pushSol('sol-window', name, window.solana);
  }
  if (window.trustwallet?.solana) {
    pushSol('sol-trust', 'Trust Wallet (Solana)', window.trustwallet.solana);
  }
  if (window.backpack) {
    pushSol('sol-backpack', 'Backpack (Solana)', window.backpack);
  }
  if (window.okxwallet?.solana) {
    pushSol('sol-okx', 'OKX Wallet (Solana)', window.okxwallet.solana);
  }

  return list;
}

export function subscribeEip6963Wallets(
  onDiscover: (wallet: DetectedWalletOption) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event) => {
    const custom = event as CustomEvent<{
      info?: { uuid?: string; name?: string; icon?: string; rdns?: string };
      provider?: Eip1193Provider;
    }>;
    const info = custom.detail?.info;
    const provider = custom.detail?.provider;
    if (!info?.name || !provider || typeof provider.request !== 'function') return;
    onDiscover({
      id: `eip6963-${info.uuid || info.rdns || info.name}`,
      family: 'evm',
      name: info.name,
      icon: info.icon,
      rdns: info.rdns,
      evmProvider: provider,
    });
  };

  window.addEventListener('eip6963:announceProvider', handler);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  return () => {
    window.removeEventListener('eip6963:announceProvider', handler);
  };
}

export function getMobileWalletDeepLinks(rawUrl?: string): MobileWalletDeepLink[] {
  const currentUrl =
    rawUrl || (typeof window !== 'undefined' ? window.location.href : 'https://localhost:3000/');
  let hostAndPath = currentUrl.replace(/^https?:\/\//i, '');
  let origin = 'https://localhost:3000';
  try {
    const parsed = new URL(currentUrl);
    hostAndPath = `${parsed.host}${parsed.pathname}${parsed.search}`;
    origin = parsed.origin;
  } catch {
    // keep fallback
  }

  const encodedUrl = encodeURIComponent(currentUrl);
  const encodedOrigin = encodeURIComponent(origin);

  return [
    {
      id: 'phantom',
      name: 'Phantom',
      subtitle: 'iOS & Android Wallet Browser',
      chains: 'Solana + EVM',
      href: `https://phantom.app/ul/browse/${encodedUrl}?ref=${encodedOrigin}`,
    },
    {
      id: 'metamask',
      name: 'MetaMask',
      subtitle: 'iOS & Android DApp Browser',
      chains: 'ETH, Base, Polygon, Arbitrum',
      href: `https://metamask.app.link/dapp/${hostAndPath}`,
    },
    {
      id: 'trust',
      name: 'Trust Wallet',
      subtitle: 'iOS & Android Mobile Browser',
      chains: 'Multi-Chain EVM + SOL',
      href: `https://link.trustwallet.com/open_url?coin_id=60&url=${encodedUrl}`,
    },
    {
      id: 'coinbase',
      name: 'Coinbase Wallet',
      subtitle: 'iOS & Android DApp Browser',
      chains: 'Base, ETH, Polygon, SOL',
      href: `https://go.cb-w.com/dapp?cb_url=${encodedUrl}`,
    },
    {
      id: 'solflare',
      name: 'Solflare',
      subtitle: 'Solana Mobile Wallet Browser',
      chains: 'Solana Mainnet',
      href: `https://solflare.com/ul/v1/browse/${encodedUrl}?ref=${encodedOrigin}`,
    },
  ];
}

export async function connectEvmProvider(
  provider: Eip1193Provider,
  label?: string
): Promise<{ address: string; providerLabel: string }> {
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts authorized in browser wallet.');
  }
  return {
    address: accounts[0],
    providerLabel: label || getEvmProviderName(provider),
  };
}

export async function connectSolanaProvider(
  provider: SolanaInjectedProvider,
  label?: string
): Promise<{ address: string; providerLabel: string }> {
  const resp = await provider.connect();
  const address = resp?.publicKey?.toString() || provider.publicKey?.toString();
  if (!address) {
    throw new Error('Could not read Solana public key.');
  }
  return {
    address,
    providerLabel: label || 'Solana Wallet',
  };
}

export async function connectInjectedEvmWallet(): Promise<{ address: string; providerLabel: string }> {
  const provider = window.ethereum || window.okxwallet;
  if (!provider) {
    throw new Error('No EVM wallet detected in this browser. On mobile, open ChainScope inside MetaMask, Trust, or Coinbase Wallet.');
  }
  return connectEvmProvider(provider);
}

export async function connectInjectedSolanaWallet(): Promise<{ address: string; providerLabel: string }> {
  const provider =
    window.phantom?.solana ||
    window.solflare ||
    window.solana ||
    window.trustwallet?.solana ||
    window.backpack;
  if (!provider) {
    throw new Error('No Solana wallet detected in this browser. On mobile, open ChainScope inside Phantom or Solflare.');
  }
  const { solanaLabel } = detectInjectedProviders();
  return connectSolanaProvider(provider, solanaLabel);
}

export async function signDepositAuthorization(params: {
  chain: string;
  address: string;
  amount: number;
  symbol: string;
}): Promise<string | undefined> {
  if (typeof window === 'undefined') return undefined;
  const msg = `ChainScope Platform Deposit Authorization\nChain: ${params.chain}\nAddress: ${params.address}\nAmount: ${params.amount} ${params.symbol}\nTimestamp: ${Date.now()}`;

  try {
    if (params.chain === 'solana') {
      const sol = window.phantom?.solana || window.solflare || window.solana;
      if (sol?.signMessage && sol.publicKey?.toString() === params.address) {
        const bytes = new TextEncoder().encode(msg);
        const signed = await sol.signMessage(bytes, 'utf8');
        if (signed?.signature) {
          return Array.from(signed.signature.slice(0, 16))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
        }
      }
    } else if (window.ethereum) {
      const accounts = (await window.ethereum.request({ method: 'eth_accounts' })) as string[];
      if (accounts?.some((a) => a.toLowerCase() === params.address.toLowerCase())) {
        const sig = (await window.ethereum.request({
          method: 'personal_sign',
          params: [msg, params.address],
        })) as string;
        return sig;
      }
    }
  } catch (err) {
    // Re-throw only if the user explicitly rejected signature in wallet
    const code = (err as { code?: number })?.code;
    if (code === 4001) {
      throw new Error('Wallet signature was cancelled.');
    }
  }
  return undefined;
}
