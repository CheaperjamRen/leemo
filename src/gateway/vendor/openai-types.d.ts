// Minimal type shim for the `openai` package's type-only imports used by the
// vendored @musistudio/llms transformer core, so we don't pull the entire
// `openai` SDK into the gateway. Shapes are derived (narrow > wide) strictly
// from the fields anthropic.transformer.ts and types/llm.ts actually touch.
//
// Upstream import sites this backs:
//   transformer/anthropic.transformer.ts: `import { ChatCompletion } from "openai/resources"`
//   types/llm.ts: `import type { ChatCompletion, ChatCompletionChunk,
//                    ChatCompletionMessageParam, ChatCompletionTool }
//                    from "openai/resources/chat/completions"`

declare module "openai/resources/chat/completions" {
  /** OpenAI url_citation annotation — only url/title are read. */
  export interface ChatCompletionAnnotation {
    url_citation: {
      url: string;
      title: string;
    };
  }

  /** One tool call on an assistant message. */
  export interface ChatCompletionMessageToolCall {
    id: string;
    type?: "function";
    function: {
      name: string;
      arguments: string;
    };
  }

  /** Assistant message on a (non-stream) completion choice. */
  export interface ChatCompletionResponseMessage {
    role?: string;
    content: string | null;
    annotations?: ChatCompletionAnnotation[];
    tool_calls?: ChatCompletionMessageToolCall[];
    // Non-standard field injected upstream by the reasoning transformer.
    thinking?: {
      content: string;
      signature?: string;
    };
  }

  export interface ChatCompletionChoice {
    index?: number;
    message: ChatCompletionResponseMessage;
    finish_reason: string;
  }

  export interface CompletionUsage {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  }

  /** Non-streaming chat completion — the only openai response shape the
   *  Anthropic transformer inspects field-by-field. */
  export interface ChatCompletion {
    id: string;
    model: string;
    choices: ChatCompletionChoice[];
    usage?: CompletionUsage;
  }

  /** Streaming chunk — used only as an opaque alias (OpenAIStreamChunk);
   *  the transformer parses raw JSON, so a loose shape suffices. */
  export interface ChatCompletionChunk {
    id: string;
    model?: string;
    choices: any[];
    usage?: CompletionUsage;
    [key: string]: any;
  }

  /** Request message param — used only as a typed array element. */
  export interface ChatCompletionMessageParam {
    role: string;
    content?: string | null;
    [key: string]: any;
  }

  /** Tool definition — used only as a typed array element. */
  export interface ChatCompletionTool {
    type: "function";
    function: {
      name: string;
      description?: string;
      parameters?: Record<string, any>;
    };
  }
}

declare module "openai/resources" {
  export {
    ChatCompletion,
    ChatCompletionChunk,
    ChatCompletionMessageParam,
    ChatCompletionTool,
    ChatCompletionMessageToolCall,
    ChatCompletionAnnotation,
    CompletionUsage,
  } from "openai/resources/chat/completions";
}
