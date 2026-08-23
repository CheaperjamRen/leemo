export interface DocumentRecoveryRecord {
  key: string;
  noteId: string | null;
  baseRevision: number | null;
  title: string;
  markdown: string;
  updatedAt: number;
}

interface DocumentRecoveryEnvelope {
  version: 1;
  records: Record<string, DocumentRecoveryRecord>;
}

const STORAGE_KEY = "leemo:document-recovery:v1";
const MAX_RECORDS = 128;

function storageOrNull(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function validRecord(value: unknown): value is DocumentRecoveryRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<DocumentRecoveryRecord>;
  return typeof record.key === "string"
    && (record.key.startsWith("note:") || record.key.startsWith("new:"))
    && (typeof record.noteId === "string" || record.noteId === null)
    && (typeof record.baseRevision === "number" || record.baseRevision === null)
    && typeof record.title === "string"
    && typeof record.markdown === "string"
    && typeof record.updatedAt === "number"
    && Number.isFinite(record.updatedAt);
}

function readEnvelope(storage = storageOrNull()): DocumentRecoveryEnvelope {
  if (!storage) return { version: 1, records: {} };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, records: {} };
    const value = JSON.parse(raw) as Partial<DocumentRecoveryEnvelope>;
    if (value.version !== 1 || !value.records || typeof value.records !== "object") {
      return { version: 1, records: {} };
    }
    const records = Object.fromEntries(
      Object.entries(value.records).filter(([, record]) => validRecord(record)),
    );
    return { version: 1, records };
  } catch {
    return { version: 1, records: {} };
  }
}

function writeEnvelope(envelope: DocumentRecoveryEnvelope, storage = storageOrNull()): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // A full or unavailable recovery buffer must never block the real editor.
  }
}

export function readDocumentRecovery(key: string): DocumentRecoveryRecord | null {
  return readEnvelope().records[key] ?? null;
}

export function latestNewDocumentRecovery(): DocumentRecoveryRecord | null {
  return Object.values(readEnvelope().records)
    .filter((record) => record.noteId === null && record.key.startsWith("new:"))
    .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
}

export function writeDocumentRecovery(record: DocumentRecoveryRecord): void {
  if (!validRecord(record)) return;
  const envelope = readEnvelope();
  const nextRecords = {
    ...envelope.records,
    [record.key]: { ...record },
  };
  const trimmed = Object.fromEntries(
    Object.values(nextRecords)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_RECORDS)
      .map((item) => [item.key, item]),
  );
  writeEnvelope({ version: 1, records: trimmed });
}

export function removeDocumentRecovery(key: string): void {
  const envelope = readEnvelope();
  if (!Object.prototype.hasOwnProperty.call(envelope.records, key)) return;
  const records = { ...envelope.records };
  delete records[key];
  writeEnvelope({ version: 1, records });
}
