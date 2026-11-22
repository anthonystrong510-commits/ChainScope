export interface DecryptedWalletVaultPayload {
  uid: string;
  username: string;
  mnemonic: string;
  evmAddress: string;
  evmPrivateKey: string;
  solanaAddress: string;
  solanaPrivateKey: string;
  cscAddress: string;
  createdAt: number;
}

export interface EncryptedWalletVaultRecord {
  uid: string;
  username: string;
  usernameLower: string;
  evmAddress: string;
  solanaAddress: string;
  cscAddress: string;
  saltB64: string;
  ivB64: string;
  cipherB64: string;
  iterations: number;
  updatedAt: number;
}

const VAULTS_STORAGE_KEY = 'chainscope_encrypted_vaults_v1';
const PBKDF2_ITERATIONS = 120_000;

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesGcmKey(
  password: string,
  salt: Uint8Array,
  iterations = PBKDF2_ITERATIONS
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function loadEncryptedVaultMap(): Record<string, EncryptedWalletVaultRecord> {
  try {
    const raw = localStorage.getItem(VAULTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, EncryptedWalletVaultRecord>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveEncryptedVaultMap(map: Record<string, EncryptedWalletVaultRecord>) {
  try {
    localStorage.setItem(VAULTS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage quota errors
  }
}

export function findEncryptedVault(uidOrUsername: string): EncryptedWalletVaultRecord | null {
  const key = uidOrUsername.trim().toLowerCase().replace(/^@/, '');
  if (!key) return null;
  const map = loadEncryptedVaultMap();
  if (map[uidOrUsername]) return map[uidOrUsername];
  return (
    Object.values(map).find(
      (v) => v.uid.toLowerCase() === key || v.usernameLower === key
    ) || null
  );
}

export function listLocalVaultUsers(): Array<Pick<EncryptedWalletVaultRecord, 'uid' | 'username' | 'evmAddress' | 'cscAddress'>> {
  return Object.values(loadEncryptedVaultMap())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((v) => ({
      uid: v.uid,
      username: v.username,
      evmAddress: v.evmAddress,
      cscAddress: v.cscAddress,
    }));
}

export async function encryptAndSaveWalletVault(
  payload: DecryptedWalletVaultPayload,
  password: string
): Promise<EncryptedWalletVaultRecord> {
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(salt);
  crypto.getRandomValues(iv);

  const aesKey = await deriveAesGcmKey(password, salt, PBKDF2_ITERATIONS);
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const encryptedBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    aesKey,
    encoded
  );

  const record: EncryptedWalletVaultRecord = {
    uid: payload.uid,
    username: payload.username,
    usernameLower: payload.username.trim().toLowerCase(),
    evmAddress: payload.evmAddress,
    solanaAddress: payload.solanaAddress,
    cscAddress: payload.cscAddress,
    saltB64: bytesToBase64(salt),
    ivB64: bytesToBase64(iv),
    cipherB64: bytesToBase64(new Uint8Array(encryptedBuf)),
    iterations: PBKDF2_ITERATIONS,
    updatedAt: Date.now(),
  };

  const map = loadEncryptedVaultMap();
  map[payload.uid] = record;
  saveEncryptedVaultMap(map);
  return record;
}

export async function decryptWalletVault(
  uidOrUsername: string,
  password: string
): Promise<DecryptedWalletVaultPayload> {
  const record = findEncryptedVault(uidOrUsername);
  if (!record) {
    throw new Error('No encrypted seed vault found on this device for this account.');
  }
  const salt = base64ToBytes(record.saltB64);
  const iv = base64ToBytes(record.ivB64);
  const cipher = base64ToBytes(record.cipherB64);
  const aesKey = await deriveAesGcmKey(password, salt, record.iterations || PBKDF2_ITERATIONS);

  try {
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      aesKey,
      cipher as unknown as BufferSource
    );
    const decoded = new TextDecoder().decode(plainBuf);
    return JSON.parse(decoded) as DecryptedWalletVaultPayload;
  } catch {
    throw new Error('Incorrect password. Unable to decrypt seed vault.');
  }
}

export async function reencryptWalletVaultPassword(
  uid: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const decrypted = await decryptWalletVault(uid, currentPassword);
  await encryptAndSaveWalletVault(decrypted, newPassword);
}

export async function compressAvatarImageFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Select a valid image file (PNG, JPG, WebP).');
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error('Image must be under 8 MB.');
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Invalid image file.'));
    el.src = dataUrl;
  });

  const size = 160;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable.');

  const minSide = Math.min(img.width, img.height);
  const sx = Math.max(0, (img.width - minSide) / 2);
  const sy = Math.max(0, (img.height - minSide) / 2);
  ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);

  const webp = canvas.toDataURL('image/webp', 0.84);
  if (webp.startsWith('data:image/webp') && webp.length < 75_000) {
    return webp;
  }
  return canvas.toDataURL('image/jpeg', 0.82);
}

export const AVATAR_PRESET_COLORS = [
  '#2563EB',
  '#059669',
  '#7C3AED',
  '#D97706',
  '#DC2626',
  '#0891B2',
];
