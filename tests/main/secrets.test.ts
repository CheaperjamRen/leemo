import { describe, it, expect } from "vitest";
import {
  loadOrMigrateSecrets,
  saveSecrets,
  type SafeStorageLike,
  type SecretsIO,
} from "../../src/main/secrets";
import { emptyConfig, upsertProvider } from "../../src/host/provider-config";

/** Fake safeStorage: encrypts by wrapping in ENC(...) so a test can prove the
 *  bytes written to disk are NOT the plaintext key (encrypted-at-rest), while
 *  still round-tripping through decrypt. */
function fakeSafe(available = true): SafeStorageLike & { encrypts: number; decrypts: number } {
  const s = {
    encrypts: 0,
    decrypts: 0,
    isEncryptionAvailable: () => available,
    encryptString(plaintext: string): Buffer {
      s.encrypts++;
      // base64 the payload so the plaintext key does NOT survive as raw bytes —
      // a faithful stand-in for real OS encryption (Keychain/DPAPI/libsecret).
      return Buffer.from("ENC(" + Buffer.from(plaintext, "utf8").toString("base64") + ")", "utf8");
    },
    decryptString(buf: Buffer): string {
      s.decrypts++;
      const t = buf.toString("utf8");
      return Buffer.from(t.slice(4, -1), "base64").toString("utf8");
    },
  };
  return s;
}

function memIO(seed?: Record<string, Buffer>): SecretsIO & { store: Map<string, Buffer>; writes: number } {
  const store = new Map<string, Buffer>(Object.entries(seed ?? {}));
  const io = {
    store,
    writes: 0,
    exists: (p: string) => store.has(p),
    read: (p: string) => {
      const b = store.get(p);
      if (!b) throw new Error("ENOENT");
      return b;
    },
    write: (p: string, data: Buffer) => {
      io.writes++;
      store.set(p, data);
    },
  };
  return io;
}

const PATH = "/userData/secrets.enc";
const REAL_KEY = "sk-deepseek-abcdef0123456789abcdef0123456789";
const GLM_KEY = "sk-glm-999888777";

describe("loadOrMigrateSecrets — reading the store", () => {
  it("decrypts an existing NEW-shape file and never touches the env source", () => {
    const safe = fakeSafe(true);
    const seeded = upsertProvider(
      emptyConfig(),
      { id: "deepseek", kind: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/anthropic", apiFormat: "anthropic", category: "cn_official", apiKey: REAL_KEY, models: ["deepseek-v4-pro"] },
      () => "unused",
    ).config;
    const stored = safe.encryptString(JSON.stringify(seeded));
    safe.encrypts = 0; // reset counter after seeding
    const io = memIO({ [PATH]: stored });
    const envSource = { DEEPSEEK_API_KEY: "sk-STALE-env-key", DEEPSEEK_MODEL: "stale-model" };

    const { config, source } = loadOrMigrateSecrets({ safeStorage: safe, io, secretsPath: PATH, envSource });

    expect(source).toBe("encrypted");
    expect(config.providers.deepseek.apiKey).toBe(REAL_KEY); // from file, NOT the stale env key
    expect(config.providers.deepseek.models).toEqual(["deepseek-v4-pro"]);
    expect(io.writes).toBe(0); // no re-write when nothing changed
    expect(safe.decrypts).toBe(1);
  });

  it("READS THE OLD ENCRYPTED FILE (pre-卡F flat shape) and migrates it forward", () => {
    const safe = fakeSafe(true);
    // Exactly what a pre-卡F build wrote: {DEEPSEEK_API_KEY, DEEPSEEK_MODEL}.
    const legacy = safe.encryptString(
      JSON.stringify({ DEEPSEEK_API_KEY: REAL_KEY, DEEPSEEK_MODEL: "deepseek-v4-pro" }),
    );
    const io = memIO({ [PATH]: legacy });

    const { config, source } = loadOrMigrateSecrets({
      safeStorage: safe,
      io,
      secretsPath: PATH,
      envSource: {},
    });

    // The user's existing key MUST survive the upgrade.
    expect(source).toBe("encrypted");
    expect(config.version).toBe(1);
    expect(config.providers.deepseek.apiKey).toBe(REAL_KEY);
    expect(config.providers.deepseek.models?.[0]).toBe("deepseek-v4-pro");
    // Upgraded in place so the next launch reads the new shape directly…
    expect(io.writes).toBe(1);
    // …and still encrypted at rest.
    const onDisk = io.store.get(PATH)!;
    expect(onDisk.toString("utf8").startsWith("ENC(")).toBe(true);
    expect(onDisk.includes(Buffer.from(REAL_KEY))).toBe(false);
  });

  it("folds a new env family into an existing store without dropping stored keys", () => {
    const safe = fakeSafe(true);
    const seeded = upsertProvider(
      emptyConfig(),
      { id: "deepseek", kind: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/anthropic", apiFormat: "anthropic", apiKey: REAL_KEY },
      () => "unused",
    ).config;
    const io = memIO({ [PATH]: safe.encryptString(JSON.stringify(seeded)) });

    const { config } = loadOrMigrateSecrets({
      safeStorage: safe,
      io,
      secretsPath: PATH,
      envSource: { GLM_API_KEY: GLM_KEY },
    });

    expect(config.providers.deepseek.apiKey).toBe(REAL_KEY);
    expect(config.providers.glm.apiKey).toBe(GLM_KEY);
  });

  it("survives a corrupt/undecryptable blob without throwing, and does NOT overwrite it", () => {
    const safe = fakeSafe(true);
    const io = memIO({ [PATH]: Buffer.from("not-encrypted-garbage", "utf8") });

    const { config, source } = loadOrMigrateSecrets({
      safeStorage: safe,
      io,
      secretsPath: PATH,
      envSource: { DEEPSEEK_API_KEY: REAL_KEY },
    });

    expect(config.providers.deepseek.apiKey).toBe(REAL_KEY); // env keeps the app usable
    expect(source).toBe("env-plaintext"); // signals "the store is not authoritative"
    expect(io.writes).toBe(0); // the unreadable file is left for recovery
  });
});

describe("loadOrMigrateSecrets — first run", () => {
  it("migrates plaintext .env keys for ALL FOUR families into an encrypted file", () => {
    const safe = fakeSafe(true);
    const io = memIO();
    const envSource = {
      DEEPSEEK_API_KEY: REAL_KEY,
      DEEPSEEK_MODEL: "deepseek-v4-pro",
      GLM_API_KEY: GLM_KEY,
      KIMI_API_KEY: "sk-kimi-111",
      DASHSCOPE_API_KEY: "sk-dash-222",
    };

    const { config, source } = loadOrMigrateSecrets({ safeStorage: safe, io, secretsPath: PATH, envSource });

    expect(source).toBe("migrated");
    expect(Object.keys(config.providers).sort()).toEqual(["deepseek", "glm", "kimi", "qwen"]);
    expect(config.providers.deepseek.apiKey).toBe(REAL_KEY);
    expect(config.providers.deepseek.models?.[0]).toBe("deepseek-v4-pro");
    expect(io.writes).toBe(1);

    // Encrypted-at-rest: the bytes on disk must NOT be the plaintext key.
    const onDisk = io.store.get(PATH)!;
    expect(onDisk.toString("utf8").startsWith("ENC(")).toBe(true);
    expect(onDisk.includes(Buffer.from(REAL_KEY))).toBe(false);
    expect(onDisk.includes(Buffer.from(GLM_KEY))).toBe(false);
    // …but must round-trip back to the real secret.
    expect(safe.decryptString(onDisk)).toContain(REAL_KEY);
  });

  it("returns nothing (source=none) when there is no file and no env key", () => {
    const safe = fakeSafe(true);
    const io = memIO();
    const { config, source } = loadOrMigrateSecrets({
      safeStorage: safe,
      io,
      secretsPath: PATH,
      envSource: {},
    });
    expect(source).toBe("none");
    expect(config).toEqual({ version: 1, providers: {} });
    expect(io.writes).toBe(0);
    expect(safe.encrypts).toBe(0);
  });

  it("ignores a model-only env (no key) rather than saving a keyless instance", () => {
    const safe = fakeSafe(true);
    const io = memIO();
    const { config, source } = loadOrMigrateSecrets({
      safeStorage: safe,
      io,
      secretsPath: PATH,
      envSource: { DEEPSEEK_MODEL: "deepseek-v4-pro" },
    });
    expect(source).toBe("none");
    expect(config.providers).toEqual({});
    expect(io.writes).toBe(0);
  });

  it("falls back to plaintext env (no write) when OS encryption is unavailable", () => {
    const safe = fakeSafe(false); // e.g. Linux without a keyring
    const io = memIO();
    const envSource = { DEEPSEEK_API_KEY: REAL_KEY, DEEPSEEK_MODEL: "deepseek-v4-flash" };

    const { config, source } = loadOrMigrateSecrets({ safeStorage: safe, io, secretsPath: PATH, envSource });

    expect(source).toBe("env-plaintext");
    expect(config.providers.deepseek.apiKey).toBe(REAL_KEY);
    expect(io.writes).toBe(0); // never persist plaintext
    expect(safe.encrypts).toBe(0);
  });

  it("does not read the store when encryption is unavailable, but leaves it intact", () => {
    const safe = fakeSafe(false);
    const io = memIO({ [PATH]: Buffer.from("ENC(whatever)", "utf8") });
    const { source } = loadOrMigrateSecrets({ safeStorage: safe, io, secretsPath: PATH, envSource: {} });
    expect(source).toBe("none");
    expect(io.writes).toBe(0);
    expect(io.store.has(PATH)).toBe(true);
  });
});

describe("saveSecrets — the write path behind bridge:saveProvider", () => {
  it("encrypts the whole config to disk and round-trips", () => {
    const safe = fakeSafe(true);
    const io = memIO();
    const config = upsertProvider(
      emptyConfig(),
      { kind: "relay", name: "中转站", baseUrl: "https://relay.example.com", apiFormat: "openai", apiKey: GLM_KEY },
      () => "relay-1",
    ).config;

    saveSecrets({ safeStorage: safe, io, secretsPath: PATH }, config);

    expect(io.writes).toBe(1);
    const onDisk = io.store.get(PATH)!;
    expect(onDisk.includes(Buffer.from(GLM_KEY))).toBe(false); // never plaintext
    const back = loadOrMigrateSecrets({ safeStorage: safe, io, secretsPath: PATH, envSource: {} });
    expect(back.config.providers["relay-1"].apiKey).toBe(GLM_KEY);
  });

  it("THROWS instead of silently dropping the key when encryption is unavailable", () => {
    const safe = fakeSafe(false);
    const io = memIO();
    const config = upsertProvider(
      emptyConfig(),
      { kind: "relay", name: "中转站", baseUrl: "https://relay.example.com", apiFormat: "openai", apiKey: GLM_KEY },
      () => "relay-1",
    ).config;

    expect(() => saveSecrets({ safeStorage: safe, io, secretsPath: PATH }, config)).toThrow(/加密/);
    expect(io.writes).toBe(0); // and definitely no plaintext fallback
  });
});
