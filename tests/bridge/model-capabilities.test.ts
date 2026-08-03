import { describe, expect, it } from "vitest";
import {
  resolveCapabilityDisplay,
  setUserCapabilitySupported,
  clearUserCapabilityOverride,
  mergeCapabilityProbeResults,
  type CapabilityEvidence,
} from "../../src/bridge/model-capabilities";

describe("model capability evidence", () => {
  it("lets an explicit user confirmation override an automatic failed probe", () => {
    const automatic: CapabilityEvidence = {
      probe: { status: "failed", checkedAt: 100, detail: "本次图片请求被拒绝" },
    };

    const confirmed = setUserCapabilitySupported(automatic, 200);

    expect(resolveCapabilityDisplay(confirmed, false)).toEqual({
      status: "verified",
      source: "user",
    });
    expect(confirmed.probe).toEqual(automatic.probe);
  });

  it("returns to the latest automatic result when the user restores automatic judgment", () => {
    const confirmed = setUserCapabilitySupported({
      probe: { status: "failed", checkedAt: 100 },
    }, 200);

    const automatic = clearUserCapabilityOverride(confirmed);

    expect(resolveCapabilityDisplay(automatic, true)).toEqual({
      status: "failed",
      source: "probe",
    });
    expect(automatic.probe).toEqual({ status: "failed", checkedAt: 100 });
  });

  it("treats preset metadata as an unverified hint", () => {
    expect(resolveCapabilityDisplay(undefined, true)).toEqual({
      status: "unknown",
      source: "preset",
      hint: true,
    });
    expect(resolveCapabilityDisplay(undefined, false)).toEqual({
      status: "unknown",
      source: "preset",
      hint: false,
    });
  });

  it("keeps missing evidence unknown", () => {
    expect(resolveCapabilityDisplay(undefined, undefined)).toEqual({
      status: "unknown",
      source: "none",
    });
  });

  it("merges fresh probes without erasing a user correction or mutating saved evidence", () => {
    const current = {
      "vision-model": {
        image: {
          probe: { status: "failed" as const, checkedAt: 100 },
          userOverride: { supported: true as const, updatedAt: 200 },
        },
      },
    };

    const merged = mergeCapabilityProbeResults(current, "vision-model", {
      image: { status: "verified", checkedAt: 300 },
      reasoning: { status: "failed", checkedAt: 300, detail: "未返回可验证的思考信号" },
    });

    expect(merged["vision-model"]).toEqual({
      image: {
        probe: { status: "verified", checkedAt: 300 },
        userOverride: { supported: true, updatedAt: 200 },
      },
      reasoning: {
        probe: { status: "failed", checkedAt: 300, detail: "未返回可验证的思考信号" },
      },
    });
    expect(current["vision-model"].image.probe).toEqual({ status: "failed", checkedAt: 100 });
  });
});
