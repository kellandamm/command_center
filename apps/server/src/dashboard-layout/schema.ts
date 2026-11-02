import { z } from "zod";

export const LAYOUT_VERSION = 3 as const;
export const MAX_WIDGETS = 40;
export const MAX_LAYOUT_BYTES = 16_384;

export const widgetSizeSchema = z.enum(["S", "W", "L", "XL"]);
export type WidgetSize = z.infer<typeof widgetSizeSchema>;

export const widgetEntrySchema = z.object({
  id: z.string().min(1).max(64),
  size: widgetSizeSchema,
  config: z.record(z.string(), z.unknown()).optional(),
});

export type WidgetLayoutEntry = z.infer<typeof widgetEntrySchema>;

export const dashboardLayoutV3Schema = z.object({
  version: z.literal(LAYOUT_VERSION),
  registryEpoch: z.number().int().min(0).max(100).optional(),
  widgets: z.array(widgetEntrySchema).max(MAX_WIDGETS),
});

export type DashboardLayoutV3 = z.infer<typeof dashboardLayoutV3Schema>;

/** Legacy v2 panel entry (still accepted on import). */
export const legacyPanelSchema = z.object({
  id: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().optional(),
  h: z.number().optional(),
  collapsed: z.boolean().optional(),
});

export const legacyLayoutSchema = z
  .object({
    version: z.number().optional(),
    cols: z.number().optional(),
    rowHeight: z.number().optional(),
    panels: z.array(legacyPanelSchema).optional(),
    widgets: z.array(widgetEntrySchema).optional(),
  })
  .passthrough();
