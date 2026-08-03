/** Scroll-out-of-view hint for a pending ask_user question (卡 D §6).
 *  Swaps in for BackToBottom's plain circular arrow — never both at once —
 *  when momo is waiting on an answer that's scrolled off screen. Pure
 *  presentational component (same {show, onClick} shape as BackToBottom.tsx)
 *  so the mutual-exclusion logic lives in Timeline.tsx, not here. */
export default function PendingQuestionPill({ show, onClick }: { show: boolean; onClick: () => void }) {
  if (!show) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="leemo-fab absolute bottom-4 right-4 z-20 flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-[12.5px] font-medium animate-[fadeIn_.2s_ease]"
      style={{
        borderColor: "var(--leemo-amber-line)",
        background: "var(--leemo-amber-bg)",
        color: "var(--leemo-amber-strong)",
      }}
    >
      <span aria-hidden>⌄</span>
      有个问题等你回答
    </button>
  );
}
