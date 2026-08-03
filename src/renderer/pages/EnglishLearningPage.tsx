import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpenCheck,
  Clock3,
  Languages,
  RotateCcw,
  Target,
  TrendingUp,
} from "lucide-react";
import { useConversations, useLearning, useUi, useWorkspaces } from "../bridge/context";
import {
  LEARNING_FOCUS_LABELS,
  type LearningFocus,
  type LearningProfileDraft,
  type LearningSkill,
} from "../../learning";

const FOCUS_OPTIONS: readonly { id: LearningFocus; label: string }[] = [
  { id: "general", label: LEARNING_FOCUS_LABELS.general },
  { id: "academic", label: LEARNING_FOCUS_LABELS.academic },
  { id: "career", label: LEARNING_FOCUS_LABELS.career },
  { id: "conversation", label: LEARNING_FOCUS_LABELS.conversation },
];

const SKILL_LABELS: Record<LearningSkill, string> = {
  vocabulary: "词汇",
  grammar: "语法",
  reading: "阅读",
  writing: "写作",
  conversation: "表达",
};

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(timestamp));
}

export default function EnglishLearningPage() {
  const snapshot = useLearning((state) => state.snapshot);
  const status = useLearning((state) => state.status);
  const error = useLearning((state) => state.error);
  const refresh = useLearning((state) => state.refresh);
  const saveProfile = useLearning((state) => state.saveProfile);
  const createConversation = useConversations((state) => state.createConversation);
  const discardEmptyConversation = useConversations((state) => state.discardEmptyConversation);
  const send = useConversations((state) => state.send);
  const switchActive = useConversations((state) => state.switchActive);
  const setView = useUi((state) => state.setView);
  const workspaceId = useWorkspaces((state) => state.activeId);
  const [form, setForm] = useState<LearningProfileDraft>({
    goal: "",
    focus: "general",
    dailyMinutes: 15,
  });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // The same ledger can change while momo runs a practice conversation. Reload
  // every time this page mounts so returning from chat shows the new review
  // queue and evidence instead of a stale pre-practice snapshot.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!snapshot?.profile) return;
    setForm({
      goal: snapshot.profile.goal,
      focus: snapshot.profile.focus,
      dailyMinutes: snapshot.profile.dailyMinutes,
    });
  }, [snapshot?.profile]);

  const progress = useMemo(() => snapshot?.evidence[0] ?? null, [snapshot?.evidence]);
  const baselineComplete = snapshot?.summary.hasBaseline ?? false;

  const openPractice = async (kind: "baseline" | "today") => {
    if (starting) return;
    setStarting(true);
    setStartError(null);
    let createdConversationId: string | null = null;
    try {
      if (kind === "baseline") {
        const saved = await saveProfile(form);
        if (!saved) return;
      }
      const profile = kind === "baseline" ? form : snapshot?.profile;
      if (!profile) return;
      const dueCount = snapshot?.summary.dueItems ?? 0;
      const focusLabel = LEARNING_FOCUS_LABELS[profile.focus];
      const prompt = kind === "baseline"
        ? `开始一次英语基线诊断。我的目标是：${profile.goal}，当前重点是：${focusLabel}。请用不超过 ${profile.dailyMinutes} 分钟的短任务检查我的实际水平；一次只给一小步，让我先回答，再纠正。为这套可复测任务取一个稳定的测评标识，记录基线时保存它，以后只有同型复测才能复用。结束时请记录基线结果和具体错误。`
        : `开始今天的英语练习。我的目标是：${profile.goal}，今天有 ${dueCount} 个到期复习，当前重点是：${focusLabel}。请先读取我的学习计划和到期题目，让我主动回答后再揭示答案并记录掌握情况；剩余时间给一个贴近当前重点的小输出任务。复测只有沿用同一套任务时才能复用原测评标识。`;
      const conversationId = await createConversation({
        source: "workbench",
        workspaceId,
        activate: false,
      });
      createdConversationId = conversationId;
      await send(conversationId, prompt);
      switchActive(conversationId);
      setView("chat");
    } catch (cause) {
      if (createdConversationId) {
        await discardEmptyConversation(createdConversationId);
      }
      setStartError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
  };

  if (status === "loading" && snapshot === null) {
    return (
      <div className="leemo-page-scroll" role="status" aria-label="正在读取英语学习记录">
        <div className="leemo-page-frame max-w-5xl py-16 text-center text-xs text-[var(--leemo-ink-3)]">
          正在读取学习记录…
        </div>
      </div>
    );
  }

  if (status === "error" && snapshot === null) {
    return (
      <div className="leemo-page-scroll">
        <div className="leemo-page-frame max-w-5xl">
          <header className="flex items-center gap-3 border-b border-[var(--leemo-line)] pb-4">
            <Languages className="h-[18px] w-[18px] text-[var(--leemo-accent)]" aria-hidden />
            <h1 className="text-[15px] font-semibold text-[var(--leemo-ink)]">英语学习</h1>
          </header>
          <div role="alert" className="mt-6 break-words border-y border-[var(--leemo-danger-soft)] py-3 text-xs text-[var(--leemo-danger)] [overflow-wrap:anywhere]">
            {error}
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-4 h-9 border border-[var(--leemo-line)] bg-white px-4 text-xs font-medium text-[var(--leemo-ink)] hover:border-[var(--leemo-line-strong)]"
          >
            重新读取
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="leemo-page-scroll">
      <div className="leemo-page-frame max-w-5xl">
        <header className="flex items-center gap-3 border-b border-[var(--leemo-line)] pb-4">
          <Languages className="h-[18px] w-[18px] text-[var(--leemo-accent)]" aria-hidden />
          <h1 className="text-[15px] font-semibold text-[var(--leemo-ink)]">英语学习</h1>
          {snapshot?.profile ? (
            <span className="ml-auto text-[11px] text-[var(--leemo-ink-3)]">每天 {snapshot.profile.dailyMinutes} 分钟</span>
          ) : null}
        </header>

        {(error || startError) && (
          <div role="alert" className="mt-4 break-words border-y border-[var(--leemo-danger-soft)] py-3 text-xs text-[var(--leemo-danger)] [overflow-wrap:anywhere]">
            {startError ?? error}
          </div>
        )}

        {!snapshot?.profile ? (
          <section className="mx-auto mt-10 max-w-2xl">
            <div className="flex items-center gap-2 text-[var(--leemo-ink)]">
              <Target className="h-4 w-4 text-[var(--leemo-accent)]" aria-hidden />
              <h2 className="text-sm font-semibold">先定一个真实目标</h2>
            </div>
            <label className="mt-6 block text-xs font-medium text-[var(--leemo-ink-2)]" htmlFor="english-goal">
              学习目标
            </label>
            <textarea
              id="english-goal"
              aria-label="学习目标"
              value={form.goal}
              onChange={(event) => setForm((current) => ({ ...current, goal: event.target.value }))}
              placeholder="例如：三个月后能用英语完成 AI 产品岗位面试"
              rows={3}
              maxLength={240}
              className="mt-2 w-full resize-none rounded-[6px] border border-[var(--leemo-line)] bg-white px-3 py-2.5 text-sm leading-6 text-[var(--leemo-ink)] outline-none transition-colors placeholder:text-[var(--leemo-ink-3)] focus:border-[var(--leemo-accent)]"
            />

            <fieldset className="mt-5">
              <legend className="text-xs font-medium text-[var(--leemo-ink-2)]">当前重点</legend>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {FOCUS_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={form.focus === option.id}
                    onClick={() => setForm((current) => ({ ...current, focus: option.id }))}
                    className={`h-9 rounded-[6px] border px-2 text-xs transition-colors ${
                      form.focus === option.id
                        ? "border-[var(--leemo-accent)] bg-[var(--leemo-accent-soft)] text-[var(--leemo-ink)]"
                        : "border-[var(--leemo-line)] text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-panel)]"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="mt-5 flex items-center gap-3">
              <label htmlFor="english-minutes" className="text-xs font-medium text-[var(--leemo-ink-2)]">每天</label>
              <select
                id="english-minutes"
                value={form.dailyMinutes}
                onChange={(event) => setForm((current) => ({ ...current, dailyMinutes: Number(event.target.value) }))}
                className="h-9 rounded-[6px] border border-[var(--leemo-line)] bg-white px-3 text-xs text-[var(--leemo-ink)] outline-none focus:border-[var(--leemo-accent)]"
              >
                {[10, 15, 20, 30].map((minutes) => <option key={minutes} value={minutes}>{minutes} 分钟</option>)}
              </select>
              <button
                type="button"
                disabled={starting || !form.goal.trim()}
                onClick={() => void openPractice("baseline")}
                className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-[6px] bg-[var(--leemo-ink)] px-4 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                开始诊断
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </section>
        ) : (
          <>
            <section className="mt-6 grid gap-px overflow-hidden rounded-[6px] border border-[var(--leemo-line)] bg-[var(--leemo-line)] sm:grid-cols-3">
              <div className="bg-white p-4">
                <div className="flex items-center gap-2 text-[11px] text-[var(--leemo-ink-3)]"><RotateCcw className="h-3.5 w-3.5" aria-hidden />待复习</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-[var(--leemo-ink)]">{snapshot.summary.dueItems}</div>
              </div>
              <div className="bg-white p-4">
                <div className="flex items-center gap-2 text-[11px] text-[var(--leemo-ink-3)]"><BookOpenCheck className="h-3.5 w-3.5" aria-hidden />已复习</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-[var(--leemo-ink)]">{snapshot.summary.reviewedItems}</div>
              </div>
              <div className="bg-white p-4">
                <div className="flex items-center gap-2 text-[11px] text-[var(--leemo-ink-3)]"><TrendingUp className="h-3.5 w-3.5" aria-hidden />同型进步</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-[var(--leemo-ink)]">
                  {progress ? `${progress.delta >= 0 ? "+" : ""}${progress.delta}` : "—"}
                </div>
              </div>
            </section>

            <section className="mt-7 flex flex-wrap items-start gap-4 border-b border-[var(--leemo-line)] pb-6">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-[var(--leemo-ink-3)]">当前目标</div>
                <p className="mt-1 break-words text-sm leading-6 text-[var(--leemo-ink)] [overflow-wrap:anywhere]">{snapshot.profile.goal}</p>
                <p className="mt-1 text-[11px] text-[var(--leemo-ink-3)]">{LEARNING_FOCUS_LABELS[snapshot.profile.focus]}</p>
              </div>
              <button
                type="button"
                disabled={starting}
                onClick={() => void openPractice(baselineComplete ? "today" : "baseline")}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[6px] bg-[var(--leemo-ink)] px-4 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                {baselineComplete ? "开始今日练习" : "完成基线诊断"}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </section>

            <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(240px,.8fr)]">
              <section>
                <h2 className="text-xs font-semibold text-[var(--leemo-ink)]">今天到期</h2>
                {snapshot.dueItems.length === 0 ? (
                  <p className="mt-4 border-y border-dashed border-[var(--leemo-line)] py-7 text-center text-xs text-[var(--leemo-ink-3)]">今天没有到期复习</p>
                ) : (
                  <div className="mt-3 divide-y divide-[var(--leemo-line)] border-y border-[var(--leemo-line)]">
                    {snapshot.dueItems.slice(0, 12).map((item) => (
                      <div key={item.id} className="flex items-start gap-3 py-3">
                        <span className="mt-0.5 rounded-[4px] bg-[var(--leemo-panel)] px-1.5 py-0.5 text-[10px] text-[var(--leemo-ink-3)]">{SKILL_LABELS[item.skill]}</span>
                        <p className="min-w-0 flex-1 break-words text-xs leading-5 text-[var(--leemo-ink-2)] [overflow-wrap:anywhere]">{item.cue}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h2 className="text-xs font-semibold text-[var(--leemo-ink)]">接下来</h2>
                {snapshot.upcomingItems.length === 0 ? (
                  <p className="mt-4 py-3 text-xs text-[var(--leemo-ink-3)]">练习后会出现复习安排</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {snapshot.upcomingItems.slice(0, 5).map((item) => (
                      <div key={item.id} className="flex items-start gap-2 text-xs text-[var(--leemo-ink-2)]">
                        <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--leemo-ink-3)]" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{item.cue}</span>
                        <span className="shrink-0 tabular-nums text-[10px] text-[var(--leemo-ink-3)]">{formatDate(item.dueAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
