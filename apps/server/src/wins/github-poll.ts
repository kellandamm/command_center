import { githubGetJson } from "../github/client";
import { DEFAULT_GITHUB_USERNAME } from "../github/activity";
import type { WinsStore } from "./store";

type SearchItem = {
  number: number;
  title: string;
  html_url: string;
  closed_at?: string;
  repository_url?: string;
};

type SearchResponse = { items?: SearchItem[] };

function repoFromApiUrl(repositoryUrl: string | undefined): string {
  if (!repositoryUrl) return "";
  const m = repositoryUrl.match(/\/repos\/([^/]+\/[^/]+)$/);
  return m ? m[1]! : "";
}

export function mergedPrSearchQuery(username: string, sinceYmd: string): string {
  return `author:${username} is:pr is:merged base:main merged:>=${sinceYmd}`;
}

/** Poll merged PRs; no-op without token (no throws, no logging). */
export async function pollMergedPullRequestWins(opts: {
  username: string;
  token: string | null;
  wins: WinsStore;
  sinceIso: string;
  now?: Date;
}): Promise<number> {
  if (!opts.token) return 0;
  const username = opts.username.trim() || DEFAULT_GITHUB_USERNAME;
  const sinceDate = opts.sinceIso.slice(0, 10);
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(
    mergedPrSearchQuery(username, sinceDate),
  )}&per_page=30&sort=updated`;
  const res = await githubGetJson<SearchResponse>(url, { authorization: `Bearer ${opts.token}` });
  if (!res.ok || !res.data.items?.length) return 0;
  let added = 0;
  for (const item of res.data.items) {
    const repo = repoFromApiUrl(item.repository_url);
    const ref = repo ? `${repo}#${item.number}` : String(item.number);
    const at = item.closed_at ?? (opts.now ?? new Date()).toISOString();
    const win = opts.wins.add({ source: "pr", ref, title: item.title, at });
    if (win) added++;
  }
  return added;
}
