import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProviderList, ProviderOfferGrid } from "./ProviderList";
import { ProviderBrandIcon } from "./ProviderBrandIcon";
import type { ProviderSpec } from "../../bridge/contract";

function provider(id: string, configured: boolean, modelCount = 1): ProviderSpec {
  return {
    id,
    name: `服务商 ${id.toUpperCase()}`,
    kind: `raw-kind-${id}`,
    category: "custom",
    apiFormat: "anthropic",
    authMode: "api-key",
    baseUrl: `https://${id}.example.test`,
    modelsUrl: `https://${id}.example.test/models`,
    models: Array.from({ length: modelCount }, (_, index) => `${id}-model-${index + 1}`),
    capabilities: { balanceApi: false, modelDiscovery: true, subscriptionPlan: false },
    configured,
  };
}

it("has a packaged mark for every curated provider family", () => {
  const kinds = [
    "anthropic", "chatgpt-subscription", "claude-subscription", "deepseek", "doubao",
    "gemini", "gemini-subscription", "glm", "glm-coding-plan", "groq", "huawei-maas",
    "kimi", "kimi-code", "lmstudio", "minimax", "minimax-token-plan", "mimo",
    "mimo-token-plan", "modelscope", "nvidia", "ollama", "openai", "openrouter", "qwen",
    "qwen-coding-plan", "qwen-token-plan", "siliconflow", "tokenflux", "volcengine-coding-plan",
  ];
  render(<>{kinds.map((kind) => <ProviderBrandIcon key={kind} kind={kind} name={kind} />)}</>);

  for (const kind of kinds) {
    expect(screen.getByTestId(`provider-brand-${kind}`).querySelector("img")).not.toBeNull();
  }
});

it("keeps light-on-transparent brand assets legible on their intended dark tile", () => {
  render(<ProviderBrandIcon kind="kimi" name="Kimi" />);
  expect(screen.getByTestId("provider-brand-kimi")).toHaveClass("leemo-provider-brand--kimi");
});

describe("ProviderList", () => {
  it("uses the provider brand mark instead of a numbered placeholder for known providers", () => {
    const deepseek = {
      ...provider("deepseek", true),
      name: "DeepSeek",
      kind: "deepseek",
      category: "cn_official" as const,
    };
    render(
      <ProviderList
        providers={[deepseek]}
        selectedId="deepseek"
        tests={{}}
        onSelect={vi.fn()}
        onOpenCatalog={vi.fn()}
        onReorder={vi.fn()}
      />,
    );

    expect(screen.getByTestId("provider-brand-deepseek")).toBeInTheDocument();
    expect(screen.queryByText("01")).not.toBeInTheDocument();
  });

  it("shows only configured providers, with the real status, first model, and default marker", () => {
    render(
      <ProviderList
        providers={[provider("a", true), provider("offer", false)]}
        selectedId="a"
        tests={{ a: { ok: true, latencyMs: 38 } }}
        onSelect={vi.fn()}
        onOpenCatalog={vi.fn()}
        onReorder={vi.fn()}
      />,
    );

    expect(screen.getAllByTestId("provider-list-row")).toHaveLength(1);
    expect(screen.getByText("默认")).toBeInTheDocument();
    expect(screen.getByText("已连接")).toBeInTheDocument();
    expect(screen.getByText("38 ms")).toBeInTheDocument();
    expect(screen.getByTitle("a-model-1")).toBeInTheDocument();
    expect(screen.queryByText("服务商 OFFER")).not.toBeInTheDocument();
    expect(screen.queryByText(/raw-kind-/)).not.toBeInTheDocument();
    expect(screen.queryByText(/example\.test/)).not.toBeInTheDocument();
  });

  it("supports keyboard-friendly move and set-default controls", async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn();
    render(
      <ProviderList
        providers={[provider("a", true), provider("b", true), provider("c", true)]}
        selectedId="a"
        tests={{}}
        onSelect={vi.fn()}
        onOpenCatalog={vi.fn()}
        onReorder={onReorder}
      />,
    );

    await user.click(screen.getByRole("button", { name: "上移 服务商 B" }));
    expect(onReorder).toHaveBeenLastCalledWith(["b", "a", "c"]);

    await user.click(screen.getByRole("button", { name: "下移 服务商 B" }));
    expect(onReorder).toHaveBeenLastCalledWith(["a", "c", "b"]);

    await user.click(screen.getByRole("button", { name: "设为默认 服务商 C" }));
    expect(onReorder).toHaveBeenLastCalledWith(["c", "a", "b"]);
  });

  it("supports dependency-free drag ordering", () => {
    const onReorder = vi.fn();
    render(
      <ProviderList
        providers={[provider("a", true), provider("b", true), provider("c", true)]}
        selectedId="a"
        tests={{}}
        onSelect={vi.fn()}
        onOpenCatalog={vi.fn()}
        onReorder={onReorder}
      />,
    );

    const rows = screen.getAllByTestId("provider-list-row");
    const dataTransfer = {
      effectAllowed: "move",
      dropEffect: "move",
      setData: vi.fn(),
      getData: vi.fn(() => "b"),
    };
    fireEvent.dragStart(rows[1], { dataTransfer });
    fireEvent.dragOver(rows[0], { dataTransfer });
    fireEvent.drop(rows[0], { dataTransfer });

    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c"]);
  });

  it("locks navigation, catalog entry, and every ordering control while busy", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onOpenCatalog = vi.fn();
    const onReorder = vi.fn();
    render(
      <ProviderList
        providers={[provider("a", true), provider("b", true)]}
        selectedId="a"
        tests={{}}
        onSelect={onSelect}
        onOpenCatalog={onOpenCatalog}
        onReorder={onReorder}
        disabled
      />,
    );

    expect(screen.getByRole("button", { name: "选择 服务商 B" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "添加模型服务商" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "上移 服务商 B" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "设为默认 服务商 B" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "选择 服务商 B" }));
    await user.click(screen.getByRole("button", { name: "添加模型服务商" }));
    await user.click(screen.getByRole("button", { name: "上移 服务商 B" }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenCatalog).not.toHaveBeenCalled();
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("reports transient test states and keeps selection actionable", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ProviderList
        providers={[provider("ok", true), provider("bad", true), provider("busy", true)]}
        selectedId="ok"
        tests={{
          ok: { ok: true, latencyMs: 38 },
          bad: { ok: false, error: { kind: "auth", message: "无效凭据" } },
          busy: { pending: true },
        }}
        onSelect={onSelect}
        onOpenCatalog={vi.fn()}
        onReorder={vi.fn()}
      />,
    );

    expect(screen.getByText("需修复")).toBeInTheDocument();
    expect(screen.getByText("测试中")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "选择 服务商 BAD" }));
    expect(onSelect).toHaveBeenCalledWith("bad");
  });

  it("keeps a saved instance with a missing key editable without making it the default", () => {
    const incomplete = { ...provider("draft", false, 0), saved: true };
    render(
      <ProviderList
        providers={[incomplete]}
        selectedId="draft"
        tests={{}}
        onSelect={vi.fn()}
        onOpenCatalog={vi.fn()}
        onReorder={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "选择 服务商 DRAFT" })).toBeInTheDocument();
    expect(screen.getByText("待补 Key")).toBeInTheDocument();
    expect(screen.queryByText("默认")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设为默认 服务商 DRAFT" })).toBeDisabled();
  });

  it("describes an incomplete key-free local service as missing a model, not a key", () => {
    const incomplete = {
      ...provider("ollama", false, 0),
      name: "Ollama",
      kind: "ollama",
      authMode: "none" as const,
      saved: true,
      capabilities: { balanceApi: false, modelDiscovery: true, subscriptionPlan: false, local: true },
    };
    render(
      <ProviderList
        providers={[incomplete]}
        selectedId="ollama"
        tests={{}}
        onSelect={vi.fn()}
        onOpenCatalog={vi.fn()}
        onReorder={vi.fn()}
      />,
    );

    expect(screen.getByText("待选模型")).toBeInTheDocument();
    expect(screen.queryByText("待补 Key")).not.toBeInTheDocument();
  });
});

describe("ProviderOfferGrid", () => {
  const presets: ProviderSpec[] = [
    {
      ...provider("gemini-subscription", false, 3),
      name: "Gemini 订阅",
      kind: "gemini-subscription",
      category: "official",
      baseUrl: "",
      modelsUrl: undefined,
      authMode: "oauth-subscription",
      productKind: "consumer-subscription",
      capabilities: { balanceApi: false, modelDiscovery: false, subscriptionPlan: true },
    },
    { ...provider("deepseek", false, 2), name: "DeepSeek", kind: "deepseek", category: "cn_official" },
    { ...provider("glm", false, 2), name: "GLM（智谱）", kind: "glm", category: "cn_official" },
    { ...provider("kimi", true, 2), name: "Kimi（月之暗面）", kind: "kimi", category: "cn_official" },
    { ...provider("qwen", false, 2), name: "通义千问（百炼）", kind: "qwen", category: "cn_official" },
    {
      ...provider("ollama", false, 0),
      name: "Ollama",
      kind: "ollama",
      category: "official",
      apiFormat: "openai",
      authMode: "none",
      baseUrl: "http://127.0.0.1:11434/v1",
      modelsUrl: "http://127.0.0.1:11434/v1/models",
      capabilities: { balanceApi: false, modelDiscovery: true, subscriptionPlan: false, local: true },
    },
  ];

  it("offers every real preset plus a custom Provider without fake commercial data", () => {
    render(<ProviderOfferGrid providers={presets} onChoose={vi.fn()} />);

    expect(screen.getAllByTestId("provider-offer-card")).toHaveLength(7);
    expect(screen.getByText("已有订阅")).toBeInTheDocument();
    expect(screen.getByText("国内官方")).toBeInTheDocument();
    expect(screen.getByText("本地与自部署")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "配置 DeepSeek" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "配置 Gemini 订阅" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "配置 GLM（智谱）" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "配置 Kimi（月之暗面）" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "配置 通义千问（百炼）" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "配置 自定义服务" })).toBeInTheDocument();
    expect(screen.getByText("本机运行 · 无需 API Key")).toBeInTheDocument();
    expect(screen.getByText("订阅登录 · 无需 API Key")).toBeInTheDocument();
    expect(screen.queryByText(/价格|免费额度|¥|\$/)).not.toBeInTheDocument();
  });

  it("renders recognizable local brand marks for every known offer", () => {
    render(<ProviderOfferGrid providers={presets} onChoose={vi.fn()} />);

    for (const kind of ["gemini-subscription", "deepseek", "glm", "kimi", "qwen", "ollama"]) {
      expect(screen.getByTestId(`provider-brand-${kind}`)).toBeInTheDocument();
    }
  });

  it("uses the compact three-column provider catalog layout on the main settings surface", () => {
    render(<ProviderOfferGrid providers={presets} onChoose={vi.fn()} />);

    const subscriptionGroup = screen.getByRole("heading", { name: "已有订阅" }).parentElement;
    const grid = subscriptionGroup?.querySelector(".leemo-provider-offer-grid");
    expect(grid).toHaveAttribute("data-layout", "three-column");
    expect(screen.getAllByTestId("provider-offer-card").every((card) => card.getAttribute("data-density") === "compact")).toBe(true);
  });

  it("keeps a stable id for first setup, but creates another instance for an already configured family", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(<ProviderOfferGrid providers={presets} onChoose={onChoose} />);

    await user.click(screen.getByRole("button", { name: "配置 DeepSeek" }));
    expect(onChoose).toHaveBeenLastCalledWith(expect.objectContaining({
      id: "deepseek",
      kind: "deepseek",
      modelsUrl: "https://deepseek.example.test/models",
      models: ["deepseek-model-1", "deepseek-model-2"],
    }));

    await user.click(screen.getByRole("button", { name: "配置 Kimi（月之暗面）" }));
    expect(onChoose).toHaveBeenLastCalledWith(expect.not.objectContaining({ id: expect.anything() }));
    expect(onChoose).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "kimi" }));

    await user.click(screen.getByRole("button", { name: "配置 Ollama" }));
    expect(onChoose).toHaveBeenLastCalledWith(expect.objectContaining({
      id: "ollama",
      kind: "ollama",
      authMode: "none",
    }));
  });

  it("does not prefill an endpoint or model for the custom Provider", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(<ProviderOfferGrid providers={presets} onChoose={onChoose} />);

    await user.click(screen.getByRole("button", { name: "配置 自定义服务" }));
    expect(onChoose).toHaveBeenCalledWith({
      kind: "custom",
      name: "自定义服务",
      baseUrl: "",
      apiFormat: "anthropic",
      authMode: "api-key",
      productKind: "self-hosted",
    });
  });

  it("finds a provider by Chinese alias and hides unrelated offers", async () => {
    const user = userEvent.setup();
    const searchable: ProviderSpec[] = [
      {
        ...provider("tokenflux", false),
        name: "TokenFlux",
        kind: "tokenflux",
        category: "official",
        apiFormat: "openai-responses",
        productKind: "aggregator",
        searchAliases: ["词元流动", "中转"],
      },
      {
        ...provider("deepseek", false),
        name: "DeepSeek",
        kind: "deepseek",
        category: "cn_official",
        productKind: "metered-api",
      },
    ];

    render(<ProviderOfferGrid providers={searchable} onChoose={vi.fn()} />);
    await user.type(screen.getByRole("searchbox", { name: "搜索模型服务" }), "词元流动");

    expect(screen.getByRole("button", { name: "配置 TokenFlux" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "配置 DeepSeek" })).not.toBeInTheDocument();
    expect(screen.getByText("聚合与中转")).toBeInTheDocument();
  });
});
