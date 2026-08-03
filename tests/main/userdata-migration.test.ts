// 轮 4 卡 H 顺手项：userData 改名的一次性迁移。
// 最要紧的两条：① 绝不覆盖新目录已有的文件（宁留旧副本也不毁新数据）
// ② 一个文件失败不拖累其余（被占用是 Windows 上的常态）。
import { describe, it, expect } from "vitest";
import {
  migrateUserData,
  readLegacySecrets,
  writeMigratedSecrets,
  SECRETS_FILENAME,
  type MigrationIO,
  type SecretsMigrationIO,
  type CipherLike,
} from "../../src/main/userdata-migration";

function fakeIo(files: Record<string, string[]>) {
  // files: dir -> 文件名列表
  const state: Record<string, Set<string>> = {};
  for (const [dir, names] of Object.entries(files)) state[dir] = new Set(names);
  const moves: string[] = [];
  const io: MigrationIO = {
    join: (...p) => p.join("/"),
    exists: (path) => {
      if (state[path]) return true; // 目录
      const at = path.lastIndexOf("/");
      const dir = path.slice(0, at);
      const name = path.slice(at + 1);
      return !!state[dir]?.has(name);
    },
    readdir: (dir) => {
      if (!state[dir]) throw new Error(`ENOENT ${dir}`);
      return [...state[dir]];
    },
    mkdirp: (dir) => {
      state[dir] ??= new Set();
    },
    move: (from, to) => {
      const fa = from.lastIndexOf("/");
      const ta = to.lastIndexOf("/");
      const fromDir = from.slice(0, fa);
      const name = from.slice(fa + 1);
      if (name.includes("locked")) throw new Error("EBUSY: file in use");
      state[fromDir]?.delete(name);
      (state[to.slice(0, ta)] ??= new Set()).add(to.slice(ta + 1));
      moves.push(`${from} -> ${to}`);
    },
  };
  return { io, state, moves };
}

const OLD = "/AppData/Electron";
const NEW = "/AppData/Leemo";

describe("migrateUserData", () => {
  it("把库连同 WAL 旁文件一起搬过去（缺 -wal/-shm 会让 SQLite 认为库损坏）", () => {
    const { io, state } = fakeIo({
      [OLD]: ["leemo.db", "leemo.db-wal", "leemo.db-shm"],
    });
    const r = migrateUserData(OLD, NEW, io);
    expect(r.moved.sort()).toEqual(["leemo.db", "leemo.db-shm", "leemo.db-wal"]);
    expect([...state[NEW]].sort()).toEqual(["leemo.db", "leemo.db-shm", "leemo.db-wal"]);
  });

  it("不搬 Electron 自己的文件 —— 那些该按新身份重建，搬过去会带着陈旧窗口状态和缓存", () => {
    const { io, state } = fakeIo({
      [OLD]: ["leemo.db", "Preferences", "DevToolsActivePort", "Local State", "SharedStorage", "DIPS"],
    });
    const r = migrateUserData(OLD, NEW, io);
    expect(r.moved).toEqual(["leemo.db"]);
    expect([...state[NEW]]).toEqual(["leemo.db"]);
    // 旧目录里它们还在，没被动过
    expect(state[OLD].has("Preferences")).toBe(true);
  });

  it("加密件的备份副本也不搬 —— 它同样只能用旧身份解开，搬到新目录就是死文件", () => {
    const { io, state } = fakeIo({ [OLD]: ["leemo-secrets.enc.bak-20260727-023126"] });
    expect(migrateUserData(OLD, NEW, io).noop).toBe(true);
    expect(state[OLD].has("leemo-secrets.enc.bak-20260727-023126")).toBe(true);
  });

  it("新目录已有同名文件就跳过 —— 宁可留下旧副本，也绝不覆盖新数据", () => {
    const { io, state } = fakeIo({
      [OLD]: ["leemo.db", "leemo.db-wal"],
      [NEW]: ["leemo.db"],
    });
    const r = migrateUserData(OLD, NEW, io);
    expect(r.skipped).toEqual(["leemo.db"]);
    expect(r.moved).toEqual(["leemo.db-wal"]);
    // 旧的那份还在旧目录，没被删
    expect(state[OLD].has("leemo.db")).toBe(true);
  });

  it("一个文件被占用不拖累其余（Windows 上 EBUSY 是常态）", () => {
    const { io } = fakeIo({ [OLD]: ["leemo.db", "leemo.db-locked-wal", "leemo.db-shm"] });
    const r = migrateUserData(OLD, NEW, io);
    expect(r.moved.sort()).toEqual(["leemo.db", "leemo.db-shm"]);
    expect(Object.keys(r.failed)).toEqual(["leemo.db-locked-wal"]);
  });

  it("旧目录不存在 = noop（全新安装的正常情况）", () => {
    const { io } = fakeIo({});
    expect(migrateUserData(OLD, NEW, io).noop).toBe(true);
  });

  it("旧目录里没有我们的文件 = noop", () => {
    const { io } = fakeIo({ [OLD]: ["Preferences", "Cache"] });
    expect(migrateUserData(OLD, NEW, io).noop).toBe(true);
  });

  it("新旧同路径 = noop（已经改名过了，不该自己搬自己）", () => {
    const { io } = fakeIo({ [NEW]: ["leemo.db"] });
    expect(migrateUserData(NEW, NEW, io).noop).toBe(true);
  });

  it("幂等：搬完再调一次是 noop", () => {
    const { io } = fakeIo({ [OLD]: ["leemo.db"] });
    expect(migrateUserData(OLD, NEW, io).moved).toEqual(["leemo.db"]);
    expect(migrateUserData(OLD, NEW, io).noop).toBe(true);
  });

  it("加密件不走 move —— DPAPI 作用域绑 app name，搬过去只会得到永远打不开的文件", () => {
    const { io, state } = fakeIo({ [OLD]: ["leemo.db", "leemo-secrets.enc"] });
    const r = migrateUserData(OLD, NEW, io);
    expect(r.moved).toEqual(["leemo.db"]);
    // 加密件留在旧目录，由 readLegacySecrets/writeMigratedSecrets 那条路处理
    expect(state[OLD].has("leemo-secrets.enc")).toBe(true);
    expect(state[NEW]?.has("leemo-secrets.enc") ?? false).toBe(false);
  });

  it("永不抛错 —— 迁移失败最坏是空库，让 App 起不来更糟", () => {
    const broken: MigrationIO = {
      join: (...p) => p.join("/"),
      exists: () => true,
      readdir: () => {
        throw new Error("EACCES");
      },
      mkdirp: () => {},
      move: () => {},
    };
    expect(() => migrateUserData(OLD, NEW, broken)).not.toThrow();
    expect(migrateUserData(OLD, NEW, broken).noop).toBe(true);
  });
});

// ── 加密件的两步迁移 ──────────────────────────────────────────────────────
// 实测（探针）：同一个 .enc 在旧 app name 下能解、改名后抛
// "Error while decrypting the ciphertext" —— DPAPI 作用域绑 app name。
// 所以必须"改名前解密 → 改名后重加密"。这组测试就是钉住这条纪律。

/** 模拟 DPAPI：密文带上加密时的身份，解密时身份不符就抛 —— 与实测一致。 */
function fakeCipher(identity: { name: string }): CipherLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(`${identity.name}::${plain}`, "utf8"),
    decryptString: (buf) => {
      const s = buf.toString("utf8");
      const at = s.indexOf("::");
      const who = s.slice(0, at);
      if (who !== identity.name) {
        throw new Error("Error while decrypting the ciphertext provided to safeStorage.decryptString.");
      }
      return s.slice(at + 2);
    },
  };
}

function fakeSecretsIo(seed: Record<string, Buffer> = {}) {
  const files = new Map<string, Buffer>(Object.entries(seed));
  const io: SecretsMigrationIO = {
    join: (...p) => p.join("/"),
    exists: (p) => files.has(p),
    read: (p) => {
      const v = files.get(p);
      if (!v) throw new Error(`ENOENT ${p}`);
      return v;
    },
    write: (p, d) => void files.set(p, d),
    mkdirp: () => {},
  };
  return { io, files };
}

const PAYLOAD = JSON.stringify({ version: 1, providers: { deepseek: {} }, searchKeys: { tavily: "tvly-x" } });

describe("加密件两步迁移（DPAPI 换身份）", () => {
  it("旧身份能解出明文，新身份直接解同一密文会失败 —— 这就是不能搬文件的原因", () => {
    const identity = { name: "Electron" };
    const cipher = fakeCipher(identity);
    const blob = cipher.encryptString(PAYLOAD);
    const { io } = fakeSecretsIo({ [`${OLD}/${SECRETS_FILENAME}`]: blob });

    // 改名前：读得出来
    expect(readLegacySecrets(OLD, cipher, io)).toBe(PAYLOAD);

    // 改名后：同一密文解不开（这正是实机上 secrets source=env-plaintext 的成因）
    identity.name = "Leemo";
    expect(() => cipher.decryptString(blob)).toThrow(/decrypting/i);
  });

  it("两步走完，新目录拿到的是能用新身份解开的密文", () => {
    const identity = { name: "Electron" };
    const cipher = fakeCipher(identity);
    const { io, files } = fakeSecretsIo({
      [`${OLD}/${SECRETS_FILENAME}`]: cipher.encryptString(PAYLOAD),
    });

    const plain = readLegacySecrets(OLD, cipher, io); // 改名前
    identity.name = "Leemo"; // ← app.setName
    expect(writeMigratedSecrets(NEW, plain!, cipher, io)).toBe(true);

    const written = files.get(`${NEW}/${SECRETS_FILENAME}`)!;
    expect(cipher.decryptString(written)).toBe(PAYLOAD); // 新身份解得开
    const back = JSON.parse(cipher.decryptString(written));
    expect(back.searchKeys.tavily).toBe("tvly-x"); // 搜索 key 也活着
  });

  it("旧目录没有加密件 ⇒ undefined（全新安装）", () => {
    const { io } = fakeSecretsIo();
    expect(readLegacySecrets(OLD, fakeCipher({ name: "x" }), io)).toBeUndefined();
  });

  it("旧密文解不开（换过机器/DPAPI 主密钥变了）⇒ undefined 而不是抛", () => {
    const { io } = fakeSecretsIo({
      [`${OLD}/${SECRETS_FILENAME}`]: Buffer.from("别人的密文", "utf8"),
    });
    expect(() => readLegacySecrets(OLD, fakeCipher({ name: "Leemo" }), io)).not.toThrow();
    expect(readLegacySecrets(OLD, fakeCipher({ name: "Leemo" }), io)).toBeUndefined();
  });

  it("新目录已有加密件就不写 —— 绝不覆盖新数据", () => {
    const cipher = fakeCipher({ name: "Leemo" });
    const existing = cipher.encryptString('{"keep":"me"}');
    const { io, files } = fakeSecretsIo({ [`${NEW}/${SECRETS_FILENAME}`]: existing });
    expect(writeMigratedSecrets(NEW, PAYLOAD, cipher, io)).toBe(false);
    expect(files.get(`${NEW}/${SECRETS_FILENAME}`)).toBe(existing);
  });

  it("平台不能加密时不写半成品", () => {
    const noCipher: CipherLike = {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.from(""),
      decryptString: () => "",
    };
    const { io, files } = fakeSecretsIo();
    expect(writeMigratedSecrets(NEW, PAYLOAD, noCipher, io)).toBe(false);
    expect(files.size).toBe(0);
  });
});
