import type { Message, TabInput } from "./types";

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
      const created: string[] = [];
      for (const group of message.groups) {
        if (!group.tabIds.length) continue;
        const groupId = await chrome.tabs.group({ tabIds: group.tabIds });
        await chrome.tabGroups.update(groupId, { title: group.category, color: group.color ?? COLORS[group.category] ?? "grey", collapsed: false });
        created.push(group.category);
      }
      return created;
    })().then((created) => sendResponse({ ok: true, created }))
      .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "CLOSE_TAB") {
    chrome.tabs.remove(message.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
});
