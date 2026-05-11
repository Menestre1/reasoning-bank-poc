import Database from 'better-sqlite3';
type DatabaseType = InstanceType<typeof Database>;

export interface ComparisonRecord {
  id?: number;
  oldPath: string;
  newPath: string;
  summary: string;
  createdAt?: string;
}

export interface ComparisonDetail {
  id?: number;
  comparisonId: number;
  objectName: string;
  objectType: string;
  status: 'added' | 'removed' | 'modified' | 'unchanged';
  moduleDiff?: string;
  oldHash?: string;
  newHash?: string;
}

export class ComparisonStorage {
  private db: DatabaseType;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS comparisons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        old_path TEXT NOT NULL,
        new_path TEXT NOT NULL,
        summary TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS comparison_details (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        comparison_id INTEGER NOT NULL,
        object_name TEXT NOT NULL,
        object_type TEXT NOT NULL,
        status TEXT NOT NULL,
        module_diff TEXT,
        old_hash TEXT,
        new_hash TEXT,
        FOREIGN KEY (comparison_id) REFERENCES comparisons(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_comp_details_comparison ON comparison_details(comparison_id);
      CREATE INDEX IF NOT EXISTS idx_comp_details_object ON comparison_details(object_name);
    `);
  }

  async saveComparison(record: ComparisonRecord): Promise<number> {
    const stmt = this.db.prepare(`
      INSERT INTO comparisons (old_path, new_path, summary)
      VALUES (?, ?, ?)
    `);
    const result = stmt.run(record.oldPath, record.newPath, record.summary);
    return result.lastInsertRowid as number;
  }

  async saveDetail(record: ComparisonDetail): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO comparison_details (
        comparison_id, object_name, object_type, status,
        module_diff, old_hash, new_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.comparisonId,
      record.objectName,
      record.objectType,
      record.status,
      record.moduleDiff || null,
      record.oldHash || null,
      record.newHash || null
    );
  }

  async getLatestComparison(): Promise<any> {
    return this.db.prepare(`
      SELECT * FROM comparisons ORDER BY created_at DESC LIMIT 1
    `).get() as any;
  }

  async getComparisonDetails(comparisonId: number): Promise<any[]> {
    return this.db.prepare(`
      SELECT * FROM comparison_details 
      WHERE comparison_id = ? 
      ORDER BY 
        CASE status 
          WHEN 'added' THEN 1 
          WHEN 'removed' THEN 2 
          WHEN 'modified' THEN 3 
          WHEN 'unchanged' THEN 4 
        END
    `).all(comparisonId) as any[];
  }

  async getChangedObjects(type?: string): Promise<any[]> {
    const comp = await this.getLatestComparison();
    if (!comp) return [];

    let stmt;
    if (type) {
      stmt = this.db.prepare(`
        SELECT * FROM comparison_details 
        WHERE comparison_id = ? AND object_type = ? AND status = 'modified'
      `);
      return stmt.all(comp.id, type) as any[];
    } else {
      stmt = this.db.prepare(`
        SELECT * FROM comparison_details 
        WHERE comparison_id = ? AND status IN ('added', 'removed', 'modified')
      `);
      return stmt.all(comp.id) as any[];
    }
  }

  async clearAll(): Promise<void> {
    this.db.exec('DELETE FROM comparison_details');
    this.db.exec('DELETE FROM comparisons');
  }

  close(): void {
    this.db.close();
  }
}
