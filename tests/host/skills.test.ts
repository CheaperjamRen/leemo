import { describe, it, expect } from "vitest";
import {
  scanSkills,
  ensureSkillsPlugin,
  skillsRootFor,
  pluginRootFor,
  LEEMO_PLUGIN_NAME,
  type SkillsIO,
} from "../../src/host/skills";

/** In-memory fake IO — no real filesystem. Mirrors the shape main.ts/dev.ts
 *  wire against real fs (same idiom as memory-bank.test.ts's fakeIO). */
function fakeIO(
  seed: Record<string, string> = {},
  dirs: Record<string, string[]> = {},
): SkillsIO & { files: Map<string, string>; mkdirpCalls: string[] } {
  const files = new Map<string, string>(Object.entries(seed));
  const mkdirpCalls: string[] = [];
  const madeDirs = new Set<string>();
  return {
    files,
    mkdirpCalls,
    readdir: (dir) => {
      const entries = dirs[dir];
      if (entries === undefined) throw new Error(`ENOENT: no such directory: ${dir}`);
      return [...entries];
    },
    readFile: (path) => {
      const contents = files.get(path);
      if (contents === undefined) throw new Error(`ENOENT: no such file: ${path}`);
      return contents;
    },
    exists: (path) => files.has(path) || dirs[path] !== undefined || madeDirs.has(path),
    writeFile: (path, contents) => {
      files.set(path, contents);
    },
    mkdirp: (dir) => {
      mkdirpCalls.push(dir);
      madeDirs.add(dir);
    },
  };
}

const WIN_MEM = "C:\\Users\\Rengar\\Leemo";
const POSIX_MEM = "/home/rengar/Leemo";
const WIN_SKILLS = `${WIN_MEM}\\.leemo\\skills`;

function skillMd(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nDo the thing.\n`;
}

describe("skills — path helpers keep the G-plan layout in one place", () => {
  it("plugin root is <memoryDir>/.leemo and skills root is its skills/ subdir", () => {
    expect(pluginRootFor(WIN_MEM)).toBe(`${WIN_MEM}\\.leemo`);
    expect(skillsRootFor(WIN_MEM)).toBe(`${WIN_MEM}\\.leemo\\skills`);
  });

  it("keeps the caller's separator style for posix memory dirs", () => {
    expect(pluginRootFor(POSIX_MEM)).toBe(`${POSIX_MEM}/.leemo`);
    expect(skillsRootFor(POSIX_MEM)).toBe(`${POSIX_MEM}/.leemo/skills`);
  });

  it("the plugin name is 'leemo' (so qualified names read leemo:<skill>)", () => {
    // Without plugin.json the engine degrades the prefix to the directory name
    // '.claude' (卡 E §一) — ugly and brittle. This constant pins the good name.
    expect(LEEMO_PLUGIN_NAME).toBe("leemo");
  });
});

describe("scanSkills — reads <skillsRoot>/<name>/SKILL.md frontmatter", () => {
  it("returns one SkillInfo per valid skill dir with bare name + description", () => {
    const io = fakeIO(
      {
        [`${WIN_SKILLS}\\pdf\\SKILL.md`]: skillMd("pdf", "Fill in PDF forms"),
        [`${WIN_SKILLS}\\期末速通\\SKILL.md`]: skillMd("期末速通", "考前突击"),
      },
      { [WIN_SKILLS]: ["pdf", "期末速通"] },
    );

    const found = scanSkills(WIN_SKILLS, LEEMO_PLUGIN_NAME, io);

    expect(found).toHaveLength(2);
    expect(found.map((s) => s.name)).toEqual(["pdf", "期末速通"]);
    expect(found[0]).toEqual({
      name: "pdf",
      description: "Fill in PDF forms",
      qualifiedName: "leemo:pdf",
      dir: `${WIN_SKILLS}\\pdf`,
      source: "user",
    });
  });

  it("qualifies the SDK name as <plugin>:<bare> — the only place the prefix lives", () => {
    const io = fakeIO(
      { [`${WIN_SKILLS}\\deep-read\\SKILL.md`]: skillMd("deep-read", "读透一篇文章") },
      { [WIN_SKILLS]: ["deep-read"] },
    );
    const [skill] = scanSkills(WIN_SKILLS, LEEMO_PLUGIN_NAME, io);
    expect(skill.qualifiedName).toBe("leemo:deep-read");
    // The bare name is what every user-visible surface renders.
    expect(skill.name).toBe("deep-read");
  });

  it("returns [] when the skills root does not exist yet (first run, not an error)", () => {
    // 卡 E §一: a missing plugin dir degrades safely — chat must not break.
    const io = fakeIO({}, {});
    expect(scanSkills(WIN_SKILLS, LEEMO_PLUGIN_NAME, io)).toEqual([]);
  });

  it("returns [] for an existing but empty skills root", () => {
    const io = fakeIO({}, { [WIN_SKILLS]: [] });
    expect(scanSkills(WIN_SKILLS, LEEMO_PLUGIN_NAME, io)).toEqual([]);
  });

  it("sorts by bare name so the UI order is stable across platforms", () => {
    // readdir order is not guaranteed; the SkillsPage grid must not reshuffle.
    const io = fakeIO(
      {
        [`${WIN_SKILLS}\\zebra\\SKILL.md`]: skillMd("zebra", "z"),
        [`${WIN_SKILLS}\\alpha\\SKILL.md`]: skillMd("alpha", "a"),
        [`${WIN_SKILLS}\\mid\\SKILL.md`]: skillMd("mid", "m"),
      },
      { [WIN_SKILLS]: ["zebra", "mid", "alpha"] },
    );
    expect(scanSkills(WIN_SKILLS, LEEMO_PLUGIN_NAME, io).map((s) => s.name)).toEqual([
      "alpha",
      "mid",
      "zebra",
    ]);
  });

  it("joins posix paths without mangling the separator", () => {
    const root = `${POSIX_MEM}/.leemo/skills`;
    const io = fakeIO(
      { [`${root}/pdf/SKILL.md`]: skillMd("pdf", "forms") },
      { [root]: ["pdf"] },
    );
    const [skill] = scanSkills(root, LEEMO_PLUGIN_NAME, io);
    expect(skill.dir).toBe(`${root}/pdf`);
    expect(skill.dir).not.toContain("\\");
  });
});

describe("scanSkills — frontmatter parsing (own minimal parser, no YAML dep)", () => {
  it("reads standard YAML block descriptions without treating nested metadata as top-level fields", () => {
    const io = fakeIO(
      {
        [`${WIN_SKILLS}\\ima\\SKILL.md`]:
          "---\nname: ima\ndescription: |\n  第一行用途。\n  第二行用途。\nmetadata:\n  description: 不能覆盖顶层描述\n---\nbody\n",
      },
      { [WIN_SKILLS]: ["ima"] },
    );

    expect(scanSkills(WIN_SKILLS, LEEMO_PLUGIN_NAME, io)[0]?.description)
      .toBe("第一行用途。\n第二行用途。");
  });

  it("reads name/description regardless of key order and extra keys", () => {
    const io = fakeIO(
      {
        [`${WIN_SKILLS}\\x\\SKILL.md`]:
          "---\nallowed-tools: Read, Write\ndescription: 描述在前\nname: x\nversion: 2\n---\nbody\n",
      },
      { [WIN_SKILLS]: ["x"] },
    );
    const [skill] = scanSkills(WIN_SKILLS, LEEMO_PLUGIN_NAME, io);
    expect(skill.name).toBe("x");
    expect(skill.description).toBe("描述在前");
  });

  it("preserves user-defined categories for dynamic navigation", () => {
    const io = fakeIO(
      {
        [`${WIN_SKILLS}\\x\\SKILL.md`]:
          "---\nname: x\ndescription: 自定义能力\ncategory: social-publishing\ncategory-label: 内容发布\n---\nbody\n",
      },
      { [WIN_SKILLS]: ["x"] },
    );

    expect(scanSkills(WIN_SKILLS, LEEMO_PLUGIN_NAME, io)[0]).toMatchObject({
      category: "social-publishing",
      categoryLabel: "内容发布",
    });
  });

  it("strips surrounding quotes from values", () => {
    const io = fakeIO(
      {
        [`${WIN_SKILLS}\\q\\SKILL.md`]:
          `---\nname: "q"\ndescription: 'Use when: the user asks'\n---\nbody\n`,
      },
      { [WIN_SKILLS]: ["q"] },
    );
    const [skill] = scanSkills(WIN_SKILLS, LEEMO_PLUGIN_NAME, io);
    expect(skill.name).toBe("q");
    // A colon INSIDE the description is data, not a key separator.
    expect(skill.description).toBe("Use when: the user asks");
  });

  it("tolerates CRLF line endings (files edited in Notepad on Windows)", () => {
    const io = fakeIO(
      {
        [`${WIN_SKILLS}\\crlf\\SKILL.md`]:
          "---\r\nname: crlf\r\ndescription: windows editor\r\n---\r\nbody\r\n",
      },
      { [WIN_SKILLS]: ["crlf"] },
    );
    const [skill] = scanSkills(WIN_SKILLS, LEEMO_PLUGIN_NAME, io);
    expect(skill.name).toBe("crlf");
    expect(skill.description).toBe("windows editor");
  });

  it("strips a UTF-8 BOM before looking for the frontmatter fence", () => {
    const io = fakeIO(
      { [`${WIN_SKILLS}\\bom\\SKILL.md`]: `\uFEFF${skillMd("bom", "byte order mark")}` },
      { [WIN_SKILLS]: ["bom"] },
    );
    const [skill] = scanSkills(WIN_SKILLS, LEEMO_PLUGIN_NAME, io);
    expect(skill.name).toBe("bom");
  });

  it("keeps a skill whose description is missing (empty string, NOT skipped)", () => {
    // 卡 E §三.1: 缺 description 给空串不跳过.
    const io = fakeIO(
      { [`${WIN_SKILLS}\\nodesc\\SKILL.md`]: "---\nname: nodesc\n---\nbody\n" },
      { [WIN_SKILLS]: ["nodesc"] },
    );
    const found = scanSkills(WIN_SKILLS, LEEMO_PLUGIN_NAME, io);
    expect(found).toHaveLength(1);
    expect(found[0].description).toBe("");
  });
});

describe("scanSkills — one bad file never kills the whole list (卡 E §三.1)", () => {
  it("skips a SKILL.md with no frontmatter at all but keeps its siblings", () => {
    const io = fakeIO(
      {
        [`${WIN_SKILLS}\\good\\SKILL.md`]: skillMd("good", "works"),
        [`${WIN_SKILLS}\\raw\\SKILL.md`]: "# Just a heading, no frontmatter\n",
      },
      { [WIN_SKILLS]: ["good", "raw"] },
    );
    expect(scanSkills(WIN_SKILLS, LEEMO_PLUGIN_NAME, io).map((s) => s.name)).toEqual(["good"]);
  });

  it("skips a frontmatter block that is never closed", () => {
    const io = fakeIO(
      {
        [`${WIN_SKILLS}\\good\\SKILL.md`]: skillMd("good", "works"),
        [`${WIN_SKILLS}\\unclosed\\SKILL.md`]: "---\nname: unclosed\ndescription: oops\n",
      },
      { [WIN_SKILLS]: ["good", "unclosed"] },
    );
    expect(scanSkills(WIN_SKILLS, LEEMO_PLUGIN_NAME, io).map((s) => s.name)).toEqual(["good"]);
  });

  it("skips a skill missing `name` (the SDK could not address it either)", () => {
    const io = fakeIO(
      {
        [`${WIN_SKILLS}\\good\\SKILL.md`]: skillMd("good", "works"),
        [`${WIN_SKILLS}\\anon\\SKILL.md`]: "---\ndescription: nameless\n---\nbody\n",
      },
      { [WIN_SKILLS]: ["good", "anon"] },
    );
    expect(scanSkills(WIN_SKILLS, LEEMO_PLUGIN_NAME, io).map((s) => s.name)).toEqual(["good"]);
  });

  it("skips an unreadable file (bad encoding / EACCES) and continues", () => {
    const io = fakeIO(
      { [`${WIN_SKILLS}\\good\\SKILL.md`]: skillMd("good", "works") },
      { [WIN_SKILLS]: ["good", "broken"] },
    );
    // `broken/SKILL.md` exists per readdir but readFile throws — the exact
    // shape of a file with a bad encoding or a permissions problem.
    const io2: SkillsIO = {
      ...io,
      exists: (p) => p === `${WIN_SKILLS}\\broken\\SKILL.md` || io.exists(p),
      readFile: (p) => {
        if (p.includes("broken")) throw new Error("EACCES");
        return io.readFile(p);
      },
    };
    expect(scanSkills(WIN_SKILLS, LEEMO_PLUGIN_NAME, io2).map((s) => s.name)).toEqual(["good"]);
  });

  it("skips a subdirectory with no SKILL.md (user's README / assets folder)", () => {
    const io = fakeIO(
      {
        [`${WIN_SKILLS}\\good\\SKILL.md`]: skillMd("good", "works"),
        [`${WIN_SKILLS}\\assets\\logo.png`]: "binary",
      },
      { [WIN_SKILLS]: ["good", "assets"] },
    );
    expect(scanSkills(WIN_SKILLS, LEEMO_PLUGIN_NAME, io).map((s) => s.name)).toEqual(["good"]);
  });

  it("survives a readdir that throws (root vanished mid-scan)", () => {
    const io: SkillsIO = {
      readdir: () => {
        throw new Error("EPERM");
      },
      readFile: () => "",
      exists: () => true,
      writeFile: () => {},
      mkdirp: () => {},
    };
    expect(scanSkills(WIN_SKILLS, LEEMO_PLUGIN_NAME, io)).toEqual([]);
  });
});

describe("skills — 铁律: the leemo: prefix NEVER leaks into a user-visible name", () => {
  it("SkillInfo.name never contains ':' even when frontmatter tries to smuggle one", () => {
    // User requirement (卡 E §二): 「用户让安装什么 skill 那就是叫做什么名字」.
    // `name` is what the SkillsPage card, the / menu, and the chips render — a
    // colon there would both look wrong AND collide with CC's plugin:skill
    // qualification syntax, so such a skill is skipped rather than mangled.
    const io = fakeIO(
      {
        [`${WIN_SKILLS}\\ok\\SKILL.md`]: skillMd("ok", "fine"),
        [`${WIN_SKILLS}\\sneaky\\SKILL.md`]: skillMd("other:sneaky", "prefixed on purpose"),
      },
      { [WIN_SKILLS]: ["ok", "sneaky"] },
    );
    const found = scanSkills(WIN_SKILLS, LEEMO_PLUGIN_NAME, io);
    for (const skill of found) expect(skill.name).not.toContain(":");
    expect(found.map((s) => s.name)).toEqual(["ok"]);
  });

  it("every scanned skill keeps prefix ONLY in qualifiedName", () => {
    const io = fakeIO(
      {
        [`${WIN_SKILLS}\\a\\SKILL.md`]: skillMd("a", "one"),
        [`${WIN_SKILLS}\\b\\SKILL.md`]: skillMd("b", "two"),
      },
      { [WIN_SKILLS]: ["a", "b"] },
    );
    for (const skill of scanSkills(WIN_SKILLS, LEEMO_PLUGIN_NAME, io)) {
      expect(skill.name.startsWith("leemo:")).toBe(false);
      expect(skill.qualifiedName).toBe(`leemo:${skill.name}`);
    }
  });
});

describe("ensureSkillsPlugin — idempotent scaffold, never edits the user's file", () => {
  it("creates .claude-plugin/plugin.json + skills/ on a fresh memory dir", () => {
    const io = fakeIO();
    ensureSkillsPlugin(WIN_MEM, io);

    const manifest = `${WIN_MEM}\\.leemo\\.claude-plugin\\plugin.json`;
    expect(io.exists(manifest)).toBe(true);
    expect(io.mkdirpCalls).toContain(`${WIN_MEM}\\.leemo\\skills`);
    expect(io.mkdirpCalls).toContain(`${WIN_MEM}\\.leemo\\.claude-plugin`);
  });

  it("writes name 'leemo' so qualified names are leemo:<skill>, not .claude:<skill>", () => {
    const io = fakeIO();
    ensureSkillsPlugin(WIN_MEM, io);
    const manifest = JSON.parse(
      io.files.get(`${WIN_MEM}\\.leemo\\.claude-plugin\\plugin.json`) as string,
    ) as { name: string };
    expect(manifest.name).toBe("leemo");
  });

  it("emits valid JSON (the engine parses this file; a syntax error kills the plugin)", () => {
    const io = fakeIO();
    ensureSkillsPlugin(WIN_MEM, io);
    const raw = io.files.get(`${WIN_MEM}\\.leemo\\.claude-plugin\\plugin.json`) as string;
    expect(() => JSON.parse(raw) as unknown).not.toThrow();
  });

  it("leaves an existing plugin.json byte-for-byte untouched (user may have edited it)", () => {
    // Same hard rule as 卡 B's ensureMemoryBank: an existing file is the user's.
    const manifest = `${WIN_MEM}\\.leemo\\.claude-plugin\\plugin.json`;
    const userWritten = `{\n  "name": "leemo",\n  "description": "我自己改过的"\n}\n`;
    const io = fakeIO({ [manifest]: userWritten });
    ensureSkillsPlugin(WIN_MEM, io);
    expect(io.files.get(manifest)).toBe(userWritten);
  });

  it("still ensures skills/ exists even when plugin.json is already there", () => {
    const manifest = `${WIN_MEM}\\.leemo\\.claude-plugin\\plugin.json`;
    const io = fakeIO({ [manifest]: "{}" });
    ensureSkillsPlugin(WIN_MEM, io);
    expect(io.mkdirpCalls).toContain(`${WIN_MEM}\\.leemo\\skills`);
  });

  it("is idempotent — a second call writes nothing new", () => {
    const io = fakeIO();
    ensureSkillsPlugin(WIN_MEM, io);
    const after = io.files.get(`${WIN_MEM}\\.leemo\\.claude-plugin\\plugin.json`);
    ensureSkillsPlugin(WIN_MEM, io);
    expect(io.files.get(`${WIN_MEM}\\.leemo\\.claude-plugin\\plugin.json`)).toBe(after);
    expect(io.files.size).toBe(1);
  });

  it("uses posix separators for a posix memory dir", () => {
    const io = fakeIO();
    ensureSkillsPlugin(POSIX_MEM, io);
    expect(io.exists(`${POSIX_MEM}/.leemo/.claude-plugin/plugin.json`)).toBe(true);
  });
});
