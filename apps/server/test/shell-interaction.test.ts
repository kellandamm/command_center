import { test } from "node:test";
import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";
import { agentsUsagePage } from "../src/ui/agents-usage-page";
import { dashboardPage } from "../src/ui/pages";
import { statCard } from "../src/ui/components";

function usagePageScript(html: string): string {
  const m = html.match(/<script>\n([\s\S]*)<\/script><\/body>/);
  assert.ok(m, "usage page script");
  return m[1]!;
}

function extractFunction(script: string, name: string): string {
  const start = script.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} in usage page script`);
  const open = script.indexOf("{", start);
  assert.ok(open >= 0);
  let depth = 0;
  for (let i = open; i < script.length; i++) {
    const c = script[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return script.slice(start, i + 1);
    }
  }
  assert.fail(`${name} unclosed in usage script`);
}

test("shell: sidebar toggle persists cc-sidebar to localStorage", () => {
  const storage: Record<string, string> = {};
  const shellAttrs: Record<string, string> = { "data-sidebar-state": "expanded", "data-mobile-sidebar": "closed" };
  const htmlAttrs: Record<string, string> = {};
  const btnAttrs: Record<string, string> = { id: "sidebar-toggle" };
  const shell = {
    getAttribute(k: string) {
      return shellAttrs[k] ?? null;
    },
    setAttribute(k: string, v: string) {
      shellAttrs[k] = v;
    },
    querySelector(sel: string) {
      if (sel === ".sidebar") return sidebar;
      return null;
    },
  };
  const sidebar = {
    setAttribute() {},
    removeAttribute() {},
    addEventListener() {},
    querySelector() {
      return null;
    },
  };
  const toggleBtn = {
    getAttribute(k: string) {
      return btnAttrs[k] ?? null;
    },
    setAttribute(k: string, v: string) {
      btnAttrs[k] = v;
    },
    focus() {},
    addEventListener(_: string, fn: () => void) {
      toggleClick = fn;
    },
  };
  let toggleClick: (() => void) | undefined;
  const html = dashboardPage();
  const block = html.match(/\(function\(\)\{\s*var key="cc-sidebar"[\s\S]*?\}\)\(\);/)?.[0];
  assert.ok(block, "sidebar script present");
  runInContext(
    block!,
    createContext({
      localStorage: {
        getItem(k: string) {
          return storage[k] ?? null;
        },
        setItem(k: string, v: string) {
          storage[k] = v;
        },
      },
      document: {
        documentElement: {
          setAttribute(k: string, v: string) {
            htmlAttrs[k] = v;
          },
        },
        querySelector(sel: string) {
          if (sel === ".app-shell") return shell;
          if (sel === "#sidebar-toggle") return toggleBtn;
          return null;
        },
        getElementById(id: string) {
          if (id === "sidebar-toggle") return toggleBtn;
          return null;
        },
        addEventListener() {},
      },
      window: {
        matchMedia() {
          return { matches: false, addEventListener() {} };
        },
      },
    }),
  );
  assert.ok(toggleClick);
  toggleClick!();
  assert.equal(storage["cc-sidebar"], "collapsed");
  assert.equal(btnAttrs["aria-expanded"], "false");
});

test("components: statCard escapes value HTML", () => {
  const evil = `<img onerror=alert(1)>`;
  const html = statCard({ label: "x", value: evil });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test("agents usage: client statCard from emitted page script escapes value", () => {
  const script = usagePageScript(agentsUsagePage());
  const escFn = extractFunction(script, "esc");
  const statCardFn = extractFunction(script, "statCard");
  const ctx = createContext({
    document: {
      createElement(tag: string) {
        return { tagName: tag, className: "", innerHTML: "" };
      },
    },
  });
  runInContext(
    `${escFn}
${statCardFn}
var el=statCard("t","<script>","sub");
result=el.innerHTML;`,
    ctx,
  );
  assert.match((ctx as { result: string }).result, /&lt;script&gt;/);
});
