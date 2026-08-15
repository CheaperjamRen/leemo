export interface PdfReaderViewState {
  pageNumber: number;
  scaleValue: string;
  rotation: number;
  left: number;
  top: number;
}

const STORAGE_PREFIX = "leemo:pdf-reader:v1:";

export function clampPdfPage(value: number, pagesCount: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(1, Math.trunc(value)), Math.max(1, pagesCount));
}

export function normalizePdfRotation(value: number): number {
  const normalized = Math.round(value / 90) * 90 % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function pdfReaderStorageKey(fileId: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < fileId.length; index += 1) {
    hash ^= fileId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${STORAGE_PREFIX}${(hash >>> 0).toString(36)}`;
}

export function loadPdfReaderState(fileId: string): PdfReaderViewState | null {
  try {
    const raw = localStorage.getItem(pdfReaderStorageKey(fileId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PdfReaderViewState>;
    if (typeof value.pageNumber !== "number"
      || typeof value.scaleValue !== "string"
      || typeof value.rotation !== "number"
      || typeof value.left !== "number"
      || typeof value.top !== "number") return null;
    return {
      pageNumber: Math.max(1, Math.trunc(value.pageNumber)),
      scaleValue: value.scaleValue || "page-width",
      rotation: normalizePdfRotation(value.rotation),
      left: Number.isFinite(value.left) ? value.left : 0,
      top: Number.isFinite(value.top) ? value.top : 0,
    };
  } catch {
    return null;
  }
}

export function savePdfReaderState(fileId: string, state: PdfReaderViewState): void {
  try {
    localStorage.setItem(pdfReaderStorageKey(fileId), JSON.stringify({
      pageNumber: Math.max(1, Math.trunc(state.pageNumber)),
      scaleValue: state.scaleValue || "page-width",
      rotation: normalizePdfRotation(state.rotation),
      left: Number.isFinite(state.left) ? state.left : 0,
      top: Number.isFinite(state.top) ? state.top : 0,
    }));
  } catch {
    // Reading must still work when storage is unavailable or full.
  }
}

export function makePdfFileId(input: {
  workspaceId: string;
  path: string;
  size: number;
  mtimeMs?: number;
}): string {
  return `${input.workspaceId}\u0000${input.path}\u0000${input.size}\u0000${input.mtimeMs ?? "unknown"}`;
}
