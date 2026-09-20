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
    Promise.all([
      chrome.tabs.query({ currentWindow: true }),
      chrome.windows.getAll({ windowTypes: ["normal"] })
    ]).then(([tabs, windows]) => {
      const inventory: TabInput[] = tabs
        .filter((tab): tab is chrome.tabs.Tab & { id: number; windowId: number } => tab.id !== undefined && tab.windowId !== undefined)
        .filter((tab) => !tab.url?.startsWith("chrome://") && !tab.url?.startsWith("chrome-extension://"))
        .map((tab) => ({
          id: tab.id,
          windowId: tab.windowId,
          title: tab.title || "Untitled tab",
          url: tab.url || "",
          favIconUrl: tab.favIconUrl,
          pinned: Boolean(tab.pinned),
          active: Boolean(tab.active)
        }));
      sendResponse({ ok: true, tabs: inventory, windowCount: windows.length });
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
