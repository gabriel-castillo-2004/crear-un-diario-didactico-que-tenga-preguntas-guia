/**
 * Settings view: life themes, cycle tracking mode, PIN rotation (DEK re-wrap),
 * browser storage persistence status, and encrypted backup export/import.
 */

import {
  CYCLE_MODE_LABELS,
  CYCLE_PHASES,
  CYCLE_PHASE_LABELS,
  CYCLE_TRACKING_MODES,
  LIFE_THEMES,
  LIFE_THEME_LABELS,
} from "../../types/domain.js";
import { getStorageStatus, requestPersistentStorage } from "../../storage/indexedDbStore.js";
import {
  applyValidatedBackup,
  exportEncryptedBackup,
  validateAndDryRunImport,
} from "../../storage/backupService.js";

/**
 * Renders SettingsView into container.
 * @param {HTMLElement} container
 * @param {{
 *   sessionManager: ReturnType<import("../../domain/sessionManager.js").createSessionManager>,
 *   store: ReturnType<import("../../storage/indexedDbStore.js").createIndexedDbStore>
 * }} context
 */
export function renderSettingsView(container, { sessionManager, store }) {
  container.replaceChildren();
  const state = sessionManager.getState();
  const prefs = state.preferences;

  const wrapper = document.createElement("div");
  wrapper.className = "settings-grid";

  // 1. Cycle & Themes Card
  const cycleCard = document.createElement("section");
  cycleCard.className = "card";
  const cycleTitle = document.createElement("h2");
  cycleTitle.textContent = "Ciclo y temáticas vitales";
  cycleCard.appendChild(cycleTitle);

  const cycleForm = document.createElement("form");
  cycleForm.className = "form-grid";

  const modeField = document.createElement("div");
  modeField.className = "field";
  const modeLabel = document.createElement("label");
  modeLabel.htmlFor = "settings-cycle-mode";
  modeLabel.textContent = "Modo de seguimiento";
  const modeSelect = document.createElement("select");
  modeSelect.id = "settings-cycle-mode";
  for (const modeKey of [
    CYCLE_TRACKING_MODES.ACTIVE_TRACKED,
    CYCLE_TRACKING_MODES.MANUAL_IRREGULAR,
    CYCLE_TRACKING_MODES.NON_MENSTRUATING,
  ]) {
    const opt = document.createElement("option");
    opt.value = modeKey;
    opt.textContent = CYCLE_MODE_LABELS[modeKey];
    modeSelect.appendChild(opt);
  }
  modeSelect.value = prefs.cycleMode;
  modeField.append(modeLabel, modeSelect);

  const manualPhaseField = document.createElement("div");
  manualPhaseField.className = "field";
  const manualPhaseLabel = document.createElement("label");
  manualPhaseLabel.htmlFor = "settings-manual-phase";
  manualPhaseLabel.textContent = "Fase preferida en modo manual / irregular";
  const manualPhaseSelect = document.createElement("select");
  manualPhaseSelect.id = "settings-manual-phase";
  for (const phaseKey of Object.values(CYCLE_PHASES)) {
    const opt = document.createElement("option");
    opt.value = phaseKey;
    opt.textContent = CYCLE_PHASE_LABELS[phaseKey];
    manualPhaseSelect.appendChild(opt);
  }
  manualPhaseSelect.value = prefs.manualPhase || CYCLE_PHASES.NEUTRAL;
  manualPhaseField.append(manualPhaseLabel, manualPhaseSelect);

  const lengthField = document.createElement("div");
  lengthField.className = "field";
  const lengthLabel = document.createElement("label");
  lengthLabel.htmlFor = "settings-cycle-length";
  lengthLabel.textContent = "Duración habitual del ciclo (días)";
  const lengthInput = document.createElement("input");
  lengthInput.id = "settings-cycle-length";
  lengthInput.type = "number";
  lengthInput.min = "20";
  lengthInput.max = "45";
  lengthInput.value = String(prefs.cycleLengthDays || 28);
  lengthField.append(lengthLabel, lengthInput);

  const themesField = document.createElement("div");
  themesField.className = "field";
  const themesHeading = document.createElement("span");
  themesHeading.style.fontWeight = "600";
  themesHeading.textContent = "Temáticas activas para preguntas guía";
  themesField.appendChild(themesHeading);

  const themeCheckboxes = new Map();
  for (const themeKey of Object.values(LIFE_THEMES)) {
    const label = document.createElement("label");
    label.className = "checkbox-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = prefs.activeThemes.includes(themeKey);
    themeCheckboxes.set(themeKey, cb);
    const span = document.createElement("span");
    span.textContent = LIFE_THEME_LABELS[themeKey];
    label.append(cb, span);
    themesField.appendChild(label);
  }

  const cycleFeedback = document.createElement("div");
  const saveCycleBtn = document.createElement("button");
  saveCycleBtn.type = "submit";
  saveCycleBtn.className = "btn btn-primary";
  saveCycleBtn.textContent = "Guardar preferencias";

  cycleForm.append(
    modeField,
    manualPhaseField,
    lengthField,
    themesField,
    cycleFeedback,
    saveCycleBtn
  );

  cycleForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const activeThemes = [];
    for (const [key, cb] of themeCheckboxes.entries()) {
      if (cb.checked) activeThemes.push(key);
    }
    const nextPrefs = {
      ...prefs,
      cycleMode: modeSelect.value,
      manualPhase: manualPhaseSelect.value,
      cycleLengthDays: Math.max(20, Math.min(45, Number(lengthInput.value) || 28)),
      activeThemes: activeThemes.length > 0 ? activeThemes : [LIFE_THEMES.WELLBEING],
    };
    await sessionManager.savePreferences(nextPrefs);
    cycleFeedback.className = "alert alert-success";
    cycleFeedback.textContent = "Preferencias actualizadas y cifradas.";
  });

  cycleCard.appendChild(cycleForm);

  // 2. Security & Backup Card
  const secCard = document.createElement("section");
  secCard.className = "card";
  const secTitle = document.createElement("h2");
  secTitle.textContent = "Seguridad y respaldos";
  secCard.appendChild(secTitle);

  // PIN change form
  const pinForm = document.createElement("form");
  pinForm.className = "form-grid";
  const curPinField = document.createElement("div");
  curPinField.className = "field";
  const curPinLabel = document.createElement("label");
  curPinLabel.htmlFor = "current-pin";
  curPinLabel.textContent = "PIN actual";
  const curPinInput = document.createElement("input");
  curPinInput.id = "current-pin";
  curPinInput.type = "password";
  curPinInput.inputMode = "numeric";
  curPinInput.required = true;
  curPinField.append(curPinLabel, curPinInput);

  const newPinField = document.createElement("div");
  newPinField.className = "field";
  const newPinLabel = document.createElement("label");
  newPinLabel.htmlFor = "new-pin";
  newPinLabel.textContent = "Nuevo PIN (re-envuelve tu clave sin tocar entradas)";
  const newPinInput = document.createElement("input");
  newPinInput.id = "new-pin";
  newPinInput.type = "password";
  newPinInput.inputMode = "numeric";
  newPinInput.minLength = 4;
  newPinInput.required = true;
  newPinField.append(newPinLabel, newPinInput);

  const pinFeedback = document.createElement("div");
  const changePinBtn = document.createElement("button");
  changePinBtn.type = "submit";
  changePinBtn.className = "btn btn-secondary";
  changePinBtn.textContent = "Cambiar PIN";

  pinForm.append(curPinField, newPinField, pinFeedback, changePinBtn);
  pinForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (newPinInput.value.trim().length < 4) {
      pinFeedback.className = "alert alert-danger";
      pinFeedback.textContent = "El nuevo PIN debe tener al menos 4 dígitos.";
      return;
    }
    try {
      await sessionManager.changePin(curPinInput.value, newPinInput.value);
      pinFeedback.className = "alert alert-success";
      pinFeedback.textContent = "PIN actualizado. Tus entradas permanecieron intactas.";
      curPinInput.value = "";
      newPinInput.value = "";
    } catch (err) {
      pinFeedback.className = "alert alert-danger";
      pinFeedback.textContent = err.message || "No se pudo cambiar el PIN.";
    }
  });

  // Storage persistence
  const storageBox = document.createElement("div");
  storageBox.className = "alert alert-info";
  storageBox.textContent = "Consultando estado de almacenamiento persistente...";

  const persistBtn = document.createElement("button");
  persistBtn.type = "button";
  persistBtn.className = "btn";
  persistBtn.textContent = "Solicitar almacenamiento persistente";

  async function refreshStorageBox() {
    const info = await getStorageStatus();
    const usageKb = info.usageBytes !== null ? `${Math.round(info.usageBytes / 1024)} KB` : "N/D";
    storageBox.textContent = `Persistencia: ${info.persisted ? "Activa" : "Estándar"} · Uso estimado: ${usageKb}`;
  }

  persistBtn.addEventListener("click", async () => {
    await requestPersistentStorage();
    await refreshStorageBox();
  });
  refreshStorageBox();

  // Backup export & dry-run import
  const backupActions = document.createElement("div");
  backupActions.className = "form-grid";

  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "btn btn-primary";
  exportBtn.textContent = "Exportar respaldo cifrado (.json)";

  const backupFeedback = document.createElement("div");

  exportBtn.addEventListener("click", async () => {
    try {
      const data = await sessionManager.exportBackupData();
      const bundle = exportEncryptedBackup(data);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `diario-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      backupFeedback.className = "alert alert-success";
      backupFeedback.textContent = "Respaldo cifrado exportado correctamente.";
    } catch (err) {
      backupFeedback.className = "alert alert-danger";
      backupFeedback.textContent = err.message || "Error al exportar respaldo.";
    }
  });

  const importField = document.createElement("div");
  importField.className = "field";
  const importLabel = document.createElement("label");
  importLabel.htmlFor = "import-backup-file";
  importLabel.textContent = "Importar respaldo cifrado (validación dry-run previa)";
  const importFile = document.createElement("input");
  importFile.id = "import-backup-file";
  importFile.type = "file";
  importFile.accept = "application/json,.json";

  const importPinInput = document.createElement("input");
  importPinInput.type = "password";
  importPinInput.placeholder = "PIN del respaldo a validar";

  const importBtn = document.createElement("button");
  importBtn.type = "button";
  importBtn.className = "btn btn-secondary";
  importBtn.textContent = "Validar e importar respaldo";

  importBtn.addEventListener("click", async () => {
    const file = importFile.files?.[0];
    if (!file) {
      backupFeedback.className = "alert alert-danger";
      backupFeedback.textContent = "Selecciona un archivo JSON de respaldo.";
      return;
    }
    if (!importPinInput.value) {
      backupFeedback.className = "alert alert-danger";
      backupFeedback.textContent = "Ingresa el PIN del respaldo para validar el descifrado.";
      return;
    }

    try {
      const rawText = await file.text();
      const result = await validateAndDryRunImport(rawText, importPinInput.value, "pin");
      await applyValidatedBackup(store, result.bundle);
      backupFeedback.className = "alert alert-success";
      backupFeedback.textContent = `Respaldo validado (${result.decryptedEntriesCount} entradas). Vuelve a desbloquear con el PIN del respaldo.`;
      sessionManager.lock("backup_imported");
    } catch (err) {
      backupFeedback.className = "alert alert-danger";
      backupFeedback.textContent = err.message || "Respaldo inválido o alterado (dry-run fallido).";
    }
  });

  importField.append(importLabel, importFile, importPinInput, importBtn);
  backupActions.append(exportBtn, importField, backupFeedback);

  secCard.append(pinForm, storageBox, persistBtn, backupActions);
  wrapper.append(cycleCard, secCard);
  container.appendChild(wrapper);
}
