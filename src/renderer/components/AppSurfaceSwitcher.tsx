import { LayoutDashboard, MessageCircle, PanelLeft } from "lucide-react";
import { useSettings } from "../bridge/context";

export default function AppSurfaceSwitcher({ className = "" }: { className?: string }) {
  const surface = useSettings((state) => state.surface);
  const setSurface = useSettings((state) => state.setSurface);
  return (
    <nav aria-label="工作区切换" className={`leemo-surface-switcher ${className}`.trim()}>
      <button type="button" aria-label="切换到开始" title="开始" aria-pressed={surface === "start"} onClick={() => setSurface("start")}>
        <LayoutDashboard aria-hidden />
        <span>开始</span>
      </button>
      <button type="button" aria-label="切换到搭子" title="搭子" aria-pressed={surface === "buddy"} onClick={() => setSurface("buddy")}>
        <MessageCircle aria-hidden />
        <span>搭子</span>
      </button>
      <button type="button" aria-label="切换到工作台" title="工作台" aria-pressed={surface === "workbench"} onClick={() => setSurface("workbench")}>
        <PanelLeft aria-hidden />
        <span>工作台</span>
      </button>
    </nav>
  );
}
