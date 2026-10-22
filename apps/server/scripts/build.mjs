import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });

const editor = await build({
  entryPoints: [fileURLToPath(new URL("../src/ui/notes-editor.ts", import.meta.url))],
  bundle: true, platform: "browser", format: "iife", target: "es2022", minify: true, write: false,
});
const editorScript = editor.outputFiles[0].text;
await import("node:fs/promises").then(({ writeFile }) =>
  writeFile(new URL("../dist/notes-editor.js", import.meta.url), editorScript));

await build({
  entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
  outfile: fileURLToPath(new URL("../dist/server.mjs", import.meta.url)),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  define: { NOTES_EDITOR_SCRIPT: JSON.stringify(editorScript) },
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "info",
});

console.log("wrote dist/server.mjs");
