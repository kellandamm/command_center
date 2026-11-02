import { esc } from "../ui/layout";
import type { ServiceCheckResult } from "../service-status/checks";

function dotClass(state: ServiceCheckResult["state"]): string {
  if (state === "up") return "dashboard-status-dot--blue";
  if (state === "down") return "dashboard-status-dot--orange";
  return "dashboard-status-dot--muted";
}

export function renderServiceStatusWidget(results: ServiceCheckResult[]): string {
  if (!results.length) {
    return `<div class="widget-service-status service-grid" data-service-status-root>
  <p class="dim service-status-checking">Checking services…</p>
</div>`;
  }
  const cells = results
    .map((r) => {
      const detail =
        r.state === "not_configured"
          ? "not configured"
          : r.state === "unknown"
            ? "unknown"
            : r.latencyMs != null
              ? `${r.latencyMs} ms`
              : r.downFor ?? "down";
      const border = r.state === "down" ? " service-cell-down" : "";
      return `<div class="service-cell${border}"><span class="dashboard-status-dot ${dotClass(r.state)}"></span><span>${esc(r.label)}</span><span class="dim service-cell-meta">${esc(detail)}</span></div>`;
    })
    .join("");
  return `<div class="widget-service-status service-grid" data-service-status-root>${cells}</div>`;
}

export function serviceStatusClientScript(): string {
  return `
(function(){
  var root=document.querySelector("[data-service-status-root]");
  if(!root)return;
  fetch("/api/widgets/service-status",{credentials:"same-origin"})
    .then(function(r){if(!r.ok)throw new Error("status");return r.json();})
    .then(function(data){
      var services=data.services||[];
      if(!services.length){root.innerHTML='<p class="dim">No services configured.</p>';return;}
      root.innerHTML=services.map(function(r){
        var dot=r.state==="up"?"dashboard-status-dot--blue":r.state==="down"?"dashboard-status-dot--orange":"dashboard-status-dot--muted";
        var detail=r.state==="not_configured"?"not configured":r.state==="unknown"?"unknown":(r.latencyMs!=null?r.latencyMs+" ms":(r.downFor||"down"));
        var border=r.state==="down"?" service-cell-down":"";
        return '<div class="service-cell'+border+'"><span class="dashboard-status-dot '+dot+'"></span><span>'+String(r.label).replace(/</g,"&lt;")+'</span><span class="dim service-cell-meta">'+String(detail).replace(/</g,"&lt;")+'</span></div>';
      }).join("");
      var card=root.closest(".dashboard-item[data-widget-id=\\"service-status\\"]");
      var headerDot=card&&card.querySelector(".dashboard-widget-chrome .dashboard-status-dot");
      if(headerDot){
        var down=services.some(function(s){return s.state==="down";});
        var unknown=services.some(function(s){return s.state==="unknown";});
        headerDot.className="dashboard-status-dot "+(down?"dashboard-status-dot--orange":unknown?"dashboard-status-dot--muted":"dashboard-status-dot--blue");
      }
    })
    .catch(function(){
      root.innerHTML='<p class="dim">Could not load service status.</p>';
    });
})();`;
}
