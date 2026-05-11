import Database from 'better-sqlite3';
import { createHash } from 'crypto';

export class PatientKnowledgeBase {
  private db: Database.Database;
  private saveCount = 0;
  private searchCount = 0;
  private recentCount = 0;

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
    this.saveCount++;
  }

  async findRecentCode(patientProfile: string, limit = 5): Promise<{ content: string; language: string | null }[]> {
    this.recentCount++;
    const rows = this.db.prepare(`
      SELECT content, language FROM patient_knowledge
      WHERE patient_profile = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(patientProfile, limit) as any[];
    return rows.map(r => ({ content: r.content, language: r.language }));
  }

  async searchCode(patientProfile: string, query: string, limit = 5): Promise<{ content: string; language: string | null }[]> {
    this.searchCount++;
    // Limit terms to avoid SQLite "Expression tree is too large" error (max depth 1000)
    const terms = query.split(/\s+/).filter(t => t.length > 2).slice(0, 20);
    if (terms.length === 0) return [];
    const conditions = terms.map(() => 'content LIKE ?');
    const params = terms.map(t => `%${t}%`);
    const sql = `
      SELECT content, language FROM patient_knowledge
      WHERE patient_profile = ? AND (${conditions.join(' OR ')})
      ORDER BY created_at DESC
      LIMIT ?
    `;
    try {
      const rows = this.db.prepare(sql).all(patientProfile, ...params, limit) as any[];
      return rows.map(r => ({ content: r.content, language: r.language }));
    } catch {
      return [];
    }
  }

  countByProfile(patientProfile: string): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM patient_knowledge WHERE patient_profile = ?').get(patientProfile) as any;
    return row.cnt;
  }

  clearProfile(patientProfile: string): void {
    this.db.prepare('DELETE FROM patient_knowledge WHERE patient_profile = ?').run(patientProfile);
  }

  getStats(): { saveCount: number; searchCount: number; recentCount: number } {
    return {
      saveCount: this.saveCount,
      searchCount: this.searchCount,
      recentCount: this.recentCount,
    };
  }

  close(): void {
    this.db.close();
  }
}
