import { describe, expect, it } from "vitest";
import { wrapVisualizationHtml } from "./wrap-visualization-html";

describe("wrapVisualizationHtml", () => {
  it("keeps useful body and style content while removing executable markup", () => {
    const wrapped = wrapVisualizationHtml(`<!doctype html><html><head>
      <style>.x { color: red; }</style>
      <script>window.stolen = true</script>
    </head><body>
      <p class="x" onclick="steal()">内容</p>
      <a href="javascript:steal()">危险链接</a>
      <iframe src="https://attacker.invalid"></iframe>
    </body></html>`);

    expect(wrapped).toContain("script-src 'none'");
    expect(wrapped).toContain("default-src 'none'");
    expect(wrapped).toContain(".x { color: red; }");
    expect(wrapped).toContain("<p class=\"x\">内容</p>");
    expect(wrapped).not.toContain("window.stolen");
    expect(wrapped).not.toContain("onclick");
    expect(wrapped).not.toContain("javascript:");
    expect(wrapped).not.toContain("<iframe");
  });

  it("wraps a fragment and never restores script permission", () => {
    const wrapped = wrapVisualizationHtml("<section><strong>结论</strong></section><script>alert(1)</script>");
    expect(wrapped).toContain("<section><strong>结论</strong></section>");
    expect(wrapped).not.toContain("alert(1)");
    expect(wrapped).not.toContain("script-src 'unsafe-inline'");
  });
});
