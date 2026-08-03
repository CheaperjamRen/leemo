import type { VisualizationData, VisualizationInput } from "../bridge/visualization-spec";

function escapeHtml(value: string | number): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderMatrix(data: Extract<VisualizationData, { kind: "table" | "comparison" }>): string {
  if (data.kind === "table") {
    const headings = data.columns.map((column) => `<th scope="col">${escapeHtml(column)}</th>`).join("");
    const rows = data.rows.map((row) => (
      `<tr>${row.cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`
    )).join("");
    return `<div class="table-wrap"><table><thead><tr>${headings}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  const headings = data.columns.map((column) => `<div class="comparison-heading">${escapeHtml(column)}</div>`).join("");
  const rows = data.rows.map((row) => (
    `<div class="comparison-row">${row.cells.map((cell) => `<div class="comparison-cell">${escapeHtml(cell)}</div>`).join("")}</div>`
  )).join("");
  return `<div class="comparison-grid" style="--columns:${data.columns.length}">${headings}${rows}</div>`;
}

function renderTimeline(data: Extract<VisualizationData, { kind: "timeline" }>): string {
  const events = data.events.map((event) => `
    <li>
      <span class="timeline-dot" aria-hidden="true"></span>
      <div class="timeline-content">
        ${event.date ? `<time>${escapeHtml(event.date)}</time>` : ""}
        <strong>${escapeHtml(event.label)}</strong>
        ${event.detail ? `<p>${escapeHtml(event.detail)}</p>` : ""}
      </div>
    </li>`).join("");
  return `<ol class="timeline-list">${events}</ol>`;
}

function renderFlow(data: Extract<VisualizationData, { kind: "flow" }>): string {
  const steps = data.steps.map((step, index) => `
    <li>
      <span class="flow-number">${index + 1}</span>
      <div><strong>${escapeHtml(step.label)}</strong>${step.detail ? `<p>${escapeHtml(step.detail)}</p>` : ""}</div>
    </li>`).join("");
  return `<ol class="flow-list">${steps}</ol>`;
}

function renderBar(data: Extract<VisualizationData, { kind: "bar" }>): string {
  const max = Math.max(1, ...data.values.map((entry) => Math.abs(entry.value)));
  const unit = data.unit ? ` ${escapeHtml(data.unit)}` : "";
  const rows = data.values.map((entry) => {
    const width = Math.min(50, Math.abs(entry.value) / max * 50).toFixed(3);
    const direction = entry.value < 0 ? "negative" : "positive";
    return `<li>
      <span class="bar-label">${escapeHtml(entry.label)}</span>
      <span class="bar-track" aria-hidden="true"><span class="bar-zero"></span><span class="bar-fill ${direction}" style="--bar-size:${width}%"></span></span>
      <strong class="bar-value">${escapeHtml(entry.value)}${unit}</strong>
    </li>`;
  }).join("");
  return `<ul class="bar-chart">${rows}</ul>`;
}

function renderData(data: VisualizationData): string {
  switch (data.kind) {
    case "table":
    case "comparison":
      return renderMatrix(data);
    case "timeline":
      return renderTimeline(data);
    case "flow":
      return renderFlow(data);
    case "bar":
      return renderBar(data);
  }
}

const CSS = `
  :root { color-scheme: light; font-family: Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #20211f; background: #f7f7f5; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px; }
  main { width: min(100%, 980px); margin: 0 auto; overflow-wrap: anywhere; }
  header { margin-bottom: 22px; }
  h1 { margin: 0; font-size: 24px; line-height: 1.35; letter-spacing: 0; }
  header p { margin: 8px 0 0; color: #6f716c; font-size: 14px; line-height: 1.65; }
  .surface { overflow: hidden; overflow-wrap: anywhere; border: 1px solid #dedfda; border-radius: 8px; background: #fff; box-shadow: 0 10px 30px rgba(24, 26, 22, .06); }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { padding: 12px 14px; border-bottom: 1px solid #ecece8; text-align: left; vertical-align: top; }
  th { background: #f5f5f2; color: #5e615b; font-size: 12px; font-weight: 650; }
  tbody tr:last-child td { border-bottom: 0; }
  .comparison-grid { display: grid; grid-template-columns: repeat(var(--columns), minmax(140px, 1fr)); overflow-x: auto; }
  .comparison-heading, .comparison-cell { min-width: 140px; padding: 13px 15px; border-right: 1px solid #ecece8; border-bottom: 1px solid #ecece8; }
  .comparison-heading { background: #f5f5f2; color: #5e615b; font-size: 12px; font-weight: 650; }
  .comparison-row { display: contents; }
  .comparison-cell { font-size: 14px; line-height: 1.55; }
  .timeline-list, .flow-list, .bar-chart { list-style: none; margin: 0; padding: 20px; }
  .timeline-list li { position: relative; display: grid; grid-template-columns: 18px 1fr; gap: 12px; padding-bottom: 18px; }
  .timeline-list li:not(:last-child)::before { content: ""; position: absolute; left: 6px; top: 14px; bottom: 0; width: 1px; background: #d9dad4; }
  .timeline-list li:last-child { padding-bottom: 0; }
  .timeline-dot { position: relative; z-index: 1; width: 13px; height: 13px; margin-top: 4px; border: 3px solid #fff; border-radius: 50%; background: #d77745; box-shadow: 0 0 0 1px #d77745; }
  .timeline-content { min-width: 0; }
  .timeline-content time { display: block; margin-bottom: 3px; color: #8a8c86; font-size: 11px; }
  .timeline-content strong, .flow-list strong { font-size: 14px; }
  .timeline-content p, .flow-list p { margin: 5px 0 0; color: #6f716c; font-size: 13px; line-height: 1.55; }
  .flow-list { display: grid; gap: 10px; }
  .flow-list li { position: relative; display: grid; grid-template-columns: 30px 1fr; gap: 12px; align-items: start; padding: 14px; border: 1px solid #e4e5df; border-radius: 7px; background: #fafaf8; }
  .flow-number { display: grid; width: 26px; height: 26px; place-items: center; border-radius: 50%; background: #242622; color: #fff; font-size: 12px; font-weight: 700; }
  .bar-chart { display: grid; gap: 14px; }
  .bar-chart li { display: grid; grid-template-columns: minmax(80px, 150px) minmax(180px, 1fr) minmax(72px, auto); gap: 12px; align-items: center; }
  .bar-label { overflow: hidden; color: #555852; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track { position: relative; height: 12px; border-radius: 6px; background: #f0f0ec; }
  .bar-zero { position: absolute; left: 50%; top: -2px; bottom: -2px; width: 1px; background: #aeb0aa; }
  .bar-fill { position: absolute; top: 2px; height: 8px; border-radius: 4px; }
  .bar-fill.positive { left: 50%; width: var(--bar-size); background: #d77745; }
  .bar-fill.negative { right: 50%; width: var(--bar-size); background: #607da8; }
  .bar-value { font-size: 12px; font-variant-numeric: tabular-nums; text-align: right; }
  @media (max-width: 620px) { body { padding: 16px; } .bar-chart li { grid-template-columns: 90px minmax(130px, 1fr) 64px; } }
`;

export function renderVisualizationHtml(input: VisualizationInput): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:;">
  <title>${escapeHtml(input.title)}</title>
  <style>${CSS}</style>
</head>
<body>
  <main data-leemo-visualization="1" data-kind="${input.visualization.kind}">
    <header><h1>${escapeHtml(input.title)}</h1>${input.subtitle ? `<p>${escapeHtml(input.subtitle)}</p>` : ""}</header>
    <section class="surface">${renderData(input.visualization)}</section>
  </main>
</body>
</html>`;
}
