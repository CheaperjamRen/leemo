import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ContextUsageIndicator from "./ContextUsageIndicator";

describe("ContextUsageIndicator", () => {
  it("shows a quiet ring and exact model-specific context details", () => {
    render(
      <ContextUsageIndicator
        currentTokens={406_000}
        policy={{ contextWindowTokens: 512_000, autoCompactWindowTokens: 486_000 }}
      />,
    );

    expect(screen.getByRole("button", { name: "上下文已用 84%" })).toBeTruthy();
    expect(screen.getByRole("tooltip")).toHaveTextContent("84% 已用");
    expect(screen.getByRole("tooltip")).toHaveTextContent("已用 406K，整理窗口 486K");
    expect(screen.getByRole("tooltip")).toHaveTextContent("模型上限 512K");
  });

  it("reports measured tokens without inventing a denominator when capacity is automatic", () => {
    render(<ContextUsageIndicator currentTokens={12_400} />);

    expect(screen.getByRole("button", { name: "上下文已用 12.4K，容量自动识别" })).toBeTruthy();
    expect(screen.getByRole("tooltip")).toHaveTextContent("已用 12.4K");
    expect(screen.getByRole("tooltip")).toHaveTextContent("容量由当前模型自动识别");
  });
});
