/** Gray neutral + royal blue primary + orange accent (shadcn-style SSR tokens). */
export type ThemeTokens = Record<string, string>;

export const THEME_LIGHT: ThemeTokens = {
  background: "#fafafa",
  foreground: "#18181b",
  card: "#ffffff",
  "card-foreground": "#18181b",
  // shortcut: #3b5fd9 is slightly deeper than royal #4169E1 for AA with white button text
  primary: "#3b5fd9",
  "primary-foreground": "#ffffff",
  secondary: "#f4f4f5",
  "secondary-foreground": "#18181b",
  muted: "#f4f4f5",
  "muted-foreground": "#71717a",
  accent: "#ffedd5",
  "accent-foreground": "#9a3412",
  destructive: "#dc2626",
  // shortcut: orange-700 for warning/attention (not orange-500) so white text passes 4.5:1
  warning: "#c2410c",
  "warning-foreground": "#ffffff",
  attention: "#c2410c",
  "attention-foreground": "#ffffff",
  border: "#e4e4e7",
  input: "#e4e4e7",
  ring: "#3b5fd9",
  // shortcut: ~13% primary mixed into surface (computed offline for SSR tokens)
  selected: "#e1e6f6",
  "selected-foreground": "#2f4fc4",
  sidebar: "#f4f4f5",
  "sidebar-foreground": "#18181b",
  "sidebar-border": "#e4e4e7",
  "sidebar-primary": "#dce0f1",
  "sidebar-primary-foreground": "#2f4fc4",
  "sidebar-accent": "#fff4e6",
  "sidebar-accent-foreground": "#18181b",
  "chart-1": "#3b5fd9",
  "chart-2": "#6284e8",
  "chart-3": "#8fa8f0",
  "chart-4": "#1e40af",
  "chart-5": "#93b4f5",
  ok: "#16a34a",
};

export const THEME_DARK: ThemeTokens = {
  background: "#09090b",
  foreground: "#fafafa",
  card: "#18181b",
  "card-foreground": "#fafafa",
  primary: "#6b8fe8",
  "primary-foreground": "#09090b",
  secondary: "#27272a",
  "secondary-foreground": "#fafafa",
  muted: "#27272a",
  "muted-foreground": "#a1a1aa",
  accent: "#2a2420",
  "accent-foreground": "#fafafa",
  destructive: "#f87171",
  warning: "#fb923c",
  "warning-foreground": "#09090b",
  attention: "#fdba74",
  "attention-foreground": "#09090b",
  border: "rgba(255,255,255,0.1)",
  input: "rgba(255,255,255,0.15)",
  ring: "#6b8fe8",
  selected: "#161a28",
  "selected-foreground": "#93b4f5",
  sidebar: "#18181b",
  "sidebar-foreground": "#fafafa",
  "sidebar-border": "rgba(255,255,255,0.1)",
  "sidebar-primary": "#232736",
  "sidebar-primary-foreground": "#93b4f5",
  "sidebar-accent": "#2a2420",
  "sidebar-accent-foreground": "#fafafa",
  "chart-1": "#6b8fe8",
  "chart-2": "#8fa8f0",
  "chart-3": "#3b5fd9",
  "chart-4": "#93b4f5",
  "chart-5": "#1e3a8a",
  ok: "#4ade80",
};

export const THEME_META_COLORS = { light: THEME_LIGHT.background, dark: THEME_DARK.background } as const;

export function formatThemeVars(tokens: ThemeTokens): string {
  return Object.entries(tokens)
    .map(([key, value]) => `--${key}:${value}`)
    .join(";");
}
