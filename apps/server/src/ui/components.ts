import { esc } from "./layout";

export { esc };

export type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive" | "link";
export type ButtonSize = "default" | "sm" | "lg" | "icon";
export type BadgeVariant = "default" | "secondary" | "outline" | "destructive" | "warning" | "ok" | "info" | "neutral";

type Attrs = Record<string, string | number | boolean | undefined | null>;

function attrString(attrs?: Attrs): string {
  if (!attrs) return "";
  return Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(String(v))}"`))
    .join("");
}

function buttonClasses(variant: ButtonVariant, size: ButtonSize, className?: string): string {
  const parts = ["btn"];
  if (variant === "ghost") parts.push("ghost");
  else if (variant !== "default") parts.push(`btn-${variant}`);
  if (size === "sm") parts.push("btn-sm");
  else if (size === "lg") parts.push("btn-lg");
  else if (size === "icon") parts.push("btn-icon");
  if (className) parts.push(className);
  return parts.join(" ");
}

export function button(opts: {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  href?: string;
  attrs?: Attrs;
}): string {
  const variant = opts.variant ?? "default";
  const size = opts.size ?? "default";
  const cls = buttonClasses(variant, size, opts.className);
  const attrs = attrString(opts.attrs);
  if (opts.href) {
    return `<a class="${esc(cls)}" href="${esc(opts.href)}"${attrs}>${esc(opts.label)}</a>`;
  }
  return `<button type="button" class="${esc(cls)}"${attrs}>${esc(opts.label)}</button>`;
}

export function cardHeader(title: string, description?: string): string {
  const desc = description ? `<p class="ui-card-desc dim">${esc(description)}</p>` : "";
  return `<div class="ui-card-header"><h2 class="ui-card-title">${esc(title)}</h2>${desc}</div>`;
}

export function cardContent(body: string): string {
  return `<div class="ui-card-content">${body}</div>`;
}

export function card(opts: {
  title?: string;
  description?: string;
  body: string;
  className?: string;
  id?: string;
  size?: "default" | "sm";
  actionHtml?: string;
}): string {
  const idAttr = opts.id ? ` id="${esc(opts.id)}"` : "";
  const sizeClass = opts.size === "sm" ? " card-sm" : "";
  const extra = opts.className ? ` ${esc(opts.className)}` : "";
  const action = opts.actionHtml ? `<div class="ui-card-action">${opts.actionHtml}</div>` : "";
  const headerInner = opts.title
    ? `<h2 class="ui-card-title">${esc(opts.title)}</h2>${opts.description ? `<p class="ui-card-desc dim">${esc(opts.description)}</p>` : ""}`
    : opts.description
      ? `<p class="ui-card-desc dim">${esc(opts.description)}</p>`
      : "";
  const header = headerInner ? `<div class="ui-card-header-row">${headerInner}${action}</div>` : action;
  const headerWrap = header ? `<div class="ui-card-header">${header}</div>` : "";
  return `<section class="card${sizeClass}${extra}"${idAttr}>${headerWrap}${cardContent(opts.body)}</section>`;
}

export function pageHeader(opts: { title: string; description?: string; actionsHtml?: string }): string {
  const desc = opts.description ? `<p class="dim page-header-desc">${esc(opts.description)}</p>` : "";
  const actions = opts.actionsHtml ? `<div class="page-header-actions">${opts.actionsHtml}</div>` : "";
  return `<header class="page-header ui-page-header"><div class="page-header-main"><h1>${esc(opts.title)}</h1>${desc}</div>${actions}</header>`;
}

export function statCard(opts: {
  label: string;
  value: string;
  delta?: string;
  deltaDir?: "up" | "down" | "warn";
  hint?: string;
  iconHtml?: string;
}): string {
  const delta =
    opts.delta && opts.deltaDir
      ? `<span class="stat-delta stat-delta-${esc(opts.deltaDir)}">${esc(opts.delta)}</span>`
      : "";
  const hint = opts.hint ? `<p class="stat-hint dim">${esc(opts.hint)}</p>` : "";
  const ic = opts.iconHtml ? `<span class="stat-icon">${opts.iconHtml}</span>` : "";
  return `<article class="stat-card card card-sm">
  <div class="stat-card-top"><span class="stat-label dim">${esc(opts.label)}</span>${ic}</div>
  <div class="stat-value tabular-nums">${esc(opts.value)}</div>
  ${delta}
  ${hint}
</article>`;
}

export function statGrid(body: string): string {
  return `<div class="stat-grid">${body}</div>`;
}

export function skeleton(opts?: { lines?: number; className?: string }): string {
  const lines = Math.max(1, opts?.lines ?? 3);
  const extra = opts?.className ? ` ${esc(opts.className)}` : "";
  const rows = Array.from({ length: lines }, (_, i) => `<span class="skeleton-line${i === 0 ? " skeleton-line-wide" : ""}"></span>`).join("");
  return `<div class="skeleton${extra}" aria-hidden="true">${rows}</div>`;
}

/** Dashboard panel shell (title lives in grid chrome). */
export function panelCard(id: string, body: string): string {
  return `<section class="card" id="${esc(id)}">${cardContent(body)}</section>`;
}

export function badge(label: string, variant: BadgeVariant = "default", opts?: { dot?: boolean }): string {
  const cls =
    variant === "default"
      ? "ui-badge"
      : variant === "ok" || variant === "info" || variant === "neutral"
        ? `ui-badge ui-badge-soft ui-badge-${variant}`
        : `ui-badge ui-badge-${variant}`;
  const dot = opts?.dot ? '<span class="ui-badge-dot" aria-hidden="true"></span>' : "";
  return `<span class="${cls}">${dot}${esc(label)}</span>`;
}

export function tabs(items: Array<{ id: string; label: string; href: string }>, activeId: string): string {
  const links = items
    .map((item) => {
      const current = item.id === activeId ? ' aria-current="page"' : "";
      return `<a href="${esc(item.href)}"${current}>${esc(item.label)}</a>`;
    })
    .join("");
  return `<nav class="ui-tabs" role="tablist">${links}</nav>`;
}

export function table(opts: { head: string[]; rows: string[][]; caption?: string }): string {
  const head = opts.head.map((h) => `<th scope="col">${esc(h)}</th>`).join("");
  const body = opts.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("");
  const caption = opts.caption ? `<caption class="sr-only">${esc(opts.caption)}</caption>` : "";
  return `<table class="ui-table">${caption}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function field(opts: { label: string; id: string; hint?: string; error?: string; inputHtml: string }): string {
  const hint = opts.hint ? `<p class="ui-field-hint dim" id="${esc(opts.id)}-hint">${esc(opts.hint)}</p>` : "";
  const err = opts.error ? `<p class="ui-field-error bad" id="${esc(opts.id)}-error" role="alert">${esc(opts.error)}</p>` : "";
  return `<div class="ui-field">
  <label class="ui-field-label" for="${esc(opts.id)}">${esc(opts.label)}</label>
  ${opts.inputHtml}
  ${hint}
  ${err}
</div>`;
}

export function dialog(opts: { id: string; title: string; body: string; footer?: string }): string {
  return `<dialog class="ui-dialog" id="${esc(opts.id)}">
  <form method="dialog" class="ui-dialog-inner">
    <header class="ui-dialog-header"><h2 class="ui-dialog-title">${esc(opts.title)}</h2></header>
    <div class="ui-dialog-body">${opts.body}</div>
    ${opts.footer ? `<footer class="ui-dialog-footer">${opts.footer}</footer>` : ""}
  </form>
</dialog>`;
}

export function emptyState(opts: { title: string; description?: string; actionHtml?: string; iconHtml?: string }): string {
  const desc = opts.description ? `<p class="ui-empty-desc dim">${esc(opts.description)}</p>` : "";
  const action = opts.actionHtml ?? "";
  const ic = opts.iconHtml ? `<div class="ui-empty-icon" aria-hidden="true">${opts.iconHtml}</div>` : "";
  return `<div class="ui-empty" role="status">${ic}<p class="ui-empty-title">${esc(opts.title)}</p>${desc}${action}</div>`;
}

export function loadingState(message = "Loading…"): string {
  return `<div class="ui-loading" role="status" aria-busy="true">${skeleton({ lines: 3 })}<span class="visually-hidden">${esc(message)}</span></div>`;
}

export function errorState(message: string): string {
  return `<div class="ui-error" role="alert"><p class="ui-error-text bad">${esc(message)}</p></div>`;
}

/** Markup for client-rendered empty states (matches emptyState classes). */
export function emptyStateHtml(title: string): string {
  return emptyState({ title });
}
