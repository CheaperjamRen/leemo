import { useState } from "react";

export default function InputBox({
  value, onChange, onSend, busy = false, onStop,
}: { value: string; onChange: (v: string) => void; onSend: (v: string) => void; busy?: boolean; onStop?: () => void }) {
  const [composing, setComposing] = useState(false);
  const submit = () => {
    const t = value.trim();
    if (t) { onSend(t); onChange(""); }
  };
  return (
    <div className="leemo-input-shadow mx-auto flex w-full max-w-[640px] items-center gap-3 rounded-[24px] border border-[var(--leemo-line)] bg-white px-5 py-[15px] transition-all duration-200 focus-within:border-[var(--leemo-amber)] focus-within:ring-4 focus-within:ring-[var(--leemo-amber-soft)]/50">
      <input
        aria-label="跟 momo 说点什么"
        placeholder="跟 momo 说点什么…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onKeyDown={(e) => { if (e.key === "Enter" && !composing && !busy) { e.preventDefault(); submit(); } }}
        className="w-full bg-transparent text-[15px] text-[var(--leemo-ink)] caret-[var(--leemo-amber)] outline-none placeholder:text-[var(--leemo-ink-3)]"
      />
      {busy ? (
        <button aria-label="停止" onClick={() => onStop?.()}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--leemo-ink)] text-white shadow-sm transition-colors hover:bg-black">
          <span className="block h-3 w-3 rounded-[2px] bg-white" aria-hidden />
        </button>
      ) : (
        <button aria-label="发送" onClick={submit}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--leemo-amber)] text-white shadow-sm transition-colors hover:bg-[var(--leemo-amber-strong)]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]" aria-hidden>
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
          </svg>
        </button>
      )}
    </div>
  );
}
