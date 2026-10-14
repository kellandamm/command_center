import { ValidationError } from "../settings";
import type { PanelModule } from "./types";

export const notesPanel: PanelModule = {
  id: "notes",
  title: "Notes",
  dashboardHtml: `
<section class="card" id="panel-notes">
  <h2 style="margin:0 0 8px">Notes</h2>
  <p class="dim">Markdown saved on the server data volume (<code>notes.md</code>).</p>
  <textarea id="notes-editor" spellcheck="true" style="width:100%;min-height:8rem;font-family:inherit"></textarea>
  <div class="row" style="margin-top:8px">
    <button type="button" id="notes-save">Save</button>
    <span id="notes-status" class="dim"></span>
  </div>
</section>`,
  async handle(ctx, req, res, path) {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
    };
    if (path === "/api/notes" && req.method === "GET") {
      const content = await ctx.notes.read();
      json(200, { content });
      return true;
    }
    if (path === "/api/notes" && req.method === "PUT") {
      let body = "";
      for await (const c of req) body += c;
      let parsed: { content?: string };
      try {
        parsed = JSON.parse(body || "{}") as { content?: string };
      } catch {
        throw new ValidationError("invalid JSON");
      }
      if (typeof parsed.content !== "string") throw new ValidationError("content is required");
      try {
        await ctx.notes.write(parsed.content);
      } catch (err) {
        throw new ValidationError(err instanceof Error ? err.message : "save failed");
      }
      json(200, { ok: true });
      return true;
    }
    return false;
  },
};

export function notesDashboardScript(): string {
  return `
function loadNotes(){
  return api("/api/notes").then(function(r){
    var ed=document.getElementById("notes-editor");
    if(ed)ed.value=r.content||"";
  });
}
var ns=document.getElementById("notes-save");
if(ns)ns.onclick=function(){
  var st=document.getElementById("notes-status");
  st.textContent="Saving…";
  api("/api/notes","PUT",{content:document.getElementById("notes-editor").value})
    .then(function(){st.textContent="Saved";})
    .catch(function(e){st.textContent=e.message||"Save failed";});
};
loadNotes();
`;
}
