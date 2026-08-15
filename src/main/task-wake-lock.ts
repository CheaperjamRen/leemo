export interface PowerSaveBlockerAdapter {
  start(type: "prevent-app-suspension"): number;
  stop(id: number): void;
}

export interface TaskWakeLock {
  /** Returns false when the same task was already tracked. */
  begin(taskId: string): boolean;
  end(taskId: string): void;
  setEnabled(enabled: boolean): void;
  activeCount(): number;
  dispose(): void;
}

export interface TaskWakeLockDeps {
  blocker: PowerSaveBlockerAdapter;
  enabled?: boolean;
  onError?: (error: unknown) => void;
}

export function keepAwakeSetting(settings: Record<string, unknown> | undefined): boolean {
  return typeof settings?.keepAwakeDuringTasks === "boolean"
    ? settings.keepAwakeDuringTasks
    : true;
}

/**
 * Owns one Electron power blocker for any number of concurrent Agent rounds.
 * The screen may still turn off; only automatic system suspension is blocked.
 */
export function createTaskWakeLock(deps: TaskWakeLockDeps): TaskWakeLock {
  const activeTasks = new Set<string>();
  const onError = deps.onError ?? (() => undefined);
  let enabled = deps.enabled ?? true;
  let blockerId: number | null = null;

  const sync = (): void => {
    const shouldBlock = enabled && activeTasks.size > 0;
    if (shouldBlock && blockerId === null) {
      try {
        blockerId = deps.blocker.start("prevent-app-suspension");
      } catch (error: unknown) {
        onError(error);
      }
      return;
    }
    if (!shouldBlock && blockerId !== null) {
      const id = blockerId;
      blockerId = null;
      try {
        deps.blocker.stop(id);
      } catch (error: unknown) {
        onError(error);
      }
    }
  };

  return {
    begin(taskId) {
      if (!taskId || activeTasks.has(taskId)) return false;
      activeTasks.add(taskId);
      sync();
      return true;
    },
    end(taskId) {
      if (!activeTasks.delete(taskId)) return;
      sync();
    },
    setEnabled(next) {
      if (typeof next !== "boolean" || enabled === next) return;
      enabled = next;
      sync();
    },
    activeCount: () => activeTasks.size,
    dispose() {
      activeTasks.clear();
      enabled = false;
      sync();
    },
  };
}
