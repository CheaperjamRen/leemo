import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BridgeClient } from "../../bridge/client";
import { BridgeClientContext } from "../../bridge/context";
import BrowserCapturePreview from "./BrowserCapturePreview";

describe("BrowserCapturePreview", () => {
  it("loads screenshot bytes on demand without storing them in the timeline item", async () => {
    const invoke = vi.fn(async () => ({ mimeType: "image/png", dataBase64: "cG5n" })) as BridgeClient["invoke"];
    const client: BridgeClient = { invoke, subscribe: vi.fn(() => () => {}) };
    render(
      <BridgeClientContext.Provider value={client}>
        <BrowserCapturePreview capture={{ id: "page-proof.png", mimeType: "image/png" }} />
      </BridgeClientContext.Provider>,
    );

    expect(await screen.findByRole("img", { name: "浏览器截图" })).toHaveAttribute(
      "src",
      "data:image/png;base64,cG5n",
    );
    expect(invoke).toHaveBeenCalledWith("bridge:readBrowserCapture", { id: "page-proof.png" });
  });
});
