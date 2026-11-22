import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const WALLET_SESSION_STORAGE_KEY = 'chainscope_wallet_session_v1';

export function getStoredWalletToken(): string | null {
  try {
    const raw = localStorage.getItem(WALLET_SESSION_STORAGE_KEY);
    return raw && raw.startsWith('cs1.') ? raw : null;
  } catch {
    return null;
  }
}

export function setStoredWalletToken(token: string | null) {
  try {
    if (token) {
      localStorage.setItem(WALLET_SESSION_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(WALLET_SESSION_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function hasActiveAuthSession(): boolean {
  return Boolean(getStoredWalletToken() || auth.currentUser);
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const walletToken = getStoredWalletToken();
  if (walletToken) {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${walletToken}`,
    };
  }
  const user = auth.currentUser;
  if (!user) {
    throw new Error('You must be signed in.');
  }
  const token = await user.getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function getLegacyFirestoreDb() {
  const { getFirestore } = await import('firebase/firestore');
  return getFirestore(app, firebaseConfig.firestoreDatabaseId);
}
