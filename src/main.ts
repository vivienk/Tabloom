import "./styles.css";
import { createClassifier } from "./classifier";
import { improveWithOnDeviceAI } from "./ai-classifier";
import { icon } from "./icons";
import { CATEGORIES, type Analysis, type Category, type ClassifiedTab, type GroupColor, type Message, type TabInput } from "./types";

const app = document.querySelector<HTMLDivElement>("#app")!;
const classifier = createClassifier();
let analysis: Analysis | null = null;
let selected = new Set<number>();
let activeFilter: Category | "All" = "All";
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
  if (assignmentMode) return analysis?.tabs ?? [];
  return (analysis?.tabs ?? []).filter((tab) => activeFilter === "All" || tab.category === activeFilter);
}

function render(): void {
  if (!analysis) return;
  const tabs = analysis.tabs;
  const duplicates = new Set(tabs.filter((tab) => tab.duplicateGroup).map((tab) => tab.duplicateGroup)).size;
  const categories = allCategories();
  const customNames = new Set(customCategories.map((category) => category.name));
  const usedCategories = categories.filter((category) => customNames.has(category) || tabs.some((tab) => tab.category === category));
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
      <div class="action ${tab.duplicateGroup ? "warn" : ""}">${tab.duplicateGroup ? "Likely duplicate" : tab.recommendation}</div>
    </article>`).join("");

  app.innerHTML = `<main class="shell">
    <header><div><div class="eyebrow"><img class="mark small" src="/tabloom-logo.png" alt=""> TABLOOM</div><h1>Turn tab chaos<br>into clear groups.</h1></div><button id="refresh" class="icon-button" title="Analyze again" aria-label="Analyze tabs again">${icon("refresh")}</button></header>
    <section class="summary">
      <div><strong>${tabs.length}</strong><span>open tabs</span></div>
      <div><strong>${usedCategories.length}</strong><span>suggested groups</span></div>
      <div><strong>${duplicates}</strong><span>duplicate sets</span></div>
      <div class="privacy">${icon("shield")}<span>Local analysis</span></div>
    </section>
    <div class="category-bar"><nav>${filterHtml}</nav><button class="filter add-filter" id="add-category">${icon("plus")} Add category</button></div>
    ${addCategoryHtml}
    <section class="inventory-head"><div><h2>${assignmentMode ? `Select tabs for ${escapeHtml(assignmentMode)}` : activeFilter === "All" ? "Preview" : escapeHtml(activeFilter)}</h2><p>${assignmentMode ? "Check the tabs that belong in this category." : aiMessage ? escapeHtml(aiMessage) : "Choose what gets organized. Nothing will be closed."}</p></div>${assignmentMode ? "" : activeFilter === "All" ? `<div class="inventory-actions"><button id="improve-ai" class="ai-button" ${aiState === "working" ? "disabled" : ""}>${icon("sparkles")}${aiState === "working" ? "Improving…" : "Improve with on-device AI"}</button><button id="select-suggested" class="text-button">${icon("list")} Select suggested</button></div>` : `<button id="choose-tabs" class="text-button">${icon("list")} Select tabs</button>`}</section>
    <section class="tab-list">${listHtml || `<div class="no-results">No tabs in this category.</div>`}</section>
    ${assignmentMode
      ? `<footer><div><strong>${tabs.filter((tab) => tab.category === assignmentMode).length}</strong> tabs in ${escapeHtml(assignmentMode)}</div><button id="done-assigning" class="primary">Done ${icon("check")}</button></footer>`
      : `<footer><div><strong>${selected.size}</strong> tabs selected</div><button id="group" class="primary" ${selected.size ? "" : "disabled"}>Approve & group ${icon("arrowRight")}</button></footer>`}
  </main>`;

  document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((button) => button.addEventListener("click", () => {
    activeFilter = button.dataset.filter as Category | "All";
    assignmentMode = null;
    render();
  }));
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
    const id = Number(input.dataset.id);
    input.checked ? selected.add(id) : selected.delete(id);
    render();
  }));
  document.querySelectorAll<HTMLInputElement>("[data-assign-id]").forEach((input) => input.addEventListener("change", async () => {
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
    render();
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
  const groups = allCategories().map((category) => ({ category, color: colorForCategory(category), tabIds: analysis!.tabs.filter((tab) => selected.has(tab.id) && tab.category === category).map((tab) => tab.id) })).filter((group) => group.tabIds.length);
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
    const response = await send<{ ok: boolean; tabs?: TabInput[]; error?: string }>({ type: "GET_TABS" });
    if (!response.ok || !response.tabs) throw new Error(response.error ?? "Tab inventory unavailable");
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
