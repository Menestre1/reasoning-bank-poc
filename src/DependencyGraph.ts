import Database from 'better-sqlite3';
type DatabaseType = InstanceType<typeof Database>;

export interface DependencyRecord {
  sourceId: string;
  sourceObject: string;
  sourceMethod?: string;
  targetObject: string;
  targetMethod?: string;
  callType: 'procedure' | 'function' | 'unknown';
}

export class DependencyGraph {
  private db: DatabaseType;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dependencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        source_object TEXT NOT NULL,
        source_method TEXT,
        target_object TEXT NOT NULL,
        target_method TEXT,
        call_type TEXT DEFAULT 'unknown',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (source_id) REFERENCES config_objects(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_deps_source ON dependencies(source_object, source_method);
      CREATE INDEX IF NOT EXISTS idx_deps_target ON dependencies(target_object, target_method);
      CREATE INDEX IF NOT EXISTS idx_deps_source_id ON dependencies(source_id);
    `);
  }

  async addDependency(dep: DependencyRecord): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO dependencies (source_id, source_object, source_method, target_object, target_method, call_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      dep.sourceId,
      dep.sourceObject,
      dep.sourceMethod || null,
      dep.targetObject,
      dep.targetMethod || null,
      dep.callType
    );
  }

  async getCallers(objectName: string, methodName?: string): Promise<any[]> {
    let stmt;
    if (methodName) {
      stmt = this.db.prepare(`
        SELECT source_object, source_method, call_type
        FROM dependencies
        WHERE target_object = ? AND target_method = ?
        GROUP BY source_object, source_method
      `);
      return stmt.all(objectName, methodName) as any[];
    } else {
      stmt = this.db.prepare(`
        SELECT source_object, source_method, call_type
        FROM dependencies
        WHERE target_object = ?
        GROUP BY source_object, source_method
      `);
      return stmt.all(objectName) as any[];
    }
  }

  async getCallees(objectName: string, methodName?: string): Promise<any[]> {
    let stmt;
    if (methodName) {
      stmt = this.db.prepare(`
        SELECT target_object, target_method, call_type
        FROM dependencies
        WHERE source_object = ? AND source_method = ?
        GROUP BY target_object, target_method
      `);
      return stmt.all(objectName, methodName) as any[];
    } else {
      stmt = this.db.prepare(`
        SELECT target_object, target_method, call_type
        FROM dependencies
        WHERE source_object = ?
        GROUP BY target_object, target_method
      `);
      return stmt.all(objectName) as any[];
    }
  }

  async buildGraphML(objectName?: string): Promise<string> {
    let edges;
    if (objectName) {
      const stmt = this.db.prepare(`
        SELECT source_object, source_method, target_object, target_method
        FROM dependencies
        WHERE source_object = ? OR target_object = ?
      `);
      edges = stmt.all(objectName, objectName) as any[];
    } else {
      const stmt = this.db.prepare(`
        SELECT source_object, source_method, target_object, target_method
        FROM dependencies
      `);
      edges = stmt.all() as any[];
    }

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<graphml>\n';
    xml += '<graph id="G" edgedefault="directed">\n';

    const nodes = new Set<string>();
    for (const edge of edges) {
      nodes.add(edge.source_object);
      nodes.add(edge.target_object);
    }

    for (const node of nodes) {
      xml += `  <node id="${node}"/>\n`;
    }

    let edgeId = 0;
    for (const edge of edges) {
      const source = edge.source_method ? `${edge.source_object}.${edge.source_method}` : edge.source_object;
      const target = edge.target_method ? `${edge.target_object}.${edge.target_method}` : edge.target_object;
      xml += `  <edge id="e${edgeId++}" source="${source}" target="${target}"/>\n`;
    }

    xml += '</graph>\n</graphml>';
    return xml;
  }

  async getStats(): Promise<{ totalEdges: number; uniqueObjects: number }> {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as totalEdges,
        COUNT(DISTINCT source_object) + COUNT(DISTINCT target_object) as uniqueObjects
      FROM dependencies
    `);
    return stmt.get() as any;
  }

  close(): void {
    this.db.close();
  }
}
