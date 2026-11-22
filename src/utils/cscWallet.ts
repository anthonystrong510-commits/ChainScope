import { ethers } from 'ethers';
import bs58 from 'bs58';
import {
  deriveMultiChainFromMnemonic,
  generateRandomMnemonic,
  parsePrivateKeyUniversal,
} from './crypto';
import type { CscLocalWalletSecret } from '../types/csc';

const LOCAL_CSC_VAULT_KEY = 'chainscope_csc_local_vault_v1';

export function isValidCscAddress(addr: string): boolean {
  const clean = addr.trim();
  if (/^CSC1[1-9A-HJ-NP-Za-km-z]{30,48}$/.test(clean)) {
    return true;
  }
  return ethers.isAddress(clean);
}

export function deriveCscAddressFromEvmAddress(evmAddress: string): string {
  const checksum = ethers.getAddress(evmAddress);
  const hashHex = ethers.keccak256(ethers.toUtf8Bytes(`CSC-1:${checksum.toLowerCase()}`));
  const bytes = ethers.getBytes(hashHex);
  return `CSC1${bs58.encode(bytes)}`;
}

export async function createNewCscWalletMaterial(
  label = 'ChainScope Vault',
  accountIndex = 0
): Promise<CscLocalWalletSecret> {
  const mnemonic = generateRandomMnemonic(12);
  const derived = await deriveMultiChainFromMnemonic(mnemonic, accountIndex);
  return {
    address: `CSC1${derived.solanaAddress}`,
    evmAddress: derived.evmAddress,
    label: label.trim() || 'ChainScope Vault',
    mnemonic,
    evmPrivateKey: derived.evmPrivateKey,
    solanaPrivateKey: derived.solanaPrivateKey,
    createdAt: Date.now(),
  };
}

export async function importCscWalletMaterial(
  secretInput: string,
  label = 'Imported CSC Wallet'
): Promise<CscLocalWalletSecret> {
  const clean = secretInput.trim();
  if (!clean) {
    throw new Error('Enter a 12/24-word recovery phrase or private key.');
  }
  const words = clean.toLowerCase().replace(/\s+/g, ' ').split(' ');
  if (words.length === 12 || words.length === 24) {
    const derived = await deriveMultiChainFromMnemonic(words.join(' '), 0);
    return {
      address: `CSC1${derived.solanaAddress}`,
      evmAddress: derived.evmAddress,
      label: label.trim() || 'Imported CSC Wallet',
      mnemonic: words.join(' '),
      evmPrivateKey: derived.evmPrivateKey,
      solanaPrivateKey: derived.solanaPrivateKey,
      createdAt: Date.now(),
    };
  }

  const parsed = parsePrivateKeyUniversal(clean);
  if (parsed.kind === 'solana') {
    return {
      address: `CSC1${parsed.address}`,
      evmAddress: ethers.ZeroAddress,
      label: label.trim() || 'Imported CSC Wallet',
      solanaPrivateKey: parsed.normalizedKey,
      createdAt: Date.now(),
    };
  }

  return {
    address: deriveCscAddressFromEvmAddress(parsed.address),
    evmAddress: parsed.address,
    label: label.trim() || 'Imported CSC Wallet',
    evmPrivateKey: parsed.normalizedKey,
    createdAt: Date.now(),
  };
}

export function loadLocalCscSecrets(uid?: string): Record<string, CscLocalWalletSecret> {
  try {
    const key = uid ? `${LOCAL_CSC_VAULT_KEY}_${uid}` : LOCAL_CSC_VAULT_KEY;
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, CscLocalWalletSecret>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveLocalCscSecret(secret: CscLocalWalletSecret, uid?: string) {
  try {
    const key = uid ? `${LOCAL_CSC_VAULT_KEY}_${uid}` : LOCAL_CSC_VAULT_KEY;
    const existing = loadLocalCscSecrets(uid);
    existing[secret.address] = secret;
    localStorage.setItem(key, JSON.stringify(existing));
  } catch {
    // ignore storage quota errors
  }
}
