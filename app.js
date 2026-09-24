import { isConfigured, supabase } from "./supabase.js";

const $ = (id) => document.getElementById(id);
const PLANNER_VALUE = "__planner__";
const TODO_BG_VARS = [
  "--p-orange", "--p-yellow", "--p-green", "--p-blueL",
  "--p-blue", "--p-pink", "--p-gray-1",
];
const PLANNER_DAY_BG_VARS_BY_WEEKDAY = {
  1: "--p-orange", 2: "--p-yellow", 3: "--p-green",
  4: "--p-blueL", 5: "--p-blue", 6: "--p-pink", 0: "--p-gray-1",
};

const loadingView = $("loadingView");
const authView = $("authView");
const noAccessView = $("noAccessView");
const appShell = $("appShell");
const authForm = $("authForm");
const emailInput = $("emailInput");
const loginButton = $("loginButton");
const previewButton = $("previewButton");
const authMessage = $("authMessage");
const logoutButton = $("logoutButton");
const noAccessLogout = $("noAccessLogout");
const workspaceName = $("workspaceName");
const userEmail = $("userEmail");
const syncStatus = $("syncStatus");
const toast = $("toast");
const categorySelect = $("categorySelect");
const newCategoryBtn = $("newCategory");
const editCategoryBtn = $("editCategory");
const deleteCategoryBtn = $("deleteCategory");
const clearCheckedBtn = $("clearChecked");
const checklistActions = $("checklistActions");
const checklistView = $("checklistView");
const itemForm = $("itemForm");
const itemInput = $("itemInput");
const list = $("list");
const plannerView = $("plannerView");
const plannerPrev = $("plannerPrev");
const plannerNext = $("plannerNext");
const plannerToday = $("plannerToday");
const plannerRange = $("plannerRange");
const plannerLabel = $("plannerLabel");
const plannerDays = $("plannerDays");
const modalOverlay = $("modalOverlay");
const modalTitle = $("modalTitle");
const modalName = $("modalName");
const modalClose = $("modalClose");
const modalCancel = $("modalCancel");
const modalSave = $("modalSave");

const state = {
  preview: false,
  user: null,
  workspaceId: null,
  workspaceRole: null,
  categories: [],
  activeCategoryId: null,
  todos: [],
  weekStart: startOfWeek(new Date()),
  saveQueue: new Map(),
  saveTimers: new Map(),
  realtimeChannel: null,
};

const previewStore = {
  categories: [
    { id: "preview-category-home", name: "Otthon", created_at: "2026-01-01T09:00:00Z" },
    { id: "preview-category-shopping", name: "Bevásárlás", created_at: "2026-01-02T09:00:00Z" },
  ],
  todos: [
    { id: "preview-todo-1", category_id: "preview-category-home", text: "Növények meglocsolása", done: false, sort_order: 0, color_idx: 2 },
    { id: "preview-todo-2", category_id: "preview-category-home", text: "Csomag átvétele", done: true, sort_order: 1, color_idx: 3 },
    { id: "preview-todo-3", category_id: "preview-category-shopping", text: "Kávé", done: false, sort_order: 0, color_idx: 1 },
    { id: "preview-todo-4", category_id: "preview-category-shopping", text: "Zabtej", done: false, sort_order: 1, color_idx: 5 },
  ],
  plannerDays: new Map([
    [toISODate(new Date()), { text: "Közös vacsora 19:00", work: false }],
    [toISODate(addDays(new Date(), 1)), { text: "Bevásárlás hazafelé", work: false }],
  ]),
};

let modalMode = "new";
let toastTimer = null;
let sessionRevision = 0;

function showView(view) {
  [loadingView, authView, noAccessView, appShell].forEach((element) => {
    element.classList.toggle("hidden", element !== view);
  });
  if (view !== appShell) modalOverlay.classList.add("hidden");
}

function showToast(message, kind = "error") {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.dataset.kind = kind;
  toast.classList.remove("hidden");
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 4000);
}

function setSync(text, kind = "idle") {
  syncStatus.textContent = text;
  syncStatus.dataset.kind = kind;
}

function friendlyError(error) {
  console.error(error);
  if (!navigator.onLine) return "Nincs internetkapcsolat. A módosítás még nincs elmentve.";
  if (error?.code === "42501") return "Ehhez a művelethez nincs jogosultságod.";
  if (error?.code === "23505") return "Ez a bejegyzés már létezik.";
  return "Nem sikerült a művelet. Próbáld meg újra.";
}

function esc(value) {
  return (value ?? "").toString()
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function openModal({ title, initialValue }) {
  modalTitle.textContent = title;
  modalName.value = initialValue ?? "";
  modalOverlay.classList.remove("hidden");
  modalOverlay.setAttribute("aria-hidden", "false");
  modalName.focus();
  modalName.select();
}

function closeModal() {
  modalOverlay.classList.add("hidden");
  modalOverlay.setAttribute("aria-hidden", "true");
}

function isPlannerSelected() {
  return categorySelect.value === PLANNER_VALUE;
}

function setViewPlanner(on) {
  checklistView.classList.toggle("hidden", on);
  checklistActions.classList.toggle("hidden", on);
  plannerView.classList.toggle("hidden", !on);
}

function startOfWeek(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  const day = result.getDay();
  result.setDate(result.getDate() + (day === 0 ? -6 : 1) - day);
  return result;
}

function addDays(date, amount) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function toISODate(date) {
  const value = new Date(date);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function fmtRange(startDate) {
  const endDate = addDays(startDate, 6);
  const part = (date) => String(date.getMonth() + 1).padStart(2, "0") + "." + String(date.getDate()).padStart(2, "0");
  return part(startDate) + " – " + part(endDate);
}

function huDayLabel(date) {
  const labels = { 1: "HÉ", 2: "KE", 3: "SZ", 4: "CS", 5: "PÉ", 6: "SZ", 0: "VA" };
  return labels[date.getDay()] + "." + String(date.getDate()).padStart(2, "0");
}

function getRelativeWeekLabel(targetDate) {
  const difference = Math.round((startOfWeek(targetDate) - startOfWeek(new Date())) / 604800000);
  if (difference === 0) return "Ez a hét";
  if (difference === 1) return "Jövő hét";
  if (difference === -1) return "Múlt hét";
  return difference > 1 ? difference + " héttel előre" : Math.abs(difference) + " héttel ezelőtt";
}

async function getWeather() {
  if (state.preview) return null;
  const cached = localStorage.getItem("od4_weather");
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.timestamp < 3600000) return parsed.data;
    } catch {
      localStorage.removeItem("od4_weather");
    }
  }
  if (!navigator.geolocation) return null;
  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
    });
    const { latitude, longitude } = position.coords;
    const url = "https://api.open-meteo.com/v1/forecast?latitude=" + latitude +
      "&longitude=" + longitude + "&daily=weathercode,temperature_2m_max&timezone=auto";
    const response = await fetch(url);
    if (!response.ok) return null;
    const json = await response.json();
    const weather = {};
    json.daily?.time?.forEach((day, index) => {
      weather[day] = {
        code: json.daily.weathercode[index],
        max: Math.round(json.daily.temperature_2m_max[index]),
      };
    });
    localStorage.setItem("od4_weather", JSON.stringify({ timestamp: Date.now(), data: weather }));
    return weather;
  } catch {
    return null;
  }
}

function getWeatherIcon(code) {
  const sun = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5"/><path d="M12 2v3m0 14v3M4.9 4.9l2.1 2.1m10 10l2.1 2.1M2 12h3m14 0h3M4.9 19.1l2.1-2.1m10-10l2.1-2.1" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
  const cloud = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.5 10a5.5 5.5 0 0 0-9.8-3.2A6 6 0 0 0 5 18h13.5A5.5 5.5 0 0 0 18.5 10z"/></svg>';
  const rain = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.5 10a5.5 5.5 0 0 0-9.8-3.2A6 6 0 0 0 5 18h13.5A5.5 5.5 0 0 0 18.5 10z"/><path d="M7 20l-2 3M11 20l-2 3M15 20l-2 3" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
  const snow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M6 8.5l12 7M6 15.5l12-7"/></svg>';
  if (code === 0) return sun;
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return rain;
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return snow;
  return cloud;
}

function workspaceQuery(table) {
  if (!state.workspaceId) throw new Error("Missing workspace");
  return supabase.from(table);
}

async function fetchCategories() {
  if (state.preview) {
    state.categories = previewStore.categories.map((category) => ({
      ...category,
      todos: [{
        count: previewStore.todos.filter((todo) => todo.category_id === category.id && !todo.done).length,
      }],
    }));
    return;
  }
  const { data, error } = await workspaceQuery("categories")
    .select("id, name, todos(count)")
    .eq("workspace_id", state.workspaceId)
    .eq("todos.done", false)
    .order("created_at", { ascending: true });
  if (error) throw error;
  state.categories = data ?? [];
}

async function createCategory(name) {
  if (state.preview) {
    const category = { id: crypto.randomUUID(), name, created_at: new Date().toISOString() };
    previewStore.categories.push(category);
    return category;
  }
  const { data, error } = await workspaceQuery("categories")
    .insert({ workspace_id: state.workspaceId, name })
    .select("id, name")
    .single();
  if (error) throw error;
  return data;
}

async function updateCategory(id, name) {
  if (state.preview) {
    const category = previewStore.categories.find((candidate) => candidate.id === id);
    if (category) category.name = name;
    return;
  }
  const { error } = await workspaceQuery("categories")
    .update({ name }).eq("workspace_id", state.workspaceId).eq("id", id);
  if (error) throw error;
}

async function deleteCategory(id) {
  if (state.preview) {
    previewStore.categories = previewStore.categories.filter((category) => category.id !== id);
    previewStore.todos = previewStore.todos.filter((todo) => todo.category_id !== id);
    return;
  }
  const { error } = await workspaceQuery("categories")
    .delete().eq("workspace_id", state.workspaceId).eq("id", id);
  if (error) throw error;
}

async function fetchTodos(categoryId) {
  if (state.preview) {
    state.todos = previewStore.todos
      .filter((todo) => todo.category_id === categoryId)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    return;
  }
  const { data, error } = await workspaceQuery("todos")
    .select("*")
    .eq("workspace_id", state.workspaceId)
    .eq("category_id", categoryId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  state.todos = data ?? [];
}

async function createTodo(categoryId, text) {
  const maximum = state.todos.reduce((value, todo) => Math.max(value, todo.sort_order ?? 0), 0);
  if (state.preview) {
    const todo = {
      id: crypto.randomUUID(),
      category_id: categoryId,
      text,
      done: false,
      sort_order: state.todos.length ? maximum + 1 : 0,
      color_idx: Math.floor(Math.random() * TODO_BG_VARS.length),
    };
    previewStore.todos.push(todo);
    return todo;
  }
  const { data, error } = await workspaceQuery("todos").insert({
    workspace_id: state.workspaceId,
    category_id: categoryId,
    text,
    done: false,
    sort_order: state.todos.length ? maximum + 1 : 0,
    color_idx: Math.floor(Math.random() * TODO_BG_VARS.length),
  }).select().single();
  if (error) throw error;
  return data;
}

async function toggleTodo(id, done) {
  if (state.preview) {
    const todo = previewStore.todos.find((candidate) => candidate.id === id);
    if (todo) todo.done = done;
    return;
  }
  const { error } = await workspaceQuery("todos")
    .update({ done }).eq("workspace_id", state.workspaceId).eq("id", id);
  if (error) throw error;
}

async function deleteTodo(id) {
  if (state.preview) {
    previewStore.todos = previewStore.todos.filter((todo) => todo.id !== id);
    return;
  }
  const { error } = await workspaceQuery("todos")
    .delete().eq("workspace_id", state.workspaceId).eq("id", id);
  if (error) throw error;
}

async function clearChecked(categoryId) {
  if (state.preview) {
    previewStore.todos = previewStore.todos.filter((todo) => todo.category_id !== categoryId || !todo.done);
    return;
  }
  const { error } = await workspaceQuery("todos")
    .delete()
    .eq("workspace_id", state.workspaceId)
    .eq("category_id", categoryId)
    .eq("done", true);
  if (error) throw error;
}

async function moveTodoToTop(id) {
  if (state.todos.length < 2) return;
  const index = state.todos.findIndex((todo) => todo.id === id);
  if (index < 0) return;
  const movedTodo = state.todos[index];
  const previous = movedTodo.sort_order;
  const newSort = Math.min(...state.todos.map((todo) => todo.sort_order ?? 0)) - 1;
  movedTodo.sort_order = newSort;
  state.todos.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  renderTodos();
  navigator.vibrate?.([10, 30, 10]);
  if (state.preview) return;
  const { error } = await workspaceQuery("todos")
    .update({ sort_order: newSort })
    .eq("workspace_id", state.workspaceId)
    .eq("id", id);
  if (error) {
    movedTodo.sort_order = previous;
    await refreshTodosOnly();
    throw error;
  }
}

async function fetchPlannerWeek(weekStartDate) {
  if (state.preview) {
    const from = toISODate(weekStartDate);
    const to = toISODate(addDays(weekStartDate, 6));
    return [...previewStore.plannerDays.entries()]
      .filter(([day]) => day >= from && day <= to)
      .map(([day, value]) => ({ day, ...value }));
  }
  const { data, error } = await workspaceQuery("planner_days")
    .select("*")
    .eq("workspace_id", state.workspaceId)
    .gte("day", toISODate(weekStartDate))
    .lte("day", toISODate(addDays(weekStartDate, 6)))
    .order("day", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function savePlannerDay(day, value) {
  setSync("Mentés…", "saving");
  if (state.preview) {
    previewStore.plannerDays.set(day, { ...value });
    if (state.saveQueue.get(day) === value) state.saveQueue.delete(day);
    setSync("Preview – helyben mentve", "saved");
    return;
  }
  const { error } = await workspaceQuery("planner_days").upsert({
    workspace_id: state.workspaceId,
    day,
    text: value.text,
    work: value.work,
  }, { onConflict: "workspace_id,day" });
  if (error) throw error;
  if (state.saveQueue.get(day) === value) state.saveQueue.delete(day);
  if (state.saveQueue.size === 0) setSync("Mentve", "saved");
}

function queuePlannerSave(day, value) {
  state.saveQueue.set(day, value);
  clearTimeout(state.saveTimers.get(day));
  setSync("Módosítás…", "saving");
  state.saveTimers.set(day, setTimeout(async () => {
    try {
      await savePlannerDay(day, value);
    } catch (error) {
      setSync("Mentési hiba", "error");
      showToast(friendlyError(error));
    } finally {
      state.saveTimers.delete(day);
    }
  }, 600));
}

async function flushPlannerSaves() {
  const pending = [...state.saveQueue.entries()];
  if (!pending.length || !state.workspaceId) return;
  await Promise.allSettled(pending.map(([day, value]) => savePlannerDay(day, value)));
}

function renderCategorySelect() {
  const previous = categorySelect.value;
  categorySelect.innerHTML = "";
  const plannerOption = document.createElement("option");
  plannerOption.value = PLANNER_VALUE;
  plannerOption.textContent = "_Tervező";
  categorySelect.appendChild(plannerOption);
  state.categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.id;
    const count = category.todos?.[0]?.count || 0;
    option.textContent = category.name + (count ? " (" + count + ")" : "");
    categorySelect.appendChild(option);
  });
  categorySelect.value = previous && [...categorySelect.options].some((option) => option.value === previous)
    ? previous
    : PLANNER_VALUE;
}

function attachSwipe(element, onSwipeLeft) {
  let startX = 0;
  let currentX = 0;
  let dragging = false;
  element.addEventListener("pointerdown", (event) => {
    if (event.target.matches("button,input")) return;
    startX = event.clientX;
    currentX = startX;
    dragging = true;
    element.classList.remove("swipe-transition");
    element.setPointerCapture(event.pointerId);
  });
  element.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    currentX = event.clientX;
    const difference = currentX - startX;
    if (difference < 0) {
      element.style.transform = "translateX(" + difference + "px)";
      element.style.opacity = Math.max(0.4, 1 - Math.abs(difference) / 300);
      element.querySelector(".move-top-hint").style.opacity = difference < -80 ? "1" : "0";
    }
  });
  const finish = (event) => {
    if (!dragging) return;
    dragging = false;
    if (event.pointerId !== undefined && element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    element.classList.add("swipe-transition");
    element.style.transform = "translateX(0)";
    element.style.opacity = "1";
    if (currentX - startX < -80) onSwipeLeft();
  };
  element.addEventListener("pointerup", finish);
  element.addEventListener("pointercancel", finish);
}

function renderTodos() {
  clearCheckedBtn.classList.remove("reward-glow");
  list.innerHTML = "";
  if (!state.activeCategoryId) return;
  const fragment = document.createDocumentFragment();
  state.todos.forEach((todo) => {
    const item = document.createElement("li");
    const colorIndex = Number.isFinite(todo.color_idx) ? todo.color_idx : 0;
    item.style.background = cssVar(TODO_BG_VARS[colorIndex % TODO_BG_VARS.length]);
    item.innerHTML =
      '<input class="itemCheck" type="checkbox" ' + (todo.done ? "checked" : "") + ' aria-label="Kész" />' +
      '<div class="itemText ' + (todo.done ? "done" : "") + '">' + esc(todo.text) + '</div>' +
      '<button class="itemDelete" type="button" aria-label="Tétel törlése">×</button>' +
      '<span class="move-top-hint">Felfelé ↑</span>';
    const checkbox = item.querySelector(".itemCheck");
    checkbox.addEventListener("change", async () => {
      item.querySelector(".itemText").classList.toggle("done", checkbox.checked);
      try {
        await toggleTodo(todo.id, checkbox.checked);
        await fetchCategories();
        renderCategorySelect();
      } catch (error) {
        checkbox.checked = !checkbox.checked;
        item.querySelector(".itemText").classList.toggle("done", checkbox.checked);
        showToast(friendlyError(error));
      }
    });
    item.querySelector(".itemDelete").addEventListener("click", async () => {
      item.classList.add("removing");
      try {
        await deleteTodo(todo.id);
        state.todos = state.todos.filter((candidate) => candidate.id !== todo.id);
        await fetchCategories();
        renderCategorySelect();
        renderTodos();
      } catch (error) {
        item.classList.remove("removing");
        showToast(friendlyError(error));
      }
    });
    attachSwipe(item, () => moveTodoToTop(todo.id).catch((error) => showToast(friendlyError(error))));
    fragment.appendChild(item);
  });
  list.appendChild(fragment);
}

async function renderPlanner() {
  if (!state.workspaceId) return;
  plannerRange.textContent = fmtRange(state.weekStart);
  plannerLabel.textContent = getRelativeWeekLabel(state.weekStart);
  const today = toISODate(new Date());
  try {
    const [week, weather] = await Promise.all([fetchPlannerWeek(state.weekStart), getWeather()]);
    const rows = new Map(week.map((row) => [row.day, row]));
    plannerDays.innerHTML = "";
    for (let index = 0; index < 7; index += 1) {
      const date = addDays(state.weekStart, index);
      const day = toISODate(date);
      const row = rows.get(day) ?? { text: "", work: false };
      const weatherHtml = weather?.[day]
        ? '<div class="weather-mini">' + getWeatherIcon(weather[day].code) + "<span>" + weather[day].max + "°</span></div>"
        : "";
      const card = document.createElement("div");
      card.className = "dayCard";
      card.style.background = cssVar(PLANNER_DAY_BG_VARS_BY_WEEKDAY[date.getDay()]);
      card.classList.toggle("today", day === today);
      card.classList.toggle("past", day < today);
      card.innerHTML =
        '<div class="dayLeft"><div class="dayDate">' + huDayLabel(date) + '</div></div>' +
        '<div class="dayMid"><textarea class="dayInput" placeholder="Tervek…" rows="1" maxlength="4000"></textarea></div>' +
        '<div class="dayRight">' + weatherHtml + "</div>";
      plannerDays.appendChild(card);
      const input = card.querySelector(".dayInput");
      input.value = row.text ?? "";
      const autoSize = () => {
        input.style.height = "auto";
        input.style.height = input.scrollHeight + "px";
      };
      requestAnimationFrame(autoSize);
      input.addEventListener("input", () => {
        autoSize();
        queuePlannerSave(day, { text: input.value, work: row.work });
      });
    }
  } catch (error) {
    showToast(friendlyError(error));
  }
}

async function refreshAll() {
  setSync("Frissítés…", "saving");
  await fetchCategories();
  renderCategorySelect();
  if (isPlannerSelected()) {
    state.activeCategoryId = null;
    setViewPlanner(true);
    await renderPlanner();
  } else {
    state.activeCategoryId = categorySelect.value || null;
    setViewPlanner(false);
    if (state.activeCategoryId) await fetchTodos(state.activeCategoryId);
    renderTodos();
  }
  setSync(state.preview ? "Preview mód" : "Naprakész", "saved");
}

async function refreshTodosOnly() {
  if (!state.activeCategoryId) return;
  await fetchTodos(state.activeCategoryId);
  renderTodos();
}

function stopRealtime() {
  if (state.realtimeChannel && supabase) supabase.removeChannel(state.realtimeChannel);
  state.realtimeChannel = null;
}

function setupRealtime() {
  if (state.preview) {
    setSync("Preview mód", "saved");
    return;
  }
  stopRealtime();
  const filter = "workspace_id=eq." + state.workspaceId;
  state.realtimeChannel = supabase.channel("od4-" + state.workspaceId)
    .on("postgres_changes", { event: "*", schema: "public", table: "categories", filter }, () => {
      fetchCategories().then(renderCategorySelect).catch(console.error);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "todos", filter }, () => {
      fetchCategories().then(renderCategorySelect).catch(console.error);
      if (!isPlannerSelected()) refreshTodosOnly().catch(console.error);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "planner_days", filter }, () => {
      const active = document.activeElement;
      if (isPlannerSelected() && active?.tagName !== "TEXTAREA") renderPlanner();
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setSync("Naprakész", "saved");
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setSync("Kapcsolati hiba", "error");
    });
}

function clearPrivateState() {
  stopRealtime();
  state.user = null;
  state.preview = false;
  state.workspaceId = null;
  state.workspaceRole = null;
  state.categories = [];
  state.todos = [];
  state.activeCategoryId = null;
  state.saveQueue.clear();
  state.saveTimers.forEach(clearTimeout);
  state.saveTimers.clear();
  list.innerHTML = "";
  plannerDays.innerHTML = "";
  userEmail.textContent = "";
  workspaceName.textContent = "";
}

async function applySession(session) {
  if (session?.user && state.user?.id === session.user.id && state.workspaceId && !appShell.classList.contains("hidden")) {
    return;
  }
  const revision = ++sessionRevision;
  if (!session?.user) {
    clearPrivateState();
    showView(authView);
    emailInput.focus();
    return;
  }
  if (state.user?.id === session.user.id && state.workspaceId) return;
  showView(loadingView);
  state.user = session.user;
  const { data, error } = await supabase.from("workspace_members")
    .select("workspace_id, role, workspaces(name)")
    .eq("user_id", session.user.id)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (revision !== sessionRevision) return;
  if (error) {
    clearPrivateState();
    showView(authView);
    authMessage.textContent = friendlyError(error);
    return;
  }
  if (!data) {
    state.workspaceId = null;
    showView(noAccessView);
    return;
  }
  state.workspaceId = data.workspace_id;
  state.workspaceRole = data.role;
  userEmail.textContent = session.user.email ?? "";
  workspaceName.textContent = data.workspaces?.name ?? "Közös";
  const hour = new Date().getHours();
  $("appTitle").textContent = (hour < 12 ? "Jó reggelt!" : hour < 18 ? "Szia!" : "Jó estét!") + " OD Jegyzetek";
  categorySelect.value = PLANNER_VALUE;
  showView(appShell);
  try {
    await refreshAll();
    if (revision !== sessionRevision) return;
    setupRealtime();
  } catch (refreshError) {
    setSync("Betöltési hiba", "error");
    showToast(friendlyError(refreshError));
  }
}

async function signOut() {
  await flushPlannerSaves();
  if (state.preview) {
    clearPrivateState();
    showView(authView);
    return;
  }
  const { error } = await supabase.auth.signOut();
  if (error) showToast(friendlyError(error));
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;
  loginButton.disabled = true;
  authMessage.textContent = "Belépési link küldése…";
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await supabase.auth.signInWithOtp({
    email: emailInput.value.trim(),
    options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
  });
  loginButton.disabled = false;
  authMessage.textContent = error
    ? "Nem sikerült linket küldeni. Ellenőrizd az e-mail-címet."
    : "Elküldtük a belépési linket. Nézd meg a leveleidet.";
});

async function enterPreview() {
  state.preview = true;
  state.user = { id: "preview-user", email: "preview@localhost" };
  state.workspaceId = "preview-workspace";
  state.workspaceRole = "owner";
  userEmail.textContent = "helyi mintaadatok";
  workspaceName.textContent = "Preview munkaterület";
  $("appTitle").textContent = "OD Jegyzetek Preview";
  categorySelect.value = PLANNER_VALUE;
  showView(appShell);
  await refreshAll();
  setupRealtime();
}

previewButton.addEventListener("click", enterPreview);

logoutButton.addEventListener("click", signOut);
noAccessLogout.addEventListener("click", signOut);
window.addEventListener("online", () => setSync("Újra online", "saved"));
window.addEventListener("offline", () => setSync("Offline", "error"));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushPlannerSaves();
});

categorySelect.addEventListener("change", async () => {
  try {
    if (isPlannerSelected()) {
      state.activeCategoryId = null;
      setViewPlanner(true);
      await renderPlanner();
    } else {
      state.activeCategoryId = categorySelect.value;
      setViewPlanner(false);
      await refreshTodosOnly();
    }
  } catch (error) {
    showToast(friendlyError(error));
  }
});

itemForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = itemInput.value.trim();
  if (!text || !state.activeCategoryId) return;
  itemInput.value = "";
  try {
    await createTodo(state.activeCategoryId, text);
    await Promise.all([refreshTodosOnly(), fetchCategories()]);
    renderCategorySelect();
  } catch (error) {
    itemInput.value = text;
    showToast(friendlyError(error));
  }
});

clearCheckedBtn.addEventListener("click", async () => {
  if (!state.activeCategoryId || !state.todos.some((todo) => todo.done)) return;
  try {
    await clearChecked(state.activeCategoryId);
    clearCheckedBtn.classList.add("reward-glow");
    await Promise.all([refreshTodosOnly(), fetchCategories()]);
    renderCategorySelect();
    setTimeout(() => clearCheckedBtn.classList.remove("reward-glow"), 1500);
  } catch (error) {
    showToast(friendlyError(error));
  }
});

plannerPrev.addEventListener("click", async () => {
  await flushPlannerSaves();
  state.weekStart = addDays(state.weekStart, -7);
  renderPlanner();
});
plannerNext.addEventListener("click", async () => {
  await flushPlannerSaves();
  state.weekStart = addDays(state.weekStart, 7);
  renderPlanner();
});
plannerToday.addEventListener("click", async () => {
  await flushPlannerSaves();
  state.weekStart = startOfWeek(new Date());
  renderPlanner();
});

newCategoryBtn.addEventListener("click", () => {
  modalMode = "new";
  openModal({ title: "Új kategória", initialValue: "" });
});
editCategoryBtn.addEventListener("click", () => {
  const category = state.categories.find((candidate) => candidate.id === state.activeCategoryId);
  if (category) {
    modalMode = "edit";
    openModal({ title: "Kategória átnevezése", initialValue: category.name });
  }
});
deleteCategoryBtn.addEventListener("click", async () => {
  const category = state.categories.find((candidate) => candidate.id === state.activeCategoryId);
  if (!category || !confirm('Biztosan törlöd ezt a kategóriát és minden tételét: "' + category.name + '"?')) return;
  try {
    await deleteCategory(category.id);
    state.activeCategoryId = null;
    await refreshAll();
  } catch (error) {
    showToast(friendlyError(error));
  }
});
modalClose.addEventListener("click", closeModal);
modalCancel.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (event) => {
  if (event.target === modalOverlay) closeModal();
});
modalName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") modalSave.click();
  if (event.key === "Escape") closeModal();
});
modalSave.addEventListener("click", async () => {
  const name = modalName.value.trim();
  if (!name) return;
  modalSave.disabled = true;
  try {
    if (modalMode === "new") {
      const category = await createCategory(name);
      await fetchCategories();
      renderCategorySelect();
      categorySelect.value = category.id;
      state.activeCategoryId = category.id;
      setViewPlanner(false);
      await refreshTodosOnly();
    } else {
      await updateCategory(state.activeCategoryId, name);
      await refreshAll();
    }
    closeModal();
  } catch (error) {
    showToast(friendlyError(error));
  } finally {
    modalSave.disabled = false;
  }
});

async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  }
  const localPreviewAllowed = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  previewButton.classList.toggle("hidden", !localPreviewAllowed);
  if (localPreviewAllowed && new URLSearchParams(window.location.search).get("preview") === "1") {
    await enterPreview();
    return;
  }
  if (!isConfigured) {
    showView(authView);
    emailInput.disabled = true;
    loginButton.disabled = true;
    authMessage.textContent = "Az új Supabase-projekt még nincs beállítva. Töltsd ki a config.js fájlt.";
    return;
  }
  const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => applySession(session), 0);
  });
  window.addEventListener("pagehide", () => listener.subscription.unsubscribe(), { once: true });
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    showView(authView);
    authMessage.textContent = friendlyError(error);
    return;
  }
  await applySession(data.session);
}

init();
