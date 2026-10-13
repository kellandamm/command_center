import { build, type Plugin } from "esbuild";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Turns the model's TSX into one self-contained HTML document, WITHOUT ever
 * executing the model's code on the server: esbuild only parses and bundles it.
 * The document runs later, in the viewer's browser, inside a sandboxed iframe
 * with no network (CSP connect-src 'none') and no same-origin access.
 */
const ALLOWED = new Set(["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client"]);
const PAGE = "homepage-model-page";
const here = dirname(fileURLToPath(import.meta.url));

export class RenderError extends Error {}

function allowlist(code: string): Plugin {
  return {
    name: "allowlist",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") return { path: "entry", namespace: "entry" };
        if (args.path === PAGE) return { path: PAGE, namespace: "page" };
        if (ALLOWED.has(args.path)) return undefined; // resolve normally from the server's node_modules
        if (args.importer === "" || args.namespace === "page") {
          return { errors: [{ text: `Import "${args.path}" is not allowed. Only react may be imported.` }] };
        }
        return undefined;
      });
      b.onLoad({ filter: /.*/, namespace: "page" }, () => ({ contents: code, loader: "tsx", resolveDir: here }));
      b.onLoad({ filter: /.*/, namespace: "entry" }, () => ({
        resolveDir: here,
        loader: "tsx",
        contents: `
          import * as React from "react";
          import { createRoot } from "react-dom/client";
          import Page from "${PAGE}";
          class Boundary extends React.Component<{children: React.ReactNode}, {err: unknown}> {
            state = { err: null as unknown };
            static getDerivedStateFromError(err: unknown) { return { err }; }
            render() {
              if (this.state.err) return React.createElement("div", { style: { font: "16px system-ui", padding: 24 } },
                "This edition could not be displayed: ", String((this.state.err as Error)?.message ?? this.state.err));
              return this.props.children;
            }
          }
          createRoot(document.getElementById("root")!).render(
            React.createElement(Boundary, null, React.createElement(Page as React.ComponentType))
          );`,
      }));
    },
  };
}

const GLUE = `
document.addEventListener("click", function (e) {
  var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
  if (!a) return;
  a.setAttribute("target", "_blank");
  a.setAttribute("rel", "noopener noreferrer");
}, true);
`;

const safeInline = (js: string) => js.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

export async function renderDocument(tsx: string, title = "Homepage"): Promise<string> {
  if (!/PersonalizedHomepage|export\s+default/.test(tsx)) throw new RenderError("The agent's file has no default-exported component.");
  if (tsx.length > 1_500_000) throw new RenderError("The agent's file is too large.");
  let js: string;
  try {
    const result = await build({
      entryPoints: ["entry"],
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      target: "es2020",
      minify: true,
      jsx: "automatic",
      legalComments: "none",
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [allowlist(tsx)],
      logLevel: "silent",
    });
    js = result.outputFiles[0]!.text;
  } catch (err: any) {
    const msg = err?.errors?.[0]?.text ?? String(err);
    throw new RenderError(`The page could not be compiled: ${msg}`);
  }
  const script = safeInline(js + "\n" + GLUE);
  const hash = createHash("sha256").update(script).digest("base64");
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${hash}'`,
    "style-src 'unsafe-inline'",
    "img-src https: data:",
    "font-src data:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
  const esc = title.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc}</title>
<style>html,body{margin:0}body{background:Canvas;color:CanvasText}</style></head>
<body><div id="root"></div><script>${script}</script></body></html>`;
}
