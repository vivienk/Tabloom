import type { Analysis, Category, ClassifiedTab, TabInput } from "./types";

export interface TabClassifier {
  classify(tabs: TabInput[]): Promise<Analysis>;
}

const RULES: Array<{ category: Category; terms: string[] }> = [
  { category: "Work", terms: ["github", "gitlab", "linear", "jira", "slack", "notion", "figma", "docs.google", "drive.google", "linkedin", "job", "career", "greenhouse", "lever.co"] },
  { category: "Research", terms: ["arxiv", "wikipedia", "research", "paper", "scholar.google", "medium.com", "substack", "news", "article"] },
  { category: "Learning", terms: ["course", "tutorial", "learn", "documentation", "docs.", "developer.", "stackoverflow", "youtube.com/watch", "udemy", "coursera"] },
  { category: "Shopping", terms: ["amazon", "etsy", "ebay", "shop", "cart", "product", "store", "doordash", "instacart"] },
  { category: "Social", terms: ["reddit", "twitter", "x.com", "facebook", "instagram", "discord", "threads.net", "tiktok"] },
  { category: "Personal", terms: ["calendar", "mail.google", "gmail", "travel", "hotel", "flight", "bank", "health", "maps.google"] }
];

const TRACKING_PARAMS = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "ref"]);

function normalizedUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    url.searchParams.sort();
    return url.toString().toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function categorize(tab: TabInput): Pick<ClassifiedTab, "category" | "confidence" | "reason"> {
  const haystack = `${tab.title} ${tab.url}`.toLowerCase();
  let best: { category: Category; score: number; term: string } | undefined;
  for (const rule of RULES) {
    const matches = rule.terms.filter((term) => haystack.includes(term));
    if (matches.length && (!best || matches.length > best.score)) {
      best = { category: rule.category, score: matches.length, term: matches[0] };
    }
  }
  if (!best) return { category: "Inbox", confidence: 0.45, reason: "No strong local rule matched" };
  return {
    category: best.category,
    confidence: Math.min(0.95, 0.68 + best.score * 0.09),
    reason: `Matched “${best.term}” in the title or address`
  };
}

export class LocalTabClassifier implements TabClassifier {
  async classify(tabs: TabInput[]): Promise<Analysis> {
    const buckets = new Map<string, TabInput[]>();
    for (const tab of tabs) {
      const key = normalizedUrl(tab.url);
      buckets.set(key, [...(buckets.get(key) ?? []), tab]);
    }

    const tabsWithLabels = tabs.map<ClassifiedTab>((tab) => {
      const classification = categorize(tab);
      const key = normalizedUrl(tab.url);
      const duplicates = buckets.get(key) ?? [];
      const duplicateGroup = duplicates.length > 1 ? key : undefined;
      return {
        ...tab,
        ...classification,
        duplicateGroup,
        recommendation: duplicateGroup ? "Review duplicate" : classification.category === "Inbox" ? "Keep ungrouped" : "Group"
      };
    });

    return { tabs: tabsWithLabels, analyzedAt: Date.now() };
  }
}

// Swap this factory for a remote implementation later. The UI and background
// message contract only depend on TabClassifier, not on the provider.
export function createClassifier(): TabClassifier {
  return new LocalTabClassifier();
}
