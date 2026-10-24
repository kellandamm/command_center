export interface TaskBlock {
  taskId: string | null;
  start: string;
  enabled?: boolean;
}

export function earliestBlockStartByCard(blocks: TaskBlock[], nowMs = Date.now()): Map<string, string> {
  const map = new Map<string, string>();
  for (const block of blocks) {
    if (!block.taskId || block.enabled === false) continue;
    const t = Date.parse(block.start);
    if (!Number.isFinite(t) || t < nowMs) continue;
    const prev = map.get(block.taskId);
    if (!prev || block.start < prev) map.set(block.taskId, block.start);
  }
  return map;
}
