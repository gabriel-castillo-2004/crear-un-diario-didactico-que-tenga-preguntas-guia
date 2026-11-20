/**
 * Envelope cryptography module built on Web Crypto API (AES-GCM 256 + PBKDF2-SHA256).
 * Generates a random DEK, double-wraps it with PIN KEK and recovery KEK,
 * encrypts/decrypts JSON payloads with unique 96-bit IVs, and computes exponential backoff.
 */

const KDF_VERSION = 1;
const DEFAULT_PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12; // 96 bits for AES-GCM
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 15 * 60 * 1000;

function getCrypto() {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || !cryptoObj.subtle) {
    throw new Error("Web Crypto API (crypto.subtle) no está disponible en este entorno.");
  }
  return cryptoObj;
}

/**
 * Encodes a Uint8Array to base64.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decodes a base64 string to Uint8Array.
 * @param {string} base64
 * @returns {Uint8Array}
 */
export function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Generates a random 256-bit AES-GCM Data Encryption Key (DEK).
 * @returns {Promise<CryptoKey>}
 */
export async function generateDek() {
  const cryptoObj = getCrypto();
  return cryptoObj.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

/**
 * Generates a human-readable 24-character recovery code using CSPRNG.
 * @returns {string}
 */
export function generateRecoveryCode() {
  const cryptoObj = getCrypto();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const randomBytes = new Uint8Array(24);
  cryptoObj.getRandomValues(randomBytes);

  const chars = [];
  for (let i = 0; i < randomBytes.length; i += 1) {
    chars.push(alphabet[randomBytes[i] % alphabet.length]);
  }
  return chars.join("").match(/.{1,4}/g).join("-");
}

/**
 * Normalizes a recovery code or PIN secret before KDF derivation.
 * @param {string} secret
 * @param {"pin" | "recovery"} keyRole
 * @returns {string}
 */
function normalizeSecret(secret, keyRole) {
  const trimmed = String(secret || "").trim();
  if (keyRole === "recovery") {
    return trimmed.toUpperCase().replace(/[^A-Z0-9]/g, "");
  }
  return trimmed;
}

/**
 * Derives a 256-bit AES-GCM Key Encryption Key (KEK) using PBKDF2-SHA256.
 * @param {string} secret
 * @param {Uint8Array} saltBytes
 * @param {number} [iterations]
 * @returns {Promise<CryptoKey>}
 */
export async function deriveKek(
  secret,
  saltBytes,
  iterations = DEFAULT_PBKDF2_ITERATIONS
) {
  const cryptoObj = getCrypto();
  const encoder = new TextEncoder();
  const baseKey = await cryptoObj.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return cryptoObj.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"]
  );
}

/**
 * Wraps the DEK with a KEK derived from the given PIN or recovery code.
 * @param {CryptoKey} dek
 * @param {string} secret
 * @param {"pin" | "recovery"} keyRole
 * @param {{ iterations?: number }} [options]
 * @returns {Promise<import("../types/domain.js").KeyWrapEnvelope>}
 */
export async function wrapDekWithSecret(dek, secret, keyRole, options = {}) {
  const cryptoObj = getCrypto();
  const normalized = normalizeSecret(secret, keyRole);
  if (!normalized) {
    throw new Error("El secreto para envolver la clave no puede estar vacío.");
  }

  const iterations = options.iterations ?? DEFAULT_PBKDF2_ITERATIONS;
  const salt = cryptoObj.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = cryptoObj.getRandomValues(new Uint8Array(IV_BYTES));
  const kek = await deriveKek(normalized, salt, iterations);

  const wrappedBuffer = await cryptoObj.subtle.wrapKey("raw", dek, kek, {
    name: "AES-GCM",
    iv,
  });

  return {
    id: keyRole,
    version: KDF_VERSION,
    kdf: {
      algorithm: "PBKDF2",
      hash: "SHA-256",
      iterations,
      salt: bytesToBase64(salt),
    },
    cipher: "AES-GCM",
    iv: bytesToBase64(iv),
    wrappedKey: bytesToBase64(new Uint8Array(wrappedBuffer)),
  };
}

/**
 * Unwraps the DEK from a KeyWrapEnvelope using the user's PIN or recovery code.
 * Throws if the secret is incorrect or the envelope is tampered.
 * @param {import("../types/domain.js").KeyWrapEnvelope} envelope
 * @param {string} secret
 * @returns {Promise<CryptoKey>}
 */
export async function unwrapDekWithSecret(envelope, secret) {
  const cryptoObj = getCrypto();
  if (!envelope || envelope.cipher !== "AES-GCM" || !envelope.kdf) {
    throw new Error("Sobre de clave inválido.");
  }

  const normalized = normalizeSecret(secret, envelope.id);
  if (!normalized) {
    throw new Error("PIN o código de recuperación vacío.");
  }

  const salt = base64ToBytes(envelope.kdf.salt);
  const iv = base64ToBytes(envelope.iv);
  const wrappedBytes = base64ToBytes(envelope.wrappedKey);
  const kek = await deriveKek(normalized, salt, envelope.kdf.iterations);

  try {
    return await cryptoObj.subtle.unwrapKey(
      "raw",
      wrappedBytes,
      kek,
      { name: "AES-GCM", iv },
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  } catch {
    throw new Error("PIN o código de recuperación incorrecto.");
  }
}

/**
 * Re-wraps the existing DEK with a new PIN without re-encrypting stored entries.
 * @param {import("../types/domain.js").KeyWrapEnvelope} currentPinEnvelope
 * @param {string} currentPin
 * @param {string} newPin
 * @returns {Promise<{ newPinEnvelope: import("../types/domain.js").KeyWrapEnvelope, dek: CryptoKey }>}
 */
export async function changePin(currentPinEnvelope, currentPin, newPin) {
  const dek = await unwrapDekWithSecret(currentPinEnvelope, currentPin);
  const newPinEnvelope = await wrapDekWithSecret(dek, newPin, "pin");
  return { newPinEnvelope, dek };
}

/**
 * Resets the PIN using the recovery code, re-wrapping the existing DEK without losing entries.
 * @param {import("../types/domain.js").KeyWrapEnvelope} recoveryEnvelope
 * @param {string} recoveryCode
 * @param {string} newPin
 * @returns {Promise<{ newPinEnvelope: import("../types/domain.js").KeyWrapEnvelope, dek: CryptoKey }>}
 */
export async function resetPinWithRecovery(recoveryEnvelope, recoveryCode, newPin) {
  const dek = await unwrapDekWithSecret(recoveryEnvelope, recoveryCode);
  const newPinEnvelope = await wrapDekWithSecret(dek, newPin, "pin");
  return { newPinEnvelope, dek };
}

/**
 * Encrypts a JSON-serializable payload with AES-GCM and a unique 96-bit IV.
 * @param {CryptoKey} dek
 * @param {unknown} payload
 * @returns {Promise<{ cipher: "AES-GCM", iv: string, ciphertext: string }>}
 */
export async function encryptPayload(dek, payload) {
  const cryptoObj = getCrypto();
  const iv = cryptoObj.getRandomValues(new Uint8Array(IV_BYTES));
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const encryptedBuffer = await cryptoObj.subtle.encrypt(
    { name: "AES-GCM", iv },
    dek,
    encoded
  );

  return {
    cipher: "AES-GCM",
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encryptedBuffer)),
  };
}

/**
 * Decrypts an AES-GCM encrypted envelope back into its JSON payload.
 * @param {CryptoKey} dek
 * @param {{ cipher: string, iv: string, ciphertext: string }} envelope
 * @returns {Promise<any>}
 */
export async function decryptPayload(dek, envelope) {
  const cryptoObj = getCrypto();
  if (!envelope || envelope.cipher !== "AES-GCM" || !envelope.iv || !envelope.ciphertext) {
    throw new Error("Sobre cifrado inválido o corrupto.");
  }

  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  const decryptedBuffer = await cryptoObj.subtle.decrypt(
    { name: "AES-GCM", iv },
    dek,
    ciphertext
  );

  const jsonText = new TextDecoder().decode(decryptedBuffer);
  return JSON.parse(jsonText);
}

/**
 * Computes exponential backoff delay in milliseconds after failed PIN attempts.
 * @param {number} failedAttempts
 * @param {number} [baseDelayMs]
 * @param {number} [maxDelayMs]
 * @returns {number}
 */
export function calculateBackoffMs(
  failedAttempts,
  baseDelayMs = BACKOFF_BASE_MS,
  maxDelayMs = BACKOFF_MAX_MS
) {
  if (!Number.isFinite(failedAttempts) || failedAttempts <= 0) {
    return 0;
  }
  const delay = baseDelayMs * Math.pow(2, failedAttempts - 1);
  return Math.min(delay, maxDelayMs);
}
