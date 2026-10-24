import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = fileURLToPath(new URL("..", import.meta.url));
const reactRoot = path.join(serverRoot, "node_modules/react");
const reactDomRoot = path.join(serverRoot, "node_modules/react-dom");
/** tunnel-rat (via Excalidraw) otherwise resolves react@19 next to react@18 and breaks hooks. */
const reactAliases = {
  react: reactRoot,
  "react-dom": reactDomRoot,
  "react/jsx-runtime": path.join(reactRoot, "jsx-runtime.js"),
  "react-dom/client": path.join(reactDomRoot, "client.js"),
};

mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });

const editor = await build({
  entryPoints: [fileURLToPath(new URL("../src/ui/notes-editor.ts", import.meta.url))],
  bundle: true, platform: "browser", format: "iife", target: "es2022", minify: true, write: false,
});
const editorScript = editor.outputFiles[0].text;
await import("node:fs/promises").then(({ writeFile }) =>
  writeFile(new URL("../dist/notes-editor.js", import.meta.url), editorScript));

const whiteboard = await build({
  entryPoints: [fileURLToPath(new URL("../src/ui/whiteboard-editor.tsx", import.meta.url))],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  minify: true,
  write: false,
  jsx: "automatic",
  loader: { ".css": "empty" },
  define: { "process.env.NODE_ENV": '"production"' },
  alias: reactAliases,
  mainFields: ["module", "main"],
  conditions: ["production", "import", "module", "browser", "default"],
});
const whiteboardScript = whiteboard.outputFiles[0].text;
await import("node:fs/promises").then(({ writeFile }) =>
  writeFile(new URL("../dist/whiteboard-editor.js", import.meta.url), whiteboardScript));

const excalidrawProd = fileURLToPath(
  new URL("../node_modules/@excalidraw/excalidraw/dist/prod", import.meta.url),
);
const excalidrawOut = fileURLToPath(new URL("../dist/excalidraw-assets", import.meta.url));
cpSync(excalidrawProd, excalidrawOut, { recursive: true });

await build({
  entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
  outfile: fileURLToPath(new URL("../dist/server.mjs", import.meta.url)),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  define: {
    NOTES_EDITOR_SCRIPT: JSON.stringify(editorScript),
    WHITEBOARD_EDITOR_SCRIPT: JSON.stringify(whiteboardScript),
  },
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "info",
});

console.log("wrote dist/server.mjs");
