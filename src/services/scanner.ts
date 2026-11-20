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

interface WalletStandardAccount {
  address: string;
  publicKey?: Uint8Array;
  chains?: readonly string[];
}

interface WalletStandardWallet {
  name: string;
  icon?: string;
  chains?: readonly string[];
  accounts?: readonly WalletStandardAccount[];
  features?: {
    'standard:connect'?: {
      connect: (input?: { silent?: boolean }) => Promise<{ accounts: readonly WalletStandardAccount[] }>;
    };
    'solana:signMessage'?: {
      signMessage: (
        ...inputs: Array<{ account: WalletStandardAccount; message: Uint8Array }>
      ) => Promise<Array<{ signature: Uint8Array }>>;
    };
  };
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
  interface Navigator {
    wallets?: Array<{
      get?: () => readonly WalletStandardWallet[];
    }>;
  }
}

const eip6963ProvidersMap = new Map<string, DetectedWalletOption>();
const walletStandardSolanaMap = new Map<string, DetectedWalletOption>();

function normalizeWalletName(name: string): string {
  return name.trim().toLowerCase().replace(/\s*\((evm|solana)\)\s*$/i, '');
}

export function formatWalletRpcError(err: unknown, walletName?: string): Error {
  const obj =
    typeof err === 'object' && err !== null
      ? (err as { code?: number; message?: string; data?: { cause?: string } })
      : null;
  const msg = err instanceof Error ? err.message : obj?.message || '';
  const code = obj?.code;

  if (
    code === 4001 ||
    obj?.data?.cause === 'rejectAllApprovals' ||
    /user rejected|rejected the request|cancelled|declined/i.test(msg)
  ) {
    return new Error(
      `Request cancelled in ${walletName || 'your wallet'}. Open ${walletName || 'the wallet'} and approve the connection prompt to continue.`
    );
  }
  if (code === -32002 || /already pending/i.test(msg)) {
    return new Error(
      `A connection prompt is already waiting in ${walletName || 'your wallet'}. Click your browser extension icon to approve it.`
    );
  }
  if (msg) return new Error(msg);
  return new Error(`Failed to connect ${walletName || 'browser wallet'}.`);
}

function wrapWalletStandardSolana(wallet: WalletStandardWallet): SolanaInjectedProvider | null {
  const connectFeat = wallet.features?.['standard:connect'];
  if (!connectFeat?.connect) return null;

  let cachedAccount: WalletStandardAccount | undefined = wallet.accounts?.[0];

  const wrapped: SolanaInjectedProvider = {
    isPhantom: /phantom/i.test(wallet.name),
    isSolflare: /solflare/i.test(wallet.name),
    isBackpack: /backpack/i.test(wallet.name),
    isTrust: /trust/i.test(wallet.name),
    isOkxWallet: /okx/i.test(wallet.name),
    get publicKey() {
      const addr = cachedAccount?.address || wallet.accounts?.[0]?.address;
      return addr ? { toString: () => addr } : null;
    },
    async connect() {
      const res = await connectFeat.connect();
      const acct = res?.accounts?.[0] || wallet.accounts?.[0];
      if (!acct?.address) {
        throw new Error(`No Solana account returned from ${wallet.name}.`);
      }
      cachedAccount = acct;
      return { publicKey: { toString: () => acct.address } };
    },
    async signMessage(message: Uint8Array) {
      const signFeat = wallet.features?.['solana:signMessage'];
      const acct = cachedAccount || wallet.accounts?.[0];
      if (!signFeat?.signMessage || !acct) {
        throw new Error(`${wallet.name} does not support Solana signMessage.`);
      }
      const [out] = await signFeat.signMessage({ account: acct, message });
      return { signature: out.signature };
    },
  };

  return wrapped;
}

function registerWalletStandardItem(w: WalletStandardWallet) {
  const isSolana =
    Boolean(w.features?.['solana:signMessage']) ||
    Boolean(w.chains?.some((c) => c.startsWith('solana:')));
  if (!isSolana) return;
  const wrapped = wrapWalletStandardSolana(w);
  if (!wrapped) return;
  const key = `ws-sol-${w.name.toLowerCase()}`;
  walletStandardSolanaMap.set(key, {
    id: key,
    family: 'solana',
    name: `${w.name} (Solana)`,
    icon: w.icon,
    solanaProvider: wrapped,
  });
}

function collectWalletStandardSync() {
  if (typeof navigator === 'undefined') return;
  try {
    const regs = (navigator as unknown as { wallets?: { get?: () => readonly WalletStandardWallet[] } }).wallets;
    if (regs && typeof regs.get === 'function') {
      for (const w of regs.get()) {
        registerWalletStandardItem(w);
      }
    }
  } catch {
    // ignore non-standard navigator.wallets shapes
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
  if (/Phantom/i.test(ua) || (isMobile && window.phantom?.solana?.isPhantom)) {
    walletBrowserName = 'Phantom';
  } else if (/MetaMaskMobile/i.test(ua) || (isMobile && window.ethereum?.isMetaMask)) {
    walletBrowserName = 'MetaMask';
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
  if (p.isPhantom) return 'Phantom (EVM)';
  if (p.isRabby) return 'Rabby Wallet';
  if (p.isTrust || p.isTrustWallet) return 'Trust Wallet';
  if (p.isCoinbaseWallet) return 'Coinbase Wallet';
  if (p.isRainbow) return 'Rainbow';
  if (p.isOkxWallet) return 'OKX Wallet';
  if (p.isBraveWallet) return 'Brave Wallet';
  if (p.isMetaMask) return 'MetaMask';
  return 'Browser EVM Wallet';
}

export function getPhantomProviders(): {
  solana: SolanaInjectedProvider | undefined;
  evm: Eip1193Provider | undefined;
} {
  if (typeof window === 'undefined') {
    return { solana: undefined, evm: undefined };
  }
  collectWalletStandardSync();

  const wsPhantom = Array.from(walletStandardSolanaMap.values()).find((w) =>
    /phantom/i.test(w.name)
  )?.solanaProvider;

  const solana =
    window.phantom?.solana ||
    (window.solana?.isPhantom ? window.solana : undefined) ||
    wsPhantom;

  const eipPhantom = Array.from(eip6963ProvidersMap.values()).find(
    (w) => w.rdns === 'app.phantom' || /phantom/i.test(w.name)
  )?.evmProvider;

  const subPhantom = Array.isArray(window.ethereum?.providers)
    ? window.ethereum.providers.find((p) => p?.isPhantom)
    : window.ethereum?.isPhantom
    ? window.ethereum
    : undefined;

  const evm = window.phantom?.ethereum || eipPhantom || subPhantom;

  return { solana, evm };
}

export function detectInjectedProviders() {
  const hasEvm = typeof window !== 'undefined' && Boolean(window.ethereum || window.okxwallet || window.phantom?.ethereum);
  const evmLabel = window?.ethereum ? getEvmProviderName(window.ethereum) : 'Browser EVM Wallet';

  const { solana: phantomSol } = getPhantomProviders();
  const solProvider =
    typeof window !== 'undefined'
      ? phantomSol ||
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
  collectWalletStandardSync();

  const list: DetectedWalletOption[] = [];
  const seenKeys = new Set<string>();

  const pushEvm = (id: string, name: string, provider: Eip1193Provider, rdns?: string, icon?: string) => {
    const canonical = `evm:${rdns || normalizeWalletName(name)}`;
    if (seenKeys.has(canonical)) return;
    seenKeys.add(canonical);
    list.push({ id, family: 'evm', name, evmProvider: provider, rdns, icon });
  };

  const pushSol = (id: string, name: string, provider: SolanaInjectedProvider, icon?: string) => {
    const canonical = `sol:${normalizeWalletName(name)}`;
    if (seenKeys.has(canonical)) return;
    seenKeys.add(canonical);
    list.push({ id, family: 'solana', name, solanaProvider: provider, icon });
  };

  // Prefer Solana Phantom first if present
  if (window.phantom?.solana) {
    pushSol('sol-phantom', 'Phantom (Solana)', window.phantom.solana);
  }
  for (const wsOpt of walletStandardSolanaMap.values()) {
    if (wsOpt.solanaProvider) {
      pushSol(wsOpt.id, wsOpt.name, wsOpt.solanaProvider, wsOpt.icon);
    }
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

  // Prefer EIP-6963 providers over legacy window.ethereum
  for (const eipOpt of eip6963ProvidersMap.values()) {
    if (eipOpt.evmProvider) {
      const displayName = /phantom/i.test(eipOpt.name) ? 'Phantom (EVM)' : eipOpt.name;
      pushEvm(eipOpt.id, displayName, eipOpt.evmProvider, eipOpt.rdns, eipOpt.icon);
    }
  }
  if (window.phantom?.ethereum) {
    pushEvm('evm-phantom', 'Phantom (EVM)', window.phantom.ethereum, 'app.phantom');
  }
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
  if (window.trustwallet?.ethereum) {
    pushEvm('evm-trust', 'Trust Wallet', window.trustwallet.ethereum);
  }
  if (window.okxwallet && typeof window.okxwallet.request === 'function') {
    pushEvm('evm-okx', 'OKX Wallet', window.okxwallet);
  }

  return list;
}

export function subscribeEip6963Wallets(
  onDiscover: (wallet: DetectedWalletOption) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const eipHandler = (event: Event) => {
    const custom = event as CustomEvent<{
      info?: { uuid?: string; name?: string; icon?: string; rdns?: string };
      provider?: Eip1193Provider;
    }>;
    const info = custom.detail?.info;
    const provider = custom.detail?.provider;
    if (!info?.name || !provider || typeof provider.request !== 'function') return;
    const displayName = /phantom/i.test(info.name) ? 'Phantom (EVM)' : info.name;
    const opt: DetectedWalletOption = {
      id: `eip6963-${info.rdns || info.uuid || info.name}`,
      family: 'evm',
      name: displayName,
      icon: info.icon,
      rdns: info.rdns,
      evmProvider: provider,
    };
    eip6963ProvidersMap.set(info.rdns || info.name, opt);
    onDiscover(opt);
  };

  const wsHandler = (event: Event) => {
    const custom = event as CustomEvent<(register: (w: WalletStandardWallet) => void) => void>;
    if (typeof custom.detail === 'function') {
      try {
        custom.detail((wallet) => {
          registerWalletStandardItem(wallet);
          const wsOpt = walletStandardSolanaMap.get(`ws-sol-${wallet.name.toLowerCase()}`);
          if (wsOpt) onDiscover(wsOpt);
        });
      } catch {
        // ignore invalid wallet-standard payloads
      }
    }
  };

  window.addEventListener('eip6963:announceProvider', eipHandler);
  window.addEventListener('wallet-standard:register-wallet', wsHandler);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  window.dispatchEvent(
    new CustomEvent('wallet-standard:app-ready', {
      detail: {
        register(wallet: WalletStandardWallet) {
          registerWalletStandardItem(wallet);
          const wsOpt = walletStandardSolanaMap.get(`ws-sol-${wallet.name.toLowerCase()}`);
          if (wsOpt) onDiscover(wsOpt);
        },
      },
    })
  );

  return () => {
    window.removeEventListener('eip6963:announceProvider', eipHandler);
    window.removeEventListener('wallet-standard:register-wallet', wsHandler);
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
  const walletName = label || getEvmProviderName(provider);
  try {
    const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
    if (!accounts || accounts.length === 0) {
      throw new Error(`No accounts authorized in ${walletName}.`);
    }
    return {
      address: accounts[0],
      providerLabel: walletName,
    };
  } catch (err) {
    throw formatWalletRpcError(err, walletName);
  }
}

export async function connectSolanaProvider(
  provider: SolanaInjectedProvider,
  label?: string
): Promise<{ address: string; providerLabel: string }> {
  const walletName = label || (provider.isPhantom ? 'Phantom (Solana)' : 'Solana Wallet');
  try {
    const resp = await provider.connect();
    const address = resp?.publicKey?.toString() || provider.publicKey?.toString();
    if (!address) {
      throw new Error(`Could not read Solana public key from ${walletName}.`);
    }
    return {
      address,
      providerLabel: walletName,
    };
  } catch (err) {
    throw formatWalletRpcError(err, walletName);
  }
}

export async function connectPhantomWallet(): Promise<{
  solanaAddress?: string;
  evmAddress?: string;
  providerLabel: string;
}> {
  const { solana, evm } = getPhantomProviders();
  if (!solana && !evm) {
    throw new Error(
      'Phantom Wallet was not detected in this browser window. Enable the Phantom extension or open ChainScope inside the Phantom mobile browser.'
    );
  }

  let solanaAddress: string | undefined;
  let evmAddress: string | undefined;

  if (solana) {
    const solRes = await connectSolanaProvider(solana, 'Phantom');
    solanaAddress = solRes.address;
  }

  if (evm) {
    try {
      const evmRes = await connectEvmProvider(evm, 'Phantom');
      evmAddress = evmRes.address;
    } catch (err) {
      // If Solana succeeded and user skipped EVM account prompt inside Phantom, still keep Solana connected
      if (!solanaAddress) {
        throw err;
      }
    }
  }

  return {
    solanaAddress,
    evmAddress,
    providerLabel: solanaAddress && evmAddress ? 'Phantom (Solana + EVM)' : 'Phantom',
  };
}

export async function connectInjectedEvmWallet(): Promise<{ address: string; providerLabel: string }> {
  const provider = window.ethereum || window.okxwallet || window.phantom?.ethereum;
  if (!provider) {
    throw new Error('No EVM wallet detected in this browser. On mobile, open ChainScope inside MetaMask, Trust, or Coinbase Wallet.');
  }
  return connectEvmProvider(provider);
}

export async function connectInjectedSolanaWallet(): Promise<{ address: string; providerLabel: string }> {
  const { solana: phantomSol } = getPhantomProviders();
  const provider =
    phantomSol ||
    window.solflare ||
    window.solana ||
    window.trustwallet?.solana ||
    window.backpack ||
    window.okxwallet?.solana;
  if (!provider) {
    throw new Error('No Solana wallet detected in this browser. On mobile, open ChainScope inside Phantom or Solflare.');
  }
  const { solanaLabel } = detectInjectedProviders();
  return connectSolanaProvider(provider, solanaLabel);
}

function findEvmProviderForWallet(label?: string): Eip1193Provider | undefined {
  if (typeof window === 'undefined') return undefined;
  const clean = (label || '').toLowerCase();
  if (clean.includes('phantom')) {
    return getPhantomProviders().evm;
  }
  if (clean.includes('rabby')) {
    return (
      Array.from(eip6963ProvidersMap.values()).find((w) => /rabby/i.test(w.name))?.evmProvider ||
      (window.ethereum?.isRabby ? window.ethereum : undefined)
    );
  }
  if (clean.includes('coinbase')) {
    return (
      Array.from(eip6963ProvidersMap.values()).find((w) => /coinbase/i.test(w.name))?.evmProvider ||
      (window.ethereum?.isCoinbaseWallet ? window.ethereum : undefined)
    );
  }
  if (clean.includes('trust')) {
    return (
      window.trustwallet?.ethereum ||
      Array.from(eip6963ProvidersMap.values()).find((w) => /trust/i.test(w.name))?.evmProvider ||
      (window.ethereum?.isTrust || window.ethereum?.isTrustWallet ? window.ethereum : undefined)
    );
  }
  if (clean.includes('okx')) {
    return window.okxwallet;
  }
  if (clean.includes('metamask')) {
    return (
      Array.from(eip6963ProvidersMap.values()).find((w) => /metamask/i.test(w.name))?.evmProvider ||
      (window.ethereum?.isMetaMask && !window.ethereum?.isPhantom ? window.ethereum : undefined)
    );
  }
  return window.ethereum;
}

function findSolanaProviderForWallet(label?: string): SolanaInjectedProvider | undefined {
  if (typeof window === 'undefined') return undefined;
  const clean = (label || '').toLowerCase();
  if (clean.includes('phantom')) {
    return getPhantomProviders().solana;
  }
  if (clean.includes('solflare')) {
    return window.solflare;
  }
  if (clean.includes('backpack')) {
    return window.backpack;
  }
  if (clean.includes('trust')) {
    return window.trustwallet?.solana;
  }
  if (clean.includes('okx')) {
    return window.okxwallet?.solana;
  }
  return getPhantomProviders().solana || window.solflare || window.solana;
}

export async function signCustomMessageWithWallet(
  wallet: WalletEntry,
  message: string
): Promise<string> {
  if (wallet.origin === 'browser-solana' || (wallet.solanaAddress && !wallet.evmAddress)) {
    const sol = findSolanaProviderForWallet(wallet.label);
    if (!sol?.signMessage) {
      throw new Error(`${wallet.label} does not expose Solana message signing in this browser.`);
    }
    try {
      if (!sol.publicKey) {
        await sol.connect();
      }
      const bytes = new TextEncoder().encode(message);
      const signed = await sol.signMessage(bytes, 'utf8');
      if (!signed?.signature) {
        throw new Error('Wallet did not return a Solana signature.');
      }
      return Array.from(signed.signature)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch (err) {
      throw formatWalletRpcError(err, wallet.label);
    }
  }

  const evm = findEvmProviderForWallet(wallet.label);
  if (!evm || !wallet.evmAddress) {
    throw new Error(`${wallet.label} EVM provider is not active in this browser.`);
  }
  try {
    const hexMsg =
      '0x' +
      Array.from(new TextEncoder().encode(message))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    const sig = (await evm.request({
      method: 'personal_sign',
      params: [hexMsg, wallet.evmAddress],
    })) as string;
    return sig;
  } catch (err) {
    throw formatWalletRpcError(err, wallet.label);
  }
}

export async function signDepositAuthorization(params: {
  chain: string;
  address: string;
  amount: number;
  symbol: string;
  walletLabel?: string;
}): Promise<string | undefined> {
  if (typeof window === 'undefined') return undefined;
  const msg = `ChainScope Platform Deposit Authorization\nChain: ${params.chain}\nAddress: ${params.address}\nAmount: ${params.amount} ${params.symbol}\nTimestamp: ${Date.now()}`;

  try {
    if (params.chain === 'solana') {
      const sol = findSolanaProviderForWallet(params.walletLabel);
      if (sol?.signMessage) {
        if (!sol.publicKey) {
          await sol.connect();
        }
        if (sol.publicKey?.toString() === params.address) {
          const bytes = new TextEncoder().encode(msg);
          const signed = await sol.signMessage(bytes, 'utf8');
          if (signed?.signature) {
            return Array.from(signed.signature.slice(0, 16))
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('');
          }
        }
      }
    } else {
      const evm = findEvmProviderForWallet(params.walletLabel);
      if (evm) {
        const accounts = (await evm.request({ method: 'eth_accounts' })) as string[];
        if (accounts?.some((a) => a.toLowerCase() === params.address.toLowerCase())) {
          const sig = (await evm.request({
            method: 'personal_sign',
            params: [msg, params.address],
          })) as string;
          return sig;
        }
      }
    }
  } catch (err) {
    const formatted = formatWalletRpcError(err, params.walletLabel);
    if (/cancelled|rejected/i.test(formatted.message)) {
      throw formatted;
    }
  }
  return undefined;
}
