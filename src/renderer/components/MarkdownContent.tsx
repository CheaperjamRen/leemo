import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Check, CircleAlert, Copy, Info, Lightbulb, OctagonAlert, TriangleAlert } from "lucide-react";
import { Highlight, themes, type Language } from "prism-react-renderer";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { noteIdFromReferenceHref } from "../notes/note-references";
import { normalizeLegacyMarkdown } from "./markdown-normalization";

export type MarkdownVariant = "answer" | "process" | "preview";

const ROOT_CLASSES: Record<MarkdownVariant, string> = {
  answer: "text-[14.5px] leading-[1.78]",
  process: "text-[12px] leading-[1.65]",
  preview: "text-sm leading-[1.75]",
};

const HEADING_CLASSES: Record<MarkdownVariant, [string, string, string]> = {
  answer: ["text-[17.5px]", "text-[16px]", "text-[14.5px]"],
  process: ["text-[13px]", "text-[12.5px]", "text-[12px]"],
  preview: ["text-xl", "text-lg", "text-base"],
};

const CALLOUTS = new Set(["note", "tip", "important", "warning", "caution"]);
const LEEMO_TABLE_METADATA = /^<!--\s*leemo-table:\s*widths=[\d.,\s]+\s*-->$/iu;

interface MarkdownAstNode {
  type?: string;
  value?: string;
  data?: Record<string, unknown>;
  children?: MarkdownAstNode[];
}

/** Keep Leemo's table sizing contract in Markdown without exposing it as document prose. */
function remarkLeemoMetadata() {
  return (tree: MarkdownAstNode) => {
    const strip = (node: MarkdownAstNode): void => {
      if (!node.children) return;
      node.children = node.children.filter((child) => !(
        child.type === "html" && LEEMO_TABLE_METADATA.test(child.value?.trim() ?? "")
      ));
      node.children.forEach(strip);
    };
    strip(tree);
  };
}

/** Render the one explicitly supported HTML extension without enabling raw HTML. */
function remarkFeishuUnderline() {
  return (tree: MarkdownAstNode) => {
    const transform = (node: MarkdownAstNode): void => {
      const children = node.children;
      if (!children) return;
      for (let index = 0; index < children.length; index += 1) {
        if (children[index]?.type !== "html" || children[index]?.value?.trim().toLowerCase() !== "<u>") continue;
        const closeIndex = children.findIndex((child, candidate) => candidate > index
          && child.type === "html"
          && child.value?.trim().toLowerCase() === "</u>");
        if (closeIndex < 0) continue;
        const inner = children.slice(index + 1, closeIndex);
        children.splice(index, closeIndex - index + 1, {
          type: "emphasis",
          data: { hName: "u" },
          children: inner,
        });
      }
      children.forEach(transform);
    };
    transform(tree);
  };
}

/** Turn GitHub-style callout blockquotes into semantic asides without enabling raw HTML. */
function remarkCallouts() {
  return (tree: {
    children?: Array<{
      type?: string;
      data?: Record<string, unknown>;
      children?: Array<{ type?: string; children?: Array<{ type?: string; value?: string }> }>;
    }>;
  }) => {
    for (const node of tree.children ?? []) {
      if (node.type !== "blockquote") continue;
      const first = node.children?.[0];
      const text = first?.type === "paragraph" ? first.children?.[0] : undefined;
      const match = text?.type === "text" ? /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(text.value ?? "") : null;
      if (!match || !text?.value) continue;
      const remaining = (node.children ?? [])
        .flatMap((child) => child.children ?? [])
        .map((child) => child.value ?? "")
        .join("")
        .replace(match[0], "")
        .replace(/^>\s*$/u, "")
        .trim();
      if (!remaining) continue;
      const type = match[1].toLowerCase();
      text.value = text.value.slice(match[0].length);
      node.data = {
        ...(node.data ?? {}),
        hName: "aside",
        hProperties: { "data-callout": type },
      };
    }
  };
}

function splitFrontmatter(source: string): { frontmatter: string | null; body: string } {
  const normalized = source.replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(normalized);
  if (!match) return { frontmatter: null, body: source };
  return { frontmatter: match[1], body: normalized.slice(match[0].length) };
}

function CopyButton({ text, label = "复制代码" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="inline-flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-[10.5px] text-[var(--leemo-ink-3)] transition-colors hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--leemo-amber-line)]"
    >
      {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
      {copied ? "已复制" : "复制"}
    </button>
  );
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const plainText = language === "" || language.toLocaleLowerCase() === "text" || language.toLocaleLowerCase() === "plain";
  return (
    <div className="group relative mb-[0.7em] max-w-full overflow-hidden rounded-[7px] border border-[var(--leemo-line)] bg-[var(--leemo-bg-deep)] last:mb-0">
      <div className="flex h-8 items-center justify-between border-b border-[var(--leemo-line-2)] px-2.5">
        <span className={`text-[10.5px] font-medium tracking-[0.04em] text-[var(--leemo-ink-3)] ${plainText ? "" : "uppercase"}`}>{plainText ? "纯文本" : language}</span>
        <CopyButton text={code} label={plainText ? "复制文本" : "复制代码"} />
      </div>
      <Highlight theme={themes.github} code={code.replace(/\n$/, "")} language={(language || "text") as Language}>
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <pre className={`${className} max-w-full overflow-x-auto p-3 font-mono text-[12px] leading-[1.65] [overflow-wrap:normal]`} style={{ ...style, background: "transparent" }}>
            {tokens.map((line, index) => (
              <div key={index} {...getLineProps({ line })}>
                {line.map((token, tokenIndex) => <span key={tokenIndex} {...getTokenProps({ token })} />)}
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    </div>
  );
}

let mermaidInitialized = false;

function MermaidBlock({ source }: { source: string }) {
  const rawId = useId();
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    hostRef.current?.replaceChildren();
    if (typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom")) return;
    let cancelled = false;
    void import("mermaid")
      .then(async ({ default: mermaid }) => {
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            theme: "base",
            flowchart: { htmlLabels: false },
          });
          mermaidInitialized = true;
        }
        const id = `leemo-mermaid-${rawId.replace(/[^a-z0-9_-]/gi, "")}`;
        const { svg, bindFunctions } = await mermaid.render(id, source);
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = svg;
        bindFunctions?.(hostRef.current);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "图表语法无法解析");
      });
    return () => {
      cancelled = true;
    };
  }, [rawId, source]);

  return (
    <div className="mb-[0.7em] max-w-full overflow-x-auto rounded-[7px] border border-[var(--leemo-line)] bg-[var(--leemo-bg)] p-3 last:mb-0" data-testid="mermaid-diagram">
      <div ref={hostRef} className="min-h-8 [&_svg]:mx-auto [&_svg]:max-w-full" />
      {(error || (typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom"))) && (
        <div>
          {error && <p className="mb-2 text-[11px] text-[var(--leemo-danger)]">图表没有渲染，已保留源码。</p>}
          <pre className="max-w-full overflow-x-auto whitespace-pre p-2 font-mono text-[12px] text-[var(--leemo-ink-2)]">{source}</pre>
          <CopyButton text={source} label="复制 Mermaid 源码" />
        </div>
      )}
    </div>
  );
}

function Callout({ type, children }: { type: string; children: ReactNode }) {
  const safeType = CALLOUTS.has(type) ? type : "note";
  const labels: Record<string, string> = {
    note: "说明",
    tip: "提示",
    important: "重要",
    warning: "注意",
    caution: "警告",
  };
  const icons: Record<string, typeof Info> = {
    note: Info,
    tip: Lightbulb,
    important: CircleAlert,
    warning: TriangleAlert,
    caution: OctagonAlert,
  };
  const Icon = icons[safeType] ?? Info;
  return (
    <aside
      data-testid="markdown-callout"
      data-callout={safeType}
      className="mb-[0.75em] flex items-start gap-3 rounded-[7px] border border-[var(--leemo-amber-line)] bg-[var(--leemo-amber-soft)] px-3 py-2 text-[var(--leemo-ink-2)] last:mb-0"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-label={labels[safeType]} />
      <div className="min-w-0 flex-1 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">{children}</div>
    </aside>
  );
}

export default function MarkdownContent({
  text,
  variant = "answer",
  className = "",
  onOpenLocalLink,
  onOpenNoteReference,
}: {
  text: string;
  variant?: MarkdownVariant;
  className?: string;
  /** Relative Markdown links are desktop workspace paths, not renderer URLs. */
  onOpenLocalLink?: (href: string) => void;
  /** Stable local document references stay inside Leemo's document library. */
  onOpenNoteReference?: (noteId: string) => void;
}) {
  const headings = HEADING_CLASSES[variant];
  const { frontmatter, body } = splitFrontmatter(normalizeLegacyMarkdown(text));

  return (
    <div
      data-testid="markdown-content"
      data-variant={variant}
      className={`min-w-0 max-w-full [overflow-wrap:anywhere] ${ROOT_CLASSES[variant]} ${className}`}
    >
      {frontmatter !== null && (
        <details data-testid="markdown-frontmatter" className="mb-3 rounded-[6px] border border-[var(--leemo-line)] bg-[var(--leemo-bg-deep)] px-3 py-2 text-[11px] text-[var(--leemo-ink-2)]">
          <summary className="cursor-pointer select-none font-medium text-[var(--leemo-ink-3)]">文档信息</summary>
          <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap font-mono leading-5">{frontmatter}</pre>
        </details>
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkLeemoMetadata, remarkFeishuUnderline, remarkCallouts]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={(url) => url.startsWith("leemo-note://") ? url : defaultUrlTransform(url)}
        components={{
          p: ({ children }) => <p className="mb-[0.65em] last:mb-0">{children}</p>,
          h1: ({ children }) => <h1 className={`mb-[0.55em] mt-[1em] first:mt-0 font-semibold leading-[1.45] text-[var(--leemo-ink)] ${headings[0]}`}>{children}</h1>,
          h2: ({ children }) => <h2 className={`mb-[0.5em] mt-[0.9em] first:mt-0 font-semibold leading-[1.5] text-[var(--leemo-ink)] ${headings[1]}`}>{children}</h2>,
          h3: ({ children }) => <h3 className={`mb-[0.45em] mt-[0.8em] first:mt-0 font-semibold leading-[1.55] text-[var(--leemo-ink)] ${headings[2]}`}>{children}</h3>,
          ul: ({ children, className: listClassName }) => (
            <ul className={`mb-[0.65em] list-disc space-y-[0.2em] pl-5 last:mb-0 [&.contains-task-list]:list-none [&.contains-task-list]:pl-0 ${listClassName ?? ""}`}>{children}</ul>
          ),
          ol: ({ children }) => <ol className="mb-[0.65em] list-decimal space-y-[0.2em] pl-5 last:mb-0">{children}</ol>,
          li: ({ children, className: itemClassName }) => (
            <li className={`pl-0.5 marker:text-[var(--leemo-ink-3)] [&.task-list-item]:list-none ${itemClassName ?? ""}`}>{children}</li>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mb-[0.7em] border-l-2 border-[var(--leemo-amber-line)] pl-3 text-[var(--leemo-ink-2)] last:mb-0">{children}</blockquote>
          ),
          aside: ({ children, node: _node, ...props }) => {
            const calloutProps = props as Record<string, unknown>;
            return <Callout type={String(calloutProps["data-callout"] ?? "note")}>{children}</Callout>;
          },
          u: ({ children }) => <u className="decoration-[var(--leemo-amber-line)] decoration-1 underline-offset-[3px]">{children}</u>,
          code: ({ children, className: codeClassName }) => {
            const code = String(children);
            const language = /language-([^\s]+)/.exec(codeClassName ?? "")?.[1] ?? "";
            const fenced = Boolean(language) || code.endsWith("\n");
            if (!fenced) {
              return <code className="rounded bg-[var(--leemo-bg-deep)] px-1 py-0.5 font-mono text-[0.92em]">{children}</code>;
            }
            if (language === "mermaid") return <MermaidBlock source={code.replace(/\n$/, "")} />;
            return <CodeBlock code={code} language={language} />;
          },
          pre: ({ children }) => <>{children}</>,
          a: ({ href, children }) => {
            const noteReference = href ? noteIdFromReferenceHref(href) : null;
            const malformedNoteReference = Boolean(href?.startsWith("leemo-note://") && !noteReference);
            const internal = href?.startsWith("#");
            const external = Boolean(href && (/^https?:\/\//i.test(href) || href.startsWith("//")));
            const local = Boolean(href && !noteReference && !malformedNoteReference && !internal && !external);
            return (
              <a
                href={href}
                target={external ? "_blank" : undefined}
                rel={external ? "noopener noreferrer" : undefined}
                onClick={noteReference
                  ? (event: MouseEvent<HTMLAnchorElement>) => {
                      event.preventDefault();
                      onOpenNoteReference?.(noteReference);
                    }
                  : malformedNoteReference
                    ? (event: MouseEvent<HTMLAnchorElement>) => event.preventDefault()
                    : local
                  ? (event: MouseEvent<HTMLAnchorElement>) => {
                      event.preventDefault();
                      onOpenLocalLink?.(href!);
                    }
                  : undefined}
                className="font-medium text-[var(--leemo-amber-ink)] underline decoration-[var(--leemo-amber-line)] decoration-1 underline-offset-[3px] transition-colors hover:text-[var(--leemo-amber)] focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--leemo-amber-line)]"
              >
                {children}
                {(external || local) && <span className="ml-0.5 text-[0.85em]" aria-hidden>↗</span>}
              </a>
            );
          },
          img: ({ src, alt }) => <img src={src} alt={alt ?? ""} loading="lazy" className="my-2 h-auto max-w-full rounded-[6px]" />,
          table: ({ children }) => (
            <div className="my-2 max-w-full overflow-x-auto rounded-[6px] border border-[var(--leemo-line)]"><table className="w-full min-w-[420px] border-collapse text-left text-[0.92em]">{children}</table></div>
          ),
          thead: ({ children }) => <thead className="bg-[var(--leemo-bg-deep)] text-[var(--leemo-ink-2)]">{children}</thead>,
          th: ({ children }) => <th className="border-b border-r border-[var(--leemo-line)] px-2.5 py-2 font-semibold last:border-r-0">{children}</th>,
          td: ({ children }) => <td className="border-b border-r border-[var(--leemo-line-2)] px-2.5 py-2 align-top last:border-r-0">{children}</td>,
          tr: ({ children }) => <tr className="last:[&>td]:border-b-0">{children}</tr>,
          input: ({ node: _node, ...props }) => <input {...props} className="mr-1.5 translate-y-[1px] accent-[var(--leemo-amber)]" />,
          hr: () => <hr className="my-3 border-0 border-t border-[var(--leemo-line)]" />,
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
