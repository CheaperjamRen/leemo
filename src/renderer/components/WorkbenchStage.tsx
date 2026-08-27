import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Columns2, FileText, GripVertical, MessageCircle } from "lucide-react";
import { useUi } from "../bridge/context";
import { DEFAULT_SPLIT_RATIO } from "../stores/workbench-scope";
import {
  WORKBENCH_CONVERSATION_MIN_WIDTH,
  WORKBENCH_FILE_MIN_WIDTH,
  WORKBENCH_STAGE_SPLIT_HANDLE_WIDTH,
  WORKBENCH_STAGE_SPLIT_MIN_WIDTH,
} from "../workbench-spatial";

const FOCUS_THRESHOLD = 0.18;

export interface WorkbenchStageProps {
  conversation: ReactNode;
  file: ReactNode | null;
  hasFile: boolean;
  fileKey?: string | null;
  conversationMarker?: ReactNode;
}

type StageSurface = "conversation" | "file";

function useStageWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(() => typeof window === "undefined" ? 1280 : window.innerWidth);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const measured = element.getBoundingClientRect().width;
      setWidth(measured > 0 ? measured : window.innerWidth);
    };
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

export default function WorkbenchStage({
  conversation,
  file,
  hasFile,
  fileKey,
  conversationMarker,
}: WorkbenchStageProps): React.JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null);
  const conversationSurfaceRef = useRef<HTMLElement>(null);
  const fileSurfaceRef = useRef<HTMLElement>(null);
  const focusFileKeyRef = useRef<string | null | undefined>(undefined);
  const focusHadFileRef = useRef(false);
  const width = useStageWidth(stageRef);
  const activeScopeKey = useUi((state) => state.activeScopeKey);
  const session = useUi((state) => state.scopeSessions[state.activeScopeKey]);
  const setScopeSurface = useUi((state) => state.setScopeSurface);
  const setScopeSplitRatio = useUi((state) => state.setScopeSplitRatio);
  const surfacePreference = session?.surfacePreference ?? "split";
  const storedRatio = session?.splitRatio ?? DEFAULT_SPLIT_RATIO;
  const canSplit = width >= WORKBENCH_STAGE_SPLIT_MIN_WIDTH;
  const layout = !hasFile
    ? "conversation"
    : surfacePreference === "split" && canSplit
      ? "split"
      : "tabs";
  const [tabSurface, setTabSurface] = useState<StageSurface>(
    hasFile && surfacePreference !== "conversation" ? "file" : "conversation",
  );
  const previousScopeKeyRef = useRef(activeScopeKey);
  const previousFileKeyRef = useRef<string | null | undefined>(fileKey);
  const [liveRatio, setLiveRatio] = useState<number | null>(null);
  const dragRef = useRef<{ pointerId: number; left: number; width: number } | null>(null);

  useEffect(() => {
    const scopeChanged = previousScopeKeyRef.current !== activeScopeKey;
    const fileChanged = Boolean(fileKey) && previousFileKeyRef.current !== fileKey;
    previousScopeKeyRef.current = activeScopeKey;
    previousFileKeyRef.current = fileKey;
    if (!hasFile) {
      setTabSurface("conversation");
    } else if (scopeChanged) {
      setTabSurface(surfacePreference === "conversation" ? "conversation" : "file");
    } else if (fileChanged || surfacePreference === "file") {
      setTabSurface("file");
    } else if (surfacePreference === "conversation") {
      setTabSurface("conversation");
    }
  }, [activeScopeKey, fileKey, hasFile, surfacePreference]);

  const effectiveTabSurface: StageSurface = !canSplit
    ? tabSurface
    : surfacePreference === "file"
      ? "file"
      : surfacePreference === "conversation"
        ? "conversation"
        : tabSurface;
  const splitRatio = liveRatio ?? storedRatio;
  const usableWidth = Math.max(1, width - WORKBENCH_STAGE_SPLIT_HANDLE_WIDTH);
  const conversationWidth = Math.min(
    Math.max(WORKBENCH_CONVERSATION_MIN_WIDTH, usableWidth * splitRatio),
    Math.max(WORKBENCH_CONVERSATION_MIN_WIDTH, usableWidth - WORKBENCH_FILE_MIN_WIDTH),
  );

  const chooseTab = (surface: StageSurface): void => {
    if (!canSplit) {
      setTabSurface(surface);
      return;
    }
    setScopeSurface(surface);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, left: bounds.left, width: bounds.width };
  };

  const ratioFromPointer = (clientX: number): number | null => {
    const drag = dragRef.current;
    if (!drag) return null;
    return (clientX - drag.left) / Math.max(1, drag.width);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (!dragRef.current || !event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
    const raw = ratioFromPointer(event.clientX);
    if (raw === null) return;
    const minRatio = WORKBENCH_CONVERSATION_MIN_WIDTH / Math.max(1, width - WORKBENCH_STAGE_SPLIT_HANDLE_WIDTH);
    const maxRatio = 1 - WORKBENCH_FILE_MIN_WIDTH / Math.max(1, width - WORKBENCH_STAGE_SPLIT_HANDLE_WIDTH);
    setLiveRatio(Math.min(maxRatio, Math.max(minRatio, raw)));
  };

  const finishResize = (event: ReactPointerEvent<HTMLButtonElement>, canceled = false): void => {
    const raw = ratioFromPointer(event.clientX);
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && event.currentTarget.hasPointerCapture?.(drag.pointerId)) {
      event.currentTarget.releasePointerCapture?.(drag.pointerId);
    }
    setLiveRatio(null);
    if (canceled || raw === null) return;
    if (raw <= FOCUS_THRESHOLD) {
      setScopeSurface("file");
    } else if (raw >= 1 - FOCUS_THRESHOLD) {
      setScopeSurface("conversation");
    } else {
      const usableDragWidth = Math.max(1, (drag?.width ?? width) - WORKBENCH_STAGE_SPLIT_HANDLE_WIDTH);
      const minRatio = WORKBENCH_CONVERSATION_MIN_WIDTH / usableDragWidth;
      const maxRatio = 1 - WORKBENCH_FILE_MIN_WIDTH / usableDragWidth;
      setScopeSplitRatio(Math.min(maxRatio, Math.max(minRatio, raw)));
    }
  };

  const conversationVisible = layout !== "tabs" || effectiveTabSurface === "conversation";
  const fileVisible = hasFile && (layout !== "tabs" || effectiveTabSurface === "file");

  useEffect(() => {
    const openedOrReplaced = hasFile
      && layout === "tabs"
      && (!focusHadFileRef.current || focusFileKeyRef.current !== fileKey);
    const closed = focusHadFileRef.current && !hasFile;
    focusHadFileRef.current = hasFile;
    focusFileKeyRef.current = fileKey;
    if (!openedOrReplaced && !closed) return undefined;

    const frame = window.requestAnimationFrame(() => {
      if (openedOrReplaced) {
        fileSurfaceRef.current?.focus({ preventScroll: true });
        return;
      }
      const conversation = conversationSurfaceRef.current;
      const composer = conversation?.querySelector<HTMLElement>('textarea[aria-label="输入消息"]:not([disabled])');
      (composer ?? conversation)?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fileKey, hasFile, layout]);

  return (
    <div
      ref={stageRef}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      data-testid="workbench-stage"
      data-layout={layout}
    >
      {layout === "tabs" && (
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-[var(--leemo-line)] bg-[var(--leemo-panel)] px-2" role="tablist" aria-label="工作表面">
          <button
            type="button"
            role="tab"
            aria-selected={effectiveTabSurface === "conversation"}
            onClick={() => chooseTab("conversation")}
            className={`flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors ${effectiveTabSurface === "conversation" ? "bg-[var(--leemo-card)] font-medium text-[var(--leemo-ink)] shadow-sm" : "text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-side-hover)]"}`}
          >
            <MessageCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>对话</span>
            {conversationMarker}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={effectiveTabSurface === "file"}
            onClick={() => chooseTab("file")}
            className={`flex h-7 min-w-0 max-w-[260px] items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors ${effectiveTabSurface === "file" ? "bg-[var(--leemo-card)] font-medium text-[var(--leemo-ink)] shadow-sm" : "text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-side-hover)]"}`}
          >
            <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>文件</span>
          </button>
          {canSplit && (
            <button
              type="button"
              className="leemo-icon-btn ml-auto h-7 w-7"
              aria-label="恢复并排"
              title="恢复并排"
              onClick={() => setScopeSurface("split")}
            >
              <Columns2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      )}

      <div
        className={layout === "split" ? "grid min-h-0 min-w-0 flex-1" : "relative flex min-h-0 min-w-0 flex-1"}
        style={layout === "split" ? { gridTemplateColumns: `${conversationWidth}px ${WORKBENCH_STAGE_SPLIT_HANDLE_WIDTH}px minmax(0, 1fr)` } : undefined}
      >
        <section
          ref={conversationSurfaceRef}
          className={`${layout === "split" ? "min-w-0" : "absolute inset-0"} flex min-h-0 flex-col ${conversationVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}
          data-testid="conversation-surface"
          aria-hidden={!conversationVisible || undefined}
          inert={!conversationVisible || undefined}
        >
          {conversation}
        </section>

        {layout === "split" && (
          <button
            type="button"
            aria-label="调整对话和文件宽度"
            title="拖动调整宽度，双击恢复默认"
            className="group relative grid min-h-0 cursor-col-resize place-items-center text-[var(--leemo-ink-3)] focus:outline-none"
            data-testid="workbench-stage-split-handle"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(event) => finishResize(event)}
            onPointerCancel={(event) => finishResize(event, true)}
            onDoubleClick={() => setScopeSplitRatio(DEFAULT_SPLIT_RATIO)}
          >
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--leemo-line)] transition-colors group-hover:bg-[var(--leemo-amber)] group-focus:bg-[var(--leemo-amber)]" aria-hidden />
            <GripVertical className="relative h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100" aria-hidden />
          </button>
        )}

        {hasFile && (
          <section
            ref={fileSurfaceRef}
            className={`${layout === "split" ? "min-w-0 border-l border-[var(--leemo-line-soft)]" : "absolute inset-0"} flex min-h-0 flex-col ${fileVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}
            data-testid="file-surface"
            data-preview-column="true"
            aria-label="文件预览"
            aria-hidden={!fileVisible || undefined}
            inert={!fileVisible || undefined}
            tabIndex={layout === "tabs" ? -1 : undefined}
          >
            {file}
          </section>
        )}
      </div>
    </div>
  );
}
