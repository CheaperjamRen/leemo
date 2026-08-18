# Leemo Start Workspace — Canonical Visual Design

> 状态：用户已确认；实现与视觉验收的唯一当前入口。
> 权威图：[`../start-static-workspace-v2.png`](../start-static-workspace-v2.png)
> 语义规格：[`../../../superpowers/specs/2026-08-18-global-pending-overview-design.md`](../../../superpowers/specs/2026-08-18-global-pending-overview-design.md)
> 参数历史：[`../start-static-workspace-v2.md`](../start-static-workspace-v2.md)

## 1. Design intent

“开始”是人的静态工作空间，不是 AI 首页。视觉采用成熟瑞士信息设计：以网格、排版、细线与精确对齐建立可信感，用单一 Leemo 橙指出当前位置和真正主动作。页面应当信息丰富但不拥挤、安静但不空洞；每个可见对象都应能打开或操作。

**必须避免：**暖黄纸张底、玻璃拟态、彩色渐变、发光、卡通插画、巨型无意义图标、厚黑输入框、游戏式圆形按钮、无内容的大卡、常驻 AI 输入框、为了“高级”而堆叠阴影。

## 2. Canvas and grid

| Token | 1440×900 target |
| --- | --- |
| App topbar | 72px high; 24px horizontal padding; 1px bottom rule |
| Start sidebar | 288px; 20px inner padding; fixed while content scrolls |
| Main content | 24px top and side padding; fills remaining width |
| Header block | 28/36px title; 13/20px factual summary; 20px to grid |
| Home grid | 12 columns; 20px row/column gap; four 6-column cards |
| Card | 10px radius; 1px border; 20px padding; no resting shadow |
| Card row | 42–48px; 1px hairline separator |
| Primary action | 34–36px high; 6px radius; 16px icon; 14px horizontal padding |

Four cards must be visible at 1440×900 without page scrolling: `01 待完成事项 / 02 今天 / 03 收集箱 / 04 最近`.

## 3. Visual tokens

```css
--start-bg: #f7f7f8;
--start-surface: #ffffff;
--start-surface-active: #fff7ef;
--start-nav-active: #f0f2f4;
--start-ink: #101827;
--start-ink-2: #475467;
--start-ink-3: #7a8494;
--start-line: #dde2e8;
--start-line-soft: #eceff2;
--start-accent: #f56a00;
--start-accent-strong: #df5d00;
--start-accent-soft: #fff0e2;
--start-focus-ring: rgba(245, 106, 0, 0.30);
```

Only the active surface, active navigation trace, card folio numbers and one primary action use saturated orange. Error, warning and success colors remain semantic and must not become decorative accents.

## 4. Type scale

- App wordmark: 24px / 600.
- Page title: 28px / 600, `letter-spacing: -0.02em`.
- Card title: 17–18px / 600.
- Row title: 14px / 450–550.
- Metadata, path, source count and time: 12–13px / 400.
- Chinese system sans stack shared with Leemo; no serif, monospace decoration, uppercase kicker or pseudo-code label.

Text must align optically with 16–18px Lucide icons. Icons never set the row height by themselves.

## 5. Global pending overview card

### Never generated

- Preserve the normal card height and heading.
- Show one short explanation and `为我梳理待完成事项`.
- Do not insert sample work, disabled skeleton rows or provider warnings.

### Populated

- Header: `01 / 待完成事项 / real update time / refresh icon`.
- Exactly three preview rows. Each row contains rank, title and one metadata line naming project plus source counts.
- Footer: orange `重新梳理`, quiet `查看完整看板`, low-contrast `由 momo 梳理`.
- The card is a global work-line snapshot; it must not look like a second checkbox Todo list.

### Updating

- Keep the previous rows readable.
- Replace only the refresh affordance with a restrained spinning indicator and `正在梳理…`.
- No full-card shimmer, opacity pulse or layout shift.

### Failed

- Keep the previous rows.
- Add one 28–32px neutral status strip below the header: `本次更新失败，仍展示上次结果`.
- Error details remain folded; retry stays in the normal action position.

### Empty result

- Show `暂时没有可确认的待完成事项` and the real update time.
- Do not fill space with AI suggestions.

## 6. Full board

- Reuse the Start sidebar and one main scroll surface.
- Group by real notebook/project; ungrouped objects use `未归组`.
- Each work-line card contains title, compact progress, next step and clickable source chips.
- Actions are `打开来源 / 优先处理 / 不再关注 / 已经结束`; no completion checkbox.
- Uncertain candidates stay in one collapsed section at the bottom.
- No horizontal Kanban lanes, drag theater, charts or decorative progress percentages.

## 7. Interaction quality

- Hover: 120ms background/border change, never scale the whole card.
- Pressed: at most 1px vertical translation.
- Focus-visible: 2px orange translucent ring, 2px offset.
- Page transition: 160ms opacity plus 4px vertical movement.
- Refresh indicator: linear rotation only while a real request is active.
- `prefers-reduced-motion`: disable rotation/translation; retain immediate state text.
- Popovers overlay available space and never push the card grid.

## 8. Responsive behavior

- `1200–1439px`: sidebar 248px; card padding 16px.
- `<1100px`: home cards become one column; normal page scrolling begins.
- `<1024px`: sidebar becomes an overlay with Escape close and focus return.
- `<820px`: hide source-count metadata before wrapping action buttons; secondary topbar labels become icon + tooltip.
- Never compress row text into two-character columns or allow actions to wrap into irregular heights.

## 9. Visual acceptance discipline

Required screenshot states:

1. 1440×900 — never generated.
2. 1440×900 — populated.
3. 1440×900 — failed while old snapshot remains.
4. 960×680 — populated with sidebar overlay behavior.
5. Full board — grouped items, source chips and collapsed uncertain section.

For every screenshot compare: global balance, information density, card heights, line rhythm, text/icon baseline, focus state, action prominence and absence of accidental empty regions. Passing component tests without passing the whole-screen comparison is not visual completion.

## 10. Local document library

“我的文档”是“开始”内的二级工作面，不新增应用顶栏、AI 输入框或第三层导航。Start 左侧导航保持原位，右侧主区切换为一套本地云文档式双栏：文档 Explorer 负责组织，阅读 / 编辑区负责内容。

| Element | 1440×900 target |
| --- | --- |
| Explorer | 248px; 1px right rule; white surface |
| Explorer toolbar | 44px; search 32px; action buttons 30px square |
| Tree row | 36px; 20px icon/chevron lane; 8px radius only for selected row |
| Document header | 56px; breadcrumb and save state on one line |
| Document canvas | `max-width: 1040px`; 36px horizontal breathing room; no card border around prose |
| Format toolbar | 38px; top aligned; 1px rules; 30px square tools |
| Attachment row | 44px; filename first; storage semantics and actions remain secondary |

Explorer order is `收集箱 / 置顶 / 最近 / 我的文档树`. Parent notes remain editable documents and use the same document icon as leaf notes; only the chevron and indentation express hierarchy. A selected row uses a neutral grey surface plus a 2px Leemo-orange leading trace—never a saturated full-row fill.

Entering the document library automatically compacts the outer Start navigation to its 72px icon rail so the writing surface receives the width; the existing topbar control can expand it again. The document header contains a compact breadcrumb, editable title, `阅读 / 编辑`, save status and restrained actions. Pin, archive and trash are real actions, not decorative icons. Existing external-file reference versus managed-copy semantics remain visible in the attachment row.

The editable canvas fills the remaining viewport height with a minimum first-screen writing area of 520px. Attachments and backlinks follow the prose and never reserve a permanent top-of-page band. At 1440×900, the visible writing width should be roughly 960–1040px in compact-navigation mode, close to a Word document rather than a narrow note card.

Editing defaults to rendered rich Markdown: headings, emphasis, lists, links, code, formulas, tables and diagrams appear as the objects the user is editing, not as exposed `#`, `**` or `[label](url)` punctuation. The document mode control is `阅读 / 编辑 / 源码`; `编辑` is the Word-like rich surface and `源码` is an explicit escape hatch for users who prefer raw Markdown. Both modes update the same Markdown string, switch without data conversion or loss, preserve `Ctrl+S`, and use familiar formatting shortcuts such as `Ctrl+B` as toggles.

Local note references use `leemo-note://<encoded-id>`. Clicking never reaches browser navigation. Typing `@`, using the reference button, or dropping a document row into the editor opens/inserts the same stable reference. Backlinks appear below the document as quiet rows rather than graph decoration.

At widths below 1100px the Explorer narrows to 224px. Below 820px it becomes a temporary overlay; the writing canvas keeps at least 560px when the window permits. Removing or hiding a panel requires a whole-parent balance check so the remaining toolbar and canvas never leave an accidental empty strip.
