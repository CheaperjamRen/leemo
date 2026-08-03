import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InputArea from "./InputArea";
import type { ProviderSpec } from "../../bridge/contract";

function spec(over: Partial<ProviderSpec> & { id: string }): ProviderSpec {
  return {
    name: over.id,
    kind: over.id,
    category: "cn_official",
    apiFormat: "anthropic",
    authMode: "api-key",
    baseUrl: "https://example.test/anthropic",
    models: ["m1"],
    capabilities: { balanceApi: false, modelDiscovery: false, subscriptionPlan: false },
    ...over,
  } as ProviderSpec;
}

const CONFIGURED = spec({
  id: "deepseek",
  name: "DeepSeek",
  configured: true,
  models: ["deepseek-v4-flash", "deepseek-v4-pro"],
  modelCapabilities: {
    "deepseek-v4-flash": { thinking: true, vision: false },
    "deepseek-v4-pro": { thinking: true, vision: false },
  },
});
const UNCONFIGURED = spec({
  id: "qwen",
  name: "通义千问（百炼）",
  configured: false,
  models: ["qwen3.7-flash", "qwen3.7-plus"],
});

function setup(props: Partial<React.ComponentProps<typeof InputArea>> = {}) {
  return render(
    <InputArea
      conversationId="c1"
      value=""
      onChange={() => {}}
      onSend={() => {}}
      {...props}
    />,
  );
}

describe("InputArea model picker — only configured providers appear", () => {
  it("lists a configured provider's models and NOT an unconfigured one's", async () => {
    const user = userEvent.setup();
    setup({ providers: [CONFIGURED, UNCONFIGURED], currentModelId: "deepseek-v4-flash" });

    await user.click(screen.getByText(/deepseek-v4-flash/));

    expect(screen.getByRole("button", { name: /deepseek-v4-pro/ })).toBeTruthy();
    // The requirement in one assertion: an unconfigured family's model names are
    // absent from the DOM entirely, not merely disabled.
    expect(screen.queryByText("qwen3.7-flash")).toBeNull();
    expect(screen.queryByText("qwen3.7-plus")).toBeNull();
    expect(document.body.textContent).not.toContain("qwen3.7");
  });

  it("shows the conversation's real model on the trigger, not a hardcoded label", () => {
    setup({ providers: [CONFIGURED], currentModelId: "deepseek-v4-pro" });
    expect(screen.getByText(/deepseek-v4-pro/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("默认模型");
  });

  it("marks the current model and calls onSelectModel with the picked one", async () => {
    const user = userEvent.setup();
    const onSelectModel = vi.fn();
    setup({
      providers: [CONFIGURED],
      currentProviderId: "deepseek",
      currentModelId: "deepseek-v4-flash",
      onSelectModel,
    });

    await user.click(screen.getByText(/deepseek-v4-flash/));
    const current = screen.getByRole("button", { name: /deepseek-v4-flash/ });
    expect(current.getAttribute("aria-current")).toBe("true");

    await user.click(screen.getByRole("button", { name: /deepseek-v4-pro/ }));
    expect(onSelectModel).toHaveBeenCalledWith("deepseek", "deepseek-v4-pro");
  });

  it("groups by instance so two accounts of one family stay distinguishable", async () => {
    const user = userEvent.setup();
    setup({
      providers: [
        CONFIGURED,
        spec({ id: "deepseek-work", kind: "deepseek", name: "DeepSeek(工作)", configured: true, models: ["deepseek-v4-flash"] }),
      ],
      currentModelId: "deepseek-v4-flash",
    });

    await user.click(screen.getByText(/deepseek-v4-flash/));
    expect(screen.getByText("DeepSeek")).toBeTruthy();
    expect(screen.getByText("DeepSeek(工作)")).toBeTruthy();
    // Same model name under both instances → two rows, not one.
    expect(screen.getAllByRole("button", { name: /deepseek-v4-flash/ })).toHaveLength(2);
  });

  it("guides to settings instead of showing an empty box when nothing is configured", async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    setup({ providers: [UNCONFIGURED], onOpenSettings });

    await user.click(screen.getByText(/选择模型/));
    expect(screen.getByText(/还没有可用的模型/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /去设置页配置模型/ }));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("renders capability badges only for verified evidence, not preset hints", async () => {
    const user = userEvent.setup();
    setup({
      providers: [
        spec({
          id: "qwen",
          name: "通义",
          configured: true,
          models: ["qwen3.7-flash", "qwen3.7-max"],
          // measured: max lacks vision while its sibling has it
          modelCapabilities: {
            "qwen3.7-flash": { thinking: true, vision: true },
            "qwen3.7-max": { thinking: true, vision: false },
          },
          modelCapabilityEvidence: {
            "qwen3.7-flash": {
              image: { probe: { status: "verified", checkedAt: 1 } },
              reasoning: { probe: { status: "verified", checkedAt: 1 } },
            },
          },
        }),
      ],
      currentModelId: "qwen3.7-flash",
    });

    await user.click(screen.getByText(/qwen3\.7-flash/));
    const flash = screen.getByRole("button", { name: /qwen3\.7-flash/ });
    const max = screen.getByRole("button", { name: /qwen3\.7-max/ });
    expect(flash.textContent).toContain("识图");
    expect(max.textContent).not.toContain("识图");
    expect(max.textContent).not.toContain("思考");
  });

  it("warns neutrally for an unconfirmed model but still sends the image", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    setup({
      value: "看看这张图",
      onSend,
      resolveFilePath: () => "C:\\Users\\Rengar\\Pictures\\screen.png",
      providers: [spec({
        id: "custom",
        configured: true,
        models: ["mystery-vision"],
        modelCapabilities: { "mystery-vision": { thinking: false, vision: false } },
      })],
      currentProviderId: "custom",
      currentModelId: "mystery-vision",
    });

    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      new File(["png"], "screen.png", { type: "image/png" }),
    );

    expect(screen.getByText("尚未确认当前模型的图片能力，仍可直接发送。")).toBeTruthy();
    expect(screen.getByLabelText("附件")).not.toBeDisabled();
    expect(screen.getByLabelText("发送")).not.toBeDisabled();
    await user.click(screen.getByLabelText("发送"));
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("keeps a failed automatic image probe advisory and lets the user send anyway", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    setup({
      value: "继续尝试",
      onSend,
      resolveFilePath: () => "C:\\Users\\Rengar\\Pictures\\screen.png",
      providers: [spec({
        id: "custom",
        configured: true,
        models: ["maybe-vision"],
        modelCapabilityEvidence: {
          "maybe-vision": { image: { probe: { status: "failed", checkedAt: 2 } } },
        },
      })],
      currentProviderId: "custom",
      currentModelId: "maybe-vision",
    });

    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      new File(["png"], "screen.png", { type: "image/png" }),
    );

    expect(screen.getByText("本次检测未通过，模型仍可能支持图片。")).toBeTruthy();
    await user.click(screen.getByLabelText("发送"));
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("does not show a failed warning after the user explicitly confirms image support", async () => {
    const user = userEvent.setup();
    setup({
      resolveFilePath: () => "C:\\Users\\Rengar\\Pictures\\screen.png",
      providers: [spec({
        id: "custom",
        configured: true,
        models: ["confirmed-vision"],
        modelCapabilityEvidence: {
          "confirmed-vision": {
            image: {
              probe: { status: "failed", checkedAt: 2 },
              userOverride: { supported: true, updatedAt: 3 },
            },
          },
        },
      })],
      currentProviderId: "custom",
      currentModelId: "confirmed-vision",
    });

    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      new File(["png"], "screen.png", { type: "image/png" }),
    );

    expect(screen.queryByText(/模型仍可能支持图片/)).toBeNull();
    expect(screen.queryByText(/尚未确认当前模型的图片能力/)).toBeNull();
  });

  it("opens the existing picker from a retry notice without switching models automatically", async () => {
    const user = userEvent.setup();
    const onSelectModel = vi.fn();
    setup({
      providers: [CONFIGURED],
      currentProviderId: "deepseek",
      currentModelId: "deepseek-v4-flash",
      onSelectModel,
      retryDraft: {
        runId: "run-1",
        text: "原消息",
        attachments: [],
        providerId: "deepseek",
        modelId: "deepseek-v4-flash",
        errorMessage: "请求失败",
      },
    });

    await user.click(screen.getByRole("button", { name: "选择其他模型" }));

    expect(screen.getByRole("button", { name: /deepseek-v4-pro/ })).toBeTruthy();
    expect(onSelectModel).not.toHaveBeenCalled();
  });
});
