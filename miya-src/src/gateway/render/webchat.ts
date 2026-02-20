export function renderWebChatHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Miya WebChat</title>
  <style>
    body{margin:0;font-family:Segoe UI,sans-serif;background:#0b1117;color:#e6edf7}
    main{max-width:900px;margin:0 auto;padding:14px;display:grid;gap:10px}
    #log{min-height:360px;border:1px solid #253047;border-radius:8px;background:#111827;padding:10px;white-space:pre-wrap}
    .row{display:grid;grid-template-columns:1fr auto;gap:8px}
    input{border:1px solid #253047;border-radius:8px;background:#111827;color:#e6edf7;padding:8px}
    button{border:1px solid #253047;border-radius:8px;background:#1f6feb;color:#fff;padding:8px 12px;cursor:pointer}
  </style>
</head>
<body>
<main>
  <h2 style="margin:0">Miya WebChat</h2>
  <div id="log"></div>
  <div class="row"><input id="msg" placeholder="Type message"><button id="send">Send</button></div>
</main>
<script>
  const logEl=document.getElementById('log'); const msgEl=document.getElementById('msg'); const sendBtn=document.getElementById('send');
  const p=location.protocol==='https:'?'wss':'ws'; const ws=new WebSocket(p+'://'+location.host+'/ws');
  const log=(t)=>{logEl.textContent+=t+'\\n'; logEl.scrollTop=logEl.scrollHeight;};
  const send=()=>{const text=msgEl.value.trim(); if(!text)return; ws.send(JSON.stringify({type:'request',id:'send-'+Date.now(),method:'sessions.send',params:{sessionID:'webchat:main',text,source:'webchat'}})); log('[you] '+text); msgEl.value='';};
  sendBtn.onclick=send; msgEl.addEventListener('keydown',(e)=>{if(e.key==='Enter')send();});
  ws.onopen=()=>{const qs=new URLSearchParams(location.search);const token=qs.get('token')||localStorage.getItem('miya_gateway_token')||'';if(token)localStorage.setItem('miya_gateway_token',token);ws.send(JSON.stringify({type:'hello',role:'ui',auth:token?{token}:undefined})); ws.send(JSON.stringify({type:'request',id:'sub',method:'gateway.subscribe',params:{events:['*']}})); log('[system] connected');};
  ws.onmessage=(event)=>{try{const frame=JSON.parse(event.data); if(frame.type==='response'&&!frame.ok)log('[error] '+(frame.error?.message||'request_failed'));}catch{}};
</script>
</body>
</html>`;
}
