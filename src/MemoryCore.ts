/**
 * MemoryCore — минимальная реализация памяти выживания (PoC)
 * Использует AgentDB для векторного хранения + hash-эмбеддинги для PoC
 * Этап 0-2: Базовое хранилище + ReasoningBank
 */

import Database from 'better-sqlite3';
type DatabaseType = InstanceType<typeof Database>;
import { createHash } from 'crypto';

// ===== Типы =====

export interface Experience {
  id: string;
  task: string;
  outcome: 'success' | 'failure';
  content: string;
  domain: string;
  error_type?: 'парафазия' | 'эхолалия' | 'контаминация' | 'галлюцинация' | 'none';
  confidence: number;
  usage_count: number;
  consecutive_successes: number;
  is_skill: boolean;
  metadata: Record<string, any>;
  created_at: string;
}

export interface RetrievedExperience {
  experience: Experience;
  similarity: number;
  score: number;
}

export interface MemoryCoreConfig {
  dbPath: string;
  dimension?: number;
}

// ===== Hash-эмбеддинги (PoC, заменяет ML) =====

function hashEmbedding(text: string, dim: number = 384): number[] {
  const vector: number[] = new Array(dim).fill(0);
  const tokens = text.toLowerCase().split(/\s+/);
  for (const token of tokens) {
    const hash = createHash('sha256').update(token).digest();
    for (let i = 0; i < dim && i < hash.length; i++) {
      const val = hash.readUInt8(i);
      vector[i] = (vector[i] || 0) + (val / 255) - 0.5;
    }
  }
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
  return vector.map(v => v / norm);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((s, v, i) => s + v * (b[i] || 0), 0);
  const normA = Math.sqrt(a.reduce((s, v) => s + v * v, 0)) || 1;
  const normB = Math.sqrt(b.reduce((s, v) => s + v * v, 0)) || 1;
  return dot / (normA * normB);
}

// ===== MemoryCore =====

export class MemoryCore {
  private db: DatabaseType;
  private dimension: number;
  private embeddingCache: Map<string, number[]> = new Map();

  constructor(config: MemoryCoreConfig) {
    this.db = new Database(config.dbPath);
    this.dimension = config.dimension || 384;
    this.initTables();
  }

  private initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS experiences (
        id TEXT PRIMARY KEY,
        task TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('success', 'failure')),
        content TEXT NOT NULL,
        domain TEXT NOT NULL,
        error_type TEXT DEFAULT 'none',
        confidence REAL DEFAULT 0.5,
        usage_count INTEGER DEFAULT 0,
        consecutive_successes INTEGER DEFAULT 0,
        is_skill INTEGER DEFAULT 0,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        embedding BLOB
      );
      CREATE INDEX IF NOT EXISTS idx_outcome ON experiences(outcome);
      CREATE INDEX IF NOT EXISTS idx_domain ON experiences(domain);
      CREATE INDEX IF NOT EXISTS idx_error_type ON experiences(error_type);
      CREATE INDEX IF NOT EXISTS idx_is_skill ON experiences(is_skill);
      CREATE INDEX IF NOT EXISTS idx_created ON experiences(created_at DESC);
    `);
  }

  async recordExperience(exp: Omit<Experience, 'created_at' | 'usage_count' | 'consecutive_successes' | 'is_skill'>): Promise<string> {
    const id = exp.id || `exp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const embedding = this.getEmbedding(`${exp.task} ${exp.content}`);

    const stmt = this.db.prepare(`
      INSERT INTO experiences (id, task, outcome, content, domain, error_type, confidence, 
        usage_count, consecutive_successes, is_skill, metadata, created_at, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, datetime('now'), ?)
      ON CONFLICT(id) DO UPDATE SET
        outcome = excluded.outcome,
        confidence = excluded.confidence,
        metadata = excluded.metadata,
        embedding = excluded.embedding
    `);

    stmt.run(id, exp.task, exp.outcome, exp.content, exp.domain, exp.error_type || 'none',
      exp.confidence, JSON.stringify(exp.metadata || {}), Buffer.from(new Float64Array(embedding)));

    return id;
  }

  retrieve(query: string, options: { k?: number; domain?: string; error_type?: string; only_skills?: boolean } = {}): RetrievedExperience[] {
    const { k = 5, domain, error_type, only_skills } = options;
    const queryEmbedding = this.getEmbedding(query);

    let sql = 'SELECT * FROM experiences';
    const conditions: string[] = [];
    const params: any[] = [];

    if (domain) { conditions.push('domain = ?'); params.push(domain); }
    if (error_type) { conditions.push('error_type = ?'); params.push(error_type); }
    if (only_skills) { conditions.push('is_skill = 1'); }

    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');

    const rows = this.db.prepare(sql).all(...params) as any[];

    const scored = rows.map(row => {
      const embedding = Array.from(new Float64Array(row.embedding));
      const similarity = cosineSimilarity(queryEmbedding, embedding);
      const recency = Math.exp(-this.daysSince(row.created_at) / 30);
      const reliability = row.confidence;
      const skillBonus = row.is_skill ? 0.2 : 0;
      const score = 0.5 * similarity + 0.2 * recency + 0.3 * reliability + skillBonus;

      return {
        experience: this.rowToExperience(row),
        similarity,
        score,
      };
    });

    return scored.sort((a, b) => b.score - a.score).slice(0, k);
  }

  async recordFeedback(expId: string, success: boolean): Promise<{ consecutive: number; promoted: boolean }> {
    const row = this.db.prepare('SELECT * FROM experiences WHERE id = ?').get(expId) as any;
    if (!row) throw new Error(`Experience ${expId} not found`);

    let consecutive = row.consecutive_successes;
    let promoted = false;

    if (success) {
      consecutive += 1;
      if (consecutive >= 3 && !row.is_skill) {
        promoted = true;
        this.db.prepare('UPDATE experiences SET is_skill = 1, usage_count = usage_count + 1, consecutive_successes = ? WHERE id = ?')
          .run(consecutive, expId);
      } else {
        this.db.prepare('UPDATE experiences SET consecutive_successes = ?, usage_count = usage_count + 1 WHERE id = ?')
          .run(consecutive, expId);
      }
    } else {
      consecutive = 0;
      this.db.prepare('UPDATE experiences SET consecutive_successes = 0 WHERE id = ?').run(expId);
    }

    return { consecutive, promoted };
  }

  recommendStrategy(query: string, context?: { text?: string; error_type?: string }): { strategy: string; priority: 'high' | 'normal'; experiences: RetrievedExperience[] } {
    const experiences = this.retrieveSync(query, context);
    const hasSkill = experiences.some(e => e.experience.is_skill);
    const strategy = experiences.length > 0
      ? experiences.map(e => e.experience.content).join('\n')
      : 'Нет подходящего опыта';

    return {
      strategy,
      priority: hasSkill ? 'high' : 'normal',
      experiences,
    };
  }

  private retrieveSync(query: string, context?: { text?: string; error_type?: string }): RetrievedExperience[] {
    const queryEmbedding = this.getEmbedding(`${query} ${context?.text || ''}`);
    const errorType = context?.error_type;

    let sql = 'SELECT * FROM experiences';
    if (errorType) sql += ' WHERE error_type = ?';

    const rows = errorType
      ? this.db.prepare(sql).all(errorType) as any[]
      : this.db.prepare(sql).all() as any[];

    const scored = rows.map(row => {
      const embedding = Array.from(new Float64Array(row.embedding));
      const similarity = cosineSimilarity(queryEmbedding, embedding);
      const recency = Math.exp(-this.daysSince(row.created_at) / 30);
      const reliability = row.confidence;
      const skillBonus = row.is_skill ? 0.2 : 0;
      const score = 0.5 * similarity + 0.2 * recency + 0.3 * reliability + skillBonus;

      return {
        experience: this.rowToExperience(row),
        similarity,
        score,
      };
    });

    return scored.sort((a, b) => b.score - a.score).slice(0, 5);
  }

  getStats() {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM experiences').get() as any;
    const skills = this.db.prepare('SELECT COUNT(*) as count FROM experiences WHERE is_skill = 1').get() as any;
    const byOutcome = this.db.prepare('SELECT outcome, COUNT(*) as count FROM experiences GROUP BY outcome').all() as any[];
    const byError = this.db.prepare("SELECT error_type, COUNT(*) as count FROM experiences WHERE error_type != 'none' GROUP BY error_type").all() as any[];

    return {
      totalExperiences: total.count,
      skills: skills.count,
      byOutcome: Object.fromEntries(byOutcome.map(r => [r.outcome, r.count])),
      byErrorType: Object.fromEntries(byError.map(r => [r.error_type, r.count])),
    };
  }

  private getEmbedding(text: string): number[] {
    if (!this.embeddingCache.has(text)) {
      this.embeddingCache.set(text, hashEmbedding(text, this.dimension));
    }
    return this.embeddingCache.get(text)!;
  }

  private daysSince(dateStr: string): number {
    return (Date.now() - new Date(dateStr + 'Z').getTime()) / (1000 * 60 * 60 * 24);
  }

  private rowToExperience(row: any): Experience {
    return {
      id: row.id,
      task: row.task,
      outcome: row.outcome,
      content: row.content,
      domain: row.domain,
      error_type: row.error_type,
      confidence: row.confidence,
      usage_count: row.usage_count,
      consecutive_successes: row.consecutive_successes,
      is_skill: !!row.is_skill,
      metadata: JSON.parse(row.metadata || '{}'),
      created_at: row.created_at,
    };
  }

  close() {
    this.db.close();
  }
}

// ===== Prompt formatter =====

export function formatForPrompt(results: RetrievedExperience[]): string {
  if (results.length === 0) return '[НЕТ ПОДХОДЯЩЕГО ОПЫТА]';

  const skills = results.filter(r => r.experience.is_skill);
  const failures = results.filter(r => r.experience.outcome === 'failure');
  const successes = results.filter(r => r.experience.outcome === 'success' && !r.experience.is_skill);

  let output = '=== ПАМЯТЬ ВЫЖИВАНИЯ ===\n';

  if (skills.length > 0) {
    output += '\n[ЗАКРЕПЛЁННЫЕ НАВЫКИ]\n';
    for (const s of skills) {
      output += `  ★ ${s.experience.task}: ${s.experience.content}\n`;
    }
  }

  if (successes.length > 0) {
    output += '\n[УСПЕШНЫЕ ПАТТЕРНЫ]\n';
    for (const s of successes) {
      output += `  + ${s.experience.task}: ${s.experience.content} (уверенность: ${s.experience.confidence.toFixed(2)})\n`;
    }
  }

  if (failures.length > 0) {
    output += '\n[ИЗБЕГАТЬ]\n';
    for (const f of failures) {
      output += `  ✗ ${f.experience.error_type}: ${f.experience.content}\n`;
    }
  }

  output += '=== КОНЕЦ ПАМЯТИ ===\n';
  return output;
}
