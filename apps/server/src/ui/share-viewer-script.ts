/** Public share page decryptor (WebCrypto AES-GCM). Served as /assets/share-viewer.js without auth. */
export function shareViewerScript(): string {
  return `(function(){
  var status=document.getElementById("share-status");
  var titleEl=document.getElementById("share-title");
  var bodyEl=document.getElementById("share-body");
  var script=document.currentScript;
  var shareId=script&&script.getAttribute("data-share-id");
  function fail(msg){if(status)status.textContent=msg;}
  function b64ToBytes(b64){
    var bin=atob(b64.replace(/-/g,"+").replace(/_/g,"/"));
    var out=new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
    return out;
  }
  function keyFromFragment(){
    var hash=location.hash.replace(/^#/,"");
    if(!hash)return null;
    try{return b64ToBytes(hash);}catch(_){return null;}
  }
  async function run(){
    if(!shareId){fail("Invalid share link.");return;}
    var rawKey=keyFromFragment();
    if(!rawKey||rawKey.length!==32){fail("Add the decryption key from the link you were given (the part after #).");return;}
    var res=await fetch("/share/"+encodeURIComponent(shareId)+"/data",{credentials:"omit"});
    if(!res.ok){fail(res.status===404?"This link expired or was revoked.":"Could not load shared note.");return;}
    var payload=await res.json();
    if(!payload||typeof payload.ciphertext!=="string"||typeof payload.iv!=="string"){fail("Invalid share payload.");return;}
    try{
      var key=await crypto.subtle.importKey("raw",rawKey,{name:"AES-GCM"},false,["decrypt"]);
      var plain=new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:b64ToBytes(payload.iv)},key,b64ToBytes(payload.ciphertext)));
      var snap=JSON.parse(plain);
      if(!snap||typeof snap.title!=="string"||typeof snap.html!=="string"){fail("Decrypted content is not a valid note snapshot.");return;}
      if(titleEl){titleEl.textContent=snap.title;titleEl.hidden=false;}
      if(bodyEl){bodyEl.innerHTML=snap.html;bodyEl.hidden=false;}
      if(status)status.textContent="";
      document.title=snap.title+" — shared note";
    }catch(_){fail("Could not decrypt this note. Check that you opened the full link including the # key.");}
  }
  run().catch(function(){fail("Could not open shared note.");});
})();`;
}
