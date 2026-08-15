export interface LaunchAtLogin {
  /** Returns true when the system setting was applied, false for a duplicate or failure. */
  setEnabled(enabled: boolean): boolean;
}

interface LaunchAtLoginDeps {
  apply(enabled: boolean): void;
  onError?: (error: unknown) => void;
}

export function launchAtLoginSetting(settings: unknown): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return false;
  const value = (settings as Record<string, unknown>).launchAtLogin;
  return typeof value === "boolean" ? value : false;
}

/** Keeps the persisted preference and the OS login item on one hot path. */
export function createLaunchAtLogin(deps: LaunchAtLoginDeps): LaunchAtLogin {
  let applied: boolean | null = null;
  return {
    setEnabled(value) {
      const enabled = Boolean(value);
      if (applied === enabled) return false;
      try {
        deps.apply(enabled);
        applied = enabled;
        return true;
      } catch (error: unknown) {
        deps.onError?.(error);
        return false;
      }
    },
  };
}
