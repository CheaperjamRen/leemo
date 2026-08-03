/**
 * userData 目录改名的一次性迁移（轮 4 卡 H 顺手项）。
 *
 * 起因：`app.getName()` 此前是 Electron 的默认名，于是 userData 落在
 * `%APPDATA%\Electron\`。装到别人机器上目录叫 "Electron" 很怪，而且和别的
 * Electron 应用同名有撞库风险。改名 `app.setName("Leemo")` 即可修好。
 *
 * 但**光改名会让用户以为数据丢了**：SQLite 库、加密的 provider key、搜索源
 * key 全在旧路径，改名后 App 一个都看不见 —— 表现就是"对话没了、key 没了"。
 * 所以改名必须和这个迁移一起落。
 *
 * 纪律：
 *  • 目的目录**已经有同名文件就不动它** —— 宁可留下旧副本，也不覆盖新数据。
 *  • 逐文件独立处理：一个文件失败（被占用等）不该让其余文件也搬不过去。
 *  • 只搬我们自己的文件（leemo.db* / leemo-secrets.enc*）。Electron 自己的
 *    Cache/Preferences/DevToolsActivePort 之类**不搬** —— 那些本就该按新身份
 *    重建，搬过去反而可能带着旧窗口状态和陈旧缓存。
 *  • 搬完不删旧目录：留着当后备。用户确认无恙后可自行删。
 */

/** 需要迁移的文件名前缀 —— 只有我们自己写的那些。
 *
 *  ⚠️ 加密件（leemo-secrets.enc*）**不在这里**，它不能用搬文件的方式迁移。
 *  实测（scripts 探针，已删）：同一个 .enc 文件在旧 app name 下能解密、改名后
 *  解密直接抛 "Error while decrypting the ciphertext" —— Windows DPAPI 的加密
 *  作用域绑在 app name 上。搬过去只会得到一个永远打不开的文件。
 *  它走 `readLegacySecrets` + `writeMigratedSecrets` 两步：改名前解密、改名后
 *  重加密。见 main.ts 的调用顺序。 */
const OWNED_PREFIXES = ["leemo.db"] as const;

/** 加密件的文件名（改名迁移时单独处理，不走 move）。 */
export const SECRETS_FILENAME = "leemo-secrets.enc";

export interface MigrationIO {
  exists(path: string): boolean;
  /** 目录下的文件名（非全路径）。目录不存在时应抛错或返回空。 */
  readdir(dir: string): string[];
  mkdirp(dir: string): void;
  /** 移动单个文件。跨卷时实现方需自行降级为 copy+unlink。 */
  move(from: string, to: string): void;
  join(...parts: string[]): string;
}

export interface MigrationResult {
  /** 真正搬过去的文件名。 */
  moved: string[];
  /** 目的地已存在、故跳过的文件名。 */
  skipped: string[];
  /** 搬运失败的文件名 → 原因。 */
  failed: Record<string, string>;
  /** 没什么可做（旧目录不存在，或里面没有我们的文件）。 */
  noop: boolean;
}

/** safeStorage 的最小切面（与 secrets.ts 的 SafeStorageLike 同形）。 */
export interface CipherLike {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface SecretsMigrationIO {
  exists(path: string): boolean;
  read(path: string): Buffer;
  write(path: string, data: Buffer): void;
  mkdirp(dir: string): void;
  join(...parts: string[]): string;
}

/**
 * 第一步（**必须在 app.setName 之前调**）：用旧身份把旧 userData 里的加密件解成
 * 明文带回来。解不开就返回 undefined —— 那种情况下用户会退回 .env，比拿着一个
 * 打不开的文件假装迁移成功要好。
 */
export function readLegacySecrets(
  legacyDir: string,
  cipher: CipherLike,
  io: SecretsMigrationIO
): string | undefined {
  try {
    const file = io.join(legacyDir, SECRETS_FILENAME);
    if (!io.exists(file)) return undefined;
    if (!cipher.isEncryptionAvailable()) return undefined;
    return cipher.decryptString(io.read(file));
  } catch {
    // 解不开（换过机器、DPAPI 主密钥变了）⇒ 当作没有，不抛。
    return undefined;
  }
}

/**
 * 第二步（**必须在 app.setName 之后调**）：用新身份把明文重新加密、写进新
 * userData。新目录已有加密件就不动 —— 那份更该保留。
 * 返回是否真的写了。
 */
export function writeMigratedSecrets(
  currentDir: string,
  plaintext: string,
  cipher: CipherLike,
  io: SecretsMigrationIO
): boolean {
  try {
    const file = io.join(currentDir, SECRETS_FILENAME);
    if (io.exists(file)) return false; // 绝不覆盖新数据
    if (!cipher.isEncryptionAvailable()) return false;
    io.mkdirp(currentDir);
    io.write(file, cipher.encryptString(plaintext));
    return true;
  } catch {
    return false;
  }
}

function isOwned(name: string): boolean {
  return OWNED_PREFIXES.some((p) => name === p || name.startsWith(`${p}-`) || name.startsWith(`${p}.`));
}

/**
 * 把旧 userData 里属于 Leemo 的文件搬到新 userData。幂等：搬完再调一次是 noop。
 * 永不抛错 —— 迁移失败最坏是"用户看到空的新库"，而让 App 起不来更糟。
 */
export function migrateUserData(
  legacyDir: string,
  currentDir: string,
  io: MigrationIO
): MigrationResult {
  const result: MigrationResult = { moved: [], skipped: [], failed: {}, noop: false };

  // 同一个目录（已经是新名字了）⇒ 无事可做。
  if (legacyDir === currentDir) {
    result.noop = true;
    return result;
  }
  if (!io.exists(legacyDir)) {
    result.noop = true;
    return result;
  }

  let names: string[];
  try {
    names = io.readdir(legacyDir).filter(isOwned);
  } catch {
    result.noop = true;
    return result;
  }
  if (names.length === 0) {
    result.noop = true;
    return result;
  }

  try {
    io.mkdirp(currentDir);
  } catch (e: unknown) {
    result.failed["<mkdir>"] = e instanceof Error ? e.message : String(e);
    return result;
  }

  for (const name of names) {
    const to = io.join(currentDir, name);
    // 新目录已有同名文件 ⇒ 那是更该保留的那份，绝不覆盖。
    if (io.exists(to)) {
      result.skipped.push(name);
      continue;
    }
    try {
      io.move(io.join(legacyDir, name), to);
      result.moved.push(name);
    } catch (e: unknown) {
      result.failed[name] = e instanceof Error ? e.message : String(e);
    }
  }
  return result;
}
