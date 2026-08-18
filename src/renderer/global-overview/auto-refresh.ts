const DEFAULT_TIME = "09:00";

function parsedTime(value: unknown): { hour: number; minute: number } | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return undefined;
  }
  return { hour, minute };
}

export function isValidGlobalOverviewTime(value: unknown): value is string {
  return parsedTime(value) !== undefined;
}

export function normalizeGlobalOverviewTime(value: unknown): string {
  const parsed = parsedTime(value);
  if (!parsed) return DEFAULT_TIME;
  const { hour, minute } = parsed;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function localDateKey(now: number): string {
  const date = new Date(now);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function thresholdFor(now: number, localTime: string): number {
  const [hour, minute] = normalizeGlobalOverviewTime(localTime).split(":").map(Number);
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0).getTime();
}

export function shouldAutoRefresh(input: {
  enabled: boolean;
  localTime: string;
  now: number;
  lastAutoAttemptDate?: string;
  lastSuccessfulAt?: number;
}): boolean {
  if (!input.enabled) return false;
  const today = localDateKey(input.now);
  if (input.lastAutoAttemptDate === today) return false;
  const threshold = thresholdFor(input.now, input.localTime);
  if (input.now < threshold) return false;
  if (
    input.lastSuccessfulAt !== undefined
    && localDateKey(input.lastSuccessfulAt) === today
    && input.lastSuccessfulAt >= threshold
  ) return false;
  return true;
}
