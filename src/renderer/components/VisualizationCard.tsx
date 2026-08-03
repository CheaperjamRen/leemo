import { FileChartColumn, LayoutGrid, PanelRightOpen } from "lucide-react";
import { LEEMO_VISUALIZATION_TOOL_NAME } from "../bridge/tool-names";
import { useArtifacts, useUi } from "../bridge/context";
import type { TimelineItem } from "../stores/message-model";
import {
  parseVisualizationInput,
  type VisualizationData,
  type VisualizationInput,
} from "../../bridge/visualization-spec";

function MatrixView({ data }: { data: Extract<VisualizationData, { kind: "table" | "comparison" }> }) {
  if (data.kind === "table") {
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-[var(--leemo-line-2)] bg-[var(--leemo-panel)]">
              {data.columns.map((column, index) => (
                <th key={`${column}-${index}`} scope="col" className="px-3 py-2 text-[11px] font-medium text-[var(--leemo-ink-3)]">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-[var(--leemo-line-soft)] last:border-b-0">
                {row.cells.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-3 py-2.5 align-top leading-[1.55] text-[var(--leemo-ink-2)]">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div
        role="table"
        aria-label="对比"
        className="grid min-w-[420px]"
        style={{ gridTemplateColumns: `repeat(${data.columns.length}, minmax(140px, 1fr))` }}
      >
        {data.columns.map((column, index) => (
          <div key={`heading-${index}`} role="columnheader" className="border-b border-r border-[var(--leemo-line-2)] bg-[var(--leemo-panel)] px-3 py-2 text-[11px] font-medium text-[var(--leemo-ink-3)] last:border-r-0">
            {column}
          </div>
        ))}
        {data.rows.flatMap((row, rowIndex) => row.cells.map((cell, cellIndex) => (
          <div
            key={`${rowIndex}-${cellIndex}`}
            role="cell"
            className="border-b border-r border-[var(--leemo-line-soft)] px-3 py-2.5 text-[12.5px] leading-[1.55] text-[var(--leemo-ink-2)] [overflow-wrap:anywhere] last:border-r-0"
          >
            {cell}
          </div>
        )))}
      </div>
    </div>
  );
}

function TimelineView({ data }: { data: Extract<VisualizationData, { kind: "timeline" }> }) {
  return (
    <ol className="px-4 py-3">
      {data.events.map((event, index) => (
        <li key={index} className="relative grid grid-cols-[16px_minmax(0,1fr)] gap-2.5 pb-3.5 last:pb-0">
          {index < data.events.length - 1 && <span aria-hidden className="absolute bottom-0 left-[5px] top-[13px] w-px bg-[var(--leemo-line-strong)]" />}
          <span aria-hidden className="relative z-[1] mt-1 h-[11px] w-[11px] rounded-full border-[3px] border-[var(--leemo-card)] bg-[var(--leemo-amber)] ring-1 ring-[var(--leemo-amber)]" />
          <div className="min-w-0">
            {event.date && <time className="mb-0.5 block text-[10.5px] text-[var(--leemo-ink-4)]">{event.date}</time>}
            <div className="text-[12.5px] font-medium text-[var(--leemo-ink)] [overflow-wrap:anywhere]">{event.label}</div>
            {event.detail && <p className="mt-1 text-[11.5px] leading-[1.55] text-[var(--leemo-ink-3)] [overflow-wrap:anywhere]">{event.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function FlowView({ data }: { data: Extract<VisualizationData, { kind: "flow" }> }) {
  return (
    <ol className="grid gap-2 p-3">
      {data.steps.map((step, index) => (
        <li key={index} className="relative grid min-h-[48px] grid-cols-[28px_minmax(0,1fr)] items-start gap-2.5 rounded-[7px] border border-[var(--leemo-line-soft)] bg-[var(--leemo-panel)] px-3 py-2.5">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--leemo-ink)] text-[10.5px] font-semibold tabular-nums text-[var(--leemo-bg)]">
            {index + 1}
          </span>
          <div className="min-w-0 pt-0.5">
            <div className="text-[12.5px] font-medium text-[var(--leemo-ink)] [overflow-wrap:anywhere]">{step.label}</div>
            {step.detail && <p className="mt-1 text-[11.5px] leading-[1.5] text-[var(--leemo-ink-3)] [overflow-wrap:anywhere]">{step.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function BarView({ data }: { data: Extract<VisualizationData, { kind: "bar" }> }) {
  const maximum = Math.max(1, ...data.values.map((entry) => Math.abs(entry.value)));
  const valueLabel = (value: number) => `${value}${data.unit ? ` ${data.unit}` : ""}`;
  return (
    <ul aria-label="柱状图" className="grid gap-3 px-4 py-4">
      {data.values.map((entry, index) => {
        const width = `${Math.min(50, Math.abs(entry.value) / maximum * 50)}%`;
        const positive = entry.value >= 0;
        return (
          <li key={`${entry.label}-${index}`} className="grid grid-cols-[minmax(70px,128px)_minmax(140px,1fr)_auto] items-center gap-2.5">
            <span className="truncate text-[11.5px] text-[var(--leemo-ink-2)]" title={entry.label}>{entry.label}</span>
            <span className="relative h-2.5 rounded-full bg-[var(--leemo-panel)]" aria-hidden>
              <span className="absolute -bottom-0.5 -top-0.5 left-1/2 w-px bg-[var(--leemo-line-strong)]" />
              <span
                className={`${positive ? "leemo-viz-bar-positive left-1/2 bg-[var(--leemo-amber)]" : "leemo-viz-bar-negative right-1/2 bg-[var(--leemo-book-blue)]"} absolute top-0.5 h-1.5 rounded-full`}
                style={{ width }}
              />
            </span>
            <strong className="min-w-[54px] text-right text-[11px] font-medium tabular-nums text-[var(--leemo-ink-2)]">{valueLabel(entry.value)}</strong>
          </li>
        );
      })}
    </ul>
  );
}

function VisualizationBody({ input }: { input: VisualizationInput }) {
  switch (input.visualization.kind) {
    case "table":
    case "comparison":
      return <MatrixView data={input.visualization} />;
    case "timeline":
      return <TimelineView data={input.visualization} />;
    case "flow":
      return <FlowView data={input.visualization} />;
    case "bar":
      return <BarView data={input.visualization} />;
  }
}

export default function VisualizationCard({ item }: { item: Extract<TimelineItem, { kind: "tool" }> }) {
  const openPreview = useUi((state) => state.openPreview);
  const setView = useUi((state) => state.setView);
  const indexedPath = useArtifacts((state) => state.entries.find((entry) => (
    entry.kind === "visualization"
    && entry.sourceRunId === item.runId
    && entry.id.endsWith(`:${item.toolUseId}`)
  ))?.path);
  if (item.name !== LEEMO_VISUALIZATION_TOOL_NAME) return null;

  const input = parseVisualizationInput(item.input);
  if (!input) return null;
  const file = indexedPath ?? input.file_path;
  const title = file.split(/[\\/]/).filter(Boolean).pop() ?? file;

  return (
    <section className="overflow-hidden rounded-[8px] border border-[var(--leemo-line-2)] bg-[var(--leemo-card)] leemo-card-shadow" aria-label={`可视化成果：${input.title}`}>
      <div className="flex h-9 items-center gap-2 border-b border-[var(--leemo-line-2)] bg-[var(--leemo-panel)] px-3">
        <FileChartColumn className="h-[14px] w-[14px] shrink-0 text-[var(--leemo-ink-3)]" aria-hidden />
        <span className="mono min-w-0 truncate text-[11px] text-[var(--leemo-ink-3)]">{file}</span>
        {item.status === "ok" && (
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              aria-label="在成果中查看"
              title="在成果中查看"
              onClick={() => setView("artifacts")}
              className="grid h-7 w-7 place-items-center rounded-[5px] text-[var(--leemo-ink-3)] transition-colors hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink)]"
            >
              <LayoutGrid className="h-[14px] w-[14px]" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="在预览中打开"
              title="在预览中打开"
              onClick={() => openPreview(file, title, "html")}
              className="grid h-7 w-7 place-items-center rounded-[5px] text-[var(--leemo-ink-3)] transition-colors hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink)]"
            >
              <PanelRightOpen className="h-[14px] w-[14px]" aria-hidden />
            </button>
          </div>
        )}
      </div>

      {item.status === "running" && (
        <div className="flex h-[72px] items-center justify-center text-[12px] text-[var(--leemo-ink-3)]">渲染中…</div>
      )}
      {item.status === "error" && (
        <div className="flex h-24 flex-col items-center justify-center gap-1.5 text-center">
          <div className="text-[12.5px] text-[var(--leemo-danger)]">组件没画好</div>
          <p className="text-[11px] text-[var(--leemo-ink-3)]">这次没有生成可预览的成果</p>
        </div>
      )}
      {item.status === "ok" && (
        <div className="max-h-[520px] overflow-auto">
          <header className="border-b border-[var(--leemo-line-soft)] px-4 py-3">
            <h3 className="[overflow-wrap:anywhere] text-[13.5px] font-semibold leading-[1.4] text-[var(--leemo-ink)]">{input.title}</h3>
            {input.subtitle && <p className="[overflow-wrap:anywhere] mt-1 text-[11.5px] leading-[1.5] text-[var(--leemo-ink-3)]">{input.subtitle}</p>}
          </header>
          <VisualizationBody input={input} />
        </div>
      )}
    </section>
  );
}
