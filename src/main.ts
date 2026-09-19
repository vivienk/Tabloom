import "./styles.css";
import { createClassifier } from "./classifier";
import { CATEGORIES, type Analysis, type Category, type ClassifiedTab, type Message, type TabInput } from "./types";

const app = document.querySelector<HTMLDivElement>("#app")!;
const classifier = createClassifier();
let analysis: Analysis | null = null;
let selected = new Set<number>();
let activeFilter: Category | "All" = "All";
let customCategories: string[] = [];
let categoryOverrides: Record<string, string> = {};
let addingCategory = false;

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

function allCategories(): string[] {
  return [...CATEGORIES, ...customCategories];
}

function renderLoading(): void {
  app.innerHTML = `<main class="shell loading"><img class="mark" src="/tabloom-logo.png" alt="Tabloom"><h1>Reading this window…</h1><p>Everything stays on your device.</p></main>`;
}

function renderError(message: string): void {
  app.innerHTML = `<main class="shell empty"><img class="mark" src="/tabloom-logo.png" alt="Tabloom"><h1>Couldn’t read these tabs</h1><p>${escapeHtml(message)}</p><button id="retry" class="primary">Try again</button></main>`;
  document.querySelector("#retry")?.addEventListener("click", load);
}

function visibleTabs(): ClassifiedTab[] {
  return (analysis?.tabs ?? []).filter((tab) => activeFilter === "All" || tab.category === activeFilter);
}

function render(): void {
  if (!analysis) return;
  const tabs = analysis.tabs;
  const duplicates = new Set(tabs.filter((tab) => tab.duplicateGroup).map((tab) => tab.duplicateGroup)).size;
  const categories = allCategories();
  const usedCategories = categories.filter((category) => tabs.some((tab) => tab.category === category));
  const filterHtml = ["All", ...usedCategories].map((category) => {
    const count = category === "All" ? tabs.length : tabs.filter((tab) => tab.category === category).length;
    return `<button class="filter ${activeFilter === category ? "active" : ""}" data-filter="${category}">${category}<span>${count}</span></button>`;
  }).join("");
  const addCategoryHtml = addingCategory ? `<form class="category-form" id="category-form">
    <input id="category-name" maxlength="28" placeholder="Category name" autocomplete="off" autofocus>
    <button class="mini-primary" type="submit">Add</button>
    <button class="mini-cancel" id="cancel-category" type="button">Cancel</button>
  </form>` : "";
  const listHtml = visibleTabs().map((tab) => `
    <article class="tab-row ${tab.duplicateGroup ? "duplicate" : ""}">
      <label class="check"><input type="checkbox" data-id="${tab.id}" ${selected.has(tab.id) ? "checked" : ""}><span></span></label>
      <div class="favicon">${tab.favIconUrl ? `<img src="${escapeHtml(tab.favIconUrl)}" alt="">` : hostname(tab.url).slice(0, 1).toUpperCase()}</div>
      <div class="tab-copy"><h3>${escapeHtml(tab.title)}</h3><p>${escapeHtml(hostname(tab.url))}</p></div>
      <select class="category-select" data-category-id="${tab.id}" aria-label="Category for ${escapeHtml(tab.title)}">
        ${categories.map((category) => `<option value="${escapeHtml(category)}" ${tab.category === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}
      </select>
      <div class="action ${tab.duplicateGroup ? "warn" : ""}">${tab.duplicateGroup ? "Likely duplicate" : tab.recommendation}</div>
    </article>`).join("");

  app.innerHTML = `<main class="shell">
    <header><div><div class="eyebrow"><img class="mark small" src="/tabloom-logo.png" alt=""> TABLOOM</div><h1>Turn tab chaos<br>into clear groups.</h1></div><button id="refresh" class="icon-button" title="Analyze again">↻</button></header>
    <section class="summary">
      <div><strong>${tabs.length}</strong><span>open tabs</span></div>
      <div><strong>${usedCategories.length}</strong><span>suggested groups</span></div>
      <div><strong>${duplicates}</strong><span>duplicate sets</span></div>
      <div class="privacy"><span>●</span> Local analysis</div>
    </section>
    <div class="category-bar"><nav>${filterHtml}</nav><button class="filter add-filter" id="add-category">+ Add category</button></div>
    ${addCategoryHtml}
    <section class="inventory-head"><div><h2>Preview</h2><p>Choose what gets organized. Nothing will be closed.</p></div><button id="select-suggested" class="text-button">Select suggested</button></section>
    <section class="tab-list">${listHtml || `<div class="no-results">No tabs in this category.</div>`}</section>
    <footer><div><strong>${selected.size}</strong> tabs selected</div><button id="group" class="primary" ${selected.size ? "" : "disabled"}>Approve & group <span>→</span></button></footer>
  </main>`;

  document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((button) => button.addEventListener("click", () => {
    activeFilter = button.dataset.filter as Category | "All";
    render();
  }));
  document.querySelectorAll<HTMLInputElement>("[data-id]").forEach((input) => input.addEventListener("change", () => {
    const id = Number(input.dataset.id);
    input.checked ? selected.add(id) : selected.delete(id);
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
    customCategories.push(name);
    await chrome.storage.local.set({ customCategories });
    activeFilter = name;
    addingCategory = false;
    render();
  });
  document.querySelector("#select-suggested")?.addEventListener("click", () => {
    selected = new Set(tabs.filter((tab) => tab.recommendation === "Group" && !tab.pinned).map((tab) => tab.id));
    render();
  });
  document.querySelector("#refresh")?.addEventListener("click", load);
  document.querySelector("#group")?.addEventListener("click", groupSelected);
}

async function groupSelected(): Promise<void> {
  if (!analysis || !selected.size) return;
  const button = document.querySelector<HTMLButtonElement>("#group")!;
  button.disabled = true;
  button.textContent = "Grouping…";
  const groups = allCategories().map((category) => ({ category, tabIds: analysis!.tabs.filter((tab) => selected.has(tab.id) && tab.category === category).map((tab) => tab.id) })).filter((group) => group.tabIds.length);
  const response = await send<{ ok: boolean; error?: string }>({ type: "GROUP_TABS", groups });
  if (!response.ok) return renderError(response.error ?? "Grouping failed");
  app.innerHTML = `<main class="shell success"><div class="success-icon">✓</div><h1>Your tabs are organized.</h1><p>${selected.size} tabs were arranged into ${groups.length} color-coded groups. No tabs were closed.</p><button id="done" class="primary">Done</button></main>`;
  document.querySelector("#done")?.addEventListener("click", () => window.close());
}

async function load(): Promise<void> {
  renderLoading();
  try {
    const saved = await chrome.storage.local.get(["customCategories", "categoryOverrides"]);
    customCategories = Array.isArray(saved.customCategories) ? saved.customCategories.filter((item): item is string => typeof item === "string") : [];
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
