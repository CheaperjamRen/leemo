import { useState } from "react";
import { Check } from "lucide-react";
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
    <InteractiveQuestionCard id={interaction.id} questions={interaction.questions} onAnswer={answer} />
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
  onAnswer: (id: string, items: AskUserAnswerItem[]) => Promise<void>;
}

/** pending — 可交互，琥珀描边强调（三态样式 spec §4）. */
function InteractiveQuestionCard({ id, questions, onAnswer }: InteractiveQuestionCardProps) {
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
    <div className="rounded-[10px] border border-[var(--leemo-amber-line)] bg-[var(--leemo-amber-bg)] px-4 py-3 shadow-[0_1px_2px_rgba(24,31,38,0.03)]">
      {questions.map((q, qi) => (
        <div key={qi} className="mb-3 last:mb-0">
          {q.header && (
            <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wide text-[var(--leemo-ink-3)]">
              {q.header}
            </div>
          )}
          <p className="mb-2 text-[13px] text-[var(--leemo-ink)]">{q.question}</p>
          <div className="mb-2 grid grid-cols-1 gap-2">
            {q.options.map((opt) => {
              const isSelected = questionStates[qi].selectedOptions.includes(opt.label);
              return (
                <button
                  key={opt.label}
                  type="button"
                  aria-pressed={isSelected}
                  disabled={isSubmitting}
                  onClick={() => toggleOption(qi, opt.label, q.multiSelect === true)}
                  className="grid min-h-[46px] w-full grid-cols-[minmax(0,1fr)_18px] items-center gap-3 rounded-[7px] border px-3 py-2 text-left text-[12px] transition-colors disabled:opacity-60"
                  style={{
                    borderColor: isSelected ? "var(--leemo-amber)" : "var(--leemo-line)",
                    background: isSelected ? "var(--leemo-amber-soft)" : "var(--leemo-card)",
                    color: isSelected ? "var(--leemo-amber-strong)" : "var(--leemo-ink-2)",
                  }}
                >
                  <span className="min-w-0">
                    <span className="block font-medium leading-5">{opt.label}</span>
                    {opt.description && (
                      <span className="mt-0.5 block leading-4" style={{ color: "var(--leemo-ink-3)" }}>{opt.description}</span>
                    )}
                  </span>
                  <span className="grid h-[18px] w-[18px] place-items-center rounded-full border" style={{ borderColor: isSelected ? "var(--leemo-amber)" : "var(--leemo-line)" }}>
                    {isSelected ? <Check className="h-3 w-3" aria-hidden /> : null}
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
            className="w-full rounded-[7px] border px-2.5 py-1.5 text-[12px] outline-none transition-colors disabled:opacity-60"
            style={{
              borderColor: "var(--leemo-line)",
              background: "white",
            }}
            onFocus={(e) => {
              e.target.style.borderColor = "var(--leemo-amber)";
            }}
            onBlur={(e) => {
              e.target.style.borderColor = "var(--leemo-line)";
            }}
          />
        </div>
      ))}
      <button
        type="button"
        disabled={!allAnswered || isSubmitting}
        onClick={() => void handleSubmit()}
        className="ml-auto block rounded-[8px] px-4 py-[7px] text-[12.5px] font-medium text-white transition-opacity disabled:opacity-40"
        style={{ background: "var(--leemo-ink)" }}
      >
        提交
      </button>
    </div>
  );
}
