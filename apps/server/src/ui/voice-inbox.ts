export const voiceInboxScript = `
function mountVoiceInbox(quickAddApi){
  var root=document.getElementById("voice-inbox");if(!root)return;
  var list=root.querySelector(".voice-inbox-list");
  var badge=root.querySelector(".voice-inbox-badge");
  var section=root.querySelector(".voice-inbox-panel");
  function render(rows,timezone){
    var count=rows.length;
    if(badge){badge.textContent=String(count);badge.hidden=!count;}
    if(section)section.hidden=!count;
    if(!list)return;
    list.replaceChildren();
    rows.forEach(function(row){
      var li=document.createElement("li");li.className="voice-inbox-item";
      var meta=document.createElement("span");
      meta.textContent=row.itemCount+" item"+(row.itemCount===1?"":"s")+" · "+new Date(row.createdAt).toLocaleString(undefined,{timeZone:timezone})+" · "+timezone;
      var review=document.createElement("button");review.type="button";review.className="ghost";review.textContent="Review";
      review.onclick=function(){
        api("/api/voice-captures/"+encodeURIComponent(row.id)).then(function(data){
          if(quickAddApi&&quickAddApi.openPreview)quickAddApi.openPreview(data.items||[],"Voice capture — review and confirm.",row.id);
        }).catch(function(err){alert(err.message||"Could not load capture");});
      };
      var dismiss=document.createElement("button");dismiss.type="button";dismiss.className="ghost";dismiss.textContent="Dismiss";
      dismiss.onclick=function(){
        api("/api/voice-captures/"+encodeURIComponent(row.id),"DELETE").then(refresh).catch(function(err){alert(err.message||"Dismiss failed");});
      };
      li.append(meta,review,dismiss);list.appendChild(li);
    });
  }
  function refresh(){
    return api("/api/voice-captures").then(function(data){render(data.captures||[],data.timezone);}).catch(function(err){if(badge)badge.hidden=true;if(section)section.hidden=false;if(list)list.textContent="Voice inbox unavailable: "+err.message;});
  }
  refresh();
  return {refresh:refresh};
}
`;
