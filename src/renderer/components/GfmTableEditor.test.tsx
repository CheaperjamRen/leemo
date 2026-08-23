import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import CaptureEditor from "./CaptureEditor";
import {
  deleteTableColumns,
  deleteTableRows,
  insertTableColumns,
  insertTableRows,
  parseGfmTable,
  pasteTableMatrix,
  positionTableTools,
  resizeTableColumns,
  serializeGfmTable,
} from "./GfmTableEditor";

beforeAll(() => {
  if (!("PointerEvent" in globalThis)) {
    Object.defineProperty(globalThis, "PointerEvent", {
      configurable: true,
      value: MouseEvent,
    });
  }
  if (!("DragEvent" in globalThis)) {
    Object.defineProperty(globalThis, "DragEvent", {
      configurable: true,
      value: class DragEvent extends Event {},
    });
  }
  if (!("ClipboardEvent" in globalThis)) {
    Object.defineProperty(globalThis, "ClipboardEvent", {
      configurable: true,
      value: class ClipboardEvent extends Event {},
    });
  }
});

afterEach(() => vi.useRealTimers());

describe("GFM table document model", () => {
  it("round-trips escaped pipes, alignments and optional persisted widths", () => {
    const source = [
      "| 名称 | 说明 | 数值 |",
      "| :--- | :---: | ---: |",
      String.raw`| A\|B | C:\\Temp | 12 |`,
      "<!-- leemo-table: widths=140,260,96 -->",
    ].join("\n");

    const table = parseGfmTable(source);
    expect(table.headers).toEqual(["名称", "说明", "数值"]);
    expect(table.alignments).toEqual(["left", "center", "right"]);
    expect(table.rows).toEqual([["A|B", String.raw`C:\Temp`, "12"]]);
    expect(table.columnWidths).toEqual([140, 260, 96]);
    const serialized = serializeGfmTable(table);
    expect(serialized).toContain("| --- | :---: | ---: |");
    expect(parseGfmTable(serialized)).toEqual(table);
  });

  it("keeps ordinary GFM clean until the user customizes a width", () => {
    const source = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    expect(serializeGfmTable(parseGfmTable(source))).toBe(source);
  });

  it("inserts and deletes rows relative to the selected range", () => {
    const table = parseGfmTable("| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |");
    const inserted = insertTableRows(table, 1, 2, "above");
    expect(inserted.rows).toEqual([["1", "2"], ["", ""], ["", ""], ["3", "4"], ["5", "6"]]);
    expect(deleteTableRows(inserted, 1, 2).rows).toEqual([["1", "2"], ["3", "4"], ["5", "6"]]);
  });

  it("inserts and deletes columns relative to the selected range", () => {
    const table = parseGfmTable("| A | B | C |\n| --- | :---: | ---: |\n| 1 | 2 | 3 |");
    const inserted = insertTableColumns(table, 1, 2, "right");
    expect(inserted.headers).toEqual(["A", "B", "C", "列 4", "列 5"]);
    expect(inserted.rows).toEqual([["1", "2", "3", "", ""]]);
    expect(deleteTableColumns(inserted, 1, 2).headers).toEqual(["A", "列 4", "列 5"]);
    expect(deleteTableColumns(inserted, 1, 2).rows).toEqual([["1", "", ""]]);
  });

  it("pastes a TSV matrix from the active cell and expands rows and columns", () => {
    const table = parseGfmTable("| A | B |\n| --- | --- |\n| 1 | 2 |");
    const pasted = pasteTableMatrix(table, 1, 1, "x\ty\nz\tw");
    expect(pasted.headers).toEqual(["A", "B", "列 3"]);
    expect(pasted.rows).toEqual([["1", "x", "y"], ["", "z", "w"]]);
  });

  it("resizes one boundary with sensible minimums while keeping the table width stable", () => {
    expect(resizeTableColumns([160, 160, 160], 0, 70)).toEqual([230, 90, 160]);
    expect(resizeTableColumns([160, 160, 160], 0, 140)).toEqual([240, 80, 160]);
    expect(resizeTableColumns([160, 160], 1, 60)).toEqual([160, 220]);
  });

  it("anchors a compact tool strip near the selected region and flips below when space is tight", () => {
    const container = { left: 100, right: 600, top: 100, bottom: 700, width: 500, height: 600 };
    const toolbar = { left: 0, right: 260, top: 0, bottom: 32, width: 260, height: 32 };
    expect(positionTableTools({
      anchor: { left: 380, right: 460, top: 300, bottom: 330, width: 80, height: 30 },
      container,
      toolbar,
      viewport: { left: 0, right: 760, top: 80, bottom: 760, width: 760, height: 680 },
    })).toEqual({ left: 190, placement: "above", top: 162 });
    expect(positionTableTools({
      anchor: { left: 560, right: 600, top: 104, bottom: 134, width: 40, height: 30 },
      container,
      toolbar,
      viewport: { left: 0, right: 760, top: 100, bottom: 760, width: 760, height: 660 },
    })).toEqual({ left: 234, placement: "below", top: 40 });
    expect(positionTableTools({
      anchor: { left: 180, right: 460, top: 300, bottom: 370, width: 280, height: 70 },
      container,
      toolbar,
      viewport: { left: 0, right: 760, top: 80, bottom: 760, width: 760, height: 680 },
      avoidAboveUntil: 286,
    })).toEqual({ left: 90, placement: "below", top: 276 });
  });
});

describe("GFM table editing interaction", () => {
  const source = "| A | B |\n| --- | ---: |\n| 1 | 2 |\n| 3 | 4 |";

  function renderTable(onMarkdownChange = vi.fn()) {
    render(
      <CaptureEditor
        variant="document"
        markdown={source}
        onMarkdownChange={onMarkdownChange}
        onSave={vi.fn()}
      />,
    );
    return onMarkdownChange;
  }

  it("uses Tab and Shift+Tab for cell navigation and appends a row from the final cell", async () => {
    renderTable();
    const first = screen.getByRole("textbox", { name: "表头 1" });
    const second = screen.getByRole("textbox", { name: "表头 2" });
    first.focus();
    fireEvent.keyDown(first, { key: "Tab" });
    await waitFor(() => expect(document.activeElement).toBe(second));
    fireEvent.keyDown(second, { key: "Tab", shiftKey: true });
    await waitFor(() => expect(document.activeElement).toBe(first));

    const last = screen.getByRole("textbox", { name: "第 2 行第 2 列" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    const appended = await screen.findByRole("textbox", { name: "第 3 行第 1 列" });
    await waitFor(() => expect(appended).toHaveFocus());
  });

  it("selects contiguous rows and applies structural actions to that range", async () => {
    const user = userEvent.setup();
    const onMarkdownChange = renderTable();
    await user.click(screen.getByRole("button", { name: "选择第 1 行" }));
    fireEvent.click(screen.getByRole("button", { name: "选择第 2 行" }), { shiftKey: true });
    expect(screen.getByText("第 1–2 行")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "删除所选行" }));
    await waitFor(() => expect(String(onMarkdownChange.mock.calls.at(-1)?.[0] ?? "")).toContain("|  |  |"));
    expect(screen.getByRole("textbox", { name: "第 1 行第 1 列" })).toHaveValue("");
    expect(screen.queryByRole("textbox", { name: "第 2 行第 1 列" })).not.toBeInTheDocument();
  });

  it("keeps compact structural actions visually distinguishable without their text labels", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByRole("button", { name: "选择第 2 列" }));
    const columnActions = [
      screen.getByRole("button", { name: "在左侧插入列" }),
      screen.getByRole("button", { name: "在右侧插入列" }),
      screen.getByRole("button", { name: "恢复等宽列" }),
    ];
    expect(columnActions.map((button) => button.querySelector("svg")?.getAttribute("data-table-action-icon")))
      .toEqual(["insert-column-left", "insert-column-right", "equal-columns"]);

    await user.click(screen.getByRole("button", { name: "选择第 1 行" }));
    const rowActions = [
      screen.getByRole("button", { name: "在上方插入行" }),
      screen.getByRole("button", { name: "在下方插入行" }),
    ];
    expect(rowActions.map((button) => button.querySelector("svg")?.getAttribute("data-table-action-icon")))
      .toEqual(["insert-row-above", "insert-row-below"]);
  });

  it("marks small tables so compact windows can fit all columns without losing persisted widths", () => {
    renderTable();
    expect(screen.getByRole("grid", { name: "Markdown 表格" }).closest(".markdown-editor__gfm-table"))
      .toHaveAttribute("data-compact-fit", "true");
  });

  it("pastes a TSV block from the active cell and expands the visual grid", async () => {
    const onMarkdownChange = renderTable();
    const target = screen.getByRole("textbox", { name: "第 1 行第 2 列" });
    fireEvent.paste(target, {
      clipboardData: {
        files: [],
        getData: () => "x\ty\nz\tw",
        types: ["text/plain"],
      },
    });
    expect(await screen.findByRole("textbox", { name: "表头 3" })).toHaveValue("列 3");
    expect(screen.getByRole("textbox", { name: "第 1 行第 2 列" })).toHaveValue("x");
    expect(screen.getByRole("textbox", { name: "第 2 行第 3 列" })).toHaveValue("w");
    await waitFor(() => expect(String(onMarkdownChange.mock.calls.at(-1)?.[0] ?? "")).toContain("| 3 | z | w |"));
  });

  it("copies a selected column as TSV and confirms the action", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    renderTable();
    await user.click(screen.getByRole("button", { name: "选择第 2 列" }));
    await user.click(screen.getByRole("button", { name: "复制所选表格内容" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("B\n2\n4"));
    expect(screen.getByRole("button", { name: "复制所选表格内容" })).toHaveTextContent("已复制");
  });

  it("drag-selects a rectangular cell range and applies copy and batch bold", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const onMarkdownChange = renderTable();
    const first = screen.getByRole("textbox", { name: "第 1 行第 1 列" });
    const last = screen.getByRole("textbox", { name: "第 2 行第 2 列" });

    fireEvent.pointerDown(first, { button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerEnter(last, { buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(window, { button: 0, buttons: 0, pointerId: 1 });

    expect(screen.getByText("2 × 2 单元格")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "复制所选表格内容" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("1\t2\n3\t4"));
    await user.click(screen.getByRole("button", { name: "加粗所选单元格" }));
    await waitFor(() => expect(String(onMarkdownChange.mock.calls.at(-1)?.[0] ?? "")).toContain("| **1** | **2** |"));
    expect(screen.getByRole("textbox", { name: "第 2 行第 2 列" })).toHaveValue("**4**");
  });

  it("pastes a clipboard matrix into the top-left cell of a dragged range", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "readText").mockResolvedValue("甲\t乙\n丙\t丁");
    renderTable();
    const first = screen.getByRole("textbox", { name: "第 1 行第 1 列" });
    const last = screen.getByRole("textbox", { name: "第 2 行第 2 列" });

    fireEvent.pointerDown(first, { button: 0, buttons: 1, pointerId: 2 });
    fireEvent.pointerEnter(last, { buttons: 1, pointerId: 2 });
    fireEvent.pointerUp(window, { button: 0, buttons: 0, pointerId: 2 });
    await user.click(screen.getByRole("button", { name: "粘贴到所选单元格" }));

    expect(screen.getByRole("textbox", { name: "第 1 行第 1 列" })).toHaveValue("甲");
    expect(screen.getByRole("textbox", { name: "第 2 行第 2 列" })).toHaveValue("丁");
  });

  it("selects and removes the whole table through an undoable direct action", async () => {
    const user = userEvent.setup();
    const onMarkdownChange = renderTable();
    await user.click(screen.getByRole("button", { name: "选择整张表格" }));
    await user.click(screen.getByRole("button", { name: "删除表格" }));
    await waitFor(() => expect(screen.queryByRole("grid", { name: "Markdown 表格" })).not.toBeInTheDocument());
    await waitFor(() => expect(String(onMarkdownChange.mock.calls.at(-1)?.[0] ?? "")).toBe(""));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "便签正文" })).toHaveFocus());
    await user.keyboard("{Control>}z{/Control}");
    expect(await screen.findByRole("grid", { name: "Markdown 表格" })).toBeInTheDocument();
  });

  it("previews column resizing locally and persists one width update on release", async () => {
    const onMarkdownChange = renderTable();
    const headers = document.querySelectorAll<HTMLElement>(".markdown-editor__table-data-header");
    headers.forEach((header) => vi.spyOn(header, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 160, bottom: 36, width: 160, height: 36, toJSON: () => ({}),
    }));
    const separator = screen.getByRole("separator", { name: "调整第 1 列宽" });
    const callsBeforeResize = onMarkdownChange.mock.calls.length;
    fireEvent(separator, new MouseEvent("pointerdown", { bubbles: true, clientX: 100 }));
    fireEvent(window, new MouseEvent("pointermove", { bubbles: true, clientX: 150 }));
    expect(onMarkdownChange).toHaveBeenCalledTimes(callsBeforeResize);
    fireEvent(window, new MouseEvent("pointerup", { bubbles: true, clientX: 150 }));
    await waitFor(() => expect(String(onMarkdownChange.mock.calls.at(-1)?.[0] ?? "")).toContain("<!-- leemo-table: widths=210,110 -->"));
  });

  it("updates cell text immediately but coalesces Markdown serialization while typing", async () => {
    vi.useFakeTimers();
    const onMarkdownChange = renderTable();
    const cell = screen.getByRole("textbox", { name: "第 1 行第 1 列" });
    fireEvent.change(cell, { target: { value: "一" } });
    fireEvent.change(cell, { target: { value: "一二" } });
    fireEvent.change(cell, { target: { value: "一二三" } });
    expect(cell).toHaveValue("一二三");
    expect(onMarkdownChange).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(120);
      await Promise.resolve();
    });
    expect(onMarkdownChange).toHaveBeenCalledTimes(1);
    expect(String(onMarkdownChange.mock.calls[0]?.[0] ?? "")).toContain("| 一二三 | 2 |");
  });
});
