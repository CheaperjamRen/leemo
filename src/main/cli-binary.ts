/**
 * 打包后到哪儿找 Claude Code 的原生 CLI（轮 5 打包）。
 *
 * 事实（读 node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs 得来，非推测）：
 * SDK 自己找 CLI 的方式是
 *   createRequire(sdk.mjs).resolve("@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe")
 * 再 existsSync 一下。也就是说它解出来的路径**总是相对 sdk.mjs 所在位置**。
 *
 * 打包后这条路会踩坑：sdk.mjs 在 `app.asar` 里，于是解出来的是
 * `…/resources/app.asar/node_modules/…/claude.exe`。existsSync 对它返回 **true**
 * （Electron 给 fs 打了 asar 补丁），可 `spawn` 它必然失败 —— 操作系统的进程加载器
 * 不认识 asar 这个虚拟文件系统，它只是一个大文件里的一段字节。
 * 症状会是「装完能开窗、一发消息就报 spawn 失败」，而且 existsSync 为真会让人
 * 往完全错的方向查。
 *
 * 所以打包态由我们显式把**真实落地路径**算出来，经 `pathToClaudeCodeExecutable`
 * 交给 SDK，不依赖任何"Electron 也许会帮我把 asar 路径翻译成 unpacked 路径"的
 * 未文档化行为。asarUnpack 把这个包摊到 `app.asar.unpacked/` 下（见
 * electron-builder.yml），这里的第一候选就是它。
 *
 * dev 态返回 undefined：那时 sdk.mjs 就在真的 node_modules 里，SDK 自己解得对，
 * 我们不该抢这个活。
 */

/** 纯函数的探测切面（测试注入假的，生产给 fs.existsSync）。 */
export interface CliBinaryProbe {
  exists(path: string): boolean;
  join(...parts: string[]): string;
}

/** SDK 的平台包命名规则：`@anthropic-ai/claude-agent-sdk-<platform>-<arch>`。 */
export function platformPackage(platform: string, arch: string): string {
  return `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`;
}

/** Windows 上带 .exe，其余不带（与 sdk.mjs 里同一规则）。 */
export function binaryName(platform: string): string {
  return platform === "win32" ? "claude.exe" : "claude";
}

export interface ResolveCliArgs {
  /** app.isPackaged。false ⇒ 交回 SDK 自己解析。 */
  packaged: boolean;
  /** process.resourcesPath（打包后 = …/resources）。 */
  resourcesPath: string;
  platform: string;
  arch: string;
  probe: CliBinaryProbe;
}

/**
 * 打包态下 CLI 二进制的绝对路径；找不到（或 dev 态）返回 undefined。
 *
 * 候选顺序有意如此：
 *  1. `app.asar.unpacked/node_modules/…` —— asar: true + asarUnpack 的落点，
 *     也是我们配置的正常情况。
 *  2. `app/node_modules/…` —— asar 被关掉时的落点。留着这条，是为了万一将来
 *     因为别的原因关掉 asar，这里不用跟着改。
 *  3. `resources/node_modules/…` —— extraResources 式布局的兜底。
 *
 * 找不到时**不抛错**：抛在这里会变成"整个 App 起不来"，而降级成 undefined 只是
 * 让 SDK 走它自己那条路（大概率也失败，但那时的报错来自 SDK，说的是 CLI 找不到，
 * 比我们在启动阶段炸掉更接近真相）。调用方负责把这件事记进日志。
 */
export function resolveCliBinary(args: ResolveCliArgs): string | undefined {
  const { packaged, resourcesPath, platform, arch, probe } = args;
  if (!packaged) return undefined;

  const pkg = platformPackage(platform, arch);
  const bin = binaryName(platform);
  // pkg 里带 "/"，join 会把它当路径分隔处理 —— 这正是我们要的（scope 是个目录）。
  const candidates = [
    probe.join(resourcesPath, "app.asar.unpacked", "node_modules", pkg, bin),
    probe.join(resourcesPath, "app", "node_modules", pkg, bin),
    probe.join(resourcesPath, "node_modules", pkg, bin),
  ];
  for (const c of candidates) {
    try {
      if (probe.exists(c)) return c;
    } catch {
      // 探测本身失败（权限等）不该中断后面的候选。
    }
  }
  return undefined;
}
