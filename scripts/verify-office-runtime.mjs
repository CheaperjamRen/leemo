import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { listPackage } from "@electron/asar";
import { Document, HeadingLevel, Packer, Paragraph } from "docx";
import PptxGenJS from "pptxgenjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = path.join(ROOT, "bundled-skills", "office", "release", "skills");
const PACKAGE_ASAR = path.join(ROOT, "dist-package", "win-unpacked", "resources", "app.asar");
const requiredSkills = ["docx", "xlsx", "pptx", "pdf"];
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-office-runtime-"));
const productEnv = {
  ...process.env,
  PYTHONDONTWRITEBYTECODE: "1",
  PYTHONUTF8: "1",
  PYTHONIOENCODING: "utf-8",
  PATH: (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter((entry) => !entry.toLowerCase().includes("codex-runtimes"))
    .join(path.delimiter),
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? tempRoot,
    env: options.env ?? productEnv,
    encoding: "utf8",
    timeout: options.timeout ?? 30_000,
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    exitCode: result.status,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
    error: result.error?.message,
  };
}

function firstLine(result) {
  return (result.stderr || result.stdout || result.error || "").split(/\r?\n/, 1)[0];
}

function diagnostic(result) {
  const value = [result.stdout, result.stderr, result.error].filter(Boolean).join("\n").trim();
  return value ? value.slice(0, 2_000) : "ok";
}

function commandPath(name) {
  const result = run("where.exe", [name]);
  return result.ok ? result.stdout.split(/\r?\n/, 1)[0] : null;
}

function pythonModules(names) {
  const source = [
    "import importlib.util,json",
    `names=${JSON.stringify(names)}`,
    "print(json.dumps({name: bool(importlib.util.find_spec(name)) for name in names}))",
  ].join(";");
  const result = run("python", ["-c", source]);
  return result.ok ? JSON.parse(result.stdout) : Object.fromEntries(names.map((name) => [name, false]));
}

async function createFixtures() {
  const docxPath = path.join(tempRoot, "office-runtime.docx");
  const document = new Document({
    sections: [{
      children: [
        new Paragraph({ text: "Leemo Office Runtime", heading: HeadingLevel.HEADING_1 }),
        new Paragraph("DOCX_VALIDATION_MARKER"),
      ],
    }],
  });
  fs.writeFileSync(docxPath, await Packer.toBuffer(document));

  const pptxPath = path.join(tempRoot, "office-runtime.pptx");
  const presentation = new PptxGenJS();
  presentation.layout = "LAYOUT_WIDE";
  const slide = presentation.addSlide();
  slide.addText("PPTX_VALIDATION_MARKER", { x: 1, y: 1, w: 8, h: 1, fontSize: 28 });
  await presentation.writeFile({ fileName: pptxPath });

  const xlsxPath = path.join(tempRoot, "office-runtime.xlsx");
  const xlsxCreate = run("python", ["-c", [
    "import json,sys",
    "from openpyxl import Workbook,load_workbook",
    "from openpyxl.styles import Font,PatternFill",
    "p=sys.argv[1]",
    "w=Workbook()",
    "s=w.active",
    "s.title='验收'",
    "s.append(['项目','数值','计算'])",
    "s.append(['示例',2,'=B2*3'])",
    "s['A1'].font=Font(bold=True)",
    "s['A1'].fill=PatternFill('solid',fgColor='FFF2CC')",
    "w.save(p)",
    "r=load_workbook(p,data_only=False)",
    "assert r['验收']['C2'].value == '=B2*3'",
    "assert r['验收']['A1'].font.bold",
    "print(json.dumps({'formula':r['验收']['C2'].value,'style':r['验收']['A1'].font.bold},ensure_ascii=False))",
  ].join(";"), xlsxPath]);

  const fieldsPath = path.join(tempRoot, "pdf-fields.json");
  fs.writeFileSync(fieldsPath, JSON.stringify({
    form_fields: [{
      description: "姓名",
      page_number: 1,
      label_bounding_box: [10, 10, 50, 25],
      entry_bounding_box: [60, 10, 180, 30],
      entry_text: { font_size: 12 },
    }],
  }));

  return { docxPath, pptxPath, xlsxPath, xlsxCreate, fieldsPath };
}

try {
  const missingSkills = requiredSkills.filter((name) => !fs.existsSync(path.join(BUNDLE, name, "SKILL.md")));
  const packagedEntries = fs.existsSync(PACKAGE_ASAR)
    ? new Set(listPackage(PACKAGE_ASAR).map((entry) => entry.replaceAll("\\", "/").replace(/^\/+/, "")))
    : new Set();
  const packagedMissing = requiredSkills.filter((name) => (
    !packagedEntries.has(`bundled-skills/office/release/skills/${name}/SKILL.md`)
  ));
  const fixtures = await createFixtures();

  const python = commandPath("python");
  const tools = Object.fromEntries(
    ["pandoc", "soffice", "markitdown", "pdftoppm", "pdfinfo", "qpdf"].map((name) => [name, commandPath(name)]),
  );
  const modules = pythonModules([
    "openpyxl", "pandas", "markitdown", "defusedxml", "lxml", "PIL",
    "pypdf", "pdfplumber", "reportlab", "pdf2image", "pypdfium2",
  ]);

  const isolatedNodeModules = Object.fromEntries(
    ["docx", "pptxgenjs"].map((name) => {
      const result = run("node", ["-e", `require.resolve(${JSON.stringify(name)})`]);
      return [name, { ok: result.ok, detail: firstLine(result) || null }];
    }),
  );

  const docxValidate = run("python", [
    path.join(BUNDLE, "docx", "scripts", "office", "validate.py"),
    fixtures.docxPath,
  ]);
  const docxRender = run("python", [
    path.join(BUNDLE, "docx", "scripts", "office", "soffice.py"),
    "--headless", "--convert-to", "pdf", "--outdir", tempRoot, fixtures.docxPath,
  ]);
  const xlsxRecalc = run("python", [
    path.join(BUNDLE, "xlsx", "scripts", "recalc.py"),
    fixtures.xlsxPath,
    "10",
  ], { timeout: 20_000 });
  const pptxValidate = run("python", [
    path.join(BUNDLE, "pptx", "scripts", "office", "validate.py"),
    fixtures.pptxPath,
  ]);
  const pptxThumbnail = run("python", [
    path.join(BUNDLE, "pptx", "scripts", "thumbnail.py"),
    fixtures.pptxPath,
    path.join(tempRoot, "slides"),
  ]);
  const pdfBoundingBoxes = run("python", [
    path.join(BUNDLE, "pdf", "scripts", "check_bounding_boxes.py"),
    fixtures.fieldsPath,
  ]);

  const checks = {
    sourceBundleComplete: missingSkills.length === 0,
    packagedBundleComplete: packagedMissing.length === 0,
    xlsxCoreCreateAndRead: fixtures.xlsxCreate.ok,
    xlsxFormulaRecalculation: xlsxRecalc.ok && xlsxRecalc.stdout.includes('"status": "success"'),
    docxSchemaValidation: docxValidate.ok,
    docxVisualRender: docxRender.ok,
    pptxSchemaValidation: pptxValidate.ok,
    pptxVisualRender: pptxThumbnail.ok,
    pdfBundledUtility: pdfBoundingBoxes.ok && pdfBoundingBoxes.stdout.includes("SUCCESS"),
    pdfCoreLibraries: ["pypdf", "pdfplumber", "reportlab"].every((name) => modules[name]),
    isolatedWorkspaceDocumentCreation: isolatedNodeModules.docx.ok && isolatedNodeModules.pptxgenjs.ok,
  };

  const fullOfflineReady = Object.values(checks).every(Boolean);
  const report = {
    fullOfflineReady,
    checks,
    environment: { python, tools, pythonModules: modules, isolatedNodeModules },
    diagnostics: {
      xlsxCreate: diagnostic(fixtures.xlsxCreate),
      xlsxRecalc: diagnostic(xlsxRecalc),
      docxValidate: diagnostic(docxValidate),
      docxRender: diagnostic(docxRender),
      pptxValidate: diagnostic(pptxValidate),
      pptxThumbnail: diagnostic(pptxThumbnail),
      pdfBundledUtility: diagnostic(pdfBoundingBoxes),
    },
  };
  console.log(JSON.stringify(report, null, 2));
  if (!fullOfflineReady) process.exitCode = 1;
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
