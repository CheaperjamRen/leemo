// Pure logic behind the input-box model picker (轮 3 卡 F).
//
// Kept out of the component for the same reason `slash-menu.ts` is: the shells
// own the store subscription, the component renders, and the DECISIONS live here
// where they can be tested without React or a BridgeProvider.
//
// The rule this module exists to enforce (用户 7/26): the conversation input
// offers ONLY models from providers that actually have a key. An unconfigured
// family belongs in the settings page as an offer — putting it in the picker
// just gives the user a choice that would fail on send.

import type { ProviderSpec } from "../../bridge/contract";
import {
  resolveCapabilityDisplay,
  type CapabilityDisplay,
} from "../../bridge/model-capabilities";

/** One selectable model, already resolved to what the row needs to render. */
export interface ModelOption {
  providerId: string;
  providerName: string;
  modelId: string;
  imageStatus: CapabilityDisplay["status"];
  imageSource: CapabilityDisplay["source"];
  reasoningStatus: CapabilityDisplay["status"];
  reasoningSource: CapabilityDisplay["source"];
}

/** Models of one configured provider, for a grouped list. */
export interface ModelGroup {
  providerId: string;
  providerName: string;
  options: ModelOption[];
}

export interface LegacyDefaultPair {
  providerId?: string | null;
  modelId?: string | null;
}

/**
 * Project the single provider/model priority used by new conversations, model
 * pickers, and settings. The input catalog is never mutated.
 *
 * Legacy defaults are a one-time fallback only while no explicit order exists.
 * A deleted legacy provider does not make a same-named model under another
 * account win accidentally; the next stable provider takes over instead.
 */
export function orderConfiguredProviders(
  list: ProviderSpec[],
  providerOrder: readonly string[],
  legacyDefaultPair: LegacyDefaultPair = {},
): ProviderSpec[] {
  const eligible = list.filter(
    (provider) => provider.configured === true && provider.models.length > 0,
  );
  const byId = new Map(eligible.map((provider) => [provider.id, provider]));
  const ordered: ProviderSpec[] = [];
  const seen = new Set<string>();
  const push = (provider: ProviderSpec | undefined) => {
    if (!provider || seen.has(provider.id)) return;
    seen.add(provider.id);
    ordered.push(provider);
  };

  const hasExplicitOrder = providerOrder.length > 0;
  if (hasExplicitOrder) {
    for (const id of providerOrder) push(byId.get(id));
  } else {
    const legacyProvider = legacyDefaultPair.providerId
      ? byId.get(legacyDefaultPair.providerId)
      : legacyDefaultPair.modelId
        ? eligible.find((provider) => provider.models.includes(legacyDefaultPair.modelId!))
        : undefined;
    push(legacyProvider);
  }
  for (const provider of eligible) push(provider);

  return ordered.map((provider, index) => {
    const shouldHoistLegacyModel = !hasExplicitOrder
      && index === 0
      && Boolean(legacyDefaultPair.modelId)
      && provider.models.includes(legacyDefaultPair.modelId!)
      && (!legacyDefaultPair.providerId || legacyDefaultPair.providerId === provider.id);
    const models = shouldHoistLegacyModel
      ? [legacyDefaultPair.modelId!, ...provider.models.filter((id) => id !== legacyDefaultPair.modelId)]
      : [...provider.models];
    return { ...provider, models };
  });
}

/**
 * Group the pickable models by provider instance.
 *
 * Only `configured === true` instances contribute. Note this groups by INSTANCE
 * (`spec.id`), not by family (`spec.kind`): a user with two DeepSeek accounts
 * must see two groups, or picking a model would be ambiguous about which key
 * pays for it.
 */
export function buildModelGroups(list: ProviderSpec[]): ModelGroup[] {
  const groups: ModelGroup[] = [];
  for (const spec of list) {
    if (spec.configured !== true) continue;
    const options = spec.models.map((modelId) => {
      const hints = spec.modelCapabilities?.[modelId];
      const evidence = spec.modelCapabilityEvidence?.[modelId];
      const image = resolveCapabilityDisplay(evidence?.image, hints?.vision);
      const reasoning = resolveCapabilityDisplay(evidence?.reasoning, hints?.thinking);
      return {
        providerId: spec.id,
        providerName: spec.name,
        modelId,
        imageStatus: image.status,
        imageSource: image.source,
        reasoningStatus: reasoning.status,
        reasoningSource: reasoning.source,
      };
    });
    if (options.length === 0) continue;
    groups.push({ providerId: spec.id, providerName: spec.name, options });
  }
  return groups;
}

/** Flat list of every pickable model (same filter as buildModelGroups). */
export function pickableModels(list: ProviderSpec[]): ModelOption[] {
  return buildModelGroups(list).flatMap((g) => g.options);
}

/**
 * Label for the collapsed picker trigger.
 *
 * Shows the conversation's real model rather than a hardcoded string. Falls back
 * to a prompt when nothing is resolvable yet, so the trigger never claims a
 * model the conversation is not actually using.
 */
export function modelPickerLabel(modelId: string | null | undefined): string {
  const trimmed = modelId?.trim();
  return trimmed ? trimmed : "选择模型";
}

/** True when a model row is the conversation's current one. Compared on the
 *  (providerId, modelId) PAIR: the same model name can exist under two
 *  instances, and only one of them is the active pairing. */
export function isCurrentModel(
  option: ModelOption,
  currentProviderId: string | null | undefined,
  currentModelId: string | null | undefined,
): boolean {
  if (!currentModelId || option.modelId !== currentModelId) return false;
  // No current provider known (older rows) → fall back to name-only match so an
  // existing conversation still shows a checkmark instead of nothing.
  if (!currentProviderId) return true;
  return option.providerId === currentProviderId;
}
