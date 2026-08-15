# Batch 0b / B1 — approvals + context usage stores report

## BASE and baseline recovery

- Worktree: `E:/Leemo/.claude/worktrees/agent-a93d64de94e61ef58`
- Initial worktree HEAD: `2ce18e5`; it was a clean ancestor of the requested Batch 0a baseline `28921be`.
- Recovery used only `git merge --ff-only 28921be` (no reset, stash, clean, checkout, or overwrite).
- `git apply --check E:/Leemo/.claude/batch0a-reviewed.patch` passed, then the reviewed patch was applied forward.
- Baseline verification: `npm test -- --run` → **41 files / 306 tests passed**.
- The reviewed patch's pre-existing files remain outside this card's ownership and were not edited by B1.

## Strict TDD evidence

### RED

Tests were written first in:

- `src/renderer/stores/approvals.test.ts`
- `src/renderer/stores/context-usage.test.ts`

RED command:

```text
npm test -- src/renderer/stores/approvals.test.ts --run
```

Result: failed before running tests (`0 test`), with Vite's expected missing-module error: `Failed to resolve import "./approvals"`. The implementation files did not exist at that point.

### Repair RED/GREEN

The requested deferred `bridge:askUserAnswer` race regression was run against the existing implementation first. It produced a real RED: a rejected old question restored over the newer question's optimistic resolution (`expected null`, received `old-question`). The requested whitelist mutation regression was then run against the shallow array-copy implementation and also produced a real RED: `whitelist[0]` was the exact Bridge-returned object.

Minimal repairs added latest-flight identity gating for rollback and per-entry whitelist cloning. The focused command then passed:

```text
npm test -- src/renderer/stores/approvals.test.ts src/renderer/stores/context-usage.test.ts --run
```

Result: **2 files / 19 tests passed**.

Coverage includes the deferred `bridge:askUserAnswer` rejection race with newer pending replacement and cancellation-safe optimistic removal/notification, plus defensive cloning of each refreshed whitelist object.

## Implemented behavior

### approvals

`src/renderer/stores/approvals.ts` contains only pure data folds plus an injected `BridgeClient` store factory:

- `foldApprovalRequest` and `foldAskUser` use payload `conversationId`, externally supplied renderer `runId`, and supplied timestamp; no active conversation or module-global run id is read.
- One pending interaction per conversation; replacing a pending card archives the old card as approval `outcome: "cancelled"` or question `items: null`.
- `decide` and `answer` precisely match interaction kind and id, optimistically move the card to `resolvedByRun` before invoke, and preserve successful audit entries.
- Bridge rejection removes the optimistic entry, restores only when the exact slot is still empty, the flight is not cancelled, and it remains the latest flight for that conversation; it calls `notifyError` once with a fixed safe message and rethrows the original rejection.
- `cancelForConversation` is idempotent and marks in-flight replies before archiving/clearing pending state, so a late rejection cannot resurrect stale cards.
- Whitelist refresh atomically replaces the mirror only after a successful `bridge:listWhitelist` call and clones every returned entry. Revoke sends the exact `{toolName, risk}` pair and refreshes only after success; rejection leaves the mirror untouched.

### context usage

`src/renderer/stores/context-usage.ts` exports `CONTEXT_COMPACT_THRESHOLD = 21_000`, the plain store factory, and the pure `foldContextUsage` reducer:

- `usage.final` computes `inputTokens + cacheReadTokens + cacheCreationTokens`; `outputTokens` is excluded.
- `compact.boundary` uses `postTokens ?? preTokens`, preserving an explicit zero, and sets `justCompacted`.
- Other events are exact no-ops and do not create unknown conversation entries; A/B entries remain isolated.
- `justCompacted` is intentionally not timer-cleared here. The 0c/Batch 2a composition/UI layer must provide a safe explicit clear path (store action or `StoreApi.setState`) for the 600ms visual lifecycle.

## Verification

```text
npm test -- src/renderer/stores/approvals.test.ts src/renderer/stores/context-usage.test.ts --run
# 2 files / 19 tests passed

npm test -- --run
# 43 files / 325 tests passed

npm run typecheck
# vendor, root, and renderer tsc all exit 0

git diff --check
# pass; Git emitted only an unrelated LF→CRLF working-copy warning for the
# pre-existing tests/gateway snapshot path
```

## Scope and concerns

B1 added/owns exactly these four source/test files plus this report:

- `src/renderer/stores/approvals.ts`
- `src/renderer/stores/approvals.test.ts`
- `src/renderer/stores/context-usage.ts`
- `src/renderer/stores/context-usage.test.ts`
- `docs/sdd/fe-b0b1-approvals-context-report.md`

No subscription is installed by either store. Batch 0c must route `bridge:approvalRequest`, `bridge:askUser`, and envelope events into these pure folds, supply non-null run ids from `conversations.runIds[cid]`, and own unsubscribe/cleanup. It must also wire `notifyError` to notifications without importing that store here. The context usage clear seam is intentionally pending 0c/Batch 2a as stated above.

No keys, secrets, commits, pushes, dependency changes, bridge changes, fixture changes, conversation changes, component changes, smoke changes, or configuration changes were made by B1.
