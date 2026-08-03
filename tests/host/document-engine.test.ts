import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import PptxGenJS from "pptxgenjs";
import { strToU8, unzipSync, zipSync } from "fflate";
import {
  DEFAULT_DOCUMENT_TEXT_LIMIT,
  DOCUMENT_INPUT_MAX_BYTES,
  MAX_DOCUMENT_TEXT_LIMIT,
  DocumentToolError,
  createDocxBuffer,
  createPptxBuffer,
  createXlsxBuffer,
  documentKindFromPath,
  editDocxTextBuffer,
  normalizeReadOptions,
  readDocumentBuffer,
  readDocumentFile,
  writeDocumentAtomically,
  type AtomicWriteIO,
} from "../../src/host/document-engine";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-document-engine-"));
  temporaryDirectories.push(directory);
  return directory;
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
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, "binary");
}

async function sampleDocx(): Promise<Buffer> {
  const document = new Document({
    sections: [{
      children: [
        new Paragraph({ text: "学习报告", heading: HeadingLevel.TITLE }),
        new Paragraph("第一段：主动回忆。"),
        new Paragraph({ text: "关键点", bullet: { level: 0 } }),
        new Table({
          rows: [
            new TableRow({ children: [new TableCell({ children: [new Paragraph("概念")] }), new TableCell({ children: [new Paragraph("掌握度")] })] }),
            new TableRow({ children: [new TableCell({ children: [new Paragraph("导数")] }), new TableCell({ children: [new Paragraph("80%")] })] }),
          ],
        }),
      ],
    }],
  });
  return Packer.toBuffer(document);
}

async function samplePptx(): Promise<Buffer> {
  const presentation = new PptxGenJS();
  presentation.layout = "LAYOUT_WIDE";
  const first = presentation.addSlide();
  first.addText("求职复盘", { x: 0.8, y: 0.6, w: 8, h: 0.5 });
  first.addText("第一步：复盘事实", { x: 1, y: 1.6, w: 8, h: 0.4 });
  const second = presentation.addSlide();
  second.addText("下一步", { x: 0.8, y: 0.6, w: 8, h: 0.5 });
  second.addText("补充 STAR 故事", { x: 1, y: 1.6, w: 8, h: 0.4 });
  const output = await presentation.write({ outputType: "nodebuffer" });
  return Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer);
}

function sampleXlsx(): Buffer {
  const entries: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
        <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
        <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
      </Types>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets><sheet name="成绩" sheetId="1" r:id="rId1"/><sheet name="计划" sheetId="2" r:id="rId2"/></sheets>
      </workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
      </Relationships>`),
    "xl/sharedStrings.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="5" uniqueCount="5">
        <si><t>姓名</t></si><si><t>分数</t></si><si><t>小林</t></si><si><t>任务</t></si><si><t>复习英语</t></si>
      </sst>`),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
        <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
        <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>92</v></c></row>
      </sheetData></worksheet>`),
    "xl/worksheets/sheet2.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
        <row r="1"><c r="A1" t="s"><v>3</v></c><c r="B1" t="s"><v>4</v></c></row>
        <row r="2"><c r="A2" t="b"><v>1</v></c><c r="B2"><f>40+2</f><v>42</v></c></row>
      </sheetData></worksheet>`),
  };
  return Buffer.from(zipSync(entries, { level: 6 }));
}

function writeFixture(directory: string, name: string, contents: Buffer): string {
  const file = path.join(directory, name);
  fs.writeFileSync(file, contents);
  return file;
}

async function editableDocx(paragraphs: Paragraph[]): Promise<Buffer> {
  return Packer.toBuffer(new Document({
    creator: "fixture",
    sections: [{ children: paragraphs }],
  }));
}

function officeEntries(buffer: Buffer): Record<string, Uint8Array> {
  return unzipSync(new Uint8Array(buffer));
}

function replaceOfficePart(buffer: Buffer, part: string, transform: (xml: string) => string): Buffer {
  const entries = officeEntries(buffer);
  const current = entries[part];
  if (!current) throw new Error(`missing fixture part: ${part}`);
  entries[part] = strToU8(transform(new TextDecoder().decode(current)));
  return Buffer.from(zipSync(entries, { level: 6 }));
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("document engine contract", () => {
  it.each([
    ["lesson.PDF", "pdf"],
    ["report.docx", "docx"],
    ["slides.PptX", "pptx"],
    ["scores.XLSX", "xlsx"],
  ] as const)("recognizes %s as %s", (fileName, expected) => {
    expect(documentKindFromPath(fileName)).toBe(expected);
  });

  it("rejects unsupported formats with a user-facing error", () => {
    expect(() => documentKindFromPath("notes.txt")).toThrowError(
      expect.objectContaining({
        code: "unsupported",
        userMessage: expect.stringContaining("PDF、Word、演示文稿或 Excel"),
      }),
    );
  });

  it("uses a bounded text limit and rejects ambiguous values", () => {
    expect(normalizeReadOptions({})).toEqual({ maxChars: DEFAULT_DOCUMENT_TEXT_LIMIT });
    expect(normalizeReadOptions({ maxChars: MAX_DOCUMENT_TEXT_LIMIT })).toEqual({
      maxChars: MAX_DOCUMENT_TEXT_LIMIT,
    });
    for (const value of [999, MAX_DOCUMENT_TEXT_LIMIT + 1, 12.5, Number.NaN]) {
      expect(() => normalizeReadOptions({ maxChars: value })).toThrowError(
        expect.objectContaining({ code: "invalid_input" }),
      );
    }
  });

  it("refuses an oversized file from stat alone", async () => {
    const file = path.join(temporaryDirectory(), "huge.pdf");
    fs.writeFileSync(file, "%PDF-");
    fs.truncateSync(file, DOCUMENT_INPUT_MAX_BYTES + 1);

    await expect(readDocumentFile(file)).rejects.toMatchObject({
      code: "too_large",
      userMessage: expect.stringContaining("30 MB"),
    });
  });

  it("classifies empty and missing files without leaking stack traces", async () => {
    const directory = temporaryDirectory();
    const empty = path.join(directory, "empty.docx");
    fs.writeFileSync(empty, "");

    await expect(readDocumentFile(empty)).rejects.toMatchObject({ code: "corrupt" });
    await expect(readDocumentFile(path.join(directory, "missing.pdf"))).rejects.toMatchObject({
      code: "io",
      userMessage: expect.not.stringContaining("ENOENT"),
    });
  });

  it("keeps internal causes out of the model-facing message", () => {
    const error = new DocumentToolError("corrupt", "这份文件无法解析。", new Error("secret-stack"));
    expect(error.userMessage).toBe("这份文件无法解析。");
    expect(error.userMessage).not.toContain("secret-stack");
    expect(error.cause).toBeInstanceOf(Error);
  });
});

describe("document engine readers", () => {
  it("extracts PDF text and page count", { timeout: 20_000 }, async () => {
    const file = writeFixture(temporaryDirectory(), "lesson.pdf", simplePdf("Hello PDF lesson"));
    await expect(readDocumentFile(file)).resolves.toMatchObject({
      kind: "pdf",
      text: expect.stringContaining("Hello PDF lesson"),
      pages: 1,
      truncated: false,
    });
  });

  it("extracts DOCX paragraphs, bullets, and table cells", async () => {
    const file = writeFixture(temporaryDirectory(), "report.docx", await sampleDocx());
    const result = await readDocumentFile(file);
    expect(result.kind).toBe("docx");
    expect(result.text).toContain("学习报告");
    expect(result.text).toContain("主动回忆");
    expect(result.text).toContain("关键点");
    expect(result.text).toContain("概念");
    expect(result.text).toContain("80%");
  });

  it("extracts PPTX text in slide order", async () => {
    const file = writeFixture(temporaryDirectory(), "review.pptx", await samplePptx());
    const result = await readDocumentFile(file);
    expect(result).toMatchObject({ kind: "pptx", slides: 2, truncated: false });
    expect(result.text).toMatch(/幻灯片 1[\s\S]*求职复盘[\s\S]*复盘事实/);
    expect(result.text).toMatch(/幻灯片 2[\s\S]*下一步[\s\S]*STAR 故事/);
  });

  it("extracts XLSX sheets, shared strings, booleans, formulas, and values", async () => {
    const file = writeFixture(temporaryDirectory(), "scores.xlsx", sampleXlsx());
    const result = await readDocumentFile(file);
    expect(result).toMatchObject({ kind: "xlsx", sheets: 2, truncated: false });
    expect(result.text).toMatch(/工作表：成绩[\s\S]*姓名\t分数[\s\S]*小林\t92/);
    expect(result.text).toMatch(/工作表：计划[\s\S]*任务\t复习英语[\s\S]*TRUE\t42/);
  });

  it("truncates extracted text at the caller's bounded limit", async () => {
    const document = new Document({
      sections: [{ children: [new Paragraph("长".repeat(2_000))] }],
    });
    const file = writeFixture(temporaryDirectory(), "long.docx", await Packer.toBuffer(document));
    const result = await readDocumentFile(file, { maxChars: 1_000 });
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(1_000);
  });

  it.each(["pdf", "docx", "pptx", "xlsx"] as const)(
    "turns a corrupt %s into a recoverable error",
    async (extension) => {
      const directory = temporaryDirectory();
      const bad = writeFixture(directory, `bad.${extension}`, Buffer.from("not a document"));
      const good = writeFixture(directory, "good.pdf", simplePdf("Recovery works"));
      await expect(readDocumentFile(bad)).rejects.toMatchObject({ code: "corrupt" });
      await expect(readDocumentFile(good)).resolves.toMatchObject({ kind: "pdf" });
    },
  );
});

describe("document engine creators", () => {
  it("creates a DOCX report that can be read back", async () => {
    const buffer = await createDocxBuffer({
      title: "英语学习周报",
      subtitle: "7 月第 5 周",
      sections: [
        { heading: "本周进展", paragraphs: ["完成 5 次主动回忆。"], bullets: ["写作错误复发率下降"] },
        { heading: "下周计划", paragraphs: ["继续练习真实求职表达。"] },
      ],
    });
    const result = await readDocumentBuffer(buffer, "docx", normalizeReadOptions({}));
    expect(result.text).toContain("英语学习周报");
    expect(result.text).toContain("主动回忆");
    expect(result.text).toContain("错误复发率下降");
  });

  it("creates a 16:9 PPTX that can be read back in slide order", async () => {
    const buffer = await createPptxBuffer({
      title: "简历诊断",
      subtitle: "从岗位要求到证据",
      slides: [
        { title: "问题", bullets: ["成果缺少量化", "技能没有证据"] },
        { title: "行动", bullets: ["补充 STAR 项目", "按 JD 调整顺序"] },
      ],
    });
    const result = await readDocumentBuffer(buffer, "pptx", normalizeReadOptions({}));
    expect(result.slides).toBe(3);
    expect(result.text).toMatch(/简历诊断[\s\S]*问题[\s\S]*成果缺少量化[\s\S]*行动[\s\S]*STAR/);
  });

  it("creates a multi-sheet XLSX with typed cells and reads it back", async () => {
    const buffer = createXlsxBuffer({
      sheets: [
        { name: "进度", rows: [["日期", "得分", "完成"], ["2026-07-31", 88, true]] },
        { name: "错题", rows: [["表达", "次数"], ["informations", 2], [null, false]] },
      ],
    });
    const result = await readDocumentBuffer(buffer, "xlsx", normalizeReadOptions({}));
    expect(result.sheets).toBe(2);
    expect(result.text).toMatch(/工作表：进度[\s\S]*2026-07-31\t88\tTRUE/);
    expect(result.text).toMatch(/工作表：错题[\s\S]*informations\t2[\s\S]*\tFALSE/);
  });

  it("rejects invalid or unbounded creation drafts", async () => {
    await expect(createDocxBuffer({ title: "", sections: [] })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(createPptxBuffer({
      title: "too many",
      slides: Array.from({ length: 41 }, (_, index) => ({ title: String(index), bullets: [] })),
    })).rejects.toMatchObject({ code: "invalid_input" });
    expect(() => createXlsxBuffer({
      sheets: [{ name: "重复", rows: [] }, { name: "重复", rows: [] }],
    })).toThrowError(expect.objectContaining({ code: "invalid_input" }));
    expect(() => createXlsxBuffer({ sheets: [{ name: "数字", rows: [[Number.POSITIVE_INFINITY]] }] }))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });
});

describe("DOCX fidelity-preserving exact text edits", () => {
  it("replaces text split across styled runs while leaving every other package part untouched", async () => {
    const source = await editableDocx([
      new Paragraph({
        children: [
          new TextRun({ text: "请完成", color: "C00000" }),
          new TextRun({ text: "求职", bold: true }),
          new TextRun({ text: "准备", italics: true }),
          new TextRun("计划，然后复盘。"),
        ],
      }),
    ]);
    const before = officeEntries(source);

    const edited = editDocxTextBuffer(source, [
      { find: "求职准备计划", replace: "英语学习计划" },
    ]);

    expect(edited.replacements).toBe(1);
    expect(edited.changedParts).toEqual(["word/document.xml"]);
    const readBack = await readDocumentBuffer(edited.buffer, "docx", normalizeReadOptions({}));
    expect(readBack.text).toContain("请完成英语学习计划，然后复盘。");

    const after = officeEntries(edited.buffer);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const [name, bytes] of Object.entries(before)) {
      if (name === "word/document.xml") continue;
      expect(Buffer.from(after[name]), name).toEqual(Buffer.from(bytes));
    }
    const documentXml = new TextDecoder().decode(after["word/document.xml"]);
    expect(documentXml).toMatch(/<w:b\b/);
    expect(documentXml).toMatch(/<w:i\b/);
  });

  it("matches decoded XML text and escapes replacement characters", async () => {
    const source = await editableDocx([new Paragraph("A & B")]);

    const edited = editDocxTextBuffer(source, [
      { find: "A & B", replace: "C < D & E" },
    ]);

    const readBack = await readDocumentBuffer(edited.buffer, "docx", normalizeReadOptions({}));
    expect(readBack.text).toContain("C < D & E");
    const xml = new TextDecoder().decode(officeEntries(edited.buffer)["word/document.xml"]);
    expect(xml).toContain("C &lt; D &amp; E");
  });

  it("requires the declared number of matches before changing anything", async () => {
    const source = await editableDocx([new Paragraph("目标：英语。目标：求职。")]);
    const untouched = Buffer.from(source);

    expect(() => editDocxTextBuffer(source, [{ find: "目标", replace: "方向" }]))
      .toThrowError(expect.objectContaining({
        code: "invalid_input",
        userMessage: expect.stringMatching(/找到 2 处/),
      }));
    expect(source).toEqual(untouched);

    const edited = editDocxTextBuffer(source, [
      { find: "目标", replace: "方向", expectedMatches: 2 },
    ]);
    const readBack = await readDocumentBuffer(edited.buffer, "docx", normalizeReadOptions({}));
    expect(readBack.text).toContain("方向：英语。方向：求职。");
    expect(edited.replacements).toBe(2);
  });

  it("rejects an entire batch when one replacement is missing or ranges overlap", async () => {
    const source = await editableDocx([new Paragraph("abcdef")]);

    expect(() => editDocxTextBuffer(source, [
      { find: "abc", replace: "ABC" },
      { find: "没有", replace: "不会写入" },
    ])).toThrowError(expect.objectContaining({ code: "invalid_input" }));

    expect(() => editDocxTextBuffer(source, [
      { find: "abc", replace: "ABC" },
      { find: "bcd", replace: "BCD" },
    ])).toThrowError(expect.objectContaining({
      code: "invalid_input",
      userMessage: expect.stringContaining("重叠"),
    }));
  });

  it("stops when a match crosses a field or other complex Word structure", async () => {
    const plain = await editableDocx([
      new Paragraph({ children: [new TextRun("总计"), new TextRun("42") ] }),
    ]);
    const withField = replaceOfficePart(plain, "word/document.xml", (xml) =>
      xml.replace("</w:r><w:r>", "</w:r><w:r><w:fldChar w:fldCharType=\"begin\"/></w:r><w:r>"));

    expect(() => editDocxTextBuffer(withField, [
      { find: "总计42", replace: "总计43" },
    ])).toThrowError(expect.objectContaining({
      code: "invalid_input",
      userMessage: expect.stringContaining("复杂结构"),
    }));
  });

  it("does not silently edit text inside tracked insertions", async () => {
    const plain = await editableDocx([new Paragraph("修订文字")]);
    const tracked = replaceOfficePart(plain, "word/document.xml", (xml) =>
      xml.replace("<w:r>", '<w:ins w:id="1" w:author="momo"><w:r>')
        .replace("</w:r>", "</w:r></w:ins>"));

    expect(() => editDocxTextBuffer(tracked, [
      { find: "修订文字", replace: "不应直接修改" },
    ])).toThrowError(expect.objectContaining({
      code: "invalid_input",
      userMessage: expect.stringContaining("修订"),
    }));
  });

  it("stops when a match crosses out of a hyperlink", async () => {
    const plain = await editableDocx([
      new Paragraph({ children: [new TextRun("链接内"), new TextRun("链接外")] }),
    ]);
    const withHyperlinkBoundary = replaceOfficePart(plain, "word/document.xml", (xml) =>
      xml.replace("<w:r>", '<w:hyperlink w:anchor="target"><w:r>')
        .replace("</w:r>", "</w:r></w:hyperlink>"));

    expect(() => editDocxTextBuffer(withHyperlinkBoundary, [
      { find: "链接内链接外", replace: "不应跨边界" },
    ])).toThrowError(expect.objectContaining({
      code: "invalid_input",
      userMessage: expect.stringContaining("复杂结构"),
    }));
  });

  it("bounds literal edit inputs and refuses control characters", async () => {
    const source = await editableDocx([new Paragraph("原文")]);
    expect(() => editDocxTextBuffer(source, []))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
    expect(() => editDocxTextBuffer(source, [
      { find: "原文", replace: "两行\n文字" },
    ])).toThrowError(expect.objectContaining({ code: "invalid_input" }));
    expect(() => editDocxTextBuffer(source, Array.from({ length: 21 }, (_, index) => ({
      find: `原文${index}`,
      replace: `新文${index}`,
    })))) .toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });
});

describe("atomic document writes", () => {
  it("refuses to overwrite an existing file by default", async () => {
    const directory = temporaryDirectory();
    const target = path.join(directory, "report.docx");
    fs.writeFileSync(target, "original");
    await expect(writeDocumentAtomically(target, Buffer.from("replacement"))).rejects.toMatchObject({
      code: "existing_file",
    });
    expect(fs.readFileSync(target, "utf8")).toBe("original");
  });

  it("replaces an existing file only when overwrite is explicit", async () => {
    const directory = temporaryDirectory();
    const target = path.join(directory, "report.docx");
    fs.writeFileSync(target, "original");
    await writeDocumentAtomically(target, Buffer.from("replacement"), { overwrite: true });
    expect(fs.readFileSync(target, "utf8")).toBe("replacement");
    expect(fs.readdirSync(directory)).toEqual(["report.docx"]);
  });

  it("restores the original when the final rename fails", async () => {
    const directory = temporaryDirectory();
    const target = path.join(directory, "report.docx");
    fs.writeFileSync(target, "original");
    let renameCalls = 0;
    const native = fs.promises;
    const io: AtomicWriteIO = {
      mkdir: (directoryPath) => native.mkdir(directoryPath, { recursive: true }).then(() => undefined),
      stat: (filePath) => native.stat(filePath).then(() => true).catch(() => false),
      writeFile: (filePath, contents) => native.writeFile(filePath, contents),
      rename: async (from, to) => {
        renameCalls += 1;
        if (renameCalls === 2) throw new Error("simulated rename failure");
        await native.rename(from, to);
      },
      remove: (filePath) => native.rm(filePath, { force: true }),
    };
    await expect(writeDocumentAtomically(target, Buffer.from("replacement"), { overwrite: true }, io))
      .rejects.toMatchObject({ code: "io" });
    expect(fs.readFileSync(target, "utf8")).toBe("original");
    expect(fs.readdirSync(directory)).toEqual(["report.docx"]);
  });
});
