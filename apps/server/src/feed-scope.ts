import type { FeedsStore } from "./feeds/store";
import type { Settings } from "./settings";

export type FeedScope = Settings["feedScope"];

export function folderIdsForScope(store: FeedsStore, scope: FeedScope): string[] {
  if (scope.mode === "all") return [];
  const ids = new Set<string>();
  for (const fid of scope.folderIds) {
    for (const id of store.folderIdsWithDescendants(fid)) ids.add(id);
  }
  return [...ids];
}

export function feedIdsInScope(store: FeedsStore, scope: FeedScope): string[] | null {
  if (scope.mode === "all") return null;
  const folderIds = folderIdsForScope(store, scope);
  if (!folderIds.length) return [];
  return store.feedIdsInFolderIds(folderIds);
}
