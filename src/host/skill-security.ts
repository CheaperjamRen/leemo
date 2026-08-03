export type SkillFindingSeverity = "medium" | "high" | "critical";
export type SkillScanStatus = "scanned" | "review" | "blocked";

export interface SkillPackageFile {
  path: string;
  contents: Buffer;
}

export interface SkillSecurityFinding {
  rule:
    | "instruction-override"
    | "credential-access"
    | "remote-shell"
    | "install-hook"
    | "unpinned-execution";
  severity: SkillFindingSeverity;
  title: string;
  detail: string;
  file: string;
  line?: number;
}

export interface SkillSecurityReport {
  status: SkillScanStatus;
  findings: SkillSecurityFinding[];
  analyzedFiles: number;
  analysis: "static";
}

const TEXT_EXTENSIONS = new Set([
  "", ".md", ".txt", ".json", ".json5", ".js", ".mjs", ".cjs", ".ts", ".tsx",
  ".jsx", ".py", ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd", ".yaml", ".yml",
  ".toml", ".ini", ".xml", ".html", ".css", ".csv",
]);

function extensionOf(path: string): string {
  const file = path.replace(/\\/g, "/").split("/").pop() ?? "";
  const at = file.lastIndexOf(".");
  return at <= 0 ? "" : file.slice(at).toLowerCase();
}

function textOf(file: SkillPackageFile): string | undefined {
  if (!TEXT_EXTENSIONS.has(extensionOf(file.path))) return undefined;
  if (file.contents.includes(0)) return undefined;
  return file.contents.toString("utf8");
}

function lineFor(text: string, at: number): number {
  return text.slice(0, at).split("\n").length;
}

function addPatternFinding(
  findings: SkillSecurityFinding[],
  file: SkillPackageFile,
  text: string,
  pattern: RegExp,
  finding: Omit<SkillSecurityFinding, "file" | "line">,
): void {
  const match = pattern.exec(text);
  if (!match) return;
  findings.push({ ...finding, file: file.path, line: lineFor(text, match.index) });
}

function unpinnedNpxAt(text: string): number | undefined {
  const command = /\bnpx\s+(?:-[^\s`]+\s+)*([^\s`]+)/gi;
  for (const match of text.matchAll(command)) {
    const pkg = match[1].replace(/["'`;|&]+$/g, "");
    const pinAt = pkg.lastIndexOf("@");
    if (pinAt <= 0) return match.index;
  }
  return undefined;
}

function scanInstallHooks(file: SkillPackageFile, text: string): SkillSecurityFinding | undefined {
  if (file.path.replace(/\\/g, "/").split("/").pop()?.toLowerCase() !== "package.json") return undefined;
  try {
    const value = JSON.parse(text) as { scripts?: Record<string, unknown> };
    const hooks = ["preinstall", "install", "postinstall", "prepare"];
    const active = hooks.find((hook) => typeof value.scripts?.[hook] === "string");
    if (!active) return undefined;
    return {
      rule: "install-hook",
      severity: "high",
      title: "包含自动安装钩子",
      detail: `package.json 定义了 ${active}；Leemo 安装 Skill 时不会执行它，需要人工复核。`,
      file: file.path,
    };
  } catch {
    return undefined;
  }
}

export function scanSkillPackage(files: readonly SkillPackageFile[]): SkillSecurityReport {
  const findings: SkillSecurityFinding[] = [];
  let analyzedFiles = 0;

  for (const file of files) {
    const text = textOf(file);
    if (text === undefined) continue;
    analyzedFiles += 1;

    addPatternFinding(
      findings,
      file,
      text,
      /(?:ignore|disregard|override|forget)\s+(?:all\s+)?(?:previous|prior|system|developer)\s+(?:instructions?|rules?|prompts?)|never\s+(?:tell|inform|show)\s+(?:the\s+)?user/iu,
      {
        rule: "instruction-override",
        severity: "high",
        title: "疑似覆盖上级指令",
        detail: "内容要求忽略既有规则或向用户隐藏行为，安装前需要人工复核。",
      },
    );

    addPatternFinding(
      findings,
      file,
      text,
      /(?:read|collect|extract|upload|send|steal)[^\n]{0,160}(?:\.ssh[\\/]id_|api[_-]?key|access[_-]?token|secret|process\.env|environment\s+variables?)/iu,
      {
        rule: "credential-access",
        severity: "high",
        title: "疑似读取凭据",
        detail: "内容要求读取密钥、令牌或环境变量，可能超出 Skill 的合理权限。",
      },
    );

    addPatternFinding(
      findings,
      file,
      text,
      /(?:\b(?:curl|wget)\b[^\n|]{0,240}\|\s*(?:bash|sh)\b|\b(?:iwr|invoke-webrequest)\b[^\n|]{0,240}\|\s*(?:iex|invoke-expression)\b)/iu,
      {
        rule: "remote-shell",
        severity: "critical",
        title: "下载后直接执行远程脚本",
        detail: "代码把网络响应直接交给 Shell 执行，风险很高；扫描结果仅供用户判断。",
      },
    );

    const hook = scanInstallHooks(file, text);
    if (hook) findings.push(hook);

    const npxAt = unpinnedNpxAt(text);
    if (npxAt !== undefined) {
      findings.push({
        rule: "unpinned-execution",
        severity: "medium",
        title: "执行未固定版本的依赖",
        detail: "npx 调用没有固定版本或提交，后续运行结果可能随上游变化。",
        file: file.path,
        line: lineFor(text, npxAt),
      });
    }
  }

  const status: SkillScanStatus = findings.some((finding) => finding.severity === "critical")
    ? "blocked"
    : findings.some((finding) => finding.severity === "high")
      ? "review"
      : "scanned";

  return { status, findings, analyzedFiles, analysis: "static" };
}
