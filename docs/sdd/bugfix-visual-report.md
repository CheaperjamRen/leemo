# 视觉 Bug 修复报告

日期：2026-07-24

## Bug 1：Markdown 没有渲染

修改文件：`src/renderer/components/timeline/TextBubble.tsx`

方案：为 momo 回复（`item.role !== "user"`）引入 `react-markdown`，用 `components` prop 覆盖 `p/h1-h3/ul/ol/li/code/pre` 样式，保持 `text-[13.5px] leading-[1.8]`。streaming 时光标 `leemo-caret` 置于 ReactMarkdown 内容后。用户消息保持纯文本不变。

结果：PASS

---

## Bug 2：搭子模式布局比例失调

修改文件：`src/renderer/components/BuddyShell.tsx`

方案：
- `Timeline` 外层加 `<div className="mx-auto w-full max-w-[720px]">` 包裹
- 底部输入区 `mt-auto shrink-0 pb-8 pt-2` div 内加 `<div className="mx-auto w-full max-w-[720px] px-6">` 包裹所有子元素（PinnedPlan/LiveStatusBar/ChipRow/InputArea/PinFootnote）

结果：PASS

---

## Bug 3：工作台模式黄色底

修改文件：`src/renderer/components/WorkbenchShell.tsx`

方案：在根 `<div data-shell="workbench">` 上加 `style` inline 覆盖 12 个 `--leemo-*` CSS token 为冷灰色系（`--leemo-bg: #FFFFFF`、`--leemo-bg-deep: #F6F6F7` 等），搭子模式不受影响。

结果：PASS

---

## 测试结果

```
Test Files  71 passed (71)
     Tests  590 passed (590)
  Duration  17.81s
```

无新增红测试。
