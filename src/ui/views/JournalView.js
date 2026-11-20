/**
 * Daily journal view: cycle state banner, phase selector, non-repeating guided prompt,
 * and encrypted entry editor.
 */

import {
  CYCLE_PHASES,
  CYCLE_PHASE_LABELS,
  CYCLE_TRACKING_MODES,
  LIFE_THEMES,
  LIFE_THEME_LABELS,
} from "../../types/domain.js";
import { evaluateCycleState, selectGuidedQuestion } from "../../domain/cycleEngine.js";

/**
 * Renders JournalView into container.
 * @param {HTMLElement} container
 * @param {{
 *   sessionManager: ReturnType<import("../../domain/sessionManager.js").createSessionManager>,
 *   editingEntry?: import("../../types/domain.js").JournalEntryPayload | null,
 *   onClearEdit?: () => void
 * }} context
 */
export function renderJournalView(container, { sessionManager, editingEntry = null, onClearEdit }) {
  container.replaceChildren();
  const state = sessionManager.getState();
  const cycleState = evaluateCycleState(state.preferences, state.cycleLogs);

  let selectedPhase = editingEntry?.phase || cycleState.activePhase;
  let previousQuestionId = null;
  let recentQuestionIds = [];
  let currentQuestion = selectGuidedQuestion({
    phase: selectedPhase,
    activeThemes: state.preferences.activeThemes,
    previousQuestionId,
    recentQuestionIds,
  });

  if (editingEntry) {
    currentQuestion = {
      id: editingEntry.questionId,
      phase: editingEntry.phase,
      theme: editingEntry.theme,
      prompt: editingEntry.questionText,
      reflectionHint: "Editando entrada guardada previamente.",
    };
  }

  const section = document.createElement("section");
  section.className = "card";

  // Cycle status banner
  const statusBanner = document.createElement("div");
  statusBanner.className = cycleState.requiresConfirmation
    ? "alert alert-warning"
    : "alert alert-info";
  statusBanner.textContent = cycleState.notice;
  section.appendChild(statusBanner);

  // If stale_confirmation or active_tracked, offer quick period start log
  if (
    cycleState.trackingMode === CYCLE_TRACKING_MODES.STALE_CONFIRMATION ||
    cycleState.trackingMode === CYCLE_TRACKING_MODES.ACTIVE_TRACKED
  ) {
    const cycleActions = document.createElement("div");
    cycleActions.className = "actions-row";

    const logPeriodBtn = document.createElement("button");
    logPeriodBtn.type = "button";
    logPeriodBtn.className = "btn btn-secondary";
    logPeriodBtn.textContent = "Registrar inicio de ciclo hoy";
    logPeriodBtn.addEventListener("click", async () => {
      const todayIso = new Date().toISOString();
      await sessionManager.saveCycleLog({
        id: `log-${Date.now()}`,
        date: todayIso,
        phase: CYCLE_PHASES.MENSTRUATION,
        isPeriodStart: true,
      });
      await sessionManager.savePreferences({
        ...state.preferences,
        cycleMode: CYCLE_TRACKING_MODES.ACTIVE_TRACKED,
        lastPeriodStartDate: todayIso,
      });
      renderJournalView(container, { sessionManager, editingEntry, onClearEdit });
    });

    const switchNeutralBtn = document.createElement("button");
    switchNeutralBtn.type = "button";
    switchNeutralBtn.className = "btn";
    switchNeutralBtn.textContent = "Usar modo neutro";
    switchNeutralBtn.addEventListener("click", async () => {
      await sessionManager.savePreferences({
        ...state.preferences,
        cycleMode: CYCLE_TRACKING_MODES.NON_MENSTRUATING,
      });
      renderJournalView(container, { sessionManager, editingEntry, onClearEdit });
    });

    cycleActions.append(logPeriodBtn);
    if (cycleState.requiresConfirmation) {
      cycleActions.append(switchNeutralBtn);
    }
    section.appendChild(cycleActions);
  }

  // Phase selector
  const phaseGroup = document.createElement("div");
  phaseGroup.className = "field";
  const phaseLabel = document.createElement("label");
  phaseLabel.textContent = "Fase para tu reflexión de hoy";
  const phaseSelector = document.createElement("div");
  phaseSelector.className = "phase-selector";
  phaseSelector.setAttribute("role", "group");
  phaseSelector.setAttribute("aria-label", "Selector de fase del ciclo");

  const promptCard = document.createElement("div");
  promptCard.className = "prompt-card";
  const promptBadgeRow = document.createElement("div");
  promptBadgeRow.className = "badge-row";
  const phaseBadge = document.createElement("span");
  phaseBadge.className = "badge badge-accent";
  const themeBadge = document.createElement("span");
  themeBadge.className = "badge";
  promptBadgeRow.append(phaseBadge, themeBadge);

  const promptQuestionEl = document.createElement("p");
  promptQuestionEl.className = "prompt-question";
  const promptHintEl = document.createElement("p");
  promptHintEl.className = "prompt-hint";

  const anotherQuestionBtn = document.createElement("button");
  anotherQuestionBtn.type = "button";
  anotherQuestionBtn.className = "btn btn-secondary";
  anotherQuestionBtn.textContent = "Otra pregunta guía";

  promptCard.append(promptBadgeRow, promptQuestionEl, promptHintEl, anotherQuestionBtn);

  function refreshQuestionUI() {
    phaseBadge.textContent = CYCLE_PHASE_LABELS[currentQuestion.phase] || "Neutro";
    themeBadge.textContent = LIFE_THEME_LABELS[currentQuestion.theme] || "Bienestar";
    promptQuestionEl.textContent = currentQuestion.prompt;
    promptHintEl.textContent = currentQuestion.reflectionHint;
  }

  function pickNextQuestion(phase) {
    previousQuestionId = currentQuestion?.id || null;
    if (previousQuestionId) {
      recentQuestionIds = [previousQuestionId, ...recentQuestionIds].slice(0, 6);
    }
    currentQuestion = selectGuidedQuestion({
      phase,
      activeThemes: state.preferences.activeThemes,
      previousQuestionId,
      recentQuestionIds,
    });
    refreshQuestionUI();
  }

  const phaseButtons = [];
  for (const phaseKey of Object.values(CYCLE_PHASES)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "phase-pill";
    btn.textContent = CYCLE_PHASE_LABELS[phaseKey];
    btn.setAttribute("aria-pressed", String(phaseKey === selectedPhase));
    btn.addEventListener("click", () => {
      selectedPhase = phaseKey;
      for (const b of phaseButtons) {
        b.setAttribute("aria-pressed", String(b === btn));
      }
      pickNextQuestion(selectedPhase);
    });
    phaseButtons.push(btn);
    phaseSelector.appendChild(btn);
  }

  anotherQuestionBtn.addEventListener("click", () => {
    pickNextQuestion(selectedPhase);
  });

  refreshQuestionUI();
  phaseGroup.append(phaseLabel, phaseSelector);
  section.append(phaseGroup, promptCard);

  // Entry editor form
  const form = document.createElement("form");
  form.className = "form-grid";

  const themeField = document.createElement("div");
  themeField.className = "field";
  const themeLabel = document.createElement("label");
  themeLabel.htmlFor = "entry-theme";
  themeLabel.textContent = "Temática vital";
  const themeSelect = document.createElement("select");
  themeSelect.id = "entry-theme";
  for (const themeKey of Object.values(LIFE_THEMES)) {
    const opt = document.createElement("option");
    opt.value = themeKey;
    opt.textContent = LIFE_THEME_LABELS[themeKey];
    themeSelect.appendChild(opt);
  }
  themeSelect.value = editingEntry?.theme || currentQuestion.theme || LIFE_THEMES.WELLBEING;
  themeField.append(themeLabel, themeSelect);

  const titleField = document.createElement("div");
  titleField.className = "field";
  const titleLabel = document.createElement("label");
  titleLabel.htmlFor = "entry-title";
  titleLabel.textContent = "Título breve (opcional)";
  const titleInput = document.createElement("input");
  titleInput.id = "entry-title";
  titleInput.type = "text";
  titleInput.placeholder = "Ej. Pausa consciente de mitad de semana";
  titleInput.value = editingEntry?.title || "";
  titleField.append(titleLabel, titleInput);

  const contentField = document.createElement("div");
  contentField.className = "field";
  const contentLabel = document.createElement("label");
  contentLabel.htmlFor = "entry-content";
  contentLabel.textContent = "Tu reflexión";
  const contentInput = document.createElement("textarea");
  contentInput.id = "entry-content";
  contentInput.placeholder = "Escribe libremente. Todo se cifra localmente antes de guardarse...";
  contentInput.required = true;
  contentInput.value = editingEntry?.content || "";
  contentField.append(contentLabel, contentInput);

  const feedback = document.createElement("div");
  feedback.setAttribute("role", "status");

  const actions = document.createElement("div");
  actions.className = "actions-row";
  const saveBtn = document.createElement("button");
  saveBtn.type = "submit";
  saveBtn.className = "btn btn-primary";
  saveBtn.textContent = editingEntry ? "Actualizar entrada cifrada" : "Guardar entrada cifrada";
  actions.appendChild(saveBtn);

  if (editingEntry && onClearEdit) {
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn";
    cancelBtn.textContent = "Cancelar edición";
    cancelBtn.addEventListener("click", onClearEdit);
    actions.appendChild(cancelBtn);
  }

  form.append(themeField, titleField, contentField, feedback, actions);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const content = contentInput.value.trim();
    if (!content) {
      feedback.className = "alert alert-danger";
      feedback.textContent = "Escribe tu reflexión antes de guardar.";
      return;
    }

    saveBtn.disabled = true;
    const now = new Date().toISOString();
    const entry = {
      id: editingEntry?.id || `entry-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: editingEntry?.createdAt || now,
      updatedAt: now,
      phase: selectedPhase,
      theme: themeSelect.value,
      questionId: currentQuestion.id,
      questionText: currentQuestion.prompt,
      title: titleInput.value.trim() || "Reflexión diaria",
      content,
    };

    try {
      await sessionManager.saveEntry(entry);
      feedback.className = "alert alert-success";
      feedback.textContent = "Entrada cifrada y guardada localmente.";
      if (!editingEntry) {
        titleInput.value = "";
        contentInput.value = "";
        pickNextQuestion(selectedPhase);
      } else if (onClearEdit) {
        onClearEdit();
      }
    } catch (err) {
      feedback.className = "alert alert-danger";
      feedback.textContent = err.message || "Error al guardar la entrada.";
    } finally {
      saveBtn.disabled = false;
    }
  });

  section.appendChild(form);
  container.appendChild(section);
}
