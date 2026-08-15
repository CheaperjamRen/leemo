export type ParsedTaskField =
  | {
      kind: "planned" | "due" | "reminder";
      date: string;
      time?: string;
      source: string;
    }
  | {
      kind: "reminderOffset";
      minutesBefore: number;
      source: string;
    }
  | {
      kind: "recurrence";
      rule: "daily" | "weekly" | "monthly" | "weekdays";
      source: string;
    };

export interface TaskTextParseResult {
  original: string;
  fields: ParsedTaskField[];
  requiresModel: boolean;
  reason?: string;
}

type RecurrenceRule = Extract<ParsedTaskField, { kind: "recurrence" }>["rule"];

interface DateMention {
  index: number;
  end: number;
  source: string;
  date: string;
  time?: string;
  kind?: "planned" | "due" | "reminder";
}

const DATE_MENTION = /(?:(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?|(\d{1,2})月(\d{1,2})日|(今天|明天|后天|(?:本|下)?(?:周|星期)[一二三四五六日天]))(?:\s*(上午|中午|下午|晚上|今晚)?\s*(\d{1,2})(?:(?::|：|点|时)(\d{1,2})?)?(?:分)?)?/gu;
const RELATIVE_REMINDER = /提前\s*(\d+(?:\.\d+)?)\s*(分钟|小时|天)\s*(?:提醒|通知)/gu;

const WEEKDAY_INDEX: Record<string, number> = {
  一: 0,
  二: 1,
  三: 2,
  四: 3,
  五: 4,
  六: 5,
  日: 6,
  天: 6,
};

function atStartOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function isoDate(value: Date): string {
  const year = String(value.getFullYear()).padStart(4, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function validDate(year: number, month: number, day: number): Date | null {
  const value = new Date(year, month - 1, day);
  return value.getFullYear() === year
    && value.getMonth() === month - 1
    && value.getDate() === day
    ? value
    : null;
}

function resolveRelativeDate(source: string, now: Date): Date | null {
  const today = atStartOfDay(now);
  if (source === "今天") return today;
  if (source === "明天") return addDays(today, 1);
  if (source === "后天") return addDays(today, 2);

  const weekday = source.at(-1);
  const targetIndex = weekday ? WEEKDAY_INDEX[weekday] : undefined;
  if (targetIndex === undefined) return null;
  const currentIndex = (today.getDay() + 6) % 7;
  const monday = addDays(today, -currentIndex);
  if (source.startsWith("下")) return addDays(monday, 7 + targetIndex);
  if (source.startsWith("本")) return addDays(monday, targetIndex);
  const delta = targetIndex >= currentIndex
    ? targetIndex - currentIndex
    : 7 - currentIndex + targetIndex;
  return addDays(today, delta);
}

function normalizeTime(period: string | undefined, rawHour: string | undefined, rawMinute: string | undefined): string | undefined {
  if (!rawHour) return undefined;
  let hour = Number(rawHour);
  const minute = rawMinute ? Number(rawMinute) : 0;
  if (hour > 23 || minute > 59) return undefined;
  if (["下午", "晚上", "今晚"].includes(period ?? "") && hour < 12) hour += 12;
  if (period === "中午" && hour < 11) hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function classifyMention(text: string, mention: DateMention): DateMention["kind"] {
  const before = text.slice(Math.max(0, mention.index - 10), mention.index).toLocaleLowerCase();
  const after = text.slice(mention.end, mention.end + 10).toLocaleLowerCase();
  const context = `${before}|${after}`;
  if (/提醒|通知/u.test(context)) return "reminder";
  if (/截止|到期|最晚|ddl/u.test(before) || /截止|到期|之前|前(?:交|提交|完成)?|交|提交/u.test(after)) {
    return "due";
  }
  if (/计划|安排|准备|开始/u.test(before) || /去|做|开会|学习|练习|处理/u.test(after)) {
    return "planned";
  }
  return undefined;
}

function dateMentions(text: string, now: Date): DateMention[] {
  const mentions: DateMention[] = [];
  DATE_MENTION.lastIndex = 0;
  for (const match of text.matchAll(DATE_MENTION)) {
    const index = match.index;
    if (text[index - 1] === "每") continue;
    const source = match[0];
    const explicitYear = match[1] ? Number(match[1]) : undefined;
    const month = Number(match[2] ?? match[4]);
    const day = Number(match[3] ?? match[5]);
    let date: Date | null;
    if (Number.isFinite(month) && Number.isFinite(day)) {
      let year = explicitYear ?? now.getFullYear();
      date = validDate(year, month, day);
      if (!explicitYear && date && date < atStartOfDay(now)) {
        year += 1;
        date = validDate(year, month, day);
      }
    } else {
      date = resolveRelativeDate(match[6] ?? "", now);
    }
    if (!date) continue;
    const mention: DateMention = {
      index,
      end: index + source.length,
      source,
      date: isoDate(date),
      ...(normalizeTime(match[7], match[8], match[9])
        ? { time: normalizeTime(match[7], match[8], match[9]) }
        : {}),
    };
    mention.kind = classifyMention(text, mention);
    mentions.push(mention);
  }
  return mentions;
}

function recurrenceField(text: string): ParsedTaskField | null {
  const patterns: Array<[RegExp, RecurrenceRule]> = [
    [/每个?工作日/u, "weekdays"],
    [/每天/u, "daily"],
    [/每周(?:[一二三四五六日天])?/u, "weekly"],
    [/每月(?:\d{1,2}日)?/u, "monthly"],
  ];
  for (const [pattern, rule] of patterns) {
    const match = text.match(pattern);
    if (match) return { kind: "recurrence", rule, source: match[0] };
  }
  return null;
}

export function parseTaskText(rawText: string, now = new Date()): TaskTextParseResult {
  const original = rawText.replace(/\r\n/g, "\n");
  const mentions = dateMentions(original, now);
  const fields: ParsedTaskField[] = [];
  const recurrence = recurrenceField(original);
  if (recurrence) fields.push(recurrence);

  if (mentions.length === 1 && !mentions[0].kind) mentions[0].kind = "planned";
  const unresolved = mentions.filter((mention) => !mention.kind);
  const duplicateKinds = new Set<string>();
  const seenKinds = new Set<string>();
  for (const mention of mentions) {
    if (!mention.kind) continue;
    if (seenKinds.has(mention.kind)) duplicateKinds.add(mention.kind);
    seenKinds.add(mention.kind);
  }
  if (unresolved.length > 0 || duplicateKinds.size > 0) {
    return {
      original,
      fields: recurrence ? [recurrence] : [],
      requiresModel: true,
      reason: "这段话里有多个日期，但无法可靠判断各自是计划、截止还是提醒时间。",
    };
  }

  fields.unshift(...mentions.map((mention): ParsedTaskField => ({
    kind: mention.kind!,
    date: mention.date,
    ...(mention.time ? { time: mention.time } : {}),
    source: mention.source,
  })));

  RELATIVE_REMINDER.lastIndex = 0;
  const relativeReminder = RELATIVE_REMINDER.exec(original);
  if (relativeReminder) {
    const amount = Number(relativeReminder[1]);
    const unit = relativeReminder[2];
    const multiplier = unit === "天" ? 24 * 60 : unit === "小时" ? 60 : 1;
    fields.push({
      kind: "reminderOffset",
      minutesBefore: Math.round(amount * multiplier),
      source: relativeReminder[0],
    });
  }

  return { original, fields, requiresModel: false };
}
