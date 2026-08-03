// Layout acceptance for the current packaged settings journey. Attach this to
// an isolated Leemo renderer after verify-settings-runtime has configured its
// loopback provider; no provider request or user profile is touched here.
import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";

const ROOT = path.resolve(import.meta.dirname, "..");
const port = process.env.LEEMO_CDP_PORT || "9333";
const auditTag = process.env.LEEMO_AUDIT_TAG || "model-onboarding-r9-layout";
const outputDir = path.join(ROOT, "docs", "research", "audit-shots");
const factsPath = path.join(outputDir, `${auditTag}-facts.json`);
const LONG_MODEL = "mock-manual-ultra-long-model-id-that-must-not-overflow-2026";
const VIEWPORTS = [
  { id: "1440x900", width: 1440, height: 900 },
  { id: "1280x720", width: 1280, height: 720 },
  { id: "1024x768", width: 1024, height: 768 },
  { id: "720x640", width: 720, height: 640 },
];
const REQUIRED_TABS = ["通用", "模型", "用量", "个性化", "连接器", "权限"];

fs.mkdirSync(outputDir, { recursive: true });

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find((candidate) => candidate.type === "page" && !candidate.url.startsWith("devtools://"));
if (!target) throw new Error(`CDP ${port} 上没有 Leemo renderer`);

const socket = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});

let nextId = 0;
const pending = new Map();
socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  clearTimeout(waiter.timer);
  if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
  else waiter.resolve(message.result);
});

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 30_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(expression, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(`等待超时：${label}`);
}

async function capture(name) {
  const result = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.writeFileSync(path.join(outputDir, name), Buffer.from(result.data, "base64"));
}

async function clickTab(label) {
  const clicked = await evaluate(`(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')]
      .find((item) => item.offsetParent !== null && item.getAttribute('aria-label') === ${JSON.stringify(label)});
    tab?.click();
    return Boolean(tab);
  })()`);
  if (!clicked) throw new Error(`找不到设置标签：${label}`);
  await sleep(180);
}

async function openSettings() {
  await evaluate(`(() => {
    const later = [...document.querySelectorAll('button')]
      .find((item) => item.offsetParent !== null && item.textContent?.trim() === '稍后配置');
    later?.click();
    if (!document.querySelector('[data-testid="settings-window"]')) {
      const button = [...document.querySelectorAll('button')]
        .find((item) => item.offsetParent !== null && item.getAttribute('aria-label') === '设置');
      button?.click();
    }
    return true;
  })()`);
  await waitFor(`Boolean(document.querySelector('[data-testid="settings-window"]'))`, "设置窗口");
  await evaluate(`(() => {
    const input = document.querySelector('input[aria-label="搜索设置"]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(100);
}

async function closeSettings() {
  await evaluate(`(() => {
    const button = document.querySelector('button[aria-label="关闭设置"]');
    button?.click();
    return Boolean(button);
  })()`);
  await waitFor(`!document.querySelector('[data-testid="settings-window"]')`, "关闭设置");
}

await send("Runtime.enable");
await send("Page.enable");
await openSettings();

const facts = {
  checkedAt: new Date().toISOString(),
  cdpPort: Number(port),
  requiredTabs: {},
  viewports: {},
};

const availableTabs = await evaluate(`([...document.querySelectorAll('[role="tab"]')]
  .filter((item) => item.offsetParent !== null)
  .map((item) => item.getAttribute('aria-label')).filter(Boolean))`);
for (const label of REQUIRED_TABS) facts.requiredTabs[label] = availableTabs.includes(label);

try {
  for (const viewport of VIEWPORTS) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(220);
    await openSettings();
    await clickTab("模型");
    await waitFor(`Boolean(document.querySelector('[data-testid="provider-config-form"]'))`, `${viewport.id} 模型配置页`);

    await evaluate(`(() => {
      const form = document.querySelector('[data-testid="provider-config-form"]');
      const scroller = form ? [...form.querySelectorAll('div')].find((item) => getComputedStyle(item).overflowY === 'auto') : null;
      if (scroller) scroller.scrollTop = 0;
      return Boolean(form);
    })()`);
    await sleep(100);

    const top = await evaluate(`(() => {
      const settings = document.querySelector('[data-testid="settings-window"]');
      const form = document.querySelector('[data-testid="provider-config-form"]');
      const footer = form?.querySelector('footer');
      const longModel = form?.querySelector('[title=${JSON.stringify(LONG_MODEL)}]');
      const scroller = form ? [...form.querySelectorAll('div')].find((item) => getComputedStyle(item).overflowY === 'auto') : null;
      if (!settings || !form || !footer || !scroller) return null;
      const settingsRect = settings.getBoundingClientRect();
      const formRect = form.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      const longRect = longModel?.getBoundingClientRect();
      const rowRect = longModel?.closest('li')?.getBoundingClientRect();
      const overflow = [...form.querySelectorAll('*')]
        .filter((element) => element.offsetParent !== null)
        .filter((element) => !['OPTION', 'SVG', 'PATH'].includes(element.tagName))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && (rect.left < formRect.left - 1 || rect.right > formRect.right + 1);
        })
        .map((element) => ({
          tag: element.tagName,
          text: (element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 70),
          className: String(element.className || '').slice(0, 100),
        }));
      return {
        viewport: { width: innerWidth, height: innerHeight },
        settings: { left: settingsRect.left, right: settingsRect.right, top: settingsRect.top, bottom: settingsRect.bottom },
        form: { left: formRect.left, right: formRect.right, top: formRect.top, bottom: formRect.bottom, clientWidth: form.clientWidth, scrollWidth: form.scrollWidth },
        footer: { left: footerRect.left, right: footerRect.right, top: footerRect.top, bottom: footerRect.bottom, height: footerRect.height },
        scroller: { clientHeight: scroller.clientHeight, scrollHeight: scroller.scrollHeight, scrollTop: scroller.scrollTop },
        settingsInsideViewport: settingsRect.left >= -1 && settingsRect.top >= -1 && settingsRect.right <= innerWidth + 1 && settingsRect.bottom <= innerHeight + 1,
        formInsideSettings: formRect.left >= settingsRect.left - 1 && formRect.right <= settingsRect.right + 1 && formRect.top >= settingsRect.top - 1 && formRect.bottom <= settingsRect.bottom + 1,
        footerInsideForm: footerRect.left >= formRect.left - 1 && footerRect.right <= formRect.right + 1 && footerRect.bottom <= formRect.bottom + 1,
        footerVisible: footerRect.top >= 0 && footerRect.bottom <= innerHeight + 1,
        longModelPresent: Boolean(longModel),
        longModelInsideRow: Boolean(longRect && rowRect && longRect.left >= rowRect.left - 1 && longRect.right <= rowRect.right + 1),
        innerConfigurationTabs: [...form.querySelectorAll('[role="tab"]')].filter((item) => item.offsetParent !== null).map((item) => item.getAttribute('aria-label')),
        horizontalOverflow: overflow,
      };
    })()`);
    if (!top) throw new Error(`${viewport.id} 模型配置页没有完整渲染`);
    await capture(`${auditTag}-${viewport.id}-model-top.png`);

    await evaluate(`(() => {
      const form = document.querySelector('[data-testid="provider-config-form"]');
      const scroller = form ? [...form.querySelectorAll('div')].find((item) => getComputedStyle(item).overflowY === 'auto') : null;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      return Boolean(scroller);
    })()`);
    await sleep(120);
    const footerAtBottom = await evaluate(`(() => {
      const form = document.querySelector('[data-testid="provider-config-form"]');
      const footer = form?.querySelector('footer');
      if (!form || !footer) return null;
      const formRect = form.getBoundingClientRect();
      const rect = footer.getBoundingClientRect();
      return {
        visible: rect.top >= 0 && rect.bottom <= innerHeight + 1,
        insideForm: rect.left >= formRect.left - 1 && rect.right <= formRect.right + 1 && rect.bottom <= formRect.bottom + 1,
      };
    })()`);
    await capture(`${auditTag}-${viewport.id}-model-bottom.png`);

    await clickTab("用量");
    const usage = await evaluate(`(() => {
      const settings = document.querySelector('[data-testid="settings-window"]');
      const panel = document.querySelector('[role="tabpanel"]');
      if (!settings || !panel) return null;
      const settingsRect = settings.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      return {
        headingVisible: [...panel.querySelectorAll('h2,h3')].some((item) => item.textContent?.includes('用量与费用')),
        panelInsideSettings: panelRect.left >= settingsRect.left - 1 && panelRect.right <= settingsRect.right + 1 && panelRect.bottom <= settingsRect.bottom + 1,
        scrollWidth: panel.scrollWidth,
        clientWidth: panel.clientWidth,
      };
    })()`);
    await capture(`${auditTag}-${viewport.id}-usage.png`);

    await closeSettings();
    const composer = await evaluate(`(() => {
      const textarea = document.querySelector('textarea[aria-label="输入消息"]');
      const sendButton = document.querySelector('button[aria-label="发送"]');
      const inputSurface = textarea?.parentElement;
      const composerRegion = inputSurface?.parentElement;
      if (!textarea || !sendButton || !inputSurface || !composerRegion) return null;
      const textareaRect = textarea.getBoundingClientRect();
      const sendRect = sendButton.getBoundingClientRect();
      const surfaceRect = inputSurface.getBoundingClientRect();
      const regionRect = composerRegion.getBoundingClientRect();
      const inside = (rect) => rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
      return {
        textarea: { left: textareaRect.left, right: textareaRect.right, top: textareaRect.top, bottom: textareaRect.bottom },
        surface: { left: surfaceRect.left, right: surfaceRect.right, top: surfaceRect.top, bottom: surfaceRect.bottom },
        region: { left: regionRect.left, right: regionRect.right, top: regionRect.top, bottom: regionRect.bottom },
        textareaInsideViewport: inside(textareaRect),
        surfaceInsideViewport: inside(surfaceRect),
        regionInsideViewport: inside(regionRect),
        sendInsideViewport: inside(sendRect),
        textareaVisibleHeight: textareaRect.height,
      };
    })()`);
    await capture(`${auditTag}-${viewport.id}-composer.png`);

    facts.viewports[viewport.id] = { model: top, footerAtBottom, usage, composer };
  }
} finally {
  await send("Emulation.clearDeviceMetricsOverride").catch(() => {});
  socket.close();
}

fs.writeFileSync(factsPath, `${JSON.stringify(facts, null, 2)}\n`, "utf8");

const failures = [];
for (const [label, present] of Object.entries(facts.requiredTabs)) {
  if (!present) failures.push(`缺少设置标签：${label}`);
}
for (const [viewport, result] of Object.entries(facts.viewports)) {
  const model = result.model;
  if (!model.settingsInsideViewport) failures.push(`${viewport} 设置窗口超出视口`);
  if (!model.formInsideSettings) failures.push(`${viewport} 模型表单超出设置窗口`);
  if (!model.footerInsideForm || !model.footerVisible || !result.footerAtBottom?.visible || !result.footerAtBottom?.insideForm) {
    failures.push(`${viewport} 模型操作区不可达或被裁切`);
  }
  if (model.footer.height > 64) failures.push(`${viewport} 模型操作区换行过高（${Math.round(model.footer.height)}px）`);
  if (!model.longModelPresent || !model.longModelInsideRow) failures.push(`${viewport} 长模型 ID 撑破布局`);
  if (model.innerConfigurationTabs.length > 0) failures.push(`${viewport} 仍暴露旧的模型配置内层标签`);
  if (model.horizontalOverflow.length > 0 || model.form.scrollWidth > model.form.clientWidth + 1) {
    failures.push(`${viewport} 模型页存在横向溢出`);
  }
  if (!result.usage?.headingVisible || !result.usage?.panelInsideSettings || result.usage.scrollWidth > result.usage.clientWidth + 1) {
    failures.push(`${viewport} 用量页不可达或横向溢出`);
  }
  if (!result.composer?.textareaInsideViewport || !result.composer?.surfaceInsideViewport || !result.composer?.regionInsideViewport || !result.composer?.sendInsideViewport || result.composer.textareaVisibleHeight < 40) {
    failures.push(`${viewport} 输入区或发送按钮被裁切`);
  }
}

console.log(JSON.stringify(facts, null, 2));
if (failures.length > 0) throw new Error(`设置布局验收失败：\n- ${failures.join("\n- ")}`);
