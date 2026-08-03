import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SkillsPage from "./SkillsPage";
import { BridgeProvider } from "../bridge/context";
import type { BridgeClient } from "../bridge/client";
import type { CommunitySkillView, SkillInfo, SkillSourceInspectionView } from "../../bridge/contract";

const personalSkill = (name: string, description = `${name} 的说明`, managed = false): SkillInfo => ({
  id: managed ? `managed:${name}` : `custom:leemo:${name}`,
  name,
  description,
  qualifiedName: `leemo:${name}`,
  source: "user",
  trust: "personal",
  sourceKind: managed ? "github" : "manual",
  sourceLabel: managed ? "GitHub" : "本地文件夹",
  scanStatus: managed ? "scanned" : "unscanned",
  canRemove: managed,
  canUpdate: managed,
});

const builtin = (
  id: string,
  name: string,
  category: NonNullable<SkillInfo["category"]>,
  defaultEnabled = false,
  available = true,
  requirements: NonNullable<SkillInfo["requirements"]> = ["core"],
): SkillInfo => ({
  id,
  name,
  description: `${name} 的明确用途说明`,
  qualifiedName: `leemo-library:${name}`,
  source: "builtin",
  category,
  requirements,
  defaultEnabled,
  available,
  trust: "leemo",
  sourceKind: "leemo",
  sourceLabel: "Leemo",
  scanStatus: "scanned",
  canRemove: false,
  canUpdate: false,
  ...(available ? {} : { unavailableReason: "本地组件未就绪" }),
});

const communitySkill = (name: string, category?: string, categoryLabel?: string): SkillInfo => ({
  id: `managed:${name}`,
  name,
  description: `${name} 的社区用途说明`,
  qualifiedName: `leemo:${name}`,
  source: "user",
  trust: "community",
  sourceKind: "github",
  sourceLabel: "社区精选",
  scanStatus: "scanned",
  canRemove: true,
  canUpdate: true,
  ...(category ? { category } : {}),
  ...(categoryLabel ? { categoryLabel } : {}),
});

const catalogEntry = (overrides: Partial<CommunitySkillView> = {}): CommunitySkillView => ({
  id: "grill-me",
  name: "grill-me",
  description: "用连续追问检验方案是否真的站得住。",
  category: "workbench",
  categoryLabel: "通用工作台",
  author: "Matt Pocock",
  repository: "mattpocock/skills",
  revision: "abc123",
  license: "MIT",
  sourceUrl: "https://github.com/mattpocock/skills/tree/abc123/skills/productivity/grilling",
  installed: false,
  scanStatus: "scanned",
  ...overrides,
});

function makeClient(initial: SkillInfo[], initialCommunity: CommunitySkillView[] = []) {
  let list = [...initial];
  let community = [...initialCommunity];
  const calls: { channel: string; req: unknown }[] = [];
  const inspection: SkillSourceInspectionView = {
    sourceKind: "github",
    sourceLabel: "community-author",
    resolvedSource: "https://github.com/community/skills/tree/abc123/demo",
    repository: "community/skills",
    revision: "abc123",
    license: "MIT",
    candidates: [{
      name: "demo",
      description: "把网页内容整理成干净 Markdown。",
    }],
  };
  const client = {
    invoke: vi.fn(async (channel: string, req: unknown) => {
      calls.push({ channel, req });
      if (channel === "bridge:listSkills") return list;
      if (channel === "bridge:listCommunitySkills") return community;
      if (channel === "bridge:listProviders") return [];
      if (channel === "bridge:listWhitelist") return [];
      if (channel === "bridge:pickSkillSource") return { path: "C:\\Downloads\\demo.zip" };
      if (channel === "bridge:inspectSkillSource") {
        const securityScan = (req as { securityScan?: boolean }).securityScan === true;
        return securityScan ? {
          ...inspection,
          candidates: inspection.candidates.map((candidate) => ({
            ...candidate,
            scan: { status: "scanned", findings: [], analyzedFiles: 2, analysis: "static" },
          })),
        } satisfies SkillSourceInspectionView : inspection;
      }
      if (channel === "bridge:installSkill") {
        list = [...list, personalSkill("demo", "把网页内容整理成干净 Markdown。", true)];
        return {
          installed: [{
            id: "managed:demo",
            name: "demo",
            description: "把网页内容整理成干净 Markdown。",
            trust: "personal",
            sourceKind: "github",
            sourceLabel: "community-author",
            scanStatus: "unscanned",
            canUpdate: true,
          }],
          receipt: "已安装 demo · 来源 community-author · 未扫描",
        };
      }
      if (channel === "bridge:installCommunitySkill") {
        const id = (req as { id: string }).id;
        const entry = community.find((candidate) => candidate.id === id)!;
        list = [...list, communitySkill(entry.name, entry.category, entry.categoryLabel)];
        community = community.map((candidate) => candidate.id === id ? { ...candidate, installed: true } : candidate);
        return { installed: [], receipt: `已安装 ${entry.name}` };
      }
      if (channel === "bridge:scanInstalledSkill") {
        const id = (req as { id: string }).id;
        const target = list.find((candidate) => candidate.id === id)!;
        return {
          id,
          name: target.name,
          description: target.description,
          trust: target.trust ?? "personal",
          sourceKind: target.sourceKind ?? "local-folder",
          sourceLabel: target.sourceLabel ?? "本地",
          scanStatus: "review",
          securityFindings: [{
            rule: "credential-access",
            severity: "high",
            title: "会读取凭据",
            detail: "说明中要求读取本地凭据。",
            file: "SKILL.md",
          }],
          canUpdate: true,
        };
      }
      if (channel === "bridge:removeSkill") {
        list = list.filter((skill) => skill.id !== (req as { id: string }).id);
        return undefined;
      }
      if (channel === "bridge:syncEnabledSkills") return { updatedConversations: 1 };
      return undefined;
    }),
    subscribe: vi.fn(() => () => {}),
  } as unknown as BridgeClient & { invoke: ReturnType<typeof vi.fn> };
  return { client, calls, inspection };
}

function renderPage(list: SkillInfo[] = [personalSkill("pdf"), personalSkill("期末速通")]) {
  const harness = makeClient(list);
  const utils = render(
    <BridgeProvider client={harness.client} live>
      <SkillsPage />
    </BridgeProvider>,
  );
  return { ...utils, ...harness };
}

describe("SkillsPage — catalog truth and runtime controls", () => {
  it("lists bridge-reported skills with bare names and real descriptions", async () => {
    const { container } = renderPage();
    expect(await screen.findByText("pdf")).toBeInTheDocument();
    expect(screen.getByText("期末速通")).toBeInTheDocument();
    expect(screen.getByText("pdf 的说明")).toBeInTheDocument();
    expect(container.textContent).not.toContain("leemo:");
  });

  it("opens the first non-empty source section when Leemo 精选 is unavailable", async () => {
    renderPage([personalSkill("pdf")]);

    expect(await screen.findByText("pdf")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /我的技能/ })).toHaveAttribute("aria-selected", "true");
  });

  it("refreshes on mount and keeps the native skills directory action live", async () => {
    const user = userEvent.setup();
    const { client, calls } = renderPage([personalSkill("pdf")]);
    await screen.findByText("pdf");
    expect(calls.some((call) => call.channel === "bridge:listSkills")).toBe(true);
    await user.click(screen.getByRole("button", { name: "打开技能目录" }));
    await waitFor(() => expect(client.invoke).toHaveBeenCalledWith("bridge:openSkillsDir", undefined));
  });

  it("toggles a skill for momo without turning cards into fake invocation buttons", async () => {
    const user = userEvent.setup();
    const { container } = renderPage([personalSkill("pdf")]);
    const toggle = await screen.findByLabelText("让 momo 用 pdf");
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(container.textContent).not.toContain("卡片点击");
  });

  it("disables unavailable skills and explains the real missing dependency", async () => {
    renderPage([builtin("pdf-deep-reading", "PDF 深读", "learning", true, false, ["document-read"])]);
    const toggle = await screen.findByLabelText("让 momo 用 PDF 深读");
    expect(toggle).toBeDisabled();
    expect(screen.getByText("本地组件未就绪")).toBeInTheDocument();
  });
});

describe("SkillsPage — product-facing sections", () => {
  const catalog = [
    builtin("daily-plan", "每日计划", "learning", true),
    builtin("resume-review", "简历诊断", "career", true),
    communitySkill("grill-me"),
    personalSkill("我的校招流程"),
  ];

  it("uses Leemo 精选 / 社区可信 / 我的技能 as the primary mental model", async () => {
    const user = userEvent.setup();
    renderPage(catalog);

    expect(await screen.findByText("每日计划")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Leemo 精选/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("grill-me")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /社区可信/ }));
    expect(screen.getByText("grill-me")).toBeInTheDocument();
    expect(screen.queryByText("每日计划")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /我的技能/ }));
    expect(screen.getByText("我的校招流程")).toBeInTheDocument();
  });

  it("keeps cards compact: name, source, and one purpose description", async () => {
    const user = userEvent.setup();
    renderPage(catalog);
    await user.click(await screen.findByRole("tab", { name: /社区可信/ }));
    expect(screen.getByText("grill-me 的社区用途说明")).toBeInTheDocument();
    expect(screen.getByText("社区精选")).toBeInTheDocument();
    expect(screen.queryByText(/提交版本|静态分析文件|qualified/)).not.toBeInTheDocument();
  });

  it("shows the real bundled source instead of relabeling every Skill as Leemo", async () => {
    const anthropic = builtin("bundled:frontend-design", "frontend-design", "design", true);
    anthropic.sourceLabel = "Anthropic 官方";
    const community = builtin("bundled:baoyu-format-markdown", "baoyu-format-markdown", "productivity");
    community.sourceLabel = "社区精选";

    renderPage([anthropic, community]);

    expect(await screen.findByText("Anthropic 官方")).toBeInTheDocument();
    expect(screen.getByText("社区精选")).toBeInTheDocument();
  });

  it("keeps learning and career as useful filters while accepting new categories", async () => {
    const user = userEvent.setup();
    const publishing = builtin("publish", "公众号发布", "social-publishing", true);
    publishing.categoryLabel = "内容发布";
    renderPage([...catalog, publishing]);

    expect(await screen.findByRole("button", { name: /学习/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /求职/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /内容发布/ })).toBeInTheDocument();
    expect(screen.getByLabelText("技能分类")).toHaveClass("flex-wrap");

    await user.click(screen.getByRole("button", { name: /求职/ }));
    expect(screen.getByText("简历诊断")).toBeInTheDocument();
    expect(screen.queryByText("每日计划")).not.toBeInTheDocument();
    expect(screen.queryByText("公众号发布")).not.toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "搜索技能" }), "简历");
    expect(screen.getByText("简历诊断")).toBeInTheDocument();
  });

  it("shows pre-reviewed catalog skills and installs one without asking for a link", async () => {
    const user = userEvent.setup();
    const { client } = makeClient([builtin("daily-plan", "每日计划", "learning", true)], [catalogEntry()]);
    render(
      <BridgeProvider client={client} live>
        <SkillsPage />
      </BridgeProvider>,
    );

    await user.click(await screen.findByRole("tab", { name: /社区可信/ }));
    expect(screen.getByText("grill-me")).toBeInTheDocument();
    expect(screen.getByText("用连续追问检验方案是否真的站得住。")).toBeInTheDocument();
    expect(screen.getByText(/GitHub/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看 grill-me 来源" })).toHaveAttribute(
      "href",
      "https://github.com/mattpocock/skills/tree/abc123/skills/productivity/grilling",
    );

    await user.click(screen.getByRole("button", { name: "安装 grill-me" }));
    await waitFor(() => expect(client.invoke).toHaveBeenCalledWith("bridge:installCommunitySkill", { id: "grill-me" }));
    expect(await screen.findByText("已安装 grill-me")).toBeInTheDocument();
    expect(screen.getByLabelText("让 momo 用 grill-me")).toBeChecked();
  });

  it("derives new category filters from catalog metadata instead of a closed list", async () => {
    const user = userEvent.setup();
    const publishing = catalogEntry({
      id: "publish",
      name: "公众号发布",
      category: "social-publishing",
      categoryLabel: "内容发布",
    });
    const { client } = makeClient([builtin("daily-plan", "每日计划", "learning", true)], [catalogEntry(), publishing]);
    render(
      <BridgeProvider client={client} live>
        <SkillsPage />
      </BridgeProvider>,
    );

    await user.click(await screen.findByRole("tab", { name: /社区可信/ }));
    expect(screen.getByRole("button", { name: /内容发布/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /内容发布/ }));
    expect(screen.getByText("公众号发布")).toBeInTheDocument();
    expect(screen.queryByText("grill-me")).not.toBeInTheDocument();
  });

  it("lets the user scan an installed skill without disabling or removing it", async () => {
    const user = userEvent.setup();
    const { client } = renderPage([personalSkill("demo", "Demo", true)]);
    await user.click(await screen.findByRole("tab", { name: /我的技能/ }));

    await user.click(screen.getByRole("button", { name: "扫描 demo" }));

    await waitFor(() => expect(client.invoke).toHaveBeenCalledWith("bridge:scanInstalledSkill", { id: "managed:demo" }));
    expect(screen.getByText(/发现 1 项需留意内容/)).toBeInTheDocument();
    expect(screen.getByLabelText("让 momo 用 demo")).toBeChecked();
    expect(screen.getByText("demo")).toBeInTheDocument();
  });

  it("also exposes scanning for a Skill the user copied into the skills folder", async () => {
    const user = userEvent.setup();
    const { client } = renderPage([personalSkill("manual")]);
    await user.click(await screen.findByRole("tab", { name: /我的技能/ }));

    await user.click(screen.getByRole("button", { name: "扫描 manual" }));

    await waitFor(() => expect(client.invoke).toHaveBeenCalledWith("bridge:scanInstalledSkill", { id: "custom:leemo:manual" }));
    expect(screen.getByText(/发现 1 项需留意内容/)).toBeInTheDocument();
    expect(screen.getByLabelText("让 momo 用 manual")).toBeChecked();
    expect(screen.queryByRole("button", { name: "移除 manual" })).not.toBeInTheDocument();
  });
});

describe("SkillsPage — install and remove journey", () => {
  it("reads a pasted GitHub link without forcing a scan, then installs with a light receipt", async () => {
    const user = userEvent.setup();
    renderPage([builtin("daily-plan", "每日计划", "learning", true)]);

    await user.click(await screen.findByRole("button", { name: "添加技能" }));
    const source = screen.getByRole("textbox", { name: "Skill 来源" });
    await user.type(source, "https://github.com/community/skills/tree/main/demo");
    await user.click(screen.getByRole("button", { name: "读取来源" }));

    expect(await screen.findByText("把网页内容整理成干净 Markdown。")).toBeInTheDocument();
    expect(screen.getByText("community/skills")).toBeInTheDocument();
    expect(screen.getByText("MIT")).toBeInTheDocument();
    expect(screen.getByText("尚未扫描")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "安装 demo" }));
    expect(await screen.findByText("已安装 demo · 来源 community-author · 未扫描")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "添加技能" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /我的技能/ }));
    expect(screen.getByText("demo")).toBeInTheDocument();
  });

  it("supports a native ZIP picker and reads the package without scanning it", async () => {
    const user = userEvent.setup();
    const { client } = renderPage([builtin("daily-plan", "每日计划", "learning", true)]);
    await user.click(await screen.findByRole("button", { name: "添加技能" }));
    await user.click(screen.getByRole("button", { name: "选择 ZIP" }));

    await waitFor(() => expect(client.invoke).toHaveBeenCalledWith("bridge:pickSkillSource", { kind: "archive" }));
    await waitFor(() => expect(client.invoke).toHaveBeenCalledWith("bridge:inspectSkillSource", {
      source: "C:\\Downloads\\demo.zip",
      securityScan: false,
    }));
    expect(await screen.findByText("尚未扫描")).toBeInTheDocument();
  });

  it("offers an explicit scan but never turns its findings into an install refusal", async () => {
    const user = userEvent.setup();
    const { client, inspection } = makeClient([builtin("daily-plan", "每日计划", "learning", true)]);
    client.invoke.mockImplementation(async (channel: string, req: unknown) => {
      if (channel === "bridge:listSkills") return [builtin("daily-plan", "每日计划", "learning", true)];
      if (channel === "bridge:listProviders") return [];
      if (channel === "bridge:listWhitelist") return [];
      if (channel === "bridge:inspectSkillSource") {
        if (!(req as { securityScan?: boolean }).securityScan) return inspection;
        return {
          ...inspection,
          candidates: [{
            ...inspection.candidates[0],
            scan: {
              status: "review",
              analyzedFiles: 2,
              analysis: "static",
              findings: [{
                rule: "credential-access",
                severity: "high",
                title: "会读取凭据",
                detail: "说明中要求读取本地凭据。",
                file: "SKILL.md",
                line: 12,
              }],
            },
          }],
        };
      }
      if (channel === "bridge:installSkill") return {
        installed: [],
        receipt: "已安装 demo · 来源 community-author · 已记录风险",
      };
      if (channel === "bridge:syncEnabledSkills") return { updatedConversations: 1 };
      return undefined;
    });
    render(
      <BridgeProvider client={client} live>
        <SkillsPage />
      </BridgeProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "添加技能" }));
    await user.type(screen.getByRole("textbox", { name: "Skill 来源" }), "https://github.com/community/skills");
    await user.click(screen.getByRole("button", { name: "读取来源" }));
    expect(await screen.findByText("尚未扫描")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "安全扫描" }));

    expect(await screen.findByText("会读取凭据")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "安装 demo" })).not.toBeDisabled();
    expect(screen.queryByRole("checkbox", { name: "我已了解这项风险" })).not.toBeInTheDocument();
  });

  it("requires a compact confirmation before removing a managed Skill", async () => {
    const user = userEvent.setup();
    renderPage([personalSkill("demo", "把网页内容整理成干净 Markdown。", true)]);
    await user.click(await screen.findByRole("tab", { name: /我的技能/ }));
    await user.click(screen.getByRole("button", { name: "移除 demo" }));
    expect(screen.getByRole("dialog", { name: "移除 demo" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认移除" }));

    expect(await screen.findByText("已卸载 demo")).toBeInTheDocument();
    expect(screen.queryByText("把网页内容整理成干净 Markdown。")).not.toBeInTheDocument();
  });
});

describe("SkillsPage — empty and error states", () => {
  it("offers the real add flow when no skills are available", async () => {
    renderPage([]);
    const empty = await screen.findByTestId("skills-empty-state");
    expect(empty).toContainElement(screen.getByRole("button", { name: "添加技能" }));
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("shows a recoverable error when the skills directory cannot be read", async () => {
    const client = {
      invoke: vi.fn(async (channel: string) => {
        if (channel === "bridge:listSkills") throw new Error("目录不可读");
        if (channel === "bridge:listProviders") return [];
        if (channel === "bridge:listWhitelist") return [];
        return undefined;
      }),
      subscribe: vi.fn(() => () => {}),
    } as unknown as BridgeClient;
    render(
      <BridgeProvider client={client} live>
        <SkillsPage />
      </BridgeProvider>,
    );

    expect(await screen.findByText("技能目录读取失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新读取" })).toBeInTheDocument();
  });
});
