import type { ConversationMeta } from "./conversations";
import { HOME_WORKSPACE_ID } from "./workspaces";

export const RELATIONSHIP_CONVERSATION_TITLE = "和 momo 的对话";
export const RELATIONSHIP_ONBOARDING_LABEL = "和 momo 认识一下";

/**
 * The slash command selects the richer bundled workflow when it is enabled.
 * The compact fallback contract stays in the prompt so this core product path
 * still works if the user deliberately switches that Skill off.
 */
export function buildRelationshipOnboardingPrompt(): string {
  return [
    "/meet-momo 开始一次让我更了解用户的对话。",
    "先回忆你对用户已有的认识；重复进入时从变化和空白处继续，不要把用户重新问一遍。",
    "每次只问一个高信息量、容易回答的问题，并允许用户从选项中选择、自由补充或明确说可以拒绝回答。",
    "由浅入深地理解用户愿意分享的关系期待、个性风味、当前处境、近期目标、合作偏好、生活纹理和边界；不必覆盖所有维度，也不要把过程做成填表或测验。",
    "如果用户附上简历、文字或其他资料，先把它当作理解线索，不要把原文整份写入长期记忆。",
    "信息足够后，先给出一份连贯的整份理解，轻量区分用户明确说过的内容和你的推断，并请用户统一确认或纠正。",
    "用户确认后，只把明确、耐久、非敏感且以后确实有帮助的信息写入长期记忆；推断只有在用户确认后才能作为事实保存。",
  ].join("\n");
}

export function isGlobalBuddyConversation(meta: ConversationMeta): boolean {
  return meta.source === "buddy"
    && (meta.workspaceId ?? HOME_WORKSPACE_ID) === HOME_WORKSPACE_ID
    && meta.bookId === null
    && meta.archived !== true;
}

export function findRelationshipConversation(
  conversations: Readonly<Record<string, ConversationMeta>>,
  preferredId: string | null,
): ConversationMeta | undefined {
  if (preferredId) {
    const preferred = conversations[preferredId];
    if (preferred && isGlobalBuddyConversation(preferred)) return preferred;
  }

  return Object.values(conversations)
    .filter((meta) => isGlobalBuddyConversation(meta))
    .sort((left, right) => right.lastActivityAt - left.lastActivityAt)[0];
}
