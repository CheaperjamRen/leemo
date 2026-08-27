import type { ConversationMeta } from "../stores/conversations";
import { scopeKeyForConversation, type ScopeKey } from "../stores/workbench-scope";

export interface SidebarConversationRef {
  id: string;
  scopeKey: ScopeKey;
}

export interface WorkbenchSidebarModel {
  pinned: SidebarConversationRef[];
  byScope: Partial<Record<ScopeKey, string[]>> & { global: string[] };
}

export function deriveWorkbenchSidebarModel(input: {
  conversations: Readonly<Record<string, ConversationMeta | undefined>>;
  order: readonly string[];
  visibleScopeKeys?: ReadonlySet<ScopeKey>;
}): WorkbenchSidebarModel {
  const byScope: WorkbenchSidebarModel["byScope"] = { global: [] };
  const pinned: SidebarConversationRef[] = [];

  for (const id of input.order) {
    const conversation = input.conversations[id];
    if (!conversation || conversation.archived) continue;
    const scopeKey = scopeKeyForConversation(conversation);
    if (input.visibleScopeKeys && !input.visibleScopeKeys.has(scopeKey)) continue;
    if (conversation.pinned) {
      pinned.push({ id, scopeKey });
      continue;
    }
    const scope = byScope[scopeKey] ?? [];
    scope.push(id);
    byScope[scopeKey] = scope;
  }

  const compareIds = (left: string, right: string): number => {
    const leftActivity = input.conversations[left]?.lastActivityAt ?? 0;
    const rightActivity = input.conversations[right]?.lastActivityAt ?? 0;
    return rightActivity - leftActivity || left.localeCompare(right);
  };
  pinned.sort((left, right) => compareIds(left.id, right.id));
  for (const ids of Object.values(byScope)) ids?.sort(compareIds);

  return { pinned, byScope };
}
