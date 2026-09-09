import "./styles.css";
import { createClassifier } from "./classifier";
import { CATEGORIES, type Analysis, type Category, type ClassifiedTab, type Message, type TabInput } from "./types";

const app = document.querySelector<HTMLDivElement>("#app")!;
const classifier = createClassifier();
let analysis: Analysis | null = null;
let selected = new Set<number>();
let activeFilter: Category | "All" = "All";

function send<T>(message: Message): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]!);
}

function hostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function renderLoading(): void {
  app.innerHTML = `<main class="shell loading"><div class="mark">T</div><h1>Reading this window…</h1><p>Everything stays on your device.</p></main>`;
}

function renderError(message: string): void {
  app.innerHTML = `<main class="shell empty"><div class="mark">T</div><h1>Couldn’t read these tabs</h1><p>${escapeHtml(message)}</p><button id="retry" class="primary">Try again</button></main>`;
  document.querySelector("#retry")?.addEventListener("click", load);
}

function visibleTabs(): ClassifiedTab[] {
  return (analysis?.tabs ?? []).filter((tab) => activeFilter === "All" || tab.category === activeFilter);
}

function render(): void {
  if (!analysis) return;
  const tabs = analysis.tabs;
  const duplicates = new Set(tabs.filter((tab) => tab.duplicateGroup).map((tab) => tab.duplicateGroup)).size;
  const categories = CATEGORIES.filter((category) => tabs.some((tab) => tab.category === category));
  const filterHtml = ["All", ...categories].map((category) => {
    const count = category === "All" ? tabs.length : tabs.filter((tab) => tab.category === category).length;
    return `<button class="filter ${activeFilter === category ? "active" : ""}" data-filter="${category}">${category}<span>${count}</span></button>`;
  }).join("");
  const listHtml = visibleTabs().map((tab) => `
    <article class="tab-row ${tab.duplicateGroup ? "duplicate" : ""}">
      <label class="check"><input type="checkbox" data-id="${tab.id}" ${selected.has(tab.id) ? "checked" : ""}><span></span></label>
      <div class="favicon">${tab.favIconUrl ? `<img src="${escapeHtml(tab.favIconUrl)}" alt="">` : hostname(tab.url).slice(0, 1).toUpperCase()}</div>
      <div class="tab-copy"><h3>${escapeHtml(tab.title)}</h3><p>${escapeHtml(hostname(tab.url))}</p></div>
      <div class="tag tag-${tab.category.toLowerCase()}">${tab.category}</div>
      <div class="action ${tab.duplicateGroup ? "warn" : ""}">${tab.duplicateGroup ? "Likely duplicate" : tab.recommendation}</div>
    </article>`).join("");

  app.innerHTML = `<main class="shell">
    <header><div><div class="eyebrow"><span class="mark small">T</span> TABLOOM</div><h1>Turn tab chaos<br>into clear groups.</h1></div><button id="refresh" class="icon-button" title="Analyze again">↻</button></header>
    <section class="summary">
      <div><strong>${tabs.length}</strong><span>open tabs</span></div>
      <div><strong>${categories.length}</strong><span>suggested groups</span></div>
      <div><strong>${duplicates}</strong><span>duplicate sets</span></div>
      <div class="privacy"><span>●</span> Local analysis</div>
    </section>
    <nav>${filterHtml}</nav>
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
  const groups = CATEGORIES.map((category) => ({ category, tabIds: analysis!.tabs.filter((tab) => selected.has(tab.id) && tab.category === category).map((tab) => tab.id) })).filter((group) => group.tabIds.length);
  const response = await send<{ ok: boolean; error?: string }>({ type: "GROUP_TABS", groups });
  if (!response.ok) return renderError(response.error ?? "Grouping failed");
  app.innerHTML = `<main class="shell success"><div class="success-icon">✓</div><h1>Your tabs are organized.</h1><p>${selected.size} tabs were arranged into ${groups.length} color-coded groups. No tabs were closed.</p><button id="done" class="primary">Done</button></main>`;
  document.querySelector("#done")?.addEventListener("click", () => window.close());
}

async function load(): Promise<void> {
  renderLoading();
  try {
    const response = await send<{ ok: boolean; tabs?: TabInput[]; error?: string }>({ type: "GET_TABS" });
    if (!response.ok || !response.tabs) throw new Error(response.error ?? "Tab inventory unavailable");
    analysis = await classifier.classify(response.tabs);
    selected = new Set(analysis.tabs.filter((tab) => tab.recommendation === "Group" && !tab.pinned).map((tab) => tab.id));
    render();
  } catch (error) {
    renderError(error instanceof Error ? error.message : String(error));
  }
}

void load();
