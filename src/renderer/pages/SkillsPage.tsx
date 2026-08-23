import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  AlertCircle,
  Archive,
  BadgeCheck,
  Blocks,
  BookOpen,
  Briefcase,
  Check,
  CheckCircle2,
  Code2,
  Compass,
  Download,
  ExternalLink,
  Folder,
  FolderCog,
  FolderOpen,
  GitBranch,
  Library,
  Lightbulb,
  Loader2,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import type {
  CommunitySkillView,
  SkillInfo,
  SkillMutationItem,
  SkillRequirement,
  SkillSourceCandidateView,
  SkillSourceInspectionView,
} from "../../bridge/contract";
import { useBridgeClient, useSkills } from "../bridge/context";
import MarkdownContent from "../components/MarkdownContent";
import "./SkillsPage.css";

type SkillSection = "leemo" | "community" | "personal";
type CommunityCollection = "featured" | "all";
type SkillDetailTarget =
  | { kind: "installed"; skill: SkillInfo }
  | { kind: "community"; skill: CommunitySkillView };

type FilterableSkill = Pick<SkillInfo, "id" | "name" | "displayName" | "commandName" | "description" | "category" | "categoryLabel"> & {
  sourceLabel?: string;
  author?: string;
};

const SECTIONS: { id: SkillSection; label: string }[] = [
  { id: "leemo", label: "Leemo 精选" },
  { id: "community", label: "社区可信" },
  { id: "personal", label: "我的技能" },
];

const REQUIREMENT_LABELS: Partial<Record<SkillRequirement, string>> = {
  filesystem: "本地文件",
  "web-search": "联网",
  "academic-search": "论文检索",
  "document-read": "读取文档",
  "document-create": "创建文档",
};

function skillKey(skill: SkillInfo): string {
  return skill.id ?? skill.name;
}

function sectionFor(skill: SkillInfo): SkillSection {
  if (skill.source === "builtin" || skill.trust === "leemo") return "leemo";
  if (skill.trust === "community") return "community";
  return "personal";
}

function matchesQuery(skill: FilterableSkill, query: string): boolean {
  if (!query) return true;
  return `${skill.displayName ?? ""} ${skill.name} ${skill.commandName ?? ""} ${skill.id ?? ""} ${skill.description} ${skill.sourceLabel ?? skill.author ?? ""}`.toLocaleLowerCase().includes(query);
}

function skillDisplayName(skill: Pick<SkillInfo, "name" | "displayName">): string {
  return skill.displayName?.trim() || skill.name;
}

function skillRuntimeName(skill: Pick<SkillInfo, "name" | "commandName">): string {
  return (skill.commandName?.trim() || skill.name.trim()).toLocaleLowerCase();
}

function sourceBadge(skill: SkillInfo): string {
  if (skill.sourceLabel) return skill.sourceLabel;
  if (skill.source === "builtin" || skill.trust === "leemo") return "Leemo 内置";
  if (skill.trust === "community") return "社区精选";
  switch (skill.sourceKind) {
    case "github": return "GitHub";
    case "skillsh": return "skill.sh";
    case "local-archive": return "本地 ZIP";
    case "local-folder":
    case "manual": return "本地";
    default: return "我的技能";
  }
}

export default function SkillsPage() {
  const bridgeClient = useBridgeClient();
  const list = useSkills((state) => state.list);
  const community = useSkills((state) => state.community);
  const disabled = useSkills((state) => state.disabled);
  const status = useSkills((state) => state.status);
  const error = useSkills((state) => state.error);
  const adminStatus = useSkills((state) => state.adminStatus);
  const adminError = useSkills((state) => state.adminError);
  const inspection = useSkills((state) => state.inspection);
  const inspectedSource = useSkills((state) => state.inspectedSource);
  const receipt = useSkills((state) => state.receipt);
  const scanResult = useSkills((state) => state.scanResult);
  const refresh = useSkills((state) => state.refresh);
  const toggle = useSkills((state) => state.toggle);
  const setCollectionEnabled = useSkills((state) => state.setCollectionEnabled);
  const openDir = useSkills((state) => state.openDir);
  const pickSource = useSkills((state) => state.pickSource);
  const inspectSource = useSkills((state) => state.inspectSource);
  const installSource = useSkills((state) => state.installSource);
  const installCommunity = useSkills((state) => state.installCommunity);
  const scanInstalled = useSkills((state) => state.scanInstalled);
  const removeSkill = useSkills((state) => state.removeSkill);
  const clearAdminFeedback = useSkills((state) => state.clearAdminFeedback);
  const [section, setSection] = useState<SkillSection>("leemo");
  const [communityCollection, setCommunityCollection] = useState<CommunityCollection>("featured");
  const [sectionInitialized, setSectionInitialized] = useState(false);
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [installOpen, setInstallOpen] = useState(false);
  const [sourceInput, setSourceInput] = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState<string>();
  const [removeTarget, setRemoveTarget] = useState<SkillInfo>();
  const [installingCommunityId, setInstallingCommunityId] = useState<string>();
  const [detailTarget, setDetailTarget] = useState<SkillDetailTarget>();
  const [detailMarkdown, setDetailMarkdown] = useState<string>();
  const [detailMarkdownStatus, setDetailMarkdownStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const bundledRuntimeNames = useMemo(
    () => new Set(list.map(skillRuntimeName)),
    [list],
  );
  const installableCommunity = useMemo(
    () => community.filter((skill) => (
      !skill.installed
      && !bundledRuntimeNames.has(skill.name.trim().toLocaleLowerCase())
    )),
    [bundledRuntimeNames, community],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (sectionInitialized || status !== "ready" || (list.length === 0 && community.length === 0)) return;
    const firstPopulated = SECTIONS.find((item) => (
      list.some((skill) => sectionFor(skill) === item.id)
      || (item.id === "community" && installableCommunity.length > 0)
    ));
    if (firstPopulated) setSection(firstPopulated.id);
    setSectionInitialized(true);
  }, [community.length, installableCommunity.length, list, sectionInitialized, status]);

  useEffect(() => {
    if (!installOpen && !removeTarget) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || adminStatus === "installing" || adminStatus === "removing" || adminStatus === "scanning") return;
      if (removeTarget) setRemoveTarget(undefined);
      else setInstallOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [adminStatus, installOpen, removeTarget]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const sectionCounts = useMemo(() => ({
    leemo: list.filter((skill) => sectionFor(skill) === "leemo").length,
    community: list.filter((skill) => sectionFor(skill) === "community").length
      + installableCommunity.length,
    personal: list.filter((skill) => sectionFor(skill) === "personal").length,
  }), [installableCommunity.length, list]);
  const sectionSkills = useMemo(
    () => list.filter((skill) => sectionFor(skill) === section),
    [list, section],
  );
  const catalogSkills = useMemo(
    () => section === "community"
      ? [...installableCommunity]
        .sort((left, right) => Number(right.featured) - Number(left.featured))
      : [],
    [installableCommunity, section],
  );
  const filterItems = useMemo<FilterableSkill[]>(
    () => [...sectionSkills, ...catalogSkills],
    [catalogSkills, sectionSkills],
  );
  const categories = useMemo(() => categoryOptions(filterItems), [filterItems]);
  const visibleInstalled = useMemo(() => sectionSkills.filter((skill) => (
    (category === "all" || categoryId(skill) === category)
    && matchesQuery(skill, normalizedQuery)
  )), [category, normalizedQuery, sectionSkills]);
  const visibleCatalog = useMemo(() => catalogSkills.filter((skill) => (
    (communityCollection === "all" || skill.featured)
    &&
    (category === "all" || categoryId(skill) === category)
    && matchesQuery(skill, normalizedQuery)
  )), [catalogSkills, category, communityCollection, normalizedQuery]);
  const collections = useMemo(() => {
    const grouped = new Map<string, { id: string; label: string; members: SkillInfo[] }>();
    for (const skill of sectionSkills) {
      if (!skill.collectionId || !skill.collectionLabel) continue;
      const current = grouped.get(skill.collectionId);
      if (current) current.members.push(skill);
      else grouped.set(skill.collectionId, {
        id: skill.collectionId,
        label: skill.collectionLabel,
        members: [skill],
      });
    }
    return [...grouped.values()];
  }, [sectionSkills]);
  const visibleCollections = useMemo(() => collections
    .map((collection) => ({
      ...collection,
      visibleMembers: visibleInstalled.filter((skill) => skill.collectionId === collection.id),
    }))
    .filter((collection) => collection.visibleMembers.length > 0), [collections, visibleInstalled]);
  const groupedCollectionIds = useMemo(
    () => new Set(collections.map((collection) => collection.id)),
    [collections],
  );
  const visibleUngrouped = useMemo(
    () => visibleInstalled.filter((skill) => !skill.collectionId || !groupedCollectionIds.has(skill.collectionId)),
    [groupedCollectionIds, visibleInstalled],
  );
  const hasAny = list.length > 0 || community.length > 0;
  const availableCount = list.filter((skill) => skill.available !== false).length;
  const enabledCount = list.filter(
    (skill) => skill.available !== false && !disabled.includes(skillKey(skill)),
  ).length;
  const resolvedDetailTarget = useMemo<SkillDetailTarget | undefined>(() => {
    if (!detailTarget) return undefined;
    if (detailTarget.kind === "community") {
      return {
        kind: "community",
        skill: community.find((skill) => skill.id === detailTarget.skill.id) ?? detailTarget.skill,
      };
    }
    return {
      kind: "installed",
      skill: list.find((skill) => skillKey(skill) === skillKey(detailTarget.skill)) ?? detailTarget.skill,
    };
  }, [community, detailTarget, list]);
  const detailInstalledSkill = useMemo(() => {
    if (!resolvedDetailTarget) return undefined;
    if (resolvedDetailTarget.kind === "installed") return resolvedDetailTarget.skill;
    return list.find((skill) => skillRuntimeName(skill) === resolvedDetailTarget.skill.name.trim().toLocaleLowerCase());
  }, [list, resolvedDetailTarget]);
  const detailDocumentId = useMemo(() => {
    if (!resolvedDetailTarget) return undefined;
    if (resolvedDetailTarget.kind === "community") return resolvedDetailTarget.skill.id;
    const runtimeName = skillRuntimeName(resolvedDetailTarget.skill);
    return community.find((skill) => (
      skill.id === resolvedDetailTarget.skill.id
      || skill.name.trim().toLocaleLowerCase() === runtimeName
    ))?.id ?? resolvedDetailTarget.skill.id ?? resolvedDetailTarget.skill.qualifiedName;
  }, [community, resolvedDetailTarget]);

  useEffect(() => {
    let active = true;
    setDetailMarkdown(undefined);
    if (!bridgeClient || !detailDocumentId) {
      setDetailMarkdownStatus("idle");
      return () => { active = false; };
    }
    setDetailMarkdownStatus("loading");
    void bridgeClient.invoke("bridge:getCommunitySkillDetails", { id: detailDocumentId })
      .then((result) => {
        if (!active) return;
        setDetailMarkdown(result.markdown);
        setDetailMarkdownStatus("ready");
      })
      .catch(() => {
        if (active) setDetailMarkdownStatus("error");
      });
    return () => { active = false; };
  }, [bridgeClient, detailDocumentId]);

  useEffect(() => {
    if (category === "all" || categories.some((item) => item.id === category)) return;
    setCategory("all");
  }, [categories, category]);

  const openInstaller = () => {
    clearAdminFeedback();
    setSourceInput("");
    setSelectedCandidate(undefined);
    setInstallOpen(true);
  };

  const closeInstaller = () => {
    if (adminStatus === "installing") return;
    setInstallOpen(false);
    clearAdminFeedback();
  };

  const renderSkillRow = (
    skill: SkillInfo,
    options: { showRemove?: boolean; showAvailabilityReason?: boolean } = {},
  ) => (
    <SkillRow
      key={skill.qualifiedName}
      skill={skill}
      enabled={skill.available !== false && !disabled.includes(skillKey(skill))}
      onToggle={toggle}
      onRemove={setRemoveTarget}
      showRemove={options.showRemove}
      showAvailabilityReason={options.showAvailabilityReason}
      scanBusy={adminStatus === "scanning"}
      onScan={skill.source === "user" ? (id) => void scanInstalled(id) : undefined}
      onOpenDetail={() => setDetailTarget({ kind: "installed", skill })}
    />
  );

  return (
    <div className="leemo-page">
      <header className="leemo-page-header">
        <div className="leemo-page-frame">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0">
              <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--leemo-ink)]">技能</h1>
              {status === "ready" && (
                <div className="mt-1 flex items-center gap-2 text-[11px] tabular-nums text-[var(--leemo-ink-3)]">
                  <span>{enabledCount} 个已启用</span>
                  <span aria-hidden className="h-3 w-px bg-[var(--leemo-line)]" />
                  <span>{availableCount} 个可用</span>
                </div>
              )}
            </div>
            {hasAny && (
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  aria-label="打开技能目录"
                  title="打开技能目录"
                  onClick={() => void openDir()}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] border border-[var(--leemo-line)] bg-[var(--leemo-bg)] text-[var(--leemo-ink-2)] transition-colors hover:bg-[var(--leemo-side-hover)]"
                >
                  <FolderOpen className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={openInstaller}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] bg-[var(--leemo-ink)] px-3 text-xs font-medium text-white transition-colors hover:bg-black"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  添加技能
                </button>
              </div>
            )}
          </div>

          {status === "ready" && hasAny && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div
                role="tablist"
                aria-label="技能来源"
                className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-[6px] bg-[var(--leemo-side)] p-0.5"
              >
                {SECTIONS.map((item) => {
                  const selected = item.id === section;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                       onClick={() => {
                         setDetailTarget(undefined);
                         setSection(item.id);
                         setCategory("all");
                        if (item.id === "community") setCommunityCollection("featured");
                      }}
                      className={`flex h-7 shrink-0 items-center gap-1.5 rounded-[5px] px-2.5 text-[11.5px] transition-colors ${
                        selected
                          ? "bg-[var(--leemo-bg)] font-medium text-[var(--leemo-ink)] shadow-sm ring-1 ring-[var(--leemo-line)]"
                          : "text-[var(--leemo-ink-3)] hover:text-[var(--leemo-ink-2)]"
                      }`}
                    >
                      {item.label}
                      <span className="text-[10px] tabular-nums opacity-70">{sectionCounts[item.id]}</span>
                    </button>
                  );
                })}
              </div>
              <label className="relative ml-auto min-w-[190px] flex-1 sm:max-w-[260px]">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--leemo-ink-3)]"
                  aria-hidden
                />
                <input
                  type="search"
                  aria-label="搜索技能"
                  placeholder="搜索当前分区"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    if (section === "community" && event.target.value.trim()) setCommunityCollection("all");
                  }}
                  className="h-8 w-full rounded-[6px] border border-[var(--leemo-line)] bg-[var(--leemo-bg)] pl-8 pr-3 text-xs text-[var(--leemo-ink)] outline-none placeholder:text-[var(--leemo-ink-3)] focus:border-[var(--leemo-amber)]"
                />
              </label>
            </div>
          )}

          {status === "ready" && hasAny && categories.length > 1 && (
            <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-0.5" aria-label="技能分类">
              <Tags className="mr-1 h-3.5 w-3.5 shrink-0 text-[var(--leemo-ink-3)]" aria-hidden />
              {[{ id: "all", label: "全部", count: filterItems.length }, ...categories].map((item) => {
                const selected = category === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={selected}
                     onClick={() => {
                       setDetailTarget(undefined);
                       setCategory(item.id);
                      if (section === "community" && item.id !== "all") setCommunityCollection("all");
                    }}
                    className={`h-7 shrink-0 rounded-[5px] px-2 text-[11px] transition-colors ${selected
                      ? "bg-[var(--leemo-amber-soft)] font-medium text-[var(--leemo-amber-strong)]"
                      : "text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink-2)]"
                    }`}
                  >
                    {item.label} <span className="tabular-nums opacity-65">{item.count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </header>

      <div className="leemo-page-scroll">
        <div className="leemo-page-frame">
          {resolvedDetailTarget ? (
            <SkillDetailView
              target={resolvedDetailTarget}
              detailMarkdown={detailMarkdown}
              detailMarkdownStatus={detailMarkdownStatus}
              installedSkill={detailInstalledSkill}
              enabled={Boolean(detailInstalledSkill && detailInstalledSkill.available !== false && !disabled.includes(skillKey(detailInstalledSkill)))}
              installing={installingCommunityId === resolvedDetailTarget.skill.id}
              installDisabled={adminStatus === "installing"}
              onBack={() => setDetailTarget(undefined)}
              onOpenSource={() => {
                const sourceSection = resolvedDetailTarget.kind === "community"
                  ? "community"
                  : sectionFor(resolvedDetailTarget.skill);
                setDetailTarget(undefined);
                setSection(sourceSection);
                setCategory("all");
                if (sourceSection === "community") setCommunityCollection("all");
              }}
              onOpenCategory={() => {
                setDetailTarget(undefined);
                setCategory(categoryId(resolvedDetailTarget.skill));
                if (resolvedDetailTarget.kind === "community") {
                  setSection("community");
                  setCommunityCollection("all");
                }
              }}
              onInstall={async () => {
                if (resolvedDetailTarget.kind !== "community") return;
                setInstallingCommunityId(resolvedDetailTarget.skill.id);
                try {
                  await installCommunity(resolvedDetailTarget.skill.id);
                } finally {
                  setInstallingCommunityId(undefined);
                }
              }}
              onToggle={detailInstalledSkill ? () => toggle(skillKey(detailInstalledSkill)) : undefined}
              onRemove={detailInstalledSkill?.canRemove ? () => setRemoveTarget(detailInstalledSkill) : undefined}
              onOpenDir={() => void openDir()}
            />
          ) : (
            <>
          {receipt && (
            <div className="mb-4 flex min-h-8 items-center gap-2 border-b border-[var(--leemo-line-soft)] pb-3 text-xs text-[var(--leemo-ok)]">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{receipt}</span>
              <button
                type="button"
                aria-label="关闭回执"
                title="关闭"
                onClick={clearAdminFeedback}
                className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-[5px] text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-side-hover)]"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          )}

          {adminError && !installOpen && !removeTarget && (
            <div role="alert" className="mb-4 flex items-center gap-2 rounded-[6px] bg-[var(--leemo-danger-soft)] px-3 py-2 text-xs text-[var(--leemo-danger)]">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {adminError}
            </div>
          )}

          {status === "ready" && hasAny && section === "community" && (
            <CommunityMarketIntro
              collection={communityCollection}
              featuredCount={catalogSkills.filter((skill) => skill.featured).length}
              totalCount={catalogSkills.length}
              onChange={(next) => {
                setCommunityCollection(next);
                setCategory("all");
              }}
            />
          )}

          {status === "loading" ? (
            <div role="status" className="flex items-center gap-2 py-8 text-sm text-[var(--leemo-ink-3)]">
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
              正在读取技能
            </div>
          ) : status === "error" ? (
            <div className="flex items-start gap-3 border-y border-[var(--leemo-line)] py-5">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--leemo-danger)]" aria-hidden />
              <div>
                <p className="text-sm font-medium text-[var(--leemo-ink)]">技能目录读取失败</p>
                <p className="mt-1 text-xs text-[var(--leemo-ink-3)]">{error}</p>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--leemo-line)] px-2.5 text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)]"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  重新读取
                </button>
              </div>
            </div>
          ) : !hasAny ? (
            <EmptyCatalog onAdd={openInstaller} />
          ) : (
            <>
              {error && (
                <div role="alert" className="mb-4 flex items-center gap-2 rounded-[6px] bg-[var(--leemo-danger-soft)] px-3 py-2 text-xs text-[var(--leemo-danger)]">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {error}
                </div>
              )}
              {visibleInstalled.length === 0 && visibleCatalog.length === 0 ? (
                <SectionEmpty section={section} hasQuery={Boolean(normalizedQuery)} onAdd={openInstaller} />
              ) : (
                <div className="space-y-6 pb-5">
                  {visibleCatalog.length > 0 && (
                    <section aria-label="可安装的社区技能">
                      <div data-testid="skills-card-grid" className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                        {visibleCatalog.map((skill) => (
                          <CommunitySkillCard
                            key={`catalog:${skill.id}`}
                            skill={skill}
                            installing={installingCommunityId === skill.id}
                            installDisabled={adminStatus === "installing"}
                            onOpenDetail={() => setDetailTarget({ kind: "community", skill })}
                            onInstall={async () => {
                              setInstallingCommunityId(skill.id);
                              try {
                                await installCommunity(skill.id);
                              } finally {
                                setInstallingCommunityId(undefined);
                              }
                            }}
                          />
                        ))}
                      </div>
                    </section>
                  )}
                  {visibleInstalled.length > 0 && (
                    <section aria-label={section === "community" ? "已安装的社区技能" : "已安装技能"}>
                      {section === "community" && (
                        <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-[var(--leemo-ink-3)]">
                          <span>已安装</span>
                          <span className="tabular-nums text-[var(--leemo-ink-4)]">{visibleInstalled.length}</span>
                        </div>
                      )}
                      <div className="space-y-4">
                        {visibleCollections.map((collection) => {
                          const enabledMembers = collection.members.filter((skill) => (
                            skill.available !== false && !disabled.includes(skillKey(skill))
                          )).length;
                          const allEnabled = enabledMembers === collection.members.length;
                          const removableMember = collection.members.find((skill) => skill.canRemove);
                          const unavailableMembers = collection.members.filter((skill) => skill.available === false);
                          const firstUnavailableReason = unavailableMembers[0]?.unavailableReason?.trim();
                          const sharedUnavailableReason = firstUnavailableReason
                            && unavailableMembers.every((skill) => skill.unavailableReason?.trim() === firstUnavailableReason)
                            ? firstUnavailableReason
                            : undefined;
                          const setupMembers = collection.members.filter((skill) => skill.setupRequired);
                          const firstSetupMessage = setupMembers[0]?.setupMessage?.trim();
                          const sharedSetupMessage = !sharedUnavailableReason
                            && setupMembers.length === collection.members.length
                            && firstSetupMessage
                            && setupMembers.every((skill) => skill.setupMessage?.trim() === firstSetupMessage)
                            ? firstSetupMessage
                            : undefined;
                          return (
                            <div
                              key={collection.id}
                              role="group"
                              aria-label={collection.label}
                              className="leemo-skill-collection"
                            >
                              <div className="leemo-skill-collection__header flex min-h-11 items-center gap-2 px-3.5 py-2">
                                <span className="truncate text-xs font-medium text-[var(--leemo-ink)]">
                                  {collection.label}
                                </span>
                                <span className="shrink-0 text-[10.5px] tabular-nums text-[var(--leemo-ink-3)]">
                                  {enabledMembers} / {collection.members.length} 已启用
                                </span>
                                {sharedUnavailableReason && (
                                  <span
                                    title={sharedUnavailableReason}
                                    className="inline-flex min-w-0 max-w-[240px] items-center gap-1 text-[10.5px] text-[var(--leemo-danger)]"
                                  >
                                    <AlertCircle className="h-3 w-3 shrink-0" aria-hidden />
                                    <span className="truncate">{sharedUnavailableReason}</span>
                                  </span>
                                )}
                                {sharedSetupMessage && (
                                  <span
                                    title={sharedSetupMessage}
                                    className="inline-flex min-w-0 max-w-[280px] items-center gap-1 text-[10.5px] text-[var(--leemo-amber-strong)]"
                                  >
                                    <FolderCog className="h-3 w-3 shrink-0" aria-hidden />
                                    <span className="truncate">{sharedSetupMessage}</span>
                                  </span>
                                )}
                                {removableMember && (
                                  <button
                                    type="button"
                                    aria-label={`移除整套 ${collection.label}`}
                                    title="移除整套"
                                    onClick={() => setRemoveTarget(removableMember)}
                                    className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-[5px] text-[var(--leemo-ink-3)] transition-colors hover:bg-[var(--leemo-danger-soft)] hover:text-[var(--leemo-danger)]"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setCollectionEnabled(collection.id, !allEnabled)}
                                  disabled={collection.members.every((skill) => skill.available === false)}
                                  className={`${removableMember ? "" : "ml-auto"} h-7 shrink-0 rounded-[5px] px-2 text-[11px] font-medium text-[var(--leemo-amber-strong)] transition-colors hover:bg-[var(--leemo-amber-soft)] disabled:cursor-not-allowed disabled:opacity-50`}
                                >
                                  {allEnabled ? "全部关闭" : "全部启用"}
                                </button>
                              </div>
                              <div className="grid gap-2.5 p-2.5 md:grid-cols-2 lg:grid-cols-3">
                                {collection.visibleMembers.map((skill) => renderSkillRow(skill, {
                                  showRemove: false,
                                  showAvailabilityReason: !sharedUnavailableReason,
                                }))}
                              </div>
                            </div>
                          );
                        })}
                        {visibleUngrouped.length > 0 && (
                          <div className="grid gap-2.5 py-2.5 md:grid-cols-2 lg:grid-cols-3">
                            {visibleUngrouped.map((skill) => renderSkillRow(skill))}
                          </div>
                        )}
                      </div>
                    </section>
                  )}
                </div>
              )}
            </>
          )}
            </>
          )}
        </div>
      </div>

      {installOpen && (
        <InstallSkillDialog
          sourceInput={sourceInput}
          setSourceInput={setSourceInput}
          inspection={inspection}
          inspectedSource={inspectedSource}
          selectedCandidate={selectedCandidate}
          setSelectedCandidate={setSelectedCandidate}
          adminStatus={adminStatus}
          adminError={adminError}
          onClose={closeInstaller}
          onInspect={async (source, securityScan = false) => {
            const result = await inspectSource(source, securityScan);
            const previousStillExists = result?.candidates.some((candidate) => candidate.name === selectedCandidate);
            setSelectedCandidate(previousStillExists ? selectedCandidate : result?.candidates[0]?.name);
          }}
          onScan={async (source) => {
            const result = await inspectSource(source, true);
            const previousStillExists = result?.candidates.some((candidate) => candidate.name === selectedCandidate);
            setSelectedCandidate(previousStillExists ? selectedCandidate : result?.candidates[0]?.name);
          }}
          onPick={async (kind) => {
            const source = await pickSource(kind);
            if (!source) return;
            setSourceInput(source);
            const result = await inspectSource(source, false);
            setSelectedCandidate(result?.candidates[0]?.name);
          }}
          onInstall={async () => {
            if (!selectedCandidate || !inspectedSource) return;
            const installed = await installSource({
              source: inspectedSource,
              candidate: selectedCandidate,
              ...(inspection?.candidates.find((candidate) => candidate.name === selectedCandidate)?.scan
                ? { securityScan: true }
                : {}),
            });
            if (installed) setInstallOpen(false);
          }}
        />
      )}

      {removeTarget && (
        <RemoveSkillDialog
          skill={removeTarget}
          removing={adminStatus === "removing"}
          error={adminError}
          onCancel={() => {
            if (adminStatus !== "removing") {
              setRemoveTarget(undefined);
              clearAdminFeedback();
            }
          }}
          onConfirm={async () => {
            const removedSkill = removeTarget;
            const removed = await removeSkill(skillKey(removeTarget));
            if (removed) {
              setRemoveTarget(undefined);
              if (
                detailTarget?.kind === "installed"
                && (
                  skillKey(detailTarget.skill) === skillKey(removedSkill)
                  || Boolean(removedSkill.collectionId && detailTarget.skill.collectionId === removedSkill.collectionId)
                )
              ) {
                setDetailTarget(undefined);
              }
            }
          }}
        />
      )}

      {scanResult && (
        <ScanResultDisclosure result={scanResult} onClose={clearAdminFeedback} />
      )}
    </div>
  );
}

function EmptyCatalog({ onAdd }: { onAdd: () => void }) {
  return (
    <div
      data-testid="skills-empty-state"
      data-layout="compact-empty"
      data-surface-level="content"
      className="leemo-skills-empty flex flex-col items-center justify-center gap-2 text-center"
    >
      <span className="leemo-skills-empty__icon"><Blocks className="h-5 w-5" aria-hidden /></span>
      <p className="text-sm font-medium text-[var(--leemo-ink-2)]">还没有技能</p>
      <button
        type="button"
        onClick={onAdd}
        className="leemo-skills-empty__action mt-2 inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium text-white"
      >
        <Plus className="h-4 w-4" aria-hidden />
        添加技能
      </button>
    </div>
  );
}

function SectionEmpty({
  section,
  hasQuery,
  onAdd,
}: {
  section: SkillSection;
  hasQuery: boolean;
  onAdd: () => void;
}) {
  const label = hasQuery
    ? "没有匹配的技能"
    : section === "community"
      ? "还没有社区可信技能"
      : section === "personal"
        ? "还没有我的技能"
        : "Leemo 精选暂不可用";
  return (
    <div className="leemo-skills-section-empty flex min-h-36 flex-col items-center justify-center text-center">
      <p className="text-sm text-[var(--leemo-ink-3)]">{label}</p>
      {!hasQuery && section !== "leemo" && (
        <button type="button" onClick={onAdd} className="mt-3 text-xs font-medium text-[var(--leemo-amber-strong)] hover:underline">
          添加技能
        </button>
      )}
    </div>
  );
}

function CommunityMarketIntro({
  collection,
  featuredCount,
  totalCount,
  onChange,
}: {
  collection: CommunityCollection;
  featuredCount: number;
  totalCount: number;
  onChange: (collection: CommunityCollection) => void;
}) {
  return (
    <section className="mb-5 border-y border-[var(--leemo-line)] bg-[var(--leemo-panel)] px-4 py-3.5" aria-label="社区技能市场">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[7px] bg-[var(--leemo-bg)] text-[var(--leemo-amber-strong)] ring-1 ring-[var(--leemo-line-2)]">
            <Compass className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-[var(--leemo-ink)]">社区技能</h2>
            <p className="mt-0.5 text-[10.5px] leading-5 text-[var(--leemo-ink-3)]">
              固定版本并校验文件，选择后直接从原 GitHub 仓库安装。
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center rounded-[6px] bg-[var(--leemo-bg)] p-0.5 ring-1 ring-[var(--leemo-line)]">
          {([
            { id: "featured" as const, label: "精选推荐", count: featuredCount },
            { id: "all" as const, label: "全部技能", count: totalCount },
          ]).map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={collection === item.id}
              onClick={() => onChange(item.id)}
              className={`h-7 rounded-[5px] px-2.5 text-[11px] transition-colors ${collection === item.id
                ? "bg-[var(--leemo-ink)] font-medium text-white"
                : "text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink-2)]"
              }`}
            >
              {item.label} <span className="ml-0.5 tabular-nums opacity-70">{item.count}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

const CATEGORY_META: Record<string, {
  label: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}> = {
  thinking: { label: "思考与决策", Icon: Lightbulb },
  learning: { label: "学习", Icon: BookOpen },
  writing: { label: "写作", Icon: PenLine },
  career: { label: "求职", Icon: Briefcase },
  "research-office": { label: "资料与办公", Icon: Search },
  knowledge: { label: "知识管理", Icon: Library },
  workbench: { label: "通用工作台", Icon: FolderCog },
  development: { label: "开发", Icon: Code2 },
  other: { label: "其他", Icon: Blocks },
};

function categoryId(skill: FilterableSkill): string {
  return skill.category?.trim() || "other";
}

function categoryLabel(id: string, skills: readonly FilterableSkill[]): string {
  if (CATEGORY_META[id]) return CATEGORY_META[id].label;
  return skills.find((skill) => categoryId(skill) === id)?.categoryLabel?.trim() || id;
}

function categoryOptions(skills: readonly FilterableSkill[]): { id: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const skill of skills) {
    const id = categoryId(skill);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const knownOrder = ["thinking", "learning", "writing", "career", "research-office", "knowledge", "workbench", "development", "other"];
  return [...counts.keys()]
    .sort((left, right) => {
      const leftIndex = knownOrder.indexOf(left);
      const rightIndex = knownOrder.indexOf(right);
      if (leftIndex >= 0 || rightIndex >= 0) {
        return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex);
      }
      return categoryLabel(left, skills).localeCompare(categoryLabel(right, skills), "zh-CN");
    })
    .map((id) => ({ id, label: categoryLabel(id, skills), count: counts.get(id) ?? 0 }));
}

function categoryIcon(skill: SkillInfo): ComponentType<{ className?: string; "aria-hidden"?: boolean }> {
  return CATEGORY_META[categoryId(skill)]?.Icon ?? Tags;
}

type SkillIconTone = "amber" | "blue" | "green" | "plum" | "slate";

function installedSkillVisual(skill: SkillInfo): {
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  tone: SkillIconTone;
} {
  const text = `${skillDisplayName(skill)} ${skill.name} ${skill.description}`;
  if (/需求与方案|需求梳理/.test(text)) return { Icon: Lightbulb, tone: "amber" };
  if (/分任务协作/.test(text)) return { Icon: GitBranch, tone: "blue" };
  if (/并行任务|并行协作/.test(text)) return { Icon: Blocks, tone: "blue" };
  if (/按计划执行|执行计划/.test(text)) return { Icon: CheckCircle2, tone: "green" };
  if (/开发分支|分支收尾/.test(text)) return { Icon: Archive, tone: "slate" };
  if (/处理代码评审|评审意见/.test(text)) return { Icon: Code2, tone: "blue" };
  if (/发起代码评审|请求评审/.test(text)) return { Icon: ShieldCheck, tone: "green" };
  if (/系统化调试|调试/.test(text)) return { Icon: Compass, tone: "amber" };
  if (/测试驱动/.test(text)) return { Icon: CheckCircle2, tone: "plum" };
  if (/隔离开发|工作区/.test(text)) return { Icon: FolderCog, tone: "slate" };
  if (/开发流程调度|流程调度/.test(text)) return { Icon: Compass, tone: "blue" };
  if (/完成前验证|完成验证/.test(text)) return { Icon: ShieldCheck, tone: "green" };
  if (/编写实施计划/.test(text)) return { Icon: PenLine, tone: "amber" };
  if (/编写工作技能|写技能/.test(text)) return { Icon: Sparkles, tone: "plum" };
  if (/(测试|验证|评审|审查|安全)/.test(text)) return { Icon: ShieldCheck, tone: "green" };
  if (/(并行|协作|分工|子任务)/.test(text)) return { Icon: Blocks, tone: "blue" };
  if (/(分支|隔离|工作区|目录)/.test(text)) return { Icon: FolderCog, tone: "slate" };
  if (/(调试|代码|开发)/.test(text)) return { Icon: Code2, tone: "blue" };
  if (/(写作|编写|文案|表达)/.test(text)) return { Icon: PenLine, tone: "plum" };
  if (/(学习|研究|论文|阅读)/.test(text)) return { Icon: BookOpen, tone: "green" };
  if (/(求职|简历|面试)/.test(text)) return { Icon: Briefcase, tone: "slate" };
  if (/(计划|规划|需求|方案|决策)/.test(text)) return { Icon: Lightbulb, tone: "amber" };
  if (/(流程|调度|执行)/.test(text)) return { Icon: Compass, tone: "blue" };
  return { Icon: skill.category ? categoryIcon(skill) : Sparkles, tone: "slate" };
}

function CommunitySkillCard({
  skill,
  installing,
  installDisabled,
  onInstall,
  onOpenDetail,
}: {
  skill: CommunitySkillView;
  installing: boolean;
  installDisabled: boolean;
  onInstall: () => Promise<void>;
  onOpenDetail: () => void;
}) {
  const Icon = CATEGORY_META[categoryId(skill)]?.Icon ?? ShieldCheck;
  const displayName = skillDisplayName(skill);
  const family = skill.kind === "family";
  const memberCount = skill.memberCount ?? skill.members?.length;
  return (
    <article data-testid="skill-discovery-card" className="leemo-skill-card group flex h-[152px] min-w-0 flex-col overflow-hidden">
      <div className="leemo-skill-card__cap flex h-10 items-center px-2.5">
        <span className="leemo-skill-card__icon grid h-8 w-8 shrink-0 place-items-center rounded-[7px] text-[var(--leemo-amber-strong)]">
          <Icon className="h-[17px] w-[17px]" aria-hidden />
        </span>
        <span className="ml-2.5 text-[10.5px] font-medium text-[var(--leemo-ink-3)]">{skill.categoryLabel}</span>
        {skill.scanStatus === "scanned" && (
          <span className="ml-auto inline-flex items-center gap-1 text-[9.5px] text-[var(--leemo-ok)]">
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
            已扫描
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="min-w-0 truncate text-[13px] font-medium">
            <button
              type="button"
              onClick={onOpenDetail}
              aria-label={`查看 ${displayName} 详情`}
              title={skill.name !== displayName ? `原名：${skill.name}` : "查看详情"}
              className="leemo-skill-card__title max-w-full truncate text-left text-[var(--leemo-ink)]"
            >
              {displayName}
            </button>
          </h3>
          <span className="shrink-0 rounded-[4px] bg-[var(--leemo-side)] px-1.5 py-0.5 text-[9.5px] text-[var(--leemo-ink-3)]">GitHub</span>
          <a
            href={skill.sourceUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`查看 ${displayName} 来源`}
            title={skill.name !== displayName ? `查看 GitHub 来源 · 原名：${skill.name}` : "查看 GitHub 来源"}
            className="grid h-5 w-5 shrink-0 place-items-center rounded-[4px] text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink-2)]"
          >
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </div>
        <p className="mt-1 line-clamp-2 text-[11px] leading-[1.45] text-[var(--leemo-ink-3)]">{skill.description}</p>
        {(family || skill.setupRequired) && (
          <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] leading-4">
            {family && memberCount !== undefined && (
              <span className="shrink-0 font-medium text-[var(--leemo-ink-2)]">包含 {memberCount} 个技能</span>
            )}
            {skill.setupRequired && (
              <span
                title={skill.setupMessage ?? "首次使用需完成设置"}
                className="inline-flex min-w-0 items-center gap-1 text-[var(--leemo-amber-strong)]"
              >
                <FolderCog className="h-3 w-3 shrink-0" aria-hidden />
                <span className="truncate">首次使用需设置</span>
              </span>
            )}
          </div>
        )}
        <div className="mt-auto flex items-end gap-2 pt-1.5">
          <p className="min-w-0 flex-1 truncate text-[10px] text-[var(--leemo-ink-4)]">{skill.author} · {skill.license}</p>
          <button
            type="button"
            aria-label={`${family ? "安装整套" : "安装"} ${displayName}`}
            title="从 GitHub 下载固定版本并安装"
            onClick={() => void onInstall()}
            disabled={installDisabled}
            className="leemo-skill-card__install inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] px-2.5 text-[10.5px] font-medium text-white disabled:cursor-wait disabled:opacity-50"
          >
            {installing ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Download className="h-3 w-3" aria-hidden />}
            {family ? "安装整套" : "安装"}
          </button>
        </div>
      </div>
    </article>
  );
}

function SkillRow({
  skill,
  enabled,
  onToggle,
  onRemove,
  showRemove = true,
  showAvailabilityReason = true,
  scanBusy,
  onScan,
  onOpenDetail,
}: {
  skill: SkillInfo;
  enabled: boolean;
  onToggle: (id: string) => void;
  onRemove: (skill: SkillInfo) => void;
  showRemove?: boolean;
  showAvailabilityReason?: boolean;
  scanBusy: boolean;
  onScan?: (id: string) => void;
  onOpenDetail: () => void;
}) {
  const available = skill.available !== false;
  const displayName = skillDisplayName(skill);
  const visual = installedSkillVisual(skill);
  const Icon = visual.Icon;
  const requirementLabels = (skill.requirements ?? [])
    .map((requirement) => REQUIREMENT_LABELS[requirement])
    .filter((label): label is string => Boolean(label));

  return (
    <article
      data-testid="skill-installed-card"
      className={`leemo-skill-card leemo-skill-card--installed flex min-h-[112px] min-w-0 gap-3 p-3 ${available ? "" : "opacity-65"}`}
    >
      <div className="leemo-skill-card__icon mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[7px] text-[var(--leemo-ink-2)]" data-tone={visual.tone}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-center gap-1.5">
          <h3 className="min-w-0 truncate text-[13px] font-medium">
            <button
              type="button"
              onClick={onOpenDetail}
              aria-label={`查看 ${displayName} 详情`}
              title={skill.name !== displayName ? `原名：${skill.name}` : "查看详情"}
              className="max-w-full truncate text-left text-[var(--leemo-ink)] hover:text-[var(--leemo-amber-strong)]"
            >
              {displayName}
            </button>
          </h3>
          <span className="leemo-skill-card__source shrink-0 rounded-[5px] px-1.5 py-0.5 text-[9.5px] text-[var(--leemo-ink-3)]">
            {sourceBadge(skill)}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {onScan && (
              <button
                type="button"
                aria-label={`扫描 ${displayName}`}
                title="安全扫描（只报告，不会自动停用）"
                onClick={() => onScan(skillKey(skill))}
                disabled={scanBusy}
                className="grid h-6 w-6 place-items-center rounded-[5px] text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-amber-strong)] disabled:cursor-wait disabled:opacity-40"
              >
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
            {showRemove && skill.canRemove && (
              <button
                type="button"
                aria-label={`移除 ${displayName}`}
                title="移除"
                onClick={() => onRemove(skill)}
                className="grid h-6 w-6 place-items-center rounded-[5px] text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-danger-soft)] hover:text-[var(--leemo-danger)]"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </div>
        </div>
        <p className="mt-1 line-clamp-2 text-[12px] leading-[1.5] text-[var(--leemo-ink-2)]">{skill.description}</p>
        <div data-testid="skill-card-footer" className="leemo-skill-card__footer mt-auto flex min-h-6 items-end justify-between gap-3 pt-1.5">
          <div className="min-w-0 flex flex-wrap gap-x-2 gap-y-1">
            {available ? requirementLabels.map((label) => (
              <span key={label} className="text-[10px] text-[var(--leemo-ink-3)]">{label}</span>
            )) : showAvailabilityReason ? (
              <span className="flex items-center gap-1 text-[10.5px] text-[var(--leemo-danger)]"><AlertCircle className="h-3 w-3 shrink-0" aria-hidden />{skill.unavailableReason ?? "暂时不可用"}</span>
            ) : null}
          </div>
          <label className={`relative inline-flex h-5 w-9 shrink-0 items-center ${available ? "cursor-pointer" : "cursor-not-allowed"}`}>
            <input
              type="checkbox"
              checked={enabled}
              disabled={!available}
              onChange={() => onToggle(skillKey(skill))}
              className="peer sr-only"
              aria-label={`让 momo 用 ${displayName}`}
              title={!available ? skill.unavailableReason : enabled ? "momo 可以用这个技能" : "已关闭"}
            />
            <span className="absolute inset-0 rounded-full bg-[var(--leemo-line)] transition-colors peer-checked:bg-[var(--leemo-amber)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--leemo-amber)] peer-disabled:opacity-70" />
            <span className="relative ml-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
          </label>
        </div>
      </div>
    </article>
  );
}

function SkillDetailView({
  target,
  detailMarkdown,
  detailMarkdownStatus,
  installedSkill,
  enabled,
  installing,
  installDisabled,
  onBack,
  onOpenSource,
  onOpenCategory,
  onInstall,
  onToggle,
  onRemove,
  onOpenDir,
}: {
  target: SkillDetailTarget;
  detailMarkdown?: string;
  detailMarkdownStatus: "idle" | "loading" | "ready" | "error";
  installedSkill?: SkillInfo;
  enabled: boolean;
  installing: boolean;
  installDisabled: boolean;
  onBack: () => void;
  onOpenSource: () => void;
  onOpenCategory: () => void;
  onInstall: () => Promise<void>;
  onToggle?: () => void;
  onRemove?: () => void;
  onOpenDir: () => void;
}) {
  const [detailSection, setDetailSection] = useState<"overview" | "usage" | "source">("overview");
  const skill = target.skill;
  const displayName = skillDisplayName(skill);
  const source = target.kind === "community" ? "GitHub" : sourceBadge(target.skill);
  const installed = target.kind === "installed" || target.skill.installed;
  const family = target.kind === "community" && target.skill.kind === "family";
  const rows = [
    { label: "原名", value: skill.name !== displayName ? skill.name : undefined },
    { label: "来源", value: source },
    { label: "作者", value: target.kind === "community" ? target.skill.author : undefined },
    { label: "仓库", value: skill.repository },
    { label: "固定版本", value: skill.revision },
    { label: "许可", value: skill.license },
    { label: "扫描记录", value: skill.scanStatus === "scanned" ? "已扫描" : skill.scanStatus },
  ].filter((row): row is { label: string; value: string } => Boolean(row.value));
  const members = target.kind === "community" ? target.skill.members : undefined;
  const sections = [
    { id: "overview" as const, label: "概览" },
    { id: "usage" as const, label: "使用说明" },
    { id: "source" as const, label: "来源" },
  ];

  return (
    <section role="region" aria-label="技能详情" className="leemo-skill-detail pb-8">
      <button
        type="button"
        onClick={onBack}
        aria-label="返回技能列表"
        className="leemo-skill-detail__back mb-4 inline-flex h-8 items-center gap-1.5 rounded-[7px] px-2 text-xs text-[var(--leemo-ink-3)]"
      >
        <span aria-hidden>←</span>
        返回
      </button>
      <div className="leemo-skill-detail__main min-w-0">
        <header className="leemo-skill-detail__hero">
          <div className="flex min-w-0 items-center gap-3">
            <span className="leemo-skill-detail__icon grid h-10 w-10 shrink-0 place-items-center rounded-[9px] text-[var(--leemo-amber-strong)]">
              <Blocks className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-[var(--leemo-ink)]">{displayName}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-[var(--leemo-ink-3)]">
                <button
                  type="button"
                  onClick={onOpenSource}
                  aria-label={`查看来源 ${source}`}
                  className="leemo-skill-detail__source-chip"
                >
                  {source}
                </button>
                {skill.categoryLabel && (
                  <button
                    type="button"
                    onClick={onOpenCategory}
                    aria-label={`查看分类 ${skill.categoryLabel}`}
                    className="leemo-skill-detail__category"
                  >
                    {skill.categoryLabel}
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="leemo-skill-detail__actions flex flex-wrap items-center gap-2">
            {!installed && target.kind === "community" ? (
              <button
                type="button"
                onClick={() => void onInstall()}
                disabled={installDisabled}
                aria-label={`${family ? "安装整套" : "安装"} ${displayName}`}
                className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-[var(--leemo-ink)] px-3 text-xs font-medium text-white hover:opacity-90 disabled:cursor-wait disabled:opacity-50"
              >
                {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Download className="h-3.5 w-3.5" aria-hidden />}
                {family ? "安装整套" : "安装"}
              </button>
            ) : (
              <span className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-[var(--leemo-panel)] px-2.5 text-xs font-medium text-[var(--leemo-ok)]">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                已安装
              </span>
            )}
            {installedSkill && onToggle && (
              <label className={`inline-flex h-8 items-center gap-2 rounded-[6px] border border-[var(--leemo-line)] px-2.5 text-xs text-[var(--leemo-ink-2)] ${installedSkill.available === false ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={installedSkill.available === false}
                  onChange={onToggle}
                  aria-label={`让 momo 用 ${displayName}`}
                />
                {installedSkill.available === false ? "暂不可用" : enabled ? "已启用" : "已关闭"}
              </label>
            )}
            {installed && (
              <button type="button" onClick={onOpenDir} aria-label="打开技能目录" className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--leemo-line)] px-2.5 text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)]">
                <FolderOpen className="h-3.5 w-3.5" aria-hidden />
                打开目录
              </button>
            )}
            {onRemove && (
              <button type="button" onClick={onRemove} aria-label={`移除 ${displayName}`} className="inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-xs text-[var(--leemo-danger)] hover:bg-[var(--leemo-danger-soft)]">
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                移除
              </button>
            )}
          </div>
        </header>

        {skill.setupRequired && (
          <div className="leemo-skill-detail__setup mx-5 mt-4 flex items-start gap-2 text-[11px] leading-5 text-[var(--leemo-ink-2)]">
            <FolderCog className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--leemo-amber-strong)]" aria-hidden />
            <span>{skill.setupMessage ?? "首次使用前需要完成设置。"}</span>
          </div>
        )}

        <div className="leemo-skill-detail__tabs" role="tablist" aria-label="技能详情内容">
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={detailSection === item.id}
              onClick={() => setDetailSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="leemo-skill-detail__panel" role="tabpanel">
          {detailSection === "overview" && (
            <div className="leemo-skill-detail__overview-grid">
              <div className="leemo-skill-detail__overview-card leemo-skill-detail__overview-card--lead">
                <h3>它能帮你做什么</h3>
                <p>{skill.description}</p>
              </div>
              <div className="leemo-skill-detail__overview-card">
                <h3>怎么开始</h3>
                <ol className="leemo-skill-detail__steps">
                  <li><span>1</span><p>{installed ? "确认技能已启用" : "先安装并启用这个技能"}</p></li>
                  <li><span>2</span><p>在对话里直接说明你想完成的任务</p></li>
                  <li><span>3</span><p>momo 会在合适的时候使用它，并把过程和结果展示给你</p></li>
                </ol>
              </div>
              <div className="leemo-skill-detail__overview-card">
                <h3>试试这样说</h3>
                <div className="leemo-skill-detail__starter">请使用「{displayName}」帮我处理这项任务：</div>
              </div>
              {members && members.length > 0 && (
                <div className="leemo-skill-detail__overview-card leemo-skill-detail__overview-card--members">
                  <h3>包含 {members.length} 个技能</h3>
                  <div className="leemo-skill-detail__member-grid">
                    {members.map((member) => (
                      <div key={member.id}>
                        <p>{member.displayName ?? member.name}</p>
                        <span>{member.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {detailSection === "usage" && (
            <section className="leemo-skill-detail__document" aria-label="技能完整说明">
              <div className="leemo-skill-detail__document-heading">
                <BookOpen className="h-3.5 w-3.5" aria-hidden />
                <span className="leemo-skill-detail__document-title">固定版本说明</span>
                <span>来自固定版本的 SKILL.md</span>
              </div>
              {detailMarkdownStatus === "idle" && (
                <p className="leemo-skill-detail__document-error">这个技能没有可读取的详细说明。</p>
              )}
              {detailMarkdownStatus === "loading" && (
                <div className="leemo-skill-detail__document-loading" role="status">正在读取说明…</div>
              )}
              {detailMarkdownStatus === "error" && (
                <p className="leemo-skill-detail__document-error">暂时读不到完整说明，你仍可查看上方简介或打开来源。</p>
              )}
              {detailMarkdownStatus === "ready" && detailMarkdown && (
                <div className="leemo-skill-detail__markdown">
                  <MarkdownContent text={detailMarkdown} variant="preview" />
                </div>
              )}
            </section>
          )}

          {detailSection === "source" && (
            <div className="leemo-skill-detail__source-panel">
              <div>
                <p className="leemo-skill-detail__eyebrow">来源与版本</p>
                <h3>可以核对，也可以回到对应分区继续浏览</h3>
                <p>这里保留 Skill 的原名、固定版本与扫描状态，不把开发者信息混进主要使用说明。</p>
              </div>
              <dl className="leemo-skill-detail__facts divide-y divide-[var(--leemo-line-soft)]">
                {rows.map((row) => (
                  <div key={row.label} className="grid grid-cols-[78px_minmax(0,1fr)] gap-3 py-2.5 text-[11px]">
                    <dt className="text-[var(--leemo-ink-3)]">{row.label}</dt>
                    <dd className="min-w-0 break-words text-[var(--leemo-ink-2)]">{row.value}</dd>
                  </div>
                ))}
                {skill.sourceUrl && (
                  <div className="py-3">
                    <a href={skill.sourceUrl} target="_blank" rel="noreferrer" className="leemo-skill-detail__source inline-flex h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-xs text-[var(--leemo-amber-strong)]">
                      查看来源 <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  </div>
                )}
              </dl>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ScanResultDisclosure({ result, onClose }: { result: SkillMutationItem; onClose: () => void }) {
  const findings = result.securityFindings ?? [];
  const statusLabel = result.scanStatus === "scanned"
    ? "未发现明显风险"
    : result.scanStatus === "blocked"
      ? "发现高风险内容"
      : result.scanStatus === "review"
        ? `发现 ${findings.length} 项需留意内容`
        : "尚未扫描";
  return (
    <div className="mb-4 border-b border-[var(--leemo-line-soft)] pb-3 text-xs text-[var(--leemo-ink-2)]" role="status">
      <div className="flex min-h-8 items-center gap-2">
        {result.scanStatus === "scanned" ? <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[var(--leemo-ok)]" aria-hidden /> : <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-[var(--leemo-amber-strong)]" aria-hidden />}
        <span>已扫描 {result.name} · {statusLabel}</span>
        <button type="button" aria-label="关闭扫描结果" title="关闭" onClick={onClose} className="ml-auto grid h-6 w-6 place-items-center rounded-[5px] text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-side-hover)]">
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {findings.length > 0 && (
        <details className="ml-5 mt-1.5 text-[10.5px] leading-5 text-[var(--leemo-ink-3)]">
          <summary className="cursor-pointer text-[var(--leemo-amber-strong)]">查看扫描详情</summary>
          <div className="mt-1.5 space-y-1.5">
            {findings.map((finding) => (
              <p key={`${finding.rule}:${finding.file}:${finding.line ?? 0}`}>
                <span className="font-medium text-[var(--leemo-ink-2)]">{finding.title}</span>：{finding.detail}
              </p>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function scanPresentation(candidate: SkillSourceCandidateView) {
  if (!candidate.scan) {
    return { label: "尚未扫描", Icon: ShieldAlert, tone: "text-[var(--leemo-ink-3)] bg-[var(--leemo-side)]" };
  }
  switch (candidate.scan.status) {
    case "scanned": return { label: "未发现明显风险", Icon: ShieldCheck, tone: "text-[var(--leemo-ok)] bg-[rgba(49,132,90,.08)]" };
    case "review": return { label: "发现需留意内容", Icon: ShieldAlert, tone: "text-[var(--leemo-amber-strong)] bg-[var(--leemo-amber-soft)]" };
    case "blocked": return { label: "发现高风险内容", Icon: AlertCircle, tone: "text-[var(--leemo-danger)] bg-[var(--leemo-danger-soft)]" };
  }
}

function InstallSkillDialog({
  sourceInput,
  setSourceInput,
  inspection,
  inspectedSource,
  selectedCandidate,
  setSelectedCandidate,
  adminStatus,
  adminError,
  onClose,
  onInspect,
  onScan,
  onPick,
  onInstall,
}: {
  sourceInput: string;
  setSourceInput: (value: string) => void;
  inspection?: SkillSourceInspectionView;
  inspectedSource?: string;
  selectedCandidate?: string;
  setSelectedCandidate: (value: string) => void;
  adminStatus: "idle" | "picking" | "inspecting" | "installing" | "scanning" | "removing";
  adminError?: string;
  onClose: () => void;
  onInspect: (source: string, securityScan?: boolean) => Promise<void>;
  onScan: (source: string) => Promise<void>;
  onPick: (kind: "archive" | "folder") => Promise<void>;
  onInstall: () => Promise<void>;
}) {
  const selected = inspection?.candidates.find((candidate) => candidate.name === selectedCandidate);
  const canInstall = Boolean(
    selected
    && inspectedSource,
  );
  const busy = adminStatus === "picking" || adminStatus === "inspecting" || adminStatus === "installing" || adminStatus === "scanning";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4 sm:p-6" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="添加技能"
        className="flex max-h-[min(720px,calc(100vh-32px))] w-full max-w-[680px] flex-col overflow-hidden rounded-[8px] border border-[var(--leemo-line)] bg-[var(--leemo-bg)] shadow-[var(--leemo-shadow-popover)]"
      >
        <header className="flex h-14 shrink-0 items-center border-b border-[var(--leemo-line)] px-5">
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--leemo-ink)]">添加技能</h2>
            <p className="mt-0.5 text-[10.5px] text-[var(--leemo-ink-3)]">GitHub · skill.sh · 本地文件</p>
          </div>
          <button
            type="button"
            aria-label="关闭添加技能"
            title="关闭"
            onClick={onClose}
            disabled={adminStatus === "installing"}
            className="ml-auto grid h-8 w-8 place-items-center rounded-[6px] text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-side-hover)] disabled:opacity-40"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="flex gap-2">
            <input
              type="text"
              aria-label="Skill 来源"
              value={sourceInput}
              onChange={(event) => setSourceInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && sourceInput.trim() && !busy) void onInspect(sourceInput);
              }}
              placeholder="粘贴 GitHub / skill.sh 链接"
              className="h-9 min-w-0 flex-1 rounded-[6px] border border-[var(--leemo-line)] bg-white px-3 text-xs text-[var(--leemo-ink)] outline-none placeholder:text-[var(--leemo-ink-3)] focus:border-[var(--leemo-amber)] focus:ring-2 focus:ring-[var(--leemo-focus)]"
            />
            <button
              type="button"
              disabled={!sourceInput.trim() || busy}
              onClick={() => void onInspect(sourceInput)}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[6px] bg-[var(--leemo-ink)] px-3 text-xs font-medium text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              {adminStatus === "inspecting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Search className="h-3.5 w-3.5" aria-hidden />}
              读取来源
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onPick("archive")}
              className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--leemo-line)] bg-white px-2.5 text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)] disabled:opacity-40"
            >
              <Archive className="h-3.5 w-3.5" aria-hidden />
              选择 ZIP
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onPick("folder")}
              className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--leemo-line)] bg-white px-2.5 text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)] disabled:opacity-40"
            >
              <Folder className="h-3.5 w-3.5" aria-hidden />
              选择文件夹
            </button>
          </div>

          {adminError && (
            <div role="alert" className="mt-4 flex items-start gap-2 rounded-[6px] border border-[var(--leemo-danger-line)] bg-[var(--leemo-danger-soft)] px-3 py-2.5 text-xs leading-5 text-[var(--leemo-danger)]">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {adminError}
            </div>
          )}

          {inspection && (
            <div className="mt-5 border-t border-[var(--leemo-line)] pt-4">
              <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-[var(--leemo-ink-3)]">
                <span className="font-medium text-[var(--leemo-ink-2)]">{inspection.repository ?? inspection.sourceLabel}</span>
                {inspection.license && <span className="rounded-[4px] bg-[var(--leemo-side)] px-1.5 py-0.5">{inspection.license}</span>}
                {inspection.revision && <span title={inspection.revision}>版本 {inspection.revision.slice(0, 8)}</span>}
                <button
                  type="button"
                  disabled={!inspectedSource || busy}
                  onClick={() => inspectedSource && void onScan(inspectedSource)}
                  className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-[5px] border border-[var(--leemo-line)] bg-white px-2 text-[10.5px] font-medium text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)] disabled:opacity-40"
                >
                  <ShieldCheck className="h-3 w-3" aria-hidden />
                  安全扫描
                </button>
              </div>

              <div role="radiogroup" aria-label="可安装技能" className="mt-3 divide-y divide-[var(--leemo-line-soft)] border-y border-[var(--leemo-line)]">
                {inspection.candidates.map((candidate) => {
                  const presentation = scanPresentation(candidate);
                  const CandidateIcon = presentation.Icon;
                  const chosen = candidate.name === selectedCandidate;
                  return (
                    <button
                      key={candidate.name}
                      type="button"
                      role="radio"
                      aria-checked={chosen}
                      onClick={() => setSelectedCandidate(candidate.name)}
                      className={`flex w-full items-start gap-3 px-2 py-3 text-left transition-colors ${chosen ? "bg-[var(--leemo-amber-bg)]" : "hover:bg-[var(--leemo-side)]"}`}
                    >
                      <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${chosen ? "border-[var(--leemo-amber)] bg-[var(--leemo-amber)] text-white" : "border-[var(--leemo-line)] bg-white text-transparent"}`}>
                        <Check className="h-2.5 w-2.5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] font-medium text-[var(--leemo-ink)]">{candidate.name}</span>
                        <span className="mt-0.5 block text-[11px] leading-5 text-[var(--leemo-ink-3)]">{candidate.description}</span>
                      </span>
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded-[4px] px-1.5 py-1 text-[9.5px] ${presentation.tone}`}>
                        <CandidateIcon className="h-3 w-3" aria-hidden />
                        {presentation.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              {selected?.scan && selected.scan.findings.length > 0 && (
                <div className="mt-4 space-y-2">
                  {selected.scan.findings.map((finding) => (
                    <div key={`${finding.rule}:${finding.file}:${finding.line ?? 0}`} className="border-l-2 border-[var(--leemo-danger-line)] pl-3">
                      <p className="text-xs font-medium text-[var(--leemo-ink)]">{finding.title}</p>
                      <p className="mt-0.5 text-[10.5px] leading-5 text-[var(--leemo-ink-3)]">{finding.detail}</p>
                      <p className="mt-0.5 text-[9.5px] text-[var(--leemo-ink-4)]">{finding.file}{finding.line ? `:${finding.line}` : ""}</p>
                    </div>
                  ))}
                </div>
              )}

              {selected?.scan && selected.scan.status !== "scanned" && (
                <p className="mt-4 text-[10.5px] leading-5 text-[var(--leemo-ink-3)]">
                  扫描结果只用于帮助判断，不会替你拒绝安装。
                </p>
              )}
            </div>
          )}
        </div>

        <footer className="flex min-h-14 shrink-0 items-center justify-end gap-2 border-t border-[var(--leemo-line)] bg-white px-5 py-2.5">
          <button type="button" onClick={onClose} disabled={adminStatus === "installing"} className="h-8 rounded-[6px] px-3 text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)] disabled:opacity-40">
            取消
          </button>
          <button
            type="button"
            aria-label={`安装 ${selectedCandidate ?? "Skill"}`}
            disabled={!canInstall || adminStatus === "installing"}
            onClick={() => void onInstall()}
            className="inline-flex h-8 min-w-20 items-center justify-center gap-1.5 rounded-[6px] bg-[var(--leemo-ink)] px-3 text-xs font-medium text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            {adminStatus === "installing" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            安装
          </button>
        </footer>
      </div>
    </div>
  );
}

function RemoveSkillDialog({
  skill,
  removing,
  error,
  onCancel,
  onConfirm,
}: {
  skill: SkillInfo;
  removing: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const collectionMemberCount = skill.collectionMemberCount ?? 0;
  const removeWholeCollection = Boolean(skill.collectionLabel && collectionMemberCount > 1);
  const targetLabel = removeWholeCollection ? skill.collectionLabel! : skillDisplayName(skill);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onCancel();
    }}>
      <div role="dialog" aria-modal="true" aria-label={`移除 ${targetLabel}`} className="w-full max-w-[420px] rounded-[8px] border border-[var(--leemo-line)] bg-[var(--leemo-bg)] p-5 shadow-[var(--leemo-shadow-popover)]">
        <div className="flex items-start gap-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-[var(--leemo-danger-soft)] text-[var(--leemo-danger)]">
            <Trash2 className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--leemo-ink)]">移除 {targetLabel}</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--leemo-ink-3)]">
              {removeWholeCollection
                ? `这会移除整套及其中 ${collectionMemberCount} 个技能，只删除 Leemo 管理的安装副本。`
                : "只删除 Leemo 管理的安装副本，原始仓库或 ZIP 不会被改动。"}
            </p>
          </div>
        </div>
        {error && <p role="alert" className="mt-3 text-xs text-[var(--leemo-danger)]">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={removing} className="h-8 rounded-[6px] px-3 text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)] disabled:opacity-40">取消</button>
          <button type="button" onClick={() => void onConfirm()} disabled={removing} className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-[var(--leemo-danger)] px-3 text-xs font-medium text-white hover:brightness-95 disabled:opacity-40">
            {removing && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            {removeWholeCollection ? "确认移除整套" : "确认移除"}
          </button>
        </div>
      </div>
    </div>
  );
}
