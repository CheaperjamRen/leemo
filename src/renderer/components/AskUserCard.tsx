import { useState } from "react";
import { Check, CircleHelp } from "lucide-react";
import type { AskUserAnswerItem, AskUserQuestion } from "../../bridge/contract";
import type { PendingInteraction, ResolvedInteraction } from "../stores/approvals";
import { useApprovals } from "../bridge/context";

/** A single ask_user interaction, already resolved to ONE specific question
 *  (卡 D — 启动轮 2): TurnBlock pairs each `ask_user` tool-call item in the
 *  timeline to its matching question by index (AskUserPayload carries no
 *  toolUseId, so positional pairing is the only anchor available — see
 *  TurnBlock.tsx's `questionSequenceForRun`) and renders exactly one
 *  AskUserCard per pairing. This component never scans the whole run itself
 *  — that "render every pending+resolved question for the run in one place"
 *  design is what used to live pinned above the input box, and is exactly
 *  the shape of the "same card twice" duplicate-render bug this round fixed. */
type QuestionPending = PendingInteraction & { kind: "question" };
type QuestionResolved = ResolvedInteraction & { kind: "question" };
export type QuestionInteraction = QuestionPending | QuestionResolved;

interface AskUserCardProps {
  interaction: QuestionInteraction;
  density?: "default" | "buddy";
}

interface QuestionState {
  selectedOptions: string[];
  otherText: string;
}

/** ResolvedInteraction (question) always carries `items` (null when
 *  cancelled/expired); PendingInteraction (question) never does — a reliable
 *  runtime discriminant since AskUserPayload has no shared status field. */
function isResolved(interaction: QuestionInteraction): interaction is QuestionResolved {
  return "items" in interaction;
}

export default function AskUserCard({ interaction, density = "default" }: AskUserCardProps) {
  const answer = useApprovals((s) => s.answer);

  if (isResolved(interaction)) {
    return <ResolvedQuestionCard interaction={interaction} density={density} />;
  }
  return (
    <InteractiveQuestionCard
      id={interaction.id}
      questions={interaction.questions}
      density={density}
      onAnswer={answer}
    />
  );
}

/** 已回答 / 已取消 — 原地转 55% 灰归档，不许移动位置（三态样式 spec §4）. */
function answerSummary(interaction: QuestionResolved, questionIndex: number): string {
  const item = interaction.items?.[questionIndex];
  if (!item) return "无";
  const parts = [...(item.selected ?? [])];
  if (item.other) parts.push(item.other);
  return parts.join("、") || "无";
}

function ResolvedQuestionCard({
  interaction,
  density,
}: {
  interaction: QuestionResolved;
  density: "default" | "buddy";
}) {
  const wasCancelled = interaction.items === null;

  if (density === "buddy") {
    return (
      <div className="space-y-0.5 px-1.5 py-1 text-[11.5px] text-[var(--leemo-ink-3)]">
        {interaction.questions.map((question, questionIndex) => {
          const chineseHeader = question.header && /[\u3400-\u9fff]/.test(question.header)
            ? question.header
            : undefined;
          const label = chineseHeader ?? question.question.replace(/[？?：:]\s*$/, "");
          return (
            <div key={questionIndex} className="flex min-w-0 items-center gap-2">
              <Check className="h-3.5 w-3.5 shrink-0 text-[var(--leemo-ok)]" aria-hidden />
              <span className="truncate">
                {label} · {wasCancelled ? "已取消" : `你选了：${answerSummary(interaction, questionIndex)}`}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      data-testid="resolved-question-receipt"
      className="min-h-9 rounded-[8px] border border-[var(--leemo-line-2)] bg-[var(--leemo-card)] px-3 py-2"
    >
      {interaction.questions.map((q, qi) => (
        <div
          key={qi}
          className="grid min-w-0 grid-cols-[14px_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-[12px] leading-5"
        >
          <Check className={`h-3.5 w-3.5 shrink-0 ${wasCancelled ? "text-[var(--leemo-ink-3)]" : "text-[var(--leemo-ok)]"}`} aria-hidden />
          <span className="min-w-0 truncate text-[var(--leemo-ink-2)]">{q.question}</span>
          <span aria-hidden className="text-[var(--leemo-ink-3)]">·</span>
          <span className="min-w-0 truncate text-[var(--leemo-ink-3)]">{wasCancelled ? "已取消" : answerSummary(interaction, qi)}</span>
        </div>
      ))}
    </div>
  );
}

interface InteractiveQuestionCardProps {
  id: string;
  questions: AskUserQuestion[];
  density: "default" | "buddy";
  onAnswer: (id: string, items: AskUserAnswerItem[]) => Promise<void>;
}

/** pending — 可交互，琥珀描边强调（三态样式 spec §4）. */
function InteractiveQuestionCard({ id, questions, density, onAnswer }: InteractiveQuestionCardProps) {
  const [questionStates, setQuestionStates] = useState<QuestionState[]>(
    questions.map(() => ({ selectedOptions: [], otherText: "" }))
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleOption = (questionIndex: number, option: string, multiSelect: boolean) => {
    setQuestionStates((previous) => previous.map((state, index) => {
      if (index !== questionIndex) return state;
      const selectedOptions = multiSelect
        ? state.selectedOptions.includes(option)
          ? state.selectedOptions.filter((selected) => selected !== option)
          : [...state.selectedOptions, option]
        : state.selectedOptions.includes(option) ? [] : [option];
      return { ...state, selectedOptions };
    }));
  };

  const setOtherText = (questionIndex: number, text: string) => {
    setQuestionStates((prev) => {
      const newStates = [...prev];
      newStates[questionIndex] = { ...newStates[questionIndex], otherText: text };
      return newStates;
    });
  };

  const isQuestionAnswered = (state: QuestionState): boolean => {
    return state.selectedOptions.length > 0 || state.otherText.trim().length > 0;
  };

  const allAnswered = questionStates.every(isQuestionAnswered);

  const handleSubmit = async () => {
    if (!allAnswered || isSubmitting) return;

    setIsSubmitting(true);

    const items: AskUserAnswerItem[] = questionStates.map((state) => ({
      selected: state.selectedOptions,
      other: state.otherText.trim() || undefined,
    }));

    try {
      await onAnswer(id, items);
    } catch {
      // Error toast is already shown by the store via notifyError
      setIsSubmitting(false);
    }
  };

  return (
    <div
      data-component-role="ask-user"
      data-surface-level="raised"
      data-tone="question"
      className={`leemo-ask-card w-full rounded-[13px] border px-4 py-3.5 ${density === "buddy" ? "mx-auto max-w-[520px]" : ""}`}
    >
      <div className="mb-2.5 flex items-center gap-2 text-[12px] font-medium text-[var(--leemo-ink-2)]">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--leemo-amber-soft)] text-[var(--leemo-amber-strong)]">
          <CircleHelp className="h-3.5 w-3.5" aria-hidden />
        </span>
        {density === "buddy" ? "需要你选一下" : "需要你确认"}
      </div>
      {questions.map((q, qi) => (
        <div key={qi} className="mb-3 last:mb-0">
          {q.header && (
            <div className="mb-1 text-[11.5px] font-medium tracking-wide text-[var(--leemo-ink-3)]">
              {q.header}
            </div>
          )}
          <p className="mb-2.5 text-[14.5px] font-medium leading-6 text-[var(--leemo-ink)]">{q.question}</p>
          <div className="mb-2 grid grid-cols-1 gap-2">
            {q.options.map((opt) => {
              const isSelected = questionStates[qi].selectedOptions.includes(opt.label);
              return (
                <button
                  key={opt.label}
                  type="button"
                  aria-pressed={isSelected}
                  data-selected={isSelected ? "true" : "false"}
                  data-option-state={isSelected ? "selected" : "idle"}
                  disabled={isSubmitting}
                  onClick={() => toggleOption(qi, opt.label, q.multiSelect === true)}
                  className="leemo-ask-option group grid min-h-[50px] w-full grid-cols-[18px_minmax(0,1fr)] items-start gap-3 rounded-[9px] border px-3 py-2 text-left text-[13px] transition-[border-color,background-color,box-shadow,transform] duration-150 focus-visible:outline-none active:translate-y-px disabled:opacity-60 disabled:active:translate-y-0"
                >
                  <span
                    data-ask-option-marker
                    aria-hidden
                    className="mt-[1px] grid h-[18px] w-[18px] place-items-center rounded-full border transition-colors"
                    style={{
                      borderColor: isSelected ? "var(--leemo-amber)" : "var(--leemo-line)",
                      background: isSelected ? "var(--leemo-amber)" : "transparent",
                      color: isSelected ? "white" : "var(--leemo-ink-3)",
                    }}
                  >
                    {isSelected ? <Check className="h-3 w-3" aria-hidden /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium leading-5">{opt.label}</span>
                    {opt.description && (
                      <span className="mt-0.5 block text-[12px] leading-5" style={{ color: "var(--leemo-ink-3)" }}>{opt.description}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <input
            type="text"
            placeholder="其它…"
            value={questionStates[qi].otherText}
            disabled={isSubmitting}
            onChange={(e) => setOtherText(qi, e.target.value)}
            className="leemo-ask-other w-full rounded-[9px] border px-3 py-2 text-[13px] outline-none transition-[border-color,background-color,box-shadow] duration-150 placeholder:text-[var(--leemo-ink-4)] disabled:opacity-60"
          />
        </div>
      ))}
      <button
        type="button"
        disabled={!allAnswered || isSubmitting}
        title={!allAnswered ? "请先选择或填写答案" : undefined}
        onClick={() => void handleSubmit()}
        className="leemo-ask-submit ml-auto block min-h-9 rounded-full px-[18px] text-[13px] font-semibold text-white transition-[opacity,background-color,box-shadow] disabled:opacity-40"
      >
        提交
      </button>
    </div>
  );
}
