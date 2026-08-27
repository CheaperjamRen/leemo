import { FileText } from "lucide-react";
import type { WorkspaceFileNode } from "../workspace/client";

interface FileMentionMenuProps {
  files: WorkspaceFileNode[];
  selectedIndex: number;
  onPick(file: WorkspaceFileNode): void;
  onHover(index: number): void;
}

export default function FileMentionMenu({ files, selectedIndex, onPick, onHover }: FileMentionMenuProps) {
  if (files.length === 0) return null;

  return (
    <div
      data-composer-popover=""
      className="absolute bottom-full left-0 z-20 mb-2 max-h-64 w-[min(360px,calc(100vw-48px))] overflow-y-auto rounded-[8px] border border-[var(--leemo-line)] bg-white p-1 shadow-lg"
      data-testid="file-mention-menu"
    >
      <div className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-medium text-[var(--leemo-ink-3)]">
        当前工作区
      </div>
      <ul role="listbox" aria-label="引用工作区文件">
        {files.map((file, index) => (
          <li
            key={file.path}
            role="option"
            aria-label={`${file.name} ${file.path}`}
            aria-selected={index === selectedIndex}
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(file);
            }}
            onMouseEnter={() => onHover(index)}
            className={`flex cursor-pointer items-center gap-2 rounded-[6px] px-2.5 py-2 ${
              index === selectedIndex ? "bg-[var(--leemo-amber-bg)]" : "hover:bg-[var(--leemo-hover)]"
            }`}
          >
            <FileText className="h-4 w-4 shrink-0 text-[var(--leemo-ink-3)]" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-[var(--leemo-ink)]">{file.name}</div>
              <div className="truncate text-[11px] text-[var(--leemo-ink-3)]">{file.path}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
