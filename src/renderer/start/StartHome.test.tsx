import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BridgeProvider } from "../bridge/context";
import type { BridgeClient } from "../bridge/client";
import StartHome from "./StartHome";

describe("StartHome", () => {
  it("renders exactly the four approved sections and never invokes a model on mount", () => {
    const invoke = vi.fn();
    const client = { invoke, subscribe: vi.fn(() => () => {}) } as unknown as BridgeClient;
    render(<BridgeProvider client={client}><StartHome onOpen={vi.fn()} /></BridgeProvider>);

    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "待完成事项", "今天", "收集箱", "最近",
    ]);
    expect(invoke).not.toHaveBeenCalledWith("bridge:generateGlobalPendingOverview", expect.anything());
  });

  it("marks empty cards for compact layout instead of stretching four blank panels", () => {
    render(<BridgeProvider><StartHome onOpen={vi.fn()} /></BridgeProvider>);

    for (const name of ["待完成事项", "今天", "收集箱", "最近"]) {
      expect(screen.getByRole("heading", { level: 2, name }).closest("section"))
        .toHaveAttribute("data-density", "compact");
    }
  });

  it("uses ordinary workspace copy instead of explaining internal AI behavior", () => {
    render(<BridgeProvider><StartHome onOpen={vi.fn()} /></BridgeProvider>);

    expect(screen.queryByText(/叫醒 AI|自动触发 AI|自动调用模型|主动要求时调用模型/)).not.toBeInTheDocument();
    expect(screen.getByText("尚未整理的记录")).toBeInTheDocument();
  });
});
