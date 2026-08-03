import { useState, useEffect, useCallback, type RefObject } from "react";
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

  const menuWidth = 200;

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
    const x = Math.min(Math.max(rect.left, 8), window.innerWidth - menuWidth - 8);
    const y = Math.max(8, rect.top - 40);
    setSelectedText(text);
    setPos({ x, y });
  }, [menuWidth, selectionRoot]);

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

  const handleTranslate = async () => {
    if (filePath) {
      openPopup(workspaceId, filePath, selectedText);
      await ask("把这段翻译成中文");
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
      style={{ position: "fixed", left: pos.x, top: pos.y, width: menuWidth, zIndex: 50 }}
      className="flex gap-1 rounded-lg border border-[var(--leemo-line)] bg-[var(--leemo-panel)] p-1 shadow-lg"
      onMouseDown={(e) => e.preventDefault()}
    >
      <button onClick={handleAsk} className="flex-1 rounded px-2 py-1 text-xs hover:bg-[var(--leemo-side-hover)]">问一下</button>
      {onRewrite && <button onClick={handleRewrite} className="flex-1 rounded px-2 py-1 text-xs hover:bg-[var(--leemo-side-hover)]">改写</button>}
      <button onClick={() => void handleTranslate()} className="flex-1 rounded px-2 py-1 text-xs hover:bg-[var(--leemo-side-hover)]">翻译</button>
      <button onClick={handleCopy} className="flex-1 rounded px-2 py-1 text-xs hover:bg-[var(--leemo-side-hover)]">复制</button>
    </div>
  );
}
