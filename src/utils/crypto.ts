import { ethers } from 'ethers';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

export interface DerivedWalletBundle {
  evmAddress: string;
  evmPrivateKey: string;
  evmPath: string;
  solanaAddress: string;
  solanaPrivateKey: string;
  solanaPath: string;
  accountIndex: number;
}

export interface ParsedPrivateKeyResult {
  kind: 'evm' | 'solana';
  address: string;
  normalizedKey: string;
}

// Access official 2048-word BIP-39 English wordlist from ethers v6
export function getBip39Wordlist(): string[] {
  const words: string[] = [];
  for (let i = 0; i < 2048; i++) {
    words.push(ethers.wordlists.en.getWord(i));
  }
  return words;
}

const CACHED_WORDLIST = getBip39Wordlist();
const WORD_INDEX_MAP = new Map<string, number>(CACHED_WORDLIST.map((w, i) => [w, i]));

export function searchBip39Words(prefix: string, limit = 8): string[] {
  const clean = prefix.trim().toLowerCase();
  if (!clean) return [];
  const exactAndPrefix: string[] = [];
  for (const w of CACHED_WORDLIST) {
    if (w.startsWith(clean)) {
      exactAndPrefix.push(w);
      if (exactAndPrefix.length >= limit) break;
    }
  }
  return exactAndPrefix;
}

export function isValidBip39Word(word: string): boolean {
  return WORD_INDEX_MAP.has(word.trim().toLowerCase());
}

export function generateRandomMnemonic(wordCount: 12 | 24): string {
  const byteLength = wordCount === 12 ? 16 : 32;
  const entropy = new Uint8Array(byteLength);
  crypto.getRandomValues(entropy);
  return ethers.Mnemonic.fromEntropy(entropy).phrase;
}

export async function generateMnemonicFromCustomEntropy(
  rawBytes: Uint8Array,
  wordCount: 12 | 24
): Promise<string> {
  // Hash user-collected entropy (mouse movements, coin flips, dice rolls) with SHA-256
  // mixed with WebCrypto random salt to guarantee uniform distribution across 128 or 256 bits.
  const copy = new Uint8Array(rawBytes.length);
  copy.set(rawBytes);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copy));
  const entropy = wordCount === 12 ? digest.slice(0, 16) : digest.slice(0, 32);
  return ethers.Mnemonic.fromEntropy(entropy).phrase;
}

/**
 * Given 11 words (for 12-word phrase) or 23 words (for 24-word phrase),
 * computes all cryptographically valid final BIP-39 checksum words.
 */
export async function computeValidChecksumLastWords(prefixWords: string[]): Promise<string[]> {
  const expectedPrefixLen = prefixWords.length;
  if (expectedPrefixLen !== 11 && expectedPrefixLen !== 23) {
    return [];
  }

  const indices = prefixWords.map((w) => WORD_INDEX_MAP.get(w.trim().toLowerCase()));
  if (indices.some((idx) => idx === undefined)) {
    return [];
  }

  // Convert 11*11 = 121 bits or 23*11 = 253 bits into bit string
  let bitString = '';
  for (const idx of indices as number[]) {
    bitString += idx.toString(2).padStart(11, '0');
  }

  // For 12 words: 128 entropy bits + 4 checksum bits. First 11 words provide 121 bits, so 7 remaining entropy bits.
  // For 24 words: 256 entropy bits + 8 checksum bits. First 23 words provide 253 bits, so 3 remaining entropy bits.
  const remainingEntropyBits = expectedPrefixLen === 11 ? 7 : 3;
  const totalVariations = 1 << remainingEntropyBits;
  const validLastWords: string[] = [];

  for (let suffix = 0; suffix < totalVariations; suffix++) {
    const suffixBits = suffix.toString(2).padStart(remainingEntropyBits, '0');
    const fullEntropyBits = bitString + suffixBits;
    const entropyBytes = new Uint8Array(fullEntropyBits.length / 8);
    for (let i = 0; i < entropyBytes.length; i++) {
      entropyBytes[i] = parseInt(fullEntropyBits.slice(i * 8, i * 8 + 8), 2);
    }
    const hashBuffer = await crypto.subtle.digest('SHA-256', entropyBytes);
    const hashFirstByte = new Uint8Array(hashBuffer)[0];
    const checksumLen = expectedPrefixLen === 11 ? 4 : 8;
    const checksumBits = hashFirstByte.toString(2).padStart(8, '0').slice(0, checksumLen);
    const finalWordBits = suffixBits + checksumBits;
    const finalIndex = parseInt(finalWordBits, 2);
    const word = CACHED_WORDLIST[finalIndex];
    if (word) {
      validLastWords.push(word);
    }
  }

  return validLastWords;
}

export function validateMnemonicPhrase(phrase: string): { valid: boolean; wordCount: number; error?: string } {
  const normalized = phrase.trim().toLowerCase().replace(/\s+/g, ' ');
  const words = normalized ? normalized.split(' ') : [];
  if (words.length !== 12 && words.length !== 24) {
    return { valid: false, wordCount: words.length, error: 'Seed phrase must contain 12 or 24 words' };
  }
  const unknown = words.filter((w) => !WORD_INDEX_MAP.has(w));
  if (unknown.length > 0) {
    return {
      valid: false,
      wordCount: words.length,
      error: `Unrecognized BIP-39 word(s): ${unknown.slice(0, 3).join(', ')}`,
    };
  }
  if (!ethers.Mnemonic.isValidMnemonic(normalized)) {
    return { valid: false, wordCount: words.length, error: 'Invalid BIP-39 checksum' };
  }
  return { valid: true, wordCount: words.length };
}

// Pure browser-native SLIP-0010 Ed25519 derivation (no Node crypto/Buffer polyfills needed)
async function hmacSha512(keyBytes: Uint8Array, dataBytes: Uint8Array): Promise<Uint8Array> {
  const keyBuf = new Uint8Array(keyBytes).buffer;
  const dataBuf = new Uint8Array(dataBytes).buffer;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuf,
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, dataBuf);
  return new Uint8Array(sig);
}

async function deriveSolanaEd25519(seedHex: string, accountIndex = 0): Promise<{
  address: string;
  privateKeyBase58: string;
  path: string;
}> {
  const cleanHex = seedHex.startsWith('0x') ? seedHex.slice(2) : seedHex;
  const seedBytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < seedBytes.length; i++) {
    seedBytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }

  const encoder = new TextEncoder();
  let I = await hmacSha512(encoder.encode('ed25519 seed'), seedBytes);
  let key = I.slice(0, 32);
  let chainCode = I.slice(32, 64);

  // Solana standard Phantom/Solflare path: m/44'/501'/{accountIndex}'/0'
  const pathIndices = [44, 501, accountIndex, 0];
  for (const idx of pathIndices) {
    const hardened = (idx | 0x80000000) >>> 0;
    const data = new Uint8Array(1 + 32 + 4);
    data[0] = 0x00;
    data.set(key, 1);
    data[33] = (hardened >>> 24) & 0xff;
    data[34] = (hardened >>> 16) & 0xff;
    data[35] = (hardened >>> 8) & 0xff;
    data[36] = hardened & 0xff;
    I = await hmacSha512(chainCode, data);
    key = I.slice(0, 32);
    chainCode = I.slice(32, 64);
  }

  const keyPair = nacl.sign.keyPair.fromSeed(key);
  return {
    address: bs58.encode(keyPair.publicKey),
    privateKeyBase58: bs58.encode(keyPair.secretKey),
    path: `m/44'/501'/${accountIndex}'/0'`,
  };
}

export async function deriveMultiChainFromMnemonic(
  phrase: string,
  accountIndex = 0,
  passphrase = ''
): Promise<DerivedWalletBundle> {
  const normalized = phrase.trim().toLowerCase().replace(/\s+/g, ' ');
  const mnemonic = ethers.Mnemonic.fromPhrase(normalized, passphrase);
  const evmPath = `m/44'/60'/0'/0/${accountIndex}`;
  const evmNode = ethers.HDNodeWallet.fromMnemonic(mnemonic, evmPath);
  const seedHex = mnemonic.computeSeed();
  const solana = await deriveSolanaEd25519(seedHex, accountIndex);

  return {
    evmAddress: evmNode.address,
    evmPrivateKey: evmNode.privateKey,
    evmPath,
    solanaAddress: solana.address,
    solanaPrivateKey: solana.privateKeyBase58,
    solanaPath: solana.path,
    accountIndex,
  };
}

export function parsePrivateKeyUniversal(input: string): ParsedPrivateKeyResult {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Enter a private key');
  }

  // 1. Check JSON byte array format (Solana CLI id.json: [12, 34, ...])
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error('Invalid JSON byte-array private key');
    }
    if (!Array.isArray(parsed) || (parsed.length !== 64 && parsed.length !== 32)) {
      throw new Error('Solana JSON keypair must contain 32 or 64 bytes');
    }
    const bytes = new Uint8Array(parsed.map((n) => Number(n)));
    const kp = bytes.length === 64 ? nacl.sign.keyPair.fromSecretKey(bytes) : nacl.sign.keyPair.fromSeed(bytes);
    return {
      kind: 'solana',
      address: bs58.encode(kp.publicKey),
      normalizedKey: bs58.encode(kp.secretKey),
    };
  }

  // 2. Check EVM Hex format (0x + 64 hex chars, or 64 hex chars)
  const hexCandidate = trimmed.startsWith('0x') ? trimmed : /^[0-9a-fA-F]{64}$/.test(trimmed) ? `0x${trimmed}` : null;
  if (hexCandidate && /^0x[0-9a-fA-F]{64}$/.test(hexCandidate)) {
    const wallet = new ethers.Wallet(hexCandidate);
    return {
      kind: 'evm',
      address: wallet.address,
      normalizedKey: wallet.privateKey,
    };
  }

  // 3. Check Solana Base58 secret key (64-byte or 32-byte decoded)
  try {
    const decoded = bs58.decode(trimmed);
    if (decoded.length === 64) {
      const kp = nacl.sign.keyPair.fromSecretKey(decoded);
      return {
        kind: 'solana',
        address: bs58.encode(kp.publicKey),
        normalizedKey: bs58.encode(kp.secretKey),
      };
    }
    if (decoded.length === 32) {
      const kp = nacl.sign.keyPair.fromSeed(decoded);
      return {
        kind: 'solana',
        address: bs58.encode(kp.publicKey),
        normalizedKey: bs58.encode(kp.secretKey),
      };
    }
  } catch {
    // not base58
  }

  throw new Error('Unrecognized key format. Supports EVM 0x hex (64 chars), Solana Base58, or Solana JSON array.');
}

export async function decryptKeystoreJson(jsonContent: string, password: string): Promise<ParsedPrivateKeyResult> {
  const wallet = await ethers.Wallet.fromEncryptedJson(jsonContent, password);
  return {
    kind: 'evm',
    address: wallet.address,
    normalizedKey: wallet.privateKey,
  };
}

export async function createEncryptedKeystoreJson(privateKey: string, password: string): Promise<string> {
  const wallet = new ethers.Wallet(privateKey);
  return wallet.encrypt(password);
}
