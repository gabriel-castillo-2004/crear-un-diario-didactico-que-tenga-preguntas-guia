/**
 * Local IndexedDB persistence layer with versioned schema migrations
 * and zero plaintext sensitive metadata stored on disk.
 */

const DB_NAME = "diario_didactico_db";
const DB_VERSION = 1;

export const STORES = Object.freeze({
  KEYRING: "keyring",
  ENTRIES: "entries",
  CYCLE_LOGS: "cycle_logs",
  PREFERENCES: "preferences",
  LOCKOUT: "lockout",
});

/**
 * Opens (and migrates if needed) the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB no está disponible en este navegador."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORES.KEYRING)) {
        db.createObjectStore(STORES.KEYRING, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.ENTRIES)) {
        db.createObjectStore(STORES.ENTRIES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.CYCLE_LOGS)) {
        db.createObjectStore(STORES.CYCLE_LOGS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.PREFERENCES)) {
        db.createObjectStore(STORES.PREFERENCES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.LOCKOUT)) {
        db.createObjectStore(STORES.LOCKOUT, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Error abriendo IndexedDB."));
  });
}

function runRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function awaitTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Error en transacción IndexedDB."));
    tx.onabort = () => reject(tx.error || new Error("Transacción IndexedDB abortada."));
  });
}

/**
 * Requests persistent storage from the browser when supported.
 * @returns {Promise<boolean>}
 */
export async function requestPersistentStorage() {
  if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.persist) {
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Returns storage persistence status and quota estimate.
 * @returns {Promise<{ persisted: boolean, usageBytes: number | null, quotaBytes: number | null }>}
 */
export async function getStorageStatus() {
  const result = { persisted: false, usageBytes: null, quotaBytes: null };
  if (typeof navigator === "undefined" || !navigator.storage) {
    return result;
  }

  try {
    if (navigator.storage.persisted) {
      result.persisted = await navigator.storage.persisted();
    }
    if (navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      result.usageBytes = typeof estimate.usage === "number" ? estimate.usage : null;
      result.quotaBytes = typeof estimate.quota === "number" ? estimate.quota : null;
    }
  } catch {
    return result;
  }
  return result;
}

/**
 * Creates a store facade bound to IndexedDB.
 */
export function createIndexedDbStore() {
  return {
    async hasKeyring() {
      const db = await openDatabase();
      const tx = db.transaction(STORES.KEYRING, "readonly");
      const pinEnv = await runRequest(tx.objectStore(STORES.KEYRING).get("pin"));
      return Boolean(pinEnv);
    },

    async getKeyEnvelope(id) {
      const db = await openDatabase();
      const tx = db.transaction(STORES.KEYRING, "readonly");
      return runRequest(tx.objectStore(STORES.KEYRING).get(id));
    },

    async putKeyEnvelope(envelope) {
      const db = await openDatabase();
      const tx = db.transaction(STORES.KEYRING, "readwrite");
      tx.objectStore(STORES.KEYRING).put(envelope);
      await awaitTransaction(tx);
    },

    async saveInitialKeyring(pinEnvelope, recoveryEnvelope) {
      const db = await openDatabase();
      const tx = db.transaction(STORES.KEYRING, "readwrite");
      const store = tx.objectStore(STORES.KEYRING);
      store.put(pinEnvelope);
      store.put(recoveryEnvelope);
      await awaitTransaction(tx);
    },

    async putEncryptedEntry(record) {
      const db = await openDatabase();
      const tx = db.transaction(STORES.ENTRIES, "readwrite");
      tx.objectStore(STORES.ENTRIES).put({ id: record.id, envelope: record.envelope });
      await awaitTransaction(tx);
    },

    async getAllEncryptedEntries() {
      const db = await openDatabase();
      const tx = db.transaction(STORES.ENTRIES, "readonly");
      return runRequest(tx.objectStore(STORES.ENTRIES).getAll());
    },

    async deleteEncryptedEntry(id) {
      const db = await openDatabase();
      const tx = db.transaction(STORES.ENTRIES, "readwrite");
      tx.objectStore(STORES.ENTRIES).delete(id);
      await awaitTransaction(tx);
    },

    async putEncryptedCycleLog(record) {
      const db = await openDatabase();
      const tx = db.transaction(STORES.CYCLE_LOGS, "readwrite");
      tx.objectStore(STORES.CYCLE_LOGS).put({ id: record.id, envelope: record.envelope });
      await awaitTransaction(tx);
    },

    async getAllEncryptedCycleLogs() {
      const db = await openDatabase();
      const tx = db.transaction(STORES.CYCLE_LOGS, "readonly");
      return runRequest(tx.objectStore(STORES.CYCLE_LOGS).getAll());
    },

    async putEncryptedPreferences(envelope) {
      const db = await openDatabase();
      const tx = db.transaction(STORES.PREFERENCES, "readwrite");
      tx.objectStore(STORES.PREFERENCES).put({ id: "user_preferences", envelope });
      await awaitTransaction(tx);
    },

    async getEncryptedPreferences() {
      const db = await openDatabase();
      const tx = db.transaction(STORES.PREFERENCES, "readonly");
      return runRequest(tx.objectStore(STORES.PREFERENCES).get("user_preferences"));
    },

    async getLockoutState() {
      const db = await openDatabase();
      const tx = db.transaction(STORES.LOCKOUT, "readonly");
      const state = await runRequest(tx.objectStore(STORES.LOCKOUT).get("auth_lockout"));
      return state || { id: "auth_lockout", failedAttempts: 0, lockedUntil: 0 };
    },

    async setLockoutState(failedAttempts, lockedUntil) {
      const db = await openDatabase();
      const tx = db.transaction(STORES.LOCKOUT, "readwrite");
      tx.objectStore(STORES.LOCKOUT).put({
        id: "auth_lockout",
        failedAttempts,
        lockedUntil,
      });
      await awaitTransaction(tx);
    },

    /**
     * Atomically replaces keyring, entries, and cycle logs in a single transaction.
     * Used after backup dry-run validation succeeds.
     * @param {{ keyring: { pin: any, recovery: any }, entries: any[], cycleLogs: any[] }} data
     */
    async replaceAllDataAtomically(data) {
      const db = await openDatabase();
      const tx = db.transaction(
        [STORES.KEYRING, STORES.ENTRIES, STORES.CYCLE_LOGS],
        "readwrite"
      );

      const keyringStore = tx.objectStore(STORES.KEYRING);
      const entriesStore = tx.objectStore(STORES.ENTRIES);
      const logsStore = tx.objectStore(STORES.CYCLE_LOGS);

      keyringStore.clear();
      entriesStore.clear();
      logsStore.clear();

      keyringStore.put(data.keyring.pin);
      keyringStore.put(data.keyring.recovery);

      for (const entry of data.entries) {
        entriesStore.put({ id: entry.id, envelope: entry.envelope });
      }
      for (const log of data.cycleLogs) {
        logsStore.put({ id: log.id, envelope: log.envelope });
      }

      await awaitTransaction(tx);
    },
  };
}
