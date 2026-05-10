import Database from 'better-sqlite3';
import { createHash } from 'crypto';

export class PatientKnowledgeBase {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.ensureTable();
  }

  private ensureTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS patient_knowledge (
        id TEXT PRIMARY KEY,
        patient_profile TEXT NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        language TEXT,
        source TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_pk_profile ON patient_knowledge(patient_profile);
      CREATE INDEX IF NOT EXISTS idx_pk_hash ON patient_knowledge(content_hash);
    `);
  }

  async saveCode(patientProfile: string, code: string, language?: string, source?: string): Promise<void> {
    const contentHash = createHash('sha256').update(code).digest('hex');
    const existing = this.db.prepare(
      'SELECT id FROM patient_knowledge WHERE patient_profile = ? AND content_hash = ?'
    ).get(patientProfile, contentHash) as any;
    if (existing) return;

    const id = `pat_know_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    this.db.prepare(`
      INSERT INTO patient_knowledge (id, patient_profile, content, content_hash, language, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, patientProfile, code, contentHash, language || null, source || null);
  }

  async findRecentCode(patientProfile: string, limit = 5): Promise<{ content: string; language: string | null }[]> {
    const rows = this.db.prepare(`
      SELECT content, language FROM patient_knowledge
      WHERE patient_profile = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(patientProfile, limit) as any[];
    return rows.map(r => ({ content: r.content, language: r.language }));
  }

  close(): void {
    this.db.close();
  }
}
