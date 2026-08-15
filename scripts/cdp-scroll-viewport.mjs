import WebSocket from "ws";
import fs from "node:fs";
const CDP="http://127.0.0.1:9222";
const t=await (await fetch(`${CDP}/json`)).json();
const p=t.find(x=>x.type==="page"&&x.url.includes("localhost:5173"));
const ws=new WebSocket(p.webSocketDebuggerUrl);let id=0;const pending=new Map();
ws.on("message",r=>{const m=JSON.parse(r.toString());if(m.id&&pending.has(m.id)){pending.get(m.id).resolve(m.result);pending.delete(m.id);}});
await new Promise(r=>ws.on("open",r));
const send=(me,pa={})=>{const i=++id;return new Promise(res=>{pending.set(i,{resolve:res});ws.send(JSON.stringify({id:i,method:me,params:pa}));});};
await send("Runtime.enable");await send("Page.enable");
const ev=async e=>{const r=await send("Runtime.evaluate",{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)return{__err:r.exceptionDetails.exception?.description};return r.result.value;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Force a short viewport so the existing timeline overflows the bounded scroll box.
let s;
try {
  await send("Emulation.setDeviceMetricsOverride",{width:900,height:360,deviceScaleFactor:1,mobile:false});
  await sleep(400);
  s=await ev(`(()=>{
    const pageScrolls=document.documentElement.scrollHeight>window.innerHeight+2;
    const ta=document.querySelector('textarea[aria-label="输入消息"]');const r=ta.getBoundingClientRect();
    const inputVisible=r.bottom<=window.innerHeight+1 && r.top>=0;
    const sc=[...document.querySelectorAll('div')].find(d=>getComputedStyle(d).overflowY==='auto'&&d.scrollHeight>d.clientHeight+2);
    let innerScrolls=false,box=null;
    if(sc){const a=(sc.scrollTop=0,sc.scrollTop);sc.scrollTop=99999;const b=sc.scrollTop;innerScrolls=b>a;box={sh:sc.scrollHeight,ch:sc.clientHeight};}
    return {innerH:window.innerHeight,pageScrolls,inputVisible,hasInnerScroll:!!sc,innerScrolls,box};
  })()`);
  console.log("[BUG1 short-viewport]",JSON.stringify(s));
  const r=await send("Page.captureScreenshot",{format:"png"});if(r?.data)fs.writeFileSync("docs/sdd/evidence-buddy-scroll.png",Buffer.from(r.data,"base64"));
} finally {
  try {
    await send("Emulation.clearDeviceMetricsOverride",{});
  } finally {
    ws.close();
  }
}
const pass=!s.pageScrolls&&s.inputVisible&&s.hasInnerScroll&&s.innerScrolls;
console.log("BUG1 PASS:",pass);
if (!pass) process.exitCode=3;
