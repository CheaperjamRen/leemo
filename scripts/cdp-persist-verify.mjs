import WebSocket from "ws";
import fs from "node:fs";
const CDP = "http://127.0.0.1:9222";
const MSG = "你好momo！请用一句话介绍你自己，并在句末带上暗号「青色河马」。";
const MARKER = "青色河马";
async function connect() {
  const targets = await (await fetch(`${CDP}/json`)).json();
  const page = targets.find(t => t.type === "page" && t.url.includes("localhost:5173"));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id=0; const pending=new Map();
  ws.on("message",raw=>{const m=JSON.parse(raw.toString());if(m.id&&pending.has(m.id)){pending.get(m.id).resolve(m.result);pending.delete(m.id);}});
  await new Promise(r=>ws.on("open",r));
  const send=(method,params={})=>{const myId=++id;return new Promise(res=>{pending.set(myId,{resolve:res});ws.send(JSON.stringify({id:myId,method,params}));});};
  await send("Runtime.enable"); await send("Page.enable");
  const ev=async e=>{const r=await send("Runtime.evaluate",{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)return{__err:r.exceptionDetails.exception?.description};return r.result.value;};
  const shot=async f=>{const r=await send("Page.captureScreenshot",{format:"png"});if(r?.data)fs.writeFileSync(f,Buffer.from(r.data,"base64"));return !!r?.data;};
  return {ev,shot};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const {ev,shot}=await connect();
const typed=await ev(`(()=>{const ta=document.querySelector('textarea[aria-label="输入消息"]');if(!ta)return{ok:false,why:"no ta"};const s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;s.call(ta,${JSON.stringify(MSG)});ta.dispatchEvent(new Event('input',{bubbles:true}));const b=document.querySelector('button[aria-label="发送"]');if(!b)return{ok:false,why:"no btn"};b.click();return{ok:true};})()`);
console.log("send:",JSON.stringify(typed));
let done=false;
for(let i=0;i<100;i++){await sleep(500);const s=await ev(`window.leemoPersist.invoke('loadAll',undefined)`);const c=s?.response?.conversations?.[0];if(c){const res=c.timeline.find(t=>t.kind==="result");if(res){done=true;console.log(`run finished after ~${((i+1)*0.5).toFixed(1)}s; isError=${res.isError}`);break;}}}
await sleep(1400);
const snap=await ev(`window.leemoPersist.invoke('loadAll',undefined)`);
const c=snap.response.conversations[0];
const momo=c.timeline.filter(t=>t.kind==="text"&&t.role==="momo").map(t=>t.text).join("");
const res=c.timeline.find(t=>t.kind==="result");
console.log("SQLite convs:",snap.response.conversations.length);
console.log("timeline kinds:",c.timeline.map(t=>t.kind).join(","));
console.log("result.isError:",res?.isError);
console.log("momo reply (first 120):",momo.slice(0,120));
console.log("momo has marker:",momo.includes(MARKER));
await shot("docs/sdd/evidence-persist-01-before.png");
console.log("== reload ==");
await ev(`location.reload()`); await sleep(2800);
const c2=await connect();
let restored=false,momoRestored=false;
for(let i=0;i<25;i++){await sleep(400);const s=await c2.ev(`window.leemoPersist.invoke('loadAll',undefined)`);const cc=s?.response?.conversations?.[0];const dom=await c2.ev(`document.body.innerText`);if(cc&&dom.includes(MARKER)){restored=true;const mm=cc.timeline.filter(t=>t.kind==="text"&&t.role==="momo").map(t=>t.text).join("");momoRestored=mm.includes(MARKER);break;}}
console.log("AFTER RELOAD: dom+db has marker:",restored,"| momo reply restored:",momoRestored);
await c2.shot("docs/sdd/evidence-persist-02-after-reload.png");
process.exit(done && !res?.isError && restored && momoRestored ? 0 : 3);
