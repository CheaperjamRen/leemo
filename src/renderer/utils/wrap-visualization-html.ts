const EXECUTABLE_NODES = "script, iframe, object, embed, link, base, template, noscript";
const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "xlink:href"]);

function sanitizeSource(html: string): { body: string; styles: string[] } {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.querySelectorAll(EXECUTABLE_NODES).forEach((node) => node.remove());
  parsed.querySelectorAll("meta[http-equiv]").forEach((node) => node.remove());

  for (const element of parsed.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLocaleLowerCase();
      const value = attribute.value.trim().toLocaleLowerCase();
      if (name.startsWith("on") || name === "srcdoc") {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (URL_ATTRIBUTES.has(name) && (
        value.startsWith("javascript:")
        || value.startsWith("vbscript:")
        || value.startsWith("data:text/html")
      )) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  const styleNodes = [...parsed.querySelectorAll("style")];
  const styles = styleNodes.map((node) => node.textContent ?? "").filter(Boolean);
  styleNodes.forEach((node) => node.remove());
  return { body: parsed.body.innerHTML, styles };
}

function safeCssToken(value: string): string {
  return value.replace(/[^#(),.%\-\sA-Za-z0-9]/g, "");
}

export function wrapVisualizationHtml(html: string): string {
  const style = getComputedStyle(document.documentElement);
  const tokens = {
    "--viz-card-bg": style.getPropertyValue("--leemo-card").trim(),
    "--viz-card-border": style.getPropertyValue("--leemo-line-2").trim(),
    "--viz-text": style.getPropertyValue("--leemo-ink").trim(),
    "--viz-text-muted": style.getPropertyValue("--leemo-ink-3").trim(),
    "--viz-accent": style.getPropertyValue("--leemo-amber").trim(),
    "--viz-panel": style.getPropertyValue("--leemo-panel").trim(),
  };
  const tokenCss = Object.entries(tokens)
    .map(([key, value]) => `${key}: ${safeCssToken(value)};`)
    .join(" ");
  const source = sanitizeSource(html);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none';">
  <style>
    :root { ${tokenCss} }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 1rem; font-family: Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: var(--viz-text); background: var(--viz-card-bg); }
    .viz-card { border: 1px solid var(--viz-card-border); border-radius: 8px; padding: 1rem; background: var(--viz-card-bg); }
    .viz-metric { color: var(--viz-text); font-size: 1.5rem; font-weight: 600; }
    .viz-table { width: 100%; border-collapse: collapse; }
    .viz-table th, .viz-table td { padding: .5rem; border: 1px solid var(--viz-card-border); }
    ${source.styles.join("\n")}
  </style>
</head>
<body>${source.body}</body>
</html>`;
}
