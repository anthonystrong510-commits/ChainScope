import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Coins,
  Copy,
  Dices,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  MousePointerClick,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import type { WalletEntry } from '../types/wallet';
import {
  computeValidChecksumLastWords,
  createEncryptedKeystoreJson,
  deriveMultiChainFromMnemonic,
  generateMnemonicFromCustomEntropy,
  generateRandomMnemonic,
  isValidBip39Word,
  searchBip39Words,
  type DerivedWalletBundle,
} from '../utils/crypto';

interface SeedStudioViewProps {
  onImportGeneratedWallet: (wallet: WalletEntry) => void;
}

type StudioMode = 'csprng' | 'entropy-pad' | 'manual-builder';

export function SeedStudioView({ onImportGeneratedWallet }: SeedStudioViewProps) {
  const [wordCount, setWordCount] = useState<12 | 24>(12);
  const [studioMode, setStudioMode] = useState<StudioMode>('csprng');
  const [phrase, setPhrase] = useState<string>(() => generateRandomMnemonic(12));
  const [derived, setDerived] = useState<DerivedWalletBundle | null>(null);
  const [revealKeys, setRevealKeys] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [walletLabel, setWalletLabel] = useState('Generated Vault');

  // --- Mode 2: Interactive Entropy Collector (Mouse/Touch + Coin Flip + Dice) ---
  const targetBits = wordCount === 12 ? 128 : 256;
  const [entropyPool, setEntropyPool] = useState<number[]>([]);
  const [coinFlips, setCoinFlips] = useState<string>('');
  const [diceRolls, setDiceRolls] = useState<number[]>([]);

  // --- Mode 3: Manual Word Builder ---
  const prefixCount = wordCount === 12 ? 11 : 23;
  const [manualWords, setManualWords] = useState<string[]>(() => Array(11).fill(''));
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [validChecksumOptions, setValidChecksumOptions] = useState<string[]>([]);
  const [selectedFinalWord, setSelectedFinalWord] = useState<string>('');

  // --- Keystore JSON Export ---
  const [exportPass, setExportPass] = useState('');
  const [exporting, setExporting] = useState(false);

  // Sync manualWords length when switching 12 <-> 24
  useEffect(() => {
    setManualWords((prev) => {
      if (prev.length === prefixCount) return prev;
      if (prefixCount === 11) return prev.slice(0, 11);
      return [...prev, ...Array(12).fill('')];
    });
    setValidChecksumOptions([]);
    setSelectedFinalWord('');
  }, [prefixCount]);

  // Regenerate CSPRNG phrase when toggling 12 <-> 24 in csprng mode
  useEffect(() => {
    if (studioMode === 'csprng') {
      setPhrase(generateRandomMnemonic(wordCount));
    }
  }, [wordCount, studioMode]);

  // Derive EVM + Solana whenever phrase updates
  useEffect(() => {
    let cancelled = false;
    if (!phrase) {
      setDerived(null);
      return;
    }
    deriveMultiChainFromMnemonic(phrase, 0)
      .then((bundle) => {
        if (!cancelled) setDerived(bundle);
      })
      .catch(() => {
        if (!cancelled) setDerived(null);
      });
    return () => {
      cancelled = true;
    };
  }, [phrase]);

  // Compute valid checksum last words in Manual Builder mode
  const allPrefixValid = useMemo(
    () => manualWords.length === prefixCount && manualWords.every((w) => isValidBip39Word(w)),
    [manualWords, prefixCount]
  );

  useEffect(() => {
    let cancelled = false;
    if (studioMode !== 'manual-builder' || !allPrefixValid) {
      setValidChecksumOptions([]);
      setSelectedFinalWord('');
      return;
    }
    computeValidChecksumLastWords(manualWords).then((options) => {
      if (cancelled) return;
      setValidChecksumOptions(options);
      if (options.length > 0) {
        const first = options[0];
        setSelectedFinalWord(first);
        setPhrase([...manualWords.map((w) => w.trim().toLowerCase()), first].join(' '));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [studioMode, allPrefixValid, manualWords]);

  const activeSuggestions = useMemo(() => {
    if (activeSlot === null) return [];
    const cur = manualWords[activeSlot] || '';
    if (!cur.trim() || isValidBip39Word(cur)) return [];
    return searchBip39Words(cur, 6);
  }, [activeSlot, manualWords]);

  const collectedBits = Math.min(
    targetBits,
    entropyPool.length * 2 + coinFlips.length + diceRolls.length * 2
  );
  const entropyPct = Math.round((collectedBits / targetBits) * 100);

  const handleEntropyPointerMove = (x: number, y: number) => {
    if (collectedBits >= targetBits) return;
    const sample = ((Math.round(x * 13) ^ Math.round(y * 17) ^ Date.now()) & 0xff) >>> 0;
    setEntropyPool((prev) => [...prev, sample]);
  };

  const handleCoinFlip = (bit: '0' | '1') => {
    if (collectedBits >= targetBits) return;
    setCoinFlips((prev) => prev + bit);
  };

  const handleDiceRoll = () => {
    if (collectedBits >= targetBits) return;
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    const face = (arr[0] % 6) + 1;
    setDiceRolls((prev) => [...prev, face]);
  };

  const handleFinalizeCustomEntropy = async () => {
    const encoder = new TextEncoder();
    const combinedStr = `${entropyPool.join(',')}|${coinFlips}|${diceRolls.join(',')}|${performance.now()}`;
    const raw = encoder.encode(combinedStr);
    const mnemonic = await generateMnemonicFromCustomEntropy(raw, wordCount);
    setPhrase(mnemonic);
  };

  const handleRandomFillManual = () => {
    const randomFull = generateRandomMnemonic(wordCount).split(' ');
    setManualWords(randomFull.slice(0, prefixCount));
  };

  const handleCopy = async (label: string, val: string) => {
    await navigator.clipboard.writeText(val);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 1600);
  };

  const handleDownloadKeystore = async () => {
    if (!derived || !exportPass) return;
    setExporting(true);
    try {
      const json = await createEncryptedKeystoreJson(derived.evmPrivateKey, exportPass);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `keystore-${derived.evmAddress.slice(2, 10).toLowerCase()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const handleImportToDashboard = () => {
    if (!derived) return;
    onImportGeneratedWallet({
      id: `gen-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: walletLabel.trim() || `Generated ${wordCount}-Word Vault`,
      origin: 'seed',
      evmAddress: derived.evmAddress,
      solanaAddress: derived.solanaAddress,
      accountIndex: 0,
      wordCount,
      createdAt: Date.now(),
    });
  };

  const phraseWords = useMemo(() => (phrase ? phrase.split(' ') : []), [phrase]);

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Manual 12 & 24-Word Seed Phrase Studio
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Generate standard BIP-39 12-word (128-bit) or 24-word (256-bit) phrases via WebCrypto
            CSPRNG, interactive human entropy, or manual word selection with automatic checksum
            solving.
          </p>
        </div>

        {/* 12 / 24 Word Selector */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#111827] border border-slate-200 dark:border-slate-800">
          {([12, 24] as const).map((cnt) => (
            <button
              key={cnt}
              type="button"
              onClick={() => setWordCount(cnt)}
              className={`px-3.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                wordCount === cnt
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {cnt} Words ({cnt === 12 ? '128-bit' : '256-bit'})
            </button>
          ))}
        </div>
      </div>

      {/* Generation Mode Tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#111827] border border-slate-200 dark:border-slate-800 w-fit">
        <button
          type="button"
          onClick={() => setStudioMode('csprng')}
          className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
            studioMode === 'csprng'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Instant CSPRNG
        </button>
        <button
          type="button"
          onClick={() => setStudioMode('entropy-pad')}
          className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
            studioMode === 'entropy-pad'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <MousePointerClick className="w-3.5 h-3.5" />
          Manual Entropy & Dice
        </button>
        <button
          type="button"
          onClick={() => setStudioMode('manual-builder')}
          className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
            studioMode === 'manual-builder'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <KeyRound className="w-3.5 h-3.5" />
          Manual Word Picker + Checksum
        </button>
      </div>

      {/* Mode 1: Instant CSPRNG Controls */}
      {studioMode === 'csprng' && (
        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs text-slate-600 dark:text-slate-300">
            Generated using browser hardware-backed{' '}
            <code className="font-mono text-slate-900 dark:text-slate-100">
              crypto.getRandomValues()
            </code>{' '}
            ({wordCount === 12 ? '16 bytes' : '32 bytes'} entropy).
          </div>
          <button
            type="button"
            onClick={() => setPhrase(generateRandomMnemonic(wordCount))}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Generate New {wordCount}-Word Phrase
          </button>
        </div>
      )}

      {/* Mode 2: Interactive Entropy Collector */}
      {studioMode === 'entropy-pad' && (
        <div className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Manual Entropy Collector ({collectedBits} / {targetBits} bits)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Move your pointer inside the capture pad, flip virtual coins, or roll dice until 100%
                entropy is reached, then derive your phrase.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEntropyPool([]);
                setCoinFlips('');
                setDiceRolls([]);
              }}
              className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
            >
              Reset Pool
            </button>
          </div>

          <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-150"
              style={{ width: `${entropyPct}%` }}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                handleEntropyPointerMove(e.clientX - rect.left, e.clientY - rect.top);
              }}
              onTouchMove={(e) => {
                const touch = e.touches[0];
                if (!touch) return;
                const rect = e.currentTarget.getBoundingClientRect();
                handleEntropyPointerMove(touch.clientX - rect.left, touch.clientY - rect.top);
              }}
              className="h-36 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] flex flex-col items-center justify-center text-center p-4 cursor-crosshair select-none"
            >
              <MousePointerClick className="w-5 h-5 text-blue-500 mb-1.5" />
              <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Move cursor or finger here to harvest pointer entropy
              </div>
              <div className="text-[11px] font-mono text-slate-500 mt-1 tabular-nums">
                {entropyPool.length} pointer samples captured
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] flex flex-col justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCoinFlip('1')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
                >
                  <Coins className="w-3.5 h-3.5 text-amber-500" />
                  Heads (1)
                </button>
                <button
                  type="button"
                  onClick={() => handleCoinFlip('0')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
                >
                  <Coins className="w-3.5 h-3.5 text-slate-400" />
                  Tails (0)
                </button>
                <button
                  type="button"
                  onClick={handleDiceRoll}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
                >
                  <Dices className="w-3.5 h-3.5 text-blue-500" />
                  Roll D6
                </button>
              </div>
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 break-all">
                Bits: {coinFlips || '—'} {diceRolls.length > 0 ? `| Dice: ${diceRolls.join(',')}` : ''}
              </div>
              <button
                type="button"
                onClick={handleFinalizeCustomEntropy}
                disabled={collectedBits < targetBits}
                className="w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-medium transition-colors"
              >
                {collectedBits < targetBits
                  ? `Collect ${targetBits - collectedBits} more bits…`
                  : `Derive ${wordCount}-Word Phrase from Entropy`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mode 3: Manual Word Picker + Checksum Solver */}
      {studioMode === 'manual-builder' && (
        <div className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Manual Word Builder (Pick {prefixCount} Words, Auto-Solve Word #{wordCount})
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Choose any {prefixCount} words from the 2,048-word BIP-39 dictionary. Word #{wordCount}{' '}
                encodes the SHA-256 checksum, so valid final words are computed automatically.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRandomFillManual}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium transition-colors"
            >
              Auto-Fill {prefixCount} Words
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
            {manualWords.map((w, idx) => {
              const valid = w.trim().length > 0 && isValidBip39Word(w);
              return (
                <div key={idx} className="relative">
                  <div
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-xs ${
                      valid
                        ? 'border-emerald-500/40 bg-emerald-50/30 dark:bg-emerald-950/10'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]'
                    }`}
                  >
                    <span className="font-mono text-[11px] text-slate-400 w-5 shrink-0 tabular-nums">
                      {idx + 1}.
                    </span>
                    <input
                      type="text"
                      value={w}
                      onFocus={() => setActiveSlot(idx)}
                      onBlur={() => setTimeout(() => setActiveSlot((c) => (c === idx ? null : c)), 150)}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\s+/g, '').toLowerCase();
                        setManualWords((prev) => prev.map((x, i) => (i === idx ? val : x)));
                      }}
                      placeholder="type word"
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
                            setManualWords((prev) => prev.map((x, i) => (i === idx ? sug : x)));
                            setActiveSlot(idx + 1 < prefixCount ? idx + 1 : null);
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

            {/* Word #12 / #24 Checksum Selector */}
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-blue-500/40 bg-blue-50/40 dark:bg-blue-500/10 text-xs">
              <span className="font-mono text-[11px] text-blue-600 dark:text-blue-400 w-5 shrink-0 tabular-nums">
                {wordCount}.
              </span>
              {validChecksumOptions.length > 0 ? (
                <select
                  value={selectedFinalWord}
                  onChange={(e) => {
                    const finalW = e.target.value;
                    setSelectedFinalWord(finalW);
                    setPhrase([...manualWords.map((m) => m.trim().toLowerCase()), finalW].join(' '));
                  }}
                  aria-label="Select valid checksum final word"
                  className="w-full min-w-0 bg-transparent font-mono text-xs font-semibold text-blue-700 dark:text-blue-300 focus:outline-none"
                >
                  {validChecksumOptions.map((opt) => (
                    <option key={opt} value={opt} className="bg-white dark:bg-slate-900">
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-[11px] text-slate-400 truncate">Checksum auto-solved</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Generated Phrase Display & Derived Dual-Chain Keys */}
      <div className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Active {wordCount}-Word BIP-39 Mnemonic
            </h3>
          </div>
          <button
            type="button"
            onClick={() => handleCopy('phrase', phrase)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors"
          >
            {copiedField === 'phrase' ? (
              <Check className="w-3.5 h-3.5 text-emerald-500" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            {copiedField === 'phrase' ? 'Copied Phrase' : 'Copy Phrase'}
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {phraseWords.map((w, idx) => (
            <div
              key={`${idx}-${w}`}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-xs"
            >
              <span className="font-mono text-[11px] text-slate-400 w-5 tabular-nums">{idx + 1}.</span>
              <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{w}</span>
            </div>
          ))}
        </div>

        {derived && (
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Derived Multi-Chain Accounts
              </div>
              <button
                type="button"
                onClick={() => setRevealKeys((r) => !r)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
              >
                {revealKeys ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                {revealKeys ? 'Hide Private Keys' : 'Reveal Private Keys'}
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* EVM Account */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    Ethereum / Polygon / L2s
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">{derived.evmPath}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono text-slate-700 dark:text-slate-300 truncate">
                    {derived.evmAddress}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy('evm-addr', derived.evmAddress)}
                    className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 shrink-0"
                    aria-label="Copy EVM address"
                  >
                    {copiedField === 'evm-addr' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2 pt-1 text-[11px] border-t border-slate-200/70 dark:border-slate-800">
                  <span className="text-slate-500">Private Key:</span>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono text-slate-600 dark:text-slate-400 truncate">
                      {revealKeys ? derived.evmPrivateKey : '••••••••••••••••••••••••••••••••'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy('evm-pk', derived.evmPrivateKey)}
                      className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 shrink-0"
                      aria-label="Copy EVM private key"
                    >
                      {copiedField === 'evm-pk' ? (
                        <Check className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Solana Account */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    Solana (Ed25519)
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">{derived.solanaPath}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono text-slate-700 dark:text-slate-300 truncate">
                    {derived.solanaAddress}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy('sol-addr', derived.solanaAddress)}
                    className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 shrink-0"
                    aria-label="Copy Solana address"
                  >
                    {copiedField === 'sol-addr' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2 pt-1 text-[11px] border-t border-slate-200/70 dark:border-slate-800">
                  <span className="text-slate-500">Secret Key:</span>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono text-slate-600 dark:text-slate-400 truncate">
                      {revealKeys ? derived.solanaPrivateKey : '••••••••••••••••••••••••••••••••'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy('sol-pk', derived.solanaPrivateKey)}
                      className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 shrink-0"
                      aria-label="Copy Solana secret key"
                    >
                      {copiedField === 'sol-pk' ? (
                        <Check className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Bar: Import to Dashboard OR Export Encrypted Keystore */}
            <div className="pt-2 flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-wrap items-end gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                    Profile Label
                  </label>
                  <input
                    type="text"
                    value={walletLabel}
                    onChange={(e) => setWalletLabel(e.target.value)}
                    className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 w-48"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleImportToDashboard}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors"
                >
                  <Wallet className="w-3.5 h-3.5" />
                  Import to Dashboard & Scan Now
                </button>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                    Keystore Export Password
                  </label>
                  <input
                    type="password"
                    value={exportPass}
                    onChange={(e) => setExportPass(e.target.value)}
                    placeholder="Password to encrypt"
                    className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 w-44"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleDownloadKeystore}
                  disabled={!exportPass || exporting}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  {exporting ? 'Encrypting…' : 'Export Keystore JSON'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
