import { describe, it, expect } from "vitest";
import { encode } from "gpt-tokenizer/encoding/o200k_base";
import {
  buildMomoSystemPrompt,
  DEFAULT_PERSONA_TEXT,
  PERSONA_TEXT_TOKEN_LIMIT,
  MEMORY_TEXT_TOKEN_LIMIT,
  NOTEBOOK_TEXT_TOKEN_LIMIT,
  type MomoPromptOptions,
} from "../../src/host/momo-prompt";
import { createMemoryGovernance, type MemoryIO } from "../../src/host/memory-governance";

/** The pinned budget configuration (卡 A §5): buddy mode, built-in default
 *  persona card, talkStyle=2, web search off, no memory bank. Layer ⑧ is
 *  deliberately excluded — memory is unbounded user data, so it cannot live
 *  inside a fixed token budget (see MEMORY_TEXT_TOKEN_LIMIT for its own cap). */
const PINNED: MomoPromptOptions = {
  mode: "buddy",
  personaText: DEFAULT_PERSONA_TEXT,
  talkStyle: 2,
  webSearchEnabled: false,
};

const build = (over: Partial<MomoPromptOptions> = {}): string =>
  buildMomoSystemPrompt({ ...PINNED, ...over });

describe("buildMomoSystemPrompt — seven layers", () => {
  it("assembles all seven layers (06 §7.2 / comate/09 §2)", () => {
    const p = build();
    // ① identity anchor (EN)
    expect(p).toContain("You are momo");
    // ② behavior code + anti-patterns (EN)
    expect(p).toContain("## Behavior");
    expect(p).toContain("## Forbidden");
    // ③ mode tone block (ZH)
    expect(p).toContain("## 当前模式");
    // ④ persona card (ZH)
    expect(p).toContain("## 当前人设");
    // ⑤ talk-style slider (ZH)
    expect(p).toContain("## 话风");
    // ⑥ memory rules (EN)
    expect(p).toContain("## Memory");
    // ⑦ web-search state (EN)
    expect(p).toContain("## Web access");
    // Always-on local document tools
    expect(p).toContain("## Local documents");
  });

  it("keeps the rule layers English and the persona layers Chinese", () => {
    const p = build();
    const section = (heading: string): string => {
      const start = p.indexOf(heading);
      expect(start).toBeGreaterThanOrEqual(0);
      const next = p.indexOf("\n## ", start + heading.length);
      return p.slice(start, next === -1 ? undefined : next);
    };
    // The name gloss `"momo"(默默)` is deliberate in the English behavior layer
    // (comate/09: the name means "things quietly fall into place", and the
    // prompt must say so or a writer drifts momo toward being taciturn). It is
    // a proper noun, not CJK prose, so it is excluded before the check.
    const hasCjk = (s: string): boolean => /[一-鿿]/.test(s.replace(/\(默默\)/g, ""));
    // Rule layers ②⑥⑦ carry no CJK prose (token-tight English).
    expect(hasCjk(section("## Behavior"))).toBe(false);
    expect(hasCjk(section("## Memory"))).toBe(false);
    expect(hasCjk(section("## Web access"))).toBe(false);
    // Persona layers ③④⑤ are Chinese (tone words live in a Chinese context).
    expect(hasCjk(section("## 当前模式"))).toBe(true);
    expect(hasCjk(section("## 话风"))).toBe(true);
  });

  it("keeps everyday replies concrete without canned AI prose", () => {
    const p = build();
    expect(p).toContain("Prefer concrete facts and plain language");
    expect(p).toContain("中文禁用“不是/不只是 X，而是/是 Y”");
    expect(p).toContain("“你真正想/怕的是”式翻案");
    expect(p).toContain("直接陈述判断");
    expect(p).toContain("不编故事，不堆抽象比喻");
  });

  it("orders the layers ①→⑦ so later layers refine earlier ones", () => {
    const p = build();
    const at = (s: string): number => p.indexOf(s);
    expect(at("You are momo")).toBeLessThan(at("## Behavior"));
    expect(at("## Behavior")).toBeLessThan(at("## Forbidden"));
    expect(at("## Forbidden")).toBeLessThan(at("## 当前模式"));
    expect(at("## 当前模式")).toBeLessThan(at("## 当前人设"));
    expect(at("## 当前人设")).toBeLessThan(at("## 话风"));
    expect(at("## 话风")).toBeLessThan(at("## Memory"));
    expect(at("## Memory")).toBeLessThan(at("## Web access"));
  });
});

describe("buildMomoSystemPrompt — dynamic branches", () => {
  it("layer ③ branches on mode", () => {
    expect(build({ mode: "buddy" })).toContain("搭子态");
    expect(build({ mode: "buddy" })).not.toContain("工作台态");
    expect(build({ mode: "workbench" })).toContain("工作台态");
    expect(build({ mode: "workbench" })).not.toContain("搭子态");
  });

  it("layer ⑤ branches across all three talk-style stops", () => {
    const concise = build({ talkStyle: 1 });
    const balanced = build({ talkStyle: 2 });
    const chatty = build({ talkStyle: 3 });
    expect(concise).toContain("简洁");
    expect(balanced).toContain("适度");
    expect(chatty).toContain("话痨");
    // Each stop is exclusive — no two mappings leak into one prompt.
    expect(concise).not.toContain("话痨");
    expect(chatty).not.toContain("能一句话说清不用两句");
    expect(new Set([concise, balanced, chatty]).size).toBe(3);
  });

  it("layer ⑦ branches on the web-search switch", () => {
    const on = build({ webSearchEnabled: true });
    const off = build({ webSearchEnabled: false });
    expect(on).toContain("Search: enabled");
    expect(on).not.toContain("Do not search");
    expect(off).toContain("Search: disabled");
    expect(off).toContain("Do not search");
  });

  it("学术检索跟随联网搜索开关，并用产品语言说明论文问题优先走 arXiv", () => {
    const on = build({ webSearchEnabled: true });
    const off = build({ webSearchEnabled: false });
    expect(on).toContain("Academic search: enabled");
    expect(on).toContain("arXiv");
    expect(off).toContain("Academic search: disabled");
    expect(off).not.toContain("Prefer academic_search");
  });

  it("states the verified local-document boundary without exposing the underlying harness", () => {
    const prompt = build();
    expect(prompt).toContain("Read PDF, Word, PowerPoint, and Excel");
    expect(prompt).toContain("create Word, PowerPoint, and Excel files");
    expect(prompt).toContain("exactly edit a Word copy");
    expect(prompt).toContain("Prefer Leemo tools");
    expect(prompt).toContain("Optional commands may be unavailable");
    expect(prompt).toContain("Never claim arbitrary layout or complex in-place editing");
    expect(prompt).not.toContain("Claude Code");
  });

  // 轮 4「三层开关」: 搜索与抓取是两个独立开关，层⑦ 必须分别陈述 —— "能搜但不能
  // 打开链接" 是真实状态，而 momo 宣告一个做不到的动作正是这一层要防的事。
  it("layer ⑦ states search and fetch separately, all four combinations distinct", () => {
    const p = (s: boolean, f: boolean) => build({ webSearchEnabled: s, webFetchEnabled: f });

    expect(p(true, true)).toContain("Search: enabled");
    expect(p(true, true)).toContain("Fetch: enabled");
    expect(p(true, false)).toContain("Search: enabled");
    expect(p(true, false)).toContain("Fetch: disabled");
    expect(p(false, true)).toContain("Search: disabled");
    expect(p(false, true)).toContain("Fetch: enabled");
    expect(p(false, false)).toContain("Search: disabled");
    expect(p(false, false)).toContain("Fetch: disabled");

    expect(new Set([p(true, true), p(true, false), p(false, true), p(false, false)]).size).toBe(4);
  });

  it("layer ⑦ says 'offline' only when BOTH are off — with one capability left momo must not claim it has none", () => {
    expect(build({ webSearchEnabled: false, webFetchEnabled: false })).toContain("no network access at all");
    expect(build({ webSearchEnabled: false, webFetchEnabled: true })).not.toContain("no network access at all");
    expect(build({ webSearchEnabled: true, webFetchEnabled: false })).not.toContain("no network access at all");
  });

  it("an omitted webFetchEnabled keeps fetch enabled (pre-existing callers）", () => {
    expect(build({ webSearchEnabled: false })).toContain("Fetch: enabled");
  });

  it("turns browser automation into a continuous user journey rather than per-click approvals", () => {
    const enabled = build({ browserEnabled: true });
    expect(enabled).toContain("Browser automation is enabled");
    expect(enabled).toContain("do not ask for confirmation at every step");
    expect(enabled).toContain("keep the same browser session open");
    expect(enabled).toContain("我已处理，继续");
    expect(enabled).toContain("先暂停");
    expect(enabled).toContain("Leemo ask-user tool");
    expect(enabled).toContain("ask the user to take over briefly");
    expect(enabled).toContain("submitting an application");
    expect(enabled).toContain("permission layer handles the one final confirmation");
    expect(enabled).toContain("omit filename");
    expect(enabled).toContain("durable workspace artifact");
  });

  it("does not let momo imply browser control when the user turned it off", () => {
    const disabled = build({ browserEnabled: false });
    expect(disabled).toContain("Browser automation is disabled");
    expect(disabled).toContain("Do not claim you can click, type, log in, or operate a website");
    expect(disabled).not.toContain("Routine navigation");
  });

  it("prefers semantic Windows controls and names the human-takeover boundary", () => {
    const enabled = build({ computerEnabled: true });
    expect(enabled).toContain("Desktop operation is enabled");
    expect(enabled).toContain("Prefer semantic UI controls");
    expect(enabled).toContain("screenshot or coordinate mouse actions only as a fallback");
    expect(enabled).toContain("password, verification code, two-factor prompt, UAC, or lock screen");
    expect(enabled).toContain("我已处理，继续");
  });

  it("does not let momo imply Windows control when the user turned it off", () => {
    const disabled = build({ computerEnabled: false });
    expect(disabled).toContain("Desktop operation is disabled");
    expect(disabled).toContain("Do not claim you can inspect, click, or type in Windows apps");
  });

  it("layer ④ carries the persona card body verbatim", () => {
    expect(build({ personaText: "你是热心学长，爱讲题。" })).toContain("你是热心学长，爱讲题。");
  });
});

describe("buildMomoSystemPrompt — identity regression (验收②)", () => {
  it("uses structured question cards for bounded branches without turning ordinary conversation into a form", () => {
    const p = build();
    expect(p).toContain("determines a bounded next action or conversation path");
    expect(p).toContain("use the Leemo ask-user tool");
    expect(p).toContain("every qualifying round");
    expect(p).toContain("after earlier cards");
    expect(p).toContain("changes subsequent execution or memory");
    expect(p).toContain("Do not use a card for rhetorical questions");
    expect(p).toContain("draft, example, analysis, or best-effort first pass");
    expect(p).toContain("no missing fact blocks the answer");
    expect(p).toContain("user's unrestricted wording is the point");
  });

  it("names momo and never self-identifies as Claude", () => {
    for (const mode of ["buddy", "workbench"] as const) {
      const p = build({ mode });
      expect(p).toContain("momo");
      // The literal string "Claude" DOES appear — inside the prohibition
      // "Never claim to be Claude or any other AI" (comate/09 layer ①, user
      // approved). A bare substring ban would forbid the very instruction that
      // enforces this, so assert the meaningful thing: no self-identification.
      expect(p).not.toMatch(/You are Claude|I am Claude|我是\s*Claude|You'?re Claude/i);
      expect(p).toMatch(/Never claim to be Claude/);
    }
  });

  it("can disagree without refusing or rewriting a legitimate task", () => {
    const p = build();
    expect(p).toContain("carry out the user's task as asked");
    expect(p).toContain("Never distort, scold, or refuse a legitimate request");
    expect(p).toContain("real safety boundary");
  });
});

describe("buildMomoSystemPrompt — bounded work overview", () => {
  it("shares one evidence-backed checkpoint policy between Buddy and Workbench without automatic calls", () => {
    for (const mode of ["buddy", "workbench"] as const) {
      const p = build({ mode });
      const documentStart = p.indexOf("## Local documents");
      const overviewStart = p.indexOf("## Work overview");
      expect((p.match(/^## Work overview$/gm) ?? [])).toHaveLength(1);
      expect(overviewStart).toBeGreaterThan(documentStart);
      expect(p.slice(documentStart, overviewStart)).not.toContain("Maintain a bounded work overview");
      expect(p).toContain("### Maintain a bounded work overview");
      expect(p).toContain("objective or constraint changes");
      expect(p).toContain("genuinely new phase");
      expect(p).toContain("blocker appears or clears");
      expect(p).toContain("run ends with meaningful progress, decision, or artifact");
      expect(p).toContain("Usually call once at run end");
      expect(p).toContain("only one extra call is allowed");
      expect(p).toContain("goal change, blocker, recovery, or phase boundary");
      expect(p).toContain("ordinary chat");
      expect(p).toContain("explanation-only answers");
      expect(p).toContain("repeated reads/searches");
      expect(p).toContain("individual tool steps");
      expect(p).toContain("view changes");
      expect(p).toContain("retries with no net change");
      expect(p).toContain("Never mark a user Todo complete");
      expect(p).toContain("invent an overall percentage");
      expect(p).toContain("verified by the actual result of its corresponding run, tool, or artifact");
      expect(p).toContain("Never present failed, unverified, unrelated, or partially completed work as completed");
      expect(p).toContain("If the metadata call fails, continue the user's task");
      expect(p).toContain("Do not create a timer, background request, or automatic panel-open call");
      expect(p).toContain("Never call it just because Buddy opens or history is viewed");
    }
  });
});

describe("buildMomoSystemPrompt — token budget (验收③)", () => {
  it("stays within 1,050 tokens for the pinned configuration", () => {
    // Pinned: gpt-tokenizer o200k_base (same estimator as the gateway's
    // count_tokens), mode=buddy, default persona card, talkStyle=2, no search.
    // memoryDir IS included: layer ⑥ quotes it four times, so measuring
    // without it would under-report the prompt that actually ships.
    //
    // This ceiling covers all authored, always-on rule layers paid on every
    // turn of every conversation.
    const shipped = build({ memoryDir: "C:\\Users\\Rengar\\Leemo" });
    expect(encode(shipped).length).toBeLessThanOrEqual(1050);
  });

  it("keeps the governed empty current view small", () => {
    const memoryDir = "C:\\Users\\Rengar\\Leemo";
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    const io: MemoryIO = {
      exists: (p) => files.has(p),
      readFile: (p) => files.get(p) ?? "",
      writeFile: (p, c) => { files.set(p, c); },
      appendFile: (p, c) => { files.set(p, `${files.get(p) ?? ""}${c}`); },
      mkdirp: (p) => { dirs.add(p); },
      readdir: () => [],
      rename: (from, to) => {
        const value = files.get(from);
        if (value === undefined) throw new Error("missing source");
        files.delete(from);
        files.set(to, value);
      },
    };
    const governance = createMemoryGovernance({ workspaceRoot: memoryDir, io });
    const paths = governance.ensureScope({ type: "global" });
    const memoryText = files.get(paths.currentView);
    expect(memoryText).toBeTruthy();
    expect(encode(memoryText!).length).toBeLessThanOrEqual(20);

    const shipped = build({ memoryDir, memoryText });
    expect(encode(shipped).length).toBeLessThanOrEqual(1050 + 20);
  });

  it("truncates an oversized persona card instead of blowing the budget", () => {
    const huge = "超长人设卡内容，反复堆叠很多字。".repeat(200);
    const p = build({ personaText: huge });
    expect(encode(p).length).toBeLessThanOrEqual(1050 + PERSONA_TEXT_TOKEN_LIMIT);
    expect(p).not.toContain(huge);
    expect(p).toContain("…");
  });
});

describe("buildMomoSystemPrompt — governed current memory", () => {
  it("omits the current-memory layer when no memory text is supplied", () => {
    expect(build()).not.toContain("## What momo remembers now");
  });

  it("appends the bounded current view when supplied", () => {
    const p = build({ memoryText: "## 当前状态\n用户在准备期末考。" });
    expect(p).toContain("## What momo remembers now");
    expect(p).toContain("用户在准备期末考。");
    expect(p).toContain("Long-term memory is enabled");
    expect(p).not.toContain("Long-term memory is disabled");
    expect(p.indexOf("## What momo remembers now")).toBeGreaterThan(p.indexOf("## Web access"));
  });

  it("caps a runaway memory bank so it cannot eat the context window", () => {
    const flood = "记忆条目：用户说了很多话。\n".repeat(5000);
    const p = build({ memoryText: flood });
    expect(encode(p).length).toBeLessThanOrEqual(1050 + MEMORY_TEXT_TOKEN_LIMIT);
  });

  it("ignores a blank memory file", () => {
    expect(build({ memoryText: "   \n\n  " })).not.toContain("## What momo remembers now");
  });

  it("uses Leemo product language and never exposes legacy or harness storage paths", () => {
    const prompt = build({
      memoryDir: "C:\\Users\\Rengar\\Leemo",
      memoryText: "# momo memory\n\n- 用户正在求职。",
      notebookTitle: "秋招",
      notebookDir: "C:\\Users\\Rengar\\Leemo\\秋招",
      notebookText: "# momo memory\n\n- 简历要突出可验证成果。",
    });

    expect(prompt).toContain("Leemo memory tools");
    expect(prompt).toContain("用户正在求职。");
    expect(prompt).toContain("简历要突出可验证成果。");
    expect(prompt).not.toContain("CLAUDE.md");
    expect(prompt).not.toContain("memory\\bookmarks.md");
    expect(prompt).not.toContain("memory\\moments.md");
    expect(prompt).not.toContain(".leemo\\memory");
    expect(prompt).not.toContain(".claude\\skills");
  });
});

describe("buildMomoSystemPrompt — workspace destination", () => {
  it("keeps the root view while naming the absolute default artifact directory", () => {
    const p = build({
      workspaceRoot: "C:\\Users\\Rengar\\Leemo",
      defaultArtifactDir: "C:\\Users\\Rengar\\Leemo\\默认工作区",
    } as Partial<MomoPromptOptions>);

    expect(p).toContain("C:\\Users\\Rengar\\Leemo\\默认工作区");
    expect(p).toContain("C:\\Users\\Rengar\\Leemo");
    expect(p).toMatch(/all notebooks|所有本子/i);
    expect(p).toMatch(/new artifact|新产物/i);
  });

  it("does not invent a default path when the host did not provide one", () => {
    expect(build()).not.toContain("默认工作区");
  });
});

describe("buildMomoSystemPrompt — governed notebook memory", () => {
  it("omits the notebook layer entirely when no notebook is active", () => {
    expect(build()).not.toContain("## 当前本子");
  });

  it("names the active notebook and its real work directory without a memory file path", () => {
    const p = build({ notebookTitle: "高等数学", notebookDir: "C:\\Users\\R\\Leemo\\高等数学" });
    expect(p).toContain("## 当前本子");
    expect(p).toContain("高等数学");
    expect(p).toContain("C:\\Users\\R\\Leemo\\高等数学");
    expect(p).not.toContain("CLAUDE.md");
  });

  it("overlays the notebook current view on top of the global current view", () => {
    const p = build({
      memoryText: "全局：用户在准备期末考。",
      notebookTitle: "数据结构",
      notebookDir: "/home/u/Leemo/数据结构",
      notebookText: "本子约定：代码注释用中文。",
    });
    expect(p).toContain("全局：用户在准备期末考。");
    expect(p).toContain("本子约定：代码注释用中文。");
    // 06 §7.4: 工作台态 = 全局 + 本子叠加, and the NARROWER layer must sit
    // closest to the turn so it refines rather than gets refined.
    expect(p.indexOf("本子约定")).toBeGreaterThan(p.indexOf("全局："));
  });

  it("caps a runaway notebook file on its own budget", () => {
    const flood = "本子里记了很多东西。\n".repeat(5000);
    const p = build({
      notebookTitle: "本",
      notebookDir: "/w/本",
      notebookText: flood,
    });
    const memoryHeading = "### momo 对这个本子的当前记忆\n";
    const notebookMemory = p.slice(p.indexOf(memoryHeading) + memoryHeading.length);
    expect(encode(notebookMemory).length).toBeLessThanOrEqual(NOTEBOOK_TEXT_TOKEN_LIMIT + 1);
  });

  it("still announces the notebook when its current view is blank", () => {
    const p = build({ notebookTitle: "本", notebookDir: "/w/本", notebookText: "  \n " });
    expect(p).toContain("## 当前本子");
    expect(p).not.toContain("momo 对这个本子的当前记忆");
  });
});

describe("buildMomoSystemPrompt — memory storage stays opaque", () => {
  it("does not render the Windows workspace root as a memory destination", () => {
    const p = build({ memoryDir: "C:\\Users\\Rengar\\Leemo" });
    expect(p).toContain("Long-term memory is enabled");
    expect(p).not.toContain("C:\\Users\\Rengar\\Leemo");
    expect(p).not.toContain("CLAUDE.md");
  });

  it("does not render a POSIX workspace root as a memory destination", () => {
    const p = build({ memoryDir: "/home/rengar/Leemo" });
    expect(p).toContain("Long-term memory is enabled");
    expect(p).not.toContain("/home/rengar/Leemo");
  });

  it("still ships layer ⑥ when the host supplies no memory dir", () => {
    // Fallback wording must not invent a path either — it tells momo memory is
    // unavailable rather than pointing at a directory that may not exist.
    const p = build();
    expect(p).toContain("## Memory");
    expect(p).not.toMatch(/~\/Leemo/);
  });
});

describe("buildMomoSystemPrompt — internal skill storage stays out of memory instructions", () => {
  it("does not expose the Windows plugin path", () => {
    const p = build({ memoryDir: "C:\\Users\\Rengar\\Leemo" });
    expect(p).not.toContain(".claude");
    expect(p).not.toMatch(/SKILL\.md/);
  });

  it("does not expose the POSIX plugin path", () => {
    const p = build({ memoryDir: "/home/rengar/Leemo" });
    expect(p).not.toContain(".claude");
    expect(p).not.toContain("/home/rengar/Leemo");
  });

  it("never leaks the internal qualified skill prefix", () => {
    const p = build({ memoryDir: "/home/rengar/Leemo" });
    expect(p).not.toContain("leemo:");
  });

  it("says nothing about installing skills when there is no memory dir", () => {
    // No bank = no place to put one; naming a directory that may not exist is
    // exactly what caused the stray writes layer ⑥ was rewritten to prevent.
    const p = build();
    expect(p).not.toMatch(/SKILL\.md/);
  });
});
