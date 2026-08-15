# Batch 0d FixtureBridgeClient report

- Baseline alignment: clean worktree fast-forwarded to `28921be`; applied `E:\Leemo\.claude\batch0a-reviewed.patch`.
- Baseline reproduction: 41 files / 306 tests passed; all three typecheck projects passed.
- RED: the four Opus 0d review repair tests were added first and reproduced 4 failures: deny/malformed approval did not fail closed, duplicate send was accepted, provider snapshots were shallow, and an immediate interrupt lost the later `conversation.started`.
- GREEN: fixture target suite 15/15 passed after the terminal re-entry repair; full suite 41 files / 316 tests passed; `npm run typecheck` passed (vendor, main, renderer); `git diff --check` passed.

## Implemented cases

- `bridge:createConversation`: unique `conv-N` ids; records optional `purpose` metadata.
- `bridge:send`: validates active cid, rejects a second send while the same cid is running with stable `Conversation already running: <cid>`, and allows sends after terminal completion.
- `bridge:interrupt`: cancels only target cid timers, emits one interrupted finish, repeated calls are idempotent.
- `bridge:setModel`: validates cid and updates fixture metadata.
- `bridge:disposeConversation`: cancels and disposes only target cid; later operations reject.
- `bridge:listProviders`: returns a key-free, deeply defensive provider snapshot, including `modelCapabilities` per-model records.
- `bridge:fetchBalance`: safe unsupported fixture response; no network.
- `bridge:usageSummary`: explicit safe empty reserved response.
- `bridge:listWhitelist` / `bridge:revokeWhitelist`: defensive copy and exact `(toolName,risk)` deletion.
- `bridge:approvalDecision` / `bridge:askUserAnswer`: strict waiter kind/id matching; deny and malformed runtime approval tiers fail closed with exactly one denied finish and cleared timers; accepted allow replies schedule a 300ms continuation; unknown, duplicate, and wrong-kind replies reject.
- Runtime unknown channels reject instead of silently returning `undefined`.
- `conversation.started` is marked started only at emission, so an immediate interrupt before its timer does not poison a later send; each cid still emits it at most once.
- Terminal demo lifecycle state is cleared before emitting `run.finished:success`, so synchronous terminal listeners may immediately start the next turn.

The default demo contains text/thinking/plan/tool/subagent/compact/usage/result, one visualization tool event using the fixture constant, one approval request, and one ask-user request. Custom `reply` mode remains a simple text stream and does not inject interaction cards.

## Boundary and concerns

Only `src/renderer/bridge/fixture-client.ts`, `src/renderer/bridge/fixture-client.test.ts`, `src/renderer/bridge/fixtures/index.ts`, and this report were changed by Batch 0d. No B1/B2/B3, conversations, context, components, Bridge contract, smoke, or gateway files were modified by this batch. No commit or push was performed.

The follow-up RED reproduced one additional Important failure: a synchronous `bridge:send` from the default demo's success `run.finished` listener rejected with `Conversation already running`. The follow-up GREEN passes after clearing `running` before terminal emission.

One implementation concern for review: the contract's `ApprovalDecision`/`AskUserAnswer` shapes do not carry `conversationId`; waiter matching therefore uses request id as the primary route and defensively accepts an optional runtime `conversationId` if supplied by a caller. The fixture never routes a valid reply to another cid.
