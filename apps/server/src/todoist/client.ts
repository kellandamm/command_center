import { dayKey } from "../store";

export interface TodoistDue {
  date: string;
  datetime?: string | null;
  string: string;
  timezone?: string | null;
}

export interface TodoistTask {
  id: string;
  content: string;
  description: string;
  priority: number;
  due: TodoistDue | null;
  url: string;
}

export type TodoistFetch = typeof fetch;

const API = "https://api.todoist.com/api/v1";
const PAGE_LIMIT = 200;
const MAX_PAGES = 50;

interface V1Due {
  date?: string;
  datetime?: string | null;
  string?: string;
  timezone?: string | null;
}

interface V1Task {
  id: string;
  content: string;
  description?: string;
  priority?: number;
  due?: V1Due | null;
  completed_at?: string;
}

interface V1TaskPage {
  results: V1Task[];
  next_cursor: string | null;
}

interface V1CompletedPage {
  items: V1Task[];
  next_cursor: string | null;
}

export interface TodoistCompletedTask {
  id: string;
  content: string;
  completedAt: string;
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function readError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string; error_tag?: string };
    return j.error ?? j.error_tag ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function mapV1Task(raw: V1Task): TodoistTask {
  const due = raw.due;
  return {
    id: String(raw.id),
    content: raw.content,
    description: raw.description ?? "",
    priority: raw.priority ?? 1,
    due: due
      ? {
          date: due.date ?? "",
          datetime: due.datetime ?? null,
          string: due.string ?? due.date ?? "",
          timezone: due.timezone ?? null,
        }
      : null,
    url: `https://app.todoist.com/app/task/${encodeURIComponent(String(raw.id))}`,
  };
}

async function fetchV1Pages<R>(
  token: string,
  urlForCursor: (cursor?: string) => string,
  parsePage: (body: unknown) => { rows: R[]; next?: string },
  fetchFn: TodoistFetch,
): Promise<R[]> {
  const out: R[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetchFn(urlForCursor(cursor), { headers: authHeaders(token) });
    if (!res.ok) throw new Error(await readError(res));
    const parsed = parsePage(await res.json());
    out.push(...parsed.rows);
    cursor = parsed.next;
    if (!cursor) break;
  }
  return out;
}

/** Completed tasks in `[since, until)` (ISO instants). Stub-friendly in tests. */
export async function listCompletedTasks(
  token: string,
  since: string,
  until: string,
  fetchFn: TodoistFetch = fetch,
): Promise<TodoistCompletedTask[]> {
  return fetchV1Pages(
    token,
    (cursor) => {
      const qs = new URLSearchParams({ since, until, limit: String(PAGE_LIMIT) });
      if (cursor) qs.set("cursor", cursor);
      return `${API}/tasks/completed/by_completion_date?${qs}`;
    },
    (body) => {
      const page = body as V1CompletedPage;
      const rows: TodoistCompletedTask[] = [];
      for (const row of page.items ?? []) {
        if (row.id && row.content && row.completed_at) {
          rows.push({ id: String(row.id), content: row.content, completedAt: row.completed_at });
        }
      }
      return { rows, next: page.next_cursor ?? undefined };
    },
    fetchFn,
  );
}

export async function listTasks(token: string, fetchFn: TodoistFetch = fetch): Promise<TodoistTask[]> {
  return fetchV1Pages(
    token,
    (cursor) => {
      const qs = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (cursor) qs.set("cursor", cursor);
      return `${API}/tasks?${qs}`;
    },
    (body) => {
      const page = body as V1TaskPage;
      return { rows: page.results.map(mapV1Task), next: page.next_cursor ?? undefined };
    },
    fetchFn,
  );
}

export interface CreateTaskInput {
  content: string;
  description?: string;
  dueDate?: string;
  dueDatetime?: string;
}

export async function createTask(
  token: string,
  input: string | CreateTaskInput,
  fetchFn: TodoistFetch = fetch,
): Promise<TodoistTask> {
  const body = typeof input === "string" ? { content: input } : input;
  const trimmed = body.content.trim();
  if (!trimmed) throw new Error("task content is required");
  const payload: Record<string, string> = { content: trimmed };
  if (body.description?.trim()) payload.description = body.description.trim();
  if (body.dueDate) payload.due_date = body.dueDate;
  if (body.dueDatetime) payload.due_datetime = body.dueDatetime;
  const res = await fetchFn(`${API}/tasks`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readError(res));
  return mapV1Task((await res.json()) as V1Task);
}

export async function completeTask(token: string, id: string, fetchFn: TodoistFetch = fetch): Promise<void> {
  const res = await fetchFn(`${API}/tasks/${encodeURIComponent(id)}/close`, {
    method: "POST",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(await readError(res));
}

/** Due calendar day in `tz` (YYYY-MM-DD), or null when the task has no due date. */
export function taskDueDay(task: TodoistTask, tz: string): string | null {
  const due = task.due;
  if (!due) return null;
  if (due.datetime) {
    const d = new Date(due.datetime);
    if (!Number.isNaN(d.getTime())) return dayKey(d, tz);
  }
  if (due.date && /^\d{4}-\d{2}-\d{2}$/.test(due.date)) return due.date;
  return null;
}

export interface PartitionedTasks {
  overdue: TodoistTask[];
  today: TodoistTask[];
}

/** Active tasks due today or earlier (overdue), sorted for display. */
export function partitionTodayAndOverdue(tasks: TodoistTask[], now: Date, tz: string): PartitionedTasks {
  const today = dayKey(now, tz);
  const overdue: TodoistTask[] = [];
  const todayList: TodoistTask[] = [];
  for (const t of tasks) {
    const day = taskDueDay(t, tz);
    if (!day) continue;
    if (day < today) overdue.push(t);
    else if (day === today) todayList.push(t);
  }
  const byPriority = (a: TodoistTask, b: TodoistTask) => b.priority - a.priority || a.content.localeCompare(b.content);
  overdue.sort(byPriority);
  todayList.sort(byPriority);
  return { overdue, today: todayList };
}
