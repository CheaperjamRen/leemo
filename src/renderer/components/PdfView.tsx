import { useEffect, useRef, useState } from "react";
// TextLayer 的定位/透明文字规则用官方那份，别手写：那些 span 的位置是 pdfjs 用
// transform 逐个算出来的，配套 CSS 少一条选区就会歪。
import "pdfjs-dist/web/pdf_viewer.css";

/**
 * PDF 预览（02 §九：**PDF.js 含 TextLayer 选区**）。
 *
 * 为什么不用 `<iframe src="data:application/pdf">` 走 Chromium 自带阅读器 —— 那样
 * 零依赖也能选中文字，但选区落在**另一个 document 里**，`SelectionMenu` 的
 * `window.getSelection()` 永远看不到它。于是 [问一下]/[翻译]（06 §2.4 小 wiki 的
 * 入口）在 PDF 上直接失效，而 PDF 恰恰是最需要"选一段问一下"的文件类型。
 * TextLayer 把文字铺成本 document 里的真实 DOM 节点，选区就能被拿到。
 *
 * 动态 import：pdfjs 是个大包，且它在 jsdom 里跑不起来（要 Canvas/Worker）。放在
 * 组件内部 import 意味着不点开 PDF 就不加载，测试也不会因为顶层 import 就炸。
 */

/** base64 → 字节。IPC 只能过 JSON，所以字节是这么来的（见 workspace.readPreview）。 */
function bytesFrom(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 一次只渲染这么多页。一份 800 页的教材全渲染会把主线程占死几十秒。 */
const MAX_PAGES = 30;

export default function PdfView({ base64, title }: { base64: string; title: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [truncatedAt, setTruncatedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 每次换文件都换一个新容器内容；cleanup 里也要能中止正在跑的渲染。
    const cleanups: (() => void)[] = [];

    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // Worker 走 Vite 的 ?url，打包后在 file:// 下也能解析到真实产物路径。
        const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

        const doc = await pdfjs.getDocument({ data: bytesFrom(base64) }).promise;
        if (cancelled) {
          void doc.destroy();
          return;
        }
        cleanups.push(() => void doc.destroy());

        const host = hostRef.current;
        if (!host) return;
        host.replaceChildren();

        const pageCount = Math.min(doc.numPages, MAX_PAGES);
        setTruncatedAt(doc.numPages > MAX_PAGES ? doc.numPages : null);

        for (let n = 1; n <= pageCount; n++) {
          const page = await doc.getPage(n);
          if (cancelled) return;

          const viewport = page.getViewport({ scale: 1.4 });
          const pageEl = document.createElement("div");
          pageEl.className = "relative mx-auto mb-4 shadow-sm";
          pageEl.style.width = `${Math.floor(viewport.width)}px`;
          pageEl.style.height = `${Math.floor(viewport.height)}px`;
          pageEl.dataset.pdfPage = String(n);

          const canvas = document.createElement("canvas");
          const ratio = window.devicePixelRatio || 1;
          canvas.width = Math.floor(viewport.width * ratio);
          canvas.height = Math.floor(viewport.height * ratio);
          canvas.style.width = "100%";
          canvas.style.height = "100%";
          pageEl.appendChild(canvas);

          // 文字层：绝对定位盖在 canvas 上，文字本身透明（fill color 由 pdfjs 的
          // CSS 变量控制），选中时浏览器画高亮 —— 这就是"能选中文本不是图片"。
          const textLayerEl = document.createElement("div");
          textLayerEl.className = "textLayer";
          pageEl.appendChild(textLayerEl);
          host.appendChild(pageEl);

          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.scale(ratio, ratio);
            await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          }
          if (cancelled) return;

          const textLayer = new pdfjs.TextLayer({
            textContentSource: page.streamTextContent(),
            container: textLayerEl,
            viewport,
          });
          await textLayer.render();
        }

        if (!cancelled) setStatus("ready");
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setStatus("ready");
        }
      }
    })();

    return () => {
      cancelled = true;
      for (const fn of cleanups) fn();
    };
  }, [base64]);

  if (error) {
    return (
      <div className="p-4 text-sm text-[var(--leemo-ink-3)]" data-testid="pdf-error">
        这份 PDF 打不开：{error}
      </div>
    );
  }

  return (
    <div className="p-3" data-testid="pdf-view">
      {status === "loading" && (
        <p className="p-2 text-xs text-[var(--leemo-ink-3)]">正在排版 {title}…</p>
      )}
      <div ref={hostRef} />
      {truncatedAt !== null && (
        <p className="p-2 text-xs text-[var(--leemo-ink-3)]">
          只显示了前 {MAX_PAGES} 页（共 {truncatedAt} 页）
        </p>
      )}
    </div>
  );
}
