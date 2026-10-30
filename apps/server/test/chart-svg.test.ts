import { test } from "node:test";
import assert from "node:assert/strict";
import { Script, createContext, runInContext } from "node:vm";
import { CHART_SVG_CLIENT } from "../src/ui/chart-svg";

function runCharts(code: string) {
  const ctx = createContext({
    document: {
      createElementNS(_ns: string, tag: string) {
        const attributes: Record<string, string> = {};
        return {
          tagName: tag,
          attributes,
          setAttribute(k: string, v: string) {
            attributes[k] = v;
          },
        };
      },
    },
  });
  runInContext(`${CHART_SVG_CLIENT}\n${code}`, ctx);
  return ctx as { result?: unknown; svg?: { children: Array<{ tagName: string; attributes: Record<string, string> }> } };
}

test("chart-svg: draws 100% cap line on line chart", () => {
  const ctx = runCharts(`
var svg={children:[],replaceChildren:function(){this.children=[]},appendChild:function(c){this.children.push(c)}};
chartRenderLine(svg,[{value:10,baseline:20},{value:30,baseline:40}],700,220,28,100);
result=svg.children.filter(function(c){return c.attributes&&c.attributes.class==="line-cap";}).length;
`);
  assert.equal(ctx.result, 1);
});

test("chart-svg: null baseline is not treated as over-baseline on dots", () => {
  const ctx = runCharts(`
var svg={children:[],replaceChildren:function(){this.children=[]},appendChild:function(c){this.children.push(c)}};
chartRenderLine(svg,[{value:50,baseline:null}],700,220,28,100);
var dot=svg.children.find(function(c){return c.tagName==="circle";});
result=dot&&dot.attributes.fill;
`);
  assert.equal(ctx.result, "var(--chart-1)");
});

test("chart-svg: bar uses under class when baseline is null", () => {
  const ctx = runCharts(`
var svg={children:[],replaceChildren:function(){this.children=[]},appendChild:function(c){this.children.push(c)}};
chartRenderBars(svg,[{value:80,baseline:null,noData:false}],700,200,28,100);
var rect=svg.children.find(function(c){return c.tagName==="rect";});
result=rect&&rect.attributes.class;
`);
  assert.equal(ctx.result, "bar-under");
});

test("chart-svg: 100% cap line is solid (not dashed)", () => {
  const ctx = runCharts(`
var svg={children:[],replaceChildren:function(){this.children=[]},appendChild:function(c){this.children.push(c)}};
chartRenderLine(svg,[{value:10,baseline:20}],700,220,28,100);
var cap=svg.children.find(function(c){return c.attributes&&c.attributes.class==="line-cap";});
result=cap&&cap.attributes["stroke-dasharray"];
`);
  assert.equal((ctx as { result: string }).result, "none");
});

test("chart-svg client script parses", () => {
  assert.doesNotThrow(() => new Script(CHART_SVG_CLIENT));
});
