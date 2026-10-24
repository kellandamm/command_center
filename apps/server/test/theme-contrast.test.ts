import assert from "node:assert/strict";
import { test } from "node:test";
import { THEME_DARK, THEME_LIGHT, type ThemeTokens } from "../src/ui/theme-tokens";

type Rgb = { r: number; g: number; b: number };

function parseColor(raw: string, on?: Rgb): Rgb {
  const hex = raw.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const rgba = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgba) {
    const fg: Rgb = { r: +rgba[1], g: +rgba[2], b: +rgba[3] };
    const a = rgba[4] !== undefined ? +rgba[4] : 1;
    if (a >= 1 || !on) return fg;
    return {
      r: Math.round(fg.r * a + on.r * (1 - a)),
      g: Math.round(fg.g * a + on.g * (1 - a)),
      b: Math.round(fg.b * a + on.b * (1 - a)),
    };
  }
  throw new Error(`unsupported color: ${raw}`);
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(fg: string, bg: string, bgUnder?: Rgb): number {
  const bgRgb = parseColor(bg, bgUnder);
  const fgRgb = parseColor(fg, bgRgb);
  const l1 = relativeLuminance(fgRgb);
  const l2 = relativeLuminance(bgRgb);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const PAIRS: Array<{ fg: string; bg: string; label: string }> = [
  { fg: "foreground", bg: "background", label: "body text" },
  { fg: "card-foreground", bg: "card", label: "card" },
  { fg: "primary-foreground", bg: "primary", label: "primary button" },
  { fg: "secondary-foreground", bg: "secondary", label: "secondary" },
  { fg: "muted-foreground", bg: "background", label: "muted on page" },
  { fg: "accent-foreground", bg: "accent", label: "accent" },
  { fg: "warning-foreground", bg: "warning", label: "warning" },
  { fg: "attention-foreground", bg: "attention", label: "attention" },
  { fg: "destructive", bg: "background", label: "destructive text" },
];

function assertThemeContrast(mode: string, tokens: ThemeTokens) {
  const bgBase = parseColor(tokens.background);
  for (const { fg, bg, label } of PAIRS) {
    const ratio = contrastRatio(tokens[fg], tokens[bg], bgBase);
    assert.ok(
      ratio >= 4.5,
      `${mode} ${label}: ${tokens[fg]} on ${tokens[bg]} = ${ratio.toFixed(2)}:1 (need 4.5:1)`,
    );
  }
}

test("theme tokens meet WCAG AA contrast (light)", () => {
  assertThemeContrast("light", THEME_LIGHT);
});

test("theme tokens meet WCAG AA contrast (dark)", () => {
  assertThemeContrast("dark", THEME_DARK);
});
