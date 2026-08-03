import { useEffect, useState } from "react";
import { useWikiEntries } from "../bridge/context";
import MarkdownContent from "./MarkdownContent";

export default function WikiPopup() {
  const active = useWikiEntries((s) => s.active);
  const entries = useWikiEntries((s) => s.entries);
  const ask = useWikiEntries((s) => s.ask);
  const toggleDetailed = useWikiEntries((s) => s.toggleDetailed);
  const closePopup = useWikiEntries((s) => s.closePopup);
  const [draft, setDraft] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setDraft("");
    setSubmitError(null);
    setSubmitting(false);
  }, [active?.entryId]);

  useEffect(() => {
    if (!active?.failedQuestion) return;
    setDraft((current) => current.trim() ? current : active.failedQuestion ?? "");
  }, [active?.failedQuestion]);

  if (!active) return null;

  const entry = entries.find((e) => e.id === active.entryId);
  if (!entry) return null;

  const fileName = entry.filePath.split("/").pop() ?? entry.filePath;
  const hasTurns = entry.turns.length > 0;
  const loading = (active.streaming || submitting) && !hasTurns;
  const visibleError = submitError ?? active.error;

  const submit = () => {
    const text = draft.trim();
    if (!text || active.streaming || submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    void ask(text)
      .then(() => setDraft((current) => current.trim() === text ? "" : current))
      .catch((error: unknown) => {
        setSubmitError(error instanceof Error ? error.message : "暂时没能发送，请稍后重试。");
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <div
      data-testid="wiki-popup"
      style={{ position: "fixed", bottom: 24, right: 24, width: 380, zIndex: 50 }}
      className="flex max-h-[70vh] flex-col overflow-hidden rounded-xl border border-[var(--leemo-line)] bg-[var(--leemo-panel)] shadow-xl"
      data-shell="workbench"
    >
      {/* 引用条 */}
      <div className="flex items-start gap-2 border-b border-[var(--leemo-line)] px-4 py-2.5">
        <div className="min-w-0 flex-1 border-l-2 border-[var(--leemo-amber)] pl-2.5">
          <div className="truncate text-[11px] text-[var(--leemo-ink-3)]">{fileName}</div>
          <div className="line-clamp-2 text-xs text-[var(--leemo-ink-2)]">{entry.quotedText}</div>
        </div>
        <button aria-label="关闭" onClick={closePopup} className="leemo-icon-btn shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="h-4 w-4" aria-hidden>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 回答区 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <div data-testid="wiki-loading" className="flex items-center gap-2 text-xs text-[var(--leemo-ink-3)]">
            <span className="leemo-spin inline-block h-3 w-3 rounded-full border border-[var(--leemo-line-2)] border-t-[var(--leemo-amber)]" />
            正在思考…
          </div>
        ) : hasTurns ? (
          <div className="space-y-3">
            {entry.turns.map((turn, i) => (
              <div key={i} className="space-y-1.5">
                <div className="text-xs font-medium text-[var(--leemo-ink-2)]">{turn.question}</div>
                <div className="text-[var(--leemo-ink)]">
                  <MarkdownContent text={turn.answer} variant="process" />
                  {active.streaming && i === entry.turns.length - 1 && (
                    <span aria-hidden className="leemo-caret ml-[3px] inline-block h-[13px] w-[3px] translate-y-[2px] rounded-[1.5px] bg-[var(--leemo-amber)]" />
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-[var(--leemo-ink-3)]">选中了一段内容，问点什么吧。</div>
        )}
      </div>

      {/* 详细一点开关 */}
      <div className="flex items-center justify-end gap-2 border-t border-[var(--leemo-line)] px-4 py-2">
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--leemo-ink-3)]">
          <span>详细一点</span>
          <input
            type="checkbox"
            aria-label="详细一点"
            checked={active.detailed}
            onChange={(e) => toggleDetailed(e.target.checked)}
            className="accent-[var(--leemo-amber)]"
          />
        </label>
      </div>

      {/* 追问输入框 */}
      <div className="border-t border-[var(--leemo-line)] p-2.5">
        {visibleError && (
          <div role="alert" className="mb-2 text-[11px] leading-4 text-[var(--leemo-danger)]">
            {visibleError}
          </div>
        )}
        <textarea
          placeholder="追问…"
          value={draft}
          disabled={active.streaming || submitting}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          className="w-full resize-none rounded-lg border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-3 py-2 text-[13px] text-[var(--leemo-ink)] placeholder-[var(--leemo-ink-3)] outline-none focus:border-[var(--leemo-amber)] disabled:opacity-50"
        />
      </div>
    </div>
  );
}
