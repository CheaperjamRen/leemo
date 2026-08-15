// scripts/cdp-skills-verify.mjs — 启动轮 2 卡 E 实机验收（§五 的 5 条）
//
// 用法（用独立端口 + 独立 userData，别打扰已开着的实例）:
//   node scripts/electron-skills-harness.mjs      （另开一个终端）
//   LEEMO_DEBUG_PORT=9333 LEEMO_VITE_PORT=5199 node scripts/cdp-skills-verify.mjs
//
// 验收链条（全部走真实 DOM 路径，不注入 store）:
//   ② SkillsPage 列出探针技能，显示裸名（不含 "leemo:"）
//   ③ 输入 "/" → 菜单里有它
//   ④ 选中 → 发送 → momo 真回口令  ← 核心，只证明"列出来了"不算过
//   ⑤ 关掉它 → 新对话里 momo 不再认它
//
// 口令 ZANBO-9471-QIQI 只写在 SKILL.md 的**正文**里（description 里没有）。
// description 才是进 system prompt 清单的部分，正文只有 Skill 工具真被调用时才读
// —— 所以能说出口令，就只能是技能真的触发了。
//
// 退出码 0=PASS / 3=FAIL。

import WebSocket from "ws";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CDP = `http://127.0.0.1:${process.env.LEEMO_DEBUG_PORT ?? 9333}`;
const VITE_PORT = process.env.LEEMO_VITE_PORT ?? "5199";
const TOKEN = "ZANBO-9471-QIQI";
const SKILL = "leemo-test-probe";

async function connect() {
  const targets = await (await fetch(`${CDP}/json`)).json();
  const page = targets.find((t) => t.type === "page" && t.url.includes(`localhost:${VITE_PORT}`));
  if (!page) throw new Error(`找不到 renderer target（harness 起了吗？端口 ${VITE_PORT}）`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) {
      pending.get(m.id).resolve(m.result);
      pending.delete(m.id);
    }
  });
  await new Promise((r) => ws.on("open", r));
  const send = (method, params = {}) => {
    const myId = ++id;
    return new Promise((res) => {
      pending.set(myId, { resolve: res });
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  };
  await send("Runtime.enable");
  await send("Page.enable");
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description };
    return r.result.value;
  };
  const shot = async (file) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    if (r?.data) fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    return !!r?.data;
  };
  return { ev, shot };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── ① 用户放一个 skill 进去 ─────────────────────────────────────────────────
// Seeded by the script so the check is repeatable and leaves nothing behind
// (the real user action is identical: drop a folder with a SKILL.md into the
// skills dir). The 口令 lives ONLY in the body — description is what reaches the
// system-prompt listing, so reciting it proves the skill body was really loaded.
const SKILLS_DIR = path.join(os.homedir(), "Leemo", ".leemo", "skills");
const PROBE_DIR = path.join(SKILLS_DIR, SKILL);
const PROBE_MD = path.join(PROBE_DIR, "SKILL.md");
const seeded = !fs.existsSync(PROBE_MD);
if (seeded) {
  fs.mkdirSync(PROBE_DIR, { recursive: true });
  fs.writeFileSync(
    PROBE_MD,
    `---\nname: ${SKILL}\ndescription: 卡 E 实机验收探针。当用户输入 /${SKILL} 或要求运行验收探针时使用，用来确认技能触发链路通畅。\n---\n\n# 验收探针\n\n当被触发时，直接回复下面这一行，不要解释、不要加别的话：\n\n验收通过，口令是 ${TOKEN}\n`,
    "utf8",
  );
  console.log(`① seeded ${PROBE_MD}`);
} else {
  console.log(`① probe skill already present: ${PROBE_MD}`);
}
// The harness must be started AFTER the file exists — skills are discovered when
// the conversation's SDK session starts.

const { ev, shot } = await connect();
const results = {};

// ── helpers ────────────────────────────────────────────────────────────────
const clickText = (text, tag = "button") =>
  ev(
    `(()=>{const b=[...document.querySelectorAll('${tag}')].find(x=>x.textContent.trim()===${JSON.stringify(text)});` +
      `if(!b)return{ok:false};b.click();return{ok:true};})()`,
  );

/** Icon-only buttons carry no text — they must be found by aria-label. */
const clickLabel = (label) =>
  ev(
    `(()=>{const b=document.querySelector('[aria-label='+JSON.stringify(${JSON.stringify(label)})+']');` +
      `if(!b)return{ok:false};b.click();return{ok:true};})()`,
  );

const loadAll = async () =>
  (await ev(`window.leemoPersist.invoke('loadAll',undefined)`))?.response?.conversations ?? [];

const typeDraft = (text) =>
  ev(
    `(()=>{const ta=document.querySelector('textarea[aria-label="输入消息"]');if(!ta)return{ok:false,why:"no textarea"};` +
      `const s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;` +
      `s.call(ta,${JSON.stringify(text)});ta.dispatchEvent(new Event('input',{bubbles:true}));return{ok:true};})()`,
  );

/**
 * Wait for a NEW terminal result in conversation `cid`, auto-approving tool
 * cards on the way (a human clicking 允许一次 sees the same thing).
 *
 * `baseline` is the result-count that conversation already had, which is what
 * makes this honest: waiting for "has a result" alone would return instantly on
 * a conversation that finished a round earlier and hand back the OLD reply.
 */
const resultsIn = (conv) => (conv?.timeline ?? []).filter((t) => t.kind === "result").length;

/** id → how many results that conversation already had. Snapshot this BEFORE
 *  sending; `waitForRun` then only accepts a count that went UP. */
async function resultBaseline() {
  const map = {};
  for (const c of await loadAll()) map[c.meta.id] = resultsIn(c);
  return map;
}

async function waitForRun(label, baseline, maxSeconds = 150) {
  for (let i = 0; i < maxSeconds; i++) {
    await sleep(1000);
    const approved = await ev(
      `(()=>{const b=[...document.querySelectorAll('button')].filter(x=>x.textContent.trim()==='允许一次');b.forEach(x=>x.click());return b.length;})()`,
    );
    if (approved) console.log(`  [${label}] auto-approved ${approved} tool card(s)`);
    for (const conv of await loadAll()) {
      if (resultsIn(conv) > (baseline[conv.meta.id] ?? 0)) {
        console.log(`  [${label}] run finished after ~${i + 1}s (conv ${conv.meta.id})`);
        return conv;
      }
    }
  }
  console.log(`  [${label}] TIMEOUT after ${maxSeconds}s`);
  return null;
}

/** Text of the LAST momo turn only — a conversation may hold several rounds. */
const lastReplyOf = (conv) => {
  const timeline = conv?.timeline ?? [];
  const lastUser = timeline.map((t) => t.role).lastIndexOf("user");
  return timeline
    .slice(lastUser + 1)
    .filter((t) => t.kind === "text" && t.role === "momo")
    .map((t) => t.text)
    .join("");
};

const toolsOf = (conv) =>
  (conv?.timeline ?? []).filter((t) => t.kind === "tool").map((t) => t.name);

// ── ② SkillsPage lists the skill, bare name ────────────────────────────────
console.log("\n② SkillsPage 列出探针技能（裸名）");
await clickText("工作台");
await sleep(400);
await clickText("技能");
await sleep(900);

const page = await ev(
  `(()=>{const root=document.querySelector('[data-shell="workbench"]');` +
    `const cards=[...document.querySelectorAll('h3')].map(h=>h.textContent.trim());` +
    `const labels=[...document.querySelectorAll('input[type=checkbox]')].map(c=>c.getAttribute('aria-label'));` +
    `return{cards,labels,text:root?root.innerText:''};})()`,
);
results.listed = page.cards.includes(SKILL);
results.bareName = !page.text.includes("leemo:");
console.log("  cards:", JSON.stringify(page.cards));
console.log("  toggle labels:", JSON.stringify(page.labels));
console.log("  ② listed:", results.listed, "| 裸名（页面无 leemo:）:", results.bareName);
await shot("docs/sdd/evidence-skills-page.png");

// ── ③ the / menu offers it ─────────────────────────────────────────────────
console.log("\n③ 输入 / → 菜单里有它");
await clickText("搭子");
await sleep(500);
await typeDraft("/");
await sleep(500);

const menu = await ev(
  `(()=>{const m=document.querySelector('[data-testid="slash-menu"]');if(!m)return{open:false};` +
    `return{open:true,items:[...m.querySelectorAll('[role=option]')].map(o=>o.textContent.trim()),text:m.innerText};})()`,
);
results.inMenu = menu.open === true && menu.items.some((i) => i.includes(SKILL));
results.menuBare = menu.open === true && !menu.text.includes("leemo:");
console.log("  menu items:", JSON.stringify(menu.items ?? []));
console.log("  ③ in menu:", results.inMenu, "| 菜单裸名:", results.menuBare);
await shot("docs/sdd/evidence-slash-menu.png");

// ── ④ pick it, send, and momo must return the token ────────────────────────
console.log("\n④ 选中 → 发送 → momo 真回口令（核心）");
const picked = await ev(
  `(()=>{const m=document.querySelector('[data-testid="slash-menu"]');if(!m)return{ok:false,why:"menu closed"};` +
    `const o=[...m.querySelectorAll('[role=option]')].find(x=>x.textContent.includes(${JSON.stringify(SKILL)}));` +
    `if(!o)return{ok:false,why:"option missing"};` +
    // The menu commits on mousedown (the textarea must not lose focus first).
    `o.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));return{ok:true};})()`,
);
console.log("  pick:", JSON.stringify(picked));
await sleep(400);
const draftAfterPick = await ev(
  `document.querySelector('textarea[aria-label="输入消息"]').value`,
);
console.log("  draft after pick:", JSON.stringify(draftAfterPick));
results.draftBare = draftAfterPick === `/${SKILL} `;

const baseline1 = await resultBaseline();
await clickLabel("发送");
const conv = await waitForRun("④", baseline1);
const reply = lastReplyOf(conv);
const tools = toolsOf(conv);
console.log("\n  --- momo reply ---\n" + reply + "\n  ------------------");
console.log("  tools used:", JSON.stringify(tools));
results.tokenReturned = reply.includes(TOKEN);
results.skillToolUsed = tools.some((t) => /skill/i.test(t));
console.log("  ④ 回出口令:", results.tokenReturned, "| 走了 Skill 工具:", results.skillToolUsed);
await shot("docs/sdd/evidence-skill-triggered.png");

// ── ⑤ disable it → a NEW conversation must not know it ─────────────────────
console.log("\n⑤ 关掉技能 → 新对话不再认它");
await clickText("工作台");
await sleep(400);
await clickText("技能");
await sleep(700);
const toggled = await ev(
  `(()=>{const c=[...document.querySelectorAll('input[type=checkbox]')].find(x=>x.getAttribute('aria-label')===${JSON.stringify(`启用 ${SKILL}`)});` +
    `if(!c)return{ok:false,why:"toggle missing"};c.click();return{ok:true,checked:c.checked};})()`,
);
console.log("  toggle:", JSON.stringify(toggled));
await sleep(400);
const stillChecked = await ev(
  `(()=>{const c=[...document.querySelectorAll('input[type=checkbox]')].find(x=>x.getAttribute('aria-label')===${JSON.stringify(`启用 ${SKILL}`)});return c?c.checked:null;})()`,
);
results.disabledInUi = stillChecked === false;
console.log("  ⑤ 开关已关:", results.disabledInUi);

// A NEW conversation is required: enabledSkills is resolved at CREATE time, so
// the conversation from ④ legitimately still has the skill on.
const idsBefore = (await loadAll()).map((c) => c.meta.id);
// Icon-only button — aria-label, not text (this is what broke the first run of
// this script: clicking by text silently missed and ⑤ re-read ④'s reply).
console.log("  new conversation:", JSON.stringify(await clickLabel("新建对话")));
await sleep(1200);
// The / menu must no longer offer it either.
await typeDraft("/");
await sleep(500);
const menuAfter = await ev(
  `(()=>{const m=document.querySelector('[data-testid="slash-menu"]');if(!m)return{open:false,items:[]};` +
    `return{open:true,items:[...m.querySelectorAll('[role=option]')].map(o=>o.textContent.trim())};})()`,
);
results.goneFromMenu = !(menuAfter.items ?? []).some((i) => i.includes(SKILL));
console.log("  menu after disable:", JSON.stringify(menuAfter.items ?? []), "→ gone:", results.goneFromMenu);

await typeDraft(`/${SKILL} 请运行这个技能`);
await sleep(300);
const baseline2 = await resultBaseline();
await clickLabel("发送");
const conv2 = await waitForRun("⑤", baseline2);
const cid2 = conv2?.meta?.id ?? null;
// The reply must come from a conversation created AFTER the skill was disabled.
results.newConversationCreated = cid2 !== null && !idsBefore.includes(cid2);
console.log("  answering conversation:", cid2, "| is new:", results.newConversationCreated);
if (!results.newConversationCreated) {
  console.log("  ⚠️ 回话的不是新对话 —— ⑤ 无法判定（脚本问题，不是功能问题）");
}
const reply2 = lastReplyOf(conv2);
const tools2 = toolsOf(conv2);
console.log("\n  --- momo reply (skill disabled) ---\n" + reply2 + "\n  ----------------------------------");
console.log("  tools used:", JSON.stringify(tools2));
results.tokenAbsentWhenDisabled = results.newConversationCreated && !reply2.includes(TOKEN);
console.log("  ⑤ 不再回出口令:", results.tokenAbsentWhenDisabled);
await shot("docs/sdd/evidence-skill-disabled.png");

// ── verdict ────────────────────────────────────────────────────────────────
console.log("\n================ 验收结果 ================");
const required = {
  "② SkillsPage 列出（裸名）": results.listed && results.bareName,
  "③ / 菜单里有它": results.inMenu && results.menuBare,
  "④ 选中后输入框是裸名命令": results.draftBare,
  "④ momo 真回口令（核心）": results.tokenReturned,
  "⑤ 关掉后 UI 不再提供": results.disabledInUi && results.goneFromMenu,
  "⑤ 新对话真的建起来了": results.newConversationCreated,
  "⑤ 关掉后 momo 不再回口令": results.tokenAbsentWhenDisabled,
};
for (const [k, v] of Object.entries(required)) console.log(`${v ? "PASS" : "FAIL"}  ${k}`);
// Slash invocation is expanded by the CLI, so no Skill tool_use appears — the
// natural-language path DOES go through the Skill tool (see skills-probe 实测 E).
console.log(`(附加信号，斜杠路径预期 false) 走了 Skill 工具: ${results.skillToolUsed}`);

// Leave the user's skills dir as we found it.
if (seeded && process.env.LEEMO_KEEP_PROBE !== "1") {
  fs.rmSync(PROBE_DIR, { recursive: true, force: true });
  console.log(`\n已清理探针技能: ${PROBE_DIR}（LEEMO_KEEP_PROBE=1 可保留）`);
}

const pass = Object.values(required).every(Boolean);
console.log(`\n${pass ? "PASS" : "FAIL"}`);
process.exit(pass ? 0 : 3);
