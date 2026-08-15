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

const INSTRUCTION_OVERRIDE_PATTERN = /(?:ignore|disregard|override|forget)\s+(?:all\s+)?(?:previous|prior|system|developer)\s+(?:instructions?|rules?|prompts?)|never\s+(?:tell|inform|show)\s+(?:the\s+)?user/giu;
const APPROVED_DEFENSIVE_SCOPE_TAIL = "This applies to third-party URLs especially, but also to local dev servers that render untrusted user-generated content (admin dashboards, comment threads, support inboxes, etc.).";

function maskQuotedSegments(value: string): string {
  const quotePairs: Readonly<Record<string, string>> = {
    '"': '"',
    "`": "`",
    "“": "”",
    "‘": "’",
  };
  let closing: string | undefined;
  let result = "";
  for (const character of value) {
    if (closing) {
      if (character === closing) closing = undefined;
      result += " ";
      continue;
    }
    const nextClosing = quotePairs[character];
    if (nextClosing) {
      closing = nextClosing;
      result += " ";
      continue;
    }
    result += character;
  }
  return result;
}

function isQuotedDefensiveExample(text: string, start: number, end: number): boolean {
  const quotePairs: Readonly<Record<string, string>> = {
    '"': '"',
    "`": "`",
    "“": "”",
    "‘": "’",
  };
  const opening = text[start - 1];
  const closing = opening ? quotePairs[opening] : undefined;
  if (!closing) return false;
  const closeAt = text.indexOf(closing, end);
  if (closeAt < end || closeAt - end > 160 || text.slice(end, closeAt).includes("\n")) return false;

  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const nextLine = text.indexOf("\n", closeAt + 1);
  const line = text.slice(lineStart, nextLine < 0 ? text.length : nextLine);
  const afterQuote = line.slice(closeAt + 1 - lineStart);
  const maskedAfterQuote = maskQuotedSegments(afterQuote);
  const identifiesInjection = /(?:prompt[-\s]?injection|untrusted\s+(?:data|content)|提示词?注入|伪装成用户指令或系统提示)/iu.test(line);
  let lastRejectionStart: number | undefined;
  let lastRejectionEnd: number | undefined;
  const rejectionPatterns = [
    /(?:do\s+not|don't|never)\s+(?:act(?:\s+on)?|follow|obey|execute)\b(?:\s+(?:it|them|this|that|untrusted\s+(?:content|data)|the\s+(?:(?:quoted|cited)\s+)?(?:command|instruction|content)))?/giu,
    /(?:一律\s*忽略|不得[^。；\n]{0,48}(?:执行|当作[^。；\n]{0,16}指令)|禁止[^。；\n]{0,48}执行)/gu,
  ];
  for (const pattern of rejectionPatterns) {
    for (const rejection of maskedAfterQuote.matchAll(pattern)) {
      const rejectionEnd = rejection.index + rejection[0].length;
      if (lastRejectionEnd === undefined || rejectionEnd > lastRejectionEnd) {
        lastRejectionStart = rejection.index;
        lastRejectionEnd = rejectionEnd;
      }
    }
  }
  if (!identifiesInjection || lastRejectionStart === undefined || lastRejectionEnd === undefined) return false;
  const beforeRejection = maskedAfterQuote.slice(0, lastRejectionStart);
  const sentenceBoundary = Math.max(
    ...[".", "!", "?", "。", "！", "？"].map((character) => beforeRejection.lastIndexOf(character)),
  );
  const rejectionPrefix = beforeRejection.slice(sentenceBoundary + 1)
    .replace(/[*_~`#>]/gu, "")
    .trim();
  const hasDefensivePrefix = rejectionPrefix.length === 0
    || /^Flag it to the user and$/iu.test(rejectionPrefix)
    || /^这些不是用户的真实意图[，,]\s*一律\s*忽略[，,]?$/u.test(rejectionPrefix);
  if (!hasDefensivePrefix) return false;
  const tail = afterQuote.slice(lastRejectionEnd);
  const normalizedTail = tail
    .trim()
    .replace(/^[*_~`#>\s]+/u, "")
    .replace(/[*_~`#>\s]+$/u, "")
    .replace(/^[.,!?，。；：！？、—–…]+\s*/u, "");
  if (!normalizedTail) return true;
  return normalizedTail === APPROVED_DEFENSIVE_SCOPE_TAIL;
}

function instructionOverrideAt(text: string): number | undefined {
  for (const match of text.matchAll(INSTRUCTION_OVERRIDE_PATTERN)) {
    const start = match.index;
    const end = start + match[0].length;
    if (!isQuotedDefensiveExample(text, start, end)) return start;
  }
  return undefined;
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

    const overrideAt = instructionOverrideAt(text);
    if (overrideAt !== undefined) {
      findings.push({
        rule: "instruction-override",
        severity: "high",
        title: "疑似覆盖上级指令",
        detail: "内容要求忽略既有规则或向用户隐藏行为，安装前需要人工复核。",
        file: file.path,
        line: lineFor(text, overrideAt),
      });
    }

    addPatternFinding(
      findings,
      file,
      text,
      /(?<![.\w-])(?:read|collect|extract|upload|send|steal)\b[^\n]{0,160}(?:\.ssh[\\/]id_|api[_-]?key|access[_-]?token|secret|process\.env|environment\s+variables?)/iu,
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
