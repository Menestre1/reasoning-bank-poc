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
}

export class ConfigStorage {
  private db: DatabaseType;

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
  }

  async saveObject(record: ConfigObjectRecord): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO config_objects (id, object_type, name, synonym, module_full, file_path, size_bytes, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.objectType,
      record.name,
      record.synonym || null,
      record.moduleFull,
      record.filePath,
      record.sizeBytes,
      record.hash
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
    let ftsQuery = query;
    if (exact && !query.startsWith('"')) {
      ftsQuery = `"${query}"`;
    }

    const stmt = this.db.prepare(`
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
    const rows = stmt.all(ftsQuery, limit) as any[];
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      snippet: (row.snippet || '').slice(0, 300),
      rank: row.rank,
    }));
  }

  async getFullModuleTextForObject(objectName: string): Promise<string | null> {
    const stmt = this.db.prepare('SELECT module_full FROM config_objects WHERE name = ?');
    const row = stmt.get(objectName) as any;
    return row?.module_full || null;
  }

  async getAllObjects(): Promise<{ id: string; name: string; object_type: string }[]> {
    const stmt = this.db.prepare('SELECT id, name, object_type FROM config_objects');
    return stmt.all() as any[];
  }

  close(): void {
    this.db.close();
  }
}
