import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  FileSearch,
  Focus,
  FolderOpen,
  ListTree,
  Menu,
  Minus,
  PanelLeft,
  Plus,
  RotateCw,
  Search,
  X,
} from "lucide-react";
import "pdfjs-dist/web/pdf_viewer.css";
import "./PdfView.css";
import {
  clampPdfPage,
  loadPdfReaderState,
  normalizePdfRotation,
  savePdfReaderState,
} from "./pdf-reader-state";

type PdfJsRuntime = typeof import("pdfjs-dist");
type ViewerRuntime = typeof import("pdfjs-dist/web/pdf_viewer.mjs");
type PdfDocument = Awaited<ReturnType<PdfJsRuntime["getDocument"]>["promise"]>;
type PdfViewer = InstanceType<ViewerRuntime["PDFViewer"]>;
type PdfEventBus = InstanceType<ViewerRuntime["EventBus"]>;
type PdfLinkService = InstanceType<ViewerRuntime["PDFLinkService"]>;

interface PdfOutlineItem {
  title: string;
  dest: string | unknown[] | null;
  items?: PdfOutlineItem[];
}

interface PdfViewProps {
  base64: string;
  title: string;
  fileId?: string;
  focused?: boolean;
  onFocusChange?: (focused: boolean) => void;
  onOpenExternal?: () => void | Promise<void>;
  onReveal?: () => void | Promise<void>;
  onCopyPermissionChange?: (restricted: boolean) => void;
}

interface FindCount {
  current: number;
  total: number;
}

interface PasswordPrompt {
  incorrect: boolean;
  updatePassword: (password: string) => void;
}

interface ReaderError {
  title: string;
  detail: string;
}

function bytesFrom(base64: string): Uint8Array {
  const binary = atob(base64);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
  return output;
}

function readerError(error: unknown): ReaderError {
  const message = error instanceof Error ? error.message : String(error);
  if (/invalid pdf|format error|bad xref|xref/i.test(message)) {
    return {
      title: "这份 PDF 已损坏或格式不完整",
      detail: "Leemo 没有修改文件。可以用系统默认程序再试，或在文件夹中检查原文件。",
    };
  }
  if (/password/i.test(message)) {
    return {
      title: "没有打开受保护的 PDF",
      detail: "密码没有通过或输入已取消。原文件仍然可以交给系统默认程序打开。",
    };
  }
  return {
    title: "这份 PDF 暂时打不开",
    detail: "文件没有被修改。可以用系统默认程序打开，或在文件夹中检查它。",
  };
}

function flattenOutline(items: PdfOutlineItem[], depth = 0): Array<PdfOutlineItem & { depth: number }> {
  return items.flatMap((item) => [
    { ...item, depth },
    ...flattenOutline(item.items ?? [], depth + 1),
  ]);
}

function PdfThumbnail({
  document,
  pageNumber,
  rotation,
  current,
  onSelect,
}: {
  document: PdfDocument;
  pageNumber: number;
  rotation: number;
  current: boolean;
  onSelect: () => void;
}) {
  const rootRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(pageNumber <= 3);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { root: root.parentElement, rootMargin: "180px 0px" });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let renderTask: { cancel?: () => void } | null = null;
    void (async () => {
      const page = await document.getPage(pageNumber);
      if (cancelled) return;
      const baseViewport = page.getViewport({ scale: 1, rotation });
      const viewport = page.getViewport({ scale: 92 / Math.max(1, baseViewport.width), rotation });
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      const outputScale = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
      canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      });
      await (renderTask as { promise: Promise<unknown> }).promise;
    })().catch((error: unknown) => {
      if (!cancelled && (error as { name?: string })?.name !== "RenderingCancelledException") {
        console.warn("PDF thumbnail render failed", error);
      }
    });
    return () => {
      cancelled = true;
      renderTask?.cancel?.();
    };
  }, [document, pageNumber, rotation, visible]);

  return (
    <button
      ref={rootRef}
      type="button"
      className="pdf-reader__thumbnail"
      aria-current={current ? "page" : undefined}
      aria-label={`第 ${pageNumber} 页`}
      onClick={onSelect}
    >
      {visible ? <canvas ref={canvasRef} aria-hidden /> : <span className="pdf-reader__thumbnail-placeholder" aria-hidden />}
      <span>{pageNumber}</span>
    </button>
  );
}

export default function PdfView({
  base64,
  title,
  fileId = title,
  focused = false,
  onFocusChange,
  onOpenExternal,
  onReveal,
  onCopyPermissionChange,
}: PdfViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerElementRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const viewerRef = useRef<PdfViewer | null>(null);
  const eventBusRef = useRef<PdfEventBus | null>(null);
  const linkServiceRef = useRef<PdfLinkService | null>(null);
  const loadingTaskRef = useRef<ReturnType<PdfJsRuntime["getDocument"]> | null>(null);
  const passwordCancelledRef = useRef(false);
  const copyPermissionCallbackRef = useRef(onCopyPermissionChange);
  const [document, setDocument] = useState<PdfDocument | null>(null);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<ReaderError | null>(null);
  const [passwordPrompt, setPasswordPrompt] = useState<PasswordPrompt | null>(null);
  const [password, setPassword] = useState("");
  const [pagesCount, setPagesCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [scalePercent, setScalePercent] = useState(100);
  const [scaleInput, setScaleInput] = useState("100");
  const [rotation, setRotation] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [findCount, setFindCount] = useState<FindCount>({ current: 0, total: 0 });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"thumbnails" | "outline">("thumbnails");
  const [outline, setOutline] = useState<Array<PdfOutlineItem & { depth: number }>>([]);
  const [outlineLoaded, setOutlineLoaded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [imageOnly, setImageOnly] = useState(false);
  const [copyRestricted, setCopyRestricted] = useState(false);

  useEffect(() => {
    copyPermissionCallbackRef.current = onCopyPermissionChange;
  }, [onCopyPermissionChange]);

  const dispatchFind = useCallback((nextQuery: string, findPrevious = false, again = false) => {
    const eventBus = eventBusRef.current;
    if (!eventBus) return;
    eventBus.dispatch("find", {
      source: rootRef.current,
      type: again ? "again" : "",
      query: nextQuery,
      phraseSearch: true,
      caseSensitive: false,
      entireWord: false,
      highlightAll: nextQuery.length > 0,
      findPrevious,
      matchDiacritics: false,
    });
  }, []);

  const clearSearch = useCallback(() => {
    setQuery("");
    setFindCount({ current: 0, total: 0 });
    dispatchFind("");
  }, [dispatchFind]);

  useEffect(() => {
    if (!searchOpen) return;
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [searchOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        const root = rootRef.current;
        if (!root || root.closest("[inert]")) return;
        event.preventDefault();
        setSearchOpen(true);
      } else if (event.key === "Escape") {
        if (menuOpen) setMenuOpen(false);
        else if (searchOpen) {
          clearSearch();
          setSearchOpen(false);
        } else if (focused) onFocusChange?.(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearSearch, focused, menuOpen, onFocusChange, searchOpen]);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<PdfJsRuntime["getDocument"]> | null = null;
    let pdfViewer: PdfViewer | null = null;
    let eventBus: PdfEventBus | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeFrame = 0;
    const listeners: Array<[string, (event: Record<string, unknown>) => void]> = [];

    setStatus("loading");
    setProgress(0);
    setError(null);
    setPasswordPrompt(null);
    setDocument(null);
    setPagesCount(0);
    setPageNumber(1);
    setPageInput("1");
    setScalePercent(100);
    setScaleInput("100");
    setRotation(0);
    setImageOnly(false);
    setCopyRestricted(false);
    copyPermissionCallbackRef.current?.(false);
    passwordCancelledRef.current = false;
    setOutline([]);
    setOutlineLoaded(false);

    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        // The generic PDF.js viewer bundle intentionally reads the display API
        // from this global. It must be assigned before importing pdf_viewer.mjs.
        (globalThis as typeof globalThis & { pdfjsLib?: PdfJsRuntime }).pdfjsLib = pdfjs;
        const viewerRuntime = await import("pdfjs-dist/web/pdf_viewer.mjs");
        if (cancelled) return;

        loadingTask = pdfjs.getDocument({ data: bytesFrom(base64) });
        loadingTaskRef.current = loadingTask;
        loadingTask.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
          if (!cancelled && total > 0) setProgress(Math.min(100, Math.round(loaded / total * 100)));
        };
        loadingTask.onPassword = (updatePassword: (value: string) => void, reason: number) => {
          if (!cancelled) {
            setPassword("");
            setPasswordPrompt({
              incorrect: reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD,
              updatePassword,
            });
          }
        };
        const pdfDocument = await loadingTask.promise;
        if (cancelled) return;

        const container = containerRef.current;
        const viewerElement = viewerElementRef.current;
        if (!container || !viewerElement) throw new Error("PDF reader container is unavailable");
        eventBus = new viewerRuntime.EventBus();
        const linkService = new viewerRuntime.PDFLinkService({
          eventBus,
          externalLinkTarget: viewerRuntime.LinkTarget.BLANK,
        });
        const findController = new viewerRuntime.PDFFindController({ eventBus, linkService });
        pdfViewer = new viewerRuntime.PDFViewer({
          container,
          viewer: viewerElement,
          eventBus,
          linkService,
          findController,
          enablePermissions: true,
          annotationMode: pdfjs.AnnotationMode.ENABLE,
          annotationEditorMode: pdfjs.AnnotationEditorType.NONE,
          removePageBorders: false,
        });
        // PDFViewer owns its official PDFRenderingQueue when no custom queue is
        // supplied. React never renders or schedules full-size page canvases.
        linkService.setViewer(pdfViewer);
        eventBusRef.current = eventBus;
        viewerRef.current = pdfViewer;
        linkServiceRef.current = linkService;

        const listen = (name: string, listener: (event: Record<string, unknown>) => void) => {
          listeners.push([name, listener]);
          eventBus!.on(name, listener);
        };
        listen("pagesinit", () => {
          if (!pdfViewer || cancelled) return;
          const restored = loadPdfReaderState(fileId);
          pdfViewer.pagesRotation = restored?.rotation ?? 0;
          pdfViewer.currentScaleValue = restored?.scaleValue ?? "page-width";
          pdfViewer.currentPageNumber = clampPdfPage(restored?.pageNumber ?? 1, pdfDocument.numPages);
          if (restored) {
            pdfViewer.scrollPageIntoView({
              pageNumber: clampPdfPage(restored.pageNumber, pdfDocument.numPages),
              destArray: [null, { name: "XYZ" }, restored.left, restored.top, null],
              allowNegativeOffset: true,
              ignoreDestinationZoom: true,
            });
          }
          setStatus("ready");
        });
        listen("pagesloaded", (event) => setPagesCount(Number(event.pagesCount) || pdfDocument.numPages));
        listen("pagechanging", (event) => {
          const next = Number(event.pageNumber) || 1;
          setPageNumber(next);
          setPageInput(String(next));
        });
        listen("scalechanging", (event) => {
          const next = Number(event.scale);
          if (Number.isFinite(next) && next > 0) {
            const percent = Math.round(next * 100);
            setScalePercent(percent);
            setScaleInput(String(percent));
          }
        });
        listen("rotationchanging", (event) => setRotation(normalizePdfRotation(Number(event.pagesRotation) || 0)));
        listen("updatefindmatchescount", (event) => {
          const matches = event.matchesCount as FindCount | undefined;
          setFindCount({ current: matches?.current ?? 0, total: matches?.total ?? 0 });
        });
        listen("updatefindcontrolstate", (event) => {
          const matches = event.matchesCount as FindCount | undefined;
          if (matches) setFindCount({ current: matches.current ?? 0, total: matches.total ?? 0 });
        });
        listen("updateviewarea", (event) => {
          if (!pdfViewer) return;
          const location = event.location as {
            pageNumber?: number;
            left?: number;
            top?: number;
          } | undefined;
          savePdfReaderState(fileId, {
            pageNumber: location?.pageNumber ?? pdfViewer.currentPageNumber,
            scaleValue: pdfViewer.currentScaleValue || String(pdfViewer.currentScale),
            rotation: pdfViewer.pagesRotation,
            left: location?.left ?? 0,
            top: location?.top ?? 0,
          });
        });

        linkService.setDocument(pdfDocument);
        pdfViewer.setDocument(pdfDocument);
        setDocument(pdfDocument);
        setPagesCount(pdfDocument.numPages);
        setPasswordPrompt(null);

        resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
          cancelAnimationFrame(resizeFrame);
          resizeFrame = requestAnimationFrame(() => {
            if (!pdfViewer) return;
            if (/^(?:page-width|page-fit|page-actual|auto)$/.test(pdfViewer.currentScaleValue)) {
              pdfViewer.currentScaleValue = pdfViewer.currentScaleValue;
            } else {
              pdfViewer.update();
            }
          });
        });
        resizeObserver?.observe(container);

        void Promise.all([
          pdfDocument.getOutline().then((items) => {
            if (!cancelled) {
              setOutline(flattenOutline((items ?? []) as PdfOutlineItem[]));
              setOutlineLoaded(true);
            }
          }).catch(() => { if (!cancelled) setOutlineLoaded(true); }),
          pdfDocument.getPermissions().then((permissions) => {
            if (!cancelled) {
              const restricted = Array.isArray(permissions) && !permissions.includes(pdfjs.PermissionFlag.COPY);
              setCopyRestricted(restricted);
              copyPermissionCallbackRef.current?.(restricted);
            }
          }).catch(() => {}),
          (async () => {
            let characters = 0;
            for (let number = 1; number <= Math.min(3, pdfDocument.numPages); number += 1) {
              const page = await pdfDocument.getPage(number);
              const content = await page.getTextContent();
              characters += content.items.reduce((sum, item) => {
                const text = "str" in item ? item.str : "";
                return sum + text.replace(/\s/g, "").length;
              }, 0);
              if (characters >= 12) break;
            }
            if (!cancelled) setImageOnly(characters < 12);
          })().catch(() => {}),
        ]);
      } catch (caught: unknown) {
        if (!cancelled) {
          setError(readerError(passwordCancelledRef.current ? new Error("Password cancelled") : caught));
          setStatus("ready");
          setPasswordPrompt(null);
        }
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(resizeFrame);
      resizeObserver?.disconnect();
      if (eventBus) {
        for (const [name, listener] of listeners) eventBus.off(name, listener);
      }
      if (pdfViewer) {
        pdfViewer.cleanup();
        pdfViewer.setDocument(null as unknown as PdfDocument);
      }
      void loadingTask?.destroy();
      loadingTaskRef.current = null;
      viewerRef.current = null;
      eventBusRef.current = null;
      linkServiceRef.current = null;
    };
  }, [base64, fileId]);

  const submitPage = () => {
    const viewer = viewerRef.current;
    if (!viewer || pagesCount === 0) return;
    const next = clampPdfPage(Number(pageInput), pagesCount);
    viewer.currentPageNumber = next;
    setPageInput(String(next));
  };

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    if (!passwordPrompt || !password) return;
    const update = passwordPrompt.updatePassword;
    setPasswordPrompt(null);
    update(password);
  };

  const submitScale = () => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const parsed = Number(scaleInput);
    const percent = Number.isFinite(parsed) ? Math.min(500, Math.max(25, Math.round(parsed))) : scalePercent;
    setScaleInput(String(percent));
    viewer.currentScaleValue = String(percent / 100);
  };

  if (error) {
    return (
      <div className="pdf-reader flex min-h-0 flex-1 items-center justify-center p-6" data-testid="pdf-error">
        <div className="w-full max-w-[390px] text-center">
          <FileSearch className="mx-auto h-6 w-6 text-[var(--leemo-amber)]" aria-hidden />
          <h2 className="mt-3 text-sm font-semibold text-[var(--leemo-ink)]">{error.title}</h2>
          <p className="mt-1.5 text-xs leading-5 text-[var(--leemo-ink-3)]">{error.detail}</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button type="button" onClick={() => void onOpenExternal?.()} className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--leemo-line)] bg-[var(--leemo-card)] px-2.5 text-xs text-[var(--leemo-ink-2)]">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              用系统默认程序打开
            </button>
            <button type="button" onClick={() => void onReveal?.()} className="inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-xs text-[var(--leemo-ink-3)]">
              <FolderOpen className="h-3.5 w-3.5" aria-hidden />
              在文件夹中显示
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="pdf-reader relative flex min-h-0 flex-1 flex-col" data-testid="pdf-view" data-mode={focused ? "focus" : "normal"}>
      <div className="pdf-reader__toolbar flex h-10 shrink-0 items-center gap-1.5 px-2" role="toolbar" aria-label="PDF 阅读工具" data-testid="pdf-reader-toolbar">
        <button type="button" className="pdf-reader__icon-button" aria-label={sidebarOpen ? "隐藏文档侧栏" : "显示文档侧栏"} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((value) => !value)}>
          <PanelLeft className="h-3.5 w-3.5" aria-hidden />
        </button>
        <span className="pdf-reader__toolbar-title min-w-0 max-w-[170px] flex-1 truncate px-1 text-[11px] font-medium text-[var(--leemo-ink-2)]" title={title}>{title}</span>
        <div className="pdf-reader__toolbar-group pdf-reader__page-group">
          <button type="button" className="pdf-reader__icon-button" aria-label="上一页" onClick={() => { if (viewerRef.current) viewerRef.current.currentPageNumber = clampPdfPage(pageNumber - 1, pagesCount); }}>
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          </button>
          <input
            className="pdf-reader__page-input"
            type="number"
            min={1}
            max={Math.max(1, pagesCount)}
            value={pageInput}
            aria-label="当前页"
            onChange={(event) => setPageInput(event.target.value)}
            onBlur={submitPage}
            onKeyDown={(event) => { if (event.key === "Enter") submitPage(); }}
          />
          <span className="pr-1 text-[10.5px] text-[var(--leemo-ink-3)]">/ {pagesCount || "—"}</span>
          <button type="button" className="pdf-reader__icon-button" aria-label="下一页" onClick={() => { if (viewerRef.current) viewerRef.current.currentPageNumber = clampPdfPage(pageNumber + 1, pagesCount); }}>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
        <div className="pdf-reader__toolbar-group pdf-reader__zoom-group">
          <button type="button" className="pdf-reader__icon-button" aria-label="缩小" onClick={() => viewerRef.current?.decreaseScale()}><Minus className="h-3.5 w-3.5" aria-hidden /></button>
          <label className="relative flex items-center">
            <input
              type="number"
              min={25}
              max={500}
              className="pdf-reader__zoom-input pr-2"
              aria-label="缩放百分比"
              value={scaleInput}
              onChange={(event) => setScaleInput(event.target.value)}
              onBlur={submitScale}
              onKeyDown={(event) => { if (event.key === "Enter") submitScale(); }}
            />
            <span className="pointer-events-none absolute right-1 text-[9px] text-[var(--leemo-ink-3)]">%</span>
          </label>
          <button type="button" className="pdf-reader__icon-button" aria-label="放大" onClick={() => viewerRef.current?.increaseScale()}><Plus className="h-3.5 w-3.5" aria-hidden /></button>
        </div>
        <div className="pdf-reader__toolbar-group pdf-reader__fit-group">
          <button type="button" className="pdf-reader__text-button" aria-label="适合宽度" onClick={() => { if (viewerRef.current) viewerRef.current.currentScaleValue = "page-width"; }}>
            <span className="pdf-reader__fit-label">适合宽度</span><span className="sr-only">适合宽度</span>
          </button>
          <button type="button" className="pdf-reader__text-button" aria-label="适合页面" onClick={() => { if (viewerRef.current) viewerRef.current.currentScaleValue = "page-fit"; }}>适页</button>
        </div>
        <button type="button" className="pdf-reader__icon-button" aria-label="顺时针旋转 90 度" onClick={() => { if (viewerRef.current) viewerRef.current.pagesRotation = normalizePdfRotation(viewerRef.current.pagesRotation + 90); }}>
          <RotateCw className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button type="button" className="pdf-reader__icon-button" aria-label="在文档中搜索" aria-pressed={searchOpen} onClick={() => setSearchOpen((value) => !value)}>
          <Search className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button type="button" className="pdf-reader__icon-button" aria-label={focused ? "返回工作台" : "专注阅读"} aria-pressed={focused} onClick={() => onFocusChange?.(!focused)}>
          <Focus className="h-3.5 w-3.5" aria-hidden />
        </button>
        <div className="relative">
          <button type="button" className="pdf-reader__icon-button" aria-label="更多 PDF 操作" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><Menu className="h-3.5 w-3.5" aria-hidden /></button>
          {menuOpen && (
            <div className="pdf-reader__menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { if (viewerRef.current) viewerRef.current.currentScaleValue = "page-width"; setMenuOpen(false); }}>适合宽度</button>
              <button type="button" role="menuitem" onClick={() => { if (viewerRef.current) viewerRef.current.currentScaleValue = "page-fit"; setMenuOpen(false); }}>适合页面</button>
              <div className="pdf-reader__menu-separator" aria-hidden />
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void onOpenExternal?.(); }}><ExternalLink className="h-3.5 w-3.5" aria-hidden />用系统默认程序打开</button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void onReveal?.(); }}><FolderOpen className="h-3.5 w-3.5" aria-hidden />在文件夹中显示</button>
            </div>
          )}
        </div>
      </div>

      {searchOpen && (
        <div className="pdf-reader__search" role="search">
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--leemo-ink-3)]" aria-hidden />
          <input
            ref={searchInputRef}
            type="search"
            role="searchbox"
            aria-label="在文档中搜索"
            placeholder="在文档中搜索"
            value={query}
            onChange={(event) => { setQuery(event.target.value); dispatchFind(event.target.value); }}
          />
          <span className="min-w-[38px] text-center text-[10px] tabular-nums text-[var(--leemo-ink-3)]">{findCount.current} / {findCount.total}</span>
          <button type="button" className="pdf-reader__icon-button" aria-label="上一个搜索结果" disabled={!query} onClick={() => dispatchFind(query, true, true)}><ChevronUp className="h-3.5 w-3.5" aria-hidden /></button>
          <button type="button" className="pdf-reader__icon-button" aria-label="下一个搜索结果" disabled={!query} onClick={() => dispatchFind(query, false, true)}><ChevronDown className="h-3.5 w-3.5" aria-hidden /></button>
          <button type="button" className="pdf-reader__icon-button" aria-label="清空搜索" onClick={clearSearch}><X className="h-3.5 w-3.5" aria-hidden /></button>
        </div>
      )}

      {(imageOnly || copyRestricted) && (
        <div className="pdf-reader__degraded flex min-h-7 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1 text-[10.5px]">
          {imageOnly && <span>该 PDF 可能是扫描件，暂时无法选中文字</span>}
          {copyRestricted && <span>文档作者已限制复制</span>}
          {onOpenExternal && <button type="button" className="underline underline-offset-2" onClick={() => void onOpenExternal()}>用系统默认程序打开</button>}
        </div>
      )}

      <div className="pdf-reader__body relative flex min-h-0 flex-1">
        {sidebarOpen && document && (
          <aside className="pdf-reader__sidebar flex min-h-0 flex-col" aria-label="PDF 导航">
            <div className="flex h-9 shrink-0 border-b border-[var(--leemo-line)] p-1" role="tablist" aria-label="PDF 导航方式">
              <button type="button" role="tab" aria-selected={sidebarTab === "thumbnails"} onClick={() => setSidebarTab("thumbnails")} className={`flex-1 rounded-[5px] text-[10.5px] ${sidebarTab === "thumbnails" ? "bg-[var(--leemo-side-hover)] text-[var(--leemo-ink)]" : "text-[var(--leemo-ink-3)]"}`}>缩略图</button>
              <button type="button" role="tab" aria-selected={sidebarTab === "outline"} onClick={() => setSidebarTab("outline")} className={`flex-1 rounded-[5px] text-[10.5px] ${sidebarTab === "outline" ? "bg-[var(--leemo-side-hover)] text-[var(--leemo-ink)]" : "text-[var(--leemo-ink-3)]"}`}>目录</button>
            </div>
            <div className="pdf-reader__sidebar-list min-h-0 flex-1 overflow-y-auto p-1.5">
              {sidebarTab === "thumbnails" ? Array.from({ length: pagesCount }, (_, index) => (
                <PdfThumbnail key={index + 1} document={document} pageNumber={index + 1} rotation={rotation} current={pageNumber === index + 1} onSelect={() => { if (viewerRef.current) viewerRef.current.currentPageNumber = index + 1; }} />
              )) : !outlineLoaded ? (
                <p className="p-3 text-[10.5px] text-[var(--leemo-ink-3)]">正在读取目录…</p>
              ) : outline.length === 0 ? (
                <p className="p-3 text-[10.5px] leading-5 text-[var(--leemo-ink-3)]">这份 PDF 没有目录</p>
              ) : outline.map((item, index) => (
                <button
                  key={`${item.title}-${index}`}
                  type="button"
                  className="block w-full truncate rounded-[5px] py-1.5 pr-2 text-left text-[10.5px] text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)]"
                  style={{ paddingLeft: `${8 + item.depth * 12}px` }}
                  title={item.title}
                  aria-label={item.title}
                  onClick={() => { if (item.dest) void linkServiceRef.current?.goToDestination(item.dest as string | unknown[]); }}
                >
                  <ListTree className="mr-1.5 inline h-3 w-3 text-[var(--leemo-ink-3)]" aria-hidden />
                  {item.title}
                </button>
              ))}
            </div>
          </aside>
        )}
        <div className="pdf-reader__viewport">
          <div ref={containerRef} className="pdf-reader__scroller" data-testid="pdf-scroll-container">
            <div ref={viewerElementRef} className="pdfViewer" data-testid="pdf-viewer" />
          </div>
          {status === "loading" && !passwordPrompt && (
            <div className="absolute inset-0 z-20 grid place-items-center bg-[#e9edf1]/90">
              <div className="text-center">
                <p className="text-xs text-[var(--leemo-ink-2)]">正在打开 {title}…</p>
                {progress > 0 && <p className="mt-1 text-[10px] tabular-nums text-[var(--leemo-ink-3)]">{progress}%</p>}
              </div>
            </div>
          )}
          {passwordPrompt && (
            <div className="absolute inset-0 z-30 grid place-items-center bg-[#e9edf1]/95 p-5">
              <form onSubmit={submitPassword} className="w-full max-w-[320px] rounded-[9px] border border-[var(--leemo-line)] bg-[var(--leemo-card)] p-4 shadow-lg">
                <h2 className="text-sm font-semibold text-[var(--leemo-ink)]">这份 PDF 需要密码</h2>
                <p className="mt-1 text-xs leading-5 text-[var(--leemo-ink-3)]">密码只用于本次在本机打开，不会保存。</p>
                {passwordPrompt.incorrect && <p className="mt-2 text-xs text-[var(--leemo-danger)]">密码不正确，请再试一次</p>}
                <label className="mt-3 block text-[11px] text-[var(--leemo-ink-2)]">
                  PDF 密码
                  <input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 h-9 w-full rounded-[6px] border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-2.5 text-sm text-[var(--leemo-ink)] outline-none focus:border-[var(--leemo-amber)]" />
                </label>
                <div className="mt-3 flex justify-end gap-2">
                  <button type="button" onClick={() => {
                    passwordCancelledRef.current = true;
                    setPasswordPrompt(null);
                    setError(readerError(new Error("Password cancelled")));
                    void loadingTaskRef.current?.destroy();
                  }} className="h-8 rounded-[6px] px-2.5 text-xs text-[var(--leemo-ink-3)]">取消</button>
                  <button type="submit" disabled={!password} className="h-8 rounded-[6px] bg-[var(--leemo-ink)] px-3 text-xs text-[var(--leemo-bg)] disabled:opacity-40">打开</button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
      <div className="pdf-reader__status flex items-center justify-between">
        <span>第 {pageNumber} 页</span>
        <span>{copyRestricted ? "复制受限" : imageOnly ? "可能是扫描件" : "文字可选择"}</span>
      </div>
    </div>
  );
}
