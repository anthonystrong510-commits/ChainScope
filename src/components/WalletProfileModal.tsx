import { useEffect, useState } from 'react';
import {
  Camera,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  LogOut,
  ShieldCheck,
  Unlock,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { truncateAddress } from '../utils/chains';
import { AVATAR_PRESET_COLORS, compressAvatarImageFile } from '../utils/walletVault';

export function WalletProfileModal() {
  const {
    user,
    profile,
    walletAccount,
    unlockedVault,
    hasLocalVault,
    showProfileModal,
    setShowProfileModal,
    updateWalletProfileSettings,
    unlockLocalVault,
    lockLocalVault,
    linkGoogleAccount,
    unlinkGoogleAccount,
    changeWalletPassword,
    signOutUser,
  } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [vaultPasswordInput, setVaultPasswordInput] = useState('');
  const [revealedMnemonic, setRevealedMnemonic] = useState<string | null>(null);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!showProfileModal) return;
    setDisplayName(walletAccount?.displayName || profile?.displayName || user?.displayName || '');
    setUsername(walletAccount?.username || profile?.handle || '');
    setAvatarUrl(walletAccount?.avatarUrl || user?.photoURL || `preset:${AVATAR_PRESET_COLORS[0]}`);
    setNotice(null);
    setRevealedMnemonic(null);
    setVaultPasswordInput('');
  }, [showProfileModal, walletAccount, profile, user]);

  if (!showProfileModal || !user) return null;

  const copyValue = (val: string, key: string) => {
    void navigator.clipboard.writeText(val);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 1500);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setNotice(null);
    try {
      const compressed = await compressAvatarImageFile(file);
      setAvatarUrl(compressed);
    } catch (err) {
      setNotice({ type: 'err', text: err instanceof Error ? err.message : 'Invalid photo' });
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('save');
    setNotice(null);
    try {
      await updateWalletProfileSettings({
        displayName: displayName.trim(),
        username: username.trim().replace(/^@/, ''),
        avatarUrl,
      });
      setNotice({ type: 'ok', text: 'Wallet profile & photo saved to Supabase.' });
    } catch (err) {
      setNotice({ type: 'err', text: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setBusy(null);
    }
  };

  const handleRevealSeed = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('reveal');
    setNotice(null);
    try {
      const decrypted = await unlockLocalVault(vaultPasswordInput);
      setRevealedMnemonic(decrypted.mnemonic);
      setVaultPasswordInput('');
    } catch (err) {
      setNotice({ type: 'err', text: err instanceof Error ? err.message : 'Incorrect password' });
    } finally {
      setBusy(null);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('password');
    setNotice(null);
    try {
      await changeWalletPassword(currentPw, newPw);
      setCurrentPw('');
      setNewPw('');
      setNotice({ type: 'ok', text: 'Wallet password updated and seed vault re-encrypted.' });
    } catch (err) {
      setNotice({ type: 'err', text: err instanceof Error ? err.message : 'Password update failed' });
    } finally {
      setBusy(null);
    }
  };

  const handleLinkGoogle = async () => {
    setBusy('google');
    setNotice(null);
    try {
      const updated = await linkGoogleAccount();
      setNotice({
        type: 'ok',
        text: `Connected Google account (${updated.linkedGoogleEmail}). You can now sign in with either username/password or Google.`,
      });
    } catch (err) {
      setNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to connect Google account',
      });
    } finally {
      setBusy(null);
    }
  };

  const handleUnlinkGoogle = async () => {
    setBusy('google');
    setNotice(null);
    try {
      await unlinkGoogleAccount();
      setNotice({ type: 'ok', text: 'Disconnected Google login. Your username & password remain active.' });
    } catch (err) {
      setNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to disconnect Google account',
      });
    } finally {
      setBusy(null);
    }
  };

  const renderAvatar = () => {
    if (avatarUrl.startsWith('data:image/') || avatarUrl.startsWith('http')) {
      return (
        <img
          src={avatarUrl}
          alt="Wallet avatar"
          className="w-16 h-16 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0"
        />
      );
    }
    const bg = avatarUrl.startsWith('preset:') ? avatarUrl.slice(7) : AVATAR_PRESET_COLORS[0];
    const ch = (username[0] || displayName[0] || 'C').toUpperCase();
    return (
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center text-white font-display font-bold text-xl shrink-0"
        style={{ backgroundColor: bg }}
      >
        {ch}
      </div>
    );
  };

  const googleEmail = walletAccount?.linkedGoogleEmail || user.email || '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Wallet Profile & Security Settings"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-5 shadow-2xl my-auto max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Wallet Profile & Security
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Manage your @username identity, profile photo, encrypted seed vault, and optional Google login
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowProfileModal(false)}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Close settings"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {notice && (
          <div
            className={`rounded-lg border px-3.5 py-2.5 text-xs ${
              notice.type === 'ok'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
            }`}
          >
            {notice.text}
          </div>
        )}

        {/* Profile & Photo Form */}
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div className="flex items-center gap-4 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]">
            {renderAvatar()}
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
                  <Camera className="w-3.5 h-3.5 text-blue-500" />
                  Change Photo
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => void handlePhotoUpload(e)}
                    className="hidden"
                  />
                </label>
                <div className="flex items-center gap-1.5">
                  {AVATAR_PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setAvatarUrl(`preset:${c}`)}
                      className={`w-5 h-5 rounded-full border-2 ${
                        avatarUrl === `preset:${c}`
                          ? 'border-slate-900 dark:border-white scale-110'
                          : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Unique Username
              </label>
              <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] px-3">
                <span className="text-xs font-mono text-slate-400 mr-1">@</span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                  className="w-full py-2 bg-transparent text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          {walletAccount && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] p-3 space-y-2 text-[11px] font-mono">
              <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-200 dark:border-slate-800 font-sans">
                <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  1:1 Username-to-Wallet Lock Active
                </span>
                <span className="text-slate-500">@{walletAccount.username}</span>
              </div>
              {walletAccount.cscAddress && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">CSC-1:</span>
                  <button
                    type="button"
                    onClick={() => copyValue(walletAccount.cscAddress, 'csc')}
                    className="inline-flex items-center gap-1 text-slate-800 dark:text-slate-200 hover:text-blue-500"
                  >
                    {truncateAddress(walletAccount.cscAddress, 10, 8)}
                    {copiedKey === 'csc' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              )}
              {walletAccount.evmAddress && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">EVM:</span>
                  <button
                    type="button"
                    onClick={() => copyValue(walletAccount.evmAddress, 'evm')}
                    className="inline-flex items-center gap-1 text-slate-800 dark:text-slate-200 hover:text-blue-500"
                  >
                    {truncateAddress(walletAccount.evmAddress, 10, 8)}
                    {copiedKey === 'evm' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              )}
              {walletAccount.solanaAddress && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Solana:</span>
                  <button
                    type="button"
                    onClick={() => copyValue(walletAccount.solanaAddress, 'sol')}
                    className="inline-flex items-center gap-1 text-slate-800 dark:text-slate-200 hover:text-blue-500"
                  >
                    {truncateAddress(walletAccount.solanaAddress, 10, 8)}
                    {copiedKey === 'sol' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={busy === 'save'}
            className="w-full py-2 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2"
          >
            {busy === 'save' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save Profile & Photo
          </button>
        </form>

        {/* Encrypted Seed Vault & Lock Section */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-amber-500" />
              Encrypted Seed Vault
            </div>
            {unlockedVault ? (
              <button
                type="button"
                onClick={lockLocalVault}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[11px] font-semibold"
              >
                <Lock className="w-3 h-3" /> Lock Keys Now
              </button>
            ) : hasLocalVault ? (
              <span className="text-[11px] text-slate-500 inline-flex items-center gap-1">
                <Unlock className="w-3 h-3" /> Locked (enter password to reveal)
              </span>
            ) : (
              <span className="text-[11px] text-slate-500">No local seed vault on this device</span>
            )}
          </div>

          {hasLocalVault && !revealedMnemonic && (
            <form onSubmit={handleRevealSeed} className="flex gap-2">
              <input
                type="password"
                required
                value={vaultPasswordInput}
                onChange={(e) => setVaultPasswordInput(e.target.value)}
                placeholder="Enter password to reveal 12-word seed phrase"
                className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs text-slate-900 dark:text-slate-100"
              />
              <button
                type="submit"
                disabled={busy === 'reveal'}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold whitespace-nowrap"
              >
                <Eye className="w-3.5 h-3.5" />
                Reveal
              </button>
            </form>
          )}

          {revealedMnemonic && (
            <div className="p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 space-y-2">
              <div className="font-mono text-xs text-slate-900 dark:text-slate-100 select-all">
                {revealedMnemonic}
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <button
                  type="button"
                  onClick={() => copyValue(revealedMnemonic, 'seed')}
                  className="font-semibold text-amber-700 dark:text-amber-300 inline-flex items-center gap-1"
                >
                  {copiedKey === 'seed' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  Copy Seed
                </button>
                <button
                  type="button"
                  onClick={() => setRevealedMnemonic(null)}
                  className="text-slate-600 dark:text-slate-300 inline-flex items-center gap-1"
                >
                  <EyeOff className="w-3 h-3" /> Hide
                </button>
              </div>
            </div>
          )}

          {/* Change / Set Password */}
          <form onSubmit={handleChangePassword} className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
            {walletAccount?.hasPassword && (
              <input
                type="password"
                required
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                placeholder="Current password"
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs text-slate-900 dark:text-slate-100"
              />
            )}
            <input
              type="password"
              required
              minLength={8}
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder={walletAccount?.hasPassword ? 'New password (8+)' : 'Set vault password (8+)'}
              className={`px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-xs text-slate-900 dark:text-slate-100 ${
                walletAccount?.hasPassword ? '' : 'sm:col-span-2'
              }`}
            />
            <button
              type="submit"
              disabled={busy === 'password'}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold whitespace-nowrap"
            >
              {walletAccount?.hasPassword ? 'Update Password' : 'Set Password'}
            </button>
          </form>
        </div>

        {/* Optional Google Account Linking */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5 text-blue-500" />
                Google Account Login (Optional)
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {googleEmail
                  ? `Connected to ${googleEmail}`
                  : 'Connect Google anytime as a backup sign-in method for this same wallet.'}
              </p>
            </div>
            {googleEmail ? (
              walletAccount?.hasPassword && (
                <button
                  type="button"
                  onClick={() => void handleUnlinkGoogle()}
                  disabled={busy === 'google'}
                  className="px-3 py-1.5 rounded-lg border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 text-xs font-medium whitespace-nowrap shrink-0"
                >
                  Disconnect
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={() => void handleLinkGoogle()}
                disabled={busy === 'google'}
                className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold whitespace-nowrap shrink-0"
              >
                {busy === 'google' ? 'Connecting...' : 'Connect Google'}
              </button>
            )}
          </div>
        </div>

        {/* Footer Sign Out */}
        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            End-to-end AES-256-GCM vault
          </span>
          <button
            type="button"
            onClick={() => {
              void signOutUser();
              setShowProfileModal(false);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
