/**
 * Menstrual cycle state machine and anti-repetition guided question selector.
 */

import {
  CYCLE_PHASES,
  CYCLE_PHASE_LABELS,
  CYCLE_TRACKING_MODES,
  DEFAULT_CYCLE_LENGTH_DAYS,
  STALE_DAYS_THRESHOLD,
} from "../types/domain.js";
import { PROMPTS_CATALOG } from "../data/promptsCatalog.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Computes whole days elapsed between two dates (floor).
 * @param {string | Date} fromDate
 * @param {Date} toDate
 * @returns {number | null}
 */
export function daysBetween(fromDate, toDate = new Date()) {
  if (!fromDate) {
    return null;
  }
  const start = new Date(fromDate);
  if (Number.isNaN(start.getTime())) {
    return null;
  }
  const diff = toDate.getTime() - start.getTime();
  return Math.max(0, Math.floor(diff / MS_PER_DAY));
}

/**
 * Maps a cycle day (1-indexed) to a CyclePhase.
 * @param {number} cycleDay
 * @param {number} [cycleLengthDays]
 * @returns {import("../types/domain.js").CyclePhase}
 */
export function inferPhaseFromCycleDay(cycleDay, cycleLengthDays = DEFAULT_CYCLE_LENGTH_DAYS) {
  if (cycleDay <= 5) {
    return CYCLE_PHASES.MENSTRUATION;
  }
  if (cycleDay <= 13) {
    return CYCLE_PHASES.FOLLICULAR;
  }
  if (cycleDay <= 16) {
    return CYCLE_PHASES.OVULATION;
  }
  if (cycleDay <= cycleLengthDays + STALE_DAYS_THRESHOLD) {
    return CYCLE_PHASES.LUTEAL;
  }
  return CYCLE_PHASES.NEUTRAL;
}

/**
 * Evaluates the current CycleTrackingMode and active phase based on preferences and logs.
 * If >45 days have passed without a record in active_tracked mode, transitions to
 * 'stale_confirmation' and suspends automatic inference.
 *
 * @param {import("../types/domain.js").UserPreferences} preferences
 * @param {Array<{ id: string, date: string, phase: import("../types/domain.js").CyclePhase, isPeriodStart?: boolean }>} cycleLogs
 * @param {Date} [referenceDate]
 */
export function evaluateCycleState(preferences, cycleLogs = [], referenceDate = new Date()) {
  const mode = preferences?.cycleMode || CYCLE_TRACKING_MODES.ACTIVE_TRACKED;

  if (mode === CYCLE_TRACKING_MODES.NON_MENSTRUATING) {
    return {
      trackingMode: CYCLE_TRACKING_MODES.NON_MENSTRUATING,
      activePhase: CYCLE_PHASES.NEUTRAL,
      phaseLabel: CYCLE_PHASE_LABELS.neutral,
      cycleDay: null,
      daysSinceLastLog: null,
      inferenceSuspended: true,
      requiresConfirmation: false,
      notice: "Modo no menstruante activo: tus preguntas guía se adaptan en modo neutro.",
    };
  }

  if (mode === CYCLE_TRACKING_MODES.MANUAL_IRREGULAR) {
    const manualPhase = preferences?.manualPhase || CYCLE_PHASES.NEUTRAL;
    return {
      trackingMode: CYCLE_TRACKING_MODES.MANUAL_IRREGULAR,
      activePhase: manualPhase,
      phaseLabel: CYCLE_PHASE_LABELS[manualPhase] || CYCLE_PHASE_LABELS.neutral,
      cycleDay: null,
      daysSinceLastLog: null,
      inferenceSuspended: true,
      requiresConfirmation: false,
      notice: "Modo manual / ciclo irregular: eliges tu fase directamente sin inferencias automáticas.",
    };
  }

  const sortedLogs = [...cycleLogs].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  const latestLogDate = sortedLogs[0]?.date || preferences?.lastPeriodStartDate || null;
  const daysSinceLastLog = daysBetween(latestLogDate, referenceDate);

  if (daysSinceLastLog === null || daysSinceLastLog > STALE_DAYS_THRESHOLD) {
    return {
      trackingMode: CYCLE_TRACKING_MODES.STALE_CONFIRMATION,
      activePhase: CYCLE_PHASES.NEUTRAL,
      phaseLabel: CYCLE_PHASE_LABELS.neutral,
      cycleDay: null,
      daysSinceLastLog,
      inferenceSuspended: true,
      requiresConfirmation: true,
      notice:
        daysSinceLastLog === null
          ? "Aún no registras tu último inicio de ciclo. Confirma tu fase actual o elige modo neutro."
          : `Han pasado ${daysSinceLastLog} días (>45 días) desde tu último registro. Se suspendió la inferencia automática hasta que confirmes tu estado.`,
    };
  }

  const latestPeriodLog = sortedLogs.find((l) => l.isPeriodStart);
  const anchorDate = latestPeriodLog?.date || preferences?.lastPeriodStartDate || latestLogDate;
  const daysSincePeriod = daysBetween(anchorDate, referenceDate) ?? 0;
  const cycleLength = preferences?.cycleLengthDays || DEFAULT_CYCLE_LENGTH_DAYS;
  const cycleDay = (daysSincePeriod % cycleLength) + 1;
  const inferredPhase = inferPhaseFromCycleDay(cycleDay, cycleLength);

  return {
    trackingMode: CYCLE_TRACKING_MODES.ACTIVE_TRACKED,
    activePhase: inferredPhase,
    phaseLabel: CYCLE_PHASE_LABELS[inferredPhase],
    cycleDay,
    daysSinceLastLog,
    inferenceSuspended: false,
    requiresConfirmation: false,
    notice: `Día ${cycleDay} del ciclo · Fase estimada: ${CYCLE_PHASE_LABELS[inferredPhase]}.`,
  };
}

/**
 * Selects a didactic guided question matching the active phase and life themes,
 * avoiding immediate repetition of previousQuestionId.
 *
 * @param {{
 *   phase: import("../types/domain.js").CyclePhase,
 *   activeThemes?: import("../types/domain.js").LifeTheme[],
 *   previousQuestionId?: string | null,
 *   recentQuestionIds?: string[],
 *   randomFn?: () => number
 * }} params
 */
export function selectGuidedQuestion({
  phase,
  activeThemes = [],
  previousQuestionId = null,
  recentQuestionIds = [],
  randomFn = Math.random,
}) {
  const targetPhase = phase || CYCLE_PHASES.NEUTRAL;
  let candidates = PROMPTS_CATALOG.filter((item) => item.phase === targetPhase);

  if (activeThemes.length > 0) {
    const themeFiltered = candidates.filter((item) => activeThemes.includes(item.theme));
    if (themeFiltered.length > 0) {
      candidates = themeFiltered;
    }
  }

  if (candidates.length === 0) {
    candidates = PROMPTS_CATALOG.filter((item) => item.phase === CYCLE_PHASES.NEUTRAL);
  }

  // Avoid repeating the immediately previous question whenever alternatives exist
  if (previousQuestionId && candidates.length > 1) {
    const withoutPrevious = candidates.filter((item) => item.id !== previousQuestionId);
    if (withoutPrevious.length > 0) {
      candidates = withoutPrevious;
    }
  }

  // Prefer questions not seen recently
  if (recentQuestionIds.length > 0 && candidates.length > 1) {
    const freshCandidates = candidates.filter((item) => !recentQuestionIds.includes(item.id));
    if (freshCandidates.length > 0) {
      candidates = freshCandidates;
    }
  }

  const index = Math.floor(randomFn() * candidates.length) % candidates.length;
  return candidates[index];
}
