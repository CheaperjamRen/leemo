import { ArrowLeft, EyeOff, Flag, FolderKanban, RotateCcw, XCircle } from "lucide-react";
import type { GlobalOverviewDisplayItem } from "../stores/global-pending-overview";

export default function GlobalPendingOverviewPage({
  items,
  uncertainSourceIds,
  onBack,
  onOpenSource,
  onSetPriority,
  onIgnore,
  onEnd,
  onRestore,
  sourceLabels = {},
}: {
  items: GlobalOverviewDisplayItem[];
  uncertainSourceIds: string[];
  onBack?(): void;
  onOpenSource(sourceId: string, relatedSourceIds: readonly string[]): void;
  onSetPriority(anchorSourceId: string, value: "now" | "soon" | "later"): void;
  onIgnore(anchorSourceId: string): void;
  onEnd(anchorSourceId: string): void;
  onRestore(anchorSourceId: string): void;
  sourceLabels?: Readonly<Record<string, string>>;
}) {
  const groups = new Map<string, GlobalOverviewDisplayItem[]>();
  for (const item of items) {
    const key = item.projectLabel?.trim() || "未归组";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return (
    <div className="leemo-start-overview-page">
      <header className="leemo-start-page-heading">
        <div>
          {onBack && <button type="button" className="leemo-start-back" onClick={onBack}><ArrowLeft aria-hidden />首页</button>}
          <h1>待完成事项</h1>
          <p>根据 Todo、会话和成果整理的全局概览。</p>
        </div>
      </header>

      {groups.size === 0 ? (
        <div className="leemo-start-overview-page__empty">
          <FolderKanban aria-hidden />
          <h2>当前看板是空的</h2>
          <p>回到首页手动梳理，或继续按原来的方式记录与工作。</p>
        </div>
      ) : [...groups.entries()].map(([group, groupItems]) => (
        <section key={group} className="leemo-start-overview-group">
          <header><h2>{group}</h2><span>{groupItems.length} 项</span></header>
          <div className="leemo-start-overview-group__list">
            {groupItems.map((item) => (
              <article key={item.id} aria-label={item.title} className="leemo-start-overview-item">
                <div className="leemo-start-overview-item__main">
                  <span className={`leemo-start-overview-item__priority is-${item.priority}`}>{item.priority === "now" ? "现在" : item.priority === "soon" ? "接下来" : "稍后"}</span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.progressSummary}</p>
                    {item.nextStep && <p className="leemo-start-overview-item__next"><strong>下一步</strong>{item.nextStep}</p>}
                  </div>
                </div>
                <div className="leemo-start-overview-item__sources" aria-label="真实来源">
                  {item.sourceIds.map((sourceId) => (
                    <button key={sourceId} type="button" aria-label={`打开来源 ${sourceLabels[sourceId] ?? "对应内容"}`} onClick={() => onOpenSource(sourceId, item.sourceIds)}>{sourceLabels[sourceId] ?? "来源已不可用"}</button>
                  ))}
                </div>
                <div className="leemo-start-overview-item__actions">
                  <button type="button" aria-label={`优先处理${item.title}`} onClick={() => onSetPriority(item.anchorSourceId, "now")}><Flag aria-hidden />优先</button>
                  <button type="button" aria-label={`稍后处理${item.title}`} onClick={() => onSetPriority(item.anchorSourceId, "later")}><RotateCcw aria-hidden />稍后</button>
                  <button type="button" aria-label={`不再关注${item.title}`} onClick={() => onIgnore(item.anchorSourceId)}><EyeOff aria-hidden />不再关注</button>
                  <button type="button" aria-label={`已经结束${item.title}`} onClick={() => onEnd(item.anchorSourceId)}><XCircle aria-hidden />已经结束</button>
                  {item.sourceMissing && <button type="button" aria-label={`恢复关注${item.title}`} onClick={() => onRestore(item.anchorSourceId)}>恢复</button>}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      {uncertainSourceIds.length > 0 && (
        <details className="leemo-start-overview-uncertain">
          <summary>尚不确定的来源（{uncertainSourceIds.length}）</summary>
          <div>{uncertainSourceIds.map((id) => <span key={id}>{sourceLabels[id] ?? "一条来源已不可用"}</span>)}</div>
        </details>
      )}
    </div>
  );
}
