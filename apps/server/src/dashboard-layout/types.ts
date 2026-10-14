export const LAYOUT_VERSION = 2;
export const GRID_COLS = 12;
export const GRID_ROW_HEIGHT_PX = 32;
export const GRID_GAP_PX = 6;

export interface PanelLayoutEntry {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  collapsed?: boolean;
}

export interface DashboardLayout {
  version: typeof LAYOUT_VERSION;
  cols: typeof GRID_COLS;
  rowHeight: typeof GRID_ROW_HEIGHT_PX;
  panels: PanelLayoutEntry[];
}
