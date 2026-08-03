import { useNotebooks } from "../bridge/context";

/**
 * 06 §2.2 归类确认条: when a file is dropped with NO notebook context, momo
 * proposes where it belongs and the user nods or changes it. Files dropped
 * *into* a notebook never reach this bar — they land directly (also 06 §2.2).
 *
 * The suggestion is a deterministic local heuristic (workspace.ts
 * suggestNotebook), not a model call: a drag-and-drop has to answer instantly,
 * and the design only asks for a proposal the user confirms. Upgrading to a real
 * model judgment changes that function alone; this component is unaffected.
 */
export interface PendingDrop {
  /** Absolute OS paths, already resolved via workspace.pathForFile. */
  sources: string[];
  /** The workspace selected when the OS drop happened. Confirmation must
   * never reinterpret these paths against whichever workspace is active later. */
  workspaceId: string;
  /** Managed book selected at drop time. `null` means Leemo 工作台 or an
   * external book; confirmation must still match this exact visible scope. */
  bookId: string | null;
  /** Display name of the first file — what momo's sentence is about. */
  fileName: string;
  /** momo's guess, or null = "can't tell" → 默认工作区. */
  suggestion: string | null;
}

export default function DropClassifyBar({
  drop,
  onConfirm,
  onCancel,
}: {
  drop: PendingDrop;
  onConfirm: (notebookId: string | null) => void;
  onCancel: () => void;
}) {
  const notebooks = useNotebooks((s) => s.list);
  const many = drop.sources.length > 1;
  const subject = many ? `${drop.fileName} 等 ${drop.sources.length} 个文件` : drop.fileName;

  return (
    <div
      className="mx-auto mb-2 w-full max-w-[720px] rounded-xl border border-[var(--leemo-amber-line)] bg-[var(--leemo-amber-bg)] px-3.5 py-2.5"
      data-testid="drop-classify-bar"
      role="group"
      aria-label="文件归类确认"
    >
      <p className="text-[12.5px] text-[var(--leemo-ink-2)]">
        {drop.suggestion
          ? `「${subject}」放进「${drop.suggestion}」本子？`
          : `「${subject}」放哪个本子？拿不准就先暂不归入本子。`}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {drop.suggestion && (
          <button
            className="rounded-full bg-[var(--leemo-ink)] px-3 py-1 text-[11.5px] text-white"
            onClick={() => onConfirm(drop.suggestion)}
            data-testid="drop-confirm-suggestion"
          >
            好
          </button>
        )}
        {notebooks
          .filter((nb) => nb.id !== drop.suggestion)
          .map((nb) => (
            <button
              key={nb.id}
              className="rounded-full border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-3 py-1 text-[11.5px] text-[var(--leemo-ink-2)] hover:border-[var(--leemo-amber-line)]"
              onClick={() => onConfirm(nb.id)}
              data-testid={`drop-choose-${nb.id}`}
            >
              {nb.title}
            </button>
          ))}
        <button
          className="rounded-full border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-3 py-1 text-[11.5px] text-[var(--leemo-ink-2)] hover:border-[var(--leemo-amber-line)]"
          onClick={() => onConfirm(null)}
          data-testid="drop-choose-default-workspace"
        >
          暂不归入本子
        </button>
        <button
          className="ml-auto text-[11.5px] text-[var(--leemo-ink-3)] hover:text-[var(--leemo-ink-2)]"
          onClick={onCancel}
          data-testid="drop-cancel"
        >
          不用了
        </button>
      </div>
    </div>
  );
}
