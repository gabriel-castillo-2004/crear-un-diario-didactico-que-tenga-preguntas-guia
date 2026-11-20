/**
 * Versioned encrypted backup export and dry-run validated atomic import.
 */

import { SCHEMA_VERSION } from "../types/domain.js";
import { decryptPayload, unwrapDekWithSecret } from "../crypto/envelopeCrypto.js";

export const BACKUP_FORMAT = "diario-didactico-backup-v1";

/**
 * Creates a versioned BackupBundle containing only encrypted envelopes and KEK-wrapped DEKs.
 * @param {{
 *   keyring: { pin: import("../types/domain.js").KeyWrapEnvelope, recovery: import("../types/domain.js").KeyWrapEnvelope },
 *   entries: import("../types/domain.js").EncryptedRecordEnvelope[],
 *   cycleLogs: import("../types/domain.js").EncryptedRecordEnvelope[]
 * }} data
 * @returns {import("../types/domain.js").BackupBundle}
 */
export function exportEncryptedBackup(data) {
  if (!data?.keyring?.pin || !data?.keyring?.recovery) {
    throw new Error("No se encontraron las claves cifradas para exportar.");
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    keyring: {
      pin: data.keyring.pin,
      recovery: data.keyring.recovery,
    },
    entries: Array.isArray(data.entries) ? data.entries : [],
    cycleLogs: Array.isArray(data.cycleLogs) ? data.cycleLogs : [],
  };
}

function assertValidEnvelopeShape(record, label) {
  if (
    !record ||
    typeof record.id !== "string" ||
    !record.envelope ||
    record.envelope.cipher !== "AES-GCM" ||
    typeof record.envelope.iv !== "string" ||
    typeof record.envelope.ciphertext !== "string"
  ) {
    throw new Error(`Formato inválido en ${label}.`);
  }
}

function assertValidKeyEnvelope(keyEnv, expectedId) {
  if (
    !keyEnv ||
    keyEnv.id !== expectedId ||
    keyEnv.cipher !== "AES-GCM" ||
    !keyEnv.kdf ||
    keyEnv.kdf.algorithm !== "PBKDF2" ||
    typeof keyEnv.iv !== "string" ||
    typeof keyEnv.wrappedKey !== "string"
  ) {
    throw new Error(`Sobre de clave '${expectedId}' inválido en el respaldo.`);
  }
}

/**
 * Parses, structurally validates, and performs a full in-memory dry-run decryption
 * of a backup JSON string before any IndexedDB write occurs.
 *
 * @param {string} rawJson
 * @param {string} pinOrRecoverySecret
 * @param {"pin" | "recovery"} [secretType]
 * @returns {Promise<{ ok: true, bundle: import("../types/domain.js").BackupBundle, decryptedEntriesCount: number, decryptedLogsCount: number }>}
 */
export async function validateAndDryRunImport(
  rawJson,
  pinOrRecoverySecret,
  secretType = "pin"
) {
  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("El archivo de respaldo no es un JSON válido.");
  }

  if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION || parsed.format !== BACKUP_FORMAT) {
    throw new Error("Versión o formato de respaldo incompatible.");
  }

  if (!parsed.keyring || !Array.isArray(parsed.entries) || !Array.isArray(parsed.cycleLogs)) {
    throw new Error("Estructura de respaldo incompleta.");
  }

  assertValidKeyEnvelope(parsed.keyring.pin, "pin");
  assertValidKeyEnvelope(parsed.keyring.recovery, "recovery");

  const keyEnvelope = secretType === "recovery" ? parsed.keyring.recovery : parsed.keyring.pin;
  const dek = await unwrapDekWithSecret(keyEnvelope, pinOrRecoverySecret);

  for (const entry of parsed.entries) {
    assertValidEnvelopeShape(entry, "entrada");
    await decryptPayload(dek, entry.envelope);
  }

  for (const log of parsed.cycleLogs) {
    assertValidEnvelopeShape(log, "registro de ciclo");
    await decryptPayload(dek, log.envelope);
  }

  return {
    ok: true,
    bundle: parsed,
    decryptedEntriesCount: parsed.entries.length,
    decryptedLogsCount: parsed.cycleLogs.length,
  };
}

/**
 * Applies a previously dry-run validated backup bundle to IndexedDB atomically.
 * @param {ReturnType<import("./indexedDbStore.js").createIndexedDbStore>} store
 * @param {import("../types/domain.js").BackupBundle} validatedBundle
 */
export async function applyValidatedBackup(store, validatedBundle) {
  await store.replaceAllDataAtomically({
    keyring: validatedBundle.keyring,
    entries: validatedBundle.entries,
    cycleLogs: validatedBundle.cycleLogs,
  });
}
