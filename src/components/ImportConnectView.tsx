import { useEffect, useMemo, useRef, useState } from 'react';
import { ethers } from 'ethers';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileJson,
  Globe,
  KeyRound,
  Layers,
  Loader2,
  LogIn,
  PlugZap,
  Radar,
  RefreshCw,
  Smartphone,
  Upload,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { WalletEntry } from '../types/wallet';
import { formatTokenBalance, formatUsd, truncateAddress } from '../utils/chains';
import {
  decryptKeystoreJson,
  deriveMultiChainFromMnemonic,
  isValidBip39Word,
  parsePrivateKeyUniversal,
  searchBip39Words,
  validateMnemonicPhrase,
} from '../utils/crypto';
import {
  collectDetectedWalletsSync,
  connectEvmProvider,
  connectInjectedEvmWallet,
  connectInjectedSolanaWallet,
  connectPhantomWallet,
  connectSolanaProvider,
  detectDeviceEnvironment,
  detectInjectedProviders,
  getMobileWalletDeepLinks,
  getPhantomProviders,
  resolveEnsName,
  scanEvmAddress,
  scanSolanaAddress,
  subscribeEip6963Wallets,
  type DetectedWalletOption,
} from '../services/scanner';

interface ImportConnectViewProps {
  onImportWallet: (wallet: WalletEntry) => void;
}

type ImportMode = 'seed' | 'private-key' | 'browser' | 'watch-keystore';

interface SweepRow {
  index: number;
  evmAddress: string;
  solanaAddress: string;
  ethBalance: number;
  polBalance: number;
  solBalance: number;
  totalUsd: number;
  scanning: boolean;
}

export function ImportConnectView({ onImportWallet }: ImportConnectViewProps) {
  const [mode, setMode] = useState<ImportMode>('seed');

  // --- Mode 1: Seed Phrase Grid ---
  const [seedCount, setSeedCount] = useState<12 | 24>(12);
  const [words, setWords] = useState<string[]>(() => Array(12).fill(''));
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [accountIndex, setAccountIndex] = useState(0);
  const [seedLabel, setSeedLabel] = useState('');
  const [seedError, setSeedError] = useState<string | null>(null);
  const [importingSeed, setImportingSeed] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [sweepRows, setSweepRows] = useState<SweepRow[]>([]);

  // --- Mode 2: Private Key ---
  const [pkInput, setPkInput] = useState('');
  const [showPk, setShowPk] = useState(false);
  const [pkLabel, setPkLabel] = useState('');
  const [pkError, setPkError] = useState<string | null>(null);

  // --- Mode 3: Browser & Mobile Wallets ---
  const { user, signInWithGoogle, signInWithBrowserRedirect } = useAuth();
  const [browserBusy, setBrowserBusy] = useState<string | null>(null);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [detectedWallets, setDetectedWallets] = useState<DetectedWalletOption[]>(() =>
    collectDetectedWalletsSync()
  );
  const [copiedAppLink, setCopiedAppLink] = useState(false);
  const providers = useMemo(() => detectInjectedProviders(), []);
  const deviceEnv = useMemo(() => detectDeviceEnvironment(), []);
  const mobileDeepLinks = useMemo(() => getMobileWalletDeepLinks(), []);

  useEffect(() => {
    setDetectedWallets(collectDetectedWalletsSync());
    const unsub = subscribeEip6963Wallets((discovered) => {
      setDetectedWallets((prev) => {
        const norm = (s: string) => s.trim().toLowerCase().replace(/\s*\((evm|solana)\)\s*$/i, '');
        if (
          prev.some(
            (w) =>
              w.id === discovered.id ||
              (w.family === discovered.family && norm(w.name) === norm(discovered.name))
          )
        ) {
          return prev;
        }
        return [discovered, ...prev];
      });
    });
    return unsub;
  }, []);

  // --- Mode 4: Watch / ENS / Keystore ---
  const [watchInput, setWatchInput] = useState('');
  const [watchSolInput, setWatchSolInput] = useState('');
  const [watchLabel, setWatchLabel] = useState('');
  const [watchBusy, setWatchBusy] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);

  const [keystoreJson, setKeystoreJson] = useState('');
  const [keystoreFileName, setKeystoreFileName] = useState('');
  const [keystorePassword, setKeystorePassword] = useState('');
  const [keystoreLabel, setKeystoreLabel] = useState('');
  const [keystoreBusy, setKeystoreBusy] = useState(false);
  const [keystoreError, setKeystoreError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setWords((prev) => {
      if (prev.length === seedCount) return prev;
      if (seedCount === 12) return prev.slice(0, 12);
      return [...prev, ...Array(12).fill('')];
    });
    setSweepRows([]);
  }, [seedCount]);

  const joinedPhrase = useMemo(() => words.map((w) => w.trim().toLowerCase()).join(' '), [words]);
  const mnemonicStatus = useMemo(() => {
    const filledCount = words.filter((w) => w.trim().length > 0).length;
    if (filledCount === 0) return { valid: false, filledCount, error: undefined };
    const v = validateMnemonicPhrase(joinedPhrase);
    return { valid: v.valid, filledCount, error: v.error };
  }, [words, joinedPhrase]);

  const activeSuggestions = useMemo(() => {
    if (activeSlot === null) return [];
    const current = words[activeSlot] || '';
    if (!current.trim() || isValidBip39Word(current)) return [];
    return searchBip39Words(current, 6);
  }, [activeSlot, words]);

  const handleWordChange = (index: number, value: string) => {
    const tokens = value.trim().split(/\s+/).filter(Boolean);
    if (tokens.length >= 12) {
      const targetLen = tokens.length >= 24 ? 24 : 12;
      setSeedCount(targetLen);
      setWords(Array.from({ length: targetLen }, (_, i) => (tokens[i] || '').toLowerCase()));
      setActiveSlot(null);
      setSeedError(null);
      return;
    }
    setWords((prev) => {
      const next = [...prev];
      next[index] = value.replace(/\s+/g, '').toLowerCase();
      return next;
    });
    setSeedError(null);
  };

  const handleSeedImport = async (chosenIndex = accountIndex) => {
    const validation = validateMnemonicPhrase(joinedPhrase);
    if (!validation.valid) {
      setSeedError(validation.error || 'Invalid mnemonic phrase');
      return;
    }
    setImportingSeed(true);
    setSeedError(null);
    try {
      const derived = await deriveMultiChainFromMnemonic(joinedPhrase, chosenIndex, passphrase);
      onImportWallet({
        id: `seed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: seedLabel.trim() || `Seed Wallet #${chosenIndex}`,
        origin: 'seed',
        evmAddress: derived.evmAddress,
        solanaAddress: derived.solanaAddress,
        accountIndex: chosenIndex,
        wordCount: seedCount,
        createdAt: Date.now(),
      });
    } catch (err) {
      setSeedError(err instanceof Error ? err.message : 'Failed to derive wallet');
    } finally {
      setImportingSeed(false);
    }
  };

  const handleSweepAccounts = async () => {
    const validation = validateMnemonicPhrase(joinedPhrase);
    if (!validation.valid) {
      setSeedError(validation.error || 'Complete a valid 12 or 24-word seed phrase first');
      return;
    }
    setSweeping(true);
    setSeedError(null);
    try {
      const indices = [0, 1, 2, 3, 4];
      const bundles = await Promise.all(
        indices.map((idx) => deriveMultiChainFromMnemonic(joinedPhrase, idx, passphrase))
      );
      const initialRows: SweepRow[] = bundles.map((b) => ({
        index: b.accountIndex,
        evmAddress: b.evmAddress,
        solanaAddress: b.solanaAddress,
        ethBalance: 0,
        polBalance: 0,
        solBalance: 0,
        totalUsd: 0,
        scanning: true,
      }));
      setSweepRows(initialRows);

      await Promise.all(
        bundles.map(async (b) => {
          try {
            const [evmRes, solRes] = await Promise.all([
              scanEvmAddress(b.evmAddress, ['ethereum', 'polygon']),
              scanSolanaAddress(b.solanaAddress),
            ]);
            const eth = evmRes.chains.find((c) => c.chainId === 'ethereum');
            const pol = evmRes.chains.find((c) => c.chainId === 'polygon');
            const sol = solRes.chain;
            const totalUsd = (eth?.totalUsd || 0) + (pol?.totalUsd || 0) + (sol?.totalUsd || 0);
            setSweepRows((prev) =>
              prev.map((r) =>
                r.index === b.accountIndex
                  ? {
                      ...r,
                      ethBalance: eth?.nativeBalance || 0,
                      polBalance: pol?.nativeBalance || 0,
                      solBalance: sol?.nativeBalance || 0,
                      totalUsd,
                      scanning: false,
                    }
                  : r
              )
            );
          } catch {
            setSweepRows((prev) =>
              prev.map((r) => (r.index === b.accountIndex ? { ...r, scanning: false } : r))
            );
          }
        })
      );
    } catch (err) {
      setSeedError(err instanceof Error ? err.message : 'Account sweep failed');
    } finally {
      setSweeping(false);
    }
  };

  // --- Mode 2: Live Private Key Detection ---
  const pkPreview = useMemo(() => {
    if (!pkInput.trim()) return null;
    try {
      return { ok: true as const, parsed: parsePrivateKeyUniversal(pkInput) };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : 'Invalid key' };
    }
  }, [pkInput]);

  const handleImportPrivateKey = () => {
    if (!pkPreview || !pkPreview.ok) {
      setPkError(pkPreview?.error || 'Paste a valid EVM or Solana private key');
      return;
    }
    const { parsed } = pkPreview;
    onImportWallet({
      id: `pk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label:
        pkLabel.trim() ||
        (parsed.kind === 'evm' ? 'Imported EVM Key' : 'Imported Solana Key'),
      origin: 'private-key',
      evmAddress: parsed.kind === 'evm' ? parsed.address : undefined,
      solanaAddress: parsed.kind === 'solana' ? parsed.address : undefined,
      createdAt: Date.now(),
    });
  };

  // --- Mode 3: Browser & Mobile Wallets ---
  const phantomDetected = useMemo(() => {
    const p = getPhantomProviders();
    return Boolean(p.solana || p.evm);
  }, [detectedWallets]);

  const handleRescanBrowserWallets = () => {
    setDetectedWallets(collectDetectedWalletsSync());
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('eip6963:requestProvider'));
      window.dispatchEvent(new CustomEvent('wallet-standard:app-ready'));
      window.setTimeout(() => {
        setDetectedWallets(collectDetectedWalletsSync());
      }, 250);
    }
  };

  const handleConnectPhantom = async () => {
    setBrowserBusy('phantom');
    setBrowserError(null);
    try {
      const res = await connectPhantomWallet();
      onImportWallet({
        id: `phantom-${Date.now()}`,
        label: res.providerLabel,
        origin: res.solanaAddress ? 'browser-solana' : 'browser-evm',
        solanaAddress: res.solanaAddress,
        evmAddress: res.evmAddress ? ethers.getAddress(res.evmAddress) : undefined,
        createdAt: Date.now(),
      });
    } catch (err) {
      setBrowserError(err instanceof Error ? err.message : 'Failed to connect Phantom Wallet');
    } finally {
      setBrowserBusy(null);
    }
  };

  const handleConnectDetectedOption = async (opt: DetectedWalletOption) => {
    setBrowserBusy(opt.id);
    setBrowserError(null);
    try {
      if (opt.family === 'evm' && opt.evmProvider) {
        const { address, providerLabel } = await connectEvmProvider(opt.evmProvider, opt.name);
        onImportWallet({
          id: `browser-evm-${Date.now()}`,
          label: providerLabel,
          origin: 'browser-evm',
          evmAddress: ethers.getAddress(address),
          createdAt: Date.now(),
        });
      } else if (opt.family === 'solana' && opt.solanaProvider) {
        const { address, providerLabel } = await connectSolanaProvider(opt.solanaProvider, opt.name);
        onImportWallet({
          id: `browser-sol-${Date.now()}`,
          label: providerLabel,
          origin: 'browser-solana',
          solanaAddress: address,
          createdAt: Date.now(),
        });
      }
    } catch (err) {
      setBrowserError(err instanceof Error ? err.message : `Failed to connect ${opt.name}`);
    } finally {
      setBrowserBusy(null);
    }
  };

  const handleConnectEvm = async () => {
    setBrowserBusy('evm');
    setBrowserError(null);
    try {
      const { address, providerLabel } = await connectInjectedEvmWallet();
      onImportWallet({
        id: `browser-evm-${Date.now()}`,
        label: providerLabel,
        origin: 'browser-evm',
        evmAddress: ethers.getAddress(address),
        createdAt: Date.now(),
      });
    } catch (err) {
      setBrowserError(err instanceof Error ? err.message : 'Failed to connect EVM wallet');
    } finally {
      setBrowserBusy(null);
    }
  };

  const handleConnectSolana = async () => {
    setBrowserBusy('sol');
    setBrowserError(null);
    try {
      const { address, providerLabel } = await connectInjectedSolanaWallet();
      onImportWallet({
        id: `browser-sol-${Date.now()}`,
        label: providerLabel,
        origin: 'browser-solana',
        solanaAddress: address,
        createdAt: Date.now(),
      });
    } catch (err) {
      setBrowserError(err instanceof Error ? err.message : 'Failed to connect Solana wallet');
    } finally {
      setBrowserBusy(null);
    }
  };

  const handleCopySiteUrl = async () => {
    if (typeof window === 'undefined') return;
    await navigator.clipboard.writeText(window.location.href);
    setCopiedAppLink(true);
    setTimeout(() => setCopiedAppLink(false), 1800);
  };

  // --- Mode 4: Watch / ENS & Keystore ---
  const handleWatchImport = async () => {
    const primary = watchInput.trim();
    const sol = watchSolInput.trim();
    if (!primary && !sol) {
      setWatchError('Enter an EVM address / .eth ENS name or a Solana address');
      return;
    }

    setWatchBusy(true);
    setWatchError(null);
    try {
      let resolvedEvm: string | undefined;
      let resolvedLabel = watchLabel.trim();

      if (primary) {
        if (primary.toLowerCase().endsWith('.eth')) {
          const ens = await resolveEnsName(primary);
          resolvedEvm = ethers.getAddress(ens.address);
          if (!resolvedLabel) resolvedLabel = ens.name;
        } else if (ethers.isAddress(primary)) {
          resolvedEvm = ethers.getAddress(primary);
        } else if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(primary) && !sol) {
          // User pasted a Solana address into the primary field
          onImportWallet({
            id: `watch-${Date.now()}`,
            label: resolvedLabel || `Watch ${truncateAddress(primary, 5, 4)}`,
            origin: 'watch',
            solanaAddress: primary,
            createdAt: Date.now(),
          });
          setWatchBusy(false);
          return;
        } else {
          throw new Error('Primary field must be a valid 0x EVM address, .eth ENS name, or Solana address');
        }
      }

      let validSol: string | undefined;
      if (sol) {
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(sol)) {
          throw new Error('Invalid Solana base58 address');
        }
        validSol = sol;
      }

      onImportWallet({
        id: `watch-${Date.now()}`,
        label:
          resolvedLabel ||
          `Watch ${truncateAddress(resolvedEvm || validSol || '', 5, 4)}`,
        origin: 'watch',
        evmAddress: resolvedEvm,
        solanaAddress: validSol,
        createdAt: Date.now(),
      });
    } catch (err) {
      setWatchError(err instanceof Error ? err.message : 'Could not add watch address');
    } finally {
      setWatchBusy(false);
    }
  };

  const handleKeystoreFile = async (file: File) => {
    const text = await file.text();
    setKeystoreJson(text);
    setKeystoreFileName(file.name);
    setKeystoreError(null);
  };

  const handleDecryptKeystore = async () => {
    if (!keystoreJson.trim()) {
      setKeystoreError('Upload or paste a Web3 Keystore JSON file first');
      return;
    }
    setKeystoreBusy(true);
    setKeystoreError(null);
    try {
      const parsed = await decryptKeystoreJson(keystoreJson, keystorePassword);
      onImportWallet({
        id: `keystore-${Date.now()}`,
        label: keystoreLabel.trim() || `Keystore ${truncateAddress(parsed.address, 5, 4)}`,
        origin: 'keystore',
        evmAddress: parsed.address,
        createdAt: Date.now(),
      });
    } catch (err) {
      setKeystoreError(err instanceof Error ? err.message : 'Incorrect password or invalid Keystore JSON');
    } finally {
      setKeystoreBusy(false);
    }
  };

  const tabs: Array<{ id: ImportMode; label: string; icon: typeof KeyRound }> = [
    { id: 'seed', label: 'Seed Phrase (12 / 24)', icon: Layers },
    { id: 'private-key', label: 'Private Key Instant Scan', icon: KeyRound },
    { id: 'browser', label: 'Wallet Connect (Mobile & Browser)', icon: PlugZap },
    { id: 'watch-keystore', label: 'ENS, Watch & Keystore', icon: Globe },
  ];

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Import & Connect Wallets
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Add multiple wallets via BIP-39 seed phrase, raw EVM/Solana private key, browser extension,
          Web3 JSON keystore, or ENS watch address. Keys are derived strictly inside your browser.
        </p>
      </div>

      {/* Mode Switcher */}
      <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#111827] border border-slate-200 dark:border-slate-800 w-fit">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = mode === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setMode(t.id)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                active
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* MODE 1: SEED PHRASE GRID */}
      {mode === 'seed' && (
        <div className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                BIP-39 Recovery Phrase Importer
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Paste your entire 12 or 24-word phrase into slot #1 to auto-fill all words, or type
                with BIP-39 autocomplete. Derives both EVM and Solana addresses simultaneously.
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17]">
              {([12, 24] as const).map((cnt) => (
                <button
                  key={cnt}
                  type="button"
                  onClick={() => setSeedCount(cnt)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                    seedCount === cnt
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {cnt} Words
                </button>
              ))}
            </div>
          </div>

          {/* Numbered Word Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
            {words.map((word, idx) => {
              const trimmed = word.trim();
              const valid = trimmed.length > 0 && isValidBip39Word(trimmed);
              const invalid = trimmed.length > 0 && !valid && activeSlot !== idx;
              return (
                <div key={idx} className="relative">
                  <div
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-xs transition-colors ${
                      invalid
                        ? 'border-red-500/70 bg-red-50/40 dark:bg-red-950/20'
                        : valid
                        ? 'border-emerald-500/40 bg-emerald-50/30 dark:bg-emerald-950/10'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]'
                    }`}
                  >
                    <span className="font-mono text-[11px] text-slate-400 w-5 shrink-0 tabular-nums">
                      {idx + 1}.
                    </span>
                    <input
                      type="text"
                      value={word}
                      onFocus={() => setActiveSlot(idx)}
                      onBlur={() => setTimeout(() => setActiveSlot((cur) => (cur === idx ? null : cur)), 150)}
                      onChange={(e) => handleWordChange(idx, e.target.value)}
                      placeholder="word"
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full min-w-0 bg-transparent font-mono text-xs text-slate-900 dark:text-slate-100 focus:outline-none"
                    />
                  </div>
                  {activeSlot === idx && activeSuggestions.length > 0 && (
                    <div className="absolute z-20 left-0 right-0 mt-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg py-1">
                      {activeSuggestions.map((sug) => (
                        <button
                          key={sug}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handleWordChange(idx, sug);
                            setActiveSlot(idx + 1 < seedCount ? idx + 1 : null);
                          }}
                          className="w-full text-left px-3 py-1.5 text-xs font-mono text-slate-800 dark:text-slate-200 hover:bg-blue-600 hover:text-white transition-colors"
                        >
                          {sug}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Mnemonic Checksum Status */}
          {mnemonicStatus.filledCount > 0 && (
            <div className="flex items-center gap-2 text-xs">
              {mnemonicStatus.valid ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                  <CheckCircle2 className="w-4 h-4" />
                  Valid {seedCount}-word BIP-39 mnemonic checksum verified
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <AlertCircle className="w-4 h-4" />
                  {mnemonicStatus.error || `${mnemonicStatus.filledCount}/${seedCount} words entered`}
                </span>
              )}
            </div>
          )}

          {/* Optional Metadata & Derivation Index */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Wallet Label
              </label>
              <input
                type="text"
                value={seedLabel}
                onChange={(e) => setSeedLabel(e.target.value)}
                placeholder="e.g., Hardware Backup"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Account Index (BIP-44)
              </label>
              <select
                value={accountIndex}
                onChange={(e) => setAccountIndex(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100"
              >
                {[0, 1, 2, 3, 4].map((idx) => (
                  <option key={idx} value={idx}>
                    Account #{idx} (m/44&apos;/60&apos;/0&apos;/0/{idx})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Optional BIP-39 Passphrase
              </label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Leave blank if none"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          {seedError && (
            <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {seedError}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => handleSeedImport(accountIndex)}
                disabled={importingSeed || !mnemonicStatus.valid}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium transition-colors"
              >
                {importingSeed && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Import & Scan Balances
              </button>

              <button
                type="button"
                onClick={handleSweepAccounts}
                disabled={sweeping || !mnemonicStatus.valid}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 text-slate-800 dark:text-slate-200 text-xs font-medium transition-colors"
              >
                <Radar className={`w-3.5 h-3.5 ${sweeping ? 'animate-spin text-blue-500' : ''}`} />
                Sweep Accounts #0–#4
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setWords(Array(seedCount).fill(''));
                setSweepRows([]);
                setSeedError(null);
              }}
              className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
            >
              Clear Grid
            </button>
          </div>

          {/* Multi-Account Sweep Results */}
          {sweepRows.length > 0 && (
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2.5">
                Multi-Account Sweep Results (Live Mainnet Scan)
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-[11px] text-slate-500 dark:text-slate-400">
                      <th className="py-2.5 px-3">Index</th>
                      <th className="py-2.5 px-3">EVM Address</th>
                      <th className="py-2.5 px-3">Solana Address</th>
                      <th className="py-2.5 px-3 text-right">ETH / POL / SOL</th>
                      <th className="py-2.5 px-3 text-right">Est. USD</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {sweepRows.map((row) => (
                      <tr key={row.index} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-3 font-mono font-semibold">#{row.index}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-700 dark:text-slate-300">
                          {truncateAddress(row.evmAddress, 6, 4)}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-700 dark:text-slate-300">
                          {truncateAddress(row.solanaAddress, 6, 4)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                          {row.scanning
                            ? 'Scanning…'
                            : `${formatTokenBalance(row.ethBalance)} / ${formatTokenBalance(
                                row.polBalance
                              )} / ${formatTokenBalance(row.solBalance)}`}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums">
                          {row.scanning ? '—' : formatUsd(row.totalUsd)}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleSeedImport(row.index)}
                            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            Import #{row.index}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODE 2: PRIVATE KEY INSTANT SCAN */}
      {mode === 'private-key' && (
        <div className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Universal Private Key Importer & Instant Scanner
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Auto-detects EVM hex private keys (Ethereum, Polygon, Arbitrum, Base, Optimism, BSC),
              Solana Base58 secret keys, and Solana CLI JSON byte arrays.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                Private Key (EVM 0x Hex / Solana Base58 / Solana JSON Byte Array)
              </label>
              <div className="relative">
                <input
                  type={showPk ? 'text' : 'password'}
                  value={pkInput}
                  onChange={(e) => {
                    setPkInput(e.target.value);
                    setPkError(null);
                  }}
                  placeholder="0x... or Base58 secret key or [12, 34, ...]"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full pl-3.5 pr-10 py-2.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPk((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  aria-label={showPk ? 'Hide private key' : 'Show private key'}
                >
                  {showPk ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {pkPreview && (
              <div
                className={`p-3.5 rounded-lg border text-xs ${
                  pkPreview.ok
                    ? 'border-emerald-500/30 bg-emerald-500/5 text-slate-800 dark:text-slate-200'
                    : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300'
                }`}
              >
                {pkPreview.ok ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      <span className="font-medium">
                        {pkPreview.parsed.kind === 'evm'
                          ? 'Detected EVM Keypair (Ethereum + Polygon + L2s)'
                          : 'Detected Solana Ed25519 Keypair'}
                      </span>
                    </div>
                    <span className="font-mono text-slate-600 dark:text-slate-300">
                      Address: {pkPreview.parsed.address}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{pkPreview.error}</span>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                Wallet Label (Optional)
              </label>
              <input
                type="text"
                value={pkLabel}
                onChange={(e) => setPkLabel(e.target.value)}
                placeholder="e.g., Trading Hot Wallet"
                className="w-full max-w-sm px-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          {pkError && (
            <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-600 dark:text-red-400">
              {pkError}
            </div>
          )}

          <button
            type="button"
            onClick={handleImportPrivateKey}
            disabled={!pkPreview?.ok}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium transition-colors"
          >
            <Radar className="w-3.5 h-3.5" />
            Import Key & Scan Instantly
          </button>
        </div>
      )}

      {/* MODE 3: BROWSER & MOBILE WALLET CONNECT */}
      {mode === 'browser' && (
        <div className="space-y-5">
          {/* Detected Browser / In-App Wallets */}
          <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <PlugZap className="w-4 h-4 text-blue-500" />
                  Detected Wallets ({detectedWallets.length})
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {deviceEnv.isInWalletBrowser
                    ? `Running inside ${deviceEnv.walletBrowserName} mobile browser — tap Connect below.`
                    : deviceEnv.isMobile
                    ? `Detected ${deviceEnv.os === 'ios' ? 'iPhone / iPad' : 'Android'} browser. Tap a detected wallet or open inside your wallet app below.`
                    : 'Auto-discovers MetaMask, Phantom, Trust Wallet, Coinbase Wallet, Solflare, Rainbow, Rabby, and OKX.'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleRescanBrowserWallets}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Detect Wallets
              </button>
            </div>

            {/* Featured Phantom Multi-Chain Connector (Solana + EVM without MetaMask interference) */}
            <div className="p-4 rounded-xl border border-violet-500/30 bg-violet-500/5 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Phantom Wallet (Solana + EVM)
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {phantomDetected
                    ? 'Phantom provider detected — connects Solana and EVM directly without triggering MetaMask.'
                    : 'Using Phantom mobile or don’t see the extension? Connect if installed or open directly in Phantom App.'}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={browserBusy !== null}
                  onClick={() => void handleConnectPhantom()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-medium whitespace-nowrap transition-colors"
                >
                  {browserBusy === 'phantom' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <PlugZap className="w-3.5 h-3.5" />
                  )}
                  Connect Phantom
                </button>
                {!phantomDetected && mobileDeepLinks[0] && (
                  <a
                    href={mobileDeepLinks[0].href}
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap"
                  >
                    Open Phantom App
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>

            {detectedWallets.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {detectedWallets.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={browserBusy !== null}
                    onClick={() => void handleConnectDetectedOption(opt)}
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-500 bg-slate-50 dark:bg-[#0B0F17] flex items-center justify-between gap-3 text-left transition-colors disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {opt.icon ? (
                        <img src={opt.icon} alt={opt.name} className="w-7 h-7 rounded-lg shrink-0" />
                      ) : (
                        <div className="w-7 h-7 rounded-lg bg-blue-600/15 text-blue-500 flex items-center justify-center shrink-0 text-xs font-bold">
                          {opt.name.slice(0, 1)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {opt.name}
                        </div>
                        <div className="text-[11px] text-emerald-600 dark:text-emerald-400">
                          {opt.family === 'evm' ? 'EVM Networks' : 'Solana Mainnet'} · Ready
                        </div>
                      </div>
                    </div>
                    {browserBusy === opt.id ? (
                      <Loader2 className="w-4 h-4 animate-spin text-blue-500 shrink-0" />
                    ) : (
                      <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 shrink-0">
                        Connect
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] flex flex-col justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {providers.evmLabel}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {providers.hasEvm
                        ? 'EVM provider detected in browser window.'
                        : 'No EVM wallet extension detected in this browser window.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleConnectEvm}
                    disabled={browserBusy !== null}
                    className="w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium flex items-center justify-center gap-2"
                  >
                    {browserBusy === 'evm' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <PlugZap className="w-3.5 h-3.5" />
                    )}
                    Try EVM Connect
                  </button>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] flex flex-col justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {providers.solanaLabel}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {providers.hasSolana
                        ? 'Solana provider detected in browser window.'
                        : 'No Solana wallet extension detected in this browser window.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleConnectSolana}
                    disabled={browserBusy !== null}
                    className="w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium flex items-center justify-center gap-2"
                  >
                    {browserBusy === 'sol' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <PlugZap className="w-3.5 h-3.5" />
                    )}
                    Try Solana Connect
                  </button>
                </div>
              </div>
            )}

            {browserError && (
              <div className="p-3.5 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {browserError}
              </div>
            )}
          </div>

          {/* Mobile Phone Wallet Browser Deep-Links + Sign In With Browser */}
          <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-emerald-500" />
                  Phone Wallets (iPhone & Android) — Open in Wallet Browser
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-2xl">
                  Mobile Safari and Chrome often cannot detect phone wallet apps directly. Tap a
                  wallet below to open ChainScope inside that app&apos;s built-in browser so it
                  connects in one tap, or copy the link to open in any wallet browser.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleCopySiteUrl()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium shrink-0"
              >
                {copiedAppLink ? (
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copiedAppLink ? 'Copied URL' : 'Copy Link for Wallet Browser'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {mobileDeepLinks.map((link) => (
                <a
                  key={link.id}
                  href={link.href}
                  rel="noopener noreferrer"
                  className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-500/70 bg-slate-50 dark:bg-[#0B0F17] flex items-center justify-between gap-3 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Open in {link.name}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate mt-0.5">{link.chains}</div>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                </a>
              ))}
            </div>

            {!user && (
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Using a phone or wallet browser? Sign in to your ChainScope account using your
                  browser directly:
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void signInWithBrowserRedirect()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    Sign In With Browser
                  </button>
                  <button
                    type="button"
                    onClick={() => void signInWithGoogle()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    Popup Sign In
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODE 4: WATCH / ENS / KEYSTORE + SHOWCASE */}
      {mode === 'watch-keystore' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Watch Address / ENS */}
          <div className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Watch-Only Address or ENS Lookup
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Track any public 0x address, .eth ENS name, or Solana address without keys.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  EVM Address or ENS Name (.eth)
                </label>
                <input
                  type="text"
                  value={watchInput}
                  onChange={(e) => {
                    setWatchInput(e.target.value);
                    setWatchError(null);
                  }}
                  placeholder="0x... or vitalik.eth"
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Optional Paired Solana Address
                </label>
                <input
                  type="text"
                  value={watchSolInput}
                  onChange={(e) => {
                    setWatchSolInput(e.target.value);
                    setWatchError(null);
                  }}
                  placeholder="Solana base58 public key"
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Label (Optional)
                </label>
                <input
                  type="text"
                  value={watchLabel}
                  onChange={(e) => setWatchLabel(e.target.value)}
                  placeholder="e.g., Cold Storage Vault"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            {watchError && (
              <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-600 dark:text-red-400">
                {watchError}
              </div>
            )}

            <button
              type="button"
              onClick={handleWatchImport}
              disabled={watchBusy}
              className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium flex items-center justify-center gap-2 transition-colors"
            >
              {watchBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Track & Scan Address
            </button>
          </div>

          {/* Keystore V3 JSON Decryptor */}
          <div className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Encrypted Web3 Keystore JSON
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Drop a standard Ethereum V3 Keystore .json file to decrypt locally and scan all EVM
                chains.
              </p>
            </div>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) handleKeystoreFile(file);
              }}
              onClick={() => fileInputRef.current?.click()}
              className="cursor-pointer rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 p-5 text-center bg-slate-50 dark:bg-[#0B0F17] transition-colors"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleKeystoreFile(file);
                }}
              />
              {keystoreFileName ? (
                <div className="flex items-center justify-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <FileJson className="w-4 h-4" />
                  {keystoreFileName} loaded
                </div>
              ) : (
                <div className="space-y-1">
                  <Upload className="w-5 h-5 mx-auto text-slate-400" />
                  <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Drop Keystore .json here or click to browse
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Keystore Password
                </label>
                <input
                  type="password"
                  value={keystorePassword}
                  onChange={(e) => setKeystorePassword(e.target.value)}
                  placeholder="Enter keystore decryption password"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Label (Optional)
                </label>
                <input
                  type="text"
                  value={keystoreLabel}
                  onChange={(e) => setKeystoreLabel(e.target.value)}
                  placeholder="e.g., Geth Keystore"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            {keystoreError && (
              <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-600 dark:text-red-400">
                {keystoreError}
              </div>
            )}

            <button
              type="button"
              onClick={handleDecryptKeystore}
              disabled={keystoreBusy || !keystoreJson}
              className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium flex items-center justify-center gap-2 transition-colors"
            >
              {keystoreBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Decrypt & Import Keystore
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
