import type { LearningProfile, LearningProfileDraft, LearningSnapshot } from "../../learning";

export interface LearningClient {
  getSnapshot(): Promise<LearningSnapshot>;
  saveProfile(draft: LearningProfileDraft): Promise<LearningProfile>;
}

export interface LeemoLearningApi {
  invoke(op: string, payload: unknown): Promise<{ ok: boolean; response?: unknown; error?: string }>;
}

function requireResponse<T>(result: { ok: boolean; response?: unknown; error?: string }): T {
  if (!result.ok) throw new Error(result.error || "英语学习记录暂时无法读取。");
  return result.response as T;
}

export class IpcLearningClient implements LearningClient {
  constructor(private readonly api: LeemoLearningApi) {}

  async getSnapshot(): Promise<LearningSnapshot> {
    return requireResponse<LearningSnapshot>(await this.api.invoke("snapshot", {}));
  }

  async saveProfile(draft: LearningProfileDraft): Promise<LearningProfile> {
    return requireResponse<LearningProfile>(await this.api.invoke("saveProfile", draft));
  }
}

export class MemoryLearningClient implements LearningClient {
  private profile: LearningProfile | null = null;

  async getSnapshot(): Promise<LearningSnapshot> {
    return {
      profile: this.profile,
      dueItems: [],
      upcomingItems: [],
      recentSessions: [],
      baselines: [],
      evidence: [],
      summary: { totalItems: 0, dueItems: 0, recurringItems: 0, reviewedItems: 0, completedSessions: 0, hasBaseline: false },
    };
  }

  async saveProfile(draft: LearningProfileDraft): Promise<LearningProfile> {
    const now = Date.now();
    this.profile = {
      ...draft,
      id: "english",
      createdAt: this.profile?.createdAt ?? now,
      updatedAt: now,
    };
    return this.profile;
  }
}
