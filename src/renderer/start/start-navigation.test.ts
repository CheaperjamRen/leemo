import { describe, expect, it } from "vitest";
import { START_NAVIGATION, isStartDestination } from "./start-navigation";

describe("Start navigation", () => {
  it("keeps the approved stable information architecture and reserves overview as a card route", () => {
    expect(START_NAVIGATION.map((item) => item.id)).toEqual([
      "home", "inbox", "tasks", "pinned", "recent",
      "locations", "documents", "archive", "trash",
    ]);
    expect(isStartDestination("overview")).toBe(true);
    expect(START_NAVIGATION.map((item) => item.id)).not.toContain("overview");
  });
});
