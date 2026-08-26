import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ContextUsageIndicator from "./ContextUsageIndicator";

const policy = { contextWindowTokens: 200_000, autoCompactWindowTokens: 167_000 };

describe("ContextUsageIndicator", () => {
  it("keeps an unread context unknown instead of presenting a false zero", () => {
    render(
      <ContextUsageIndicator
        usage={undefined}
        modelId="deepseek-v4-flash"
        policy={policy}
      />,
    );

    expect(screen.getByRole("button", { name: "上下文尚未读取" })).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("尚未读取当前话题的背景信息");
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
  });

  it("shows exact model-specific usage and remaining working capacity", () => {
    render(
      <ContextUsageIndicator
        usage={{
          currentTokens: 406_000,
          capacityTokens: 486_000,
          rawMaxTokens: 512_000,
          providerId: "deepseek",
          modelId: "deepseek-v4-flash",
          accuracy: "exact",
          updatedAt: 1,
          justCompacted: false,
        }}
        modelId="deepseek-v4-flash"
        policy={{ contextWindowTokens: 512_000, autoCompactWindowTokens: 486_000 }}
      />,
    );

    expect(screen.getByRole("button", { name: "上下文已用 84%，整理前剩 80K" })).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("当前话题背景");
    expect(screen.getByRole("tooltip")).toHaveTextContent("406K / 486K");
    expect(screen.getByRole("tooltip")).toHaveTextContent("整理前剩 80K");
    expect(screen.getByRole("tooltip")).toHaveTextContent("模型上限 512K");
  });

  it("labels provider usage estimates and their remaining capacity honestly", () => {
    render(
      <ContextUsageIndicator
        usage={{
          currentTokens: 43_212,
          providerId: "deepseek",
          modelId: "deepseek-v4-flash",
          accuracy: "estimated",
          updatedAt: 1,
          justCompacted: false,
        }}
        modelId="deepseek-v4-flash"
        policy={policy}
      />,
    );

    expect(screen.getByRole("button", { name: "上下文约已用 26%，整理前约剩 124K" })).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("约 43K / 167K");
    expect(screen.getByRole("tooltip")).toHaveTextContent("整理前约剩 124K");
  });

  it("shows that the current round is updating the last trustworthy reading", () => {
    render(
      <ContextUsageIndicator
        usage={{
          currentTokens: 43_212,
          providerId: "deepseek",
          modelId: "deepseek-v4-flash",
          accuracy: "estimated",
          updatedAt: 1,
          justCompacted: false,
        }}
        updating
        modelId="deepseek-v4-flash"
        policy={policy}
      />,
    );

    expect(screen.getByRole("tooltip")).toHaveTextContent("本轮更新中");
  });

  it("does not apply an old model reading to a newly selected capacity", () => {
    render(
      <ContextUsageIndicator
        usage={{
          currentTokens: 43_212,
          providerId: "deepseek",
          modelId: "deepseek-v4-flash",
          accuracy: "exact",
          updatedAt: 1,
          justCompacted: false,
        }}
        modelId="glm-5.2"
        policy={policy}
      />,
    );

    expect(screen.getByRole("button", { name: "上下文等待新模型更新" })).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("模型已切换，下一条消息后更新");
    expect(screen.queryByText(/26%/)).not.toBeInTheDocument();
  });

  it("同名模型切换 provider 后把旧读数标为 stale", () => {
    render(
      <ContextUsageIndicator
        usage={{
          currentTokens: 43_212,
          providerId: "provider-a",
          modelId: "shared-model",
          accuracy: "exact",
          updatedAt: 1,
          justCompacted: false,
        }}
        providerId="provider-b"
        modelId="shared-model"
        policy={policy}
      />,
    );

    expect(screen.getByRole("button", { name: "上下文等待新模型更新" })).toBeInTheDocument();
    expect(screen.queryByText(/26%/)).not.toBeInTheDocument();
  });
});
