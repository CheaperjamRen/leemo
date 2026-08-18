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
});
