/**
 * In-memory session manager: holds DEK and decrypted index only while unlocked,
 * auto-locks on inactivity or visibilitychange, and enforces exponential backoff.
 */

import {
  DEFAULT_INACTIVITY_LOCK_MS,
  createDefaultPreferences,
} from "../types/domain.js";
import {
  calculateBackoffMs,
  changePin as cryptoChangePin,
  decryptPayload,
  encryptPayload,
  generateDek,
  generateRecoveryCode,
  resetPinWithRecovery as cryptoResetPinWithRecovery,
  unwrapDekWithSecret,
  wrapDekWithSecret,
} from "../crypto/envelopeCrypto.js";

/**
 * Creates the session manager bound to an IndexedDB store.
 * @param {ReturnType<import("../storage/indexedDbStore.js").createIndexedDbStore>} store
 */
export function createSessionManager(store) {
  let dek = null;
  let isLocked = true;
  let entries = [];
  let cycleLogs = [];
  let preferences = createDefaultPreferences();
  let inactivityTimerId = null;
  let listenersBound = false;
  const subscribers = new Set();

  function notify() {
    for (const cb of subscribers) {
      cb({ isLocked });
    }
  }

  function clearInactivityTimer() {
    if (inactivityTimerId !== null) {
      clearTimeout(inactivityTimerId);
      inactivityTimerId = null;
    }
  }

  function resetInactivityTimer() {
    clearInactivityTimer();
    if (isLocked) {
      return;
    }
    const timeoutMs = preferences?.inactivityTimeoutMs || DEFAULT_INACTIVITY_LOCK_MS;
    inactivityTimerId = setTimeout(() => {
      lock("inactivity");
    }, timeoutMs);
  }

  function handleVisibilityChange() {
    if (typeof document !== "undefined" && (document.hidden || document.visibilityState === "hidden")) {
      lock("visibilitychange");
    }
  }

  function handleUserActivity() {
    if (!isLocked) {
      resetInactivityTimer();
    }
  }

  function bindGlobalListeners() {
    if (listenersBound || typeof document === "undefined") {
      return;
    }
    listenersBound = true;
    document.addEventListener("visibilitychange", handleVisibilityChange);
    for (const eventName of ["pointerdown", "keydown", "input", "scroll"]) {
      document.addEventListener(eventName, handleUserActivity, { passive: true });
    }
  }

  function unbindGlobalListeners() {
    if (!listenersBound || typeof document === "undefined") {
      return;
    }
    listenersBound = false;
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    for (const eventName of ["pointerdown", "keydown", "input", "scroll"]) {
      document.removeEventListener(eventName, handleUserActivity);
    }
  }

  /**
   * Purges DEK and all decrypted data from memory immediately.
   */
  function lock(_reason = "manual") {
    dek = null;
    isLocked = true;
    entries = [];
    cycleLogs = [];
    preferences = createDefaultPreferences();
    clearInactivityTimer();
    notify();
  }

  async function hydrateFromStore(activeDek) {
    const [rawEntries, rawLogs, rawPrefs] = await Promise.all([
      store.getAllEncryptedEntries(),
      store.getAllEncryptedCycleLogs(),
      store.getEncryptedPreferences(),
    ]);

    const decryptedEntries = [];
    for (const rec of rawEntries) {
      decryptedEntries.push(await decryptPayload(activeDek, rec.envelope));
    }
    decryptedEntries.sort(
      (a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
    );

    const decryptedLogs = [];
    for (const rec of rawLogs) {
      decryptedLogs.push(await decryptPayload(activeDek, rec.envelope));
    }

    let decryptedPrefs = createDefaultPreferences();
    if (rawPrefs?.envelope) {
      decryptedPrefs = {
        ...decryptedPrefs,
        ...(await decryptPayload(activeDek, rawPrefs.envelope)),
      };
    }

    dek = activeDek;
    entries = decryptedEntries;
    cycleLogs = decryptedLogs;
    preferences = decryptedPrefs;
    isLocked = false;
    bindGlobalListeners();
    resetInactivityTimer();
    notify();
  }

  return {
    subscribe(callback) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },

    getState() {
      return {
        isLocked,
        entries: isLocked ? [] : [...entries],
        cycleLogs: isLocked ? [] : [...cycleLogs],
        preferences: { ...preferences },
      };
    },

    lock,
    destroy() {
      lock("destroy");
      unbindGlobalListeners();
    },

    async setupNewVault(pin) {
      const newDek = await generateDek();
      const recoveryCode = generateRecoveryCode();
      const [pinEnvelope, recoveryEnvelope] = await Promise.all([
        wrapDekWithSecret(newDek, pin, "pin"),
        wrapDekWithSecret(newDek, recoveryCode, "recovery"),
      ]);

      await store.saveInitialKeyring(pinEnvelope, recoveryEnvelope);
      const defaultPrefs = createDefaultPreferences();
      const prefsEnvelope = await encryptPayload(newDek, defaultPrefs);
      await store.putEncryptedPreferences(prefsEnvelope);
      await store.setLockoutState(0, 0);
      await hydrateFromStore(newDek);
      return { recoveryCode };
    },

    async unlockWithPin(pin) {
      const lockout = await store.getLockoutState();
      const now = Date.now();
      if (lockout.lockedUntil && now < lockout.lockedUntil) {
        const remainingSec = Math.ceil((lockout.lockedUntil - now) / 1000);
        throw new Error(`Demasiados intentos. Espera ${remainingSec} segundos antes de reintentar.`);
      }

      const pinEnvelope = await store.getKeyEnvelope("pin");
      if (!pinEnvelope) {
        throw new Error("No existe bóveda configurada.");
      }

      try {
        const unwrappedDek = await unwrapDekWithSecret(pinEnvelope, pin);
        await store.setLockoutState(0, 0);
        await hydrateFromStore(unwrappedDek);
      } catch (err) {
        const nextAttempts = (lockout.failedAttempts || 0) + 1;
        const waitMs = calculateBackoffMs(nextAttempts);
        const lockedUntil = now + waitMs;
        await store.setLockoutState(nextAttempts, lockedUntil);
        const waitSec = Math.ceil(waitMs / 1000);
        throw new Error(
          `${err.message} Intento fallido #${nextAttempts}. Espera ${waitSec}s.`
        );
      }
    },

    async resetPinWithRecovery(recoveryCode, newPin) {
      const recoveryEnvelope = await store.getKeyEnvelope("recovery");
      if (!recoveryEnvelope) {
        throw new Error("No se encontró sobre de recuperación.");
      }
      const { newPinEnvelope, dek: unwrappedDek } = await cryptoResetPinWithRecovery(
        recoveryEnvelope,
        recoveryCode,
        newPin
      );
      await store.putKeyEnvelope(newPinEnvelope);
      await store.setLockoutState(0, 0);
      await hydrateFromStore(unwrappedDek);
    },

    async changePin(currentPin, newPin) {
      const pinEnvelope = await store.getKeyEnvelope("pin");
      if (!pinEnvelope) {
        throw new Error("No se encontró sobre de PIN.");
      }
      const { newPinEnvelope } = await cryptoChangePin(pinEnvelope, currentPin, newPin);
      await store.putKeyEnvelope(newPinEnvelope);
    },

    async saveEntry(entry) {
      if (isLocked || !dek) {
        throw new Error("La sesión está bloqueada.");
      }
      const envelope = await encryptPayload(dek, entry);
      await store.putEncryptedEntry({ id: entry.id, envelope });
      const idx = entries.findIndex((e) => e.id === entry.id);
      if (idx >= 0) {
        entries[idx] = entry;
      } else {
        entries.unshift(entry);
      }
      resetInactivityTimer();
    },

    async deleteEntry(id) {
      if (isLocked || !dek) {
        throw new Error("La sesión está bloqueada.");
      }
      await store.deleteEncryptedEntry(id);
      entries = entries.filter((e) => e.id !== id);
      resetInactivityTimer();
    },

    async saveCycleLog(log) {
      if (isLocked || !dek) {
        throw new Error("La sesión está bloqueada.");
      }
      const envelope = await encryptPayload(dek, log);
      await store.putEncryptedCycleLog({ id: log.id, envelope });
      cycleLogs.push(log);
      resetInactivityTimer();
    },

    async savePreferences(nextPrefs) {
      if (isLocked || !dek) {
        throw new Error("La sesión está bloqueada.");
      }
      const envelope = await encryptPayload(dek, nextPrefs);
      await store.putEncryptedPreferences(envelope);
      preferences = { ...nextPrefs };
      resetInactivityTimer();
    },

    async exportBackupData() {
      if (isLocked) {
        throw new Error("Desbloquea la sesión para exportar un respaldo.");
      }
      const [pinEnv, recEnv, rawEntries, rawLogs] = await Promise.all([
        store.getKeyEnvelope("pin"),
        store.getKeyEnvelope("recovery"),
        store.getAllEncryptedEntries(),
        store.getAllEncryptedCycleLogs(),
      ]);
      return {
        keyring: { pin: pinEnv, recovery: recEnv },
        entries: rawEntries,
        cycleLogs: rawLogs,
      };
    },
  };
}
