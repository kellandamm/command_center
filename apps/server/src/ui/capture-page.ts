import type { NavLink } from "./layout";
import { settingsWorkspace } from "./settings-workspace";

export function capturePage(nav?: NavLink[]): string {
  return settingsWorkspace({
    category: "capture", title: "Browser capture", description: "Save pages to Read Later only when you choose to.", nav,
    body: `<section class="settings-group"><h3>Install the extension</h3>
<p>Download the extension, unzip it, open <code>chrome://extensions</code>, turn on Developer mode, and choose Load unpacked.</p>
<a class="btn" href="/capture-extension.zip" download>Download extension</a>
</section><section class="settings-group"><h3>Capture access</h3>
<p id="capture-state" class="dim" role="status">Loading capture access...</p>
<p id="capture-manage-hint" class="dim" role="status" hidden></p>
<p class="dim">Replacing a token immediately stops the previous token from working on every connected browser. The new token is displayed only once.</p>
<div class="row"><button id="capture-create" type="button" disabled>Create token</button><button id="capture-revoke" type="button" class="ghost" disabled>Revoke access</button><button id="capture-retry" type="button" class="ghost" hidden>Retry</button></div>
<div id="capture-token-box" hidden><label for="capture-token">Token (shown once)</label><input id="capture-token" readonly>
<p class="dim">Server address: <code id="capture-origin"></code></p></div>
</section><section class="settings-group"><h3>Connect your browser</h3><p>Open the extension options and paste the server address and token. The token can only save and summarize pages. It cannot read your library.</p><a href="/library">Open Read Later</a></section>`,
    script: `
$("capture-origin").textContent=location.origin;
var captureCanManage=false,captureConfigured=false,capturePending=false;
function captureControls(){ $("capture-create").disabled=!captureCanManage||capturePending;$("capture-revoke").disabled=!captureConfigured||!captureCanManage||capturePending;$("capture-create").textContent=captureConfigured?"Replace token":"Create token";}
async function refresh(){var r=await api("/api/capture/access");captureConfigured=r.configured;$("capture-state").textContent=r.configured?"A capture token is active. Its value cannot be retrieved.":"No capture token is active.";captureControls();}
async function captureAction(work){if(capturePending||!captureCanManage)return;capturePending=true;captureControls();try{await work();}catch(error){fail(error);}finally{capturePending=false;captureControls();}}
$("capture-create").onclick=function(){if(captureConfigured&&!confirm("Replace the active capture token? Every browser using the previous token will lose capture access immediately."))return;captureAction(async function(){var r=await api("/api/capture/access","POST",{});captureConfigured=true;$("capture-token").value=r.token;$("capture-token-box").hidden=false;$("capture-state").textContent="A capture token is active.";message("Token created. Copy it now; it cannot be shown again.");});};
$("capture-revoke").onclick=function(){if(!confirm("Revoke capture access for every browser using this token?"))return;captureAction(async function(){await api("/api/capture/access","DELETE");captureConfigured=false;$("capture-token").value="";$("capture-token-box").hidden=true;$("capture-state").textContent="No capture token is active.";message("Capture access revoked.");});};
async function loadCapture(){captureCanManage=false;captureControls();$("capture-retry").hidden=true;try{var r=await api("/api/settings");captureCanManage=!(r.meta&&r.meta.canManage===false);var hint=$("capture-manage-hint");hint.hidden=captureCanManage;hint.textContent="When OWNER_EMAILS is configured, capture tokens require an owner login or ADMIN_TOKEN.";await refresh();}catch(error){captureCanManage=false;captureControls();$("capture-state").textContent=error.message||"Capture access could not load.";$("capture-retry").hidden=false;}}
$("capture-retry").onclick=loadCapture;loadCapture();`,
  });
}
