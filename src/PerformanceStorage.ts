import Database from 'better-sqlite3';
type DatabaseType = InstanceType<typeof Database>;

export interface MeasurementRecord {
  id?: number;
  timestamp: string;
  objectName: string;
  methodName: string;
  durationMs: number;
  callCount: number;
  environment: string;
  metadataJson: string;
}

export class PerformanceStorage {
  private db: DatabaseType;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS measurements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT,
        object_name TEXT NOT NULL,
        method_name TEXT,
        duration_ms REAL,
        call_count INTEGER,
        environment TEXT,
        metadata_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_measurements_object ON measurements(object_name);
      CREATE INDEX IF NOT EXISTS idx_measurements_duration ON measurements(duration_ms);
    `);
  }

  async saveMeasurement(record: MeasurementRecord): Promise<number> {
    const stmt = this.db.prepare(`
      INSERT INTO measurements (timestamp, object_name, method_name, duration_ms, call_count, environment, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      record.timestamp,
      record.objectName,
      record.methodName || null,
      record.durationMs,
      record.callCount,
      record.environment || null,
      record.metadataJson
    );
    return result.lastInsertRowid as number;
  }

  async getTopSlowObjects(limit = 10): Promise<any[]> {
    const stmt = this.db.prepare(`
      SELECT
        object_name,
        AVG(duration_ms) as avg_duration,
        SUM(call_count) as total_calls,
        COUNT(*) as measurement_count,
        MAX(duration_ms) as max_duration,
        MIN(duration_ms) as min_duration
      FROM measurements
      GROUP BY object_name
      ORDER BY avg_duration DESC
      LIMIT ?
    `);
    return stmt.all(limit) as any[];
  }

  async getTopSlowMethods(limit = 10): Promise<any[]> {
    const stmt = this.db.prepare(`
      SELECT
        object_name,
        method_name,
        AVG(duration_ms) as avg_duration,
        SUM(call_count) as total_calls,
        COUNT(*) as measurement_count
      FROM measurements
      WHERE method_name IS NOT NULL
      GROUP BY object_name, method_name
      ORDER BY avg_duration DESC
      LIMIT ?
    `);
    return stmt.all(limit) as any[];
  }

  async getObjectStats(objectName: string): Promise<any> {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as measurement_count,
        AVG(duration_ms) as avg_duration,
        MIN(duration_ms) as min_duration,
        MAX(duration_ms) as max_duration,
        SUM(call_count) as total_calls
      FROM measurements
      WHERE object_name LIKE ?
    `);
    return stmt.get(`%${objectName}%`) as any;
  }

  async clearAll(): Promise<void> {
    this.db.exec('DELETE FROM measurements');
  }

  close(): void {
    this.db.close();
  }
}
