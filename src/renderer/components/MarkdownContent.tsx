import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export type MarkdownVariant = "answer" | "process" | "preview";

const ROOT_CLASSES: Record<MarkdownVariant, string> = {
  answer: "text-[13.5px] leading-[1.8]",
  process: "text-[12px] leading-[1.65]",
  preview: "text-sm leading-[1.75]",
};

const HEADING_CLASSES: Record<MarkdownVariant, [string, string, string]> = {
  answer: ["text-[16px]", "text-[14.5px]", "text-[13.5px]"],
  process: ["text-[13px]", "text-[12.5px]", "text-[12px]"],
  preview: ["text-xl", "text-lg", "text-base"],
};

export default function MarkdownContent({
  text,
  variant = "answer",
  className = "",
}: {
  text: string;
  variant?: MarkdownVariant;
  className?: string;
}) {
  const headings = HEADING_CLASSES[variant];

  return (
    <div
      data-testid="markdown-content"
      data-variant={variant}
      className={`min-w-0 max-w-full [overflow-wrap:anywhere] ${ROOT_CLASSES[variant]} ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-[0.65em] last:mb-0">{children}</p>,
          h1: ({ children }) => <h1 className={`mb-[0.55em] mt-[1em] first:mt-0 font-semibold leading-[1.45] text-[var(--leemo-ink)] ${headings[0]}`}>{children}</h1>,
          h2: ({ children }) => <h2 className={`mb-[0.5em] mt-[0.9em] first:mt-0 font-semibold leading-[1.5] text-[var(--leemo-ink)] ${headings[1]}`}>{children}</h2>,
          h3: ({ children }) => <h3 className={`mb-[0.45em] mt-[0.8em] first:mt-0 font-semibold leading-[1.55] text-[var(--leemo-ink)] ${headings[2]}`}>{children}</h3>,
          ul: ({ children, className: listClassName }) => (
            <ul className={`mb-[0.65em] list-disc space-y-[0.2em] pl-5 last:mb-0 ${listClassName ?? ""}`}>{children}</ul>
          ),
          ol: ({ children }) => <ol className="mb-[0.65em] list-decimal space-y-[0.2em] pl-5 last:mb-0">{children}</ol>,
          li: ({ children, className: itemClassName }) => (
            <li className={`pl-0.5 marker:text-[var(--leemo-ink-3)] ${itemClassName ?? ""}`}>{children}</li>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mb-[0.7em] border-l-2 border-[var(--leemo-amber-line)] pl-3 text-[var(--leemo-ink-2)] last:mb-0">
              {children}
            </blockquote>
          ),
          code: ({ children, className: codeClassName }) => (
            <code className={`rounded bg-[var(--leemo-bg-deep)] px-1 py-0.5 font-mono text-[0.92em] ${codeClassName ?? ""}`}>
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="mb-[0.7em] max-w-full overflow-x-auto rounded-[6px] border border-[var(--leemo-line)] bg-[var(--leemo-bg-deep)] p-3 font-mono text-[12px] leading-[1.65] [overflow-wrap:normal] last:mb-0 [&_code]:bg-transparent [&_code]:p-0">
              {children}
            </pre>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[var(--leemo-amber-ink)] underline decoration-[var(--leemo-amber-line)] decoration-1 underline-offset-[3px] transition-colors hover:text-[var(--leemo-amber)] focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--leemo-amber-line)]"
            >
              {children}
              <span className="ml-0.5 text-[0.85em]" aria-hidden>↗</span>
            </a>
          ),
          table: ({ children }) => (
            <div className="my-2 max-w-full overflow-x-auto rounded-[6px] border border-[var(--leemo-line)]">
              <table className="w-full min-w-[420px] border-collapse text-left text-[0.92em]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-[var(--leemo-bg-deep)] text-[var(--leemo-ink-2)]">{children}</thead>,
          th: ({ children }) => <th className="border-b border-r border-[var(--leemo-line)] px-2.5 py-2 font-semibold last:border-r-0">{children}</th>,
          td: ({ children }) => <td className="border-b border-r border-[var(--leemo-line-2)] px-2.5 py-2 align-top last:border-r-0">{children}</td>,
          tr: ({ children }) => <tr className="last:[&>td]:border-b-0">{children}</tr>,
          input: (props) => (
            <input
              {...props}
              className="mr-1.5 translate-y-[1px] accent-[var(--leemo-amber)]"
            />
          ),
          hr: () => <hr className="my-3 border-0 border-t border-[var(--leemo-line)]" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
