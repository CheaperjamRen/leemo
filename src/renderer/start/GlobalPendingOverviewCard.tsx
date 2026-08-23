import { ArrowRight, RefreshCw, Sparkles } from "lucide-react";
import type { GlobalOverviewSnapshot } from "../../bridge/global-pending-overview";
import type { GlobalOverviewDisplayItem } from "../stores/global-pending-overview";

function updateTime(timestamp: number): string {
  return `${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(timestamp)} 更新`;
}

export default function GlobalPendingOverviewCard({
  snapshot,
  items,
  status,
  error,
  onRefresh,
  onOpenBoard,
  onOpenItem,
}: {
  snapshot: GlobalOverviewSnapshot | null;
  items: GlobalOverviewDisplayItem[];
  status: "idle" | "refreshing" | "error";
  error: string | null;
  onRefresh(): void;
  onOpenBoard(): void;
  onOpenItem(item: GlobalOverviewDisplayItem): void;
}) {
  const hasSnapshot = snapshot !== null;
  const density = !hasSnapshot || items.length === 0
    ? "compact"
    : items.length < 3
      ? "regular"
      : "full";
  return (
    <section className="leemo-start-card leemo-start-overview-card" data-density={density} aria-labelledby="start-overview-title">
      <header className="leemo-start-card__header">
        <span className="leemo-start-card__index">01</span>
        <div className="leemo-start-card__heading">
          <h2 id="start-overview-title">待完成事项</h2>
          {snapshot && <time dateTime={new Date(snapshot.generatedAt).toISOString()}>{updateTime(snapshot.generatedAt)}</time>}
        </div>
        {hasSnapshot && <button
          type="button"
          className="leemo-start-card__refresh-icon"
          onClick={onRefresh}
          disabled={status === "refreshing"}
          aria-label={status === "refreshing" ? "刷新状态：正在梳理" : "刷新待完成事项"}
        >
          <RefreshCw aria-hidden className={status === "refreshing" ? "is-spinning" : ""} />
        </button>}
      </header>

      {!hasSnapshot ? (
        <div className="leemo-start-overview-card__empty" data-empty-layout="compact">
          <Sparkles aria-hidden />
          <p>还没有梳理过待完成事项。</p>
        </div>
      ) : items.length > 0 ? (
        <div className="leemo-start-overview-card__rows" role="list">
          {items.slice(0, 3).map((item, index) => (
            <button
              key={item.id}
              type="button"
              aria-label={`打开事项 ${item.title}`}
              className="leemo-start-overview-card__row"
              onClick={() => onOpenItem(item)}
            >
              <span className="leemo-start-overview-card__rank" aria-hidden>{index + 1}</span>
              <span className="leemo-start-overview-card__copy">
                <strong>{item.title}</strong>
                <span>{item.projectLabel ?? "未归组"} · {item.sourceIds.length} 个来源</span>
              </span>
              <ArrowRight aria-hidden />
            </button>
          ))}
        </div>
      ) : (
        <p className="leemo-start-card__quiet-state">这次没有整理出需要继续关注的事项。</p>
      )}

      {status === "error" && error && (
        <div className="leemo-start-overview-card__error" role="status">
          <span>{hasSnapshot ? "上次梳理仍可用，本次更新没有完成。" : "这次没有梳理成功。"}</span>
          <details>
            <summary>查看原因</summary>
            <p>{error}</p>
          </details>
        </div>
      )}

      <footer className="leemo-start-card__footer">
        {hasSnapshot ? <>
          <span><Sparkles aria-hidden />由 momo 梳理</span>
          <span className="leemo-start-card__footer-actions">
            <button type="button" className="is-primary" onClick={onRefresh} disabled={status === "refreshing"}><RefreshCw aria-hidden className={status === "refreshing" ? "is-spinning" : ""} />{status === "refreshing" ? "正在梳理" : "重新梳理"}</button>
            <button type="button" onClick={onOpenBoard}>查看完整看板 <ArrowRight aria-hidden /></button>
          </span>
        </> : <>
          <span>整理 Todo、会话和成果</span>
          <button type="button" className="is-primary" onClick={onRefresh} disabled={status === "refreshing"} aria-label={status === "refreshing" ? "正在梳理" : "为我梳理待完成事项"}><RefreshCw aria-hidden className={status === "refreshing" ? "is-spinning" : ""} />{status === "refreshing" ? "正在梳理" : "为我梳理待完成事项"}</button>
        </>}
      </footer>
    </section>
  );
}
