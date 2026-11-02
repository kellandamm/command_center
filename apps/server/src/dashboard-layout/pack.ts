import type { PanelLayoutEntry } from "./types";
import type { WidgetLayoutEntry, WidgetSize } from "./schema";
import { SIZE_DIMS } from "./sizes";

export function sizeDims(size: WidgetSize): { w: number; h: number } {
  return SIZE_DIMS[size];
}

/** Flow-pack widgets into a 12-column grid (array order). */
export function packWidgetFlow(widgets: WidgetLayoutEntry[]): PanelLayoutEntry[] {
  const cols = 12;
  const colHeights = new Array<number>(cols).fill(0);
  const out: PanelLayoutEntry[] = [];

  for (const widget of widgets) {
    const { w, h } = sizeDims(widget.size);
    let bestX = 0;
    let bestY = Number.POSITIVE_INFINITY;
    for (let x = 0; x <= cols - w; x++) {
      const y = Math.max(...colHeights.slice(x, x + w));
      if (y < bestY) {
        bestY = y;
        bestX = x;
      }
    }
    out.push({
      id: widget.id,
      x: bestX,
      y: bestY,
      w,
      h,
      size: widget.size,
      ...(widget.config ? { config: widget.config } : {}),
    });
    for (let c = bestX; c < bestX + w; c++) colHeights[c] = bestY + h;
  }
  return out;
}

export function maxOccupiedRow(panels: PanelLayoutEntry[]): number {
  let max = 0;
  for (const p of panels) {
    max = Math.max(max, p.y + p.h);
  }
  return max;
}

export function rectanglesOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function overlappingPanelPairs(panels: PanelLayoutEntry[]): string[] {
  const hits: string[] = [];
  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      if (rectanglesOverlap(panels[i]!, panels[j]!)) hits.push(`${panels[i]!.id}×${panels[j]!.id}`);
    }
  }
  return hits;
}

export function packAfterMove(panels: PanelLayoutEntry[], _anchorId: string): PanelLayoutEntry[] {
  const sorted = [...panels].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: PanelLayoutEntry[] = [];
  for (const p of sorted) {
    let y = p.y;
    for (;;) {
      const candidate = { ...p, y };
      const hit = out.find((placed) => rectanglesOverlap(candidate, placed));
      if (!hit) {
        out.push(candidate);
        break;
      }
      y = hit.y + hit.h;
    }
  }
  return out;
}

export function packDashboardLayout(panels: PanelLayoutEntry[]): PanelLayoutEntry[] {
  return panels;
}

export function effH(p: { h: number; collapsed?: boolean }): number {
  return p.collapsed ? 1 : p.h;
}
