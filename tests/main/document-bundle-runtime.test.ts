import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

type BundledDocumentEngine = typeof import("../../src/host/document-engine");

const root = path.resolve(__dirname, "..", "..");
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-document-runtime-"));
const bundlePath = path.join(temporaryDirectory, "document-engine.mjs");
let engine: BundledDocumentEngine;
const require = createRequire(import.meta.url);
const electronPath = require("electron") as string;

interface RuntimeProbe {
  ok: boolean;
  text?: string;
  message?: string;
  cause?: string;
}

function editWithElectron(sourcePath: string, outputPath: string): RuntimeProbe {
  const moduleUrl = pathToFileURL(bundlePath).href;
  const script = `
    const fs = await import("node:fs/promises");
    const engine = await import(${JSON.stringify(moduleUrl)});
    try {
      const source = await fs.readFile(${JSON.stringify(sourcePath)});
      const edited = engine.editDocxTextBuffer(source, [{ find: "三次", replace: "五次" }]);
      await engine.writeDocumentAtomically(${JSON.stringify(outputPath)}, edited.buffer);
      const result = await engine.readDocumentFile(${JSON.stringify(outputPath)});
      process.stdout.write("\\nLEEMO_DOCUMENT_PROBE=" + JSON.stringify({ ok: true, text: result.text }));
    } catch (error) {
      process.stdout.write("\\nLEEMO_DOCUMENT_PROBE=" + JSON.stringify({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        cause: error instanceof Error && error.cause
          ? (error.cause instanceof Error ? error.cause.stack || error.cause.message : String(error.cause))
          : undefined,
      }));
      process.exitCode = 1;
    }
  `;
  const run = spawnSync(electronPath, ["--input-type=module", "--eval", script], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  const marker = `${run.stdout ?? ""}`.split("LEEMO_DOCUMENT_PROBE=").at(-1);
  if (!marker) {
    throw new Error(`Electron Word 修改探针没有回执：${run.stderr || run.stdout || run.error?.message || run.status}`);
  }
  return JSON.parse(marker) as RuntimeProbe;
}

function simplePdf(text: string): Buffer {
  const escaped = text.replace(/([\\()])/g, "\\$1");
  const stream = `BT /F1 16 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let output = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, "binary");
}

beforeAll(async () => {
  await build({
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    packages: "bundle",
    entryPoints: [path.join(root, "src", "host", "document-engine.ts")],
    outfile: bundlePath,
    sourcemap: false,
    logLevel: "silent",
  });
  engine = await import(`${pathToFileURL(bundlePath).href}?test=${Date.now()}`) as BundledDocumentEngine;
}, 30_000);

afterAll(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

function readWithElectron(filePath: string): RuntimeProbe {
  const moduleUrl = pathToFileURL(bundlePath).href;
  const script = `
    const engine = await import(${JSON.stringify(moduleUrl)});
    try {
      const result = await engine.readDocumentFile(${JSON.stringify(filePath)});
      process.stdout.write("\\nLEEMO_DOCUMENT_PROBE=" + JSON.stringify({ ok: true, text: result.text }));
    } catch (error) {
      process.stdout.write("\\nLEEMO_DOCUMENT_PROBE=" + JSON.stringify({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        cause: error instanceof Error && error.cause
          ? (error.cause instanceof Error ? error.cause.stack || error.cause.message : String(error.cause))
          : undefined,
      }));
      process.exitCode = 1;
    }
  `;
  const run = spawnSync(electronPath, ["--input-type=module", "--eval", script], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  const marker = `${run.stdout ?? ""}`.split("LEEMO_DOCUMENT_PROBE=").at(-1);
  if (!marker) {
    throw new Error(`Electron 文档探针没有回执：${run.stderr || run.stdout || run.error?.message || run.status}`);
  }
  return JSON.parse(marker) as RuntimeProbe;
}

describe("bundled document-engine runtime", () => {
  it("creates and reads a Word document after its dependencies are bundled", async () => {
    const buffer = await engine.createDocxBuffer({
      title: "英语周报",
      sections: [{ heading: "进展", paragraphs: ["完成三次写作练习。"] }],
    });

    const filePath = path.join(temporaryDirectory, "英语周报.docx");
    fs.writeFileSync(filePath, buffer);
    const result = readWithElectron(filePath);

    expect(result, result.cause ?? result.message).toMatchObject({ ok: true });
    expect(result.text).toContain("完成三次写作练习");
  });

  it("reads a PDF after its dependencies are bundled", async () => {
    const filePath = path.join(temporaryDirectory, "材料.pdf");
    fs.writeFileSync(filePath, simplePdf("LEEMO_PDF_BUNDLE_CONTENT"));
    const result = readWithElectron(filePath);

    expect(result, result.cause ?? result.message).toMatchObject({ ok: true });
    expect(result.text).toContain("LEEMO_PDF_BUNDLE_CONTENT");
  });

  it("edits a Word copy in Electron after the document engine is bundled", async () => {
    const sourcePath = path.join(temporaryDirectory, "英语周报-原稿.docx");
    const outputPath = path.join(temporaryDirectory, "英语周报-修改版.docx");
    const source = await engine.createDocxBuffer({
      title: "英语周报",
      sections: [{ heading: "进展", paragraphs: ["完成三次写作练习。"] }],
    });
    fs.writeFileSync(sourcePath, source);

    const result = editWithElectron(sourcePath, outputPath);

    expect(result, result.cause ?? result.message).toMatchObject({ ok: true });
    expect(result.text).toContain("完成五次写作练习");
    expect(fs.readFileSync(sourcePath)).toEqual(source);
    expect(fs.existsSync(outputPath)).toBe(true);
  });
});
