import type { NavLink } from "./layout";
import { page } from "./layout";

export function notesPage(nav?: NavLink[]): string {
  return page({
    title: "Notes — Command center",
    active: "/notes",
    nav,
    body: `<header class="page-header"><h1>Notes</h1><p class="dim">Markdown saved on the server (<code>notes.md</code>).</p></header>
<div class="card"><textarea id="notes-editor-full" spellcheck="true" style="min-height:28rem;font-family:ui-monospace,Menlo,monospace"></textarea>
<div class="row" style="margin-top:.75rem"><button type="button" id="notes-save-full">Save</button><span id="notes-status-full" class="dim"></span></div></div>`,
    script: `
function loadNotesFull(){
  return api("/api/notes").then(function(r){
    document.getElementById("notes-editor-full").value=r.content||"";
  });
}
document.getElementById("notes-save-full").onclick=function(){
  var st=document.getElementById("notes-status-full");
  st.textContent="Saving…";
  api("/api/notes","PUT",{content:document.getElementById("notes-editor-full").value})
    .then(function(){st.textContent="Saved";})
    .catch(function(e){st.textContent=e.message||"Save failed";});
};
window.viewPreferencesReady.then(function(prefs){
  var size=prefs&&prefs.notes&&prefs.notes.fontSize||"medium";
  var editor=document.getElementById("notes-editor-full");
  editor.classList.remove("notes-size-small","notes-size-medium","notes-size-large");
  editor.classList.add("notes-size-"+size);
});
loadNotesFull();
`,
  });
}
