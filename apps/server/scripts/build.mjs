// Bundles the server into one file. The packages that need native binaries or are
// resolved at runtime (esbuild bundles each edition; playwright drives Chromium;
// react/react-dom are what each edition is bundled *with*) stay external and are
// installed next to the bundle from the generated runtime-package.json.
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const external = ["esbuild", "playwright-core", "react", "react-dom"];

mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });

await build({
  entryPoints: [new URL("../src/index.ts", import.meta.url).pathname],
  outfile: new URL("../dist/server.mjs", import.meta.url).pathname,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  external,
  // Some bundled CommonJS dependencies call require() at runtime.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "info",
});

writeFileSync(
  new URL("../dist/runtime-package.json", import.meta.url),
  JSON.stringify(
    {
      name: "ai-homepage-server-runtime",
      private: true,
      type: "module",
      dependencies: Object.fromEntries(external.map((name) => [name, pkg.dependencies[name]])),
    },
    null,
    2,
  ) + "\n",
);
console.log("wrote dist/server.mjs and dist/runtime-package.json");
