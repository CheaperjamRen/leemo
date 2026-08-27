import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BridgeProvider, useUi } from "../bridge/context";
import WorkbenchStage from "./WorkbenchStage";
import { WORKBENCH_STAGE_SPLIT_MIN_WIDTH } from "../workbench-spatial";

function SurfaceFixture({ file = true }: { file?: boolean }) {
  return (
    <WorkbenchStage
      conversation={<div data-testid="conversation-content">对话内容</div>}
      file={file ? <div data-testid="file-content">文件内容</div> : null}
      hasFile={file}
      conversationMarker={<span aria-label="对话：未读" />}
    />
  );
}

describe("WorkbenchStage", () => {
  it("uses a split conversation and file surface when the central stage is wide", () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: WORKBENCH_STAGE_SPLIT_MIN_WIDTH });
    try {
      render(
        <BridgeProvider>
          <SurfaceFixture />
        </BridgeProvider>,
      );

      const stage = screen.getByTestId("workbench-stage");
      expect(stage).toHaveAttribute("data-layout", "split");
      expect(screen.getByTestId("conversation-surface")).not.toHaveAttribute("inert");
      expect(screen.getByTestId("file-surface")).not.toHaveAttribute("inert");
      expect(screen.getByTestId("workbench-stage-split-handle")).toBeInTheDocument();
      expect(screen.getAllByTestId("conversation-content")).toHaveLength(1);
      expect(screen.getAllByTestId("file-content")).toHaveLength(1);
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  it("turns a narrow stage into mutually exclusive conversation and file tabs", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    try {
      render(
        <BridgeProvider>
          <SurfaceFixture />
        </BridgeProvider>,
      );

      const stage = screen.getByTestId("workbench-stage");
      expect(stage).toHaveAttribute("data-layout", "tabs");
      expect(screen.getByRole("tab", { name: /文件/ })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("conversation-surface")).toHaveAttribute("inert");

      await userEvent.click(screen.getByRole("tab", { name: /对话/ }));
      expect(screen.getByRole("tab", { name: /对话/ })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("conversation-surface")).not.toHaveAttribute("inert");
      expect(screen.getByTestId("file-surface")).toHaveAttribute("inert");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  it("selects the restored file when a narrow stage switches to another scope", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    function ScopeSwitchFixture() {
      const activateWorkbenchScope = useUi((state) => state.activateWorkbenchScope);
      return (
        <>
          <button type="button" onClick={() => activateWorkbenchScope("notebook:second")}>switch-scope</button>
          <WorkbenchStage
            conversation={<div>对话内容</div>}
            file={<div>文件内容</div>}
            hasFile
            fileKey="home\u0000同名笔记.md"
          />
        </>
      );
    }
    try {
      render(
        <BridgeProvider>
          <ScopeSwitchFixture />
        </BridgeProvider>,
      );

      await userEvent.click(screen.getByRole("tab", { name: /对话/ }));
      expect(screen.getByRole("tab", { name: /对话/ })).toHaveAttribute("aria-selected", "true");

      await userEvent.click(screen.getByRole("button", { name: "switch-scope" }));
      expect(screen.getByRole("tab", { name: /文件/ })).toHaveAttribute("aria-selected", "true");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  it("respects a conversation-focused preference when switching narrow scopes", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    function ScopeSwitchFixture() {
      const activateWorkbenchScope = useUi((state) => state.activateWorkbenchScope);
      const setScopeSurface = useUi((state) => state.setScopeSurface);
      const prepare = () => {
        activateWorkbenchScope("notebook:second");
        setScopeSurface("conversation");
        activateWorkbenchScope("global");
      };
      return (
        <>
          <button type="button" onClick={prepare}>prepare-scope</button>
          <button type="button" onClick={() => activateWorkbenchScope("notebook:second")}>switch-scope</button>
          <WorkbenchStage
            conversation={<div>对话内容</div>}
            file={<div>文件内容</div>}
            hasFile
            fileKey="home\u0000同名笔记.md"
          />
        </>
      );
    }
    try {
      render(
        <BridgeProvider>
          <ScopeSwitchFixture />
        </BridgeProvider>,
      );

      await userEvent.click(screen.getByRole("button", { name: "prepare-scope" }));
      await userEvent.click(screen.getByRole("button", { name: "switch-scope" }));
      expect(screen.getByRole("tab", { name: /对话/ })).toHaveAttribute("aria-selected", "true");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  it("honors an explicit file-focused surface even when the stage is wide", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    function FocusFile() {
      const setScopeSurface = useUi((state) => state.setScopeSurface);
      return (
        <>
          <button type="button" onClick={() => setScopeSurface("file")}>focus-file</button>
          <SurfaceFixture />
        </>
      );
    }
    try {
      render(
        <BridgeProvider>
          <FocusFile />
        </BridgeProvider>,
      );

      await userEvent.click(screen.getByRole("button", { name: "focus-file" }));
      expect(screen.getByTestId("workbench-stage")).toHaveAttribute("data-layout", "tabs");
      expect(screen.getByRole("tab", { name: /文件/ })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("conversation-surface")).toHaveAttribute("inert");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  it("keeps the conversation full width when no file is open", () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    try {
      render(
        <BridgeProvider>
          <SurfaceFixture file={false} />
        </BridgeProvider>,
      );
      expect(screen.getByTestId("workbench-stage")).toHaveAttribute("data-layout", "conversation");
      expect(screen.queryByRole("tab", { name: /文件/ })).not.toBeInTheDocument();
      expect(screen.queryByTestId("workbench-stage-split-handle")).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  it("moves focus into a newly opened narrow file and restores the composer after close", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    const conversation = <textarea aria-label="输入消息" />;
    try {
      const { rerender } = render(
        <BridgeProvider>
          <WorkbenchStage conversation={conversation} file={null} hasFile={false} />
        </BridgeProvider>,
      );

      rerender(
        <BridgeProvider>
          <WorkbenchStage conversation={conversation} file={<div>文件内容</div>} hasFile fileKey="first.md" />
        </BridgeProvider>,
      );
      await waitFor(() => expect(screen.getByTestId("file-surface")).toHaveFocus());

      rerender(
        <BridgeProvider>
          <WorkbenchStage conversation={conversation} file={null} hasFile={false} />
        </BridgeProvider>,
      );
      await waitFor(() => expect(screen.getByRole("textbox", { name: "输入消息" })).toHaveFocus());
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });
});
