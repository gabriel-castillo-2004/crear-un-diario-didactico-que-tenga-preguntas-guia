/**
 * Application orchestrator: initializes IndexedDB and sessionManager,
 * routes between AuthView (locked) and Journal/History/Settings views (unlocked),
 * and purges DOM content immediately upon session lock.
 */

import { createIndexedDbStore } from "./storage/indexedDbStore.js";
import { createSessionManager } from "./domain/sessionManager.js";
import { renderAuthView } from "./ui/views/AuthView.js";
import { renderJournalView } from "./ui/views/JournalView.js";
import { renderHistoryView } from "./ui/views/HistoryView.js";
import { renderSettingsView } from "./ui/views/SettingsView.js";

export async function bootstrapApp(rootElement = document.getElementById("app")) {
  if (!rootElement) {
    return null;
  }

  const store = createIndexedDbStore();
  const sessionManager = createSessionManager(store);

  let activeTab = "journal";
  let editingEntry = null;

  async function render() {
    const { isLocked } = sessionManager.getState();

    // Purge previous DOM tree completely before rendering locked or unlocked state
    rootElement.replaceChildren();

    if (isLocked) {
      const hasKeyring = await store.hasKeyring();
      renderAuthView(rootElement, {
        hasKeyring,
        sessionManager,
        onUnlocked: () => {
          activeTab = "journal";
          editingEntry = null;
          render();
        },
      });
      return;
    }

    const shell = document.createElement("div");
    shell.className = "app-shell";

    const header = document.createElement("header");
    header.className = "app-header";

    const brandRow = document.createElement("div");
    brandRow.className = "brand-row";
    const brandTitle = document.createElement("span");
    brandTitle.className = "brand-title";
    brandTitle.textContent = "Diario Didáctico Cíclico";
    brandRow.appendChild(brandTitle);

    const nav = document.createElement("nav");
    nav.className = "nav-bar";
    nav.setAttribute("aria-label", "Navegación principal");

    const tabs = [
      { id: "journal", label: "Diario" },
      { id: "history", label: "Historial" },
      { id: "settings", label: "Ajustes" },
    ];

    for (const tab of tabs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nav-btn";
      btn.textContent = tab.label;
      if (activeTab === tab.id) {
        btn.setAttribute("aria-current", "page");
      }
      btn.addEventListener("click", () => {
        activeTab = tab.id;
        if (tab.id !== "journal") {
          editingEntry = null;
        }
        render();
      });
      nav.appendChild(btn);
    }

    const lockBtn = document.createElement("button");
    lockBtn.type = "button";
    lockBtn.className = "btn btn-danger";
    lockBtn.textContent = "Bloquear";
    lockBtn.addEventListener("click", () => {
      sessionManager.lock("manual");
    });
    nav.appendChild(lockBtn);

    header.append(brandRow, nav);

    const viewContainer = document.createElement("div");
    shell.append(header, viewContainer);
    rootElement.appendChild(shell);

    if (activeTab === "journal") {
      renderJournalView(viewContainer, {
        sessionManager,
        editingEntry,
        onClearEdit: () => {
          editingEntry = null;
          render();
        },
      });
    } else if (activeTab === "history") {
      renderHistoryView(viewContainer, {
        sessionManager,
        onEditEntry: (entry) => {
          editingEntry = entry;
          activeTab = "journal";
          render();
        },
      });
    } else if (activeTab === "settings") {
      renderSettingsView(viewContainer, { sessionManager, store });
    }
  }

  sessionManager.subscribe(({ isLocked }) => {
    if (isLocked) {
      editingEntry = null;
      render();
    }
  });

  await render();
  return { store, sessionManager };
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    bootstrapApp();
  });
}
