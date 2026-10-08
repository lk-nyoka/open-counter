/**
 * MCP Apps view (ui://open-counter/booking-card.html): the booking card an assistant host such as Alexa+ on an
 * Echo Show renders next to the conversation. Self-contained (no network, no external scripts). It speaks the MCP Apps
 * postMessage protocol directly: ui/initialize -> ui/notifications/initialized, then renders every
 * ui/notifications/tool-result. Tapping a time or "Yes, book it" sends a ui/message, so the assistant stays in charge.
 */
export const BOOKING_CARD_URI = "ui://open-counter/booking-card.html";
export const MCP_APP_MIME = "text/html;profile=mcp-app";

export const BOOKING_CARD_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Open Counter booking</title>
<style>
:root{--bg:#FBF8F3;--card:#fff;--ink:#1B1A17;--ink2:#5E5A53;--ink3:#8F897F;--line:rgba(27,26,23,.1);--amber:#E08A2E;--amberdeep:#A9601A;--ok:#1E7F55;--oksoft:#E3F3EA;--warn:#B4441B}
:root[data-theme=dark]{--bg:#17150F;--card:#211E18;--ink:#F4EFE6;--ink2:#C9C1B3;--ink3:#948B7D;--line:rgba(255,255,255,.12);--oksoft:#163527}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#17150F;--card:#211E18;--ink:#F4EFE6;--ink2:#C9C1B3;--ink3:#948B7D;--line:rgba(255,255,255,.12);--oksoft:#163527}}
*{box-sizing:border-box}html,body{margin:0;background:transparent;color:var(--ink);font:16px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:20px 22px;max-width:640px;margin:0 auto}
.eyebrow{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink3)}
h1{font:600 26px/1.2 Georgia,"Times New Roman",serif;margin:6px 0 2px;letter-spacing:-.01em}
.sub{color:var(--ink2);margin:0}
ul{list-style:none;padding:0;margin:16px 0 0}li{display:flex;gap:10px;align-items:flex-start;margin:7px 0;color:var(--ink);opacity:0;animation:in .35s ease forwards}
.tick{flex:none;width:22px;height:22px;border-radius:50%;background:var(--oksoft);color:var(--ok);display:grid;place-items:center;font-size:13px;font-weight:700}
.x{background:#FBE7DE;color:var(--warn)}
@keyframes in{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:none}}
.chips{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
button{font:inherit;min-height:48px;min-width:48px;padding:0 18px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
button.primary{background:var(--amber);border-color:var(--amber);color:#fff;font-weight:600}
button:focus-visible{outline:3px solid #2F6BFF;outline-offset:2px}
.row{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap}
.code{margin-top:16px;padding-top:14px;border-top:1px solid var(--line);color:var(--ink3);font-size:13px;word-break:break-all}
.msg{color:var(--ink2);margin-top:8px}
@media (prefers-reduced-motion:reduce){li{animation:none;opacity:1}}
</style></head>
<body><main id="root" class="card" aria-live="polite"><p class="eyebrow">Open Counter</p><h1>Getting your booking…</h1></main>
<script>
(function(){
  var root=document.getElementById('root'), seq=0, pending={};
  function post(m){ window.parent.postMessage(m,'*'); }
  function request(method,params){ var id=++seq; post({jsonrpc:'2.0',id:id,method:method,params:params}); return new Promise(function(r){pending[id]=r;}); }
  function notify(method,params){ post({jsonrpc:'2.0',method:method,params:params||{}}); }
  function say(text){ request('ui/message',{role:'user',content:[{type:'text',text:text}]}); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function theme(ctx){ if(ctx&&ctx.theme) document.documentElement.setAttribute('data-theme',ctx.theme); }
  function size(){ notify('ui/notifications/size-changed',{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}); }

  function render(result){
    var d=(result&&result.structuredContent)||{};
    var h='';
    if(d.confirmed){
      h='<p class="eyebrow">Booked · '+esc(d.business)+'</p><h1>'+esc(d.service)+', '+esc(d.when)+'</h1>'+
        '<p class="sub">'+esc(d.price)+' '+esc(d.currency)+' · for '+esc(d.customerName)+'</p>'+
        '<p class="msg">Your assistant understood the request. Then the counter checked every rule before booking:</p><ul>'+
        (d.checks||[]).map(function(c,i){return '<li style="animation-delay:'+(i*90)+'ms"><span class="tick" aria-hidden="true">✓</span><span>'+esc(c.label)+'</span></li>';}).join('')+
        '</ul><p class="code">Booking code: '+esc(d.bookingId)+'</p>';
    } else if(d.code==='confirmation_required' && d.readBack){
      var b=d.readBack;
      h='<p class="eyebrow">Please confirm · '+esc(b.business)+'</p><h1>'+esc(b.service)+', '+esc(b.when)+'</h1><p class="sub">'+esc(b.price)+' '+esc(b.currency)+(b.customerName?' · for '+esc(b.customerName):'')+'</p>'+
        '<div class="row"><button class="primary" data-say="Yes, book it.">Yes, book it</button><button data-say="No, don\\'t book that.">No</button></div>';
    } else if(d.slots && d.slots.length){
      h='<p class="eyebrow">Free times · '+esc(d.service)+'</p><h1>'+esc(d.day.charAt(0).toUpperCase()+d.day.slice(1))+'</h1><div class="chips">'+
        d.slots.slice(0,12).map(function(s){return '<button data-say="'+esc('Book the '+s.spoken+' slot '+d.day+', please.')+'">'+esc(s.spoken)+'</button>';}).join('')+'</div>'+
        (d.slots.length>12?'<p class="msg">and '+(d.slots.length-12)+' more.</p>':'');
    } else if(d.cancelled){
      h='<p class="eyebrow">Cancelled</p><h1>Booking cancelled</h1><p class="sub">'+esc(d.summary)+'</p>';
    } else {
      var next=d.nextAvailable;
      h='<p class="eyebrow">'+esc(d.failedCheck?'Not booked':'Open Counter')+'</p><h1>'+esc(d.message||d.summary||'Nothing to show yet.')+'</h1>'+
        (d.failedCheck?'<ul><li style="opacity:1"><span class="tick x" aria-hidden="true">✕</span><span>The server refused this at the “'+esc(d.failedCheck)+'” check, so nothing was booked.</span></li></ul>':'')+
        (next?'<div class="row"><button class="primary" data-say="'+esc('Book '+next.spoken+', please.')+'">'+esc('Book '+next.spoken)+'</button></div>':'');
    }
    root.innerHTML=h; size();
  }
  root.addEventListener('click',function(e){ var t=e.target.closest('button[data-say]'); if(t) say(t.getAttribute('data-say')); });
  window.addEventListener('message',function(e){
    var m=e.data; if(!m||m.jsonrpc!=='2.0') return;
    if(m.id!=null && pending[m.id] && !m.method){ pending[m.id](m.result); delete pending[m.id]; return; }
    if(m.method==='ui/notifications/tool-result') render(m.params);
    else if(m.method==='ui/notifications/host-context-changed') theme(m.params);
    else if(m.method==='ui/resource-teardown' && m.id!=null) post({jsonrpc:'2.0',id:m.id,result:{}});
  });
  request('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'open-counter-booking-card',version:'1.0.0'},appCapabilities:{}})
    .then(function(r){ theme(r&&r.hostContext); notify('ui/notifications/initialized'); size();
      if(window.ResizeObserver) new ResizeObserver(size).observe(document.body); });
})();
</script></body></html>`;
