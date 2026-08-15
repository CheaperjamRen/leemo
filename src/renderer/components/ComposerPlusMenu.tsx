import { Check, FileText, Lightbulb, Target } from "lucide-react";

export default function ComposerPlusMenu({
  open,
  fileEnabled,
  planModeActive,
  hasGoal,
  onPickFile,
  onTogglePlanMode,
  onOpenGoal,
}: {
  open: boolean;
  fileEnabled: boolean;
  planModeActive: boolean;
  hasGoal: boolean;
  onPickFile: () => void;
  onTogglePlanMode: () => void;
  onOpenGoal: () => void;
}) {
  if (!open) return null;
  return (
    <div
      role="menu"
      aria-label="添加到对话"
      className="absolute bottom-[calc(100%+8px)] left-2 right-2 z-40 rounded-[14px] border border-[var(--leemo-line)] bg-[var(--leemo-card)] p-1.5 shadow-[var(--leemo-shadow-popover)] sm:right-auto sm:w-[440px]"
    >
      <button
        type="button"
        role="menuitem"
        disabled={!fileEnabled}
        onClick={onPickFile}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-[var(--leemo-hover)] disabled:cursor-not-allowed disabled:opacity-45"
      >
        <FileText className="h-4 w-4 text-[var(--leemo-ink-3)]" aria-hidden />
        <span>
          <span className="block text-sm text-[var(--leemo-ink)]">文件</span>
          <span className="block text-[12px] text-[var(--leemo-ink-3)]">从电脑选择并加入对话</span>
        </span>
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={planModeActive}
        onClick={onTogglePlanMode}
        className={`mt-0.5 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[var(--leemo-hover)] ${
          planModeActive ? "bg-[var(--leemo-amber-soft)]" : ""
        }`}
      >
        <Lightbulb
          className={`h-4 w-4 ${planModeActive ? "text-[var(--leemo-amber-strong)]" : "text-[var(--leemo-ink-3)]"}`}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-[var(--leemo-ink)]">计划模式</span>
          <span className="block text-[12px] text-[var(--leemo-ink-3)]">先分析与给方案，不执行改动</span>
        </span>
        {planModeActive && <Check className="h-4 w-4 shrink-0 text-[var(--leemo-amber-strong)]" aria-hidden />}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onOpenGoal}
        className="mt-0.5 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[var(--leemo-hover)]"
      >
        <Target className="h-4 w-4 text-[var(--leemo-ink-3)]" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-[var(--leemo-ink)]">目标模式</span>
          <span className="block text-[12px] text-[var(--leemo-ink-3)]">
            {hasGoal ? "查看或修改当前目标" : "持续追踪一个长期目标"}
          </span>
        </span>
      </button>
    </div>
  );
}
