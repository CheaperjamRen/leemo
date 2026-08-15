import { useState, useEffect, useCallback, type RefObject } from "react";
import { BookOpenText, Copy, Languages, ListCollapse, PenLine, Sparkles } from "lucide-react";
import { useWikiEntries } from "../bridge/context";

interface SelectionMenuProps {
  workspaceId: string;
  filePath: string | null;
  selectionRoot?: RefObject<HTMLElement | null>;
  onRewrite?: (selectedText: string) => void;
}

interface MenuPos {
  x: number;
  y: number;
}

export default function SelectionMenu({ workspaceId, filePath, selectionRoot, onRewrite }: SelectionMenuProps) {
  const [pos, setPos] = useState<MenuPos | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const openPopup = useWikiEntries((s) => s.openPopup);
  const ask = useWikiEntries((s) => s.ask);

  const compact = window.innerWidth < 480;
  const menuWidth = compact ? (onRewrite ? 256 : 216) : (onRewrite ? 438 : 370);
  const menuHeight = 42;

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setPos(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const selectedNode = range.commonAncestorContainer;
    if (selectionRoot?.current && !selectionRoot.current.contains(selectedNode)) {
      setPos(null);
      return;
    }
    const text = sel.toString().trim().slice(0, 12_000);
    if (!text) { setPos(null); return; }
    const rect = range.getBoundingClientRect();
    const renderedWidth = Math.min(menuWidth, Math.max(0, window.innerWidth - 16));
    const x = Math.min(Math.max(rect.left, 8), Math.max(8, window.innerWidth - renderedWidth - 8));
    const below = rect.bottom + 8;
    const y = below + menuHeight <= window.innerHeight - 8
      ? below
      : Math.max(8, rect.top - menuHeight - 8);
    setSelectedText(text);
    setPos({ x, y });
  }, [menuHeight, menuWidth, selectionRoot]);

  const handleClickOutside = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) setPos(null);
  }, []);

  useEffect(() => {
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("click", handleClickOutside);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("click", handleClickOutside);
    };
  }, [handleMouseUp, handleClickOutside]);

  if (!pos) return null;

  const handleAsk = () => {
    if (filePath) openPopup(workspaceId, filePath, selectedText);
    setPos(null);
  };

  const handlePreset = (question: string) => {
    if (filePath) {
      openPopup(workspaceId, filePath, selectedText);
      void ask(question).catch(() => undefined);
    }
    setPos(null);
  };

  const handleCopy = () => {
    void navigator.clipboard.writeText(selectedText);
    setPos(null);
  };

  const handleRewrite = () => {
    onRewrite?.(selectedText);
    setPos(null);
  };

  return (
    <div
      data-testid="selection-menu"
      role="toolbar"
      aria-label="选中文本操作"
      style={{ position: "fixed", left: pos.x, top: pos.y, width: menuWidth, maxWidth: "calc(100vw - 16px)", zIndex: 50 }}
      className="flex h-[42px] items-center overflow-hidden rounded-[8px] border border-[var(--leemo-line)] bg-[var(--leemo-panel)] px-1.5 shadow-[0_6px_20px_rgba(15,23,42,0.12)]"
      onMouseDown={(e) => e.preventDefault()}
    >
      <button onClick={handleAsk} className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[5px] px-2 text-[12px] text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink)]">
        <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className={compact ? "sr-only" : "whitespace-nowrap"}>问 momo</span>
      </button>
      {onRewrite && (
        <button onClick={handleRewrite} className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 border-l border-[var(--leemo-line)] px-2 text-[12px] text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink)]">
          <PenLine className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className={compact ? "sr-only" : "whitespace-nowrap"}>改写</span>
        </button>
      )}
      <button onClick={() => handlePreset("请解释这段内容，用简洁的中文说明它在说什么。")} className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 border-l border-[var(--leemo-line)] px-2 text-[12px] text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink)]">
        <BookOpenText className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className={compact ? "sr-only" : undefined}>解释</span>
      </button>
      <button onClick={() => handlePreset("请概括这段内容的核心意思。")} className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 border-l border-[var(--leemo-line)] px-2 text-[12px] text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink)]">
        <ListCollapse className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className={compact ? "sr-only" : undefined}>摘要</span>
      </button>
      <button onClick={() => handlePreset("把这段内容翻译成中文。")} className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 border-l border-[var(--leemo-line)] px-2 text-[12px] text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink)]">
        <Languages className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className={compact ? "sr-only" : undefined}>翻译</span>
      </button>
      <button onClick={handleCopy} className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 border-l border-[var(--leemo-line)] px-2 text-[12px] text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink)]">
        <Copy className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className={compact ? "sr-only" : undefined}>复制</span>
      </button>
    </div>
  );
}
