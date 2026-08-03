import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  AlertCircle,
  Archive,
  Blocks,
  BookOpen,
  Briefcase,
  Check,
  CheckCircle2,
  ExternalLink,
  Folder,
  FolderCog,
  FolderOpen,
  Loader2,
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
import { useSkills } from "../bridge/context";

type SkillSection = "leemo" | "community" | "personal";

type FilterableSkill = Pick<SkillInfo, "name" | "description" | "category" | "categoryLabel"> & {
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
  return `${skill.name} ${skill.description} ${skill.sourceLabel ?? skill.author ?? ""}`.toLocaleLowerCase().includes(query);
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
  const openDir = useSkills((state) => state.openDir);
  const pickSource = useSkills((state) => state.pickSource);
  const inspectSource = useSkills((state) => state.inspectSource);
  const installSource = useSkills((state) => state.installSource);
  const installCommunity = useSkills((state) => state.installCommunity);
  const scanInstalled = useSkills((state) => state.scanInstalled);
  const removeSkill = useSkills((state) => state.removeSkill);
  const clearAdminFeedback = useSkills((state) => state.clearAdminFeedback);
  const [section, setSection] = useState<SkillSection>("leemo");
  const [sectionInitialized, setSectionInitialized] = useState(false);
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [installOpen, setInstallOpen] = useState(false);
  const [sourceInput, setSourceInput] = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState<string>();
  const [removeTarget, setRemoveTarget] = useState<SkillInfo>();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (sectionInitialized || status !== "ready" || (list.length === 0 && community.length === 0)) return;
    const firstPopulated = SECTIONS.find((item) => (
      list.some((skill) => sectionFor(skill) === item.id)
      || (item.id === "community" && community.some((skill) => !skill.installed))
    ));
    if (firstPopulated) setSection(firstPopulated.id);
    setSectionInitialized(true);
  }, [community, list, sectionInitialized, status]);

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
      + community.filter((skill) => !skill.installed).length,
    personal: list.filter((skill) => sectionFor(skill) === "personal").length,
  }), [community, list]);
  const sectionSkills = useMemo(
    () => list.filter((skill) => sectionFor(skill) === section),
    [list, section],
  );
  const catalogSkills = useMemo(
    () => section === "community" ? community.filter((skill) => !skill.installed) : [],
    [community, section],
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
    (category === "all" || categoryId(skill) === category)
    && matchesQuery(skill, normalizedQuery)
  )), [catalogSkills, category, normalizedQuery]);
  const hasAny = list.length > 0 || community.length > 0;
  const availableCount = list.filter((skill) => skill.available !== false).length;
  const enabledCount = list.filter(
    (skill) => skill.available !== false && !disabled.includes(skillKey(skill)),
  ).length;

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

  return (
    <div className="leemo-page">
      <header className="leemo-page-header">
        <div className="leemo-page-frame">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0">
              <h1 className="text-[17px] font-semibold text-[var(--leemo-ink)]">技能</h1>
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
                        setSection(item.id);
                        setCategory("all");
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
                  onChange={(event) => setQuery(event.target.value)}
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
                    onClick={() => setCategory(item.id)}
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
                <div className="grid border-t border-[var(--leemo-line)] pb-5 lg:grid-cols-2">
                  {visibleCatalog.map((skill) => (
                    <CommunitySkillRow
                      key={`catalog:${skill.id}`}
                      skill={skill}
                      installing={adminStatus === "installing"}
                      onInstall={() => void installCommunity(skill.id)}
                    />
                  ))}
                  {visibleInstalled.map((skill) => (
                    <SkillRow
                      key={skill.qualifiedName}
                      skill={skill}
                      enabled={skill.available !== false && !disabled.includes(skillKey(skill))}
                      onToggle={toggle}
                      onRemove={setRemoveTarget}
                      scanBusy={adminStatus === "scanning"}
                      onScan={skill.source === "user" ? (id) => void scanInstalled(id) : undefined}
                    />
                  ))}
                </div>
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
            const removed = await removeSkill(skillKey(removeTarget));
            if (removed) setRemoveTarget(undefined);
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
      className="flex min-h-64 flex-col items-center justify-center gap-2 border-y border-dashed border-[var(--leemo-line)] text-center"
    >
      <Blocks className="h-6 w-6 text-[var(--leemo-ink-3)]" aria-hidden />
      <p className="text-sm font-medium text-[var(--leemo-ink-2)]">还没有技能</p>
      <button
        type="button"
        onClick={onAdd}
        className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-[6px] bg-[var(--leemo-ink)] px-3 text-sm font-medium text-white hover:bg-black"
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
    <div className="flex min-h-52 flex-col items-center justify-center border-y border-dashed border-[var(--leemo-line)] text-center">
      <p className="text-sm text-[var(--leemo-ink-3)]">{label}</p>
      {!hasQuery && section !== "leemo" && (
        <button type="button" onClick={onAdd} className="mt-3 text-xs font-medium text-[var(--leemo-amber-strong)] hover:underline">
          添加技能
        </button>
      )}
    </div>
  );
}

const CATEGORY_META: Record<string, {
  label: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}> = {
  learning: { label: "学习", Icon: BookOpen },
  career: { label: "求职", Icon: Briefcase },
  "research-office": { label: "资料与办公", Icon: Search },
  workbench: { label: "通用工作台", Icon: FolderCog },
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
  const knownOrder = ["learning", "career", "research-office", "workbench", "other"];
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

function CommunitySkillRow({
  skill,
  installing,
  onInstall,
}: {
  skill: CommunitySkillView;
  installing: boolean;
  onInstall: () => void;
}) {
  const Icon = CATEGORY_META[categoryId(skill)]?.Icon ?? ShieldCheck;
  return (
    <div className="flex min-h-[94px] min-w-0 gap-3 border-b border-[var(--leemo-line)] py-3 pr-3 lg:odd:mr-4 lg:even:border-l lg:even:pl-4">
      <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-[var(--leemo-panel)] text-[var(--leemo-ink-2)] ring-1 ring-[var(--leemo-line-2)]">
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <h3 className="truncate text-[13px] font-medium text-[var(--leemo-ink)]">{skill.name}</h3>
          <span className="shrink-0 rounded-[4px] bg-[var(--leemo-side)] px-1.5 py-0.5 text-[9.5px] text-[var(--leemo-ink-3)]">GitHub</span>
          <a
            href={skill.sourceUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`查看 ${skill.name} 来源`}
            title="查看 GitHub 来源"
            className="grid h-5 w-5 shrink-0 place-items-center rounded-[4px] text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink-2)]"
          >
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </div>
        <p className="mt-1 line-clamp-2 text-[11.5px] leading-[1.55] text-[var(--leemo-ink-3)]">{skill.description}</p>
        <p className="mt-1 text-[10px] text-[var(--leemo-ink-4)]">{skill.author} · {skill.license}</p>
      </div>
      <button
        type="button"
        aria-label={`安装 ${skill.name}`}
        title="从 GitHub 下载并安装"
        onClick={onInstall}
        disabled={installing}
        className="mt-1 inline-flex h-7 shrink-0 items-center gap-1 rounded-[5px] border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-2 text-[10.5px] font-medium text-[var(--leemo-ink-2)] hover:border-[var(--leemo-amber)] hover:text-[var(--leemo-amber-strong)] disabled:cursor-wait disabled:opacity-50"
      >
        {installing && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
        安装
      </button>
    </div>
  );
}

function SkillRow({
  skill,
  enabled,
  onToggle,
  onRemove,
  scanBusy,
  onScan,
}: {
  skill: SkillInfo;
  enabled: boolean;
  onToggle: (id: string) => void;
  onRemove: (skill: SkillInfo) => void;
  scanBusy: boolean;
  onScan?: (id: string) => void;
}) {
  const available = skill.available !== false;
  const Icon = skill.category
    ? categoryIcon(skill)
    : skill.trust === "community"
      ? ShieldCheck
      : Sparkles;
  const requirementLabels = (skill.requirements ?? [])
    .map((requirement) => REQUIREMENT_LABELS[requirement])
    .filter((label): label is string => Boolean(label));

  return (
    <div className={`flex min-h-[94px] min-w-0 gap-3 border-b border-[var(--leemo-line)] py-3 pr-3 lg:odd:mr-4 lg:even:border-l lg:even:pl-4 ${available ? "" : "opacity-65"}`}>
      <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-[var(--leemo-panel)] text-[var(--leemo-ink-2)] ring-1 ring-[var(--leemo-line-2)]">
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <h3 className="truncate text-[13px] font-medium text-[var(--leemo-ink)]">{skill.name}</h3>
          <span className="shrink-0 rounded-[4px] bg-[var(--leemo-side)] px-1.5 py-0.5 text-[9.5px] text-[var(--leemo-ink-3)]">
            {sourceBadge(skill)}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-[11.5px] leading-[1.55] text-[var(--leemo-ink-3)]">{skill.description}</p>
        {available ? (
          requirementLabels.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-2">
              {requirementLabels.map((label) => (
                <span key={label} className="text-[10px] text-[var(--leemo-ink-3)]">{label}</span>
              ))}
            </div>
          )
        ) : (
          <p className="mt-1.5 flex items-center gap-1 text-[10.5px] text-[var(--leemo-danger)]">
            <AlertCircle className="h-3 w-3 shrink-0" aria-hidden />
            {skill.unavailableReason ?? "暂时不可用"}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-start gap-1.5 pt-1">
        {onScan && (
          <button
            type="button"
            aria-label={`扫描 ${skill.name}`}
            title="安全扫描（只报告，不会自动停用）"
            onClick={() => onScan(skillKey(skill))}
            disabled={scanBusy}
            className="grid h-6 w-6 place-items-center rounded-[5px] text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-amber-strong)] disabled:cursor-wait disabled:opacity-40"
          >
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
        {skill.canRemove && (
          <button
            type="button"
            aria-label={`移除 ${skill.name}`}
            title="移除"
            onClick={() => onRemove(skill)}
            className="grid h-6 w-6 place-items-center rounded-[5px] text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-danger-soft)] hover:text-[var(--leemo-danger)]"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
        <label className={`relative inline-flex h-5 w-9 items-center ${available ? "cursor-pointer" : "cursor-not-allowed"}`}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={!available}
            onChange={() => onToggle(skillKey(skill))}
            className="peer sr-only"
            aria-label={`让 momo 用 ${skill.name}`}
            title={!available ? skill.unavailableReason : enabled ? "momo 可以用这个技能" : "已关闭"}
          />
          <span className="absolute inset-0 rounded-full bg-[var(--leemo-line)] transition-colors peer-checked:bg-[var(--leemo-amber)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--leemo-amber)] peer-disabled:opacity-70" />
          <span className="relative ml-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
        </label>
      </div>
    </div>
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
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onCancel();
    }}>
      <div role="dialog" aria-modal="true" aria-label={`移除 ${skill.name}`} className="w-full max-w-[420px] rounded-[8px] border border-[var(--leemo-line)] bg-[var(--leemo-bg)] p-5 shadow-[var(--leemo-shadow-popover)]">
        <div className="flex items-start gap-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-[var(--leemo-danger-soft)] text-[var(--leemo-danger)]">
            <Trash2 className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--leemo-ink)]">移除 {skill.name}</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--leemo-ink-3)]">只删除 Leemo 管理的安装副本，原始仓库或 ZIP 不会被改动。</p>
          </div>
        </div>
        {error && <p role="alert" className="mt-3 text-xs text-[var(--leemo-danger)]">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={removing} className="h-8 rounded-[6px] px-3 text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)] disabled:opacity-40">取消</button>
          <button type="button" onClick={() => void onConfirm()} disabled={removing} className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-[var(--leemo-danger)] px-3 text-xs font-medium text-white hover:brightness-95 disabled:opacity-40">
            {removing && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            确认移除
          </button>
        </div>
      </div>
    </div>
  );
}
