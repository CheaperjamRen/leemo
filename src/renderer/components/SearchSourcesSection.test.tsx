import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SearchSourceStatus } from "../../bridge/contract";
import type { BridgeClient } from "../bridge/client";
import { createSearchSourcesStore } from "../stores/search-sources";
import { SearchSourcesSection } from "./SearchSourcesSection";

const SOURCES: SearchSourceStatus[] = [
  { id: "anysearch", label: "AnySearch", keyless: true, configured: false, configuredFields: [], note: "开箱可用的默认来源" },
  { id: "doubao", label: "豆包搜索", keyless: false, configured: false, configuredFields: [], note: "中文时效信息" },
  { id: "metaso", label: "秘塔搜索", keyless: false, configured: false, configuredFields: [], note: "中文研究与引用" },
  { id: "tavily", label: "Tavily", keyless: false, configured: true, configuredFields: ["apiKey"], note: "通用备用来源" },
  { id: "bocha", label: "博查", keyless: false, configured: false, configuredFields: [], note: "国内通用备用" },
  { id: "google", label: "Google Custom Search", keyless: false, configured: false, configuredFields: [], note: "兼容已有凭据" },
];

function client(saveImpl?: (request: unknown) => Promise<unknown>) {
  const invoke = vi.fn(async (channel: string, request: unknown) => {
    if (channel === "bridge:getSearchSources") return SOURCES;
    if (channel === "bridge:saveSearchKey") return saveImpl ? saveImpl(request) : SOURCES;
    throw new Error(`unexpected ${channel}`);
  });
  return { invoke } as unknown as BridgeClient & { invoke: typeof invoke };
}

function setup(over: {
  c?: ReturnType<typeof client>;
  webEnabled?: boolean;
  search?: boolean;
  fetch?: boolean;
  onToggleWeb?: (value: boolean) => void;
  onToggleSearch?: (value: boolean) => void;
  onToggleFetch?: (value: boolean) => void;
} = {}) {
  const c = over.c ?? client();
  const store = createSearchSourcesStore(c);
  const onToggleWeb = over.onToggleWeb ?? vi.fn();
  const onToggleSearch = over.onToggleSearch ?? vi.fn();
  const onToggleFetch = over.onToggleFetch ?? vi.fn();
  render(
    <SearchSourcesSection
      store={store}
      webEnabled={over.webEnabled ?? true}
      webSearchEnabled={over.search ?? true}
      webFetchEnabled={over.fetch ?? true}
      onToggleWeb={onToggleWeb}
      onToggleSearch={onToggleSearch}
      onToggleFetch={onToggleFetch}
    />,
  );
  return { c, store, onToggleWeb, onToggleSearch, onToggleFetch };
}

async function waitForSources(): Promise<void> {
  await waitFor(() => expect(screen.getByText("豆包搜索")).toBeInTheDocument());
}

describe("SearchSourcesSection — source journey", () => {
  it("按默认、中文增强、更多来源、学术四组展示六个网页源和免配置 arXiv", async () => {
    setup();
    await waitForSources();
    expect(within(screen.getByRole("group", { name: "默认来源" })).getByText("AnySearch")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "中文增强" })).getByText("豆包搜索")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "中文增强" })).getByText("秘塔搜索")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "更多来源" })).getByText("Google Custom Search")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "学术检索" })).getByText("arXiv")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "配置 arXiv" })).not.toBeInTheDocument();
    expect(screen.getByText("论文问题时自动使用")).toBeInTheDocument();
  });

  it("AnySearch 显示开箱可用，不把未填可选 Key 说成错误", async () => {
    setup();
    await waitForSources();
    const row = screen.getByText("AnySearch").closest("div")?.parentElement;
    expect(row?.textContent).toContain("开箱可用");
    expect(row?.textContent).not.toContain("未配置");
  });

  it("一次只展开一个来源，配置字段与状态始终在当前行附近", async () => {
    setup();
    await waitForSources();
    await userEvent.click(screen.getByRole("button", { name: "配置 豆包搜索" }));
    expect(screen.getByLabelText("豆包搜索 API Key")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "配置 秘塔搜索" }));
    expect(screen.queryByLabelText("豆包搜索 API Key")).not.toBeInTheDocument();
    expect(screen.getByLabelText("秘塔搜索 API Key")).toBeInTheDocument();
  });

  it("保存单 Key 来源后清空草稿，秘密不留在 DOM 文本或状态中", async () => {
    const { c, store } = setup();
    await waitForSources();
    await userEvent.click(screen.getByRole("button", { name: "配置 豆包搜索" }));
    const input = screen.getByLabelText("豆包搜索 API Key");
    expect(input).toHaveAttribute("type", "password");
    await userEvent.type(input, "doubao-SECRET-123");
    await userEvent.click(screen.getByRole("button", { name: "保存 豆包搜索" }));
    await waitFor(() => expect(c.invoke).toHaveBeenCalledWith("bridge:saveSearchKey", {
      source: "doubao",
      apiKey: "doubao-SECRET-123",
    }));
    await waitFor(() => expect(input).toHaveValue(""));
    expect(document.body.textContent).not.toContain("doubao-SECRET-123");
    expect(JSON.stringify(store.getState())).not.toContain("doubao-SECRET-123");
  });

  it("Google 在同一处填写 Key 和搜索引擎 ID，缺一项就用人话拦住且不发 IPC", async () => {
    const { c } = setup();
    await waitForSources();
    await userEvent.click(screen.getByRole("button", { name: "配置 Google Custom Search" }));
    expect(screen.getByLabelText("Google API Key")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Google 搜索引擎 ID")).toHaveAttribute("type", "text");
    await userEvent.type(screen.getByLabelText("Google API Key"), "google-key");
    await userEvent.click(screen.getByRole("button", { name: "保存 Google Custom Search" }));
    expect(screen.getByText("API Key 和搜索引擎 ID 需要一起填写。" )).toBeInTheDocument();
    expect(c.invoke).not.toHaveBeenCalledWith("bridge:saveSearchKey", expect.anything());

    await userEvent.type(screen.getByLabelText("Google 搜索引擎 ID"), "cx-id");
    await userEvent.click(screen.getByRole("button", { name: "保存 Google Custom Search" }));
    await waitFor(() => expect(c.invoke).toHaveBeenCalledWith("bridge:saveSearchKey", {
      source: "google",
      apiKey: "google-key",
      engineId: "cx-id",
    }));
  });

  it("已配置来源用显式清除和一次轻确认，不再依赖空输入框的隐藏规则", async () => {
    const { c } = setup();
    await waitForSources();
    await userEvent.click(screen.getByRole("button", { name: "配置 Tavily" }));
    await userEvent.click(screen.getByRole("button", { name: "清除 Tavily 配置" }));
    expect(screen.getByText("确定清除 Tavily？")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "确认清除" }));
    await waitFor(() => expect(c.invoke).toHaveBeenCalledWith("bridge:saveSearchKey", {
      source: "tavily",
      apiKey: "",
    }));
  });

  it("保存失败保留草稿并显示真实原因", async () => {
    const c = client(async () => { throw new Error("safeStorage 不可用"); });
    setup({ c });
    await waitForSources();
    await userEvent.click(screen.getByRole("button", { name: "配置 豆包搜索" }));
    const input = screen.getByLabelText("豆包搜索 API Key");
    await userEvent.type(input, "doubao-key");
    await userEvent.click(screen.getByRole("button", { name: "保存 豆包搜索" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("safeStorage 不可用"));
    expect(input).toHaveValue("doubao-key");
  });

  it("读取失败明确显示，不伪装成空来源列表", async () => {
    const c = { invoke: vi.fn(async () => { throw new Error("读不出来"); }) } as unknown as BridgeClient;
    render(
      <SearchSourcesSection
        store={createSearchSourcesStore(c)}
        webEnabled
        webSearchEnabled
        webFetchEnabled
        onToggleWeb={vi.fn()}
        onToggleSearch={vi.fn()}
        onToggleFetch={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("读不出来"));
  });
});

describe("SearchSourcesSection — capability switches", () => {
  const boxes = () => ({
    web: screen.getByLabelText("允许联网"),
    search: screen.getByLabelText("联网搜索"),
    fetch: screen.getByLabelText("读取网页"),
  });

  it("只显示用户能懂的能力名，不暴露 WebSearch/WebFetch 内部术语", () => {
    setup();
    const { web, search, fetch } = boxes();
    expect(web).toBeInTheDocument();
    expect(search).toBeInTheDocument();
    expect(fetch).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/WebSearch|WebFetch/);
  });

  it("总开关关闭后两个子能力显示关闭且不可点", () => {
    setup({ webEnabled: false, search: true, fetch: true });
    const { search, fetch } = boxes();
    expect(search).not.toBeChecked();
    expect(fetch).not.toBeChecked();
    expect(search).toBeDisabled();
    expect(fetch).toBeDisabled();
  });

  it("总开关开启后搜索与读取网页互相独立", async () => {
    const onToggleSearch = vi.fn();
    const onToggleFetch = vi.fn();
    setup({ search: true, fetch: false, onToggleSearch, onToggleFetch });
    await userEvent.click(boxes().search);
    expect(onToggleSearch).toHaveBeenCalledWith(false);
    await userEvent.click(boxes().fetch);
    expect(onToggleFetch).toHaveBeenCalledWith(true);
  });
});
