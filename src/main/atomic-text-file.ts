import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

function sameFileVersion(
  left: fs.Stats,
  right: fs.Stats,
): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.mode === right.mode;
}

/**
 * Replace an existing UTF-8 text file without ever opening that file with a
 * truncating flag. The temporary file lives beside the target, so rename is a
 * single-filesystem atomic replacement. A second baseline check narrows the
 * unavoidable editor-vs-external-writer race to the final rename operation.
 */
export function atomicReplaceTextFile(
  target: string,
  contents: string,
  expectedText: string,
): void {
  const before = fs.statSync(target);
  if (fs.readFileSync(target, "utf8") !== expectedText) {
    throw new Error("文件已在其他地方发生了变化。你的草稿还在，请重新载入后再保存。");
  }

  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.leemo-${process.pid}-${randomUUID()}.tmp`,
  );
  let fd: number | null = null;
  try {
    fd = fs.openSync(temp, "wx", before.mode & 0o777);
    fs.writeFileSync(fd, contents, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.chmodSync(temp, before.mode & 0o777);

    const after = fs.statSync(target);
    if (!sameFileVersion(before, after) || fs.readFileSync(target, "utf8") !== expectedText) {
      throw new Error("文件已在其他地方发生了变化。你的草稿还在，请重新载入后再保存。");
    }
    fs.renameSync(temp, target);
  } finally {
    if (fd !== null) fs.closeSync(fd);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
