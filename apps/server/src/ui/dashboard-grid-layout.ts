/** Shared dashboard layout helpers (inlined into dashboard-grid.ts client script). */

export const DASHBOARD_GRID_LAYOUT_HELPERS = `
function effH(p){return p.collapsed?1:p.h}
function overlaps(a,b){
  return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+effH(b)&&a.y+effH(a)>b.y;
}
function compactDashboardRows(panels){
  var out=panels.map(function(p){return Object.assign({},p)});
  var sorted=out.slice().sort(function(a,b){return a.y-b.y||a.x-b.x});
  sorted.forEach(function(panel){
    var entry=out.find(function(p){return p.id===panel.id});
    if(!entry)return;
    var bestY=entry.y;
    for(var y=0;y<entry.y;y++){
      var trial=Object.assign({},entry,{y:y});
      var blocked=out.some(function(other){return other.id!==entry.id&&overlaps(trial,other);});
      if(!blocked){bestY=y;break;}
    }
    entry.y=bestY;
  });
  return out;
}
function columnPackLayout(panels,rowH,gap,cols,stripH){
  var colBottom=new Array(cols).fill(0);
  var sorted=panels.slice().sort(function(a,b){return a.y-b.y||a.x-b.x});
  var rects={};
  sorted.forEach(function(p){
    var top=0;
    for(var c=p.x;c<p.x+p.w;c++)top=Math.max(top,colBottom[c]);
    var height=p.collapsed?stripH:(p.h*rowH+(p.h-1)*gap);
    rects[p.id]={top:top,height:height};
    for(var c=p.x;c<p.x+p.w;c++)colBottom[c]=top+height+gap;
  });
  var gridH=0;
  colBottom.forEach(function(b){if(b>gridH)gridH=b;});
  return {rects:rects,gridH:Math.max(stripH,gridH-gap)};
}
`;
