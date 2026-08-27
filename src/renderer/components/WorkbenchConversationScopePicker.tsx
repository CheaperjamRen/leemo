import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  Folder,
  House,
} from "lucide-react";
import AnchoredLayer from "./AnchoredLayer";

export interface WorkbenchConversationScopeValue {
  workspaceId: string;
  bookId: string | null;
}

export interface WorkbenchConversationScopeOption extends WorkbenchConversationScopeValue {
  label: string;
  kind: "default" | "notebook" | "workspace";
  archived?: boolean;
  available?: boolean;
}

interface WorkbenchConversationScopePickerProps {
  value: WorkbenchConversationScopeValue;
  options: readonly WorkbenchConversationScopeOption[];
  onChange: (scope: WorkbenchConversationScopeValue) => void | Promise<void>;
  disabled?: boolean;
}

const itemClass = "flex min-h-10 w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[12px] text-[var(--leemo-ink-2)] transition-colors hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--leemo-amber-line)] disabled:cursor-not-allowed disabled:opacity-45";

function sameScope(
  left: WorkbenchConversationScopeValue,
  right: WorkbenchConversationScopeValue,
): boolean {
  return left.workspaceId === right.workspaceId && left.bookId === right.bookId;
}

function ScopeIcon({ kind }: Pick<WorkbenchConversationScopeOption, "kind">): React.JSX.Element {
  const className = "h-4 w-4 shrink-0 text-[var(--leemo-ink-3)]";
  if (kind === "default") return <House className={className} aria-hidden />;
  if (kind === "notebook") return <BookOpen className={className} aria-hidden />;
  return <Folder className={className} aria-hidden />;
}

export default function WorkbenchConversationScopePicker({
  value,
  options,
  onChange,
  disabled = false,
}: WorkbenchConversationScopePickerProps): React.JSX.Element {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visibleOptions = options.filter((option) => !option.archived);
  const selected = visibleOptions.find((option) => sameScope(option, value))
    ?? visibleOptions[0]
    ?? {
      ...value,
      label: "当前本子",
      kind: "workspace" as const,
    };

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => firstItemRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const dismiss = (): void => {
    setOpen(false);
    setError(null);
    triggerRef.current?.focus();
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const choose = async (option: WorkbenchConversationScopeOption): Promise<void> => {
    if (changing || option.available === false || sameScope(option, value)) {
      dismiss();
      return;
    }
    setChanging(true);
    setError(null);
    try {
      await onChange({ workspaceId: option.workspaceId, bookId: option.bookId });
      dismiss();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setChanging(false);
    }
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`对话归属：${selected.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || changing}
        onClick={() => {
          setError(null);
          setOpen((current) => !current);
        }}
        className="group flex h-9 max-w-[260px] items-center gap-2 rounded-[10px] border border-[var(--leemo-line)] bg-[var(--leemo-card)] px-3 text-[12px] text-[var(--leemo-ink-2)] shadow-[var(--leemo-shadow-resting)] transition-[background-color,border-color,color,box-shadow] hover:border-[var(--leemo-amber-line)] hover:bg-[var(--leemo-amber-bg)] hover:text-[var(--leemo-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--leemo-amber-line)] disabled:cursor-default disabled:opacity-55"
      >
        <ScopeIcon kind={selected.kind} />
        <span className="shrink-0 text-[var(--leemo-ink-3)]">保存到</span>
        <span className="min-w-0 truncate font-medium text-[var(--leemo-ink)]">{selected.label}</span>
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      <AnchoredLayer
        open={open}
        anchor={triggerRef}
        onDismiss={dismiss}
        preferred="bottom-start"
        role="menu"
        ariaLabel="选择对话归属"
        className="w-[280px] max-w-[calc(100vw-24px)] rounded-[12px] border border-[var(--leemo-line)] bg-[var(--leemo-card)] p-1.5 shadow-[var(--leemo-shadow-popover)]"
      >
        <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-medium text-[var(--leemo-ink-3)]">
          这段对话会和本子里的文件、记忆放在一起
        </div>
        {visibleOptions.map((option, index) => {
          const active = sameScope(option, value);
          return (
            <button
              key={`${option.workspaceId}\u0000${option.bookId ?? ""}`}
              ref={index === 0 ? firstItemRef : undefined}
              type="button"
              role="menuitem"
              aria-label={`将对话放入 ${option.label}`}
              aria-current={active ? "true" : undefined}
              disabled={changing || option.available === false}
              onClick={() => void choose(option)}
              className={`${itemClass} ${active ? "bg-[var(--leemo-amber-bg)] text-[var(--leemo-ink)]" : ""}`}
            >
              <ScopeIcon kind={option.kind} />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {active && <span className="text-[10px] text-[var(--leemo-copper)]">当前</span>}
            </button>
          );
        })}
        {error && (
          <p className="mx-2 mt-1 border-t border-[var(--leemo-line)] px-0.5 pt-2 text-[11px] text-[var(--leemo-danger)]" role="alert">
            {error}
          </p>
        )}
      </AnchoredLayer>
    </div>
  );
}
