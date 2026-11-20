/**
 * Authentication view: initial PIN setup, mandatory recovery code confirmation,
 * PIN unlock with exponential backoff feedback, and PIN reset via recovery code.
 */

function createKeypad(targetInput) {
  const grid = document.createElement("div");
  grid.className = "keypad-grid";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "Teclado numérico para PIN");

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "Borrar", "0", "←"];
  for (const key of keys) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "keypad-btn";
    btn.textContent = key;
    btn.addEventListener("click", () => {
      if (key === "Borrar") {
        targetInput.value = "";
      } else if (key === "←") {
        targetInput.value = targetInput.value.slice(0, -1);
      } else if (targetInput.value.length < 12) {
        targetInput.value += key;
      }
      targetInput.focus();
    });
    grid.appendChild(btn);
  }
  return grid;
}

/**
 * Renders AuthView into container.
 * @param {HTMLElement} container
 * @param {{
 *   hasKeyring: boolean,
 *   sessionManager: ReturnType<import("../../domain/sessionManager.js").createSessionManager>,
 *   onUnlocked: () => void
 * }} context
 */
export function renderAuthView(container, { hasKeyring, sessionManager, onUnlocked }) {
  container.replaceChildren();

  const wrapper = document.createElement("section");
  wrapper.className = "card auth-container";

  const title = document.createElement("h1");
  title.className = "brand-title";
  title.textContent = "Diario Didáctico Cíclico";
  wrapper.appendChild(title);

  const subtitle = document.createElement("p");
  subtitle.className = "muted-text";
  wrapper.appendChild(subtitle);

  const statusBox = document.createElement("div");
  statusBox.setAttribute("role", "alert");

  function showAlert(message, kind = "danger") {
    statusBox.className = `alert alert-${kind}`;
    statusBox.textContent = message;
  }

  function clearAlert() {
    statusBox.className = "";
    statusBox.textContent = "";
  }

  if (!hasKeyring) {
    subtitle.textContent =
      "Configura tu PIN local (se recomiendan 6 dígitos). Tus entradas se cifran en tu dispositivo con AES-GCM.";

    const form = document.createElement("form");
    form.className = "form-grid";

    const pinField = document.createElement("div");
    pinField.className = "field";
    const pinLabel = document.createElement("label");
    pinLabel.htmlFor = "setup-pin";
    pinLabel.textContent = "Nuevo PIN (mínimo 4 dígitos, 6 recomendados)";
    const pinInput = document.createElement("input");
    pinInput.id = "setup-pin";
    pinInput.type = "password";
    pinInput.inputMode = "numeric";
    pinInput.autocomplete = "new-password";
    pinInput.minLength = 4;
    pinInput.required = true;
    pinField.append(pinLabel, pinInput);

    const confirmField = document.createElement("div");
    confirmField.className = "field";
    const confirmLabel = document.createElement("label");
    confirmLabel.htmlFor = "setup-pin-confirm";
    confirmLabel.textContent = "Confirma tu PIN";
    const confirmInput = document.createElement("input");
    confirmInput.id = "setup-pin-confirm";
    confirmInput.type = "password";
    confirmInput.inputMode = "numeric";
    confirmInput.autocomplete = "new-password";
    confirmInput.minLength = 4;
    confirmInput.required = true;
    confirmField.append(confirmLabel, confirmInput);

    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.className = "btn btn-primary";
    submitBtn.textContent = "Crear bóveda cifrada";

    form.append(pinField, createKeypad(pinInput), confirmField, statusBox, submitBtn);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearAlert();
      const pin = pinInput.value.trim();
      const confirmPin = confirmInput.value.trim();

      if (pin.length < 4) {
        showAlert("El PIN debe tener al menos 4 caracteres.");
        return;
      }
      if (pin !== confirmPin) {
        showAlert("Los PIN ingresados no coinciden.");
        return;
      }

      submitBtn.disabled = true;
      try {
        const { recoveryCode } = await sessionManager.setupNewVault(pin);
        renderRecoveryConfirmation(wrapper, recoveryCode, onUnlocked);
      } catch (err) {
        showAlert(err.message || "No se pudo inicializar el diario.");
        submitBtn.disabled = false;
      }
    });

    wrapper.appendChild(form);
    container.appendChild(wrapper);
    return;
  }

  let recoveryMode = false;

  function renderUnlockOrRecovery() {
    clearAlert();
    const existingBody = wrapper.querySelector(".auth-body");
    if (existingBody) {
      existingBody.remove();
    }

    const body = document.createElement("div");
    body.className = "auth-body form-grid";

    if (!recoveryMode) {
      subtitle.textContent = "Ingresa tu PIN para descifrar tu diario en memoria.";

      const form = document.createElement("form");
      form.className = "form-grid";

      const pinField = document.createElement("div");
      pinField.className = "field";
      const pinLabel = document.createElement("label");
      pinLabel.htmlFor = "unlock-pin";
      pinLabel.textContent = "PIN de acceso";
      const pinInput = document.createElement("input");
      pinInput.id = "unlock-pin";
      pinInput.type = "password";
      pinInput.inputMode = "numeric";
      pinInput.autocomplete = "current-password";
      pinInput.required = true;
      pinField.append(pinLabel, pinInput);

      const unlockBtn = document.createElement("button");
      unlockBtn.type = "submit";
      unlockBtn.className = "btn btn-primary";
      unlockBtn.textContent = "Desbloquear diario";

      const switchBtn = document.createElement("button");
      switchBtn.type = "button";
      switchBtn.className = "btn";
      switchBtn.textContent = "Olvidé mi PIN · Usar código de recuperación";
      switchBtn.addEventListener("click", () => {
        recoveryMode = true;
        renderUnlockOrRecovery();
      });

      form.append(pinField, createKeypad(pinInput), statusBox, unlockBtn, switchBtn);

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        clearAlert();
        unlockBtn.disabled = true;
        try {
          await sessionManager.unlockWithPin(pinInput.value);
          onUnlocked();
        } catch (err) {
          showAlert(err.message || "PIN incorrecto.");
          pinInput.value = "";
          unlockBtn.disabled = false;
        }
      });

      body.appendChild(form);
    } else {
      subtitle.textContent =
        "Restablece tu PIN con tu código de recuperación sin perder tus entradas.";

      const form = document.createElement("form");
      form.className = "form-grid";

      const recField = document.createElement("div");
      recField.className = "field";
      const recLabel = document.createElement("label");
      recLabel.htmlFor = "recovery-code-input";
      recLabel.textContent = "Código de recuperación";
      const recInput = document.createElement("input");
      recInput.id = "recovery-code-input";
      recInput.type = "text";
      recInput.placeholder = "XXXX-XXXX-XXXX-XXXX-XXXX-XXXX";
      recInput.required = true;
      recField.append(recLabel, recInput);

      const newPinField = document.createElement("div");
      newPinField.className = "field";
      const newPinLabel = document.createElement("label");
      newPinLabel.htmlFor = "recovery-new-pin";
      newPinLabel.textContent = "Nuevo PIN (mínimo 4 dígitos)";
      const newPinInput = document.createElement("input");
      newPinInput.id = "recovery-new-pin";
      newPinInput.type = "password";
      newPinInput.inputMode = "numeric";
      newPinInput.minLength = 4;
      newPinInput.required = true;
      newPinField.append(newPinLabel, newPinInput);

      const resetBtn = document.createElement("button");
      resetBtn.type = "submit";
      resetBtn.className = "btn btn-primary";
      resetBtn.textContent = "Restablecer PIN";

      const backBtn = document.createElement("button");
      backBtn.type = "button";
      backBtn.className = "btn";
      backBtn.textContent = "Volver al acceso con PIN";
      backBtn.addEventListener("click", () => {
        recoveryMode = false;
        renderUnlockOrRecovery();
      });

      form.append(recField, newPinField, statusBox, resetBtn, backBtn);

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        clearAlert();
        if (newPinInput.value.trim().length < 4) {
          showAlert("El nuevo PIN debe tener al menos 4 caracteres.");
          return;
        }
        resetBtn.disabled = true;
        try {
          await sessionManager.resetPinWithRecovery(recInput.value, newPinInput.value);
          onUnlocked();
        } catch (err) {
          showAlert(err.message || "Código de recuperación inválido.");
          resetBtn.disabled = false;
        }
      });

      body.appendChild(form);
    }

    wrapper.appendChild(body);
  }

  renderUnlockOrRecovery();
  container.appendChild(wrapper);
}

function renderRecoveryConfirmation(wrapper, recoveryCode, onContinue) {
  wrapper.replaceChildren();

  const heading = document.createElement("h2");
  heading.className = "brand-title";
  heading.textContent = "Guarda tu código de recuperación";

  const info = document.createElement("p");
  info.className = "alert alert-warning";
  info.textContent =
    "Este código único te permite restablecer tu PIN sin perder tus entradas cifradas. No se volverá a mostrar.";

  const codeBox = document.createElement("div");
  codeBox.className = "recovery-box";
  codeBox.textContent = recoveryCode;

  const checkLabel = document.createElement("label");
  checkLabel.className = "checkbox-row";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = "confirm-recovery-saved";
  const checkText = document.createElement("span");
  checkText.textContent = "Confirmo que guardé mi código de recuperación en un lugar seguro.";
  checkLabel.append(checkbox, checkText);

  const continueBtn = document.createElement("button");
  continueBtn.type = "button";
  continueBtn.className = "btn btn-primary";
  continueBtn.textContent = "Continuar al diario";
  continueBtn.disabled = true;

  checkbox.addEventListener("change", () => {
    continueBtn.disabled = !checkbox.checked;
  });

  continueBtn.addEventListener("click", () => {
    onContinue();
  });

  wrapper.append(heading, info, codeBox, checkLabel, continueBtn);
}
