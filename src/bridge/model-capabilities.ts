export type CapabilityProbeStatus = "verified" | "failed" | "unknown";

export interface CapabilityProbeEvidence {
  status: CapabilityProbeStatus;
  checkedAt: number;
  detail?: string;
}

export interface CapabilityUserOverride {
  supported: true;
  updatedAt: number;
}

export interface CapabilityEvidence {
  probe?: CapabilityProbeEvidence;
  userOverride?: CapabilityUserOverride;
}

export interface ModelCapabilityEvidence {
  image?: CapabilityEvidence;
  reasoning?: CapabilityEvidence;
}

export function cloneModelCapabilityEvidenceMap(
  value: Record<string, ModelCapabilityEvidence> | undefined,
): Record<string, ModelCapabilityEvidence> | undefined {
  if (!value) return undefined;
  return Object.fromEntries(Object.entries(value).map(([modelId, evidence]) => [
    modelId,
    {
      ...(evidence.image
        ? {
            image: {
              ...(evidence.image.probe ? { probe: { ...evidence.image.probe } } : {}),
              ...(evidence.image.userOverride
                ? { userOverride: { ...evidence.image.userOverride } }
                : {}),
            },
          }
        : {}),
      ...(evidence.reasoning
        ? {
            reasoning: {
              ...(evidence.reasoning.probe ? { probe: { ...evidence.reasoning.probe } } : {}),
              ...(evidence.reasoning.userOverride
                ? { userOverride: { ...evidence.reasoning.userOverride } }
                : {}),
            },
          }
        : {}),
    },
  ]));
}

export interface CapabilityProbeResults {
  image: CapabilityProbeEvidence;
  reasoning: CapabilityProbeEvidence;
}

/** Merge one automatic probe run into the editable evidence draft. The probe
 *  never removes an explicit user correction; that correction remains the
 *  higher-priority product decision until the user chooses to restore the
 *  automatic judgment. */
export function mergeCapabilityProbeResults(
  current: Record<string, ModelCapabilityEvidence> | undefined,
  modelId: string,
  probes: CapabilityProbeResults,
): Record<string, ModelCapabilityEvidence> {
  const next = cloneModelCapabilityEvidenceMap(current) ?? {};
  const previous = next[modelId] ?? {};
  next[modelId] = {
    ...previous,
    image: {
      ...(previous.image?.userOverride ? { userOverride: { ...previous.image.userOverride } } : {}),
      probe: { ...probes.image },
    },
    reasoning: {
      ...(previous.reasoning?.userOverride ? { userOverride: { ...previous.reasoning.userOverride } } : {}),
      probe: { ...probes.reasoning },
    },
  };
  return next;
}

export type CapabilityDisplay =
  | { status: "verified"; source: "user" }
  | { status: CapabilityProbeStatus; source: "probe" }
  | { status: "unknown"; source: "preset"; hint: boolean }
  | { status: "unknown"; source: "none" };

export function resolveCapabilityDisplay(
  evidence: CapabilityEvidence | undefined,
  presetHint: boolean | undefined,
): CapabilityDisplay {
  if (evidence?.userOverride?.supported === true) {
    return { status: "verified", source: "user" };
  }
  if (evidence?.probe) {
    return { status: evidence.probe.status, source: "probe" };
  }
  if (presetHint !== undefined) {
    return { status: "unknown", source: "preset", hint: presetHint };
  }
  return { status: "unknown", source: "none" };
}

export function setUserCapabilitySupported(
  current: CapabilityEvidence | undefined,
  updatedAt: number,
): CapabilityEvidence {
  return {
    ...(current?.probe ? { probe: { ...current.probe } } : {}),
    userOverride: { supported: true, updatedAt },
  };
}

export function clearUserCapabilityOverride(
  current: CapabilityEvidence | undefined,
): CapabilityEvidence {
  return current?.probe ? { probe: { ...current.probe } } : {};
}
