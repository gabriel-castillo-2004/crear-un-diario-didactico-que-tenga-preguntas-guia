/**
 * Core domain constants, enums, and JSDoc type definitions.
 */

export const SCHEMA_VERSION = 1;
export const STALE_DAYS_THRESHOLD = 45;
export const DEFAULT_CYCLE_LENGTH_DAYS = 28;
export const DEFAULT_INACTIVITY_LOCK_MS = 5 * 60 * 1000;

export const CYCLE_PHASES = Object.freeze({
  MENSTRUATION: "menstruation",
  FOLLICULAR: "follicular",
  OVULATION: "ovulation",
  LUTEAL: "luteal",
  NEUTRAL: "neutral",
});

export const CYCLE_PHASE_LABELS = Object.freeze({
  menstruation: "Menstruación",
  follicular: "Folicular",
  ovulation: "Ovulación",
  luteal: "Lútea",
  neutral: "Neutro",
});

export const CYCLE_TRACKING_MODES = Object.freeze({
  ACTIVE_TRACKED: "active_tracked",
  MANUAL_IRREGULAR: "manual_irregular",
  NON_MENSTRUATING: "non_menstruating",
  STALE_CONFIRMATION: "stale_confirmation",
});

export const CYCLE_MODE_LABELS = Object.freeze({
  active_tracked: "Seguimiento por fecha",
  manual_irregular: "Manual / ciclo irregular",
  non_menstruating: "No menstruante (modo neutro)",
  stale_confirmation: "Confirmación pendiente (>45 días)",
});

export const LIFE_THEMES = Object.freeze({
  CAREER: "career",
  RELATIONSHIPS: "relationships",
  MOTHERHOOD_FERTILITY: "motherhood_fertility",
  WELLBEING: "wellbeing",
});

export const LIFE_THEME_LABELS = Object.freeze({
  career: "Carrera y propósito",
  relationships: "Relaciones y vínculos",
  motherhood_fertility: "Maternidad y fertilidad",
  wellbeing: "Bienestar y autocuidado",
});

/**
 * Creates a default UserPreferences object.
 * @returns {UserPreferences}
 */
export function createDefaultPreferences() {
  return {
    cycleMode: CYCLE_TRACKING_MODES.ACTIVE_TRACKED,
    cycleLengthDays: DEFAULT_CYCLE_LENGTH_DAYS,
    lastPeriodStartDate: null,
    manualPhase: CYCLE_PHASES.NEUTRAL,
    activeThemes: [
      LIFE_THEMES.WELLBEING,
      LIFE_THEMES.CAREER,
      LIFE_THEMES.RELATIONSHIPS,
    ],
    inactivityTimeoutMs: DEFAULT_INACTIVITY_LOCK_MS,
  };
}

/**
 * @typedef {"menstruation" | "follicular" | "ovulation" | "luteal" | "neutral"} CyclePhase
 * @typedef {"active_tracked" | "manual_irregular" | "non_menstruating" | "stale_confirmation"} CycleTrackingMode
 * @typedef {"career" | "relationships" | "motherhood_fertility" | "wellbeing"} LifeTheme
 *
 * @typedef {Object} UserPreferences
 * @property {CycleTrackingMode} cycleMode
 * @property {number} cycleLengthDays
 * @property {string | null} lastPeriodStartDate
 * @property {CyclePhase} manualPhase
 * @property {LifeTheme[]} activeThemes
 * @property {number} inactivityTimeoutMs
 *
 * @typedef {Object} JournalEntryPayload
 * @property {string} id
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {CyclePhase} phase
 * @property {LifeTheme} theme
 * @property {string} questionId
 * @property {string} questionText
 * @property {string} title
 * @property {string} content
 *
 * @typedef {Object} EncryptedRecordEnvelope
 * @property {string} id
 * @property {{ cipher: "AES-GCM", iv: string, ciphertext: string }} envelope
 *
 * @typedef {Object} KeyWrapEnvelope
 * @property {"pin" | "recovery"} id
 * @property {number} version
 * @property {{ algorithm: "PBKDF2", hash: "SHA-256", iterations: number, salt: string }} kdf
 * @property {"AES-GCM"} cipher
 * @property {string} iv
 * @property {string} wrappedKey
 *
 * @typedef {Object} BackupBundle
 * @property {number} schemaVersion
 * @property {string} format
 * @property {string} exportedAt
 * @property {{ pin: KeyWrapEnvelope, recovery: KeyWrapEnvelope }} keyring
 * @property {EncryptedRecordEnvelope[]} entries
 * @property {EncryptedRecordEnvelope[]} cycleLogs
 */
