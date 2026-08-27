import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PdfView from "./PdfView";

type Listener = (event: Record<string, unknown>) => void;

const pdfHarness = vi.hoisted(() => ({
  buses: [] as Array<{
    listeners: Map<string, Set<Listener>>;
    dispatch: ReturnType<typeof vi.fn> & ((name: string, event: Record<string, unknown>) => void);
  }>,
  viewers: [] as Array<{
    currentPageNumber: number;
    currentScale: number;
    currentScaleValue: string;
    pagesRotation: number;
    pagesCount: number;
    increaseScale: ReturnType<typeof vi.fn>;
    decreaseScale: ReturnType<typeof vi.fn>;
    scrollPageIntoView: ReturnType<typeof vi.fn>;
    setDocument: ReturnType<typeof vi.fn>;
    cleanup: ReturnType<typeof vi.fn>;
  }>,
  findControllers: [] as Array<{
    setDocument: ReturnType<typeof vi.fn>;
  }>,
  mode: "ready" as "ready" | "password" | "invalid",
  passwordCallback: null as null | ((password: string) => void),
  passwordAttempts: [] as string[],
  outline: [{ title: "第一章", dest: "chapter-one", items: [] }],
  permissions: null as number[] | null,
  sampledText: "Leemo PDF sample text 中文段落",
}));

vi.mock("pdfjs-dist/build/pdf.worker.mjs?url", () => ({ default: "pdf.worker.mjs" }));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
  PermissionFlag: { COPY: 16 },
  AnnotationEditorType: { NONE: 0 },
  AnnotationMode: { ENABLE: 1 },
  TextLayer: class {
    render() { return Promise.resolve(); }
  },
  getDocument: vi.fn(() => {
    let resolveDocument!: (value: unknown) => void;
    let rejectDocument!: (reason: Error) => void;
    const promise = new Promise((resolve, reject) => {
      resolveDocument = resolve;
      rejectDocument = reject;
    });
    const documentProxy = {
      numPages: 120,
      destroy: vi.fn(async () => {}),
      getOutline: vi.fn(async () => pdfHarness.outline),
      getPermissions: vi.fn(async () => pdfHarness.permissions),
      getOptionalContentConfig: vi.fn(async () => ({})),
      getMetadata: vi.fn(async () => ({ info: {} })),
      getPage: vi.fn(async () => ({
        getViewport: vi.fn(({ scale = 1, rotation = 0 }) => ({ width: 600 * scale, height: 800 * scale, rotation })),
        getTextContent: vi.fn(async () => ({ items: [{ str: pdfHarness.sampledText }] })),
        streamTextContent: vi.fn(() => ({})),
        render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
      })),
    };
    const task: Record<string, unknown> = {
      promise,
      destroy: vi.fn(async () => {}),
      onPassword: undefined,
    };

    queueMicrotask(() => {
      if (pdfHarness.mode === "invalid") {
        rejectDocument(new Error("Invalid PDF structure"));
        return;
      }
      if (pdfHarness.mode === "password") {
        const request = task.onPassword as undefined | ((update: (password: string) => void, reason: number) => void);
        request?.((password) => {
          pdfHarness.passwordAttempts.push(password);
          if (password === "correct") resolveDocument(documentProxy);
          else request((retry) => {
            pdfHarness.passwordAttempts.push(retry);
            if (retry === "correct") resolveDocument(documentProxy);
          }, 2);
        }, 1);
        return;
      }
      resolveDocument(documentProxy);
    });
    return task;
  }),
}));

vi.mock("pdfjs-dist/web/pdf_viewer.mjs", () => {
  class EventBus {
    listeners = new Map<string, Set<Listener>>();
    dispatch = vi.fn((name: string, event: Record<string, unknown>) => {
      for (const listener of this.listeners.get(name) ?? []) listener(event);
    });
    constructor() { pdfHarness.buses.push(this); }
    on(name: string, listener: Listener) {
      const listeners = this.listeners.get(name) ?? new Set<Listener>();
      listeners.add(listener);
      this.listeners.set(name, listeners);
    }
    off(name: string, listener: Listener) { this.listeners.get(name)?.delete(listener); }
  }

  class PDFLinkService {
    pagesCount = 120;
    setViewer = vi.fn();
    setDocument = vi.fn();
    goToDestination = vi.fn(async () => {});
    constructor(_options: unknown) {}
  }

  class PDFFindController {
    setDocument = vi.fn();
    constructor(_options: unknown) { pdfHarness.findControllers.push(this); }
  }

  class PDFViewer {
    currentPageNumber = 1;
    currentScale = 1;
    currentScaleValue = "auto";
    pagesRotation = 0;
    pagesCount = 120;
    increaseScale = vi.fn(() => { this.currentScale = 1.1; });
    decreaseScale = vi.fn(() => { this.currentScale = 0.9; });
    scrollPageIntoView = vi.fn();
    cleanup = vi.fn();
    eventBus: InstanceType<typeof EventBus>;
    findController: InstanceType<typeof PDFFindController>;
    setDocument = vi.fn((document: unknown) => {
      this.findController.setDocument(document);
      if (!document) return;
      queueMicrotask(() => {
        this.eventBus.dispatch("pagesinit", { source: this });
        this.eventBus.dispatch("pagesloaded", { source: this, pagesCount: this.pagesCount });
        this.eventBus.dispatch("pagechanging", { source: this, pageNumber: this.currentPageNumber });
        this.eventBus.dispatch("scalechanging", { source: this, scale: this.currentScale, presetValue: this.currentScaleValue });
      });
    });
    constructor(options: {
      eventBus: InstanceType<typeof EventBus>;
      findController: InstanceType<typeof PDFFindController>;
    }) {
      this.eventBus = options.eventBus;
      this.findController = options.findController;
      pdfHarness.viewers.push(this);
    }
  }

  return { EventBus, PDFLinkService, PDFFindController, PDFViewer, LinkTarget: { BLANK: 2 } };
});

function renderReader(extra: Record<string, unknown> = {}) {
  return render(<PdfView {...({
    base64: "JVBERi0=",
    title: "Attention Is All You Need.pdf",
    fileId: "fixture-120",
    ...extra,
  } as React.ComponentProps<typeof PdfView>)} />);
}

async function readyViewer() {
  await screen.findByRole("toolbar", { name: "PDF 阅读工具" });
  await waitFor(() => expect(screen.getByText("/ 120")).toBeInTheDocument());
  return pdfHarness.viewers.at(-1)!;
}

describe("PdfView beta reading chain", () => {
  beforeEach(() => {
    pdfHarness.buses.length = 0;
    pdfHarness.viewers.length = 0;
    pdfHarness.findControllers.length = 0;
    pdfHarness.mode = "ready";
    pdfHarness.passwordCallback = null;
    pdfHarness.passwordAttempts.length = 0;
    pdfHarness.outline = [{ title: "第一章", dest: "chapter-one", items: [] }];
    pdfHarness.permissions = null;
    pdfHarness.sampledText = "Leemo PDF sample text 中文段落";
    localStorage.clear();
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({})),
    });
  });

  it("uses the continuous official viewer for all 120 pages without the old 30-page truncation", async () => {
    renderReader();
    await readyViewer();
    expect(screen.getByTestId("pdf-viewer")).toHaveClass("pdfViewer");
    expect(screen.queryByText(/只显示了前 30 页/)).not.toBeInTheDocument();
  });

  it("tracks the most visible page and clamps an entered jump to the document", async () => {
    renderReader();
    const viewer = await readyViewer();
    const bus = pdfHarness.buses.at(-1)!;
    act(() => bus.dispatch("pagechanging", { source: viewer, pageNumber: 37 }));
    expect(screen.getByRole("spinbutton", { name: "当前页" })).toHaveValue(37);

    const page = screen.getByRole("spinbutton", { name: "当前页" });
    await userEvent.clear(page);
    await userEvent.type(page, "999{Enter}");
    expect(viewer.currentPageNumber).toBe(120);
  });

  it("drives zoom, fit and 90-degree rotation through one PDFViewer state", async () => {
    renderReader();
    const viewer = await readyViewer();
    await userEvent.click(screen.getByRole("button", { name: "放大" }));
    expect(viewer.increaseScale).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "缩小" }));
    expect(viewer.decreaseScale).toHaveBeenCalledOnce();
    const percent = screen.getByRole("spinbutton", { name: "缩放百分比" });
    await userEvent.clear(percent);
    await userEvent.type(percent, "150{Enter}");
    expect(viewer.currentScaleValue).toBe("1.5");

    await userEvent.click(screen.getByRole("button", { name: "适合宽度" }));
    expect(viewer.currentScaleValue).toBe("page-width");
    await userEvent.click(screen.getByRole("button", { name: "适合页面" }));
    expect(viewer.currentScaleValue).toBe("page-fit");
    await userEvent.click(screen.getByRole("button", { name: "顺时针旋转 90 度" }));
    expect(viewer.pagesRotation).toBe(90);
  });

  it("keeps fit commands available from the overflow menu when the pane is narrow", async () => {
    renderReader();
    const viewer = await readyViewer();
    expect(screen.getByTestId("pdf-reader-toolbar")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "更多 PDF 操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "适合宽度" }));
    expect(viewer.currentScaleValue).toBe("page-width");

    await userEvent.click(screen.getByRole("button", { name: "更多 PDF 操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "适合页面" }));
    expect(viewer.currentScaleValue).toBe("page-fit");
  });

  it("dismisses PDF overflow actions when clicking outside", async () => {
    renderReader();
    await readyViewer();

    await userEvent.click(screen.getByRole("button", { name: "更多 PDF 操作" }));
    expect(screen.getByRole("menuitem", { name: "适合宽度" })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menuitem", { name: "适合宽度" })).not.toBeInTheDocument();
  });

  it("owns Ctrl+F and provides query, next/previous, count and clear over PDFFindController", async () => {
    renderReader();
    await readyViewer();
    const bus = pdfHarness.buses.at(-1)!;
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const input = await screen.findByRole("searchbox", { name: "在文档中搜索" });
    await waitFor(() => expect(input).toHaveFocus());
    await userEvent.type(input, "attention");
    await waitFor(() => expect(bus.dispatch).toHaveBeenCalledWith("find", expect.objectContaining({ query: "attention" })));

    act(() => bus.dispatch("updatefindmatchescount", { source: null, matchesCount: { current: 2, total: 7 } }));
    expect(screen.getByText("2 / 7")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "下一个搜索结果" }));
    expect(bus.dispatch).toHaveBeenCalledWith("find", expect.objectContaining({
      type: "again",
      findPrevious: false,
    }));
    await userEvent.click(screen.getByRole("button", { name: "上一个搜索结果" }));
    expect(bus.dispatch).toHaveBeenCalledWith("find", expect.objectContaining({
      type: "again",
      findPrevious: true,
    }));
    await userEvent.click(screen.getByRole("button", { name: "清空搜索" }));
    expect(bus.dispatch).toHaveBeenCalledWith("find", expect.objectContaining({ query: "", highlightAll: false }));
  });

  it("lets PDFViewer own the find controller document lifecycle exactly once", async () => {
    renderReader();
    await readyViewer();
    expect(pdfHarness.findControllers.at(-1)?.setDocument).toHaveBeenCalledOnce();
  });

  it("keeps thumbnails and outline in one sidebar that is collapsed by default", async () => {
    renderReader();
    await readyViewer();
    const toggle = screen.getByRole("button", { name: "显示文档侧栏" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("complementary", { name: "PDF 导航" })).not.toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.getByRole("complementary", { name: "PDF 导航" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "缩略图" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "目录" }));
    expect(await screen.findByRole("button", { name: "第一章" })).toBeInTheDocument();
  });

  it("restores page, exact scale mode, rotation and PDF coordinates by stable file id", async () => {
    const firstRender = renderReader({ fileId: "fixture-120" });
    const first = await readyViewer();
    const firstBus = pdfHarness.buses.at(-1)!;
    first.currentPageNumber = 37;
    first.currentScaleValue = "1.5";
    first.pagesRotation = 90;
    act(() => firstBus.dispatch("updateviewarea", {
      source: first,
      location: { pageNumber: 37, scale: "150", rotation: 90, left: 24, top: 360 },
    }));

    firstRender.unmount();
    renderReader({ fileId: "fixture-120" });
    const restored = await readyViewer();
    await waitFor(() => expect(restored.currentPageNumber).toBe(37));
    expect(restored.currentScaleValue).toBe("1.5");
    expect(restored.pagesRotation).toBe(90);
    expect(restored.scrollPageIntoView).toHaveBeenCalledWith(expect.objectContaining({
      pageNumber: 37,
      destArray: [null, { name: "XYZ" }, 24, 360, null],
    }));
  });

  it("keeps a protected document in place and allows retry after an incorrect password", async () => {
    pdfHarness.mode = "password";
    renderReader();
    const password = await screen.findByLabelText("PDF 密码");
    await userEvent.type(password, "wrong{Enter}");
    expect(await screen.findByText("密码不正确，请再试一次")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("PDF 密码"));
    await userEvent.type(screen.getByLabelText("PDF 密码"), "correct{Enter}");
    await readyViewer();
    expect(pdfHarness.passwordAttempts).toEqual(["wrong", "correct"]);
  });

  it("shows honest damaged/image-only/copy-restricted degradation with both escape routes", async () => {
    const openExternal = vi.fn(async () => {});
    const reveal = vi.fn(async () => {});
    pdfHarness.mode = "invalid";
    renderReader({ onOpenExternal: openExternal, onReveal: reveal });
    expect(await screen.findByRole("heading", { name: "这份 PDF 已损坏或格式不完整" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "用系统默认程序打开" }));
    await userEvent.click(screen.getByRole("button", { name: "在文件夹中显示" }));
    expect(openExternal).toHaveBeenCalledOnce();
    expect(reveal).toHaveBeenCalledOnce();

    pdfHarness.mode = "ready";
    pdfHarness.sampledText = "";
    pdfHarness.permissions = [];
    const copyPermissionChange = vi.fn();
    renderReader({ onCopyPermissionChange: copyPermissionChange });
    await readyViewer();
    expect(await screen.findByText("该 PDF 可能是扫描件，暂时无法选中文字")).toBeInTheDocument();
    expect(screen.getByText("文档作者已限制复制")).toBeInTheDocument();
    await waitFor(() => expect(copyPermissionChange).toHaveBeenLastCalledWith(true));
  });
});
