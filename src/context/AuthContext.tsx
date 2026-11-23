import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import {
  auth,
  getAuthHeaders,
  getStoredWalletToken,
  googleProvider,
  hasActiveAuthSession,
  setStoredWalletToken,
} from '../firebase';
import type {
  PerpPosition,
  PlatformEconomics,
  RewardClaim,
  UserHolding,
  UserProfile,
} from '../types/launchpad';
import { DEFAULT_PLATFORM_ECONOMICS } from '../utils/bondingCurve';
import {
  decryptWalletVault,
  encryptAndSaveWalletVault,
  findEncryptedVault,
  reencryptWalletVaultPassword,
  type DecryptedWalletVaultPayload,
} from '../utils/walletVault';

export const BOOTSTRAPPED_ADMIN_EMAIL = 'anthonystrong510@gmail.com';
const ONBOARDING_DISMISSED_KEY = 'chainscope_onboarding_dismissed_v1';

export interface ChainScopeAuthUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  photoURL: string | null;
}

export interface WalletAccountInfo {
  uid: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  evmAddress: string;
  solanaAddress: string;
  cscAddress: string;
  linkedGoogleEmail: string;
  hasPassword: boolean;
  walletLocked?: boolean;
  createdAt: number;
}

interface AccountStateResponse {
  profile: UserProfile | null;
  holdings: UserHolding[];
  perpPositions: PerpPosition[];
  rewardClaims: RewardClaim[];
  economics: PlatformEconomics;
  isAdmin: boolean;
}

interface AuthContextValue {
  user: ChainScopeAuthUser | null;
  authReady: boolean;
  profile: UserProfile | null;
  walletAccount: WalletAccountInfo | null;
  unlockedVault: DecryptedWalletVaultPayload | null;
  hasLocalVault: boolean;
  holdings: UserHolding[];
  perpPositions: PerpPosition[];
  rewardClaims: RewardClaim[];
  economics: PlatformEconomics;
  loadingProfile: boolean;
  isAdmin: boolean;
  adminChecking: boolean;
  authError: string | null;
  dbError: string | null;
  showOnboardingModal: boolean;
  setShowOnboardingModal: (open: boolean) => void;
  dismissOnboardingModal: () => void;
  showProfileModal: boolean;
  setShowProfileModal: (open: boolean) => void;
  signInWithGoogle: () => Promise<void>;
  signInWithBrowserRedirect: () => Promise<void>;
  signOutUser: () => Promise<void>;
  refreshAccount: () => Promise<void>;
  updateAccountProfile: (updates: {
    handle: string;
    displayName: string;
    linkedWallet: string;
  }) => Promise<void>;
  requestFaucetSol: () => Promise<void>;
  registerWalletAccount: (params: {
    username: string;
    password: string;
    displayName?: string;
    avatarUrl?: string;
    mnemonic: string;
    evmAddress: string;
    evmPrivateKey: string;
    solanaAddress: string;
    solanaPrivateKey: string;
    cscAddress: string;
  }) => Promise<WalletAccountInfo>;
  loginWalletAccount: (username: string, password: string) => Promise<WalletAccountInfo>;
  unlockLocalVault: (password: string) => Promise<DecryptedWalletVaultPayload>;
  lockLocalVault: () => void;
  updateWalletProfileSettings: (updates: {
    displayName?: string;
    avatarUrl?: string;
    username?: string;
    evmAddress?: string;
    solanaAddress?: string;
    cscAddress?: string;
  }) => Promise<WalletAccountInfo>;
  linkGoogleAccount: () => Promise<WalletAccountInfo>;
  unlinkGoogleAccount: () => Promise<WalletAccountInfo>;
  changeWalletPassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function callAccountApi<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(url, {
    ...init,
    headers: { ...headers, ...(init?.headers || {}) },
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`Database error (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(
      typeof json.error === 'string' ? json.error : `Database request failed (${res.status})`
    );
  }
  return json as T;
}

function toShellUser(
  fbUser: User | null,
  walletAcc: WalletAccountInfo | null,
  profile: UserProfile | null
): ChainScopeAuthUser | null {
  if (walletAcc) {
    return {
      uid: walletAcc.uid,
      email: walletAcc.linkedGoogleEmail || fbUser?.email || null,
      emailVerified: Boolean(walletAcc.linkedGoogleEmail || fbUser?.emailVerified),
      displayName: walletAcc.displayName || `@${walletAcc.username}`,
      photoURL: walletAcc.avatarUrl || fbUser?.photoURL || null,
    };
  }
  if (fbUser) {
    return {
      uid: fbUser.uid,
      email: fbUser.email,
      emailVerified: fbUser.emailVerified,
      displayName: profile?.displayName || fbUser.displayName,
      photoURL: fbUser.photoURL,
    };
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [walletTokenVersion, setWalletTokenVersion] = useState(0);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [walletAccount, setWalletAccount] = useState<WalletAccountInfo | null>(null);
  const [unlockedVault, setUnlockedVault] = useState<DecryptedWalletVaultPayload | null>(null);
  const [holdings, setHoldings] = useState<UserHolding[]>([]);
  const [perpPositions, setPerpPositions] = useState<PerpPosition[]>([]);
  const [rewardClaims, setRewardClaims] = useState<RewardClaim[]>([]);
  const [economics, setEconomics] = useState<PlatformEconomics>(DEFAULT_PLATFORM_ECONOMICS);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecking, setAdminChecking] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);

  const applyAccountState = useCallback(
    (
      data: AccountStateResponse,
      wAcc: WalletAccountInfo | null,
      fbUser: User | null
    ) => {
      if (data.profile) setProfile(data.profile);
      setWalletAccount(wAcc);
      setHoldings(Array.isArray(data.holdings) ? data.holdings : []);
      setPerpPositions(Array.isArray(data.perpPositions) ? data.perpPositions : []);
      setRewardClaims(Array.isArray(data.rewardClaims) ? data.rewardClaims : []);
      setEconomics(data.economics || DEFAULT_PLATFORM_ECONOMICS);
      const emailToCheck = (wAcc?.linkedGoogleEmail || fbUser?.email || '').toLowerCase();
      const verified = Boolean(wAcc?.linkedGoogleEmail || fbUser?.emailVerified);
      const isBootstrapped = verified && emailToCheck === BOOTSTRAPPED_ADMIN_EMAIL;
      setIsAdmin(Boolean(data.isAdmin) || isBootstrapped);
      setDbError(null);
    },
    []
  );

  const refreshAccount = useCallback(async () => {
    if (!hasActiveAuthSession()) return;
    const fbUser = auth.currentUser;
    try {
      const [state, meRes] = await Promise.all([
        callAccountApi<AccountStateResponse>('/api/db/account/state'),
        callAccountApi<{ walletAccount: WalletAccountInfo | null }>('/api/db/wallet-auth/me').catch(
          () => ({ walletAccount: null })
        ),
      ]);
      if (!state.profile) {
        await callAccountApi<{ profile: UserProfile }>('/api/db/session/init', {
          method: 'POST',
        });
        const fresh = await callAccountApi<AccountStateResponse>('/api/db/account/state');
        applyAccountState(fresh, meRes.walletAccount, fbUser);
      } else {
        applyAccountState(state, meRes.walletAccount, fbUser);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to sync Supabase account state';
      if (msg.toLowerCase().includes('session expired')) {
        setStoredWalletToken(null);
        setWalletTokenVersion((v) => v + 1);
      }
      setDbError(msg);
    }
  }, [applyAccountState]);

  useEffect(() => {
    void getRedirectResult(auth).catch((err) => {
      if (err && typeof err === 'object' && 'message' in err) {
        setAuthError(String((err as { message: string }).message));
      }
    });

    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      setAuthReady(true);

      const hasWalletToken = Boolean(getStoredWalletToken());
      if (!fbUser && !hasWalletToken) {
        setProfile(null);
        setWalletAccount(null);
        setHoldings([]);
        setPerpPositions([]);
        setRewardClaims([]);
        setEconomics(DEFAULT_PLATFORM_ECONOMICS);
        setIsAdmin(false);
        setAdminChecking(false);
        setLoadingProfile(false);
        setDbError(null);

        try {
          const dismissed = sessionStorage.getItem(ONBOARDING_DISMISSED_KEY);
          if (!dismissed) {
            setShowOnboardingModal(true);
          }
        } catch {
          setShowOnboardingModal(true);
        }
        return;
      }

      setLoadingProfile(true);
      setAdminChecking(true);
      setDbError(null);

      try {
        await callAccountApi<{
          profile: UserProfile;
          isAdmin: boolean;
          economics: PlatformEconomics;
        }>('/api/db/session/init', { method: 'POST' });

        const [state, meRes] = await Promise.all([
          callAccountApi<AccountStateResponse>('/api/db/account/state'),
          callAccountApi<{ walletAccount: WalletAccountInfo | null }>(
            '/api/db/wallet-auth/me'
          ).catch(() => ({ walletAccount: null })),
        ]);
        applyAccountState(state, meRes.walletAccount, fbUser);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to initialize Supabase account';
        if (msg.toLowerCase().includes('session expired')) {
          setStoredWalletToken(null);
        }
        setDbError(msg);
      } finally {
        setLoadingProfile(false);
        setAdminChecking(false);
      }
    });

    return () => unsub();
  }, [applyAccountState, walletTokenVersion]);

  // Periodic Supabase refresh while authenticated
  useEffect(() => {
    if (!authReady || !hasActiveAuthSession()) return;
    const timer = window.setInterval(() => {
      void refreshAccount();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [authReady, refreshAccount, firebaseUser, walletTokenVersion]);

  const dismissOnboardingModal = useCallback(() => {
    setShowOnboardingModal(false);
    try {
      sessionStorage.setItem(ONBOARDING_DISMISSED_KEY, '1');
    } catch {
      // ignore
    }
  }, []);

  const signInWithBrowserRedirect = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithRedirect(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Browser sign-in redirect failed';
      setAuthError(msg);
      throw err;
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      if (cred.user) {
        setShowOnboardingModal(false);
        await refreshAccount();
      }
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment'
      ) {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Google sign-in failed';
      setAuthError(msg);
      throw err;
    }
  }, [refreshAccount]);

  const signOutUser = useCallback(async () => {
    setStoredWalletToken(null);
    setUnlockedVault(null);
    setWalletAccount(null);
    setProfile(null);
    setWalletTokenVersion((v) => v + 1);
    if (auth.currentUser) {
      await signOut(auth);
    }
  }, []);

  const updateAccountProfile = useCallback(
    async (updates: { handle: string; displayName: string; linkedWallet: string }) => {
      if (!hasActiveAuthSession()) throw new Error('You must be signed in.');
      const res = await callAccountApi<{ profile: UserProfile }>('/api/db/account/profile', {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      setProfile(res.profile);
      setDbError(null);
    },
    []
  );

  const requestFaucetSol = useCallback(async () => {
    if (!hasActiveAuthSession()) throw new Error('Account not ready.');
    const res = await callAccountApi<{ profile: UserProfile }>('/api/db/account/faucet', {
      method: 'POST',
    });
    setProfile(res.profile);
    setDbError(null);
  }, []);

  const registerWalletAccount = useCallback(
    async (params: {
      username: string;
      password: string;
      displayName?: string;
      avatarUrl?: string;
      mnemonic: string;
      evmAddress: string;
      evmPrivateKey: string;
      solanaAddress: string;
      solanaPrivateKey: string;
      cscAddress: string;
    }) => {
      const res = await fetch('/api/db/wallet-auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: params.username,
          password: params.password,
          displayName: params.displayName || params.username,
          avatarUrl: params.avatarUrl || '',
          evmAddress: params.evmAddress,
          solanaAddress: params.solanaAddress,
          cscAddress: params.cscAddress,
        }),
      });
      const json = (await res.json()) as {
        token?: string;
        walletAccount?: WalletAccountInfo;
        error?: string;
      };
      if (!res.ok || !json.token || !json.walletAccount) {
        throw new Error(json.error || 'Wallet registration failed.');
      }

      const payload: DecryptedWalletVaultPayload = {
        uid: json.walletAccount.uid,
        username: json.walletAccount.username,
        mnemonic: params.mnemonic,
        evmAddress: params.evmAddress,
        evmPrivateKey: params.evmPrivateKey,
        solanaAddress: params.solanaAddress,
        solanaPrivateKey: params.solanaPrivateKey,
        cscAddress: params.cscAddress,
        createdAt: Date.now(),
      };
      await encryptAndSaveWalletVault(payload, params.password);

      setStoredWalletToken(json.token);
      setUnlockedVault(payload);
      setWalletAccount(json.walletAccount);
      setWalletTokenVersion((v) => v + 1);
      setShowOnboardingModal(false);

      // Provision matching CSC-1 Primary Wallet & notify App shell to attach @username multi-chain wallet
      await callAccountApi('/api/db/csc/overview', { method: 'GET' }).catch(() => null);
      await refreshAccount();

      window.dispatchEvent(
        new CustomEvent('chainscope:wallet-provisioned', {
          detail: {
            username: json.walletAccount.username,
            evmAddress: json.walletAccount.evmAddress,
            solanaAddress: json.walletAccount.solanaAddress,
          },
        })
      );

      return json.walletAccount;
    },
    [refreshAccount]
  );

  const loginWalletAccount = useCallback(
    async (username: string, password: string) => {
      const res = await fetch('/api/db/wallet-auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const json = (await res.json()) as {
        token?: string;
        walletAccount?: WalletAccountInfo;
        error?: string;
      };
      if (!res.ok || !json.token || !json.walletAccount) {
        throw new Error(json.error || 'Invalid username or password.');
      }

      // Decrypt local AES-GCM seed vault if present on this device
      const localVault = findEncryptedVault(json.walletAccount.uid) || findEncryptedVault(username);
      if (localVault) {
        try {
          const decrypted = await decryptWalletVault(localVault.uid, password);
          setUnlockedVault(decrypted);
        } catch {
          // Allow server login even if local device vault differs
        }
      }

      setStoredWalletToken(json.token);
      setWalletAccount(json.walletAccount);
      setWalletTokenVersion((v) => v + 1);
      setShowOnboardingModal(false);

      await refreshAccount();
      window.dispatchEvent(
        new CustomEvent('chainscope:wallet-provisioned', {
          detail: {
            username: json.walletAccount.username,
            evmAddress: json.walletAccount.evmAddress,
            solanaAddress: json.walletAccount.solanaAddress,
          },
        })
      );

      return json.walletAccount;
    },
    [refreshAccount]
  );

  const unlockLocalVault = useCallback(
    async (password: string) => {
      const key = walletAccount?.uid || walletAccount?.username || profile?.handle || '';
      if (!key) throw new Error('No wallet selected to unlock.');
      const decrypted = await decryptWalletVault(key, password);
      setUnlockedVault(decrypted);
      return decrypted;
    },
    [walletAccount, profile]
  );

  const lockLocalVault = useCallback(() => {
    setUnlockedVault(null);
  }, []);

  const updateWalletProfileSettings = useCallback(
    async (updates: {
      displayName?: string;
      avatarUrl?: string;
      username?: string;
      evmAddress?: string;
      solanaAddress?: string;
      cscAddress?: string;
    }) => {
      const res = await callAccountApi<{ walletAccount: WalletAccountInfo }>(
        '/api/db/wallet-auth/profile',
        {
          method: 'PATCH',
          body: JSON.stringify(updates),
        }
      );
      setWalletAccount(res.walletAccount);
      await refreshAccount();
      return res.walletAccount;
    },
    [refreshAccount]
  );

  const linkGoogleAccount = useCallback(async () => {
    if (!hasActiveAuthSession()) {
      throw new Error('Create or unlock a wallet before linking Google.');
    }
    const cred = await signInWithPopup(auth, googleProvider);
    const googleIdToken = await cred.user.getIdToken();
    const res = await callAccountApi<{ walletAccount: WalletAccountInfo }>(
      '/api/db/wallet-auth/link-google',
      {
        method: 'POST',
        body: JSON.stringify({ googleIdToken }),
      }
    );
    setWalletAccount(res.walletAccount);
    await refreshAccount();
    return res.walletAccount;
  }, [refreshAccount]);

  const unlinkGoogleAccount = useCallback(async () => {
    const res = await callAccountApi<{ walletAccount: WalletAccountInfo }>(
      '/api/db/wallet-auth/unlink-google',
      { method: 'POST' }
    );
    setWalletAccount(res.walletAccount);
    await refreshAccount();
    return res.walletAccount;
  }, [refreshAccount]);

  const changeWalletPassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await callAccountApi<{ ok: boolean }>('/api/db/wallet-auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const vaultTarget = walletAccount?.uid || walletAccount?.username;
      if (vaultTarget && findEncryptedVault(vaultTarget) && currentPassword) {
        await reencryptWalletVaultPassword(vaultTarget, currentPassword, newPassword);
      }
    },
    [walletAccount]
  );

  const user = toShellUser(firebaseUser, walletAccount, profile);
  const hasLocalVault = Boolean(
    (walletAccount?.uid && findEncryptedVault(walletAccount.uid)) ||
      (walletAccount?.username && findEncryptedVault(walletAccount.username))
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        authReady,
        profile,
        walletAccount,
        unlockedVault,
        hasLocalVault,
        holdings,
        perpPositions,
        rewardClaims,
        economics,
        loadingProfile,
        isAdmin,
        adminChecking,
        authError,
        dbError,
        showOnboardingModal,
        setShowOnboardingModal,
        dismissOnboardingModal,
        showProfileModal,
        setShowProfileModal,
        signInWithGoogle,
        signInWithBrowserRedirect,
        signOutUser,
        refreshAccount,
        updateAccountProfile,
        requestFaucetSol,
        registerWalletAccount,
        loginWalletAccount,
        unlockLocalVault,
        lockLocalVault,
        updateWalletProfileSettings,
        linkGoogleAccount,
        unlinkGoogleAccount,
        changeWalletPassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
