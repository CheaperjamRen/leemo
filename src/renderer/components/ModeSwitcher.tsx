import { MessageCircle, PanelLeft } from "lucide-react";
import { useSettings } from "../bridge/context";

export default function ModeSwitcher({ className = "", compact = false, collapsed = false }: { className?: string; compact?: boolean; collapsed?: boolean }) {
  const mode = useSettings((state) => state.mode);
  const setMode = useSettings((state) => state.setMode);

  if (collapsed) {
    const buddy = mode === "buddy";
    return (
      <button
        type="button"
        aria-label={buddy ? "切换到工作台" : "切换到搭子"}
        title={buddy ? "搭子" : "工作台"}
        aria-pressed={buddy}
        onClick={() => setMode(buddy ? "workbench" : "buddy")}
        className="leemo-icon-btn"
      >
        {buddy ? <MessageCircle className="h-4 w-4" aria-hidden /> : <PanelLeft className="h-4 w-4" aria-hidden />}
      </button>
    );
  }

  return (
    <nav aria-label="模式切换" className={`leemo-mode-switcher ${compact ? "leemo-mode-switcher-compact" : ""} ${className}`.trim()}>
      <button type="button" aria-label="切换到搭子" title="搭子" aria-pressed={mode === "buddy"} onClick={() => setMode("buddy")}>
        <MessageCircle className="h-3.5 w-3.5" aria-hidden />
        {!compact && "搭子"}
      </button>
      <button type="button" aria-label="切换到工作台" title="工作台" aria-pressed={mode === "workbench"} onClick={() => setMode("workbench")}>
        <PanelLeft className="h-3.5 w-3.5" aria-hidden />
        {!compact && "工作台"}
      </button>
    </nav>
  );
}
