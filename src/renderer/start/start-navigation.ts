import type { LucideIcon } from "lucide-react";
import {
  Archive,
  CalendarCheck2,
  Clock3,
  FileText,
  FolderOpen,
  Home,
  Inbox,
  ListChecks,
  Pin,
  Trash2,
} from "lucide-react";

export type StartDestination =
  | "home"
  | "overview"
  | "inbox"
  | "tasks"
  | "pinned"
  | "recent"
  | "locations"
  | "documents"
  | "archive"
  | "trash";

export interface StartNavigationItem {
  id: Exclude<StartDestination, "overview">;
  label: string;
  icon: LucideIcon;
  section: "primary" | "library" | "system";
}

export const START_NAVIGATION: readonly StartNavigationItem[] = [
  { id: "home", label: "首页", icon: Home, section: "primary" },
  { id: "inbox", label: "收集箱", icon: Inbox, section: "primary" },
  { id: "tasks", label: "待办", icon: ListChecks, section: "primary" },
  { id: "pinned", label: "置顶", icon: Pin, section: "primary" },
  { id: "recent", label: "最近", icon: Clock3, section: "primary" },
  { id: "locations", label: "位置", icon: FolderOpen, section: "library" },
  { id: "documents", label: "我的文档", icon: FileText, section: "library" },
  { id: "archive", label: "已归档", icon: Archive, section: "system" },
  { id: "trash", label: "回收站", icon: Trash2, section: "system" },
] as const;

const DESTINATIONS = new Set<StartDestination>([...START_NAVIGATION.map((item) => item.id), "overview"]);

export function isStartDestination(value: unknown): value is StartDestination {
  return typeof value === "string" && DESTINATIONS.has(value as StartDestination);
}

export const START_HOME_CARD_ICONS = { today: CalendarCheck2 } as const;
