import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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

const communitySkill = (name: string, category?: string, categoryLabel?: string, displayName?: string): SkillInfo => ({
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
  ...(displayName ? { displayName } : {}),
  ...(category ? { category } : {}),
  ...(categoryLabel ? { categoryLabel } : {}),
});

const SUPERPOWERS_NAMES = [
  "brainstorming",
  "dispatching-parallel-agents",
  "executing-plans",
  "finishing-a-development-branch",
  "receiving-code-review",
  "requesting-code-review",
  "subagent-driven-development",
  "systematic-debugging",
  "test-driven-development",
  "using-git-worktrees",
  "using-superpowers",
  "verification-before-completion",
  "writing-plans",
  "writing-skills",
] as const;

const superpowersSkills = (): SkillInfo[] => SUPERPOWERS_NAMES.map((name) => ({
  id: `superpowers:${name}`,
  name,
  description: `${name} 的开发方法`,
  qualifiedName: `superpowers:${name}`,
  source: "builtin",
  category: "developer",
  categoryLabel: "开发",
  defaultEnabled: false,
  available: true,
  trust: "community",
  sourceKind: "leemo",
  sourceLabel: "社区精选",
  scanStatus: "scanned",
  canRemove: false,
  canUpdate: false,
  collectionId: "superpowers",
  collectionLabel: "Superpowers 开发方法套件",
}));

const XHS_NAMES = ["xhs-auth", "xhs-content-ops", "xhs-explore", "xhs-interact", "xhs-publish"] as const;

const xhsFamilySkills = (): SkillInfo[] => XHS_NAMES.map((name) => ({
  id: `managed:${name}`,
  name,
  description: `${name} 的小红书能力`,
  qualifiedName: `leemo-community-xhs:${name}`,
  source: "user",
  category: "social-publishing",
  categoryLabel: "内容发布",
  trust: "community",
  sourceKind: "github",
  sourceLabel: "社区精选",
  scanStatus: "scanned",
  canRemove: true,
  canUpdate: false,
  collectionId: "family:xiaohongshu-toolkit",
  collectionLabel: "小红书工具组",
  collectionMemberCount: 5,
  setupRequired: true,
  setupMessage: "首次使用需先完成 Python / uv 环境与 Chrome 扩展设置。",
}));

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
  featured: true,
  installed: false,
  scanStatus: "scanned",
  ...overrides,
});

const xhsFamilyEntry = (): CommunitySkillView => catalogEntry({
  kind: "family",
  id: "xiaohongshu-toolkit",
  name: "小红书工具组",
  description: "搜索、查看、发布与互动等能力。",
  category: "social-publishing",
  categoryLabel: "内容发布",
  author: "autoclaw-cc",
  repository: "autoclaw-cc/xiaohongshu-skills",
  sourceUrl: "https://github.com/autoclaw-cc/xiaohongshu-skills",
  memberCount: 5,
  setupRequired: true,
  setupMessage: "首次使用需先完成 Python / uv 环境与 Chrome 扩展设置。",
  members: XHS_NAMES.map((name) => ({ id: name, name, description: `${name} 的小红书能力` })),
});

function makeClient(
  initial: SkillInfo[],
  initialCommunity: CommunitySkillView[] = [],
  options: { installCommunity?: (id: string) => Promise<void>; detailsMarkdown?: string } = {},
) {
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
      if (channel === "bridge:getCommunitySkillDetails") return {
        markdown: options.detailsMarkdown ?? "## 使用说明\n\n向 momo 描述需要检验的方案。",
      };
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
        await options.installCommunity?.(id);
        const entry = community.find((candidate) => candidate.id === id)!;
        list = [...list, ...(entry.kind === "family"
          ? xhsFamilySkills()
          : [communitySkill(entry.name, entry.category, entry.categoryLabel, entry.displayName)])];
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
        const target = list.find((skill) => skill.id === (req as { id: string }).id);
        list = target?.collectionId
          ? list.filter((skill) => skill.collectionId !== target.collectionId)
          : list.filter((skill) => skill.id !== (req as { id: string }).id);
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

  it("groups Superpowers once with a compact enabled count", async () => {
    renderPage(superpowersSkills());

    const group = await screen.findByRole("group", { name: "Superpowers 开发方法套件" });
    expect(screen.getAllByText("Superpowers 开发方法套件")).toHaveLength(1);
    expect(within(group).getByText("0 / 14 已启用")).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "全部启用" })).toBeInTheDocument();
    expect(within(group).getAllByRole("checkbox")).toHaveLength(14);
  });

  it("renders installed curated skills as compact designed cards instead of divider rows", async () => {
    renderPage(superpowersSkills().slice(0, 3));

    const group = await screen.findByRole("group", { name: "Superpowers 开发方法套件" });
    const cards = within(group).getAllByTestId("skill-installed-card");
    expect(cards).toHaveLength(3);
    expect(cards.every((card) => card.classList.contains("leemo-skill-card--installed"))).toBe(true);
    expect(cards.every((card) => card.classList.contains("min-h-[112px]"))).toBe(true);
  });

  it("changes the suite with one host sync while preserving individual and unrelated controls", async () => {
    const user = userEvent.setup();
    const unrelated = builtin("daily-plan", "每日计划", "learning", true);
    const { calls } = renderPage([...superpowersSkills(), unrelated]);
    const group = await screen.findByRole("group", { name: "Superpowers 开发方法套件" });
    const unrelatedToggle = screen.getByLabelText("让 momo 用 每日计划");
    expect(unrelatedToggle).toBeChecked();
    const initialSyncCount = calls.filter((call) => call.channel === "bridge:syncEnabledSkills").length;

    await user.click(within(group).getByRole("button", { name: "全部启用" }));
    expect(within(group).getAllByRole("checkbox").every((control) => (control as HTMLInputElement).checked)).toBe(true);
    expect(unrelatedToggle).toBeChecked();
    await waitFor(() => {
      expect(calls.filter((call) => call.channel === "bridge:syncEnabledSkills")).toHaveLength(initialSyncCount + 1);
    });

    await user.click(within(group).getByRole("button", { name: "全部关闭" }));
    expect(within(group).getAllByRole("checkbox").every((control) => !(control as HTMLInputElement).checked)).toBe(true);
    expect(unrelatedToggle).toBeChecked();
    await waitFor(() => {
      expect(calls.filter((call) => call.channel === "bridge:syncEnabledSkills")).toHaveLength(initialSyncCount + 2);
    });

    await user.click(within(group).getByLabelText("让 momo 用 brainstorming"));
    expect(within(group).getByLabelText("让 momo 用 brainstorming")).toBeChecked();
    expect(unrelatedToggle).toBeChecked();
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

  it("keeps the enable switch in the card footer so it does not compete with the skill name", async () => {
    renderPage(catalog);
    expect(await screen.findByText("每日计划")).toBeInTheDocument();

    expect(screen.getByRole("heading", { level: 1, name: "技能" })).toHaveClass("text-[22px]");

    const card = screen.getAllByTestId("skill-installed-card")[0];
    expect(within(card).getByText("每日计划 的明确用途说明")).toHaveClass("text-[12px]");
    const footer = within(card).getByTestId("skill-card-footer");
    expect(within(footer).getByRole("checkbox", { name: "让 momo 用 每日计划" })).toBeInTheDocument();
    expect(card.querySelector(".leemo-skill-card__icon")).toHaveAttribute("data-tone", "amber");
  });

  it("keeps the discovery surface to three compact cards per desktop row", async () => {
    const user = userEvent.setup();
    const entries = [
      catalogEntry({ id: "grill-me", name: "grill-me", displayName: "苏格拉底式追问" }),
      catalogEntry({ id: "human-writing", name: "human-writing", displayName: "自然写作" }),
      catalogEntry({ id: "pdf-reader", name: "pdf-reader", displayName: "PDF 阅读" }),
    ];
    const { client } = makeClient([], entries);
    render(
      <BridgeProvider client={client} live>
        <SkillsPage />
      </BridgeProvider>,
    );

    await user.click(await screen.findByRole("tab", { name: /社区可信/ }));
    const grid = screen.getByTestId("skills-card-grid");
    expect(grid).toHaveClass("lg:grid-cols-3");
    expect(grid.className).not.toMatch(/grid-cols-4/);
    expect(screen.getAllByTestId("skill-discovery-card")).toHaveLength(3);
    expect(screen.getAllByTestId("skill-discovery-card")[0]).toHaveClass("h-[152px]");
  });

  it("shows curated Chinese display names while search still accepts the original Skill name", async () => {
    const user = userEvent.setup();
    const localized = {
      ...catalogEntry(),
      displayName: "苏格拉底式追问",
    } as CommunitySkillView;
    const { client } = makeClient([], [localized]);
    render(
      <BridgeProvider client={client} live>
        <SkillsPage />
      </BridgeProvider>,
    );

    await user.click(await screen.findByRole("tab", { name: /社区可信/ }));
    expect(screen.getByText("苏格拉底式追问")).toBeInTheDocument();
    expect(screen.queryByText("grill-me")).not.toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "搜索技能" }), "grill-me");
    expect(screen.getByText("苏格拉底式追问")).toBeInTheDocument();
  });

  it("opens an in-page detail view with real catalog fields and keeps the list filters", async () => {
    const user = userEvent.setup();
    const entry = catalogEntry({ displayName: "苏格拉底式追问" });
    const { client } = makeClient([], [entry]);
    render(
      <BridgeProvider client={client} live>
        <SkillsPage />
      </BridgeProvider>,
    );

    await user.click(await screen.findByRole("tab", { name: /社区可信/ }));
    await user.type(screen.getByRole("searchbox", { name: "搜索技能" }), "grill-me");
    await user.click(screen.getByRole("button", { name: "查看 苏格拉底式追问 详情" }));

    const detail = screen.getByRole("region", { name: "技能详情" });
    expect(within(detail).getByRole("heading", { name: "苏格拉底式追问" })).toBeInTheDocument();
    expect(within(detail).getByRole("tab", { name: "概览" })).toHaveAttribute("aria-selected", "true");
    expect(within(detail).getByRole("heading", { name: "它能帮你做什么" })).toBeInTheDocument();
    expect(within(detail).getByRole("heading", { name: "怎么开始" })).toBeInTheDocument();
    expect(within(detail).getByRole("heading", { name: "试试这样说" })).toBeInTheDocument();

    await user.click(within(detail).getByRole("tab", { name: "使用说明" }));
    expect(await within(detail).findByRole("heading", { name: "使用说明" })).toBeInTheDocument();
    expect(within(detail).getByText("向 momo 描述需要检验的方案。")).toBeInTheDocument();

    await user.click(within(detail).getByRole("tab", { name: "来源" }));
    expect(within(detail).getByText("grill-me")).toBeInTheDocument();
    expect(within(detail).getByText("mattpocock/skills")).toBeInTheDocument();
    expect(within(detail).getByText("abc123")).toBeInTheDocument();
    expect(within(detail).getByText("已扫描")).toBeInTheDocument();
    expect(within(detail).queryByText("已审阅")).not.toBeInTheDocument();
    expect(within(detail).getByRole("link", { name: "查看来源" })).toHaveAttribute("href", entry.sourceUrl);
    await user.click(within(detail).getByRole("button", { name: "安装 苏格拉底式追问" }));
    await waitFor(() => expect(client.invoke).toHaveBeenCalledWith("bridge:installCommunitySkill", { id: "grill-me" }));
    expect(within(detail).getByText("已安装")).toBeInTheDocument();
    expect(within(detail).queryByText(/权限|示例指令|安全无风险/)).not.toBeInTheDocument();

    await user.click(within(detail).getByRole("button", { name: "返回技能列表" }));
    expect(screen.getByRole("searchbox", { name: "搜索技能" })).toHaveValue("grill-me");
  });

  it("leaves the detail view when switching source or category filters", async () => {
    const user = userEvent.setup();
    const publishing = catalogEntry({
      id: "publish",
      name: "公众号发布",
      displayName: "公众号发布",
      category: "social-publishing",
      categoryLabel: "内容发布",
    });
    const { client } = makeClient(
      [builtin("daily-plan", "每日计划", "learning", true)],
      [catalogEntry({ displayName: "苏格拉底式追问" }), publishing],
    );
    render(
      <BridgeProvider client={client} live>
        <SkillsPage />
      </BridgeProvider>,
    );

    await user.click(await screen.findByRole("tab", { name: /社区可信/ }));
    await user.click(screen.getByRole("button", { name: "查看 苏格拉底式追问 详情" }));
    expect(screen.getByRole("region", { name: "技能详情" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "查看来源 GitHub" }));
    expect(screen.queryByRole("region", { name: "技能详情" })).not.toBeInTheDocument();
    expect(screen.getByText("苏格拉底式追问")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "查看 苏格拉底式追问 详情" }));

    await user.click(screen.getByRole("tab", { name: /Leemo 精选/ }));
    expect(screen.queryByRole("region", { name: "技能详情" })).not.toBeInTheDocument();
    expect(screen.getByText("每日计划")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /社区可信/ }));
    await user.click(screen.getByRole("button", { name: "查看 苏格拉底式追问 详情" }));
    await user.click(screen.getByRole("button", { name: /内容发布/ }));
    expect(screen.queryByRole("region", { name: "技能详情" })).not.toBeInTheDocument();
    expect(screen.getByText("公众号发布")).toBeInTheDocument();
    expect(screen.queryByText("grill-me")).not.toBeInTheDocument();
  });

  it("keeps installed Skill controls available inside the detail view", async () => {
    const user = userEvent.setup();
    const installed = communitySkill("grill-me", "workbench", "通用工作台", "苏格拉底式追问");
    installed.sourceUrl = "https://github.com/mattpocock/skills";
    const { client } = makeClient([installed], [catalogEntry({ installed: true, displayName: "苏格拉底式追问" })]);
    render(
      <BridgeProvider client={client} live>
        <SkillsPage />
      </BridgeProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "查看 苏格拉底式追问 详情" }));
    const detail = screen.getByRole("region", { name: "技能详情" });
    const enabled = within(detail).getByRole("checkbox", { name: "让 momo 用 苏格拉底式追问" });
    expect(enabled).toBeChecked();
    await user.click(enabled);
    await waitFor(() => expect(client.invoke).toHaveBeenCalledWith("bridge:syncEnabledSkills", { enabledQualifiedNames: [] }));

    await user.click(within(detail).getByRole("button", { name: "打开技能目录" }));
    await waitFor(() => expect(client.invoke).toHaveBeenCalledWith("bridge:openSkillsDir", undefined));

    await user.click(within(detail).getByRole("button", { name: "移除 苏格拉底式追问" }));
    await user.click(screen.getByRole("button", { name: "确认移除" }));
    await waitFor(() => expect(client.invoke).toHaveBeenCalledWith("bridge:removeSkill", { id: "managed:grill-me" }));
    expect(screen.queryByRole("region", { name: "技能详情" })).not.toBeInTheDocument();
  });

  it("loads the real SKILL.md for an installed Leemo Skill instead of leaving Usage empty", async () => {
    const user = userEvent.setup();
    const installed = builtin("bundled:brainstorming", "需求与方案梳理", "developer");
    const { client } = makeClient([installed], [], {
      detailsMarkdown: "# 需求与方案梳理\n\n先澄清真实目标，再进入实现。",
    });
    render(
      <BridgeProvider client={client} live>
        <SkillsPage />
      </BridgeProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "查看 需求与方案梳理 详情" }));
    await user.click(screen.getByRole("tab", { name: "使用说明" }));

    expect(await screen.findByText("先澄清真实目标，再进入实现。")).toBeInTheDocument();
    expect(client.invoke).toHaveBeenCalledWith("bridge:getCommunitySkillDetails", {
      id: "bundled:brainstorming",
    });
  });

  it("hides community download cards whose runtime Skill is already bundled", async () => {
    const user = userEvent.setup();
    const bundledByCommand = {
      ...builtin("bundled:baoyu-markdown-nice", "Markdown 排版", "content"),
      commandName: "baoyu-markdown-nice",
    };
    const bundledByName = builtin("bundled:baoyu-slide-deck", "baoyu-slide-deck", "content");
    const { client } = makeClient(
      [bundledByCommand, bundledByName],
      [
        catalogEntry({ id: "baoyu-markdown-nice", name: "BAOYU-MARKDOWN-NICE", displayName: "Markdown 排版" }),
        catalogEntry({ id: "baoyu-slide-deck", name: "baoyu-slide-deck", displayName: "幻灯片视觉稿" }),
        catalogEntry({ id: "grill-me", name: "grill-me", displayName: "苏格拉底式追问" }),
      ],
    );
    render(
      <BridgeProvider client={client} live>
        <SkillsPage />
      </BridgeProvider>,
    );

    await user.click(await screen.findByRole("tab", { name: /社区可信/ }));
    expect(screen.queryByText("Markdown 排版")).not.toBeInTheDocument();
    expect(screen.queryByText("幻灯片视觉稿")).not.toBeInTheDocument();
    expect(screen.getByText("苏格拉底式追问")).toBeInTheDocument();
  });

  it("shows the real bundled source instead of relabeling every Skill as Leemo", async () => {
    const anthropic = builtin("bundled:frontend-design", "frontend-design", "design", true);
    anthropic.sourceLabel = "Anthropic 官方";
    const tencent = builtin("bundled:ima-skill", "ima-skill", "integration");
    tencent.sourceLabel = "腾讯官方";

    renderPage([anthropic, tencent]);

    expect(await screen.findByText("Anthropic 官方")).toBeInTheDocument();
    expect(screen.getByText("腾讯官方")).toBeInTheDocument();
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

  it("shows one compact installing state, then enables a pre-reviewed catalog skill", async () => {
    const user = userEvent.setup();
    let finishInstall!: () => void;
    const installGate = new Promise<void>((resolve) => {
      finishInstall = resolve;
    });
    const { client } = makeClient(
      [builtin("daily-plan", "每日计划", "learning", true)],
      [catalogEntry()],
      { installCommunity: async () => installGate },
    );
    render(
      <BridgeProvider client={client} live>
        <SkillsPage />
      </BridgeProvider>,
    );

    await user.click(await screen.findByRole("tab", { name: /社区可信/ }));
    expect(screen.getByText("grill-me")).toBeInTheDocument();
    expect(screen.getByText("用连续追问检验方案是否真的站得住。")).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看 grill-me 来源" })).toHaveAttribute(
      "href",
      "https://github.com/mattpocock/skills/tree/abc123/skills/productivity/grilling",
    );

    const install = screen.getByRole("button", { name: "安装 grill-me" });
    await user.click(install);
    await waitFor(() => expect(client.invoke).toHaveBeenCalledWith("bridge:installCommunitySkill", { id: "grill-me" }));
    expect(install).toBeDisabled();
    expect(install.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    finishInstall();
    expect(await screen.findByText("已安装 grill-me")).toBeInTheDocument();
    expect(screen.getByLabelText("让 momo 用 grill-me")).toBeChecked();
  });

  it("keeps a failed community install available with a short retry message", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    let finishRetry!: () => void;
    const retryGate = new Promise<void>((resolve) => {
      finishRetry = resolve;
    });
    const { client } = makeClient(
      [builtin("daily-plan", "每日计划", "learning", true)],
      [catalogEntry()],
      {
        installCommunity: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("固定版本校验失败，已停止安装。");
          await retryGate;
        },
      },
    );
    render(
      <BridgeProvider client={client} live>
        <SkillsPage />
      </BridgeProvider>,
    );

    await user.click(await screen.findByRole("tab", { name: /社区可信/ }));
    const install = screen.getByRole("button", { name: "安装 grill-me" });
    await user.click(install);

    expect(await screen.findByRole("alert")).toHaveTextContent("固定版本校验失败，已停止安装。");
    expect(install).toBeEnabled();
    expect(screen.getByText("grill-me")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(install);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(install).toBeDisabled();

    finishRetry();
    expect(await screen.findByText("已安装 grill-me")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("让 momo 用 grill-me")).toBeChecked();
  });

  it("presents a shared-runtime Skill family as one installable product card", async () => {
    const user = userEvent.setup();
    const { client } = makeClient(
      [builtin("daily-plan", "每日计划", "learning", true)],
      [xhsFamilyEntry()],
    );
    render(
      <BridgeProvider client={client} live>
        <SkillsPage />
      </BridgeProvider>,
    );

    await user.click(await screen.findByRole("tab", { name: /社区可信/ }));

    expect(screen.getAllByRole("heading", { name: "小红书工具组" })).toHaveLength(1);
    expect(screen.getByText("包含 5 个技能")).toBeInTheDocument();
    expect(screen.getByText("首次使用需设置")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "安装整套 小红书工具组" })).toBeInTheDocument();
    for (const name of XHS_NAMES) {
      expect(screen.queryByText(name)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(`让 momo 用 ${name}`)).not.toBeInTheDocument();
    }
  });

  it("installs a Skill family once, keeps five switches, and removes only as a whole", async () => {
    const user = userEvent.setup();
    const { client } = makeClient(
      [builtin("daily-plan", "每日计划", "learning", true)],
      [xhsFamilyEntry()],
    );
    render(
      <BridgeProvider client={client} live>
        <SkillsPage />
      </BridgeProvider>,
    );

    await user.click(await screen.findByRole("tab", { name: /社区可信/ }));
    await user.click(screen.getByRole("button", { name: "安装整套 小红书工具组" }));

    await waitFor(() => expect(client.invoke).toHaveBeenCalledWith(
      "bridge:installCommunitySkill",
      { id: "xiaohongshu-toolkit" },
    ));
    expect(await screen.findByText("已安装 小红书工具组")).toBeInTheDocument();

    const group = screen.getByRole("group", { name: "小红书工具组" });
    expect(within(group).getAllByRole("checkbox")).toHaveLength(5);
    expect(within(group).getByRole("button", { name: "移除整套 小红书工具组" })).toBeInTheDocument();
    for (const name of XHS_NAMES) {
      expect(within(group).getByLabelText(`让 momo 用 ${name}`)).toBeChecked();
      expect(within(group).queryByRole("button", { name: `移除 ${name}` })).not.toBeInTheDocument();
    }

    await user.click(within(group).getByRole("button", { name: "移除整套 小红书工具组" }));
    const dialog = screen.getByRole("dialog", { name: "移除 小红书工具组" });
    expect(within(dialog).getByText(/整套及其中 5 个技能/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "确认移除整套" }));

    expect(await screen.findByText("已卸载 小红书工具组")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "小红书工具组" })).not.toBeInTheDocument();
  });

  it("shows one family-level setup note without disabling independently switchable skills", async () => {
    const user = userEvent.setup();
    renderPage(xhsFamilySkills());

    await user.click(await screen.findByRole("tab", { name: /社区可信/ }));

    const group = screen.getByRole("group", { name: "小红书工具组" });
    expect(within(group).getAllByText("首次使用需先完成 Python / uv 环境与 Chrome 扩展设置。")).toHaveLength(1);
    expect(within(group).getAllByRole("checkbox")).toHaveLength(5);
    expect(within(group).getAllByRole("checkbox").every((control) => !control.hasAttribute("disabled"))).toBe(true);
  });

  it("prioritizes a structural failure over the first-use setup note", async () => {
    const broken = xhsFamilySkills().map((skill) => ({
      ...skill,
      available: false,
      unavailableReason: "安装文件不完整，请重新安装。",
    }));
    const user = userEvent.setup();
    renderPage(broken);

    await user.click(await screen.findByRole("tab", { name: /社区可信/ }));

    const group = screen.getByRole("group", { name: "小红书工具组" });
    expect(within(group).getAllByText("安装文件不完整，请重新安装。")).toHaveLength(1);
    expect(within(group).queryByText("首次使用需先完成 Python / uv 环境与 Chrome 扩展设置。")).not.toBeInTheDocument();
    expect(within(group).getAllByRole("checkbox").every((control) => control.hasAttribute("disabled"))).toBe(true);
  });

  it("keeps the real shared failure reason for a bundled collection", async () => {
    const preparing = superpowersSkills().map((skill) => ({
      ...skill,
      available: false,
      unavailableReason: "正在准备内置技能，稍后即可使用。",
    }));
    renderPage(preparing);

    const group = await screen.findByRole("group", { name: "Superpowers 开发方法套件" });
    expect(within(group).getAllByText("正在准备内置技能，稍后即可使用。")).toHaveLength(1);
    expect(within(group).queryByText("需要完成设置")).not.toBeInTheDocument();
  });

  it("does not hide a member fallback when unavailable reasons differ", async () => {
    const mixed = xhsFamilySkills().map((skill, index) => ({
      ...skill,
      available: false,
      ...(index === 0 ? {} : { unavailableReason: "需要完成设置" }),
    }));
    const user = userEvent.setup();
    renderPage(mixed);
    await user.click(await screen.findByRole("tab", { name: /社区可信/ }));

    const group = screen.getByRole("group", { name: "小红书工具组" });
    expect(within(group).getByText("暂时不可用")).toBeInTheDocument();
    expect(within(group).getAllByText("需要完成设置")).toHaveLength(4);
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

  it("opens community discovery on curated recommendations and can reveal the full catalog", async () => {
    const user = userEvent.setup();
    const specialized = catalogEntry({
      id: "obsidian-bases",
      name: "obsidian-bases",
      description: "创建和维护 Obsidian 数据视图。",
      category: "knowledge",
      categoryLabel: "知识管理",
      featured: false,
    });
    const { client } = makeClient(
      [builtin("daily-plan", "每日计划", "learning", true)],
      [specialized, catalogEntry()],
    );
    render(
      <BridgeProvider client={client} live>
        <SkillsPage />
      </BridgeProvider>,
    );

    await user.click(await screen.findByRole("tab", { name: /社区可信/ }));
    expect(screen.getByRole("button", { name: /精选推荐/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("grill-me")).toBeInTheDocument();
    expect(screen.queryByText("obsidian-bases")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /全部技能/ }));
    expect(screen.getByText("obsidian-bases")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "grill-me",
      "obsidian-bases",
    ]);
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
