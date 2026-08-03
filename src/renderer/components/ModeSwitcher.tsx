import { MessageCircle, PanelLeft } from "lucide-react";
import { useSettings } from "../bridge/context";

export default function ModeSwitcher({ className = "" }: { className?: string }) {
  const mode = useSettings((state) => state.mode);
  const setMode = useSettings((state) => state.setMode);

  return (
    <nav aria-label="模式切换" className={`leemo-mode-switcher ${className}`.trim()}>
      <button type="button" aria-pressed={mode === "buddy"} onClick={() => setMode("buddy")}>
        <MessageCircle className="h-3.5 w-3.5" aria-hidden />
        搭子
      </button>
      <button type="button" aria-pressed={mode === "workbench"} onClick={() => setMode("workbench")}>
        <PanelLeft className="h-3.5 w-3.5" aria-hidden />
        工作台
      </button>
    </nav>
  );
}
