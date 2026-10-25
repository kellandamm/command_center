import { EXCERPT_MAX_UTF8_BYTES, truncateUtf8ToBytesExtensionSource } from "../utf8-byte-limit";

const manifest = {
  manifest_version: 3,
  name: "Command Center Capture",
  version: "1.0.1",
  description: "Save the page you are reading to Command Center, and optionally summarize it.",
  action: { default_title: "Save to Command Center", default_popup: "popup.html" },
  options_page: "options.html",
  permissions: ["activeTab", "scripting", "storage"],
  optional_host_permissions: ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
};

const style = `body{font:14px "Segoe UI",Aptos,Calibri,sans-serif;margin:16px;width:300px;color:#242424}
@media(prefers-color-scheme:dark){body{background:#292929;color:#dedede}}
button{font:inherit;padding:8px 12px;margin:4px 4px 4px 0;border-radius:8px;border:1px solid #b11f4b;background:#b11f4b;color:#fff;cursor:pointer}
button.ghost{background:transparent;color:inherit}input{font:inherit;width:100%;box-sizing:border-box;padding:6px;margin:4px 0 12px}
#status{min-height:1.4em;margin-top:8px}`;

const popupHtml = `<!doctype html><meta charset="utf-8"><title>Save</title><style>${style}</style>
<h1 style="font-size:16px">Save this page</h1>
<button id="save">Save</button><button id="summarize" class="ghost">Save &amp; summarize</button>
<p id="status" role="status"></p><p><a href="options.html" target="_blank">Settings</a></p><script src="popup.js"></script>`;

const popupJs = `const status = document.getElementById("status");
const say = (text) => { status.textContent = text; };
${truncateUtf8ToBytesExtensionSource}
function pageText() {
  const selected = String(getSelection() || "").trim();
  const root = document.querySelector("article") || document.querySelector("main") || document.body;
  const raw = (selected || (root && root.innerText) || "").replace(/\\n{3,}/g, "\\n\\n").trim();
  return truncateUtf8ToBytes(raw, ${EXCERPT_MAX_UTF8_BYTES}, "…");
}
async function capture(summarize) {
  const { server, token } = await chrome.storage.local.get(["server", "token"]);
  if (!server || !token) { say("Open Settings and add your server address and token."); return; }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !/^https?:/.test(tab.url || "")) { say("This page cannot be saved."); return; }
  say(summarize ? "Saving and summarizing…" : "Saving…");
  const [injected] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageText });
  const response = await fetch(server.replace(/\\/$/, "") + "/api/capture", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ url: tab.url, title: tab.title, excerpt: injected.result || "", summarize }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { say(data.error || "Could not save (" + response.status + ")."); return; }
  say((data.duplicate ? "Already saved." : "Saved.") + (data.summaryError ? " Summary failed." : summarize ? " Summarized." : ""));
}
for (const [id, summarize] of [["save", false], ["summarize", true]]) {
  document.getElementById(id).addEventListener("click", () => capture(summarize).catch((error) => say(error.message)));
}`;

const optionsHtml = `<!doctype html><meta charset="utf-8"><title>Settings</title><style>${style} body{width:auto;max-width:480px}</style>
<h1>Command Center capture</h1>
<label for="server">Server address</label><input id="server" placeholder="https://command.example.com">
<label for="token">Capture token</label><input id="token" type="password" autocomplete="off">
<button id="save">Save settings</button><p id="status" role="status"></p><script src="options.js"></script>`;

const optionsJs = `const server = document.getElementById("server"), token = document.getElementById("token"), status = document.getElementById("status");
chrome.storage.local.get(["server", "token"]).then((saved) => { server.value = saved.server || ""; token.value = saved.token || ""; });
document.getElementById("save").addEventListener("click", async () => {
  try {
    const origin = new URL(server.value.trim()).origin;
    const granted = await chrome.permissions.request({ origins: [origin + "/*"] });
    if (!granted) { status.textContent = "Permission to reach the server was declined."; return; }
    await chrome.storage.local.set({ server: origin, token: token.value.trim() });
    status.textContent = "Saved.";
  } catch { status.textContent = "Enter a valid server address."; }
});`;

export const captureExtensionFiles: Array<{ name: string; data: Buffer }> = [
  ["manifest.json", JSON.stringify(manifest, null, 2)],
  ["popup.html", popupHtml],
  ["popup.js", popupJs],
  ["options.html", optionsHtml],
  ["options.js", optionsJs],
].map(([name, text]) => ({ name: name!, data: Buffer.from(text!, "utf8") }));

