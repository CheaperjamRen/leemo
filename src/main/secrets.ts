/**
 * Provider-secret handling for the Electron main process.
 *
 * Pure & dependency-injected on purpose: `safeStorage` and filesystem access
 * are passed in so this module can be unit-tested under the plain-Node vitest
 * project without importing `electron` (which only loads inside the Electron
 * runtime). `src/main/main.ts` wires the real `electron.safeStorage` + `node:fs`.
 *
 * Key discipline (铁律): the plaintext keys are returned to the caller in-process
 * only. They are NEVER written to disk in plaintext, and this module never logs
 * them. On first run keys are migrated out of `.env` into an OS-encrypted blob
 * (macOS Keychain / Windows DPAPI / Linux libsecret) under userData, after
 * which `.env` is no longer required to run.
 *
 * Since 轮 3 卡 F the payload is a whole `ProviderConfigFile` (N instances across
 * M families), not a single DeepSeek pair. The pre-卡F flat blob
 * (`{DEEPSEEK_API_KEY, DEEPSEEK_MODEL}`) is still READ and migrated forward —
 * losing a user's already-configured key on upgrade would be unforgivable.
 */

import {
  emptyConfig,
  migrateLegacyConfig,
  type ProviderConfigFile,
} from "../host/provider-config";

/** The slice of Electron's `safeStorage` we depend on. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** Minimal synchronous filesystem seam (real impl backed by node:fs). */
export interface SecretsIO {
  exists(path: string): boolean;
  read(path: string): Buffer;
  write(path: string, data: Buffer): void;
}

/** The document this module persists (轮 3 卡 F: N instances, M families). */
export type SecretsValue = ProviderConfigFile;

/** Deps for the write path — no `envSource`, saving never consults env. */
export interface SaveSecretsDeps {
  safeStorage: SafeStorageLike;
  io: SecretsIO;
  /** Absolute path to the encrypted secrets blob under userData. */
  secretsPath: string;
}

export interface LoadSecretsDeps extends SaveSecretsDeps {
  /** Env to migrate from on first run (typically process.env after .env load). */
  envSource: Record<string, string | undefined>;
}

/** How the returned secrets were obtained — for non-sensitive logging.
 *  `env-plaintext` also covers "the store exists but could not be decrypted, so
 *  env is carrying this launch" — in both cases the store is not authoritative
 *  and nothing was persisted. */
export type SecretsSource = "encrypted" | "migrated" | "env-plaintext" | "none";

export interface LoadSecretsResult {
  config: ProviderConfigFile;
  source: SecretsSource;
}

/** Compare two configs by value (both are plain JSON documents). Used to decide
 *  whether a decrypted blob needs upgrading in place. */
function sameConfig(a: ProviderConfigFile, b: ProviderConfigFile): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Persist the provider config, encrypted.
 *
 * THROWS when OS encryption is unavailable: the caller has just been handed a key
 * by the user, and silently dropping it (or worse, writing it in plaintext) are
 * both unacceptable. The UI must surface the failure instead.
 */
export function saveSecrets(deps: SaveSecretsDeps, config: ProviderConfigFile): void {
  const { safeStorage, io, secretsPath } = deps;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "系统加密不可用，无法安全保存 API key（不会以明文落盘）。请检查系统钥匙串/凭据管理器后重试。",
    );
  }
  io.write(secretsPath, safeStorage.encryptString(JSON.stringify(config)));
}

/**
 * Resolve the provider config for this launch:
 *  - existing encrypted file → decrypt + migrate forward (+ fold in families
 *    that only exist in env yet; stored keys always win)          → "encrypted"
 *  - no file, key(s) in .env, OS encryption available → encrypt+write → "migrated"
 *  - no file, key(s) in .env, OS encryption unavailable → use env as-is (no write) → "env-plaintext"
 *  - file present but undecryptable → env for this launch, file LEFT ALONE
 *    (recoverable) → "env-plaintext" / "none"
 *  - nothing anywhere → empty config                              → "none"
 *
 * A decrypted blob that needed migrating (old flat shape, or a new env family) is
 * re-encrypted in place so the next launch reads the current shape directly.
 */
export function loadOrMigrateSecrets(deps: LoadSecretsDeps): LoadSecretsResult {
  const { safeStorage, io, secretsPath, envSource } = deps;

  if (io.exists(secretsPath) && safeStorage.isEncryptionAvailable()) {
    let onDisk: unknown;
    let readable = true;
    try {
      onDisk = JSON.parse(safeStorage.decryptString(io.read(secretsPath)));
    } catch {
      // Corrupt blob, wrong OS user, rotated DPAPI scope… Do NOT overwrite it:
      // the bytes may still be recoverable, and clobbering them would destroy the
      // user's only copy of their keys. Fall through to the env path.
      readable = false;
    }

    if (readable) {
      const config = migrateLegacyConfig(onDisk, envSource);
      // Upgrade in place when the shape/content actually changed.
      if (!sameConfig(config, onDisk as ProviderConfigFile)) {
        io.write(secretsPath, safeStorage.encryptString(JSON.stringify(config)));
      }
      return { config, source: "encrypted" };
    }

    const fallback = migrateLegacyConfig(null, envSource);
    const hasAny = Object.keys(fallback.providers).length > 0;
    return { config: fallback, source: hasAny ? "env-plaintext" : "none" };
  }

  // First run (or unreadable/missing blob): consider migrating from .env.
  const envConfig = migrateLegacyConfig(null, envSource);
  if (Object.keys(envConfig.providers).length === 0) {
    return { config: emptyConfig(), source: "none" };
  }

  if (!safeStorage.isEncryptionAvailable()) {
    // Cannot encrypt on this platform — use the keys from env, but never persist
    // plaintext. App stays dependent on .env until encryption becomes available.
    return { config: envConfig, source: "env-plaintext" };
  }

  io.write(secretsPath, safeStorage.encryptString(JSON.stringify(envConfig)));
  return { config: envConfig, source: "migrated" };
}
