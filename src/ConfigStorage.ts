import Database from 'better-sqlite3';
type DatabaseType = InstanceType<typeof Database>;

export interface ConfigObjectRecord {
  id: string;
  objectType: string;
  name: string;
  synonym?: string;
  moduleFull: string;
  filePath: string;
  sizeBytes: number;
  hash: string;
  ollamaEmbedding?: Buffer;
}

interface SimilarModuleResult {
  name: string;
  objectType: string;
  snippet: string;
  similarity: number;
}

export class ConfigStorage {
  private db: DatabaseType;
  private ftsQueries = 0;
  private ftsTotalMs = 0;
  private likeQueries = 0;
  private likeTotalMs = 0;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS config_objects (
        id TEXT PRIMARY KEY,
        object_type TEXT NOT NULL,
        name TEXT NOT NULL,
        synonym TEXT,
        module_full TEXT,
        file_path TEXT,
        size_bytes INTEGER,
        hash TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS config_objects_fts USING fts5(
        name, module_full, tokenize = 'unicode61'
      );

      CREATE INDEX IF NOT EXISTS idx_config_objects_type ON config_objects(object_type);
      CREATE INDEX IF NOT EXISTS idx_config_objects_name ON config_objects(name);
    `);
    // Add ollama_embedding column if not exists (may already exist on re-init)
    try { this.db.exec('ALTER TABLE config_objects ADD COLUMN ollama_embedding BLOB'); } catch { /* already exists */ }
  }

  async saveObject(record: ConfigObjectRecord): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO config_objects (id, object_type, name, synonym, module_full, file_path, size_bytes, hash, ollama_embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.objectType,
      record.name,
      record.synonym || null,
      record.moduleFull,
      record.filePath,
      record.sizeBytes,
      record.hash,
      record.ollamaEmbedding || null
    );

    const ftsStmt = this.db.prepare(`
      INSERT OR REPLACE INTO config_objects_fts (rowid, name, module_full)
      SELECT rowid, ?, ? FROM config_objects WHERE id = ?
    `);
    ftsStmt.run(record.name, record.moduleFull, record.id);
  }

  async getObjectCount(): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM config_objects').get() as any;
    return row.cnt;
  }

  async getSampleNames(limit = 5): Promise<string[]> {
    const rows = this.db.prepare('SELECT name FROM config_objects LIMIT ?').all(limit) as any[];
    return rows.map(r => r.name);
  }

  async searchByFTS(query: string, limit = 20, exact = false): Promise<{ id: string; name: string; snippet: string; rank?: number }[]> {
    const start = Date.now();
    // Try FTS first
    let ftsQuery = query;
    if (exact && !query.startsWith('"')) {
      ftsQuery = `"${query}"`;
    }

    const ftsStmt = this.db.prepare(`
      SELECT
        c.id,
        c.name,
        c.object_type,
        snippet(config_objects_fts, 1, '<mark>', '</mark>', '...', 64) as snippet,
        rank
      FROM config_objects_fts
      JOIN config_objects c ON c.rowid = config_objects_fts.rowid
      WHERE config_objects_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    let rows: any[];
    try {
      rows = ftsStmt.all(ftsQuery, limit) as any[];
    } catch {
      rows = [];
    }

    if (rows.length > 0) {
      this.ftsQueries++;
      this.ftsTotalMs += Date.now() - start;
      return rows.map(row => ({
        id: row.id,
        name: row.name,
        snippet: (row.snippet || '').slice(0, 300),
        rank: row.rank,
      }));
    }

    // Fallback: LIKE search on name and module_full
    const likePattern = `%${query}%`;
    const likeStmt = this.db.prepare(`
      SELECT id, name, substr(module_full, 1, 300) as snippet
      FROM config_objects
      WHERE name LIKE ? OR module_full LIKE ?
      LIMIT ?
    `);
    const likeRows = likeStmt.all(likePattern, likePattern, limit) as any[];
    this.likeQueries++;
    this.likeTotalMs += Date.now() - start;
    return likeRows.map(row => ({
      id: row.id,
      name: row.name,
      snippet: row.snippet || '',
      rank: 0,
    }));
  }

  async getFullModuleTextForObject(objectName: string): Promise<string | null> {
    const stmt = this.db.prepare('SELECT module_full FROM config_objects WHERE name = ?');
    const row = stmt.get(objectName) as any;
    return row?.module_full || null;
  }

  async findSimilarModulesOllama(queryEmbedding: Float32Array, limit = 5, threshold = 0.35): Promise<SimilarModuleResult[]> {
    const rows = this.db.prepare('SELECT name, object_type, substr(module_full, 1, 2000) as snippet, ollama_embedding FROM config_objects WHERE ollama_embedding IS NOT NULL').all() as any[];
    const scored: SimilarModuleResult[] = [];
    for (const row of rows) {
      const emb = new Float32Array(row.ollama_embedding.buffer, row.ollama_embedding.byteOffset, row.ollama_embedding.byteLength / 4);
      const sim = this.cosineSimilarity(queryEmbedding, emb);
      if (sim >= threshold) {
        scored.push({ name: row.name, objectType: row.object_type, snippet: row.snippet || '', similarity: sim });
      }
    }
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
      na += a[i]! * a[i]!;
      nb += b[i]! * b[i]!;
    }
    return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
  }

  async getAllObjects(): Promise<{ id: string; name: string; object_type: string }[]> {
    const stmt = this.db.prepare('SELECT id, name, object_type FROM config_objects');
    return stmt.all() as any[];
  }

  async clearAll(): Promise<void> {
    this.db.exec('DROP TABLE IF EXISTS config_objects_fts');
    this.db.exec('DELETE FROM config_objects');
    this.initTables();
  }

  getSearchStats(): { ftsQueries: number; ftsAvgMs: number; likeQueries: number; likeAvgMs: number; totalQueries: number } {
    return {
      ftsQueries: this.ftsQueries,
      ftsAvgMs: this.ftsQueries > 0 ? this.ftsTotalMs / this.ftsQueries : 0,
      likeQueries: this.likeQueries,
      likeAvgMs: this.likeQueries > 0 ? this.likeTotalMs / this.likeQueries : 0,
      totalQueries: this.ftsQueries + this.likeQueries,
    };
  }

  close(): void {
    this.db.close();
  }
}
