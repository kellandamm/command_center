import type { PanelLayoutEntry } from "./types";
import { GRID_COLS } from "./types";

export function effectiveHeight(p: PanelLayoutEntry): number {
  return p.collapsed ? 1 : p.h;
}

export function rectanglesOverlap(a: PanelLayoutEntry, b: PanelLayoutEntry): boolean {
  const ah = effectiveHeight(a);
  const bh = effectiveHeight(b);
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + bh && a.y + ah > b.y;
}

/** Push panels that overlap `anchorId` downward (cascade). */
export function packAfterMove(panels: PanelLayoutEntry[], anchorId: string): PanelLayoutEntry[] {
  const out = panels.map((p) => ({ ...p }));
  const anchor = out.find((p) => p.id === anchorId);
  if (!anchor) return out;

  const queue: PanelLayoutEntry[] = [anchor];
  const queued = new Set<string>([anchorId]);

  while (queue.length) {
    const current = queue.shift()!;
    for (const other of out) {
      if (other.id === current.id) continue;
      if (!rectanglesOverlap(current, other)) continue;
      const needY = current.y + effectiveHeight(current);
      if (other.y < needY) {
        other.y = needY;
        if (other.x + other.w > GRID_COLS) other.x = Math.max(0, GRID_COLS - other.w);
        if (!queued.has(other.id)) {
          queued.add(other.id);
          queue.push(other);
        }
      }
    }
  }
  return out;
}

export function maxOccupiedRow(panels: PanelLayoutEntry[]): number {
  return panels.reduce((max, p) => Math.max(max, p.y + effectiveHeight(p)), 0);
}

export function packDashboardLayout(panels: PanelLayoutEntry[]): PanelLayoutEntry[] {
  let out = panels.map((p) => ({ ...p }));
  for (const p of out) out = packAfterMove(out, p.id);
  return out;
}

export function overlappingPanelPairs(panels: PanelLayoutEntry[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      if (rectanglesOverlap(panels[i], panels[j])) pairs.push([panels[i].id, panels[j].id]);
    }
  }
  return pairs;
}
