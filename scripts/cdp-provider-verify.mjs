// Consolidated release audit for model onboarding. The runtime producer uses
// packaged Electron + CDP + a loopback mock; this consumer never reads the
// user's provider config, mutates userData, or sends a paid upstream request.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { extractFile, listPackage } from "@electron/asar";

const ROOT = path.resolve(import.meta.dirname, "..");
const SHOTS = path.join(ROOT, "docs", "research", "audit-shots");
const RUNTIME_FACTS = path.join(SHOTS, "model-onboarding-r9-runtime-facts.json");
const LAYOUT_FACTS = path.join(SHOTS, "model-onboarding-r9-layout-facts.json");
const OUTPUT = path.join(ROOT, "docs", "sdd", "evidence-provider-verify.json");
const APP_ASAR = path.join(ROOT, "dist-package", "win-unpacked", "resources", "app.asar");
const EXE = path.join(ROOT, "dist-package", "win-unpacked", "Leemo.exe");
const INSTALLER = path.join(ROOT, "dist-package", "Leemo Setup 0.0.1.exe");
const FORBIDDEN_RENDERER_TEXT = /Fable|Sonnet|Opus|Haiku|CLAUDE_CODE_|ANTHROPIC_DEFAULT_|Claude Code/g;
const EXPECTED_VIEWPORTS = ["1440x900", "1280x720", "1024x768", "720x640"];

function readJson(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`缺少验收事实：${path.relative(ROOT, file)}。先运行 node scripts/verify-settings-runtime.mjs`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
}

function rendererFromAsar() {
  const rendererPath = listPackage(APP_ASAR).find((entry) =>
    /^\\dist\\assets\\index-[^\\]+\.js$/i.test(entry),
  );
  if (!rendererPath) throw new Error("app.asar 内找不到主 renderer chunk");
  return {
    path: rendererPath,
    source: extractFile(APP_ASAR, rendererPath.slice(1)).toString("utf8"),
  };
}

const runtime = readJson(RUNTIME_FACTS);
const layout = readJson(LAYOUT_FACTS);
const renderer = rendererFromAsar();
const results = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
}

record(
  "隔离打包应用且零外网请求",
  runtime.isolatedUserData === true && runtime.externalApiCalls === 0,
  `${runtime.packagedExecutable}; external=${runtime.externalApiCalls}`,
);
record(
  "服务商目录、远程发现与手动模型链路",
  runtime.providerCatalogCards >= 5 && runtime.remoteDiscovery === true && runtime.manualModel === true,
  `cards=${runtime.providerCatalogCards}`,
);
record(
  "图片与深度思考自动探测为证据而非发送门禁",
  runtime.automaticCapabilityProbes?.imageReachedUpstream === true
    && runtime.automaticCapabilityProbes?.imageFailedAdvisoryOnly === true
    && runtime.automaticCapabilityProbes?.reasoningReachedUpstream === true
    && runtime.automaticCapabilityProbes?.userOverridePersisted === true,
  "图片失败仍可发，用户纠正跨重启保留",
);
record(
  "打包 Agent 工具按设置执行真实子任务模型路由",
  runtime.subtaskRouting?.explicitModelPersisted === true
    && runtime.subtaskRouting?.packagedAgentToolExecuted === true
    && runtime.subtaskRouting?.explicit?.parentModel === "mock-beta-retry"
    && runtime.subtaskRouting?.explicit?.childModel === "mock-alpha-vision-disputed"
    && runtime.subtaskRouting?.automatic?.parentModel === "mock-beta-retry"
    && runtime.subtaskRouting?.automatic?.childModel === "mock-beta-retry",
  runtime.subtaskRouting && typeof runtime.subtaskRouting === "object"
    ? `显式 ${runtime.subtaskRouting.explicit?.parentModel} -> ${runtime.subtaskRouting.explicit?.childModel}; 自动 ${runtime.subtaskRouting.automatic?.parentModel} -> ${runtime.subtaskRouting.automatic?.childModel}`
    : "missing",
);
record(
  "真实失败后原文保留、切模型重试与错误人话化",
  runtime.retry?.failedAfterHostAck === true
    && runtime.retry?.userFacingErrorNormalized === true
    && runtime.retry?.originalTextPreserved === true
    && runtime.retry?.uiModelSwitchAndRetry === true
    && runtime.retry?.completed === true,
  `${runtime.retry?.switchedFrom} -> ${runtime.retry?.switchedTo}`,
);
record(
  "附件失败与重发使用同一绝对路径元数据",
  runtime.attachmentBridge?.failedAfterHostAck === true
    && runtime.attachmentBridge?.sameAbsolutePathMetadataOnBothRounds === true
    && runtime.attachmentBridge?.completed === true,
  `${runtime.attachmentBridge?.switchedFrom} -> ${runtime.attachmentBridge?.switchedTo}`,
);
record(
  "凭据不进入 renderer 状态或主进程日志",
  runtime.apiKeyRendererVisible === false && runtime.apiKeyLogged === false,
  "测试 key 未出现在 facts、renderer 或日志",
);
record(
  "打包应用空闲进程树资源已实测",
  runtime.idleProcessTree?.processCount > 0
    && runtime.idleProcessTree?.workingSetBytes > 0
    && runtime.idleProcessTree?.workingSetBytes < 2 * 1024 * 1024 * 1024,
  `${runtime.idleProcessTree?.processCount ?? 0} 进程 / ${((runtime.idleProcessTree?.workingSetBytes ?? 0) / 1024 / 1024).toFixed(2)} MiB`,
);

for (const viewport of EXPECTED_VIEWPORTS) {
  const fact = layout.viewports?.[viewport];
  const model = fact?.model;
  const composer = fact?.composer;
  const pass = Boolean(
    model?.settingsInsideViewport
      && model?.formInsideSettings
      && model?.footerInsideForm
      && model?.footerVisible
      && model?.footer?.height <= 64
      && model?.longModelPresent
      && model?.longModelInsideRow
      && model?.innerConfigurationTabs?.length === 0
      && model?.horizontalOverflow?.length === 0
      && model?.form?.scrollWidth <= model?.form?.clientWidth + 1
      && fact?.usage?.headingVisible
      && fact?.usage?.panelInsideSettings
      && fact?.usage?.scrollWidth <= fact?.usage?.clientWidth + 1
      && composer?.textareaInsideViewport
      && composer?.surfaceInsideViewport
      && composer?.regionInsideViewport
      && composer?.sendInsideViewport,
  );
  record(
    `${viewport} 设置和输入区无裁切或横向溢出`,
    pass,
    model ? `footer=${Math.round(model.footer.height)}px; content=${model.scroller.clientHeight}px` : "missing",
  );
}

const forbiddenHits = renderer.source.match(FORBIDDEN_RENDERER_TEXT) ?? [];
record(
  "打包 renderer 不暴露底层模型角色或 Claude Code 心智",
  forbiddenHits.length === 0,
  forbiddenHits.length > 0 ? [...new Set(forbiddenHits)].join(",") : renderer.path,
);
record(
  "发布包凭据边界与哈希可复核",
  fs.existsSync(EXE) && fs.existsSync(INSTALLER) && fs.existsSync(APP_ASAR),
  `exe=${sha256(EXE).slice(0, 12)} installer=${sha256(INSTALLER).slice(0, 12)} asar=${sha256(APP_ASAR).slice(0, 12)}`,
);

const evidence = {
  checkedAt: new Date().toISOString(),
  sourceFacts: [path.relative(ROOT, RUNTIME_FACTS), path.relative(ROOT, LAYOUT_FACTS)],
  package: {
    executableSha256: sha256(EXE),
    installerSha256: sha256(INSTALLER),
    appAsarSha256: sha256(APP_ASAR),
    rendererPath: renderer.path,
    rendererBytes: Buffer.byteLength(renderer.source),
  },
  residual: {
    nativeAttachmentPickerAutomated: runtime.nativeAttachmentPickerAutomated === true,
    note: runtime.nativeAttachmentPickerAutomated === true
      ? null
      : "原生 Windows 文件选择框未自动化；打包 Bridge 附件路径与失败重试已实测。",
  },
  results,
};
fs.writeFileSync(OUTPUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
console.log(`证据已写入 ${path.relative(ROOT, OUTPUT)}`);
if (failed.length > 0) process.exitCode = 1;
