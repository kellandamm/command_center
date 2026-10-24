import type { NavLink } from "./layout";
import { workspacePage } from "./workspace";

export function capturePage(nav?: NavLink[]): string {
  return workspacePage({
    title: "Chrome capture", description: "Save the page you are reading with one click. Nothing is collected until you press a button.",
    active: "/library", nav,
    actions: '<a class="btn ghost" href="/library">Back to Read Later</a>',
    body: `<main class="workspace-form"><h2>1. Install the extension</h2>
<p>Download the extension, unzip it, open <code>chrome://extensions</code>, turn on Developer mode, and choose Load unpacked.</p>
<a class="btn" href="/capture-extension.zip" download>Download extension</a>
<h2>2. Create a capture token</h2>
<p id="capture-state" class="dim"></p>
<p id="capture-manage-hint" class="dim" role="status" hidden></p>
<div class="row"><button id="capture-create" type="button">Create new token</button><button id="capture-revoke" type="button" class="ghost">Revoke access</button></div>
<div id="capture-token-box" hidden><label for="capture-token">Token (shown once)</label><input id="capture-token" readonly>
<p class="dim">Server address: <code id="capture-origin"></code></p></div>
<h2>3. Connect</h2><p>Open the extension options and paste the server address and token. The token can only save and summarize pages. It cannot read your library.</p></main>`,
    script: `
$("capture-origin").textContent=location.origin;
var captureCanManage=true;
async function refresh(){var r=await api("/api/capture/access");$("capture-state").textContent=r.configured?"A token is active.":"No token yet.";$("capture-revoke").disabled=!r.configured||!captureCanManage;$("capture-create").disabled=!captureCanManage;}
$("capture-create").onclick=function(){if(!captureCanManage)return;busy(this,async function(){var r=await api("/api/capture/access","POST",{});$("capture-token").value=r.token;$("capture-token-box").hidden=false;await refresh();message("New token created. Any earlier token no longer works.");});};
$("capture-revoke").onclick=function(){if(!captureCanManage)return;busy(this,async function(){await api("/api/capture/access","DELETE");$("capture-token-box").hidden=true;await refresh();message("Capture access revoked.");});};
api("/api/settings").then(function(r){captureCanManage=!(r.meta&&r.meta.canManage===false);var hint=$("capture-manage-hint");if(!captureCanManage){hint.hidden=false;hint.textContent="Only an owner can create or revoke capture tokens when OWNER_EMAILS is configured.";}return refresh();}).catch(fail);`,
  });
}
