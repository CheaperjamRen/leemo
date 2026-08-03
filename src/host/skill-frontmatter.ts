/**
 * Parse the top-level scalar fields used by Agent Skills without accepting the
 * rest of YAML as executable structure. This intentionally supports the block
 * descriptions used by official Skills while ignoring nested metadata fields.
 */
export function parseSkillFrontmatterFields(raw: string): Record<string, string> | undefined {
  const lines = raw.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  if (lines[0]?.trim() !== "---") return undefined;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) return undefined;

  const fields: Record<string, string> = {};
  const frontmatter = lines.slice(1, end);
  for (let index = 0; index < frontmatter.length; index += 1) {
    const line = frontmatter[index];
    if (!line || /^\s/u.test(line)) continue;
    const at = line.indexOf(":");
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    if (!key || !/^[a-zA-Z0-9_-]+$/u.test(key)) continue;
    let value = line.slice(at + 1).trim();
    const block = /^([|>])[-+]?$/u.exec(value);
    if (block) {
      const blockLines: string[] = [];
      let blockIndent: number | undefined;
      while (index + 1 < frontmatter.length) {
        const next = frontmatter[index + 1];
        if (!next.trim()) {
          blockLines.push("");
          index += 1;
          continue;
        }
        const indent = /^\s*/u.exec(next)?.[0].length ?? 0;
        if (indent === 0) break;
        blockIndent ??= indent;
        blockLines.push(next.slice(Math.min(blockIndent, indent)));
        index += 1;
      }
      while (blockLines.at(-1) === "") blockLines.pop();
      value = block[1] === "|"
        ? blockLines.join("\n")
        : blockLines.join(" ").replace(/\s+/gu, " ");
    }
    const quoted = /^(['"])(.*)\1$/u.exec(value);
    fields[key] = quoted ? quoted[2] : value;
  }
  return fields;
}
