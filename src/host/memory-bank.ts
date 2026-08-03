// Legacy Leemo memory-bank seed, retained for one migration compatibility cycle.
//
// Runtime stopped calling this module in r10. Tests keep the exact historical
// templates so memory-governance migration can prove it does not invent facts
// from placeholder text. Remove after the compatibility window.
//
// WHY THIS EXISTED: 卡 A gave momo the correct absolute path to its memory
// bank (momo-prompt.ts layer ⑥), but the four files it promises were never
// actually created. `main.ts`'s ensureMemoryDir() only made the DIRECTORY —
// the first time momo tried "我先记一笔" and wrote to
// `<memoryDir>/memory/bookmarks.md`, the Read that should have found its own
// index came back `File does not exist`. This module seeds the missing files
// so the very first conversation has somewhere real to write.
//
// HARD RULE: ensureMemoryBank only creates files that do not exist yet. A
// file that already exists is the user's real memory — not our template —
// and is never touched, truncated, or overwritten by any code path here.

export interface MemoryBankIO {
  exists(path: string): boolean;
  read(path: string): string;
  write(path: string, contents: string): void;
  mkdirp(path: string): void;
}

interface SeedFile {
  /** Path relative to memoryDir, using the SAME separator style memoryDir was
   *  given in (see `join` below — mirrors momo-prompt.ts:144's approach). */
  relPath: string;
  contents: string;
}

const CLAUDE_MD = `# momo 的记忆库

## 当前状态
（还没有记录）

## 记忆索引
- memory/bookmarks.md（实时便签）
- memory/profile.md（用户画像）
- memory/preferences.md（偏好与雷区）
- memory/moments.md（重要时刻）

## 核心事实
（还没有记录）
`;

const BOOKMARKS_MD = `# 实时便签

格式：<YYYY-MM-DD HH:MM> <发生了什么> <为什么重要>

（还没有记录）
`;

const PROFILE_MD = `# 用户画像

你是谁、在做什么。

（还没有记录）
`;

const PREFERENCES_MD = `# 偏好与雷区

喜欢怎样、别踩哪里。

（还没有记录）
`;

const MOMENTS_MD = `# 重要时刻

第一人称叙述，不是冷日志。

（还没有记录）
`;

/** Build the seed list with the caller's separator style so the relative path
 *  matches how momo-prompt.ts joins them in layer ⑥ (mirrors that function's
 *  `sep` detection — Windows backslash / posix slash, never mixed). */
function seedFiles(sep: string): SeedFile[] {
  const join = (...parts: string[]): string => parts.join(sep);
  return [
    { relPath: "CLAUDE.md", contents: CLAUDE_MD },
    { relPath: join("memory", "bookmarks.md"), contents: BOOKMARKS_MD },
    { relPath: join("memory", "profile.md"), contents: PROFILE_MD },
    { relPath: join("memory", "preferences.md"), contents: PREFERENCES_MD },
    { relPath: join("memory", "moments.md"), contents: MOMENTS_MD },
  ];
}

/**
 * Idempotently seed momo's memory bank at `memoryDir`. Only creates files
 * that do not already exist — an existing file (the user's real memory) is
 * never read, compared, or overwritten. Returns the relative paths of the
 * files actually created (empty array on a fully-seeded bank), for
 * logging/test assertions.
 */
export function ensureMemoryBank(memoryDir: string, io: MemoryBankIO): string[] {
  const sep = memoryDir.includes("\\") ? "\\" : "/";
  const created: string[] = [];

  for (const file of seedFiles(sep)) {
    const fullPath = `${memoryDir}${sep}${file.relPath}`;
    if (io.exists(fullPath)) continue;

    const dirEnd = fullPath.lastIndexOf(sep);
    if (dirEnd > 0) io.mkdirp(fullPath.slice(0, dirEnd));

    io.write(fullPath, file.contents);
    created.push(file.relPath);
  }

  return created;
}
