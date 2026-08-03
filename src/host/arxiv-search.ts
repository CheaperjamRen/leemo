import type { AcademicPaper, AcademicSearchOutcome } from "../bridge/contract";

const ARXIV_ENDPOINT = "https://export.arxiv.org/api/query";
const MAX_RESULTS = 8;
const DEFAULT_MIN_INTERVAL_MS = 3_000;
const DEFAULT_CACHE_TTL_MS = 10 * 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;

interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  parts: Array<string | XmlNode>;
}

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    const radix = lower.startsWith("#x") ? 16 : 10;
    const raw = lower.slice(radix === 16 ? 2 : 1);
    const codePoint = Number.parseInt(raw, radix);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
  });
}

function findTagEnd(xml: string, start: number): number {
  let quote = "";
  for (let i = start; i < xml.length; i += 1) {
    const char = xml[i]!;
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return i;
    }
  }
  return -1;
}

function parseTag(raw: string): { name: string; attributes: Record<string, string>; selfClosing: boolean } {
  let cursor = 0;
  const skipSpace = () => {
    while (cursor < raw.length && /\s/.test(raw[cursor]!)) cursor += 1;
  };
  skipSpace();
  const nameStart = cursor;
  while (cursor < raw.length && !/[\s/]/.test(raw[cursor]!)) cursor += 1;
  const name = raw.slice(nameStart, cursor);
  if (!name) throw new Error("XML opening tag has no name");
  const attributes: Record<string, string> = {};
  let selfClosing = false;

  while (cursor < raw.length) {
    skipSpace();
    if (raw[cursor] === "/") {
      selfClosing = true;
      cursor += 1;
      skipSpace();
      if (cursor !== raw.length) throw new Error("XML malformed self-closing tag");
      break;
    }
    if (cursor >= raw.length) break;
    const attrStart = cursor;
    while (cursor < raw.length && !/[\s=]/.test(raw[cursor]!)) cursor += 1;
    const attrName = raw.slice(attrStart, cursor);
    skipSpace();
    if (!attrName || raw[cursor] !== "=") throw new Error("XML malformed attribute");
    cursor += 1;
    skipSpace();
    const quote = raw[cursor];
    if (quote !== '"' && quote !== "'") throw new Error("XML attribute must be quoted");
    cursor += 1;
    const valueStart = cursor;
    while (cursor < raw.length && raw[cursor] !== quote) cursor += 1;
    if (cursor >= raw.length) throw new Error("XML unterminated attribute");
    attributes[attrName] = decodeXml(raw.slice(valueStart, cursor));
    cursor += 1;
  }
  return { name, attributes, selfClosing };
}

function parseXml(xml: string): XmlNode {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error("DTD/ENTITY is not allowed in arXiv XML");
  }
  const documentNode: XmlNode = { name: "#document", attributes: {}, parts: [] };
  const stack: XmlNode[] = [documentNode];
  let cursor = 0;

  while (cursor < xml.length) {
    if (xml[cursor] !== "<") {
      const end = xml.indexOf("<", cursor);
      const textEnd = end === -1 ? xml.length : end;
      stack.at(-1)!.parts.push(decodeXml(xml.slice(cursor, textEnd)));
      cursor = textEnd;
      continue;
    }
    if (xml.startsWith("<!--", cursor)) {
      const end = xml.indexOf("-->", cursor + 4);
      if (end === -1) throw new Error("XML unterminated comment");
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("<?", cursor)) {
      const end = xml.indexOf("?>", cursor + 2);
      if (end === -1) throw new Error("XML unterminated processing instruction");
      cursor = end + 2;
      continue;
    }
    if (xml.startsWith("<![CDATA[", cursor)) {
      const end = xml.indexOf("]]>", cursor + 9);
      if (end === -1) throw new Error("XML unterminated CDATA");
      stack.at(-1)!.parts.push(xml.slice(cursor + 9, end));
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("</", cursor)) {
      const end = xml.indexOf(">", cursor + 2);
      if (end === -1) throw new Error("XML unterminated closing tag");
      const name = xml.slice(cursor + 2, end).trim();
      const current = stack.pop();
      if (!current || current === documentNode || current.name !== name) {
        throw new Error("XML closing tag mismatch");
      }
      cursor = end + 1;
      continue;
    }
    if (xml.startsWith("<!", cursor)) throw new Error("XML declaration is not allowed");

    const end = findTagEnd(xml, cursor + 1);
    if (end === -1) throw new Error("XML unterminated opening tag");
    const parsed = parseTag(xml.slice(cursor + 1, end));
    const node: XmlNode = { name: parsed.name, attributes: parsed.attributes, parts: [] };
    stack.at(-1)!.parts.push(node);
    if (!parsed.selfClosing) stack.push(node);
    cursor = end + 1;
  }

  if (stack.length !== 1) throw new Error("XML contains unclosed tags");
  const roots = documentNode.parts.filter((part): part is XmlNode => typeof part !== "string");
  if (roots.length !== 1) throw new Error("XML must contain one root element");
  return roots[0]!;
}

function localName(node: XmlNode): string {
  return node.name.slice(node.name.lastIndexOf(":") + 1).toLowerCase();
}

function children(node: XmlNode, name: string): XmlNode[] {
  return node.parts.filter(
    (part): part is XmlNode => typeof part !== "string" && localName(part) === name,
  );
}

function first(node: XmlNode, name: string): XmlNode | undefined {
  return children(node, name)[0];
}

function nodeText(node: XmlNode | undefined): string {
  if (!node) return "";
  return node.parts
    .map((part) => typeof part === "string" ? part : nodeText(part))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedArxivUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.hostname !== "arxiv.org" && url.hostname !== "www.arxiv.org") return undefined;
    url.protocol = "https:";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function optionalText(node: XmlNode, name: string): string | undefined {
  const value = nodeText(first(node, name));
  return value || undefined;
}

export function parseArxivAtom(xml: string): AcademicPaper[] {
  const feed = parseXml(xml);
  if (localName(feed) !== "feed") throw new Error("XML root is not an Atom feed");
  const papers: AcademicPaper[] = [];
  for (const entry of children(feed, "entry")) {
    const rawId = nodeText(first(entry, "id"));
    const title = nodeText(first(entry, "title"));
    const abstract = nodeText(first(entry, "summary"));
    const links = children(entry, "link");
    const alternate = links.find((link) => link.attributes.rel === "alternate")?.attributes.href;
    const url = normalizedArxivUrl(alternate ?? rawId);
    if (!rawId || !title || !url) continue;
    const id = rawId.includes("/abs/") ? rawId.split("/abs/")[1]! : rawId;
    const pdf = links.find((link) =>
      link.attributes.type === "application/pdf" || link.attributes.title === "pdf"
    )?.attributes.href;
    const publishedAt = optionalText(entry, "published");
    const updatedAt = optionalText(entry, "updated");
    const pdfUrl = pdf ? normalizedArxivUrl(pdf) : undefined;
    papers.push({
      id,
      title,
      url,
      abstract,
      authors: children(entry, "author")
        .map((author) => nodeText(first(author, "name")))
        .filter(Boolean),
      ...(publishedAt ? { publishedAt } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      categories: children(entry, "category")
        .map((category) => category.attributes.term?.trim() ?? "")
        .filter(Boolean),
      ...(pdfUrl ? { pdfUrl } : {}),
    });
  }
  return papers.slice(0, MAX_RESULTS);
}

export interface ArxivSearchClientOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  minIntervalMs?: number;
  cacheTtlMs?: number;
  timeoutMs?: number;
}

export interface ArxivSearchClient {
  search(query: string): Promise<AcademicSearchOutcome>;
}

function clonePapers(papers: AcademicPaper[]): AcademicPaper[] {
  return papers.map((paper) => ({
    ...paper,
    authors: [...paper.authors],
    categories: [...paper.categories],
  }));
}

export function createArxivSearchClient(options: ArxivSearchClientOptions = {}): ArxivSearchClient {
  const fetchFn = options.fetchFn ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cache = new Map<string, { fetchedAt: number; papers: AcademicPaper[] }>();
  const inFlight = new Map<string, Promise<AcademicSearchOutcome>>();
  let lastStartedAt: number | undefined;
  let queue: Promise<void> = Promise.resolve();

  const search = async (rawQuery: string): Promise<AcademicSearchOutcome> => {
    const query = rawQuery.trim().replace(/\s+/g, " ");
    if (!query) throw new Error("学术检索：请输入论文主题");
    const key = query.toLocaleLowerCase("en-US");
    const cached = cache.get(key);
    if (cached && now() - cached.fetchedAt < cacheTtlMs) {
      return { query, papers: clonePapers(cached.papers), cached: true, fetchedAt: cached.fetchedAt };
    }
    const running = inFlight.get(key);
    if (running) return running;

    const pending = queue.then(async () => {
      if (lastStartedAt !== undefined) {
        const waitMs = Math.max(0, lastStartedAt + minIntervalMs - now());
        if (waitMs > 0) await sleep(waitMs);
      }
      lastStartedAt = now();
      const url = new URL(ARXIV_ENDPOINT);
      url.searchParams.set("search_query", `all:${query}`);
      url.searchParams.set("start", "0");
      url.searchParams.set("max_results", String(MAX_RESULTS));
      url.searchParams.set("sortBy", "relevance");
      url.searchParams.set("sortOrder", "descending");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetchFn(url.toString(), {
          method: "GET",
          headers: { "user-agent": "Leemo/0.0.1 (local desktop academic search)" },
          signal: controller.signal,
        });
      } catch {
        throw new Error("学术检索：网络错误或超时");
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) throw new Error(`学术检索：arXiv 暂不可用（HTTP ${response.status}）`);
      let papers: AcademicPaper[];
      try {
        papers = parseArxivAtom(await response.text());
      } catch {
        throw new Error("学术检索：arXiv 响应格式错误");
      }
      const fetchedAt = lastStartedAt;
      cache.set(key, { fetchedAt, papers: clonePapers(papers) });
      return { query, papers: clonePapers(papers), cached: false, fetchedAt };
    });
    queue = pending.then(() => undefined, () => undefined);
    inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      inFlight.delete(key);
    }
  };

  return { search };
}
