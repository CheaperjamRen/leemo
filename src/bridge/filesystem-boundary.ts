import fs from "node:fs";
import path from "node:path";

export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
/** Resolve junctions/symlinks even when the final target does not exist:
 * canonicalize its nearest existing ancestor, then append the missing tail. */
export function resolveThroughExistingAncestor(target: string): string | undefined {
  const absolute = path.resolve(target);
  let existing = absolute;
  const missing: string[] = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return undefined;
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  try {
    return path.resolve(fs.realpathSync.native(existing), ...missing);
  } catch {
    return undefined;
  }
}

/** Resolve one user/model supplied path against a cwd and prove its canonical
 * target remains within the canonical boundary. Undefined means fail closed. */
export function resolvePathWithinBoundary(
  boundaryRoot: string,
  cwdInput: string,
  candidate: string,
): string | undefined {
  const boundary = resolveThroughExistingAncestor(boundaryRoot);
  if (!boundary) return undefined;
  const cwd = resolveThroughExistingAncestor(path.resolve(cwdInput));
  if (!cwd || !isPathInside(boundary, cwd)) return undefined;
  const absolute = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(cwd, candidate);
  const resolved = resolveThroughExistingAncestor(absolute);
  return resolved && isPathInside(boundary, resolved) ? resolved : undefined;
}
