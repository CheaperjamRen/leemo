import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import PptxGenJS from "pptxgenjs";
import { strToU8, unzipSync, zipSync } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";

export type DocumentKind = "pdf" | "docx" | "pptx" | "xlsx";

export type DocumentToolErrorCode =
  | "unsupported"
  | "too_large"
  | "corrupt"
  | "encrypted"
  | "invalid_input"
  | "existing_file"
  | "io";

export interface ReadDocumentOptions {
  maxChars?: number;
}

export interface NormalizedReadDocumentOptions {
  maxChars: number;
}

export interface DocumentReadResult {
  kind: DocumentKind;
  text: string;
  truncated: boolean;
  bytes: number;
  pages?: number;
  slides?: number;
  sheets?: number;
}

export interface DocxSectionDraft {
  heading?: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface DocxDraft {
  title: string;
  subtitle?: string;
  sections: DocxSectionDraft[];
}

export interface DocxTextReplacement {
  find: string;
  replace: string;
  /** Defaults to one. A mismatch aborts the entire edit before any file write. */
  expectedMatches?: number;
}

export interface DocxEditResult {
  buffer: Buffer;
  replacements: number;
  changedParts: ["word/document.xml"];
}

export interface PptxSlideDraft {
  title: string;
  bullets: string[];
}

export interface PptxDraft {
  title: string;
  subtitle?: string;
  slides: PptxSlideDraft[];
}

export type SpreadsheetCell = string | number | boolean | null;

export interface XlsxSheetDraft {
  name: string;
  rows: SpreadsheetCell[][];
}

export interface XlsxDraft {
  sheets: XlsxSheetDraft[];
}

export interface AtomicWriteOptions {
  overwrite?: boolean;
}

export interface AtomicWriteIO {
  mkdir(directoryPath: string): Promise<void>;
  stat(filePath: string): Promise<boolean>;
  writeFile(filePath: string, contents: Buffer): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(filePath: string): Promise<void>;
}

export const DOCUMENT_INPUT_MAX_BYTES = 30 * 1024 * 1024;
export const PDF_INPUT_MAX_BYTES = 64 * 1024 * 1024;
export const DEFAULT_DOCUMENT_TEXT_LIMIT = 50_000;
export const MAX_DOCUMENT_TEXT_LIMIT = 100_000;
const MIN_DOCUMENT_TEXT_LIMIT = 1_000;
const OFFICE_ARCHIVE_MAX_FILES = 5_000;
const OFFICE_ARCHIVE_MAX_EXPANDED_BYTES = 128 * 1024 * 1024;
const MAX_TITLE_CHARS = 200;
const MAX_BODY_CHARS = 5_000;
const MAX_DOCX_SECTIONS = 60;
const MAX_DOCX_ITEMS = 500;
const MAX_DOCX_TEXT_REPLACEMENTS = 20;
const MAX_DOCX_REPLACEMENT_TEXT_CHARS = 5_000;
const MAX_DOCX_EXPECTED_MATCHES = 100;
const MAX_PPTX_SLIDES = 40;
const MAX_PPTX_BULLETS = 10;
const MAX_PPTX_BULLET_CHARS = 180;
const MAX_XLSX_SHEETS = 12;
const MAX_XLSX_ROWS = 1_000;
const MAX_XLSX_COLUMNS = 50;
const MAX_XLSX_CELLS = 20_000;
const xmlDecoder = new TextDecoder("utf-8", { fatal: false });
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
});
const orderedXmlParser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  preserveOrder: true,
  parseTagValue: false,
  trimValues: false,
});

type PdfMatrixInit = ArrayLike<number> | {
  a?: number;
  b?: number;
  c?: number;
  d?: number;
  e?: number;
  f?: number;
};

/** PDF.js only needs the browser matrix primitive for display-side helpers;
 * text extraction itself does not need a native canvas. Its bundled Node
 * fallback cannot resolve the optional native package from app.asar, so keep a
 * small standards-compatible 2D matrix available instead. */
class PdfDomMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  readonly is2D = true;

  constructor(init?: PdfMatrixInit) {
    if (!init) return;
    if ("length" in init) {
      if (init.length >= 16) {
        this.a = Number(init[0]);
        this.b = Number(init[1]);
        this.c = Number(init[4]);
        this.d = Number(init[5]);
        this.e = Number(init[12]);
        this.f = Number(init[13]);
      } else if (init.length >= 6) {
        this.a = Number(init[0]);
        this.b = Number(init[1]);
        this.c = Number(init[2]);
        this.d = Number(init[3]);
        this.e = Number(init[4]);
        this.f = Number(init[5]);
      }
      return;
    }
    this.a = init.a ?? this.a;
    this.b = init.b ?? this.b;
    this.c = init.c ?? this.c;
    this.d = init.d ?? this.d;
    this.e = init.e ?? this.e;
    this.f = init.f ?? this.f;
  }

  get m11(): number { return this.a; }
  set m11(value: number) { this.a = value; }
  get m12(): number { return this.b; }
  set m12(value: number) { this.b = value; }
  get m21(): number { return this.c; }
  set m21(value: number) { this.c = value; }
  get m22(): number { return this.d; }
  set m22(value: number) { this.d = value; }
  get m41(): number { return this.e; }
  set m41(value: number) { this.e = value; }
  get m42(): number { return this.f; }
  set m42(value: number) { this.f = value; }

  multiplySelf(other: PdfMatrixInit): this {
    const right = new PdfDomMatrix(other);
    const { a, b, c, d, e, f } = this;
    this.a = a * right.a + c * right.b;
    this.b = b * right.a + d * right.b;
    this.c = a * right.c + c * right.d;
    this.d = b * right.c + d * right.d;
    this.e = a * right.e + c * right.f + e;
    this.f = b * right.e + d * right.f + f;
    return this;
  }

  preMultiplySelf(other: PdfMatrixInit): this {
    const left = new PdfDomMatrix(other).multiplySelf(this);
    Object.assign(this, left);
    return this;
  }

  translateSelf(x = 0, y = 0): this {
    return this.multiplySelf({ a: 1, b: 0, c: 0, d: 1, e: x, f: y });
  }

  scaleSelf(x = 1, y = x): this {
    return this.multiplySelf({ a: x, b: 0, c: 0, d: y, e: 0, f: 0 });
  }

  invertSelf(): this {
    const determinant = this.a * this.d - this.b * this.c;
    if (determinant === 0) {
      this.a = this.b = this.c = this.d = this.e = this.f = Number.NaN;
      return this;
    }
    const { a, b, c, d, e, f } = this;
    this.a = d / determinant;
    this.b = -b / determinant;
    this.c = -c / determinant;
    this.d = a / determinant;
    this.e = (c * f - d * e) / determinant;
    this.f = (b * e - a * f) / determinant;
    return this;
  }

  multiply(other: PdfMatrixInit): PdfDomMatrix {
    return new PdfDomMatrix(this).multiplySelf(other);
  }

  translate(x = 0, y = 0): PdfDomMatrix {
    return new PdfDomMatrix(this).translateSelf(x, y);
  }

  scale(x = 1, y = x): PdfDomMatrix {
    return new PdfDomMatrix(this).scaleSelf(x, y);
  }

  inverse(): PdfDomMatrix {
    return new PdfDomMatrix(this).invertSelf();
  }
}

function ensurePdfDomMatrix(): void {
  const globals = globalThis as unknown as { DOMMatrix?: typeof PdfDomMatrix };
  globals.DOMMatrix ??= PdfDomMatrix;
}

export class DocumentToolError extends Error {
  readonly code: DocumentToolErrorCode;
  readonly userMessage: string;

  constructor(code: DocumentToolErrorCode, userMessage: string, cause?: unknown) {
    super(userMessage, cause === undefined ? undefined : { cause });
    this.name = "DocumentToolError";
    this.code = code;
    this.userMessage = userMessage;
  }
}

export function documentKindFromPath(filePath: string): DocumentKind {
  const extension = path.extname(filePath).toLocaleLowerCase();
  if (extension === ".pdf") return "pdf";
  if (extension === ".docx") return "docx";
  if (extension === ".pptx") return "pptx";
  if (extension === ".xlsx") return "xlsx";
  throw new DocumentToolError(
    "unsupported",
    "目前只能读取 PDF、Word、演示文稿或 Excel 文件（.pdf、.docx、.pptx、.xlsx）。",
  );
}

export function normalizeReadOptions(options: ReadDocumentOptions): NormalizedReadDocumentOptions {
  const maxChars = options.maxChars ?? DEFAULT_DOCUMENT_TEXT_LIMIT;
  if (
    !Number.isInteger(maxChars)
    || maxChars < MIN_DOCUMENT_TEXT_LIMIT
    || maxChars > MAX_DOCUMENT_TEXT_LIMIT
  ) {
    throw new DocumentToolError(
      "invalid_input",
      `提取文字上限需为 ${MIN_DOCUMENT_TEXT_LIMIT} 到 ${MAX_DOCUMENT_TEXT_LIMIT} 之间的整数。`,
    );
  }
  return { maxChars };
}

function asIoError(filePath: string, cause: unknown): DocumentToolError {
  return new DocumentToolError(
    "io",
    `无法读取“${path.basename(filePath)}”，请确认文件仍存在且没有被其他程序锁定。`,
    cause,
  );
}

export async function readDocumentFile(
  filePath: string,
  options: ReadDocumentOptions = {},
): Promise<DocumentReadResult> {
  const kind = documentKindFromPath(filePath);
  const normalized = normalizeReadOptions(options);
  const inputLimit = kind === "pdf" ? PDF_INPUT_MAX_BYTES : DOCUMENT_INPUT_MAX_BYTES;
  const inputLimitLabel = kind === "pdf" ? "64 MB" : "30 MB";

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    throw asIoError(filePath, error);
  }
  if (!stat.isFile()) throw asIoError(filePath, new Error("not a file"));
  if (stat.size > inputLimit) {
    throw new DocumentToolError("too_large", `这份文件超过 ${inputLimitLabel}，当前版本暂不读取。`);
  }
  if (stat.size === 0) {
    throw new DocumentToolError("corrupt", "这份文件是空的，无法解析。");
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch (error) {
    throw asIoError(filePath, error);
  }
  if (buffer.byteLength > inputLimit) {
    throw new DocumentToolError("too_large", `这份文件超过 ${inputLimitLabel}，当前版本暂不读取。`);
  }

  return readDocumentBuffer(buffer, kind, normalized);
}

export async function readDocumentBuffer(
  buffer: Buffer,
  kind: DocumentKind,
  options: NormalizedReadDocumentOptions,
): Promise<DocumentReadResult> {
  try {
    if (kind === "pdf") return await readPdf(buffer, options);
    if (kind === "docx") return await readDocx(buffer, options);
    if (kind === "pptx") return readPptx(buffer, options);
    return readXlsx(buffer, options);
  } catch (error) {
    if (error instanceof DocumentToolError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    if (/password|encrypted|encryption/i.test(detail)) {
      throw new DocumentToolError("encrypted", "这份文件受密码保护，当前版本无法读取。", error);
    }
    throw new DocumentToolError("corrupt", "这份文件无法解析，请确认它没有损坏或加密。", error);
  }
}

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function boundedText(value: string, maxChars: number): { text: string; truncated: boolean } {
  const normalized = normalizeExtractedText(value);
  if (normalized.length <= maxChars) return { text: normalized, truncated: false };
  return { text: normalized.slice(0, maxChars).trimEnd(), truncated: true };
}

function result(
  kind: DocumentKind,
  buffer: Buffer,
  rawText: string,
  options: NormalizedReadDocumentOptions,
  counts: Pick<DocumentReadResult, "pages" | "slides" | "sheets"> = {},
): DocumentReadResult {
  const clipped = boundedText(rawText, options.maxChars);
  return { kind, ...clipped, bytes: buffer.byteLength, ...counts };
}

async function readPdf(
  buffer: Buffer,
  options: NormalizedReadDocumentOptions,
): Promise<DocumentReadResult> {
  ensurePdfDomMatrix();
  // PDF.js uses a same-thread worker in Node, but its default loader resolves
  // `./pdf.worker.mjs` beside the final bundle. Register the minified worker
  // explicitly so esbuild keeps it inside Leemo's one-file main process.
  // @ts-expect-error pdfjs-dist omits declarations for its minified worker entry.
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
  const globals = globalThis as unknown as {
    pdfjsWorker?: { WorkerMessageHandler: typeof worker.WorkerMessageHandler };
  };
  globals.pdfjsWorker ??= { WorkerMessageHandler: worker.WorkerMessageHandler };
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const document = await loading.promise;
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const chunks: string[] = [];
      for (const item of content.items) {
        if (!("str" in item) || typeof item.str !== "string") continue;
        if (item.str) chunks.push(item.str);
        if ("hasEOL" in item && item.hasEOL) chunks.push("\n");
        else chunks.push(" ");
      }
      pages.push(`## 第 ${pageNumber} 页\n${chunks.join("").replace(/[ ]+\n/g, "\n").trim()}`);
    }
    return result("pdf", buffer, pages.join("\n\n"), options, { pages: document.numPages });
  } finally {
    await document.destroy();
  }
}

async function readDocx(
  buffer: Buffer,
  options: NormalizedReadDocumentOptions,
): Promise<DocumentReadResult> {
  const entries = unzipOffice(buffer);
  const documentXml = entries["word/document.xml"];
  if (!documentXml) throw new DocumentToolError("corrupt", "这份 Word 文档缺少正文结构。");
  const xml = xmlDecoder.decode(documentXml);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new DocumentToolError("corrupt", "这份 Office 文件包含不受支持的 XML 声明。");
  }
  const paragraphs: string[] = [];
  collectDocxParagraphs(orderedXmlParser.parse(xml), paragraphs);
  return result("docx", buffer, paragraphs.join("\n"), options);
}

function collectDocxInline(value: unknown, output: string[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectDocxInline(entry, output);
    return;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    output.push(String(value));
    return;
  }
  const record = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
  if (!record) return;
  if (typeof record["#text"] === "string") output.push(record["#text"]);
  for (const [key, entry] of Object.entries(record)) {
    if (key === "#text" || key === ":@" || key === "del") continue;
    if (key === "tab") output.push("\t");
    else if (key === "br" || key === "cr") output.push("\n");
    else collectDocxInline(entry, output);
  }
}

function collectDocxParagraphs(value: unknown, output: string[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectDocxParagraphs(entry, output);
    return;
  }
  const record = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
  if (!record) return;
  if (record.p !== undefined) {
    const chunks: string[] = [];
    collectDocxInline(record.p, chunks);
    const paragraph = chunks.join("").trim();
    if (paragraph) output.push(paragraph);
    return;
  }
  for (const [key, entry] of Object.entries(record)) {
    if (key !== ":@") collectDocxParagraphs(entry, output);
  }
}

function unzipOffice(buffer: Buffer): Record<string, Uint8Array> {
  const entries = unzipSync(new Uint8Array(buffer));
  const names = Object.keys(entries);
  const expandedBytes = names.reduce((total, name) => total + entries[name].byteLength, 0);
  if (names.length > OFFICE_ARCHIVE_MAX_FILES || expandedBytes > OFFICE_ARCHIVE_MAX_EXPANDED_BYTES) {
    throw new DocumentToolError("too_large", "这份 Office 文件展开后过大，当前版本暂不读取。");
  }
  if (!entries["[Content_Types].xml"]) {
    throw new DocumentToolError("corrupt", "这不是有效的 Office 文档。");
  }
  return entries;
}

interface DocxTextNode {
  elementStart: number;
  elementEnd: number;
  openTag: string;
  closeTag: string;
  text: string;
  logicalStart: number;
  logicalEnd: number;
}

interface DocxParagraph {
  elementStart: number;
  raw: string;
  nodes: DocxTextNode[];
  text: string;
  complex: boolean;
}

interface DocxMatch {
  paragraph: DocxParagraph;
  start: number;
  end: number;
  replace: string;
}

function xmlError(message: string): DocumentToolError {
  return new DocumentToolError("corrupt", message);
}

function validateEditableXml(xml: string): void {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    throw xmlError("这份 Word 文档包含不受支持的 XML 声明。");
  }
  if (XMLValidator.validate(xml) !== true) {
    throw xmlError("这份 Word 文档的正文结构无法安全解析。");
  }
}

function decodeXmlText(value: string): string {
  return value.replace(/&([^;]+);/gu, (_whole, entity: string) => {
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "quot") return "\"";
    if (entity === "apos") return "'";
    const hexadecimal = /^#x[0-9a-f]+$/iu.test(entity);
    const decimal = /^#\d+$/u.test(entity);
    if (!hexadecimal && !decimal) {
      throw xmlError("这份 Word 文档包含无法安全保留的文字实体。");
    }
    const radix = hexadecimal ? 16 : 10;
    const digits = entity.replace(/^#x?/iu, "");
    const codePoint = Number.parseInt(digits, radix);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
      throw xmlError("这份 Word 文档包含无效字符。");
    }
    return String.fromCodePoint(codePoint);
  });
}

function encodeXmlText(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function wordprocessingPrefix(xml: string): string {
  const namespace = /xmlns(?::([A-Za-z_][\w.-]*))?=["'](?:http:\/\/schemas\.openxmlformats\.org\/wordprocessingml\/2006\/main|http:\/\/purl\.oclc\.org\/ooxml\/wordprocessingml\/main)["']/iu.exec(xml);
  if (!namespace) throw xmlError("这份 Word 文档缺少正文命名空间。");
  return namespace[1] ?? "";
}

function tagName(prefix: string, localName: string): string {
  return prefix ? `${escapeRegex(prefix)}:${localName}` : localName;
}

function parseDocxParagraphs(xml: string): DocxParagraph[] {
  validateEditableXml(xml);
  const prefix = wordprocessingPrefix(xml);
  const paragraphTag = tagName(prefix, "p");
  const textTag = tagName(prefix, "t");
  const qualifiedPrefix = prefix ? `${escapeRegex(prefix)}:` : "";
  const paragraphPattern = new RegExp(`<${paragraphTag}(?=\\s|>)[^>]*>[\\s\\S]*?<\\/${paragraphTag}\\s*>`, "gu");
  const textPattern = new RegExp(`(<${textTag}(?=\\s|>)[^>]*>)([\\s\\S]*?)(<\\/${textTag}\\s*>)`, "gu");
  const complexPattern = new RegExp(
    `<\\/?${qualifiedPrefix}(?:fldChar|instrText|ins|del|moveFrom|moveTo|drawing|object)\\b`,
    "iu",
  );
  const paragraphs: DocxParagraph[] = [];

  for (const match of xml.matchAll(paragraphPattern)) {
    const raw = match[0];
    const paragraphStart = match.index ?? 0;
    const nodes: DocxTextNode[] = [];
    let logicalOffset = 0;
    textPattern.lastIndex = 0;
    for (let textMatch = textPattern.exec(raw); textMatch; textMatch = textPattern.exec(raw)) {
      if (textMatch[2].includes("<")) {
        throw xmlError("这份 Word 文档包含当前版本无法安全修改的文字节点。");
      }
      const text = decodeXmlText(textMatch[2]);
      const elementStart = paragraphStart + textMatch.index;
      const node: DocxTextNode = {
        elementStart,
        elementEnd: elementStart + textMatch[0].length,
        openTag: textMatch[1],
        closeTag: textMatch[3],
        text,
        logicalStart: logicalOffset,
        logicalEnd: logicalOffset + text.length,
      };
      nodes.push(node);
      logicalOffset = node.logicalEnd;
    }
    if (nodes.length === 0) continue;
    paragraphs.push({
      elementStart: paragraphStart,
      raw,
      nodes,
      text: nodes.map((node) => node.text).join(""),
      complex: complexPattern.test(raw),
    });
  }
  return paragraphs;
}

function normalizeDocxTextReplacements(
  replacements: readonly DocxTextReplacement[],
): Required<DocxTextReplacement>[] {
  if (!Array.isArray(replacements) || replacements.length === 0 || replacements.length > MAX_DOCX_TEXT_REPLACEMENTS) {
    throw new DocumentToolError(
      "invalid_input",
      `一次 Word 修改需要 1 到 ${MAX_DOCX_TEXT_REPLACEMENTS} 项文字替换。`,
    );
  }
  return replacements.map((replacement, index) => {
    if (!replacement || typeof replacement.find !== "string" || typeof replacement.replace !== "string") {
      throw new DocumentToolError("invalid_input", `第 ${index + 1} 项替换格式不正确。`);
    }
    if (!replacement.find || replacement.find.length > MAX_DOCX_REPLACEMENT_TEXT_CHARS) {
      throw new DocumentToolError("invalid_input", `第 ${index + 1} 项原文不能为空或超过 ${MAX_DOCX_REPLACEMENT_TEXT_CHARS} 字。`);
    }
    if (replacement.replace.length > MAX_DOCX_REPLACEMENT_TEXT_CHARS) {
      throw new DocumentToolError("invalid_input", `第 ${index + 1} 项新文字不能超过 ${MAX_DOCX_REPLACEMENT_TEXT_CHARS} 字。`);
    }
    if (/[\u0000-\u001f\u007f]/u.test(replacement.find) || /[\u0000-\u001f\u007f]/u.test(replacement.replace)) {
      throw new DocumentToolError("invalid_input", "Word 精确文字修改暂不支持换行、制表符或控制字符。");
    }
    if (replacement.find === replacement.replace) {
      throw new DocumentToolError("invalid_input", `第 ${index + 1} 项原文和新文字相同。`);
    }
    const expectedMatches = replacement.expectedMatches ?? 1;
    if (!Number.isInteger(expectedMatches) || expectedMatches < 1 || expectedMatches > MAX_DOCX_EXPECTED_MATCHES) {
      throw new DocumentToolError(
        "invalid_input",
        `第 ${index + 1} 项预期命中次数需为 1 到 ${MAX_DOCX_EXPECTED_MATCHES} 的整数。`,
      );
    }
    return { ...replacement, expectedMatches };
  });
}

function literalMatches(text: string, needle: string): { start: number; end: number }[] {
  const matches: { start: number; end: number }[] = [];
  let offset = 0;
  while (offset <= text.length - needle.length) {
    const start = text.indexOf(needle, offset);
    if (start < 0) break;
    matches.push({ start, end: start + needle.length });
    offset = start + needle.length;
  }
  return matches;
}

function unsafeStructureBetween(paragraph: DocxParagraph, startNode: DocxTextNode, endNode: DocxTextNode): boolean {
  if (startNode === endNode) return false;
  const localStart = startNode.elementEnd - paragraph.elementStart;
  const localEnd = endNode.elementStart - paragraph.elementStart;
  const between = paragraph.raw.slice(Math.max(0, localStart), Math.max(0, localEnd));
  return /<\/?(?:[A-Za-z_][\w.-]*:)?(?:tab|br|cr|sym|hyperlink|bookmarkStart|bookmarkEnd|commentRangeStart|commentRangeEnd|commentReference|footnoteReference|endnoteReference|sdt)\b/iu.test(between);
}

function renderDocxTextNode(node: DocxTextNode, text: string): string {
  let openTag = node.openTag;
  if (/^\s|\s$/u.test(text) && !/\bxml:space\s*=/iu.test(openTag)) {
    openTag = openTag.replace(/>$/u, ' xml:space="preserve">');
  }
  return `${openTag}${encodeXmlText(text)}${node.closeTag}`;
}

/**
 * Exact, fidelity-first DOCX edit. It patches only `word/document.xml` text
 * nodes and keeps the uncompressed bytes of every other package part intact.
 * The caller writes `result.buffer` to a new path atomically.
 */
export function editDocxTextBuffer(
  buffer: Buffer,
  replacements: readonly DocxTextReplacement[],
): DocxEditResult {
  if (buffer.byteLength === 0) throw new DocumentToolError("corrupt", "这份 Word 文档是空的，无法修改。");
  if (buffer.byteLength > DOCUMENT_INPUT_MAX_BYTES) {
    throw new DocumentToolError("too_large", "这份文件超过 30 MB，当前版本暂不修改。");
  }
  const clean = normalizeDocxTextReplacements(replacements);
  const entries = unzipOffice(buffer);
  const documentBytes = entries["word/document.xml"];
  if (!documentBytes) throw new DocumentToolError("corrupt", "这份 Word 文档缺少正文结构。");
  const xml = xmlDecoder.decode(documentBytes);
  const paragraphs = parseDocxParagraphs(xml);
  if (paragraphs.length === 0) throw new DocumentToolError("corrupt", "这份 Word 文档没有可修改的正文文字。");

  const matches: DocxMatch[] = [];
  for (const replacement of clean) {
    const found = paragraphs.flatMap((paragraph) =>
      literalMatches(paragraph.text, replacement.find).map((range) => ({ paragraph, ...range })));
    if (found.length !== replacement.expectedMatches) {
      throw new DocumentToolError(
        "invalid_input",
        `“${replacement.find.slice(0, 80)}”预期找到 ${replacement.expectedMatches} 处，实际找到 ${found.length} 处；文件没有修改。`,
      );
    }
    for (const match of found) {
      if (match.paragraph.complex) {
        throw new DocumentToolError("invalid_input", "目标文字位于域、修订或嵌入对象等复杂结构中；文件没有修改。");
      }
      matches.push({ ...match, replace: replacement.replace });
    }
  }

  const paragraphOrder = new Map(paragraphs.map((paragraph, index) => [paragraph, index]));
  matches.sort((left, right) => {
    const paragraphDelta = (paragraphOrder.get(left.paragraph) ?? 0) - (paragraphOrder.get(right.paragraph) ?? 0);
    return paragraphDelta || left.start - right.start || left.end - right.end;
  });
  for (let index = 1; index < matches.length; index += 1) {
    const previous = matches[index - 1];
    const current = matches[index];
    if (previous.paragraph === current.paragraph && current.start < previous.end) {
      throw new DocumentToolError("invalid_input", "两项 Word 文字替换发生重叠；文件没有修改。");
    }
  }

  const nodeEdits = new Map<DocxTextNode, { start: number; end: number; replace: string }[]>();
  const addEdit = (node: DocxTextNode, start: number, end: number, replace: string): void => {
    const edits = nodeEdits.get(node) ?? [];
    edits.push({ start, end, replace });
    nodeEdits.set(node, edits);
  };

  for (const match of matches) {
    const involved = match.paragraph.nodes.filter((node) => (
      match.start < node.logicalEnd && match.end > node.logicalStart
    ));
    const first = involved[0];
    const last = involved.at(-1);
    if (!first || !last) throw xmlError("Word 正文文字位置无法安全映射。");
    if (unsafeStructureBetween(match.paragraph, first, last)) {
      throw new DocumentToolError("invalid_input", "目标文字跨过了复杂结构；文件没有修改。");
    }
    if (first === last) {
      addEdit(first, match.start - first.logicalStart, match.end - first.logicalStart, match.replace);
      continue;
    }
    addEdit(first, match.start - first.logicalStart, first.text.length, match.replace);
    for (const node of involved.slice(1, -1)) addEdit(node, 0, node.text.length, "");
    addEdit(last, 0, match.end - last.logicalStart, "");
  }

  const patches = [...nodeEdits.entries()].map(([node, edits]) => {
    let text = node.text;
    for (const edit of edits.sort((left, right) => right.start - left.start)) {
      text = `${text.slice(0, edit.start)}${edit.replace}${text.slice(edit.end)}`;
    }
    return { start: node.elementStart, end: node.elementEnd, value: renderDocxTextNode(node, text) };
  }).sort((left, right) => right.start - left.start);

  let editedXml = xml;
  for (const patch of patches) {
    editedXml = `${editedXml.slice(0, patch.start)}${patch.value}${editedXml.slice(patch.end)}`;
  }
  validateEditableXml(editedXml);
  entries["word/document.xml"] = strToU8(editedXml);
  return {
    buffer: Buffer.from(zipSync(entries, { level: 6 })),
    replacements: matches.length,
    changedParts: ["word/document.xml"],
  };
}

function parseXml(bytes: Uint8Array): unknown {
  const xml = xmlDecoder.decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new DocumentToolError("corrupt", "这份 Office 文件包含不受支持的 XML 声明。");
  }
  return xmlParser.parse(xml) as unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function scalar(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const record = asRecord(value);
  if (!record) return "";
  if ("#text" in record) return scalar(record["#text"]);
  return "";
}

function collectNamedText(value: unknown, tagName: string, output: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) collectNamedText(entry, tagName, output);
    return output;
  }
  const record = asRecord(value);
  if (!record) return output;
  for (const [key, entry] of Object.entries(record)) {
    if (key === tagName) {
      if (Array.isArray(entry)) {
        for (const item of entry) {
          const text = scalar(item);
          if (text) output.push(text);
          else collectNamedText(item, tagName, output);
        }
      } else {
        const text = scalar(entry);
        if (text) output.push(text);
        else collectNamedText(entry, tagName, output);
      }
    } else {
      collectNamedText(entry, tagName, output);
    }
  }
  return output;
}

function readPptx(
  buffer: Buffer,
  options: NormalizedReadDocumentOptions,
): DocumentReadResult {
  const entries = unzipOffice(buffer);
  const slides = Object.keys(entries)
    .map((name) => ({ name, match: /^ppt\/slides\/slide(\d+)\.xml$/i.exec(name) }))
    .filter((entry): entry is { name: string; match: RegExpExecArray } => entry.match !== null)
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]));
  if (slides.length === 0) throw new DocumentToolError("corrupt", "这份演示文稿里没有可读取的幻灯片。");
  const text = slides.map((slide, index) => {
    const items = collectNamedText(parseXml(entries[slide.name]), "t")
      .map((item) => item.trim())
      .filter(Boolean);
    return `## 幻灯片 ${index + 1}\n${items.join("\n")}`;
  }).join("\n\n");
  return result("pptx", buffer, text, options, { slides: slides.length });
}

function relationshipTarget(target: string): string {
  const normalized = target.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized.startsWith("xl/") ? normalized : path.posix.normalize(`xl/${normalized}`);
}

function cellColumnIndex(reference: string): number {
  const letters = /^([A-Za-z]+)/.exec(reference)?.[1]?.toUpperCase() ?? "A";
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, index - 1);
}

function cellValue(cell: Record<string, unknown>, sharedStrings: readonly string[]): string {
  const type = scalar(cell["@t"]);
  const raw = scalar(cell.v);
  if (type === "s") return sharedStrings[Number(raw)] ?? "";
  if (type === "inlineStr") return collectNamedText(cell.is, "t").join("");
  if (type === "b") return raw === "1" ? "TRUE" : "FALSE";
  if (type === "str") return raw;
  const formula = scalar(cell.f);
  return raw || (formula ? `=${formula}` : "");
}

function readXlsx(
  buffer: Buffer,
  options: NormalizedReadDocumentOptions,
): DocumentReadResult {
  const entries = unzipOffice(buffer);
  const workbookBytes = entries["xl/workbook.xml"];
  const relationshipBytes = entries["xl/_rels/workbook.xml.rels"];
  if (!workbookBytes || !relationshipBytes) {
    throw new DocumentToolError("corrupt", "这份 Excel 文件缺少工作簿结构。");
  }
  const workbook = asRecord(parseXml(workbookBytes));
  const workbookNode = asRecord(workbook?.workbook);
  const sheetList = asRecord(workbookNode?.sheets)?.sheet;
  const sheets = asArray(sheetList).map(asRecord).filter((sheet): sheet is Record<string, unknown> => !!sheet);

  const relationships = asRecord(parseXml(relationshipBytes));
  const relationshipList = asRecord(relationships?.Relationships)?.Relationship;
  const targets = new Map<string, string>();
  for (const relationship of asArray(relationshipList).map(asRecord)) {
    if (!relationship) continue;
    const id = scalar(relationship["@Id"]);
    const target = scalar(relationship["@Target"]);
    if (id && target) targets.set(id, relationshipTarget(target));
  }

  const sharedBytes = entries["xl/sharedStrings.xml"];
  const sharedRoot = sharedBytes ? asRecord(parseXml(sharedBytes)) : undefined;
  const sharedItems = asArray(asRecord(sharedRoot?.sst)?.si);
  const sharedStrings = sharedItems.map((item) => collectNamedText(item, "t").join(""));

  const blocks: string[] = [];
  for (const [sheetIndex, sheet] of sheets.entries()) {
    const name = scalar(sheet["@name"]) || `工作表 ${sheetIndex + 1}`;
    const relationId = scalar(sheet["@id"]);
    const target = targets.get(relationId);
    if (!target || !entries[target]) continue;
    const worksheet = asRecord(parseXml(entries[target]));
    const worksheetNode = asRecord(worksheet?.worksheet);
    const rows = asArray(asRecord(worksheetNode?.sheetData)?.row).map(asRecord);
    const rendered: string[] = [];
    for (const row of rows) {
      if (!row) continue;
      const values: string[] = [];
      for (const cell of asArray(row.c).map(asRecord)) {
        if (!cell) continue;
        const column = cellColumnIndex(scalar(cell["@r"]));
        while (values.length <= column) values.push("");
        values[column] = cellValue(cell, sharedStrings).replace(/[\r\n\t]+/g, " ").trim();
      }
      while (values.at(-1) === "") values.pop();
      if (values.length > 0) rendered.push(values.join("\t"));
    }
    blocks.push(`## 工作表：${name}\n${rendered.join("\n")}`);
  }
  if (blocks.length === 0) throw new DocumentToolError("corrupt", "这份 Excel 文件里没有可读取的工作表。");
  return result("xlsx", buffer, blocks.join("\n\n"), options, { sheets: blocks.length });
}

function requiredText(value: unknown, label: string, maxChars = MAX_BODY_CHARS): string {
  if (typeof value !== "string") {
    throw new DocumentToolError("invalid_input", `${label}必须是文字。`);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new DocumentToolError("invalid_input", `${label}不能为空。`);
  if (trimmed.length > maxChars) {
    throw new DocumentToolError("invalid_input", `${label}太长了，请控制在 ${maxChars} 字以内。`);
  }
  return trimmed;
}

function optionalText(value: unknown, label: string, maxChars = MAX_BODY_CHARS): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, label, maxChars);
}

function validateDocxDraft(draft: DocxDraft): DocxDraft {
  const title = requiredText(draft.title, "标题", MAX_TITLE_CHARS);
  const subtitle = optionalText(draft.subtitle, "副标题", MAX_TITLE_CHARS);
  if (!Array.isArray(draft.sections) || draft.sections.length === 0 || draft.sections.length > MAX_DOCX_SECTIONS) {
    throw new DocumentToolError("invalid_input", `Word 文档需要 1 到 ${MAX_DOCX_SECTIONS} 个章节。`);
  }
  let itemCount = 0;
  const sections = draft.sections.map((section, sectionIndex) => {
    const heading = optionalText(section.heading, `第 ${sectionIndex + 1} 个章节标题`, MAX_TITLE_CHARS);
    const paragraphs = (section.paragraphs ?? []).map((item, itemIndex) =>
      requiredText(item, `第 ${sectionIndex + 1} 章第 ${itemIndex + 1} 段`));
    const bullets = (section.bullets ?? []).map((item, itemIndex) =>
      requiredText(item, `第 ${sectionIndex + 1} 章第 ${itemIndex + 1} 个要点`));
    itemCount += paragraphs.length + bullets.length;
    if (!heading && paragraphs.length === 0 && bullets.length === 0) {
      throw new DocumentToolError("invalid_input", `第 ${sectionIndex + 1} 个章节没有内容。`);
    }
    return { ...(heading ? { heading } : {}), paragraphs, bullets };
  });
  if (itemCount > MAX_DOCX_ITEMS) {
    throw new DocumentToolError("invalid_input", `Word 文档最多包含 ${MAX_DOCX_ITEMS} 个段落或要点。`);
  }
  return { title, ...(subtitle ? { subtitle } : {}), sections };
}

export async function createDocxBuffer(draft: DocxDraft): Promise<Buffer> {
  const clean = validateDocxDraft(draft);
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: clean.title, bold: true })],
    }),
  ];
  if (clean.subtitle) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: clean.subtitle, italics: true, color: "667085" })],
    }));
  }
  for (const section of clean.sections) {
    if (section.heading) {
      children.push(new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_1 }));
    }
    for (const paragraph of section.paragraphs ?? []) children.push(new Paragraph(paragraph));
    for (const bullet of section.bullets ?? []) {
      children.push(new Paragraph({ text: bullet, bullet: { level: 0 } }));
    }
  }
  const document = new Document({
    creator: "Leemo",
    title: clean.title,
    description: "由 Leemo 创建",
    sections: [{ children }],
  });
  return Packer.toBuffer(document);
}

function validatePptxDraft(draft: PptxDraft): PptxDraft {
  const title = requiredText(draft.title, "标题", MAX_TITLE_CHARS);
  const subtitle = optionalText(draft.subtitle, "副标题", MAX_TITLE_CHARS);
  if (!Array.isArray(draft.slides) || draft.slides.length === 0 || draft.slides.length > MAX_PPTX_SLIDES) {
    throw new DocumentToolError("invalid_input", `演示文稿需要 1 到 ${MAX_PPTX_SLIDES} 页内容。`);
  }
  const slides = draft.slides.map((slide, slideIndex) => {
    const slideTitle = requiredText(slide.title, `第 ${slideIndex + 1} 页标题`, MAX_TITLE_CHARS);
    if (!Array.isArray(slide.bullets) || slide.bullets.length > MAX_PPTX_BULLETS) {
      throw new DocumentToolError("invalid_input", `第 ${slideIndex + 1} 页最多放 ${MAX_PPTX_BULLETS} 个要点。`);
    }
    const bullets = slide.bullets.map((bullet, bulletIndex) =>
      requiredText(bullet, `第 ${slideIndex + 1} 页第 ${bulletIndex + 1} 个要点`, MAX_PPTX_BULLET_CHARS));
    return { title: slideTitle, bullets };
  });
  return { title, ...(subtitle ? { subtitle } : {}), slides };
}

export async function createPptxBuffer(draft: PptxDraft): Promise<Buffer> {
  const clean = validatePptxDraft(draft);
  const presentation = new PptxGenJS();
  presentation.layout = "LAYOUT_WIDE";
  presentation.author = "Leemo";
  presentation.company = "Leemo";
  presentation.subject = clean.title;
  presentation.title = clean.title;
  presentation.theme = {
    headFontFace: "Microsoft YaHei",
    bodyFontFace: "Microsoft YaHei",
  };

  const titleSlide = presentation.addSlide();
  titleSlide.background = { color: "FAFAF8" };
  titleSlide.addText(clean.title, {
    x: 0.9, y: 2.2, w: 11.5, h: 0.8,
    fontFace: "Microsoft YaHei", fontSize: 30, bold: true, color: "202124",
    margin: 0,
  });
  if (clean.subtitle) {
    titleSlide.addText(clean.subtitle, {
      x: 0.92, y: 3.2, w: 10.8, h: 0.45,
      fontFace: "Microsoft YaHei", fontSize: 15, color: "667085", margin: 0,
    });
  }

  for (const slideDraft of clean.slides) {
    const slide = presentation.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addText(slideDraft.title, {
      x: 0.75, y: 0.55, w: 11.7, h: 0.55,
      fontFace: "Microsoft YaHei", fontSize: 23, bold: true, color: "202124", margin: 0,
    });
    if (slideDraft.bullets.length > 0) {
      slide.addText(slideDraft.bullets.map((bullet) => `• ${bullet}`).join("\n"), {
        x: 1.0, y: 1.45, w: 11.1, h: 5.1,
        fontFace: "Microsoft YaHei", fontSize: 18, color: "34373D",
        breakLine: false, margin: 0.08,
        valign: "top", lineSpacingMultiple: 1.15,
      });
    }
  }
  const output = await presentation.write({ outputType: "nodebuffer", compression: true });
  return Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer);
}

function validateXlsxDraft(draft: XlsxDraft): XlsxDraft {
  if (!Array.isArray(draft.sheets) || draft.sheets.length === 0 || draft.sheets.length > MAX_XLSX_SHEETS) {
    throw new DocumentToolError("invalid_input", `Excel 文件需要 1 到 ${MAX_XLSX_SHEETS} 个工作表。`);
  }
  let cellCount = 0;
  const names = new Set<string>();
  const sheets = draft.sheets.map((sheet, sheetIndex) => {
    const name = requiredText(sheet.name, `第 ${sheetIndex + 1} 个工作表名称`, 31);
    if (/[\\/?*:[\]]/.test(name)) {
      throw new DocumentToolError("invalid_input", `工作表名称“${name}”包含 Excel 不允许的字符。`);
    }
    const key = name.toLocaleLowerCase();
    if (names.has(key)) throw new DocumentToolError("invalid_input", `工作表名称“${name}”重复了。`);
    names.add(key);
    if (!Array.isArray(sheet.rows) || sheet.rows.length > MAX_XLSX_ROWS) {
      throw new DocumentToolError("invalid_input", `“${name}”最多支持 ${MAX_XLSX_ROWS} 行。`);
    }
    const rows = sheet.rows.map((row, rowIndex) => {
      if (!Array.isArray(row) || row.length > MAX_XLSX_COLUMNS) {
        throw new DocumentToolError("invalid_input", `“${name}”第 ${rowIndex + 1} 行最多支持 ${MAX_XLSX_COLUMNS} 列。`);
      }
      cellCount += row.length;
      return row.map((cell, columnIndex) => {
        if (cell === null || typeof cell === "boolean") return cell;
        if (typeof cell === "number") {
          if (!Number.isFinite(cell)) {
            throw new DocumentToolError("invalid_input", `“${name}”第 ${rowIndex + 1} 行第 ${columnIndex + 1} 列不是有限数字。`);
          }
          return cell;
        }
        if (typeof cell === "string" && cell.length <= MAX_BODY_CHARS) return cell;
        throw new DocumentToolError("invalid_input", `“${name}”里有不支持或过长的单元格。`);
      });
    });
    return { name, rows };
  });
  if (cellCount > MAX_XLSX_CELLS) {
    throw new DocumentToolError("invalid_input", `Excel 文件最多支持 ${MAX_XLSX_CELLS} 个单元格。`);
  }
  return { sheets };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function spreadsheetColumnName(index: number): string {
  let value = index;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output || "A";
}

function worksheetXml(sheet: XlsxSheetDraft): string {
  const columnCount = Math.max(1, ...sheet.rows.map((row) => row.length));
  const widths = Array.from({ length: columnCount }, (_, column) => {
    let width = 10;
    for (const row of sheet.rows) {
      const value = row[column];
      if (value !== undefined && value !== null) width = Math.max(width, String(value).length + 2);
    }
    return Math.min(40, width);
  });
  const cols = widths.map((width, index) =>
    `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const rows = sheet.rows.map((row, rowIndex) => {
    const cells = row.map((cell, columnIndex) => {
      if (cell === null) return "";
      const reference = `${spreadsheetColumnName(columnIndex + 1)}${rowIndex + 1}`;
      const style = rowIndex === 0 ? ` s="1"` : "";
      if (typeof cell === "string") {
        return `<c r="${reference}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`;
      }
      if (typeof cell === "boolean") return `<c r="${reference}" t="b"${style}><v>${cell ? 1 : 0}</v></c>`;
      return `<c r="${reference}"${style}><v>${cell}</v></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const lastCell = `${spreadsheetColumnName(columnCount)}${Math.max(1, sheet.rows.length)}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastCell}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${cols}</cols>
  <sheetData>${rows}</sheetData>
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}

export function createXlsxBuffer(draft: XlsxDraft): Buffer {
  const clean = validateXlsxDraft(draft);
  const overrides = clean.sheets.map((_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const sheetEntries = clean.sheets.map((sheet, index) =>
    `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const relationships = clean.sheets.map((_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  const styleRelationshipId = clean.sheets.length + 1;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${overrides}
</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews>
  <sheets>${sheetEntries}</sheets>
  <calcPr calcId="191029"/>
</workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${relationships}
  <Relationship Id="rId${styleRelationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF36B35"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`),
  };
  clean.sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheetXml(sheet));
  });
  return Buffer.from(zipSync(files, { level: 6 }));
}

const defaultAtomicWriteIO: AtomicWriteIO = {
  mkdir: async (directoryPath) => { await fs.mkdir(directoryPath, { recursive: true }); },
  stat: async (filePath) => fs.stat(filePath).then((entry) => entry.isFile()).catch(() => false),
  writeFile: async (filePath, contents) => { await fs.writeFile(filePath, contents); },
  rename: async (from, to) => { await fs.rename(from, to); },
  remove: async (filePath) => { await fs.rm(filePath, { force: true }); },
};

export async function writeDocumentAtomically(
  filePath: string,
  contents: Buffer,
  options: AtomicWriteOptions = {},
  io: AtomicWriteIO = defaultAtomicWriteIO,
): Promise<void> {
  if (!Buffer.isBuffer(contents) || contents.byteLength === 0) {
    throw new DocumentToolError("invalid_input", "没有可写入的文档内容。");
  }
  const target = path.resolve(filePath);
  const directory = path.dirname(target);
  const token = randomUUID();
  const temporary = path.join(directory, `.${path.basename(target)}.${token}.tmp`);
  const backup = path.join(directory, `.${path.basename(target)}.${token}.bak`);
  let backupCreated = false;
  try {
    await io.mkdir(directory);
    const exists = await io.stat(target);
    if (exists && !options.overwrite) {
      throw new DocumentToolError(
        "existing_file",
        `“${path.basename(target)}”已经存在；如需替换，请明确允许覆盖。`,
      );
    }
    await io.writeFile(temporary, contents);
    if (exists) {
      await io.rename(target, backup);
      backupCreated = true;
    }
    try {
      await io.rename(temporary, target);
    } catch (error) {
      if (backupCreated) {
        if (await io.stat(target)) await io.remove(target);
        await io.rename(backup, target);
        backupCreated = false;
      }
      throw error;
    }
    if (backupCreated) {
      await io.remove(backup);
      backupCreated = false;
    }
  } catch (error) {
    if (error instanceof DocumentToolError) throw error;
    throw new DocumentToolError(
      "io",
      `无法保存“${path.basename(target)}”，原文件没有被替换。`,
      error,
    );
  } finally {
    await io.remove(temporary).catch(() => undefined);
    if (backupCreated && !(await io.stat(target))) {
      await io.rename(backup, target).catch(() => undefined);
    }
    await io.remove(backup).catch(() => undefined);
  }
}
