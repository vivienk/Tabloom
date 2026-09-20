import "./styles.css";
import { createClassifier } from "./classifier";
import { improveWithOnDeviceAI } from "./ai-classifier";
import { icon } from "./icons";
import { CATEGORIES, type Analysis, type Category, type ClassifiedTab, type ClosedTab, type GroupColor, type Message, type TabInventory } from "./types";

const app = document.querySelector<HTMLDivElement>("#app")!;
const classifier = createClassifier();
let analysis: Analysis | null = null;
let browserWindows: TabInventory["windows"] = [];
let selected = new Set<number>();
let activeFilter: Category | "All" = "All";
let duplicateView = false;
let windowOverview = false;
let activeWindowId: number | null = null;
let historyView = false;
let recentlyClosed: ClosedTab[] = [];
let searchQuery = "";
type CustomCategory = { name: string; color: GroupColor };

const GROUP_COLORS: Array<{ name: GroupColor; hex: string }> = [
  { name: "grey", hex: "#9aa0a6" },
  { name: "blue", hex: "#5b8def" },
  { name: "red", hex: "#e76f6f" },
  { name: "yellow", hex: "#e8b84d" },
  { name: "green", hex: "#55a978" },
  { name: "pink", hex: "#d879a1" },
  { name: "purple", hex: "#9674cf" },
  { name: "cyan", hex: "#55aeb8" },
  { name: "orange", hex: "#df8a45" }
];

const BUILT_IN_COLORS: Record<string, GroupColor> = {
  Work: "blue", Research: "purple", Learning: "cyan", Shopping: "orange",
  Social: "pink", Personal: "green", Inbox: "grey"
};

let customCategories: CustomCategory[] = [];
let categoryOverrides: Record<string, string> = {};
let addingCategory = false;
let assignmentMode: Category | null = null;
let aiState: "idle" | "working" | "done" | "error" = "idle";
let aiMessage = "";

function send<T>(message: Message): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]!);
}

function hostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function overrideKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase().replace(/\/$/, "");
  } catch { return url.toLowerCase(); }
}

function aiErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (error.name === "NotAllowedError") return "Chrome blocked the model start. Click the AI button again and keep Tabloom open.";
  if (error.name === "NotSupportedError") return "Chrome’s on-device model does not support this device or language yet.";
  if (error.name === "QuotaExceededError") return "The on-device model ran out of space for this tab set. Try again with fewer open tabs.";
  if (error.name === "InvalidStateError") return "Chrome’s on-device model is still preparing. Keep Tabloom open and try again shortly.";
  return error.message;
}

function allCategories(): string[] {
  return [...CATEGORIES, ...customCategories.map((category) => category.name)];
}

function colorForCategory(name: string): GroupColor {
  return customCategories.find((category) => category.name === name)?.color ?? BUILT_IN_COLORS[name] ?? "grey";
}

function renderLoading(): void {
  app.innerHTML = `<main class="shell loading"><img class="mark" src="/tabloom-logo.png" alt="Tabloom"><h1>Reading this window…</h1><p>Everything stays on your device.</p></main>`;
}

function renderError(message: string): void {
  app.innerHTML = `<main class="shell empty"><img class="mark" src="/tabloom-logo.png" alt="Tabloom"><h1>Couldn’t read these tabs</h1><p>${escapeHtml(message)}</p><button id="retry" class="primary">Try again</button></main>`;
  document.querySelector("#retry")?.addEventListener("click", load);
}

function visibleTabs(): ClassifiedTab[] {
  let tabs: ClassifiedTab[];
  if (assignmentMode) tabs = analysis?.tabs ?? [];
  else if (duplicateView) tabs = (analysis?.tabs ?? [])
    .filter((tab) => Boolean(tab.duplicateGroup))
    .sort((left, right) => (left.duplicateGroup ?? "").localeCompare(right.duplicateGroup ?? ""));
  else tabs = (analysis?.tabs ?? []).filter((tab) => activeFilter === "All" || tab.category === activeFilter);
  if (activeWindowId !== null) tabs = tabs.filter((tab) => tab.windowId === activeWindowId);
  const query = searchQuery.trim().toLowerCase();
  return query ? tabs.filter((tab) => `${tab.title} ${tab.url} ${tab.category}`.toLowerCase().includes(query)) : tabs;
}

function render(preservedScrollTop?: number): void {
  if (!analysis) return;
  const tabs = analysis.tabs;
  const duplicateKeys = [...new Set(tabs.flatMap((tab) => tab.duplicateGroup ? [tab.duplicateGroup] : []))].sort();
  const duplicateLabels = new Map(duplicateKeys.map((key, index) => [key, index + 1]));
  const duplicates = duplicateKeys.length;
  const duplicateTabs = tabs.filter((tab) => tab.duplicateGroup).length;
  const duplicateTabsToClose = duplicateKeys.flatMap((key) => {
    const set = tabs.filter((tab) => tab.duplicateGroup === key);
    const keeper = set.find((tab) => tab.pinned) ?? set.find((tab) => tab.active) ?? set[0];
    return set.filter((tab) => tab.id !== keeper?.id);
  });
  const windowNumber = activeWindowId === null ? null : browserWindows.findIndex((window) => window.id === activeWindowId) + 1;
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const visibleWindows = normalizedSearch ? browserWindows.filter((window) => {
    const windowTabs = tabs.filter((tab) => tab.windowId === window.id);
    return window.activeTabTitle.toLowerCase().includes(normalizedSearch) || windowTabs.some((tab) => `${tab.title} ${tab.url} ${tab.category}`.toLowerCase().includes(normalizedSearch));
  }) : browserWindows;
  const categories = allCategories();
  const customNames = new Set(customCategories.map((category) => category.name));
  const categoryOrder = new Map(categories.map((category, index) => [category, index]));
  const usedCategories = categories
    .filter((category) => customNames.has(category) || tabs.some((tab) => tab.category === category))
    .sort((left, right) => {
      const countDifference = tabs.filter((tab) => tab.category === right).length - tabs.filter((tab) => tab.category === left).length;
      return countDifference || (categoryOrder.get(left) ?? 0) - (categoryOrder.get(right) ?? 0);
    });
  const filterHtml = ["All", ...usedCategories].map((category) => {
    const count = category === "All" ? tabs.length : tabs.filter((tab) => tab.category === category).length;
    const filter = `<button class="filter ${activeFilter === category ? "active" : ""}" data-filter="${escapeHtml(category)}">${escapeHtml(category)}<span>${count}</span></button>`;
    return customNames.has(category)
      ? `<div class="custom-filter">${filter}<button class="remove-filter" data-remove-category="${escapeHtml(category)}" title="Remove ${escapeHtml(category)}" aria-label="Remove ${escapeHtml(category)}">${icon("x")}</button></div>`
      : filter;
  }).join("");
  const addCategoryHtml = addingCategory ? `<form class="category-form" id="category-form">
    <div class="category-fields">
      <input id="category-name" maxlength="28" placeholder="Category name" autocomplete="off" autofocus>
      <div class="color-picker" role="radiogroup" aria-label="Tab group color">
        ${GROUP_COLORS.map((color, index) => `<label class="color-choice" title="${color.name}">
          <input type="radio" name="category-color" value="${color.name}" ${index === 1 ? "checked" : ""}>
          <span style="--swatch:${color.hex}"></span>
        </label>`).join("")}
      </div>
    </div>
    <div class="category-form-actions"><button class="mini-primary" type="submit">Add</button><button class="mini-cancel" id="cancel-category" type="button">Cancel</button></div>
  </form>` : "";
  const listHtml = visibleTabs().map((tab) => `
    <article class="tab-row ${tab.duplicateGroup ? "duplicate" : ""}">
      <label class="check" title="${assignmentMode ? `Assign to ${escapeHtml(assignmentMode)}` : "Include when grouping"}"><input type="checkbox" ${assignmentMode ? `data-assign-id="${tab.id}" ${tab.category === assignmentMode ? "checked" : ""}` : `data-id="${tab.id}" ${selected.has(tab.id) ? "checked" : ""}`}><span></span></label>
      <div class="favicon">${tab.favIconUrl ? `<img src="${escapeHtml(tab.favIconUrl)}" alt="">` : hostname(tab.url).slice(0, 1).toUpperCase()}</div>
      <div class="tab-copy"><h3>${escapeHtml(tab.title)}</h3><p>${escapeHtml(hostname(tab.url))}</p></div>
      <select class="category-select" data-category-id="${tab.id}" aria-label="Category for ${escapeHtml(tab.title)}">
        ${categories.map((category) => `<option value="${escapeHtml(category)}" ${tab.category === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}
      </select>
      <div class="action ${tab.duplicateGroup ? "warn" : ""}">${tab.duplicateGroup ? `Duplicate set ${duplicateLabels.get(tab.duplicateGroup)}` : tab.recommendation}</div>
      <button class="trash-button" data-close-tab="${tab.id}" title="Close ${escapeHtml(tab.title)}" aria-label="Close ${escapeHtml(tab.title)}">${icon("trash")}</button>
    </article>`).join("");
  const windowsHtml = visibleWindows.map((window) => `<button class="window-card" data-window-id="${window.id}">
    <span class="window-number">${browserWindows.findIndex((item) => item.id === window.id) + 1}</span>
    <span class="window-copy"><strong>${escapeHtml(window.activeTabTitle)}</strong><span>${window.tabCount} ${window.tabCount === 1 ? "tab" : "tabs"}${window.focused ? " · Current window" : ""}</span></span>
    ${icon("arrowRight")}
  </button>`).join("");
  const historyHtml = recentlyClosed.map((tab) => `<article class="history-row">
    <div class="history-icon">${icon("clock")}</div>
    <div class="tab-copy"><h3>${escapeHtml(tab.title)}</h3><p>${escapeHtml(hostname(tab.url))}</p></div>
    <button class="restore-button" data-restore-session="${escapeHtml(tab.sessionId)}">${icon("refresh")} Restore</button>
  </article>`).join("");

  app.innerHTML = `<main class="shell">
    <header><div><div class="eyebrow"><img class="mark small" src="/tabloom-logo.png" alt=""> TABLOOM</div><h1>Turn tab chaos<br>into clear groups.</h1></div><button id="refresh" class="icon-button" title="Analyze again" aria-label="Analyze tabs again">${icon("refresh")}</button></header>
    <section class="summary">
      <button id="show-all-tabs" class="summary-card ${!windowOverview && activeWindowId === null && !duplicateView && activeFilter === "All" ? "active" : ""}"><strong>${tabs.length}</strong><span>open tabs</span></button>
      <button id="show-windows" class="summary-card ${windowOverview || activeWindowId !== null ? "active" : ""}"><strong>${browserWindows.length}</strong><span>${browserWindows.length === 1 ? "window" : "windows"} open</span></button>
      <button id="show-duplicates" class="summary-card ${duplicateView ? "active" : ""}" ${duplicates ? "" : "disabled"}><strong>${duplicates}</strong><span>duplicate sets</span></button>
      <div class="privacy">${icon("shield")}<span>Local analysis</span></div>
    </section>
    <div class="search-box">${icon("search")}<input id="tab-search" type="search" value="${escapeHtml(searchQuery)}" placeholder="Search tabs, websites, or categories" aria-label="Search tabs">${searchQuery ? `<button id="clear-search" title="Clear search" aria-label="Clear search">${icon("x")}</button>` : ""}</div>
    <div class="category-bar"><nav>${filterHtml}</nav><button class="filter add-filter" id="add-category">${icon("plus")} Add category</button></div>
    ${addCategoryHtml}
    <section class="inventory-head"><div><h2>${historyView ? "Recently closed tabs" : windowOverview ? "Open windows" : assignmentMode ? `Select tabs for ${escapeHtml(assignmentMode)}` : duplicateView ? "Duplicate sets" : windowNumber ? `Window ${windowNumber}` : activeFilter === "All" ? "All open tabs" : escapeHtml(activeFilter)}</h2><p>${historyView ? "Restore a tab you closed recently." : windowOverview ? "Choose a window to see every tab inside it." : assignmentMode ? "Check the tabs that belong in this category." : duplicateView ? `${duplicateTabs} tabs across ${duplicates} likely duplicate sets. Only extra copies will close; one tab per set stays open.` : aiMessage ? escapeHtml(aiMessage) : "Choose what gets organized. Tabs close only when you use their trash button."}</p></div>${historyView ? `<button id="back-to-duplicates" class="text-button">${icon("arrowRight")} Back to duplicates</button>` : duplicateView ? `<div class="duplicate-actions"><button id="close-duplicates" class="danger-button" ${duplicateTabsToClose.length ? "" : "disabled"}>${icon("trash")} Close extra duplicates</button><button id="show-history" class="history-button">${icon("clock")} Recently closed tabs</button></div>` : windowOverview || assignmentMode ? "" : activeFilter === "All" && activeWindowId === null ? `<div class="inventory-actions"><button id="improve-ai" class="ai-button" ${aiState === "working" ? "disabled" : ""}>${icon("sparkles")}${aiState === "working" ? "Improving…" : "Improve with on-device AI"}</button><button id="select-suggested" class="text-button">${icon("list")} Select suggested</button></div>` : activeFilter !== "All" ? `<button id="choose-tabs" class="text-button">${icon("list")} Select tabs</button>` : ""}</section>
    <section class="tab-list ${windowOverview ? "window-list" : ""}">${historyView ? historyHtml || `<div class="no-results">No recently closed tabs.</div>` : windowOverview ? windowsHtml || `<div class="no-results">No windows match your search.</div>` : listHtml || `<div class="no-results">${searchQuery ? "No tabs match your search." : "No tabs in this category."}</div>`}</section>
    ${historyView
      ? `<footer><div><strong>${recentlyClosed.length}</strong> recently closed tabs</div></footer>`
      : assignmentMode
      ? `<footer><div><strong>${tabs.filter((tab) => tab.category === assignmentMode).length}</strong> tabs in ${escapeHtml(assignmentMode)}</div><button id="done-assigning" class="primary">Done ${icon("check")}</button></footer>`
      : `<footer><div><strong>${selected.size}</strong> tabs selected</div><button id="group" class="primary" ${selected.size ? "" : "disabled"}>Approve & group ${icon("arrowRight")}</button></footer>`}
  </main>`;

  if (preservedScrollTop !== undefined) {
    const list = document.querySelector<HTMLElement>(".tab-list");
    if (list) list.scrollTop = preservedScrollTop;
  }

  document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((button) => button.addEventListener("click", () => {
    activeFilter = button.dataset.filter as Category | "All";
    duplicateView = false;
    historyView = false;
    windowOverview = false;
    activeWindowId = null;
    assignmentMode = null;
    render();
  }));
  document.querySelector("#show-all-tabs")?.addEventListener("click", () => {
    activeFilter = "All";
    duplicateView = false;
    historyView = false;
    windowOverview = false;
    activeWindowId = null;
    assignmentMode = null;
    render();
  });
  document.querySelector<HTMLInputElement>("#tab-search")?.addEventListener("input", (event) => {
    searchQuery = (event.currentTarget as HTMLInputElement).value;
    render();
    const search = document.querySelector<HTMLInputElement>("#tab-search");
    search?.focus();
    search?.setSelectionRange(search.value.length, search.value.length);
  });
  document.querySelector("#clear-search")?.addEventListener("click", () => {
    searchQuery = "";
    render();
    document.querySelector<HTMLInputElement>("#tab-search")?.focus();
  });
  document.querySelector("#show-duplicates")?.addEventListener("click", () => {
    duplicateView = true;
    historyView = false;
    windowOverview = false;
    activeWindowId = null;
    assignmentMode = null;
    render();
  });
  document.querySelector("#show-windows")?.addEventListener("click", () => {
    windowOverview = true;
    duplicateView = false;
    historyView = false;
    activeWindowId = null;
    assignmentMode = null;
    render();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-window-id]").forEach((button) => button.addEventListener("click", () => {
    activeWindowId = Number(button.dataset.windowId);
    windowOverview = false;
    activeFilter = "All";
    render();
  }));
  document.querySelector("#show-history")?.addEventListener("click", async () => {
    const response = await send<{ ok: boolean; tabs?: ClosedTab[]; error?: string }>({ type: "GET_RECENTLY_CLOSED" });
    if (!response.ok) {
      aiMessage = response.error ?? "Chrome could not read recently closed tabs.";
      render();
      return;
    }
    recentlyClosed = response.tabs ?? [];
    historyView = true;
    duplicateView = false;
    render();
  });
  document.querySelector("#back-to-duplicates")?.addEventListener("click", () => {
    historyView = false;
    duplicateView = true;
    render();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-restore-session]").forEach((button) => button.addEventListener("click", async () => {
    const sessionId = button.dataset.restoreSession;
    if (!sessionId) return;
    button.disabled = true;
    const response = await send<{ ok: boolean; error?: string }>({ type: "RESTORE_TAB", sessionId });
    if (!response.ok) {
      aiMessage = response.error ?? "Chrome could not restore that tab.";
      render();
      return;
    }
    recentlyClosed = recentlyClosed.filter((tab) => tab.sessionId !== sessionId);
    render();
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-close-tab]").forEach((button) => button.addEventListener("click", async () => {
    const tab = tabs.find((item) => item.id === Number(button.dataset.closeTab));
    if (!tab || !window.confirm(`Close “${tab.title}”?\n\nYou can restore it from Chrome’s recently closed tabs.`)) return;
    button.disabled = true;
    const response = await send<{ ok: boolean; error?: string }>({ type: "CLOSE_TAB", tabId: tab.id });
    if (!response.ok) {
      aiMessage = response.error ?? "Chrome could not close that tab.";
      render();
      return;
    }
    analysis!.tabs = tabs.filter((item) => item.id !== tab.id);
    selected.delete(tab.id);
    render();
  }));
  document.querySelector("#close-duplicates")?.addEventListener("click", async () => {
    const count = duplicateTabsToClose.length;
    if (!count || !window.confirm(`Close ${count} extra duplicate ${count === 1 ? "tab" : "tabs"}?\n\nOnly extra copies from the Duplicate Sets view will close. Tabloom will keep one tab from every set. Closed tabs can be restored from Chrome’s recently closed tabs.`)) return;
    const button = document.querySelector<HTMLButtonElement>("#close-duplicates");
    if (button) {
      button.disabled = true;
      button.textContent = "Closing…";
    }
    const tabIds = duplicateTabsToClose.map((tab) => tab.id);
    const response = await send<{ ok: boolean; error?: string }>({ type: "CLOSE_TABS", tabIds });
    if (!response.ok) {
      aiMessage = response.error ?? "Chrome could not close the duplicate tabs.";
      render();
      return;
    }
    const closedIds = new Set(tabIds);
    analysis!.tabs = tabs.filter((tab) => !closedIds.has(tab.id));
    selected = new Set([...selected].filter((id) => !closedIds.has(id)));
    browserWindows = browserWindows.map((window) => ({
      ...window,
      tabCount: analysis!.tabs.filter((tab) => tab.windowId === window.id).length
    }));
    render();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-remove-category]").forEach((button) => button.addEventListener("click", async () => {
    const name = button.dataset.removeCategory;
    if (!name) return;
    customCategories = customCategories.filter((category) => category.name !== name);
    for (const tab of tabs) {
      if (tab.category === name) {
        tab.category = "Inbox";
        tab.recommendation = "Keep ungrouped";
        tab.reason = "Custom category removed";
      }
    }
    categoryOverrides = Object.fromEntries(Object.entries(categoryOverrides).filter(([, category]) => category !== name));
    if (activeFilter === name) activeFilter = "All";
    if (assignmentMode === name) assignmentMode = null;
    await chrome.storage.local.set({ customCategories, categoryOverrides });
    render();
  }));
  document.querySelectorAll<HTMLInputElement>("[data-id]").forEach((input) => input.addEventListener("change", () => {
    const scrollTop = document.querySelector<HTMLElement>(".tab-list")?.scrollTop;
    const id = Number(input.dataset.id);
    input.checked ? selected.add(id) : selected.delete(id);
    render(scrollTop);
  }));
  document.querySelectorAll<HTMLInputElement>("[data-assign-id]").forEach((input) => input.addEventListener("change", async () => {
    const scrollTop = document.querySelector<HTMLElement>(".tab-list")?.scrollTop;
    if (!assignmentMode) return;
    const tab = tabs.find((item) => item.id === Number(input.dataset.assignId));
    if (!tab) return;
    if (input.checked) {
      tab.category = assignmentMode;
      tab.recommendation = "Group";
      tab.reason = "Assigned by you";
      categoryOverrides[overrideKey(tab.url)] = assignmentMode;
      selected.add(tab.id);
    } else if (tab.category === assignmentMode) {
      tab.category = "Inbox";
      tab.recommendation = "Keep ungrouped";
      tab.reason = "Removed from category";
      delete categoryOverrides[overrideKey(tab.url)];
    }
    await chrome.storage.local.set({ categoryOverrides });
    render(scrollTop);
  }));
  document.querySelectorAll<HTMLSelectElement>("[data-category-id]").forEach((select) => select.addEventListener("change", async () => {
    const tab = tabs.find((item) => item.id === Number(select.dataset.categoryId));
    if (!tab) return;
    tab.category = select.value;
    tab.recommendation = "Group";
    categoryOverrides[overrideKey(tab.url)] = select.value;
    selected.add(tab.id);
    await chrome.storage.local.set({ categoryOverrides });
    render();
  }));
  document.querySelector("#add-category")?.addEventListener("click", () => {
    addingCategory = true;
    render();
    document.querySelector<HTMLInputElement>("#category-name")?.focus();
  });
  document.querySelector("#cancel-category")?.addEventListener("click", () => {
    addingCategory = false;
    render();
  });
  document.querySelector<HTMLFormElement>("#category-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>("#category-name");
    const name = input?.value.trim().replace(/\s+/g, " ") ?? "";
    const duplicate = allCategories().some((category) => category.toLowerCase() === name.toLowerCase());
    if (!name || duplicate) {
      input?.classList.add("invalid");
      if (input) input.placeholder = duplicate ? "Category already exists" : "Enter a category name";
      return;
    }
    const color = document.querySelector<HTMLInputElement>('input[name="category-color"]:checked')?.value as GroupColor | undefined;
    customCategories.push({ name, color: color ?? "blue" });
    await chrome.storage.local.set({ customCategories });
    activeFilter = name;
    assignmentMode = name;
    addingCategory = false;
    render();
  });
  document.querySelector("#choose-tabs")?.addEventListener("click", () => {
    if (activeFilter === "All") return;
    assignmentMode = activeFilter;
    render();
  });
  document.querySelector("#done-assigning")?.addEventListener("click", () => {
    assignmentMode = null;
    render();
  });
  document.querySelector("#select-suggested")?.addEventListener("click", () => {
    selected = new Set(tabs.filter((tab) => tab.recommendation === "Group" && !tab.pinned).map((tab) => tab.id));
    render();
  });
  document.querySelector("#improve-ai")?.addEventListener("click", improveWithAI);
  document.querySelector("#refresh")?.addEventListener("click", load);
  document.querySelector("#group")?.addEventListener("click", groupSelected);
}

async function improveWithAI(): Promise<void> {
  if (!analysis || aiState === "working") return;
  aiState = "working";
  aiMessage = "Starting Chrome’s private on-device model…";
  render();
  try {
    const protectedIds = new Set(analysis.tabs
      .filter((tab) => Boolean(categoryOverrides[overrideKey(tab.url)]))
      .map((tab) => tab.id));
    const updated = await improveWithOnDeviceAI(analysis, allCategories(), protectedIds, (progress) => {
      aiMessage = progress > 0 ? `Downloading the on-device model… ${Math.round(progress * 100)}%` : "Downloading the on-device model…";
      render();
    });
    aiState = "done";
    aiMessage = updated ? `On-device AI refined ${updated} tabs. Your manual choices were preserved.` : "Your tabs already match your saved choices.";
    selected = new Set(analysis.tabs.filter((tab) => tab.recommendation === "Group" && !tab.pinned).map((tab) => tab.id));
  } catch (error) {
    aiState = "error";
    aiMessage = aiErrorMessage(error);
  }
  render();
}

async function groupSelected(): Promise<void> {
  if (!analysis || !selected.size) return;
  const button = document.querySelector<HTMLButtonElement>("#group")!;
  button.disabled = true;
  button.textContent = "Grouping…";
  const groups = browserWindows.flatMap((window) => allCategories().map((category) => ({ category, color: colorForCategory(category), tabIds: analysis!.tabs.filter((tab) => selected.has(tab.id) && tab.windowId === window.id && tab.category === category).map((tab) => tab.id) }))).filter((group) => group.tabIds.length);
  const response = await send<{ ok: boolean; error?: string }>({ type: "GROUP_TABS", groups });
  if (!response.ok) return renderError(response.error ?? "Grouping failed");
  app.innerHTML = `<main class="shell success"><div class="success-icon">${icon("checkCircle")}</div><h1>Your tabs are organized.</h1><p>${selected.size} tabs were arranged into ${groups.length} color-coded groups. No tabs were closed.</p><button id="done" class="primary">Done ${icon("check")}</button></main>`;
  document.querySelector("#done")?.addEventListener("click", () => window.close());
}

async function load(): Promise<void> {
  renderLoading();
  try {
    const saved = await chrome.storage.local.get(["customCategories", "categoryOverrides"]);
    customCategories = Array.isArray(saved.customCategories) ? saved.customCategories.flatMap((item): CustomCategory[] => {
      if (typeof item === "string") return [{ name: item, color: "blue" }];
      if (item && typeof item === "object" && typeof item.name === "string") {
        const validColor = GROUP_COLORS.some((color) => color.name === item.color);
        return [{ name: item.name, color: validColor ? item.color as GroupColor : "blue" }];
      }
      return [];
    }) : [];
    categoryOverrides = saved.categoryOverrides && typeof saved.categoryOverrides === "object" ? saved.categoryOverrides as Record<string, string> : {};
    const response = await send<{ ok: boolean; tabs?: TabInventory["tabs"]; windows?: TabInventory["windows"]; error?: string }>({ type: "GET_TABS" });
    if (!response.ok || !response.tabs) throw new Error(response.error ?? "Tab inventory unavailable");
    browserWindows = response.windows ?? [];
    analysis = await classifier.classify(response.tabs);
    for (const tab of analysis.tabs) {
      const override = categoryOverrides[overrideKey(tab.url)];
      if (override && allCategories().includes(override)) {
        tab.category = override;
        tab.recommendation = "Group";
        tab.reason = "Using your saved category choice";
      }
    }
    selected = new Set(analysis.tabs.filter((tab) => tab.recommendation === "Group" && !tab.pinned).map((tab) => tab.id));
    render();
  } catch (error) {
    renderError(error instanceof Error ? error.message : String(error));
  }
}

void load();
