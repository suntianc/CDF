export interface PaperCollectionCachePayload {
  searchedAt: string;
  consumedAt?: string;
  query: string;
  source: string;
  candidates: unknown[];
  journalMetricsByJournal: Record<string, unknown>;
}

export type PaperCollectionCacheIndexStatus = 'fresh' | 'consumed' | 'archived';

export interface PaperCollectionCacheIndexEntry {
  searchedAt: string;
  query: string;
  candidateCount: number;
  status: PaperCollectionCacheIndexStatus;
  archivePath?: string;
}

export interface PaperCollectionThreadState {
  readFile(path: string): string | undefined;
  writeFile(path: string, content: string): void;
  deleteFile(path: string): void;
  listFiles(prefix: string): string[];
}

export const PAPER_COLLECTION_CACHE_DIR = '/paper-collection-cache';
export const PAPER_COLLECTION_LATEST_PATH = `${PAPER_COLLECTION_CACHE_DIR}/latest.json`;
export const PAPER_COLLECTION_INDEX_PATH = `${PAPER_COLLECTION_CACHE_DIR}/index.json`;
export const PAPER_COLLECTION_ARCHIVE_DIR = `${PAPER_COLLECTION_CACHE_DIR}/archive`;
export const PAPER_COLLECTION_ARCHIVE_AFTER_MS = 30 * 60 * 1000;

export function createInMemoryPaperCollectionThreadState(
  initialFiles: Record<string, string> = {}
): PaperCollectionThreadState {
  const files = new Map(Object.entries(initialFiles));
  return {
    readFile(filePath) {
      return files.get(filePath);
    },
    writeFile(filePath, content) {
      files.set(filePath, content);
    },
    deleteFile(filePath) {
      files.delete(filePath);
    },
    listFiles(prefix) {
      return [...files.keys()].filter((filePath) => filePath.startsWith(prefix)).sort();
    },
  };
}

function assertIsoDateString(value: string, fieldName: string): void {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp) || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw new Error(`Invalid paper collection cache payload: ${fieldName} must be an ISO timestamp`);
  }
}

function assertRecord(value: unknown, fieldName: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid paper collection cache payload: ${fieldName} must be an object`);
  }
}

function assertPayload(value: PaperCollectionCachePayload): void {
  assertIsoDateString(value.searchedAt, 'searchedAt');
  if (value.consumedAt !== undefined) {
    assertIsoDateString(value.consumedAt, 'consumedAt');
  }
  if (!Array.isArray(value.candidates)) {
    throw new Error('Invalid paper collection cache payload: candidates must be an array');
  }
  assertRecord(value.journalMetricsByJournal, 'journalMetricsByJournal');
}

export function writeLatestPaperCollectionCache(
  threadState: PaperCollectionThreadState,
  payload: PaperCollectionCachePayload
): void {
  assertPayload(payload);
  threadState.writeFile(PAPER_COLLECTION_LATEST_PATH, `${JSON.stringify(payload, null, 2)}\n`);
}

export const writeLatest = writeLatestPaperCollectionCache;

export function readLatestPaperCollectionCache(
  threadState: PaperCollectionThreadState
): PaperCollectionCachePayload | undefined {
  const content = threadState.readFile(PAPER_COLLECTION_LATEST_PATH);
  if (content === undefined) return undefined;
  const payload = JSON.parse(content) as PaperCollectionCachePayload;
  assertPayload(payload);
  return payload;
}

export const readLatest = readLatestPaperCollectionCache;

function assertIndexEntry(entry: PaperCollectionCacheIndexEntry): void {
  assertIsoDateString(entry.searchedAt, 'searchedAt');
  if (!Number.isInteger(entry.candidateCount) || entry.candidateCount < 0) {
    throw new Error('Invalid paper collection cache index entry: candidateCount must be a non-negative integer');
  }
  if (!['fresh', 'consumed', 'archived'].includes(entry.status)) {
    throw new Error('Invalid paper collection cache index entry: status is unsupported');
  }
}

export function readPaperCollectionCacheIndex(
  threadState: PaperCollectionThreadState
): PaperCollectionCacheIndexEntry[] {
  const content = threadState.readFile(PAPER_COLLECTION_INDEX_PATH);
  if (content === undefined) return [];
  const entries = JSON.parse(content) as PaperCollectionCacheIndexEntry[];
  if (!Array.isArray(entries)) {
    throw new Error('Invalid paper collection cache index: expected an array');
  }
  for (const entry of entries) {
    assertIndexEntry(entry);
  }
  return entries;
}

export const readIndex = readPaperCollectionCacheIndex;

function writePaperCollectionCacheIndex(
  threadState: PaperCollectionThreadState,
  entries: PaperCollectionCacheIndexEntry[]
): void {
  threadState.writeFile(PAPER_COLLECTION_INDEX_PATH, `${JSON.stringify(entries, null, 2)}\n`);
}

export function appendPaperCollectionCacheIndex(
  threadState: PaperCollectionThreadState,
  entry: PaperCollectionCacheIndexEntry
): void {
  assertIndexEntry(entry);
  writePaperCollectionCacheIndex(threadState, [...readPaperCollectionCacheIndex(threadState), entry]);
}

export const appendToIndex = appendPaperCollectionCacheIndex;

export function markLatestPaperCollectionCacheConsumed(
  threadState: PaperCollectionThreadState,
  consumedAt: string
): PaperCollectionCachePayload | undefined {
  assertIsoDateString(consumedAt, 'consumedAt');
  const latest = readLatestPaperCollectionCache(threadState);
  if (!latest) return undefined;
  const consumed = { ...latest, consumedAt };
  writeLatestPaperCollectionCache(threadState, consumed);
  const index = readPaperCollectionCacheIndex(threadState).map((entry) =>
    entry.searchedAt === latest.searchedAt
      ? { ...entry, status: 'consumed' as const }
      : entry
  );
  writePaperCollectionCacheIndex(threadState, index);
  return consumed;
}

export const markLatestConsumed = markLatestPaperCollectionCacheConsumed;

function archivePathForSearchedAt(searchedAt: string): string {
  return `${PAPER_COLLECTION_ARCHIVE_DIR}/${searchedAt}.json`;
}

export function readPaperCollectionCacheArchive(
  threadState: PaperCollectionThreadState,
  archivePath: string
): PaperCollectionCachePayload | undefined {
  const content = threadState.readFile(archivePath);
  if (content === undefined) return undefined;
  const payload = JSON.parse(content) as PaperCollectionCachePayload;
  assertPayload(payload);
  return payload;
}

export const readArchive = readPaperCollectionCacheArchive;

export function maybeArchivePaperCollectionCache(
  threadState: PaperCollectionThreadState,
  now: Date
): { archived: boolean; archivePath?: string } {
  const latest = readLatestPaperCollectionCache(threadState);
  if (!latest?.consumedAt) return { archived: false };

  const consumedAt = Date.parse(latest.consumedAt);
  if (now.getTime() - consumedAt < PAPER_COLLECTION_ARCHIVE_AFTER_MS) {
    return { archived: false };
  }

  const archivePath = archivePathForSearchedAt(latest.searchedAt);
  threadState.writeFile(archivePath, `${JSON.stringify(latest, null, 2)}\n`);
  const index = readPaperCollectionCacheIndex(threadState).map((entry) =>
    entry.searchedAt === latest.searchedAt
      ? { ...entry, status: 'archived' as const, archivePath }
      : entry
  );
  writePaperCollectionCacheIndex(threadState, index);
  threadState.deleteFile(PAPER_COLLECTION_LATEST_PATH);

  return { archived: true, archivePath };
}

export const maybeArchive = maybeArchivePaperCollectionCache;
