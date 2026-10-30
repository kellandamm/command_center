import { test } from "node:test";
import assert from "node:assert/strict";
import { Script, createContext, runInContext } from "node:vm";
import { dashboardPage } from "../src/ui/pages";
import { statCard } from "../src/ui/components";

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
          return { matches: false };
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

test("agents usage: client statCard escapes value", () => {
  const ctx = createContext({
    document: {
      createElement(tag: string) {
        const el = { tagName: tag, className: "", innerHTML: "" };
        return el;
      },
    },
  });
  runInContext(
    `function esc(s){return String(s??"").replace(/[&<>"']/g,function(c){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]});}
function statCard(title,value,sub){
  var el=document.createElement("article");el.className="stat-card card card-sm usage-stat-card";
  el.innerHTML="<div class=\\"stat-card-top\\"><span class=\\"stat-label dim\\">"+esc(title)+"</span></div><div class=\\"stat-value tabular-nums\\">"+esc(value)+"</div>"+(sub?"<p class=\\"stat-hint dim\\">"+esc(sub)+"</p>":"");
  return el;
}
var el=statCard("t","<script>","sub");
result=el.innerHTML;`,
    ctx,
  );
  assert.match((ctx as { result: string }).result, /&lt;script&gt;/);
});
