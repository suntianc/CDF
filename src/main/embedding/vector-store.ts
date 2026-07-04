import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { embedBatchWithProgress, type EmbeddingBatchProgress } from './embedding-queue';

export type EmbeddingMode = 'query' | 'passage';
export type EmbeddingSourceKind = 'local' | 'cloud';

export interface EmbeddingSource {
  id: string;
  model: string;
  kind: EmbeddingSourceKind;
  dims: number;
}

export interface TextEmbedder {
  readonly source: EmbeddingSource;
  embed(texts: string[], mode: EmbeddingMode): Promise<Float32Array[]>;
}

export interface VectorItemInput {
  id: string;
  text: string;
  metadata: Record<string, unknown>;
}

export interface VectorQueryResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface VectorCollectionInfo {
  name: string;
  sourceId: string;
  sourceKind: EmbeddingSourceKind;
  model: string;
  dims: number;
  count: number;
}

export interface VectorCollection {
  upsert(items: VectorItemInput[]): Promise<void>;
  query(text: string, topK: number): Promise<VectorQueryResult[]>;
  delete(ids: string[]): Promise<void>;
  info(): VectorCollectionInfo;
}

export interface VectorStore {
  collection(name: string): VectorCollection;
  close(): void;
}

export interface VectorStoreRebuildImpact {
  collections: number;
  items: number;
}

export interface VectorStoreInspector {
  rebuildImpactForSource(sourceId: string): VectorStoreRebuildImpact;
}

interface VectorStoreOptions {
  projectPath: string;
  embedder: TextEmbedder;
  batchSize?: number;
  signal?: AbortSignal;
  onProgress?: (event: EmbeddingBatchProgress) => void;
}

interface CollectionRow {
  id: number;
  name: string;
  source_id: string;
  source_kind: EmbeddingSourceKind;
  model: string;
  dims: number;
}

interface ItemRow {
  rowid: number;
  item_id: string;
  metadata_json: string;
}

export function createVectorStore(options: VectorStoreOptions): VectorStore {
  return new SqliteVectorStore(options);
}

export function inspectVectorStore(projectPath: string): VectorStoreInspector {
  return new SqliteVectorStoreInspector(getVectorDatabasePath(projectPath));
}

function getVectorDatabasePath(projectPath: string): string {
  return path.join(projectPath, '.cdf', 'vectors.db');
}

function ensureVectorDatabaseIgnored(projectPath: string): void {
  const gitignorePath = path.join(projectPath, '.gitignore');
  const ignoreEntry = '.cdf/vectors.db';
  const existing = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf-8')
    : '';
  if (existing.split(/\r?\n/).includes(ignoreEntry)) return;
  const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(gitignorePath, `${prefix}${ignoreEntry}\n`, 'utf-8');
}

function nowIso(): string {
  return new Date().toISOString();
}

function vectorTableName(collectionId: number): string {
  return `vec_collection_${collectionId}`;
}

function assertCollectionName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(name)) {
    throw new Error('Vector Index collection name must use letters, numbers, underscores, or hyphens.');
  }
}

function vectorToBlob(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

class SqliteVectorStore implements VectorStore {
  private readonly db: Database.Database;
  private readonly embedder: TextEmbedder;
  private readonly batchOptions: Pick<VectorStoreOptions, 'batchSize' | 'signal' | 'onProgress'>;

  constructor(options: VectorStoreOptions) {
    this.embedder = options.embedder;
    this.batchOptions = {
      batchSize: options.batchSize,
      signal: options.signal,
      onProgress: options.onProgress,
    };
    const dbPath = getVectorDatabasePath(options.projectPath);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    ensureVectorDatabaseIgnored(options.projectPath);
    this.db = new Database(dbPath);
    sqliteVec.load(this.db);
    this.initialize();
  }

  collection(name: string): VectorCollection {
    assertCollectionName(name);
    const row = this.getOrCreateCollection(name);
    if (row.source_id !== this.embedder.source.id) {
      throw new Error(
        `Vector Index "${name}" is bound to Embedding Source "${row.source_id}" and cannot be used with "${this.embedder.source.id}" without an explicit rebuild.`,
      );
    }
    return new SqliteVectorCollection(this.db, this.embedder, this.batchOptions, row);
  }

  close(): void {
    this.db.close();
  }

  private initialize(): void {
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vector_collections (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        source_id TEXT NOT NULL,
        source_kind TEXT NOT NULL CHECK (source_kind IN ('local', 'cloud')),
        model TEXT NOT NULL,
        dims INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS vector_items (
        rowid INTEGER PRIMARY KEY,
        collection_id INTEGER NOT NULL REFERENCES vector_collections(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL,
        text TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(collection_id, item_id)
      );
    `);
  }

  private getOrCreateCollection(name: string): CollectionRow {
    const existing = this.getCollection(name);
    if (existing) return existing;

    const timestamp = nowIso();
    const insert = this.db.prepare(`
      INSERT INTO vector_collections (name, source_id, source_kind, model, dims, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = insert.run(
      name,
      this.embedder.source.id,
      this.embedder.source.kind,
      this.embedder.source.model,
      this.embedder.source.dims,
      timestamp,
      timestamp,
    );
    const id = Number(result.lastInsertRowid);
    this.createVectorTable(id, this.embedder.source.dims);
    const created = this.getCollection(name);
    if (!created) {
      throw new Error(`Failed to create Vector Index collection "${name}".`);
    }
    return created;
  }

  private getCollection(name: string): CollectionRow | undefined {
    const row = this.db
      .prepare('SELECT id, name, source_id, source_kind, model, dims FROM vector_collections WHERE name = ?')
      .get(name) as CollectionRow | undefined;
    if (row) {
      this.createVectorTable(row.id, row.dims);
    }
    return row;
  }

  private createVectorTable(collectionId: number, dims: number): void {
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${vectorTableName(collectionId)}
      USING vec0(embedding float[${dims}] distance_metric=cosine)
    `);
  }
}

class SqliteVectorStoreInspector implements VectorStoreInspector {
  constructor(private readonly dbPath: string) {}

  rebuildImpactForSource(sourceId: string): VectorStoreRebuildImpact {
    if (!fs.existsSync(this.dbPath)) {
      return { collections: 0, items: 0 };
    }

    let db: Database.Database | undefined;
    try {
      db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
      const hasCollectionsTable = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vector_collections'")
        .get();
      if (!hasCollectionsTable) {
        return { collections: 0, items: 0 };
      }
      const row = db.prepare(`
        SELECT COUNT(DISTINCT c.id) AS collections, COUNT(i.rowid) AS items
        FROM vector_collections c
        LEFT JOIN vector_items i ON i.collection_id = c.id
        WHERE c.source_id != ?
      `).get(sourceId) as VectorStoreRebuildImpact;
      return {
        collections: row.collections,
        items: row.items,
      };
    } catch {
      return { collections: 0, items: 0 };
    } finally {
      db?.close();
    }
  }
}

class SqliteVectorCollection implements VectorCollection {
  constructor(
    private readonly db: Database.Database,
    private readonly embedder: TextEmbedder,
    private readonly batchOptions: Pick<VectorStoreOptions, 'batchSize' | 'signal' | 'onProgress'>,
    private readonly row: CollectionRow,
  ) {}

  async upsert(items: VectorItemInput[]): Promise<void> {
    if (items.length === 0) return;
    const vectors = await embedBatchWithProgress(this.embedder, items.map((item) => item.text), {
      mode: 'passage',
      batchSize: this.batchOptions.batchSize,
      signal: this.batchOptions.signal,
      onProgress: this.batchOptions.onProgress,
    });
    const tableName = vectorTableName(this.row.id);
    const timestamp = nowIso();

    const upsert = this.db.transaction(() => {
      const findExisting = this.db.prepare(
        'SELECT rowid FROM vector_items WHERE collection_id = ? AND item_id = ?',
      );
      const insertItem = this.db.prepare(`
        INSERT INTO vector_items (collection_id, item_id, text, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const updateItem = this.db.prepare(`
        UPDATE vector_items
        SET text = ?, metadata_json = ?, updated_at = ?
        WHERE rowid = ?
      `);
      const deleteVector = this.db.prepare(`DELETE FROM ${tableName} WHERE rowid = ?`);
      const insertVector = this.db.prepare(`INSERT INTO ${tableName}(rowid, embedding) VALUES (?, ?)`);

      items.forEach((item, index) => {
        const vector = vectors[index];
        this.assertVector(vector);
        const metadataJson = JSON.stringify(item.metadata);
        const existing = findExisting.get(this.row.id, item.id) as { rowid: number } | undefined;
        const rowid = existing?.rowid ?? Number(insertItem.run(
          this.row.id,
          item.id,
          item.text,
          metadataJson,
          timestamp,
          timestamp,
        ).lastInsertRowid);
        if (existing) {
          updateItem.run(item.text, metadataJson, timestamp, rowid);
          deleteVector.run(BigInt(rowid));
        }
        insertVector.run(BigInt(rowid), vectorToBlob(vector));
      });
    });

    upsert();
  }

  async query(text: string, topK: number): Promise<VectorQueryResult[]> {
    if (!Number.isInteger(topK) || topK < 1) {
      throw new Error('Vector Index query topK must be a positive integer.');
    }
    const [queryVector] = await this.embedder.embed([text], 'query');
    this.assertVector(queryVector);

    const tableName = vectorTableName(this.row.id);
    const matches = this.db.prepare(`
      SELECT rowid, distance
      FROM ${tableName}
      WHERE embedding MATCH ? AND k = ?
      ORDER BY distance
    `).all(vectorToBlob(queryVector), topK) as { rowid: number; distance: number }[];

    if (matches.length === 0) return [];

    const loadItem = this.db.prepare(`
      SELECT rowid, item_id, metadata_json
      FROM vector_items
      WHERE collection_id = ? AND rowid = ?
    `);
    return matches.flatMap((match) => {
      const item = loadItem.get(this.row.id, match.rowid) as ItemRow | undefined;
      if (!item) return [];
      return [{
        id: item.item_id,
        score: 1 - match.distance,
        metadata: JSON.parse(item.metadata_json) as Record<string, unknown>,
      }];
    });
  }

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const tableName = vectorTableName(this.row.id);
    const remove = this.db.transaction(() => {
      const findItem = this.db.prepare(
        'SELECT rowid FROM vector_items WHERE collection_id = ? AND item_id = ?',
      );
      const deleteItem = this.db.prepare(
        'DELETE FROM vector_items WHERE collection_id = ? AND item_id = ?',
      );
      const deleteVector = this.db.prepare(`DELETE FROM ${tableName} WHERE rowid = ?`);

      for (const id of ids) {
        const item = findItem.get(this.row.id, id) as { rowid: number } | undefined;
        if (!item) continue;
        deleteVector.run(BigInt(item.rowid));
        deleteItem.run(this.row.id, id);
      }
    });
    remove();
  }

  info(): VectorCollectionInfo {
    const count = this.db.prepare(
      'SELECT COUNT(*) AS count FROM vector_items WHERE collection_id = ?',
    ).get(this.row.id) as { count: number };
    return {
      name: this.row.name,
      sourceId: this.row.source_id,
      sourceKind: this.row.source_kind,
      model: this.row.model,
      dims: this.row.dims,
      count: count.count,
    };
  }

  private assertVector(vector: Float32Array): void {
    if (vector.length !== this.row.dims) {
      throw new Error(`Embedding Source "${this.row.source_id}" returned ${vector.length} dimensions; expected ${this.row.dims}.`);
    }
  }
}
