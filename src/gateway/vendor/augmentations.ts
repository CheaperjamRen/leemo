// Module augmentation for the vendored UnifiedChatRequest.
//
// Upstream transformers (reasoning/streamoptions) assign provider-shaping
// fields the interface never declared. Upstream ships via esbuild transpile
// (never type-checks), so these are latent holes — under our `strict` tsc they
// surface as TS2339. We widen the type here (outside the vendor tree) instead
// of patching byte-identical vendor source.
//
// The specifier MUST match how vendor files import the module so TS treats it
// as the same module identity. Vendor uses BOTH `@/types/llm` (alias) and
// `../types/llm` (relative); the tsconfig `@/*` path maps `@/types/llm` to this
// exact file, so augmenting `@/types/llm` merges into the one interface symbol.
import "@/types/llm";

declare module "@/types/llm" {
  interface UnifiedChatRequest {
    // reasoning.transformer.ts
    thinking?: {
      type: "enabled" | "disabled";
      budget_tokens?: number;
    };
    enable_thinking?: boolean;
    // streamoptions.transformer.ts
    stream_options?: {
      include_usage: boolean;
    };
  }
}
