import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
  Sparkles,
  UserPlus,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { deriveMultiChainFromMnemonic, generateRandomMnemonic } from '../utils/crypto';
import { truncateAddress } from '../utils/chains';
import {
  AVATAR_PRESET_COLORS,
  compressAvatarImageFile,
  listLocalVaultUsers,
} from '../utils/walletVault';

interface GeneratedSeedBundle {
  mnemonic: string;
  words: string[];
  evmAddress: string;
  evmPrivateKey: string;
  solanaAddress: string;
  solanaPrivateKey: string;
  cscAddress: string;
  verifyIndices: [number, number];
}

function getPasswordStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: 'Enter password', color: 'bg-slate-300 dark:bg-slate-700' };
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1;
  if (/\d/.test(pw) && /[^a-zA-Z0-9]/.test(pw)) score += 1;
  if (score <= 1) return { score: 1, label: 'Weak', color: 'bg-red-500' };
  if (score === 2) return { score: 2, label: 'Fair', color: 'bg-amber-500' };
  if (score === 3) return { score: 3, label: 'Good', color: 'bg-blue-500' };
  return { score: 4, label: 'Strong', color: 'bg-emerald-500' };
}

export function WalletOnboardingModal() {
  const {
    showOnboardingModal,
    dismissOnboardingModal,
    registerWalletAccount,
    loginWalletAccount,
    signInWithGoogle,
    signInWithBrowserRedirect,
  } = useAuth();

  const localVaults = useMemo(
    () => (showOnboardingModal ? listLocalVaultUsers() : []),
    [showOnboardingModal]
  );

  const [mode, setMode] = useState<'create' | 'login'>(() =>
    localVaults.length > 0 ? 'login' : 'create'
  );
  const [step, setStep] = useState<1 | 2>(1);

  // Create form state
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<{
    checking: boolean;
    available: boolean | null;
    message?: string;
  }>({ checking: false, available: null });
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string>(`preset:${AVATAR_PRESET_COLORS[0]}`);

  // Step 2: Generated seed & verification
  const [seedBundle, setSeedBundle] = useState<GeneratedSeedBundle | null>(null);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [verifyWordA, setVerifyWordA] = useState('');
  const [verifyWordB, setVerifyWordB] = useState('');
  const [copiedSeed, setCopiedSeed] = useState(false);

  // Login state
  const [loginUsername, setLoginUsername] = useState(() => localVaults[0]?.username || '');
  const [loginPassword, setLoginPassword] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!showOnboardingModal) return;
    setError(null);
    if (localVaults.length > 0 && !loginUsername) {
      setLoginUsername(localVaults[0].username);
    }
  }, [showOnboardingModal, localVaults, loginUsername]);

  // Debounced unique username check
  useEffect(() => {
    const clean = username.trim().replace(/^@/, '');
    if (!clean || clean.length < 3) {
      setUsernameStatus({
        checking: false,
        available: null,
        message: clean ? 'Minimum 3 characters (letters, numbers, _)' : undefined,
      });
      return;
    }
    let cancelled = false;
    setUsernameStatus({ checking: true, available: null });
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/db/wallet-auth/check-username?username=${encodeURIComponent(clean)}`
        );
        const json = (await res.json()) as {
          available: boolean;
          error?: string;
        };
        if (!cancelled) {
          setUsernameStatus({
            checking: false,
            available: Boolean(json.available),
            message: json.available ? `@${clean} is available` : json.error || 'Username unavailable',
          });
        }
      } catch {
        if (!cancelled) {
          setUsernameStatus({ checking: false, available: null });
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [username]);

  if (!showOnboardingModal) return null;

  const strength = getPasswordStrength(password);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const compressed = await compressAvatarImageFile(file);
      setAvatarUrl(compressed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to process image.');
    }
  };

  const handleProceedToSeedStep = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanUser = username.trim().replace(/^@/, '');
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(cleanUser)) {
      setError('Username must be 3–24 characters using letters, numbers, or underscores.');
      return;
    }
    if (usernameStatus.available === false) {
      setError(usernameStatus.message || 'Choose a unique username.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const mnemonic = generateRandomMnemonic(12);
      const derived = await deriveMultiChainFromMnemonic(mnemonic, 0);
      const words = mnemonic.split(' ');
      const idxA = Math.floor(Math.random() * 6); // word 1..6
      const idxB = 6 + Math.floor(Math.random() * 6); // word 7..12

      setSeedBundle({
        mnemonic,
        words,
        evmAddress: derived.evmAddress,
        evmPrivateKey: derived.evmPrivateKey,
        solanaAddress: derived.solanaAddress,
        solanaPrivateKey: derived.solanaPrivateKey,
        cscAddress: `CSC1${derived.solanaAddress}`,
        verifyIndices: [idxA, idxB],
      });
      setSavedConfirmed(false);
      setVerifyWordA('');
      setVerifyWordB('');
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate cryptographic wallet.');
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteWalletCreation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!seedBundle) return;
    setError(null);

    if (!savedConfirmed) {
      setError('Confirm that you saved your 12-word seed phrase.');
      return;
    }
    const [idxA, idxB] = seedBundle.verifyIndices;
    if (
      verifyWordA.trim().toLowerCase() !== seedBundle.words[idxA] ||
      verifyWordB.trim().toLowerCase() !== seedBundle.words[idxB]
    ) {
      setError(
        `Seed verification failed: check Word #${idxA + 1} and Word #${idxB + 1}.`
      );
      return;
    }

    setBusy(true);
    try {
      const cleanUser = username.trim().replace(/^@/, '');
      await registerWalletAccount({
        username: cleanUser,
        password,
        displayName: displayName.trim() || cleanUser,
        avatarUrl,
        mnemonic: seedBundle.mnemonic,
        evmAddress: seedBundle.evmAddress,
        evmPrivateKey: seedBundle.evmPrivateKey,
        solanaAddress: seedBundle.solanaAddress,
        solanaPrivateKey: seedBundle.solanaPrivateKey,
        cscAddress: seedBundle.cscAddress,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to finish wallet setup.');
    } finally {
      setBusy(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await loginWalletAccount(loginUsername, loginPassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadSeedBackup = () => {
    if (!seedBundle) return;
    const cleanUser = username.trim().replace(/^@/, '') || 'chainscope';
    const content = JSON.stringify(
      {
        username: cleanUser,
        cscAddress: seedBundle.cscAddress,
        evmAddress: seedBundle.evmAddress,
        solanaAddress: seedBundle.solanaAddress,
        seedPhrase: seedBundle.mnemonic,
        exportedAt: new Date().toISOString(),
      },
      null,
      2
    );
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cleanUser}-chainscope-seed-backup.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderAvatarPreview = (sizeClass = 'w-14 h-14') => {
    if (avatarUrl.startsWith('data:image/')) {
      return (
        <img
          src={avatarUrl}
          alt="Wallet profile"
          className={`${sizeClass} rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0`}
        />
      );
    }
    const bg = avatarUrl.startsWith('preset:') ? avatarUrl.slice(7) : AVATAR_PRESET_COLORS[0];
    const initial = (username.trim().replace(/^@/, '')[0] || 'C').toUpperCase();
    return (
      <div
        className={`${sizeClass} rounded-full flex items-center justify-center text-white font-display font-bold text-lg shrink-0`}
        style={{ backgroundColor: bg }}
      >
        {initial}
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/75 backdrop-blur-xs p-0 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="ChainScope Wallet Setup"
    >
      <div className="w-full max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4 sm:p-6 pb-safe space-y-5 shadow-2xl sm:my-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                ChainScope Wallet Vault
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Create your unique @username wallet & encrypted seed vault
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={dismissOnboardingModal}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Explore read-only"
            title="Close and browse read-only"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17] text-xs">
          <button
            type="button"
            onClick={() => {
              setMode('create');
              setError(null);
            }}
            className={`py-2 rounded-md font-semibold flex items-center justify-center gap-1.5 transition-colors ${
              mode === 'create'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            Create New Wallet
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError(null);
            }}
            className={`py-2 rounded-md font-semibold flex items-center justify-center gap-1.5 transition-colors ${
              mode === 'login'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            Unlock / Sign In
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* CREATE WALLET: STEP 1 */}
        {mode === 'create' && step === 1 && (
          <form onSubmit={handleProceedToSeedStep} className="space-y-4">
            {/* Profile Photo Picker */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]">
              {renderAvatarPreview()}
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
                    <Camera className="w-3.5 h-3.5 text-blue-500" />
                    Upload Photo
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => void handleAvatarUpload(e)}
                      className="hidden"
                    />
                  </label>
                  <div className="flex items-center gap-1.5">
                    {AVATAR_PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setAvatarUrl(`preset:${c}`)}
                        aria-label={`Select avatar color ${c}`}
                        className={`w-5 h-5 rounded-full border-2 transition-transform ${
                          avatarUrl === `preset:${c}`
                            ? 'border-slate-900 dark:border-white scale-110'
                            : 'border-transparent'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Optional wallet profile photo (can be changed anytime in settings)
                </p>
              </div>
            </div>

            {/* Unique Username */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Unique Username
                </label>
                {usernameStatus.checking ? (
                  <span className="text-[11px] text-slate-400 inline-flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Checking...
                  </span>
                ) : usernameStatus.message ? (
                  <span
                    className={`text-[11px] font-medium ${
                      usernameStatus.available === true
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : usernameStatus.available === false
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-slate-500'
                    }`}
                  >
                    {usernameStatus.message}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] px-3">
                <span className="text-xs font-mono text-slate-400 mr-1">@</span>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                  placeholder="satoshi_vault"
                  maxLength={24}
                  className="w-full py-2 bg-transparent text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none"
                />
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Generates your personal wallet named @{username || 'username'} for EVM, Solana & CSC-1.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Display Name (optional)
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Alex Trader"
                maxLength={48}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs text-slate-900 dark:text-slate-100"
              />
            </div>

            {/* Password & Confirm */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Vault Password (min 8 chars)
                </label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Strong password"
                    className="w-full px-3 py-2 pr-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                  >
                    {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Confirm Password
                </label>
                <input
                  type={showPw ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat password"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="grid grid-cols-4 gap-1.5">
                {[1, 2, 3, 4].map((lvl) => (
                  <div
                    key={lvl}
                    className={`h-1.5 rounded-full ${
                      strength.score >= lvl ? strength.color : 'bg-slate-200 dark:bg-slate-800'
                    }`}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span>Encrypted with PBKDF2 + AES-256-GCM</span>
                <span className="font-medium">{strength.label}</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={busy || usernameStatus.checking || usernameStatus.available === false}
              className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Generate @{username.trim() || 'username'} Wallet & Seed Phrase
            </button>
          </form>
        )}

        {/* CREATE WALLET: STEP 2 (SEED PHRASE BACKUP & VERIFY) */}
        {mode === 'create' && step === 2 && seedBundle && (
          <form onSubmit={handleCompleteWalletCreation} className="space-y-4">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </button>
              <span className="text-xs font-mono text-blue-600 dark:text-blue-400">
                @{username.trim()} Wallet Ready
              </span>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] p-3 text-[11px] font-mono space-y-1 text-slate-600 dark:text-slate-300">
              <div>CSC-1: {truncateAddress(seedBundle.cscAddress, 10, 8)}</div>
              <div>EVM: {truncateAddress(seedBundle.evmAddress, 8, 6)} · SOL: {truncateAddress(seedBundle.solanaAddress, 8, 6)}</div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-amber-500" />
                  Save Your 12-Word Seed Phrase
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(seedBundle.mnemonic);
                      setCopiedSeed(true);
                      window.setTimeout(() => setCopiedSeed(false), 1600);
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {copiedSeed ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedSeed ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadSeedBackup}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:underline"
                  >
                    <Download className="w-3 h-3" />
                    Backup JSON
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {seedBundle.words.map((word, idx) => (
                  <div
                    key={`${word}-${idx}`}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-xs font-mono flex items-center gap-1.5 min-w-0"
                  >
                    <span className="text-[10px] text-slate-400 w-4 shrink-0">{idx + 1}.</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {word}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Verify 2 words */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Confirm Word #{seedBundle.verifyIndices[0] + 1}
                </label>
                <input
                  type="text"
                  required
                  value={verifyWordA}
                  onChange={(e) => setVerifyWordA(e.target.value)}
                  placeholder={`Word #${seedBundle.verifyIndices[0] + 1}`}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs font-mono text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Confirm Word #{seedBundle.verifyIndices[1] + 1}
                </label>
                <input
                  type="text"
                  required
                  value={verifyWordB}
                  onChange={(e) => setVerifyWordB(e.target.value)}
                  placeholder={`Word #${seedBundle.verifyIndices[1] + 1}`}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs font-mono text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={savedConfirmed}
                onChange={(e) => setSavedConfirmed(e.target.checked)}
                className="mt-0.5 rounded border-slate-300"
              />
              <span>
                I have securely backed up my 12-word seed phrase. ChainScope encrypts keys locally with my password and never stores my seed on servers.
              </span>
            </label>

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              Encrypt Vault & Open @{username.trim()} Wallet
            </button>
          </form>
        )}

        {/* LOGIN / UNLOCK EXISTING WALLET */}
        {mode === 'login' && (
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            {localVaults.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Saved Vaults on This Device
                </div>
                <div className="flex flex-wrap gap-2">
                  {localVaults.map((v) => (
                    <button
                      key={v.uid}
                      type="button"
                      onClick={() => setLoginUsername(v.username)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-mono transition-colors ${
                        loginUsername.toLowerCase() === v.username.toLowerCase()
                          ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                          : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      @{v.username}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Username
              </label>
              <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] px-3">
                <span className="text-xs font-mono text-slate-400 mr-1">@</span>
                <input
                  type="text"
                  required
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  placeholder="your_username"
                  className="w-full py-2 bg-transparent text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Password
              </label>
              <input
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Enter your vault password"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs text-slate-900 dark:text-slate-100"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              Unlock & Sign In
            </button>
          </form>
        )}

        {/* Optional Google Login Divider */}
        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
          <div className="text-center text-[11px] text-slate-500 dark:text-slate-400">
            Google login is optional — create a wallet above or connect Google anytime later
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              className="py-2 px-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors"
            >
              Google Sign-In
            </button>
            <button
              type="button"
              onClick={() => void signInWithBrowserRedirect()}
              className="py-2 px-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors"
            >
              Google Redirect
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
