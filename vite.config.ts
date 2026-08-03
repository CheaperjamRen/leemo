import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, "/");

export default defineConfig({
  // 轮 5 打包：**必须是相对路径**。默认的 `base: "/"` 会让产物里写
  // `<script src="/assets/index-xxx.js">`，而打包后渲染端是 `file://` 加载的
  // （main.ts 的 `loadFile(dist/index.html)`）—— `/assets/...` 在 file: 下解成
  // **文件系统根**，也就是 `file:///assets/…`，JS 和 CSS 双双 404。
  //
  // 症状恰恰是最难查的那种：`readyState: "complete"`、`#root` 里 0 个子节点、
  // body 空文本、**控制台一条错误都没有** —— 一个纯白窗口。dev 下永远看不到，
  // 因为那时是 http://localhost:5173/ 在供货。实机验收就是在这儿抓到的。
  base: "./",
  plugins: [react(), tailwind()],
  resolve: {
    alias: [{ find: /^@renderer\//, replacement: `${root}/src/renderer/` }],
  },
  server: {
    watch: {
      // Dev Electron stores Claude sessions and the Playwright browser profile
      // here. Chromium mutates locked cache databases that Chokidar cannot
      // watch on Windows (EBUSY), and those files can never affect renderer
      // source anyway.
      ignored: [
        "**/.leemo-workspace/**",
        // Installer acceptance outputs live under the repo so they can be
        // compared side by side. electron-builder leaves Chromium files
        // locked while packaging/running; watching them crashes Vite with
        // EBUSY on Windows even though they can never affect renderer source.
        "**/dist-package*/**",
      ],
    },
  },
});
