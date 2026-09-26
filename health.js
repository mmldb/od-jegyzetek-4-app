const DEFAULT_CATEGORIES = [
  { slug: "medicine", name: "Gyógyszer", emoji: "💊", entry_type: "medicine", unit: "ml", quick_save: false, sort_order: 10 },
  { slug: "temperature", name: "Lázmérés", emoji: "🌡️", entry_type: "temperature", unit: "°C", quick_save: false, sort_order: 20 },
  { slug: "stool", name: "Kaki", emoji: "💩", entry_type: "stool", unit: "", quick_save: false, sort_order: 30 },
  { slug: "drink", name: "Ivás", emoji: "🥤", entry_type: "number", unit: "ml", quick_save: false, sort_order: 40 },
  { slug: "inhalation", name: "Inhalálás", emoji: "🌫️", entry_type: "duration", unit: "perc", quick_save: false, sort_order: 50 },
  { slug: "nose", name: "Orrszívás", emoji: "👃", entry_type: "event", unit: "", quick_save: true, sort_order: 60 },
  { slug: "cold-air", name: "Hideg levegő", emoji: "❄️", entry_type: "duration", unit: "perc", quick_save: false, sort_order: 70 },
  { slug: "sleep", name: "Alvás", emoji: "💤", entry_type: "duration", unit: "óra", quick_save: false, sort_order: 80 },
  { slug: "other", name: "Egyéb", emoji: "✎", entry_type: "text", unit: "", quick_save: false, sort_order: 90 },
];

const KIND_LABELS = {
  medicine: "gyógyszer",
  temperature: "hőmérséklet",
  stool: "állag + mennyiség",
  event: "csak esemény",
  number: "szám + egység",
  duration: "időtartam",
  choice: "választható állapot",
  text: "szabad szöveg",
};

const byId = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function localInputValue(date = new Date()) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

function timeLabel(iso) {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  const day = sameDay ? "ma" : date.toLocaleDateString("hu-HU", { month: "short", day: "numeric" });
  return day + " " + date.toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" });
}

function authorName(email) {
  const normalized = String(email || "").toLowerCase();
  if (normalized === "arpadi.tamas@gmail.com") return "Tamás";
  if (normalized === "info@vajdaorsolya.com") return "Orsi";
  return email || "Ismeretlen";
}

function option(value, current) {
  return `<option${value === current ? " selected" : ""}>${escapeHtml(value)}</option>`;
}

export function createHealthFeature({ supabase, getContext, showToast, setSync, onExit }) {
  const view = byId("healthView");
  const logPanel = byId("healthLogPanel");
  const categoriesPanel = byId("healthCategoriesPanel");
  const categoryGrid = byId("healthCategoryGrid");
  const categoryList = byId("healthCategoryList");
  const timeline = byId("healthTimeline");
  const childLabel = byId("healthChildLabel");
  const feedback = byId("healthFeedback");
  const feedbackText = byId("healthFeedbackText");
  const undoButton = byId("healthUndo");
  const detailsButton = byId("healthDetails");
  const entryOverlay = byId("healthEntryOverlay");
  const entryTitle = byId("healthEntryTitle");
  const entryForm = byId("healthEntryForm");
  const entryFields = byId("healthEntryFields");
  const entrySave = byId("healthEntrySave");
  const categoryOverlay = byId("healthCategoryOverlay");
  const categoryTitle = byId("healthCategoryTitle");
  const categoryForm = byId("healthCategoryForm");
  const categoryKind = byId("healthCategoryKind");
  const categoryUnitField = byId("healthCategoryUnitField");
  const categoryOptionsField = byId("healthCategoryOptionsField");

  const state = {
    child: "Marci",
    categories: [],
    entries: [],
    activeCategory: null,
    editingEntryId: null,
    editingCategoryId: null,
    realtimeChannel: null,
    undo: null,
    details: null,
  };

  const preview = {
    categories: DEFAULT_CATEGORIES.map((category, index) => ({ id: `preview-health-${index}`, ...category })),
    entries: [],
  };

  function context() {
    return getContext();
  }

  function query(table) {
    if (!context().workspaceId) throw new Error("Missing workspace");
    return supabase.from(table);
  }

  async function ensureCategories() {
    if (context().preview) {
      state.categories = preview.categories.map((category) => ({ ...category }));
      return;
    }
    const { data, error } = await query("health_categories")
      .select("*")
      .eq("workspace_id", context().workspaceId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    if (data?.length) {
      state.categories = data;
      return;
    }
    const rows = DEFAULT_CATEGORIES.map((category) => ({ ...category, workspace_id: context().workspaceId }));
    const { error: insertError } = await query("health_categories").upsert(rows, { onConflict: "workspace_id,slug" });
    if (insertError) throw insertError;
    const { data: inserted, error: reloadError } = await query("health_categories")
      .select("*")
      .eq("workspace_id", context().workspaceId)
      .order("sort_order", { ascending: true });
    if (reloadError) throw reloadError;
    state.categories = inserted ?? [];
  }

  async function fetchEntries() {
    if (context().preview) {
      state.entries = preview.entries.map((entry) => ({ ...entry }));
      return;
    }
    const { data, error } = await query("health_entries")
      .select("*")
      .eq("workspace_id", context().workspaceId)
      .order("occurred_at", { ascending: false });
    if (error) throw error;
    state.entries = data ?? [];
  }

  async function insertEntry(values) {
    if (context().preview) {
      const entry = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...values };
      preview.entries.push(entry);
      return entry;
    }
    const { data, error } = await query("health_entries").insert(values).select().single();
    if (error) throw error;
    return data;
  }

  async function updateEntry(id, values) {
    if (context().preview) {
      const index = preview.entries.findIndex((entry) => entry.id === id);
      if (index >= 0) preview.entries[index] = { ...preview.entries[index], ...values };
      return;
    }
    const { error } = await query("health_entries").update(values)
      .eq("workspace_id", context().workspaceId).eq("id", id);
    if (error) throw error;
  }

  async function deleteEntry(id) {
    if (context().preview) {
      preview.entries = preview.entries.filter((entry) => entry.id !== id);
      return;
    }
    const { error } = await query("health_entries").delete()
      .eq("workspace_id", context().workspaceId).eq("id", id);
    if (error) throw error;
  }

  async function saveCategory(values) {
    if (context().preview) {
      if (state.editingCategoryId) {
        const index = preview.categories.findIndex((category) => category.id === state.editingCategoryId);
        if (index >= 0) preview.categories[index] = { ...preview.categories[index], ...values };
        return preview.categories[index];
      }
      const category = { id: crypto.randomUUID(), slug: null, sort_order: preview.categories.length * 10 + 10, ...values };
      preview.categories.push(category);
      return category;
    }
    if (state.editingCategoryId) {
      const { data, error } = await query("health_categories").update(values)
        .eq("workspace_id", context().workspaceId).eq("id", state.editingCategoryId).select().single();
      if (error) throw error;
      return data;
    }
    const maximum = state.categories.reduce((result, category) => Math.max(result, category.sort_order || 0), 0);
    const { data, error } = await query("health_categories").insert({
      ...values,
      workspace_id: context().workspaceId,
      sort_order: maximum + 10,
    }).select().single();
    if (error) throw error;
    return data;
  }

  function renderCategories() {
    categoryGrid.innerHTML = state.categories.map((category) => `
      <button type="button" class="healthCategoryButton" data-health-category="${escapeHtml(category.id)}" aria-label="${escapeHtml(category.name)}${category.quick_save ? ", azonnali mentés" : ""}" title="${escapeHtml(category.name)}">
        <span aria-hidden="true">${escapeHtml(category.emoji || "＋")}</span>
        ${category.quick_save ? '<span class="healthQuickMark" aria-hidden="true">⚡</span>' : ""}
      </button>`).join("");
    categoryList.innerHTML = state.categories.map((category) => `
      <div class="healthCategoryRow">
        <span class="healthCategoryInfo"><strong>${escapeHtml(category.emoji)} ${escapeHtml(category.name)}</strong><small>${escapeHtml(KIND_LABELS[category.entry_type] || category.entry_type)}${category.quick_save ? " · ⚡ gyors mentés" : ""}</small></span>
        <button type="button" data-health-edit-category="${escapeHtml(category.id)}">Szerkesztés</button>
      </div>`).join("");
  }

  function renderTimeline() {
    childLabel.textContent = state.child;
    const rows = state.entries.filter((entry) => entry.child_name === state.child);
    timeline.innerHTML = rows.length ? rows.map((entry) => `
      <article class="healthEntry">
        <div class="healthEntryHead"><strong>${escapeHtml(entry.category_emoji || "•")} ${escapeHtml(entry.category_name)}</strong><span class="healthEntryTime">${escapeHtml(timeLabel(entry.occurred_at))}</span></div>
        ${entry.detail ? `<p>${escapeHtml(entry.detail)}</p>` : ""}
        ${entry.note ? `<p class="healthEntryMeta">${escapeHtml(entry.note)}</p>` : ""}
        <div class="healthEntryHead"><p class="healthEntryMeta">Rögzítette: ${escapeHtml(entry.author_name)}</p><button type="button" class="healthEntryMenu" data-health-entry-menu="${escapeHtml(entry.id)}" aria-label="Bejegyzés műveletei">•••</button></div>
        <div class="healthEntryActions hidden" data-health-entry-actions="${escapeHtml(entry.id)}">
          <button type="button" data-health-edit-entry="${escapeHtml(entry.id)}">Szerkesztés</button>
          <button type="button" class="danger" data-health-delete-entry="${escapeHtml(entry.id)}">Törlés</button>
        </div>
      </article>`).join("") : '<p class="healthEmpty">Még nincs bejegyzés.</p>';
  }

  function showFeedback(message, undo = null, details = null) {
    state.undo = undo;
    state.details = details;
    feedbackText.textContent = message;
    undoButton.classList.toggle("hidden", !undo);
    detailsButton.classList.toggle("hidden", !details);
    feedback.classList.remove("hidden");
  }

  function hideFeedback() {
    state.undo = null;
    state.details = null;
    feedback.classList.add("hidden");
  }

  function commonFields(entry = {}) {
    return `
      <label class="field"><span>Mikor történt?</span><input class="healthFieldInput" name="occurred_at" type="datetime-local" value="${localInputValue(entry.occurred_at ? new Date(entry.occurred_at) : new Date())}" /></label>
      <label class="field"><span>Megjegyzés (nem kötelező)</span><textarea class="healthFieldInput" name="note" placeholder="Bármilyen további részlet">${escapeHtml(entry.note || "")}</textarea></label>`;
  }

  function fieldsFor(category, entry = {}) {
    const item = escapeHtml(entry.item_value || "");
    const value = escapeHtml(entry.amount_value || "");
    const unit = escapeHtml(entry.unit_value || category.unit || "");
    if (category.entry_type === "medicine") return `
      <label class="field"><span>Gyógyszer neve</span><input class="healthFieldInput" name="item" list="healthMedicineList" placeholder="pl. Nurofen" value="${item}" required /><datalist id="healthMedicineList"><option value="Nurofen"><option value="Panadol"><option value="Antibiotikum"><option value="Orrspray"></datalist></label>
      <div class="healthFieldRow"><label class="field"><span>Mennyiség</span><input class="healthFieldInput" name="value" type="number" inputmode="decimal" step="0.1" value="${value}" /></label><label class="field"><span>Egység</span><select name="unit">${["ml","mg","csepp","adag"].map((name) => option(name, unit || "ml")).join("")}</select></label></div>${commonFields(entry)}`;
    if (category.entry_type === "temperature") return `
      <div class="healthFieldRow"><label class="field"><span>Hőmérséklet</span><input class="healthFieldInput" name="value" type="number" inputmode="decimal" step="0.1" value="${value}" required /><input name="unit" type="hidden" value="°C" /></label><label class="field"><span>Mérés</span><select name="item"><option value="">nincs megadva</option>${["hónaljban","fülben","homlokon"].map((name) => option(name, entry.item_value || "")).join("")}</select></label></div>${commonFields(entry)}`;
    if (category.entry_type === "stool") return `
      <label class="field"><span>Állag</span><select name="item"><option value="">nincs megadva</option>${["normál","kemény","puha","híg"].map((name) => option(name, entry.item_value || "")).join("")}</select></label>
      <label class="field"><span>Mennyiség</span><select name="value"><option value="">nincs megadva</option>${["kevés","közepes","sok"].map((name) => option(name, entry.amount_value || "")).join("")}</select></label>${commonFields(entry)}`;
    if (category.entry_type === "number") return `
      <label class="field"><span>Típus (nem kötelező)</span><input class="healthFieldInput" name="item" placeholder="pl. víz" value="${item}" /></label>
      <div class="healthFieldRow"><label class="field"><span>Mennyiség</span><input class="healthFieldInput" name="value" type="number" inputmode="decimal" step="0.1" value="${value}" /></label><label class="field"><span>Egység</span><input class="healthFieldInput" name="unit" value="${unit}" /></label></div>${commonFields(entry)}`;
    if (category.entry_type === "duration") return `
      <label class="field"><span>Típus vagy anyag (nem kötelező)</span><input class="healthFieldInput" name="item" placeholder="pl. sóoldat" value="${item}" /></label>
      <div class="healthFieldRow"><label class="field"><span>Időtartam</span><input class="healthFieldInput" name="value" type="number" inputmode="decimal" step="1" value="${value}" /></label><label class="field"><span>Egység</span><input class="healthFieldInput" name="unit" value="${unit || "perc"}" /></label></div>${commonFields(entry)}`;
    if (category.entry_type === "choice") return `<label class="field"><span>Állapot</span><select name="value"><option value="">nincs megadva</option>${(category.options || []).map((name) => option(name, entry.amount_value || "")).join("")}</select></label>${commonFields(entry)}`;
    if (category.entry_type === "text") return `<label class="field"><span>Részlet</span><input class="healthFieldInput" name="item" placeholder="Mi történt?" value="${item}" /></label>${commonFields(entry)}`;
    return `<p class="healthEntryMeta">Ehhez az eseményhez nincs kötelező részlet.</p>${commonFields(entry)}`;
  }

  function entryDetail(data) {
    const item = String(data.get("item") || "").trim();
    const value = String(data.get("value") || "").trim().replace(".", ",");
    const unit = String(data.get("unit") || "").trim();
    return [item, value ? value + (unit ? " " + unit : "") : ""].filter(Boolean).join(" · ");
  }

  function openEntry(category, entry = null) {
    state.activeCategory = category;
    state.editingEntryId = entry?.id || null;
    entryTitle.textContent = `${category.emoji || "＋"} ${category.name}${entry ? " szerkesztése" : ""}`;
    entryFields.innerHTML = fieldsFor(category, entry || {});
    entrySave.textContent = entry ? "Módosítás mentése" : "Mentés";
    entryOverlay.classList.remove("hidden");
    entryOverlay.setAttribute("aria-hidden", "false");
  }

  function closeEntry() {
    entryOverlay.classList.add("hidden");
    entryOverlay.setAttribute("aria-hidden", "true");
    state.activeCategory = null;
    state.editingEntryId = null;
  }

  function updateCategoryFields() {
    categoryUnitField.classList.toggle("hidden", !["number", "duration"].includes(categoryKind.value));
    categoryOptionsField.classList.toggle("hidden", categoryKind.value !== "choice");
  }

  function openCategory(category = null) {
    state.editingCategoryId = category?.id || null;
    categoryTitle.textContent = category ? `${category.emoji} ${category.name} szerkesztése` : "Új kategória";
    byId("healthCategoryEmoji").value = category?.emoji || "";
    byId("healthCategoryName").value = category?.name || "";
    categoryKind.value = category?.entry_type || "event";
    byId("healthCategoryUnit").value = category?.unit || "";
    byId("healthCategoryOptions").value = (category?.options || []).join(", ");
    byId("healthCategoryQuick").checked = Boolean(category?.quick_save);
    updateCategoryFields();
    categoryOverlay.classList.remove("hidden");
    categoryOverlay.setAttribute("aria-hidden", "false");
  }

  function closeCategory() {
    categoryOverlay.classList.add("hidden");
    categoryOverlay.setAttribute("aria-hidden", "true");
    state.editingCategoryId = null;
  }

  async function refresh() {
    setSync("Egészségnapló betöltése…", "saving");
    await ensureCategories();
    await fetchEntries();
    renderCategories();
    renderTimeline();
    setSync(context().preview ? "Preview mód" : "Naprakész", "saved");
  }

  function stopRealtime() {
    if (state.realtimeChannel && supabase) supabase.removeChannel(state.realtimeChannel);
    state.realtimeChannel = null;
  }

  function setupRealtime() {
    stopRealtime();
    if (context().preview || !supabase) return;
    const filter = "workspace_id=eq." + context().workspaceId;
    state.realtimeChannel = supabase.channel("od4-health-" + context().workspaceId)
      .on("postgres_changes", { event: "*", schema: "public", table: "health_categories", filter }, () => {
        ensureCategories().then(renderCategories).catch(console.error);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "health_entries", filter }, () => {
        fetchEntries().then(renderTimeline).catch(console.error);
      })
      .subscribe();
  }

  async function activate() {
    view.classList.remove("hidden");
    try {
      await refresh();
      setupRealtime();
    } catch (error) {
      setSync("Betöltési hiba", "error");
      showToast(error?.message?.includes("health_") ? "Az egészségnapló adatbázisa még nincs frissítve." : "Nem sikerült betölteni az egészségnaplót.");
      console.error(error);
    }
  }

  function deactivate() {
    view.classList.add("hidden");
    closeEntry();
    closeCategory();
    stopRealtime();
    hideFeedback();
  }

  byId("healthBack").addEventListener("click", onExit);
  document.querySelectorAll("[data-health-child]").forEach((button) => button.addEventListener("click", () => {
    state.child = button.dataset.healthChild;
    document.querySelectorAll("[data-health-child]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    hideFeedback();
    renderTimeline();
  }));
  document.querySelectorAll("[data-health-tab]").forEach((button) => button.addEventListener("click", () => {
    const log = button.dataset.healthTab === "log";
    document.querySelectorAll("[data-health-tab]").forEach((item) => item.setAttribute("aria-selected", String(item === button)));
    logPanel.classList.toggle("hidden", !log);
    categoriesPanel.classList.toggle("hidden", log);
  }));
  categoryGrid.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-health-category]");
    if (!button) return;
    const category = state.categories.find((item) => item.id === button.dataset.healthCategory);
    if (!category) return;
    if (!category.quick_save) {
      openEntry(category);
      return;
    }
    try {
      const values = {
        workspace_id: context().workspaceId,
        category_id: category.id,
        child_name: state.child,
        category_name: category.name,
        category_emoji: category.emoji,
        item_value: "",
        amount_value: "",
        unit_value: "",
        detail: "",
        note: "",
        occurred_at: new Date().toISOString(),
        author_name: authorName(context().user?.email),
        created_by: context().preview ? null : context().user?.id,
      };
      const created = await insertEntry(values);
      await fetchEntries();
      renderTimeline();
      showFeedback(`${category.name} elmentve`, async () => {
        await deleteEntry(created.id);
        await fetchEntries();
        renderTimeline();
      }, () => openEntry(category, created));
    } catch (error) {
      showToast("Nem sikerült elmenteni a bejegyzést.");
      console.error(error);
    }
  });
  timeline.addEventListener("click", async (event) => {
    const menu = event.target.closest("[data-health-entry-menu]");
    if (menu) {
      timeline.querySelector(`[data-health-entry-actions="${CSS.escape(menu.dataset.healthEntryMenu)}"]`)?.classList.toggle("hidden");
      return;
    }
    const edit = event.target.closest("[data-health-edit-entry]");
    if (edit) {
      const entry = state.entries.find((item) => item.id === edit.dataset.healthEditEntry);
      const category = state.categories.find((item) => item.id === entry?.category_id);
      if (entry && category) openEntry(category, entry);
      return;
    }
    const remove = event.target.closest("[data-health-delete-entry]");
    if (!remove) return;
    const entry = state.entries.find((item) => item.id === remove.dataset.healthDeleteEntry);
    if (!entry) return;
    try {
      await deleteEntry(entry.id);
      await fetchEntries();
      renderTimeline();
      showFeedback("Bejegyzés törölve", async () => {
        await insertEntry({ ...entry, created_by: context().preview ? null : context().user?.id });
        await fetchEntries();
        renderTimeline();
      });
    } catch (error) {
      showToast("Nem sikerült törölni a bejegyzést.");
      console.error(error);
    }
  });
  undoButton.addEventListener("click", async () => {
    if (!state.undo) return;
    const action = state.undo;
    hideFeedback();
    try { await action(); } catch (error) { showToast("Nem sikerült visszavonni a műveletet."); console.error(error); }
  });
  detailsButton.addEventListener("click", () => {
    const action = state.details;
    hideFeedback();
    action?.();
  });
  entryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.activeCategory || !entryForm.reportValidity()) return;
    entrySave.disabled = true;
    const data = new FormData(entryForm);
    const occurredAt = String(data.get("occurred_at") || "");
    const values = {
      workspace_id: context().workspaceId,
      category_id: state.activeCategory.id,
      child_name: state.child,
      category_name: state.activeCategory.name,
      category_emoji: state.activeCategory.emoji,
      item_value: String(data.get("item") || "").trim(),
      amount_value: String(data.get("value") || "").trim(),
      unit_value: String(data.get("unit") || "").trim(),
      detail: entryDetail(data),
      note: String(data.get("note") || "").trim(),
      occurred_at: occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString(),
      author_name: authorName(context().user?.email),
      created_by: context().preview ? null : context().user?.id,
    };
    try {
      if (state.editingEntryId) await updateEntry(state.editingEntryId, values);
      else await insertEntry(values);
      closeEntry();
      await fetchEntries();
      renderTimeline();
    } catch (error) {
      showToast("Nem sikerült elmenteni a bejegyzést.");
      console.error(error);
    } finally {
      entrySave.disabled = false;
    }
  });
  byId("healthEntryClose").addEventListener("click", closeEntry);
  byId("healthEntryCancel").addEventListener("click", closeEntry);
  entryOverlay.addEventListener("click", (event) => { if (event.target === entryOverlay) closeEntry(); });
  byId("healthNewCategory").addEventListener("click", () => openCategory());
  categoryList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-health-edit-category]");
    const category = state.categories.find((item) => item.id === button?.dataset.healthEditCategory);
    if (category) openCategory(category);
  });
  categoryKind.addEventListener("change", updateCategoryFields);
  categoryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!categoryForm.reportValidity()) return;
    const values = {
      name: byId("healthCategoryName").value.trim(),
      emoji: byId("healthCategoryEmoji").value.trim(),
      entry_type: categoryKind.value,
      unit: byId("healthCategoryUnit").value.trim() || (categoryKind.value === "duration" ? "perc" : ""),
      options: byId("healthCategoryOptions").value.split(",").map((item) => item.trim()).filter(Boolean),
      quick_save: byId("healthCategoryQuick").checked,
    };
    try {
      await saveCategory(values);
      closeCategory();
      await ensureCategories();
      renderCategories();
    } catch (error) {
      showToast("Nem sikerült elmenteni a kategóriát.");
      console.error(error);
    }
  });
  byId("healthCategoryClose").addEventListener("click", closeCategory);
  byId("healthCategoryCancel").addEventListener("click", closeCategory);
  categoryOverlay.addEventListener("click", (event) => { if (event.target === categoryOverlay) closeCategory(); });

  return { activate, deactivate, refresh };
}
