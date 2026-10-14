import { githubGetJson } from "./client";

export const DEFAULT_GITHUB_USERNAME = "kellandamm";

export interface GithubIssueRow {
  number: number;
  title: string;
  url: string;
  repo: string;
  updatedAt: string;
  role?: "author" | "assignee";
}

export interface GithubEventRow {
  type: string;
  summary: string;
  url: string | null;
  createdAt: string;
}

export interface GithubActivitySnapshot {
  username: string;
  authenticated: boolean;
  warning: string | null;
  pulls: GithubIssueRow[];
  issues: GithubIssueRow[];
  events: GithubEventRow[];
  fetchedAt: string;
}

export function openPrSearchQuery(username: string): string {
  return `author:${username} is:pr is:open`;
}

export function openIssueSearchQuery(username: string): string {
  return `is:issue is:open (author:${username} OR assignee:${username})`;
}

type SearchItem = {
  number: number;
  title: string;
  html_url: string;
  updated_at: string;
  repository_url?: string;
  pull_request?: unknown;
};

type SearchResponse = { items?: SearchItem[]; incomplete_results?: boolean };

type PublicEvent = {
  type: string;
  created_at: string;
  repo?: { name?: string };
  payload?: Record<string, unknown>;
};

function repoFromApiUrl(repositoryUrl: string | undefined): string {
  if (!repositoryUrl) return "";
  const m = repositoryUrl.match(/\/repos\/([^/]+\/[^/]+)$/);
  return m ? m[1]! : "";
}

export function mapSearchItem(item: SearchItem, role?: GithubIssueRow["role"]): GithubIssueRow {
  return {
    number: item.number,
    title: item.title,
    url: item.html_url,
    repo: repoFromApiUrl(item.repository_url),
    updatedAt: item.updated_at,
    role,
  };
}

/** Stable key for deduping search results across queries. */
export function issueKey(row: Pick<GithubIssueRow, "repo" | "number">): string {
  return `${row.repo}#${row.number}`;
}

export function dedupeIssues(rows: GithubIssueRow[]): GithubIssueRow[] {
  const seen = new Set<string>();
  const out: GithubIssueRow[] = [];
  for (const row of rows) {
    const key = issueKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function describeEvent(ev: PublicEvent): { summary: string; url: string | null } {
  const repo = ev.repo?.name ?? "unknown";
  const p = ev.payload ?? {};
  switch (ev.type) {
    case "PushEvent": {
      const ref = typeof p.ref === "string" ? p.ref.replace(/^refs\/heads\//, "") : "branch";
      const n = Array.isArray(p.commits) ? p.commits.length : 0;
      return { summary: `Pushed ${n} commit${n === 1 ? "" : "s"} to ${repo} (${ref})`, url: `https://github.com/${repo}` };
    }
    case "PullRequestEvent": {
      const action = typeof p.action === "string" ? p.action : "updated";
      const pr = p.pull_request as { html_url?: string; title?: string } | undefined;
      const title = pr?.title ? `: ${pr.title}` : "";
      return { summary: `PR ${action}${title} · ${repo}`, url: pr?.html_url ?? `https://github.com/${repo}/pulls` };
    }
    case "IssuesEvent": {
      const action = typeof p.action === "string" ? p.action : "updated";
      const issue = p.issue as { html_url?: string; title?: string } | undefined;
      const title = issue?.title ? `: ${issue.title}` : "";
      return { summary: `Issue ${action}${title} · ${repo}`, url: issue?.html_url ?? `https://github.com/${repo}/issues` };
    }
    case "CreateEvent": {
      const refType = typeof p.ref_type === "string" ? p.ref_type : "ref";
      const ref = typeof p.ref === "string" ? p.ref : "";
      return { summary: `Created ${refType}${ref ? ` ${ref}` : ""} in ${repo}`, url: `https://github.com/${repo}` };
    }
    case "DeleteEvent": {
      const refType = typeof p.ref_type === "string" ? p.ref_type : "ref";
      return { summary: `Deleted ${refType} in ${repo}`, url: `https://github.com/${repo}` };
    }
    case "ForkEvent":
      return { summary: `Forked ${repo}`, url: `https://github.com/${repo}` };
    case "WatchEvent":
      return { summary: `Starred ${repo}`, url: `https://github.com/${repo}` };
    case "ReleaseEvent": {
      const action = typeof p.action === "string" ? p.action : "published";
      const release = p.release as { html_url?: string; name?: string } | undefined;
      const name = release?.name ? ` ${release.name}` : "";
      return { summary: `Release ${action}${name} · ${repo}`, url: release?.html_url ?? `https://github.com/${repo}/releases` };
    }
    case "IssueCommentEvent": {
      const action = typeof p.action === "string" ? p.action : "commented";
      const issue = p.issue as { html_url?: string; title?: string } | undefined;
      return { summary: `Comment ${action} on issue · ${repo}`, url: issue?.html_url ?? null };
    }
    default:
      return { summary: `${ev.type} · ${repo}`, url: `https://github.com/${repo}` };
  }
}

export function mapEvents(events: PublicEvent[], limit = 20): GithubEventRow[] {
  return events.slice(0, limit).map((ev) => {
    const { summary, url } = describeEvent(ev);
    return { type: ev.type, summary, url, createdAt: ev.created_at };
  });
}

function rateLimitWarning(status: number, authenticated: boolean): string | null {
  if (status === 403 || status === 429) {
    return authenticated
      ? "GitHub API rate limit or access error — try again later."
      : "GitHub API rate limit — set GITHUB_TOKEN for higher limits.";
  }
  return null;
}

export interface FetchGithubActivityOptions {
  username: string;
  token: string | null;
  now?: Date;
}

export async function fetchGithubActivity(opts: FetchGithubActivityOptions): Promise<GithubActivitySnapshot> {
  const username = opts.username.trim() || DEFAULT_GITHUB_USERNAME;
  const authenticated = Boolean(opts.token);
  const warnings: string[] = [];
  const headers = opts.token ? { authorization: `Bearer ${opts.token}` } : undefined;

  let pulls: GithubIssueRow[] = [];
  let issues: GithubIssueRow[] = [];
  let events: GithubEventRow[] = [];

  try {
    const prRes = await githubGetJson<SearchResponse>(
      `https://api.github.com/search/issues?q=${encodeURIComponent(openPrSearchQuery(username))}&per_page=15&sort=updated`,
      headers,
    );
    if (prRes.ok && prRes.data.items) {
      pulls = prRes.data.items.map((i) => mapSearchItem(i));
      const w = rateLimitWarning(prRes.status, authenticated);
      if (w) warnings.push(w);
      if (prRes.data.incomplete_results) warnings.push("GitHub search returned incomplete PR results.");
    } else if (!prRes.ok) {
      warnings.push(prRes.error ?? `GitHub PR search failed (HTTP ${prRes.status}).`);
    }
  } catch (err) {
    warnings.push(err instanceof Error ? err.message : String(err));
  }

  try {
    const issueRes = await githubGetJson<SearchResponse>(
      `https://api.github.com/search/issues?q=${encodeURIComponent(openIssueSearchQuery(username))}&per_page=20&sort=updated`,
      headers,
    );
    if (issueRes.ok && issueRes.data.items) {
      issues = dedupeIssues(issueRes.data.items.map((i) => mapSearchItem(i)));
      const w = rateLimitWarning(issueRes.status, authenticated);
      if (w) warnings.push(w);
      if (issueRes.data.incomplete_results) warnings.push("GitHub search returned incomplete issue results.");
    } else if (!issueRes.ok) {
      warnings.push(issueRes.error ?? `GitHub issue search failed (HTTP ${issueRes.status}).`);
    }
  } catch (err) {
    warnings.push(err instanceof Error ? err.message : String(err));
  }

  try {
    const evRes = await githubGetJson<PublicEvent[]>(
      `https://api.github.com/users/${encodeURIComponent(username)}/events/public?per_page=30`,
      headers,
    );
    if (evRes.ok && Array.isArray(evRes.data)) {
      events = mapEvents(evRes.data, 20);
      const w = rateLimitWarning(evRes.status, authenticated);
      if (w) warnings.push(w);
    } else if (!evRes.ok) {
      warnings.push(evRes.error ?? `GitHub events failed (HTTP ${evRes.status}).`);
    }
  } catch (err) {
    warnings.push(err instanceof Error ? err.message : String(err));
  }

  const uniqueWarnings = [...new Set(warnings.filter(Boolean))];
  return {
    username,
    authenticated,
    warning: uniqueWarnings.length ? uniqueWarnings.join(" ") : null,
    pulls,
    issues,
    events,
    fetchedAt: (opts.now ?? new Date()).toISOString(),
  };
}
