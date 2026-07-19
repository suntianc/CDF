import fs from 'fs';
import Database from 'better-sqlite3';

export interface ConversationWorkingStateStorageInspection {
  physicalBytes: number;
  estimatedReclaimableBytes: number;
}

const SQLITE_STORAGE_SUFFIXES = ['', '-wal', '-shm'] as const;

export function getConversationWorkingStatePhysicalBytes(databasePath: string): number {
  return SQLITE_STORAGE_SUFFIXES.reduce((total, suffix) => {
    const filePath = `${databasePath}${suffix}`;
    try {
      return total + fs.statSync(filePath).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return total;
      throw error;
    }
  }, 0);
}

export function inspectConversationWorkingStateStorage(
  databasePath: string
): ConversationWorkingStateStorageInspection {
  const physicalBytes = getConversationWorkingStatePhysicalBytes(databasePath);
  if (!fs.existsSync(databasePath) || physicalBytes === 0) {
    return { physicalBytes, estimatedReclaimableBytes: 0 };
  }

  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const pageSize = db.pragma('page_size', { simple: true }) as number;
    const pageCount = db.pragma('page_count', { simple: true }) as number;
    const freelistCount = db.pragma('freelist_count', { simple: true }) as number;
    const estimatedCompactedBytes = Math.max(0, pageCount - freelistCount) * pageSize;
    const estimatedReclaimableBytes = Math.max(
      0,
      Math.min(physicalBytes, physicalBytes - estimatedCompactedBytes)
    );
    return { physicalBytes, estimatedReclaimableBytes };
  } finally {
    db.close();
  }
}
