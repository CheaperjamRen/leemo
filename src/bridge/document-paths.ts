/** Pure path projection shared by the host and renderer. It deliberately uses
 * no Node path API so the renderer can consume the exact same naming rule. */
export function defaultWordEditOutputPath(sourcePath: string): string {
  const trimmed = sourcePath.trim();
  const separator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const directory = separator >= 0 ? trimmed.slice(0, separator + 1) : "";
  const fileName = separator >= 0 ? trimmed.slice(separator + 1) : trimmed;
  const stem = fileName.replace(/\.docx$/iu, "");
  return `${directory}${stem}-修改版.docx`;
}
