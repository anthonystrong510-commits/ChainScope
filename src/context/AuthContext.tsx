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
import { auth, getAuthHeaders, googleProvider } from '../firebase';
import type {
  PerpPosition,
  PlatformEconomics,
  RewardClaim,
  UserHolding,
  UserProfile,
} from '../types/launchpad';
import { DEFAULT_PLATFORM_ECONOMICS } from '../utils/bondingCurve';

export const BOOTSTRAPPED_ADMIN_EMAIL = 'anthonystrong510@gmail.com';

interface AccountStateResponse {
  profile: UserProfile | null;
  holdings: UserHolding[];
  perpPositions: PerpPosition[];
  rewardClaims: RewardClaim[];
  economics: PlatformEconomics;
  isAdmin: boolean;
}

interface AuthContextValue {
  user: User | null;
  authReady: boolean;
  profile: UserProfile | null;
  holdings: UserHolding[];
  perpPositions: PerpPosition[];
  rewardClaims: RewardClaim[];
  economics: PlatformEconomics;
  loadingProfile: boolean;
  isAdmin: boolean;
  adminChecking: boolean;
  authError: string | null;
  dbError: string | null;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [holdings, setHoldings] = useState<UserHolding[]>([]);
  const [perpPositions, setPerpPositions] = useState<PerpPosition[]>([]);
  const [rewardClaims, setRewardClaims] = useState<RewardClaim[]>([]);
  const [economics, setEconomics] = useState<PlatformEconomics>(DEFAULT_PLATFORM_ECONOMICS);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecking, setAdminChecking] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);

  const applyAccountState = useCallback(
    (data: AccountStateResponse, isBootstrapped: boolean) => {
      if (data.profile) setProfile(data.profile);
      setHoldings(Array.isArray(data.holdings) ? data.holdings : []);
      setPerpPositions(Array.isArray(data.perpPositions) ? data.perpPositions : []);
      setRewardClaims(Array.isArray(data.rewardClaims) ? data.rewardClaims : []);
      setEconomics(data.economics || DEFAULT_PLATFORM_ECONOMICS);
      setIsAdmin(Boolean(data.isAdmin) || isBootstrapped);
      setDbError(null);
    },
    []
  );

  const refreshAccount = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    const isBootstrapped =
      Boolean(currentUser.emailVerified) &&
      currentUser.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL;
    try {
      const state = await callAccountApi<AccountStateResponse>('/api/db/account/state');
      if (!state.profile) {
        await callAccountApi<{ profile: UserProfile }>('/api/db/session/init', {
          method: 'POST',
        });
        const fresh = await callAccountApi<AccountStateResponse>('/api/db/account/state');
        applyAccountState(fresh, isBootstrapped);
      } else {
        applyAccountState(state, isBootstrapped);
      }
    } catch (err) {
      setDbError(err instanceof Error ? err.message : 'Unable to sync Supabase account state');
    }
  }, [applyAccountState]);

  useEffect(() => {
    // Complete any mobile / wallet-browser redirect login flow
    void getRedirectResult(auth).catch((err) => {
      if (err && typeof err === 'object' && 'message' in err) {
        setAuthError(String((err as { message: string }).message));
      }
    });

    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);

      if (!firebaseUser) {
        setProfile(null);
        setHoldings([]);
        setPerpPositions([]);
        setRewardClaims([]);
        setEconomics(DEFAULT_PLATFORM_ECONOMICS);
        setIsAdmin(false);
        setAdminChecking(false);
        setLoadingProfile(false);
        setDbError(null);
        return;
      }

      setLoadingProfile(true);
      setAdminChecking(true);
      setDbError(null);

      const isBootstrapped =
        Boolean(firebaseUser.emailVerified) &&
        firebaseUser.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL;

      try {
        await callAccountApi<{
          profile: UserProfile;
          isAdmin: boolean;
          economics: PlatformEconomics;
        }>('/api/db/session/init', { method: 'POST' });

        const state = await callAccountApi<AccountStateResponse>('/api/db/account/state');
        applyAccountState(state, isBootstrapped);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to initialize Supabase account';
        setDbError(msg);
        setIsAdmin(isBootstrapped);
      } finally {
        setLoadingProfile(false);
        setAdminChecking(false);
      }
    });

    return () => unsub();
  }, [applyAccountState]);

  // Periodic Supabase refresh while authenticated
  useEffect(() => {
    if (!authReady || !user) return;
    const timer = window.setInterval(() => {
      void refreshAccount();
    }, 6000);
    return () => window.clearInterval(timer);
  }, [authReady, user, refreshAccount]);

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
    await signOut(auth);
  }, []);

  const updateAccountProfile = useCallback(
    async (updates: { handle: string; displayName: string; linkedWallet: string }) => {
      if (!auth.currentUser) throw new Error('You must be signed in.');
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
    if (!auth.currentUser) throw new Error('Account not ready.');
    const res = await callAccountApi<{ profile: UserProfile }>('/api/db/account/faucet', {
      method: 'POST',
    });
    setProfile(res.profile);
    setDbError(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        authReady,
        profile,
        holdings,
        perpPositions,
        rewardClaims,
        economics,
        loadingProfile,
        isAdmin,
        adminChecking,
        authError,
        dbError,
        signInWithGoogle,
        signInWithBrowserRedirect,
        signOutUser,
        refreshAccount,
        updateAccountProfile,
        requestFaucetSol,
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
