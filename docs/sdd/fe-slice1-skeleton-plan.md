# Frontend Slice 1 — Skeleton (Foundation + Buddy Landing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the greenfield frontend (Vite+React+TS+Tailwind+Zustand) and deliver a runnable, all-fixture buddy landing page whose one live loop is: type → Enter → momo streams a reply back. **This is beat 1 (skeleton) of slice 1** — plain visuals only; K3 visual dressing is beat 2 (a separate handoff produced after this is green).

**Architecture:** Hexagonal `BridgeClient` port mirrors the frozen `src/bridge/contract.ts`; the first implementation is a `FixtureBridgeClient` that emits a scripted `LeemoEvent` stream. Zustand stores subscribe to the port and normalize events into messages; React components read stores only (never the port). Phase-1 swaps in an `IpcBridgeClient` with zero store/component change.

**Tech Stack:** React 19, Vite 7, Vitest 4 (already in repo), Tailwind 4 (`@tailwindcss/vite`), Zustand 5, jsdom + @testing-library/react.

## Global Constraints

- **CC SDK pinned** `@anthropic-ai/claude-agent-sdk` = `0.3.210` (do not touch/upgrade).
- **Runtime floor:** Vitest 4 requires **Node ≥ 20 / Vite ≥ 6** (we pin Vite 7). The repo `package.json` currently declares `"engines": { "node": ">=18.0.0" }` — bump to `">=20.0.0"` in Task 1 Step 4 (dev-tooling floor; does not affect the SDK runtime). Verify local `node -v` ≥ 20 before starting.
- **Do NOT modify** `src/gateway/**`, `src/bridge/**` (import `contract.ts` as `import type` only — never edit), `tsconfig.vendor.json`, `smoke/**`. The existing **215 tests must stay green**.
- Root `tsconfig.json`: the ONLY permitted change is adding `"src/renderer"` to its `exclude` array (Node-only program must not compile `.tsx`).
- **Naming:** only `Leemo` / `momo`. Never "幸运鹿 / LuckyDeer / Lulu". User-visible nouns budget = 2 (本子 / 成果) — irrelevant to this slice's copy, but no forbidden nouns.
- **TDD is mandatory** for all logic here (stores / port / normalization) — Bridge/IPC/store are strict-TDD per CLAUDE.md.
- **02 §2.1 铁律:** components under `src/renderer/components/**` must not import the bridge port (`bridge/client` or `bridge/fixture-client`). Enforced by guard test (Task 6).
- **`prefers-reduced-motion`** respected by any motion (only the static avatar here; animation is beat 2).
- Visual baseline for beat 2 (not this plan): `docs/design-audition/k3/buddy-mode.html`.

---

## File Structure

```
index.html                              ← Vite entry (Task 1)
vite.config.ts                          ← plugin-react + tailwind + @renderer alias (Task 1)
tsconfig.renderer.json                  ← DOM+jsx+strict, types:[node] (Task 1)
tsconfig.json                           ← MODIFY: add "src/renderer" to exclude (Task 1)
package.json                            ← MODIFY: deps + typecheck script (Task 1)
vitest.config.ts                        ← MODIFY: node + renderer projects (Task 1)
src/renderer/
  main.tsx                              ← ReactDOM mount (Task 1)
  index.css                             ← @import tailwindcss + tokens (Task 1)
  design/tokens.css                     ← --leemo-* buddy palette from K3 (Task 1)
  test/setup.ts                         ← jest-dom setup (Task 1)
  app/App.tsx                           ← stub (Task 1) → real provider+shell (Task 6)
  bridge/
    client.ts                           ← BridgeClient port interface (Task 2)
    fixture-client.ts                   ← FixtureBridgeClient (Task 2)
    fixtures/index.ts                   ← seed providers/notifications/reply (Task 2)
    context.tsx                         ← React context + store hooks (Task 6)
  stores/
    message-model.ts                    ← RendererMessage + applyEvent (Task 3)
    conversations.ts                    ← createConversationsStore (Task 4)
    settings.ts                         ← createSettingsStore + buildGreeting (Task 5)
    notifications.ts                    ← createNotificationsStore (Task 5)
  components/
    momo/MomoAvatar.tsx                 ← static SVG face (Task 6)
    TopBar.tsx / Greeting.tsx / ChipRow.tsx / InputBox.tsx
    LightArtifactCard.tsx / PinFootnote.tsx / HistoryDrawer.tsx
    MessageList.tsx / BuddyShell.tsx    ← (Task 6)
```

**Deferred (explicit, not silent):** viz UI Kit CSS (`.viz-*`) → slice 4 (no viz card until then, YAGNI); multi-conversation `messagesByConv` → later (slice 1 holds one active conversation); all non-text message cards (tool/plan/approval/question/viz) + usage footnote → slices 2–4; real IPC/Electron/SQLite → Phase-1.

---

### Task 1: Toolchain scaffold — renderer builds & tests green, node suite untouched

**Files:**
- Create: `index.html`, `vite.config.ts`, `tsconfig.renderer.json`, `src/renderer/main.tsx`, `src/renderer/index.css`, `src/renderer/design/tokens.css`, `src/renderer/test/setup.ts`, `src/renderer/app/App.tsx`, `src/renderer/app/App.test.tsx`
- Modify: `package.json` (deps + typecheck script), `tsconfig.json` (exclude), `vitest.config.ts` (projects)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a working dev/test toolchain. `App` (stub) default-exported from `src/renderer/app/App.tsx`. `@renderer/*` alias → `src/renderer/*` (both vite and vitest renderer project).

- [ ] **Step 1: Add dependencies**

Run:
```bash
npm install react@^19.0.0 react-dom@^19.0.0 zustand@^5.0.0
npm install -D @types/react@^19.0.0 @types/react-dom@^19.0.0 @vitejs/plugin-react@^4.3.0 \
  vite@^7.0.0 jsdom@^25.0.0 tailwindcss@^4.0.0 @tailwindcss/vite@^4.0.0 \
  @testing-library/react@^16.1.0 @testing-library/jest-dom@^6.6.0 @testing-library/user-event@^14.5.0
```
Expected: installs succeed; `vitest@^4.1.10` already present is unchanged.

- [ ] **Step 2: Create `tsconfig.renderer.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@renderer/*": ["src/renderer/*"] }
  },
  "include": ["src/renderer"]
}
```
Note: `types:["node"]` is REQUIRED — the renderer type-imports `contract.ts`, whose type closure includes `events.ts` (`import fs from "node:fs"`). A stricter browser-only firewall (emit bridge `.d.ts` like vendor) is deferred; not needed for slice 1.

- [ ] **Step 3: Add `"src/renderer"` to root `tsconfig.json` exclude**

Modify `tsconfig.json` `exclude` from `["src/gateway/vendor"]` to:
```json
  "exclude": ["src/gateway/vendor", "src/renderer"]
```

- [ ] **Step 4: Update `package.json` — typecheck script + Node floor**

Change the `typecheck` script and bump the Node engines floor (Vitest 4 needs ≥ 20):
```json
    "typecheck": "tsc -p tsconfig.vendor.json && tsc -p tsconfig.json && tsc -p tsconfig.renderer.json",
    "dev": "vite",
    "build": "vite build"
```
And set `"engines": { "node": ">=20.0.0" }`.

- [ ] **Step 5: Create `vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, "/");

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: [{ find: /^@renderer\//, replacement: `${root}/src/renderer/` }],
  },
});
```

- [ ] **Step 6: Convert `vitest.config.ts` to node + renderer projects (additive)**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, "/");

export default defineConfig({
  test: {
    projects: [
      {
        // Existing node suite — behavior UNCHANGED (same include + aliases).
        test: { name: "node", include: ["tests/**/*.test.ts"], environment: "node" },
        resolve: {
          alias: [
            { find: /^@\//, replacement: `${root}/src/gateway/vendor/llms/src/` },
            { find: /^@vendor\//, replacement: `${root}/src/gateway/vendor/` },
            { find: /^@gateway\//, replacement: `${root}/src/gateway/` },
          ],
        },
      },
      {
        // New renderer suite — jsdom.
        plugins: [react()],
        test: {
          name: "renderer",
          include: ["src/renderer/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["src/renderer/test/setup.ts"],
        },
        resolve: { alias: [{ find: /^@renderer\//, replacement: `${root}/src/renderer/` }] },
      },
    ],
  },
});
```

- [ ] **Step 7: Create supporting files**

`src/renderer/test/setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

`src/renderer/design/tokens.css` (buddy palette transcribed from `k3/buddy-mode.html` :root, renamed `--leemo-*`):
```css
:root {
  --leemo-bg: #FAF6EE;
  --leemo-bg-deep: #F2EBDC;
  --leemo-card: #FFFEFB;
  --leemo-ink: #2D2822;
  --leemo-ink-2: #6E6559;
  --leemo-ink-3: #A89D8E;
  --leemo-line: #E9E0CE;
  --leemo-line-soft: #F0E8D8;
  --leemo-amber: #C07E1F;
  --leemo-amber-strong: #A2660F;
  --leemo-amber-soft: #F7E9CC;
  --leemo-amber-glow: #EFCF9A;
  --leemo-danger: #DE524C;
  --leemo-momo-body: #FFF8EA;
  --leemo-momo-line: #E7D9BC;
  --leemo-momo-face: #3B2F24;
  --leemo-momo-blush: #F2AC72;
  --leemo-momo-spark: #E9A23B;
  --leemo-momo-hi: #FFFDF7;
}
```

`src/renderer/index.css`:
```css
@import "tailwindcss";
@import "./design/tokens.css";

body {
  margin: 0;
  background: var(--leemo-bg);
  color: var(--leemo-ink);
  font-family: "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, "Segoe UI", sans-serif;
}
```

`index.html`:
```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Leemo</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/renderer/main.tsx"></script>
  </body>
</html>
```

`src/renderer/app/App.tsx` (stub — replaced in Task 6):
```tsx
export default function App() {
  return <div>Leemo</div>;
}
```

`src/renderer/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 8: Write the failing renderer smoke test**

`src/renderer/app/App.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders under jsdom", () => {
    render(<App />);
    expect(screen.getByText("Leemo")).toBeInTheDocument();
  });
});
```

- [ ] **Step 9: Run tests — renderer green AND node suite still green**

Run: `npm test`
Expected: `renderer` project PASS (App smoke); `node` project PASS (existing 215 tests unchanged).

- [ ] **Step 10: Run 3-way typecheck**

Run: `npm run typecheck`
Expected: all three `tsc` invocations exit 0.

- [ ] **Step 11: Commit**

```bash
git add index.html vite.config.ts tsconfig.renderer.json tsconfig.json package.json package-lock.json vitest.config.ts src/renderer
git commit -m "feat(fe): renderer toolchain scaffold (vite+react+tailwind+vitest jsdom)"
```

---

### Task 2: BridgeClient port + FixtureBridgeClient + fixtures

**Files:**
- Create: `src/renderer/bridge/client.ts`, `src/renderer/bridge/fixture-client.ts`, `src/renderer/bridge/fixtures/index.ts`, `src/renderer/bridge/fixture-client.test.ts`

**Interfaces:**
- Consumes: `import type { BridgeInvokeMap, BridgeEventMap, LeemoEvent, ProviderSpec } from "../../bridge/contract"` (type-only; contract is pure types).
- Produces:
  - `interface BridgeClient { invoke<K>(channel, req): Promise<...>; subscribe<K>(channel, cb): () => void }`
  - `class FixtureBridgeClient implements BridgeClient` with `new FixtureBridgeClient(opts?: { reply?: string; chunkDelayMs?: number; sessionId?: string })`
  - `FIXTURE_PROVIDERS: ProviderSpec[]`, `FIXTURE_NOTIFICATIONS`, `DEFAULT_MOMO_REPLY: string`

- [ ] **Step 1: Write the failing test**

`src/renderer/bridge/fixture-client.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import type { LeemoEvent } from "../../bridge/contract";
import { FixtureBridgeClient } from "./fixture-client";

describe("FixtureBridgeClient", () => {
  it("send emits a contract-conformant LeemoEvent sequence", async () => {
    vi.useFakeTimers();
    const client = new FixtureBridgeClient({ reply: "ab cd", chunkDelayMs: 10 });
    const events: LeemoEvent[] = [];
    client.subscribe("bridge:event", (e) => events.push(e));

    await client.invoke("bridge:send", { conversationId: "conv-1", prompt: "hi" });
    await vi.advanceTimersByTimeAsync(200);

    expect(events[0]).toEqual({ type: "conversation.started", sessionId: expect.any(String) });
    expect(events.some((e) => e.type === "text.delta")).toBe(true);
    expect(events.find((e) => e.type === "text.final")).toEqual({ type: "text.final", text: "ab cd" });
    expect(events.at(-1)).toMatchObject({ type: "run.finished", isError: false });
    vi.useRealTimers();
  });

  it("unsubscribe stops delivery", async () => {
    vi.useFakeTimers();
    const client = new FixtureBridgeClient({ reply: "x", chunkDelayMs: 10 });
    const seen: LeemoEvent[] = [];
    const off = client.subscribe("bridge:event", (e) => seen.push(e));
    off();
    await client.invoke("bridge:send", { conversationId: "conv-1", prompt: "hi" });
    await vi.advanceTimersByTimeAsync(200);
    expect(seen).toHaveLength(0);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fixture-client`
Expected: FAIL — `Cannot find module './fixture-client'`.

- [ ] **Step 3: Write the port interface**

`src/renderer/bridge/client.ts`:
```ts
import type { BridgeInvokeMap, BridgeEventMap } from "../../bridge/contract";

/** The renderer's single seam to the bridge. First impl is FixtureBridgeClient;
 *  Phase-1 swaps in an IPC-backed impl with zero store/component change. */
export interface BridgeClient {
  invoke<K extends keyof BridgeInvokeMap>(
    channel: K,
    req: BridgeInvokeMap[K]["request"],
  ): Promise<BridgeInvokeMap[K]["response"]>;
  subscribe<K extends keyof BridgeEventMap>(
    channel: K,
    cb: (payload: BridgeEventMap[K]) => void,
  ): () => void;
}
```

- [ ] **Step 4: Write the fixtures**

`src/renderer/bridge/fixtures/index.ts`:
```ts
import type { ProviderSpec } from "../../../bridge/contract";

export const DEFAULT_MOMO_REPLY =
  "好呀，我在。想从哪儿开始都行——把要做的说给我，我来安排。";

export const FIXTURE_PROVIDERS: ProviderSpec[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    kind: "deepseek",
    category: "cn_official",
    apiFormat: "anthropic",
    authMode: "api-key",
    baseUrl: "https://api.deepseek.com",
    models: ["deepseek-chat"],
    capabilities: { balanceApi: true, modelDiscovery: false, subscriptionPlan: false },
  },
];

export const FIXTURE_NOTIFICATIONS = [
  { id: "n1", text: "《数据结构》第五章笔记整理完成", read: false },
];
```

- [ ] **Step 5: Write the FixtureBridgeClient**

`src/renderer/bridge/fixture-client.ts`:
```ts
import type { BridgeInvokeMap, BridgeEventMap, LeemoEvent } from "../../bridge/contract";
import type { BridgeClient } from "./client";
import { DEFAULT_MOMO_REPLY, FIXTURE_PROVIDERS } from "./fixtures";

type Listener = (payload: unknown) => void;

export interface FixtureOpts {
  reply?: string;
  chunkDelayMs?: number;
  sessionId?: string;
}

export class FixtureBridgeClient implements BridgeClient {
  private listeners = new Map<string, Set<Listener>>();
  private started = false;
  private readonly reply: string;
  private readonly chunkDelayMs: number;
  private readonly sessionId: string;

  constructor(opts: FixtureOpts = {}) {
    this.reply = opts.reply ?? DEFAULT_MOMO_REPLY;
    this.chunkDelayMs = opts.chunkDelayMs ?? 24;
    this.sessionId = opts.sessionId ?? "fixture-session-1";
  }

  async invoke<K extends keyof BridgeInvokeMap>(
    channel: K,
    _req: BridgeInvokeMap[K]["request"],
  ): Promise<BridgeInvokeMap[K]["response"]> {
    switch (channel) {
      case "bridge:createConversation":
        return { conversationId: "conv-1" } as BridgeInvokeMap[K]["response"];
      case "bridge:listProviders":
        return FIXTURE_PROVIDERS as BridgeInvokeMap[K]["response"];
      case "bridge:send":
        this.scriptReply();
        return undefined as BridgeInvokeMap[K]["response"];
      default:
        return undefined as BridgeInvokeMap[K]["response"];
    }
  }

  subscribe<K extends keyof BridgeEventMap>(
    channel: K,
    cb: (payload: BridgeEventMap[K]) => void,
  ): () => void {
    const set = this.listeners.get(channel) ?? new Set<Listener>();
    set.add(cb as Listener);
    this.listeners.set(channel, set);
    return () => set.delete(cb as Listener);
  }

  private emit(event: LeemoEvent): void {
    this.listeners.get("bridge:event")?.forEach((l) => l(event));
  }

  /** Schedules a scripted stream: started(once) → delta×N → final → finished. */
  private scriptReply(): void {
    let t = 0;
    const step = this.chunkDelayMs;
    if (!this.started) {
      this.started = true;
      setTimeout(() => this.emit({ type: "conversation.started", sessionId: this.sessionId }), (t += step));
    }
    const chunks = this.reply.match(/\S+\s*/g) ?? [this.reply];
    for (const chunk of chunks) {
      setTimeout(() => this.emit({ type: "text.delta", text: chunk }), (t += step));
    }
    setTimeout(() => this.emit({ type: "text.final", text: this.reply }), (t += step));
    setTimeout(
      () =>
        this.emit({
          type: "run.finished",
          subtype: "success",
          isError: false,
          finalText: this.reply,
          pathAudit: { claimed: [] },
        }),
      (t += step),
    );
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- fixture-client`
Expected: PASS (both cases).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/bridge
git commit -m "feat(fe): BridgeClient port + FixtureBridgeClient scripted stream"
```

---

### Task 3: Message model + applyEvent reducer (pure)

**Files:**
- Create: `src/renderer/stores/message-model.ts`, `src/renderer/stores/message-model.test.ts`

**Interfaces:**
- Consumes: `import type { LeemoEvent } from "../../bridge/contract"`.
- Produces:
  - `interface RendererMessage { id: string; role: "user" | "momo"; text: string; streaming: boolean }`
  - `function applyEvent(messages: RendererMessage[], event: LeemoEvent): RendererMessage[]` (pure; deterministic ids derived from array length; unknown/deferred variants return input unchanged).

- [ ] **Step 1: Write the failing test**

`src/renderer/stores/message-model.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { LeemoEvent } from "../../bridge/contract";
import { applyEvent, type RendererMessage } from "./message-model";

describe("applyEvent", () => {
  it("conversation.started does not add a message", () => {
    expect(applyEvent([], { type: "conversation.started", sessionId: "s1" })).toEqual([]);
  });

  it("text.delta accumulates into one streaming momo message", () => {
    let m: RendererMessage[] = [];
    m = applyEvent(m, { type: "text.delta", text: "Hel" });
    m = applyEvent(m, { type: "text.delta", text: "lo" });
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ role: "momo", text: "Hello", streaming: true });
  });

  it("text.final finalizes the streaming message", () => {
    let m: RendererMessage[] = [{ id: "m0", role: "momo", text: "Hel", streaming: true }];
    m = applyEvent(m, { type: "text.final", text: "Hello" });
    expect(m[0]).toMatchObject({ text: "Hello", streaming: false });
  });

  it("run.finished clears any streaming flag", () => {
    let m: RendererMessage[] = [{ id: "m0", role: "momo", text: "Hi", streaming: true }];
    m = applyEvent(m, {
      type: "run.finished", subtype: "success", isError: false, finalText: "Hi",
      pathAudit: { claimed: [] },
    });
    expect(m[0].streaming).toBe(false);
  });

  it("deferred variants (tool/usage/etc) leave messages unchanged", () => {
    const start: RendererMessage[] = [{ id: "m0", role: "momo", text: "x", streaming: false }];
    const evts: LeemoEvent[] = [
      { type: "tool.started", toolUseId: "t1", name: "Read", input: {}, subagent: false },
      { type: "thinking.delta", text: "…" },
      { type: "usage.final", usage: {
          providerId: "p", modelId: "m", inputTokens: 1, outputTokens: 1,
          cacheReadTokens: 0, cacheCreationTokens: 0, costSource: "unpriced", tokensEstimated: false,
      } },
    ];
    for (const e of evts) expect(applyEvent(start, e)).toEqual(start);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- message-model`
Expected: FAIL — `Cannot find module './message-model'`.

- [ ] **Step 3: Write minimal implementation**

`src/renderer/stores/message-model.ts`:
```ts
import type { LeemoEvent } from "../../bridge/contract";

export interface RendererMessage {
  id: string;
  role: "user" | "momo";
  text: string;
  streaming: boolean;
}

/** Pure reducer: fold one LeemoEvent into the message list. Slice 1 handles
 *  the text-stream + run lifecycle; other variants are deferred (return input
 *  unchanged) and land in slices 2–4. */
export function applyEvent(messages: RendererMessage[], event: LeemoEvent): RendererMessage[] {
  switch (event.type) {
    case "text.delta": {
      const last = messages[messages.length - 1];
      if (last && last.role === "momo" && last.streaming) {
        const updated = { ...last, text: last.text + event.text };
        return [...messages.slice(0, -1), updated];
      }
      return [...messages, { id: `m${messages.length}`, role: "momo", text: event.text, streaming: true }];
    }
    case "text.final": {
      const last = messages[messages.length - 1];
      if (last && last.role === "momo" && last.streaming) {
        return [...messages.slice(0, -1), { ...last, text: event.text, streaming: false }];
      }
      return [...messages, { id: `m${messages.length}`, role: "momo", text: event.text, streaming: false }];
    }
    case "run.finished":
      return messages.map((m) => (m.streaming ? { ...m, streaming: false } : m));
    default:
      return messages;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- message-model`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/stores/message-model.ts src/renderer/stores/message-model.test.ts
git commit -m "feat(fe): pure applyEvent reducer (LeemoEvent -> messages)"
```

---

### Task 4: Conversations store — the live send loop

**Files:**
- Create: `src/renderer/stores/conversations.ts`, `src/renderer/stores/conversations.test.ts`

**Interfaces:**
- Consumes: `BridgeClient` (Task 2), `applyEvent` + `RendererMessage` (Task 3), `import { createStore, type StoreApi } from "zustand/vanilla"`.
- Produces:
  - `interface ConversationsState { activeId: string; messages: RendererMessage[]; send: (text: string) => Promise<void> }`
  - `function createConversationsStore(client: BridgeClient): StoreApi<ConversationsState>` (subscribes to `bridge:event` at creation; `send` optimistically appends the user message then invokes `bridge:send`).

- [ ] **Step 1: Write the failing test**

`src/renderer/stores/conversations.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { FixtureBridgeClient } from "../bridge/fixture-client";
import { createConversationsStore } from "./conversations";

describe("conversations store", () => {
  it("send appends the user message immediately, then streams momo's reply", async () => {
    vi.useFakeTimers();
    const client = new FixtureBridgeClient({ reply: "hi there friend", chunkDelayMs: 10 });
    const store = createConversationsStore(client);

    await store.getState().send("hello");
    expect(store.getState().messages[0]).toMatchObject({ role: "user", text: "hello", streaming: false });

    await vi.advanceTimersByTimeAsync(300);
    const msgs = store.getState().messages;
    expect(msgs[1]).toMatchObject({ role: "momo", text: "hi there friend", streaming: false });
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- conversations`
Expected: FAIL — `Cannot find module './conversations'`.

- [ ] **Step 3: Write minimal implementation**

`src/renderer/stores/conversations.ts`:
```ts
import { createStore, type StoreApi } from "zustand/vanilla";
import type { BridgeClient } from "../bridge/client";
import { applyEvent, type RendererMessage } from "./message-model";

export interface ConversationsState {
  activeId: string;
  messages: RendererMessage[];
  send: (text: string) => Promise<void>;
}

export function createConversationsStore(client: BridgeClient): StoreApi<ConversationsState> {
  const store = createStore<ConversationsState>((set, get) => ({
    activeId: "conv-1",
    messages: [],
    send: async (text: string) => {
      const { messages, activeId } = get();
      const userMsg: RendererMessage = { id: `u${messages.length}`, role: "user", text, streaming: false };
      set({ messages: [...messages, userMsg] });
      await client.invoke("bridge:send", { conversationId: activeId, prompt: text });
    },
  }));

  client.subscribe("bridge:event", (event) => {
    store.setState((s) => ({ messages: applyEvent(s.messages, event) }));
  });

  return store;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- conversations`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/stores/conversations.ts src/renderer/stores/conversations.test.ts
git commit -m "feat(fe): conversations store with optimistic send + streamed reply"
```

---

### Task 5: Settings + notifications stores + greeting

**Files:**
- Create: `src/renderer/stores/settings.ts`, `src/renderer/stores/notifications.ts`, `src/renderer/stores/settings.test.ts`, `src/renderer/stores/notifications.test.ts`

**Interfaces:**
- Consumes: `import { createStore, type StoreApi } from "zustand/vanilla"`.
- Produces:
  - `function buildGreeting(hour: number, memory?: string): string`
  - `interface SettingsState { mode: "buddy" | "workbench"; persona: string }`, `function createSettingsStore(): StoreApi<SettingsState>`
  - `interface NotificationItem { id: string; text: string; read: boolean }`, `interface NotificationsState { items: NotificationItem[]; unreadCount: number }`, `function createNotificationsStore(items: NotificationItem[]): StoreApi<NotificationsState>`

- [ ] **Step 1: Write the failing tests**

`src/renderer/stores/settings.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildGreeting, createSettingsStore } from "./settings";

describe("buildGreeting", () => {
  it("varies by time of day", () => {
    expect(buildGreeting(8)).toContain("早");
    expect(buildGreeting(14)).toContain("下午");
    expect(buildGreeting(22)).toContain("晚");
  });
  it("weaves in a memory line when provided", () => {
    expect(buildGreeting(8, "第五章笔记整理完了")).toContain("第五章笔记整理完了");
  });
});

describe("settings store", () => {
  it("defaults to buddy mode", () => {
    expect(createSettingsStore().getState().mode).toBe("buddy");
  });
});
```

`src/renderer/stores/notifications.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createNotificationsStore } from "./notifications";

describe("notifications store", () => {
  it("unreadCount reflects unread items", () => {
    const store = createNotificationsStore([
      { id: "n1", text: "a", read: false },
      { id: "n2", text: "b", read: true },
    ]);
    expect(store.getState().unreadCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- settings notifications`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementations**

`src/renderer/stores/settings.ts`:
```ts
import { createStore, type StoreApi } from "zustand/vanilla";

/** momo's opening line: time-of-day tone + optional memory recall (02 §4.1). */
export function buildGreeting(hour: number, memory?: string): string {
  const tod = hour < 5 ? "夜里好" : hour < 11 ? "早呀" : hour < 18 ? "下午好" : "晚上好";
  const recall = memory ? `，昨晚帮你把${memory}` : "";
  return `${tod}${recall}。今天想从哪儿开始？`;
}

export interface SettingsState {
  mode: "buddy" | "workbench";
  persona: string;
}

export function createSettingsStore(): StoreApi<SettingsState> {
  return createStore<SettingsState>(() => ({ mode: "buddy", persona: "momo" }));
}
```

`src/renderer/stores/notifications.ts`:
```ts
import { createStore, type StoreApi } from "zustand/vanilla";

export interface NotificationItem {
  id: string;
  text: string;
  read: boolean;
}

export interface NotificationsState {
  items: NotificationItem[];
  unreadCount: number;
}

export function createNotificationsStore(items: NotificationItem[]): StoreApi<NotificationsState> {
  return createStore<NotificationsState>(() => ({
    items,
    unreadCount: items.filter((i) => !i.read).length,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- settings notifications`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/stores/settings.ts src/renderer/stores/notifications.ts src/renderer/stores/settings.test.ts src/renderer/stores/notifications.test.ts
git commit -m "feat(fe): settings+notifications stores and greeting builder"
```

---

### Task 6: Context, components, BuddyShell — the assembled skeleton

**Files:**
- Create: `src/renderer/bridge/context.tsx`, `src/renderer/components/momo/MomoAvatar.tsx`, `src/renderer/components/TopBar.tsx`, `src/renderer/components/Greeting.tsx`, `src/renderer/components/ChipRow.tsx`, `src/renderer/components/InputBox.tsx`, `src/renderer/components/LightArtifactCard.tsx`, `src/renderer/components/PinFootnote.tsx`, `src/renderer/components/HistoryDrawer.tsx`, `src/renderer/components/MessageList.tsx`, `src/renderer/components/BuddyShell.tsx`, `src/renderer/components/guard.test.ts`, `src/renderer/components/BuddyShell.test.tsx`
- Modify: `src/renderer/app/App.tsx` (stub → real)

**Interfaces:**
- Consumes: `createConversationsStore` (Task 4), `createSettingsStore`/`buildGreeting`/`createNotificationsStore` (Task 5), `FixtureBridgeClient` (Task 2), `FIXTURE_NOTIFICATIONS` (Task 2), `BridgeClient` (Task 2), `useStore` from `zustand`.
- Produces: `BridgeProvider` + hooks `useConversations`, `useSettings`, `useNotifications`; presentational components; `BuddyShell`. **No component imports `bridge/client` or `bridge/fixture-client` (guard test).** `BridgeProvider` accepts an optional `client` prop for tests.

**Visual note (skeleton vs dressing):** these components use MINIMAL layout styling (flex, spacing, `--leemo-*` tokens applied plainly) — no shadows, grain, halo, animation, or exact K3 spacing. Those are beat 2 (Kimi). The line: skeleton proves layout + wiring; dressing adds polish.

- [ ] **Step 1: Write the failing tests**

`src/renderer/components/guard.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".test.ts") ? [p] : [];
  });
}

describe("02 §2.1 铁律: components never touch the bridge port directly", () => {
  it("no component imports bridge/client or bridge/fixture-client", () => {
    const offenders = walk(path.resolve("src/renderer/components")).filter((f) =>
      /bridge\/(client|fixture-client)/.test(fs.readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
```

`src/renderer/components/BuddyShell.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BridgeProvider } from "../bridge/context";
import { FixtureBridgeClient } from "../bridge/fixture-client";
import BuddyShell from "./BuddyShell";

function renderBuddy(reply: string) {
  return render(
    <BridgeProvider client={new FixtureBridgeClient({ reply, chunkDelayMs: 5 })}>
      <BuddyShell />
    </BridgeProvider>,
  );
}

describe("BuddyShell", () => {
  it("shows momo's greeting on first paint", () => {
    renderBuddy("...");
    expect(screen.getByText(/今天想从哪儿开始/)).toBeInTheDocument();
  });

  it("typing and Enter shows the user bubble then streams momo's reply", async () => {
    renderBuddy("你好，我在");
    const input = screen.getByPlaceholderText("跟 momo 说点什么…");
    await userEvent.type(input, "在吗{Enter}");
    expect(screen.getByText("在吗")).toBeInTheDocument();
    expect(await screen.findByText("你好，我在")).toBeInTheDocument();
  });

  it("clicking the history button opens the drawer", async () => {
    renderBuddy("...");
    await userEvent.click(screen.getByLabelText("历史对话"));
    expect(screen.getByRole("search")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- BuddyShell guard`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the context + hooks**

`src/renderer/bridge/context.tsx`:
```tsx
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useStore } from "zustand";
import type { BridgeClient } from "./client";
import { FixtureBridgeClient } from "./fixture-client";
import { FIXTURE_NOTIFICATIONS } from "./fixtures";
import { createConversationsStore, type ConversationsState } from "../stores/conversations";
import { createSettingsStore, type SettingsState } from "../stores/settings";
import { createNotificationsStore, type NotificationsState } from "../stores/notifications";

interface BridgeStores {
  conversations: ReturnType<typeof createConversationsStore>;
  settings: ReturnType<typeof createSettingsStore>;
  notifications: ReturnType<typeof createNotificationsStore>;
}

const Ctx = createContext<BridgeStores | null>(null);

export function BridgeProvider({ client, children }: { client?: BridgeClient; children: ReactNode }) {
  const stores = useMemo<BridgeStores>(() => {
    const c = client ?? new FixtureBridgeClient();
    return {
      conversations: createConversationsStore(c),
      settings: createSettingsStore(),
      notifications: createNotificationsStore(FIXTURE_NOTIFICATIONS),
    };
  }, [client]);
  return <Ctx.Provider value={stores}>{children}</Ctx.Provider>;
}

function useStores(): BridgeStores {
  const s = useContext(Ctx);
  if (!s) throw new Error("BridgeProvider missing");
  return s;
}

export const useConversations = <T,>(sel: (s: ConversationsState) => T): T =>
  useStore(useStores().conversations, sel);
export const useSettings = <T,>(sel: (s: SettingsState) => T): T =>
  useStore(useStores().settings, sel);
export const useNotifications = <T,>(sel: (s: NotificationsState) => T): T =>
  useStore(useStores().notifications, sel);
```

- [ ] **Step 4: Write MomoAvatar (static face, no animation)**

`src/renderer/components/momo/MomoAvatar.tsx`:
```tsx
/** Static momo face transcribed from k3/buddy-mode.html. Breathing/blink/
 *  twinkle/halo are beat-2 (Kimi) additions. */
export default function MomoAvatar({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label="momo 的头像">
      <path
        d="M60 20C87 20 101 42 101 66c0 22-17 34-41 34s-41-12-41-34c0-24 14-46 41-46Z"
        style={{ fill: "var(--leemo-momo-body)", stroke: "var(--leemo-momo-line)", strokeWidth: 2.5 }}
      />
      <ellipse cx="45" cy="62" rx="4.8" ry="6.4" style={{ fill: "var(--leemo-momo-face)" }} />
      <ellipse cx="75" cy="62" rx="4.8" ry="6.4" style={{ fill: "var(--leemo-momo-face)" }} />
      <ellipse cx="32.5" cy="72.5" rx="5.6" ry="3.2" style={{ fill: "var(--leemo-momo-blush)", opacity: 0.55 }} />
      <ellipse cx="87.5" cy="72.5" rx="5.6" ry="3.2" style={{ fill: "var(--leemo-momo-blush)", opacity: 0.55 }} />
      <path
        d="M54 71.5c2 2.6 4 3.8 6 3.8s4-1.2 6-3.8"
        style={{ fill: "none", stroke: "var(--leemo-momo-face)", strokeWidth: 2.6, strokeLinecap: "round" }}
      />
    </svg>
  );
}
```

- [ ] **Step 5: Write the presentational components**

`src/renderer/components/TopBar.tsx`:
```tsx
import { useNotifications } from "../bridge/context";

export default function TopBar({ onOpenHistory }: { onOpenHistory: () => void }) {
  const unread = useNotifications((s) => s.unreadCount);
  return (
    <header className="flex items-center justify-between px-6 py-4">
      <button aria-label="历史对话" onClick={onOpenHistory} className="px-2 py-1">☰</button>
      <nav aria-label="模式切换" className="flex gap-2 text-sm">
        <span>🫧 搭子</span>
        <span className="opacity-40">⚏ 工作台</span>
      </nav>
      <button aria-label={`通知，${unread} 条未读`} className="relative px-2 py-1">
        🔔{unread > 0 && <span className="absolute right-0 top-0 h-2 w-2 rounded-full" style={{ background: "var(--leemo-danger)" }} />}
      </button>
    </header>
  );
}
```

`src/renderer/components/Greeting.tsx`:
```tsx
import MomoAvatar from "./momo/MomoAvatar";
import { useSettings } from "../bridge/context";
import { buildGreeting } from "../stores/settings";

export default function Greeting({ hour, memory }: { hour: number; memory?: string }) {
  const persona = useSettings((s) => s.persona);
  return (
    <div className="flex flex-col items-center gap-4 py-8">
      <MomoAvatar size={96} />
      <h1 className="max-w-[600px] text-center text-xl leading-relaxed" data-persona={persona}>
        {buildGreeting(hour, memory)}
      </h1>
    </div>
  );
}
```

`src/renderer/components/ChipRow.tsx`:
```tsx
const CHIPS = ["帮我规划今天", "继续昨天的复习", "随便聊聊"];

export default function ChipRow({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-wrap justify-center gap-2 py-3">
      {CHIPS.map((c) => (
        <button key={c} onClick={() => onPick(c)} className="rounded-full border px-3 py-1 text-sm"
          style={{ borderColor: "var(--leemo-line)" }}>
          {c}
        </button>
      ))}
    </div>
  );
}
```

`src/renderer/components/InputBox.tsx`:
```tsx
import { useState } from "react";

export default function InputBox({
  value, onChange, onSend,
}: { value: string; onChange: (v: string) => void; onSend: (v: string) => void }) {
  const [composing, setComposing] = useState(false);
  const submit = () => {
    const t = value.trim();
    if (t) { onSend(t); onChange(""); }
  };
  return (
    <div className="mx-auto flex w-full max-w-[640px] items-center gap-3 rounded-[24px] border px-5 py-3"
      style={{ borderColor: "var(--leemo-line)", background: "#fff" }}>
      <input
        aria-label="跟 momo 说点什么"
        placeholder="跟 momo 说点什么…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onKeyDown={(e) => { if (e.key === "Enter" && !composing) { e.preventDefault(); submit(); } }}
        className="w-full bg-transparent outline-none"
      />
      <button aria-label="发送" onClick={submit} className="rounded-full px-3 py-2"
        style={{ background: "var(--leemo-amber)", color: "#fff" }}>↑</button>
    </div>
  );
}
```

`src/renderer/components/LightArtifactCard.tsx`:
```tsx
export default function LightArtifactCard({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mx-auto flex w-full max-w-[430px] items-center gap-3 rounded-2xl border px-4 py-3"
      style={{ borderColor: "var(--leemo-line)", background: "var(--leemo-card)" }}>
      <span aria-hidden>📄</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block text-xs" style={{ color: "var(--leemo-ink-3)" }}>{subtitle}</span>
      </span>
    </div>
  );
}
```

`src/renderer/components/PinFootnote.tsx`:
```tsx
export default function PinFootnote({ text }: { text: string }) {
  return <p className="py-3 text-center text-xs" style={{ color: "var(--leemo-ink-3)" }}>📌 {text}</p>;
}
```

`src/renderer/components/HistoryDrawer.tsx`:
```tsx
import { useState } from "react";

const FIXTURE_CONVERSATIONS = ["第五章复习笔记整理", "社团招新的推文文案", "周五晚上看什么电影"];

export default function HistoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  if (!open) return null;
  const list = FIXTURE_CONVERSATIONS.filter((c) => c.includes(q));
  return (
    <>
      <div onClick={onClose} className="fixed inset-0" style={{ background: "rgba(0,0,0,.2)" }} />
      <aside className="fixed left-0 top-0 h-full w-[320px] p-4" style={{ background: "var(--leemo-bg-deep)" }}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
        <input role="search" aria-label="搜索对话" placeholder="搜索…" value={q}
          onChange={(e) => setQ(e.target.value)} className="mb-3 w-full rounded border px-2 py-1"
          style={{ borderColor: "var(--leemo-line)" }} />
        <ul className="space-y-1">
          {list.map((c) => <li key={c} className="truncate rounded px-2 py-1 text-sm">{c}</li>)}
        </ul>
        <button className="mt-4 text-sm" style={{ color: "var(--leemo-ink-2)" }}>⚙ 设置</button>
      </aside>
    </>
  );
}
```

`src/renderer/components/MessageList.tsx`:
```tsx
import MomoAvatar from "./momo/MomoAvatar";
import { useConversations } from "../bridge/context";

export default function MessageList() {
  const messages = useConversations((s) => s.messages);
  if (messages.length === 0) return null;
  return (
    <div className="mx-auto w-full max-w-[720px] space-y-3 py-4">
      {messages.map((m) =>
        m.role === "user" ? (
          <div key={m.id} className="flex justify-end">
            <div className="rounded-[10px] px-3 py-2 text-sm" style={{ background: "var(--leemo-bg-deep)" }}>{m.text}</div>
          </div>
        ) : (
          <div key={m.id} className="flex items-start gap-2">
            <MomoAvatar size={26} />
            <p className="text-sm leading-relaxed">
              {m.text}
              {m.streaming && <span aria-hidden>▍</span>}
            </p>
          </div>
        ),
      )}
    </div>
  );
}
```

`src/renderer/components/BuddyShell.tsx`:
```tsx
import { useState } from "react";
import TopBar from "./TopBar";
import Greeting from "./Greeting";
import ChipRow from "./ChipRow";
import InputBox from "./InputBox";
import LightArtifactCard from "./LightArtifactCard";
import PinFootnote from "./PinFootnote";
import HistoryDrawer from "./HistoryDrawer";
import MessageList from "./MessageList";
import { useConversations } from "../bridge/context";

export default function BuddyShell() {
  const [draft, setDraft] = useState("");
  const [drawer, setDrawer] = useState(false);
  const send = useConversations((s) => s.send);
  const hasMessages = useConversations((s) => s.messages.length > 0);

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar onOpenHistory={() => setDrawer(true)} />
      <main className="flex flex-1 flex-col px-6">
        {hasMessages ? (
          <MessageList />
        ) : (
          <>
            <Greeting hour={new Date().getHours()} memory="《数据结构》第五章的笔记整理完了" />
            <LightArtifactCard title="第五章 · 树与二叉树" subtitle="复习笔记 · 6 页 · 昨晚整理完成" />
          </>
        )}
        <div className="mt-auto pb-8">
          <ChipRow onPick={setDraft} />
          <InputBox value={draft} onChange={setDraft} onSend={(t) => void send(t)} />
          <PinFootnote text="周六 23:59 ·《高等数学》第五章作业截止 —— 到时候我提醒你" />
        </div>
      </main>
      <HistoryDrawer open={drawer} onClose={() => setDrawer(false)} />
    </div>
  );
}
```

- [ ] **Step 6: Wire the real App**

Replace `src/renderer/app/App.tsx`:
```tsx
import { BridgeProvider } from "../bridge/context";
import BuddyShell from "../components/BuddyShell";

export default function App() {
  return (
    <BridgeProvider>
      <BuddyShell />
    </BridgeProvider>
  );
}
```
Then update `src/renderer/app/App.test.tsx` to assert the greeting instead of the old stub text:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders the buddy shell greeting", () => {
    render(<App />);
    expect(screen.getByText(/今天想从哪儿开始/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run the full renderer suite + guard**

Run: `npm test -- --project renderer`
Expected: PASS — guard test (no offenders), BuddyShell (greeting / send-stream / drawer), App greeting, plus Tasks 2–5 suites.

- [ ] **Step 8: Run the whole test suite + 3-way typecheck**

Run: `npm test && npm run typecheck`
Expected: node project (215) green, renderer project green; three `tsc` exit 0.

- [ ] **Step 9: Manual smoke (skeleton acceptance ①)**

Run: `npm run dev`
Expected: buddy landing renders — static momo face, greeting, chips, input, artifact card, pin footnote. Type text + Enter → user bubble appears, momo reply streams in word-by-word with a caret. ☰ opens the drawer; overlay click closes it. (Plain visuals — polish is beat 2.)

- [ ] **Step 10: Commit**

```bash
git add src/renderer/bridge/context.tsx src/renderer/components src/renderer/app/App.tsx src/renderer/app/App.test.tsx
git commit -m "feat(fe): assembled buddy shell skeleton (context, components, live send loop)"
```

---

## Beat 2 handoff (NOT part of this plan)

After this skeleton is green and you (user) have eyeballed acceptance ①, a **separate K3 dressing card** (`docs/handoffs/`) hands these components + `docs/design-audition/k3/buddy-mode.html` to headless `kimi -p`. Kimi adds visual polish ONLY (grain/halo/breathing/blink/twinkle, shadows, exact spacing, chip hover, rounded refinement, morning-light gradient) — **no structural or store/props change**. Then integrate + re-run `npm test` (must stay green) → user eyeballs acceptance ② against the K3 baseline. That card is written when we reach it, per the 4-beat loop.

## Self-Review notes

- **Spec coverage (slice-1 scope of `2026-07-22-frontend-shell-slice.md`):** F0 toolchain (Task 1) ✓; token layer (Task 1) ✓; fixture BridgeClient port (Task 2) ✓; 3 stores + normalization (Tasks 3–5) ✓; buddy landing components + live text loop (Task 6) ✓; guard test for 铁律 (Task 6) ✓; usage footnote / non-text cards / real IPC explicitly deferred ✓. Viz kit CSS trimmed to slice 4 (documented). 215-green + 3-way-typecheck acceptance encoded in Tasks 1/6.
- **Placeholder scan:** none — every step ships real code/commands.
- **Type consistency:** `RendererMessage`, `ConversationsState`, `BridgeClient`, `FixtureBridgeClient(opts)`, `applyEvent`, `buildGreeting`, `create*Store` names are used identically across Tasks 2–6. `run.finished`/`usage.final`/`tool.started` payloads match `src/bridge/events.ts` exactly.
