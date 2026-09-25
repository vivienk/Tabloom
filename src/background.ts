import type { ClosedTab, Message, TabInput } from "./types";

const COLORS: Record<string, chrome.tabGroups.ColorEnum> = {
  Work: "blue",
  Research: "purple",
  Learning: "cyan",
  Shopping: "orange",
  Social: "pink",
  Personal: "green",
  Inbox: "grey"
};

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type === "GET_TABS") {
    chrome.windows.getAll({ populate: true, windowTypes: ["normal"] }).then((windows) => {
      const toTabInput = (tab: chrome.tabs.Tab): TabInput | null => {
        if (tab.id === undefined || tab.windowId === undefined) return null;
        if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) return null;
        return {
          id: tab.id,
          windowId: tab.windowId,
          title: tab.title || "Untitled tab",
          url: tab.url || "",
          favIconUrl: tab.favIconUrl,
          pinned: Boolean(tab.pinned),
          active: Boolean(tab.active)
        };
      };
      const inventory = windows.flatMap((window) => (window.tabs ?? []).flatMap((tab) => {
        const item = toTabInput(tab);
        return item ? [item] : [];
      }));
      const windowInventory = windows.flatMap((window) => window.id === undefined ? [] : [{
        id: window.id,
        focused: Boolean(window.focused),
        tabCount: inventory.filter((tab) => tab.windowId === window.id).length,
        activeTabTitle: window.tabs?.find((tab) => tab.active)?.title || "Untitled window"
      }]);
      sendResponse({ ok: true, tabs: inventory, windows: windowInventory });
    }).catch((error: unknown) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "GROUP_TABS") {
    (async () => {
      const organized: string[] = [];
      for (const group of message.groups) {
        if (!group.tabIds.length) continue;
        const firstTab = await chrome.tabs.get(group.tabIds[0]);
        const matchingGroups = (await chrome.tabGroups.query({ windowId: firstTab.windowId }))
          .filter((existing) => existing.title?.trim().toLowerCase() === group.category.trim().toLowerCase());
        const keeper = matchingGroups[0];
        const groupId = keeper
          ? await chrome.tabs.group({ groupId: keeper.id, tabIds: group.tabIds })
          : await chrome.tabs.group({ tabIds: group.tabIds });

        for (const duplicate of matchingGroups.slice(1)) {
          const duplicateTabs = await chrome.tabs.query({ groupId: duplicate.id });
          const duplicateTabIds = duplicateTabs.flatMap((tab) => tab.id === undefined ? [] : [tab.id]);
          if (duplicateTabIds.length) await chrome.tabs.group({ groupId, tabIds: duplicateTabIds });
        }
        await chrome.tabGroups.update(groupId, { title: group.category, color: group.color ?? COLORS[group.category] ?? "grey", collapsed: false });
        organized.push(group.category);
      }
      return organized;
    })().then((organized) => sendResponse({ ok: true, organized }))
      .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "UNGROUP_CATEGORY") {
    (async () => {
      const matchingGroups = (await chrome.tabGroups.query({}))
        .filter((group) => group.title?.trim().toLowerCase() === message.category.trim().toLowerCase());
      const tabIds = (await Promise.all(matchingGroups.map((group) => chrome.tabs.query({ groupId: group.id }))))
        .flat()
        .flatMap((tab) => tab.id === undefined ? [] : [tab.id]);
      if (tabIds.length) await chrome.tabs.ungroup(tabIds);
      return matchingGroups.length;
    })().then((removed) => sendResponse({ ok: true, removed }))
      .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "CLOSE_TAB") {
    chrome.tabs.remove(message.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "CLOSE_TABS") {
    chrome.tabs.remove(message.tabIds)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "GET_RECENTLY_CLOSED") {
    chrome.sessions.getRecentlyClosed({ maxResults: 25 }).then((sessions) => {
      const closedTabs: ClosedTab[] = sessions.flatMap((entry) => {
        if (entry.tab?.sessionId) return [{
          sessionId: entry.tab.sessionId,
          title: entry.tab.title || "Untitled tab",
          url: entry.tab.url || "",
          closedAt: entry.lastModified
        }];
        if (entry.window?.sessionId) return (entry.window.tabs ?? []).flatMap((tab) => tab.sessionId ? [{
          sessionId: tab.sessionId,
          title: tab.title || "Untitled tab",
          url: tab.url || "",
          closedAt: entry.lastModified
        }] : []);
        return [];
      });
      sendResponse({ ok: true, tabs: closedTabs });
    }).catch((error: unknown) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "RESTORE_TAB") {
    chrome.sessions.restore(message.sessionId)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "ACTIVATE_TAB") {
    Promise.all([
      chrome.windows.update(message.windowId, { focused: true }),
      chrome.tabs.update(message.tabId, { active: true })
    ]).then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
});
