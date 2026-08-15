import WebSocket from "ws";
import fs from "node:fs";
const CDP="http://127.0.0.1:9222";
async function connect(){
  const t=await (await fetch(`${CDP}/json`)).json();
  const p=t.find(x=>x.type==="page"&&x.url.includes("localhost:5173"));
  const ws=new WebSocket(p.webSocketDebuggerUrl);let id=0;const pending=new Map();
  ws.on("message",r=>{const m=JSON.parse(r.toString());if(m.id&&pending.has(m.id)){pending.get(m.id).resolve(m.result);pending.delete(m.id);}});
  await new Promise(r=>ws.on("open",r));
  const send=(me,pa={})=>{const i=++id;return new Promise(res=>{pending.set(i,{resolve:res});ws.send(JSON.stringify({id:i,method:me,params:pa}));});};
  await send("Runtime.enable");await send("Page.enable");
  const ev=async e=>{const r=await send("Runtime.evaluate",{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)return{__err:r.exceptionDetails.exception?.description};return r.result.value;};
  const shot=async f=>{const r=await send("Page.captureScreenshot",{format:"png"});if(r?.data)fs.writeFileSync(f,Buffer.from(r.data,"base64"));};
  return {ev,shot};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const {ev,shot}=await connect();
await sleep(1500);
// A) full-restart persistence
const snap=await ev(`window.leemoPersist.invoke('loadAll',undefined)`);
const c=snap?.response?.conversations?.[0];
const momo=c?c.timeline.filter(t=>t.kind==="text"&&t.role==="momo").map(t=>t.text).join(""):"";
const domHas=await ev(`document.body.innerText.includes("青色河马")`);
console.log("[RESTART] SQLite convs:",snap?.response?.conversations?.length,"| momo reply persisted:",momo.includes("青色河马"),"| dom shows it:",domHas);
await shot("docs/sdd/evidence-persist-03-after-restart.png");

// B) buddy scroll: single internal scroll container, page body does NOT scroll, input visible
const scroll=await ev(`(()=>{
  const body=document.body; const pageScrolls=body.scrollHeight>window.innerHeight+2;
  const ta=document.querySelector('textarea[aria-label="输入消息"]');
  const r=ta?ta.getBoundingClientRect():null;
  const inputVisible=r? (r.bottom<=window.innerHeight+1 && r.top>=0):false;
  // find the timeline scroll container (overflow-y-auto with overflow)
  const sc=[...document.querySelectorAll('div')].find(d=>{const s=getComputedStyle(d);return s.overflowY==='auto'&&d.scrollHeight>d.clientHeight+2;});
  return {pageScrolls, inputVisible, hasInnerScroll: !!sc, innerH: window.innerHeight};
})()`);
console.log("[BUG1 buddy scroll]",JSON.stringify(scroll));

// C) workbench input typeable: switch to workbench, type, read back value
await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent&&x.textContent.includes('工作台'));if(b)b.click();})()`);
await sleep(600);
const wb=await ev(`(()=>{
  const ta=document.querySelector('textarea[aria-label="输入消息"]');
  if(!ta) return {found:false};
  const s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
  s.call(ta,'工作台输入测试123'); ta.dispatchEvent(new Event('input',{bubbles:true}));
  return {found:true, reflected: ta.value};
})()`);
console.log("[BUG2 workbench input]",JSON.stringify(wb),"| typeable:",wb.found&&wb.reflected==='工作台输入测试123');
await sleep(300);
await shot("docs/sdd/evidence-workbench-input.png");
const pass = (snap?.response?.conversations?.length>0) && momo.includes("青色河马") && domHas && !scroll.pageScrolls && scroll.inputVisible && scroll.hasInnerScroll && wb.found && wb.reflected==='工作台输入测试123';
console.log("ALL PASS:",pass);
process.exit(pass?0:3);
