/** Repairs the narrow legacy corruption produced by Markdown-as-plain-text paste. */
export function normalizeLegacyMarkdown(source: string): string {
  if (!source) return source;
  let normalized = source.replace(/\\\*\\\*/gu, "**").replace(/\\_\\_/gu, "__");
  // Older captures could persist an empty callout marker without any body.
  // Keep the document blank rather than exposing the implementation syntax.
  normalized = normalized.replace(/^\s*>\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\r?\n(?:\s*>\s*)?(?=\r?\n|$)/gimu, "");
  const normalizeMath = (value: string): string => value.replace(/\\\\(?=[A-Za-z])/gu, "\\").replace(/\\_/gu, "_");
  normalized = normalized.replace(/(\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\n])*\$)/gu, (match) => {
    if (match.startsWith("$$")) return `$$${normalizeMath(match.slice(2, -2))}$$`;
    return `$${normalizeMath(match.slice(1, -1))}$`;
  });
  return normalized;
}

export function markdownPreviewText(source: string, maxLength = 120): string {
  const normalized = normalizeLegacyMarkdown(source)
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, "")
    .replace(/^\s*>\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*>?\s*$/gimu, "")
    .replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/gmu, "")
    .replace(/^\s*\[[ xX]\]\s*/gmu, "")
    .replace(/```[\s\S]*?```/gu, "")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/[*_~]+/gu, "")
    .replace(/^\s*[>|]+\s*/gmu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized.slice(0, maxLength);
}
