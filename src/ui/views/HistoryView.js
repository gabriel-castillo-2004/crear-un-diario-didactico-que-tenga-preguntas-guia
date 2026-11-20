/**
 * History view: operates strictly on the in-memory decrypted index while unlocked.
 * Provides filtering by CyclePhase, LifeTheme, text search, progress summary, and editing.
 */

import {
  CYCLE_PHASES,
  CYCLE_PHASE_LABELS,
  LIFE_THEMES,
  LIFE_THEME_LABELS,
} from "../../types/domain.js";

/**
 * Renders HistoryView into container.
 * @param {HTMLElement} container
 * @param {{
 *   sessionManager: ReturnType<import("../../domain/sessionManager.js").createSessionManager>,
 *   onEditEntry: (entry: import("../../types/domain.js").JournalEntryPayload) => void
 * }} context
 */
export function renderHistoryView(container, { sessionManager, onEditEntry }) {
  container.replaceChildren();
  const { entries } = sessionManager.getState();

  const section = document.createElement("section");
  section.className = "card";

  const heading = document.createElement("h2");
  heading.textContent = "Historial y progreso";
  section.appendChild(heading);

  // Progress timeline summary by phase
  const timeline = document.createElement("div");
  timeline.className = "timeline-grid";
  for (const phaseKey of Object.values(CYCLE_PHASES)) {
    const count = entries.filter((e) => e.phase === phaseKey).length;
    const stat = document.createElement("div");
    stat.className = "timeline-stat";
    const num = document.createElement("strong");
    num.textContent = String(count);
    const lbl = document.createElement("span");
    lbl.className = "muted-text";
    lbl.textContent = CYCLE_PHASE_LABELS[phaseKey];
    stat.append(num, lbl);
    timeline.appendChild(stat);
  }
  section.appendChild(timeline);

  // Filters
  const filtersRow = document.createElement("div");
  filtersRow.className = "filters-row";

  const phaseFilterField = document.createElement("div");
  phaseFilterField.className = "field";
  const phaseFilterLabel = document.createElement("label");
  phaseFilterLabel.htmlFor = "filter-phase";
  phaseFilterLabel.textContent = "Filtrar por fase";
  const phaseFilter = document.createElement("select");
  phaseFilter.id = "filter-phase";
  const allPhaseOpt = document.createElement("option");
  allPhaseOpt.value = "all";
  allPhaseOpt.textContent = "Todas las fases";
  phaseFilter.appendChild(allPhaseOpt);
  for (const phaseKey of Object.values(CYCLE_PHASES)) {
    const opt = document.createElement("option");
    opt.value = phaseKey;
    opt.textContent = CYCLE_PHASE_LABELS[phaseKey];
    phaseFilter.appendChild(opt);
  }
  phaseFilterField.append(phaseFilterLabel, phaseFilter);

  const themeFilterField = document.createElement("div");
  themeFilterField.className = "field";
  const themeFilterLabel = document.createElement("label");
  themeFilterLabel.htmlFor = "filter-theme";
  themeFilterLabel.textContent = "Filtrar por temática";
  const themeFilter = document.createElement("select");
  themeFilter.id = "filter-theme";
  const allThemeOpt = document.createElement("option");
  allThemeOpt.value = "all";
  allThemeOpt.textContent = "Todas las temáticas";
  themeFilter.appendChild(allThemeOpt);
  for (const themeKey of Object.values(LIFE_THEMES)) {
    const opt = document.createElement("option");
    opt.value = themeKey;
    opt.textContent = LIFE_THEME_LABELS[themeKey];
    themeFilter.appendChild(opt);
  }
  themeFilterField.append(themeFilterLabel, themeFilter);

  const searchField = document.createElement("div");
  searchField.className = "field";
  const searchLabel = document.createElement("label");
  searchLabel.htmlFor = "filter-search";
  searchLabel.textContent = "Buscar en memoria";
  const searchInput = document.createElement("input");
  searchInput.id = "filter-search";
  searchInput.type = "search";
  searchInput.placeholder = "Palabra clave...";
  searchField.append(searchLabel, searchInput);

  filtersRow.append(phaseFilterField, themeFilterField, searchField);
  section.appendChild(filtersRow);

  const listContainer = document.createElement("div");
  listContainer.className = "history-list";
  section.appendChild(listContainer);

  function renderList() {
    listContainer.replaceChildren();
    const currentEntries = sessionManager.getState().entries;
    const pVal = phaseFilter.value;
    const tVal = themeFilter.value;
    const qVal = searchInput.value.trim().toLowerCase();

    const filtered = currentEntries.filter((entry) => {
      if (pVal !== "all" && entry.phase !== pVal) return false;
      if (tVal !== "all" && entry.theme !== tVal) return false;
      if (qVal) {
        const haystack = `${entry.title} ${entry.content} ${entry.questionText}`.toLowerCase();
        if (!haystack.includes(qVal)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted-text";
      empty.textContent =
        currentEntries.length === 0
          ? "Aún no tienes entradas guardadas."
          : "No hay entradas que coincidan con los filtros seleccionados.";
      listContainer.appendChild(empty);
      return;
    }

    for (const entry of filtered) {
      const card = document.createElement("article");
      card.className = "entry-card";

      const badges = document.createElement("div");
      badges.className = "badge-row";

      const pBadge = document.createElement("span");
      pBadge.className = "badge badge-accent";
      pBadge.textContent = CYCLE_PHASE_LABELS[entry.phase] || entry.phase;

      const tBadge = document.createElement("span");
      tBadge.className = "badge";
      tBadge.textContent = LIFE_THEME_LABELS[entry.theme] || entry.theme;

      const dateSpan = document.createElement("span");
      dateSpan.className = "muted-text";
      dateSpan.textContent = new Date(entry.updatedAt || entry.createdAt).toLocaleString("es-ES");

      badges.append(pBadge, tBadge, dateSpan);

      const titleEl = document.createElement("h3");
      titleEl.textContent = entry.title;

      const questionEl = document.createElement("p");
      questionEl.className = "muted-text";
      questionEl.textContent = `Pregunta: ${entry.questionText}`;

      const bodyEl = document.createElement("p");
      bodyEl.textContent = entry.content;

      const actions = document.createElement("div");
      actions.className = "actions-row";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn btn-secondary";
      editBtn.textContent = "Editar";
      editBtn.addEventListener("click", () => onEditEntry(entry));

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn btn-danger";
      deleteBtn.textContent = "Eliminar";
      deleteBtn.addEventListener("click", async () => {
        await sessionManager.deleteEntry(entry.id);
        renderHistoryView(container, { sessionManager, onEditEntry });
      });

      actions.append(editBtn, deleteBtn);
      card.append(badges, titleEl, questionEl, bodyEl, actions);
      listContainer.appendChild(card);
    }
  }

  phaseFilter.addEventListener("change", renderList);
  themeFilter.addEventListener("change", renderList);
  searchInput.addEventListener("input", renderList);

  renderList();
  container.appendChild(section);
}
