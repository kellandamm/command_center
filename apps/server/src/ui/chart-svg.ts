/** Server-side chart SVG helpers (shadcn-style monochrome + blue current series). */

export const CHART_SVG_CLIENT = `
function chartY(v,maxY,p,h){return v===null?null:p+(h-2*p)*(1-v/maxY);}
function chartGridLine(svg,x1,y1,x2,y2,cls){
  var ln=document.createElementNS("http://www.w3.org/2000/svg","line");
  ln.setAttribute("x1",String(x1));ln.setAttribute("y1",String(y1));ln.setAttribute("x2",String(x2));ln.setAttribute("y2",String(y2));
  ln.setAttribute("stroke","color-mix(in srgb,var(--border) 50%,transparent)");
  if(cls)ln.setAttribute("class",cls);
  svg.appendChild(ln);
}
function chartLineSeries(svg,points,cls){
  if(!points.length)return;
  var poly=document.createElementNS("http://www.w3.org/2000/svg","polyline");
  poly.setAttribute("points",points.join(" "));
  poly.setAttribute("class",cls);svg.appendChild(poly);
}
function chartRenderLine(svg,series,w,h,p,maxY){
  svg.replaceChildren();
  chartGridLine(svg,p,h-p,w-p,h-p);
  var capY=chartY(maxY,maxY,p,h);
  if(capY!==null)chartGridLine(svg,p,capY,w-p,capY,"line-cap");
  if(!series.length){chartText(svg,w/2,h/2,"No data");return;}
  var xs=series.map(function(_,i){return p+(w-2*p)*((i+0.5)/Math.max(7,series.length));});
  var basePts=series.map(function(pt,i){return pt.baseline===null?null:xs[i]+","+chartY(pt.baseline,maxY,p,h);}).filter(Boolean);
  chartLineSeries(svg,basePts,"line-baseline");
  var seg="";
  series.forEach(function(pt,i){
    if(pt.value===null)return;
    var coord=xs[i]+","+chartY(pt.value,maxY,p,h);
    if(!seg)seg=coord; else seg+=" "+coord;
    var dot=document.createElementNS("http://www.w3.org/2000/svg","circle");
    dot.setAttribute("cx",String(xs[i]));dot.setAttribute("cy",String(chartY(pt.value,maxY,p,h)));dot.setAttribute("r","4");
    dot.setAttribute("fill",pt.baseline!==null&&pt.value>pt.baseline?"var(--warning)":"var(--chart-1)");svg.appendChild(dot);
  });
  if(seg)chartLineSeries(svg,[seg],"line-usage");
}
function chartRenderBars(svg,rows,w,h,p,maxY){
  svg.replaceChildren();
  if(!rows.length){chartText(svg,w/2,h/2,"No data");return;}
  var capY=chartY(maxY,maxY,p,h);
  if(capY!==null)chartGridLine(svg,p,capY,w-p,capY,"line-cap");
  var slot=(w-2*p)/7;
  rows.forEach(function(row,i){
    var x=p+slot*i+slot*0.1,bw=slot*0.8;
    var baseY=chartY(row.baseline,maxY,p,h);
    if(baseY!==null){
      var bl=document.createElementNS("http://www.w3.org/2000/svg","line");
      bl.setAttribute("x1",String(x));bl.setAttribute("x2",String(x+bw));bl.setAttribute("y1",String(baseY));bl.setAttribute("y2",String(baseY));
      bl.setAttribute("stroke","var(--chart-2)");bl.setAttribute("stroke-dasharray","4 3");svg.appendChild(bl);
    }
    if(row.noData||row.value===null){chartText(svg,x+bw/2,h/2,"No data");}
    else{
      var bh=(h-2*p)*Math.min(1,row.value/maxY);
      var rect=document.createElementNS("http://www.w3.org/2000/svg","rect");
      rect.setAttribute("x",String(x));rect.setAttribute("width",String(bw));rect.setAttribute("y",String(h-p-bh));rect.setAttribute("height",String(bh));
      rect.setAttribute("rx","3");rect.setAttribute("class",row.baseline!==null&&row.value>row.baseline?"bar-over":"bar-under");svg.appendChild(rect);
    }
  });
}
function chartText(svg,x,y,t){
  var el=document.createElementNS("http://www.w3.org/2000/svg","text");
  el.setAttribute("x",String(x));el.setAttribute("y",String(y));el.setAttribute("text-anchor","middle");
  el.setAttribute("fill","var(--muted-foreground)");el.setAttribute("font-size","12");el.textContent=t;svg.appendChild(el);
}
`;
