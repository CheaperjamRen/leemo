import { Server } from "lucide-react";
import anthropicLogo from "../assets/provider-brands/anthropic.svg";
import claudeLogo from "../assets/provider-brands/claude.svg";
import deepseekLogo from "../assets/provider-brands/deepseek.svg";
import doubaoLogo from "../assets/provider-brands/doubao.svg";
import geminiLogo from "../assets/provider-brands/gemini.svg";
import groqLogo from "../assets/provider-brands/groq.svg";
import huaweiCloudLogo from "../assets/provider-brands/huawei-cloud.svg";
import kimiLogo from "../assets/provider-brands/kimi.svg";
import lmStudioLogo from "../assets/provider-brands/lmstudio.svg";
import minimaxLogo from "../assets/provider-brands/minimax.svg";
import modelScopeLogo from "../assets/provider-brands/modelscope.svg";
import nvidiaLogo from "../assets/provider-brands/nvidia.svg";
import ollamaLogo from "../assets/provider-brands/ollama.svg";
import openAiLogo from "../assets/provider-brands/openai.svg";
import openRouterLogo from "../assets/provider-brands/openrouter.svg";
import qwenLogo from "../assets/provider-brands/qwen.svg";
import siliconFlowLogo from "../assets/provider-brands/siliconflow.svg";
import tokenFluxLogo from "../assets/provider-brands/tokenflux.png";
import volcengineLogo from "../assets/provider-brands/volcengine.svg";
import xiaomiMimoLogo from "../assets/provider-brands/xiaomi-mimo.svg";
import zhipuLogo from "../assets/provider-brands/zhipu.svg";

const providerBrandAssets: Record<string, string> = {
  anthropic: anthropicLogo,
  "chatgpt-subscription": openAiLogo,
  "claude-subscription": claudeLogo,
  deepseek: deepseekLogo,
  doubao: doubaoLogo,
  gemini: geminiLogo,
  "gemini-subscription": geminiLogo,
  glm: zhipuLogo,
  "glm-coding-plan": zhipuLogo,
  groq: groqLogo,
  "huawei-maas": huaweiCloudLogo,
  kimi: kimiLogo,
  "kimi-code": kimiLogo,
  lmstudio: lmStudioLogo,
  minimax: minimaxLogo,
  "minimax-token-plan": minimaxLogo,
  mimo: xiaomiMimoLogo,
  "mimo-token-plan": xiaomiMimoLogo,
  modelscope: modelScopeLogo,
  nvidia: nvidiaLogo,
  ollama: ollamaLogo,
  openai: openAiLogo,
  openrouter: openRouterLogo,
  qwen: qwenLogo,
  "qwen-coding-plan": qwenLogo,
  "qwen-token-plan": qwenLogo,
  siliconflow: siliconFlowLogo,
  tokenflux: tokenFluxLogo,
  "volcengine-coding-plan": volcengineLogo,
};

export function ProviderBrandIcon({ kind, name, compact = false }: { kind: string; name: string; compact?: boolean }) {
  const asset = providerBrandAssets[kind];
  const brandTheme = kind === "kimi" || kind === "kimi-code" ? " leemo-provider-brand--kimi" : "";
  return (
    <span
      className={`leemo-provider-brand${compact ? " leemo-provider-brand--compact" : ""}${brandTheme}`}
      data-testid={`provider-brand-${kind}`}
      title={name}
    >
      {asset ? <img src={asset} alt="" aria-hidden /> : <Server aria-hidden />}
    </span>
  );
}
