import { esc } from "./layout";

export function sharePageHtml(shareId: string, styleNonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shared note</title>
<style nonce="${esc(styleNonce)}">
:root{color-scheme:light dark;--fg:#0a0a0a;--muted:#737373;--border:#e5e5e5;--bg:#fff}
@media(prefers-color-scheme:dark){:root{--fg:#fafafa;--muted:#a3a3a3;--border:rgba(255,255,255,.12);--bg:#0a0a0a}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--fg);font:16px/1.6 ui-sans-serif,system-ui,sans-serif;padding:2rem 1.25rem}
main{max-width:48rem;margin:0 auto}
h1{font-size:1.75rem;line-height:1.25;margin:0 0 1.25rem;font-weight:600}
.dim{color:var(--muted)}
.notes-preview{overflow-wrap:anywhere}
.notes-preview a{text-decoration:underline}
.notes-preview pre{padding:1rem;border:1px solid var(--border);border-radius:.5rem;overflow:auto}
.notes-preview table{border-collapse:collapse;display:block;overflow:auto}
.notes-preview th,.notes-preview td{padding:.35rem .6rem;border:1px solid var(--border)}
</style>
</head>
<body>
<main>
<p id="share-status" class="dim" role="status">Opening shared note…</p>
<h1 id="share-title" hidden></h1>
<article id="share-body" class="notes-preview" hidden></article>
</main>
<script src="/assets/share-viewer.js" defer data-share-id="${esc(shareId)}"></script>
</body>
</html>`;
}
