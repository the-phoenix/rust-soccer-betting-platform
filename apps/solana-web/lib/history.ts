export type ActivityEntry = {
  id: string;
  kind: "query" | "execute";
  status: "success" | "error";
  label: string;
  detail: string;
  timestamp: string;
  signature?: string;
};

const STORAGE_KEY = "pitchpool-solana-activity-history";

export function readActivityHistory() {
  if (typeof window === "undefined") {
    return [] as ActivityEntry[];
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [] as ActivityEntry[];
  }

  try {
    const parsed = JSON.parse(raw) as ActivityEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeActivityHistory(entries: ActivityEntry[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function pushActivityEntry(entry: Omit<ActivityEntry, "id" | "timestamp">) {
  const entries = readActivityHistory();
  const nextEntry: ActivityEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  };
  const nextEntries = [nextEntry, ...entries].slice(0, 20);
  writeActivityHistory(nextEntries);
  return nextEntries;
}
