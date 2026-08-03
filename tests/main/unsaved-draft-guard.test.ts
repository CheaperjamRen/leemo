import { describe, expect, it, vi } from "vitest";
import { attachUnsavedDraftGuard } from "../../src/main/unsaved-draft-guard";

describe("attachUnsavedDraftGuard", () => {
  it("keeps the window open when the user wants to continue editing", () => {
    let handler!: (event: { preventDefault(): void }) => void;
    const webContents = {
      on: vi.fn((_name: string, listener: typeof handler) => { handler = listener; }),
    };
    const event = { preventDefault: vi.fn() };
    attachUnsavedDraftGuard(webContents, () => false);

    expect(webContents.on).toHaveBeenCalledWith("will-prevent-unload", expect.any(Function));

    handler(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("allows the pending unload only after explicit discard confirmation", () => {
    let handler!: (event: { preventDefault(): void }) => void;
    const webContents = {
      on: vi.fn((_name: string, listener: typeof handler) => { handler = listener; }),
    };
    const event = { preventDefault: vi.fn() };
    attachUnsavedDraftGuard(webContents, () => true);

    handler(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });
});
