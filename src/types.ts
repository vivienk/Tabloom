export const CATEGORIES = ["Work", "Research", "Learning", "Shopping", "Social", "Personal", "Inbox"] as const;
export type Category = string;
export type GroupColor = "grey" | "blue" | "red" | "yellow" | "green" | "pink" | "purple" | "cyan" | "orange";

export type TabInput = {
  id: number;
  windowId: number;
  title: string;
  url: string;
  favIconUrl?: string;
  pinned: boolean;
  active: boolean;
};

export type Recommendation = "Group" | "Review duplicate" | "Keep ungrouped";

export type ClassifiedTab = TabInput & {
  category: Category;
  confidence: number;
  reason: string;
  duplicateGroup?: string;
  recommendation: Recommendation;
};

export type Analysis = {
  tabs: ClassifiedTab[];
  analyzedAt: number;
};

export type Message =
  | { type: "GET_TABS" }
  | { type: "GROUP_TABS"; groups: Array<{ category: Category; color: GroupColor; tabIds: number[] }> };
