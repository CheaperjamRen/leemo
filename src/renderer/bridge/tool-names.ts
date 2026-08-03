export { LEEMO_VISUALIZATION_TOOL_NAME } from "../../bridge/visualization-spec";

/** Document creation tools produce durable workspace files and therefore feed
 * the renderer's artifact index. Keep this renderer-safe list free of the MCP
 * implementation's Node/runtime dependencies; document-mcp.test.ts guards the
 * strings against the host-owned canonical names. */
export const LEEMO_DOCUMENT_CREATE_TOOL_NAMES = {
  editWord: "mcp__leemo-documents__edit_word_document",
  createWord: "mcp__leemo-documents__create_word_document",
  createPresentation: "mcp__leemo-documents__create_presentation",
  createSpreadsheet: "mcp__leemo-documents__create_spreadsheet",
} as const;

/** Fully-qualified MCP tool name for momo's ask_user question card (08 §二).
 *  Server name "leemo-ask-user" (see src/bridge/interact.ts's
 *  createSdkMcpServer call) + tool name "ask_user", joined per the SDK's
 *  `mcp__<server>__<tool>` convention (sdk.d.ts). This is the anchor
 *  TurnBlock uses to find each ask_user tool-call item in the timeline and
 *  pair it with the matching question in the approvals store (卡 D). */
export const LEEMO_ASK_USER_TOOL_NAME = "mcp__leemo-ask-user__ask_user";
