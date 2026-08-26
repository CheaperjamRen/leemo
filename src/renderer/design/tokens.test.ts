import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve("src", "renderer", "design", "tokens.css"), "utf8");
const workbenchSource = readFileSync(path.resolve("src", "renderer", "design", "workbench.css"), "utf8");
const settingsSource = readFileSync(path.resolve("src", "renderer", "pages", "SettingsPage.css"), "utf8");
const overlaysSource = readFileSync(path.resolve("src", "renderer", "components", "AppOverlays.tsx"), "utf8");

function scopedDeclarations(selectorStart: string, selectorEnd: string): Map<string, string> {
  const start = source.indexOf(selectorStart);
  const end = source.indexOf(selectorEnd, start + selectorStart.length);
  if (start < 0 || end < 0) throw new Error(`Missing token scope: ${selectorStart}`);
  const scope = source.slice(start, end);
  return new Map(
    [...scope.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]),
  );
}

describe("Leemo shell color roles", () => {
  it("declares the approved C theme as the default and keeps A/B as selectable palettes", () => {
    expect(source).toContain('--leemo-theme-default: "white-copper";');
    for (const theme of ["white-copper", "warm-copper", "white-indigo"]) {
      expect(source).toContain(`[data-theme="${theme}"]`);
    }
  });

  it("uses the selected C palette for the default white work area", () => {
    const rootPalette = source.slice(source.indexOf(":root {"), source.indexOf("/* Layer 2:"));
    expect(rootPalette).toContain("--leemo-palette-canvas: #FBFCFD;");
    expect(rootPalette).toContain("--leemo-palette-ink-navy: #193B4B;");
    expect(rootPalette).toContain("--leemo-palette-amber-copper: #C65F2C;");
    expect(rootPalette).toContain("--leemo-palette-accent-accessible: #B95124;");
  });

  it("keeps overlays on the same neutral Sand temperature as product shells", () => {
    const rootSurfaceBlock = scopedDeclarations(
      "  /* Surface levels.",
      "/* Layer 3:",
    );

    expect(Object.fromEntries(rootSurfaceBlock)).toMatchObject({
      "--leemo-surface-default": "var(--leemo-palette-surface-default)",
      "--leemo-surface-sunken": "var(--leemo-palette-surface-sunken)",
      "--leemo-surface-raised": "var(--leemo-palette-surface-raised)",
      "--leemo-surface-overlay": "var(--leemo-palette-surface-overlay)",
      "--leemo-surface-accent-raised": "var(--leemo-palette-surface-accent-raised)",
    });
  });

  it("gives inverse tooltips theme-aware surface and text roles", () => {
    expect(source).toContain("--leemo-surface-inverse: var(--leemo-palette-ink-navy);");
    expect(source).toContain("--leemo-text-on-inverse: var(--leemo-palette-white);");
    expect(source).toContain("--leemo-text-on-inverse-muted:");
  });

  it("uses one warm-white role system for Start and Workbench", () => {
    const roles = scopedDeclarations(
      '[data-shell="workbench"],',
      '[data-shell="buddy"]',
    );

    expect(Object.fromEntries(roles)).toMatchObject({
      "--leemo-shell-canvas": "var(--leemo-palette-shell-canvas)",
      "--leemo-shell-card": "var(--leemo-palette-shell-card)",
      "--leemo-shell-panel": "var(--leemo-palette-shell-panel)",
      "--leemo-shell-side": "var(--leemo-palette-shell-side)",
      "--leemo-shell-side-hover": "var(--leemo-palette-shell-side-hover)",
      "--leemo-shell-hover": "var(--leemo-palette-shell-hover)",
      "--leemo-workbench-active": "var(--leemo-palette-workbench-active)",
      "--leemo-line": "var(--leemo-palette-line)",
      "--leemo-ink": "var(--leemo-palette-ink-navy)",
      "--leemo-ink-3": "var(--leemo-palette-text-tertiary)",
      "--leemo-surface-default": "var(--leemo-palette-surface-default)",
      "--leemo-surface-sunken": "var(--leemo-palette-surface-sunken)",
      "--leemo-amber": "var(--leemo-palette-amber-copper)",
    });
  });

  it("maps shell roles through palette tokens instead of hard-coded colors", () => {
    const shellScope = source.slice(
      source.indexOf('[data-shell="workbench"],'),
      source.indexOf('[data-shell="buddy"]'),
    );
    expect(shellScope).toContain("--leemo-shell-canvas: var(--leemo-palette-shell-canvas);");
    expect(shellScope).toContain("--leemo-workbench-active: var(--leemo-palette-workbench-active);");
    expect(shellScope).not.toMatch(/--leemo-shell-(canvas|card|panel|side):\s*#/);
  });

  it("keeps Settings on semantic surface levels instead of a yellow-paper palette", () => {
    for (const staleColor of ["#f7f3e9", "#f1ecdf", "#fbf8f0", "#f3eee2", "#fffdfa", "#f3f3ee"]) {
      expect(settingsSource.toLowerCase()).not.toContain(staleColor);
    }
    expect(settingsSource).toContain("var(--leemo-surface-overlay)");
    expect(settingsSource).toContain("var(--leemo-surface-sunken)");
    expect(overlaysSource).toContain("bg-[var(--leemo-surface-overlay)]");
  });

  it("keeps Buddy on the existing brand-oat inputs instead of inheriting Workbench", () => {
    const roles = scopedDeclarations(
      '[data-shell="buddy"]',
      "/* Compatibility aliases.",
    );

    expect(Object.fromEntries(roles)).toMatchObject({
      "--leemo-shell-canvas": "var(--leemo-surface-brand-oat)",
      "--leemo-shell-card": "var(--leemo-surface-brand-ivory)",
      "--leemo-shell-hover": "var(--leemo-action-accent-soft)",
    });
  });

  it("keeps the Workbench canvas flat instead of tinting it with gray-green decoration", () => {
    const shellRule = workbenchSource.match(/\[data-shell="workbench"\]\s*\{([\s\S]*?)\}/)?.[1];

    expect(shellRule).toContain("background: var(--leemo-bg)");
    expect(shellRule).not.toContain("radial-gradient");
  });
});
