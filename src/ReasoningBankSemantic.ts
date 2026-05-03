/**
 * ReasoningBankSemantic — упрощённая версия с better-sqlite3
 * Заменяет AgentDB на прямое использование базы данных
 */

import Database from 'better-sqlite3';
import { HNSWBackend } from './HNSWBackend.js';
import { LRUCache } from './LRUCache.js';
import { createHash } from 'crypto';

// ===== Типы =====

export type ErrorType = 'парафазия' | 'эхолалия' | 'контаминация' | 'галлюцинация' | 'none';
export type Language = '1С (BSL)' | 'JavaScript' | 'TypeScript' | 'Python' | 'Go' | 'general';

export interface Experience {
  id: string;
  task: string;
  outcome: 'success' | 'failure' | 'pending';
  content: string;
  domain: string;
  error_type: ErrorType;
  confidence: number;
  usage_count: number;
  consecutive_successes: number;
  is_skill: boolean;
  user_input?: string;
  metadata?: Record<string, any>;
  created_at?: string;
  expires_at?: string | null;
  embedding?: Buffer;
  language?: string;
}

export interface RetrievedExperience {
  experience: Experience;
  similarity: number;
  score: number;
}

export interface ErrorWarning {
  error_type: ErrorType;
  description: string;
  advice: string;
  trigger_example: string;
  confidence: number;
}

export interface SemanticMemoryConfig {
  dbPath: string;
  dimension?: number;
  namespace?: string;
  hnswEnabled?: boolean;
  cacheSize?: number;
  cacheTTL?: number;
}

// ===== Cosine similarity =====

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] || 0) * (b[i] || 0);
    normA += (a[i] || 0) * (a[i] || 0);
    normB += (b[i] || 0) * (b[i] || 0);
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ===== Hash embeddings (PoC replacement for ML embeddings) =====

function hashEmbedding(text: string, dim: number = 384): Float32Array {
  const vector = new Float32Array(dim);
  const tokens = text.toLowerCase().split(/\s+/);
  for (const token of tokens) {
    const hash = createHash('sha256').update(token).digest();
    for (let i = 0; i < dim && i < hash.length; i++) {
      vector[i] = (vector[i] || 0) + (hash.readUInt8(i) / 255) - 0.5;
    }
  }
  // Normalize
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
  for (let i = 0; i < dim; i++) {
    vector[i] = (vector[i] || 0) / norm;
  }
  return vector;
}

// ===== Класс =====

export class ReasoningBankSemantic {
  private db: Database.Database;
  private hnsw: HNSWBackend;
  private cache: LRUCache<RetrievedExperience[]>;
  private initialized = false;
  private hnswEnabled = true;
  private dbPath: string;
  private embeddingCache: Map<string, Float32Array> = new Map();
  private saveTimer?: ReturnType<typeof setTimeout> | undefined;

  // Prepared statements
  private stmtGetById?: Database.Statement;
  private stmtUpdateExperience?: Database.Statement;
  private stmtUpdateSkill?: Database.Statement;
  private stmtInsert?: Database.Statement;
  private stmtDeleteExpired?: Database.Statement;
  private stmtSelectAll?: Database.Statement;
  private stmtSelectCount?: Database.Statement;

  constructor(config: SemanticMemoryConfig) {
    const dimension = config.dimension || 384;
    this.hnswEnabled = config.hnswEnabled !== false;
    this.dbPath = config.dbPath;

    this.db = new Database(config.dbPath);

    this.hnsw = new HNSWBackend({
      dimension,
      indexFilePath: config.dbPath.replace(/\.db$/, '_hnsw.json'),
    });

    this.cache = new LRUCache<RetrievedExperience[]>({
      maxSize: config.cacheSize || 256,
      ttlMs: config.cacheTTL || 60_000,
    });
  }

  private getDB(): Database.Database {
    return this.db;
  }

  public async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    // Create table if not exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rb_experiences (
        id TEXT PRIMARY KEY,
        task TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('success', 'failure', 'pending')),
        content TEXT NOT NULL,
        domain TEXT NOT NULL,
        error_type TEXT DEFAULT 'none',
        confidence REAL DEFAULT 0.5,
        usage_count INTEGER DEFAULT 0,
        consecutive_successes INTEGER DEFAULT 0,
        is_skill INTEGER DEFAULT 0,
        user_input TEXT,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT,
        embedding BLOB,
        language TEXT DEFAULT 'general'
      );
      CREATE INDEX IF NOT EXISTS idx_rb_outcome ON rb_experiences(outcome);
      CREATE INDEX IF NOT EXISTS idx_rb_domain ON rb_experiences(domain);
      CREATE INDEX IF NOT EXISTS idx_rb_error_type ON rb_experiences(error_type);
      CREATE INDEX IF NOT EXISTS idx_rb_is_skill ON rb_experiences(is_skill);
      CREATE INDEX IF NOT EXISTS idx_rb_created ON rb_experiences(created_at DESC);
    `);

    // Prepare statements
    this.stmtGetById = this.db.prepare('SELECT * FROM rb_experiences WHERE id = ?');
    this.stmtUpdateExperience = this.db.prepare('UPDATE rb_experiences SET consecutive_successes = consecutive_successes + 1, usage_count = usage_count + 1 WHERE id = ?');
    this.stmtUpdateSkill = this.db.prepare('UPDATE rb_experiences SET is_skill = 1, consecutive_successes = consecutive_successes + 1, usage_count = usage_count + 1 WHERE id = ?');
    this.stmtInsert = this.db.prepare(`INSERT INTO rb_experiences (id, task, outcome, content, domain, error_type, confidence, consecutive_successes, is_skill, user_input, metadata, expires_at, embedding, language) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    this.stmtDeleteExpired = this.db.prepare(`DELETE FROM rb_experiences WHERE expires_at IS NOT NULL AND expires_at < datetime('now') AND is_skill = 0`);
    this.stmtSelectAll = this.db.prepare('SELECT * FROM rb_experiences');
    this.stmtSelectCount = this.db.prepare('SELECT COUNT(*) as c FROM rb_experiences');

    // Load HNSW index
    if (this.hnswEnabled) {
      await this.hnsw.initialize();
    }

    this.initialized = true;
    console.log('[ReasoningBank] Initialized successfully');
  }

  private getEmbedding(text: string): Float32Array {
    if (!this.embeddingCache.has(text)) {
      this.embeddingCache.set(text, hashEmbedding(text, 384));
    }
    return this.embeddingCache.get(text)!;
  }

  async retrieve(query: string, options: { k?: number; domain?: string; error_type?: string; only_skills?: boolean; language?: string } = {}): Promise<RetrievedExperience[]> {
    await this.ensureInitialized();

    const { k = 5, domain, error_type, only_skills } = options;

    const queryEmbedding = this.getEmbedding(query);

    // Use cached select all and filter in JS
    const rows = this.stmtSelectAll?.all() as any[] || [];
    const filtered = rows.filter(row => {
      if (domain && row.domain !== domain) return false;
      if (error_type && row.error_type !== error_type) return false;
      if (only_skills && !row.is_skill) return false;
      return true;
    });

    const scored = filtered.map(row => {
      if (!row.embedding) return null;
      const embedding = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
      const similarity = cosineSimilarity(queryEmbedding, embedding);
      const confidence = row.confidence;
      const isSkill = !!row.is_skill;
      const recency = 0.8;
      const skillBonus = isSkill ? 0.2 : 0;

      // CRITICAL: Penalize failed experiences heavily
      const failurePenalty = (row.outcome === 'failure') ? -0.5 : 0;

      const score = 0.5 * similarity + 0.2 * recency + 0.3 * confidence + skillBonus + failurePenalty;

      return {
        experience: this.rowToExperience(row),
        similarity,
        score,
      };
    }).filter(r => r !== null);

    scored.sort((a, b) => b!.score - a!.score);
    const result = scored.slice(0, k) as any[];
    this.cache.set(JSON.stringify({ query, k, domain, error_type, only_skills }), result);
    return result;
  }

  async recordExperience(exp: any): Promise<string> {
    await this.ensureInitialized();

    const id = exp.id || `exp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const embeddingText = exp.domain === 'dialogue' 
      ? exp.task  // Only user's question for dialogues
      : `${exp.task} ${exp.content}${exp.user_input ? ' ' + exp.user_input : ''}`;
    
    const embedding = this.getEmbedding(embeddingText);
    const embBlob = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);

    const language = exp.language || 'general';
    const isPermanent = language !== 'general';
    const expiresAt = isPermanent ? null : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const isSkill = isPermanent ? 1 : 0;
    
    // For dialogues, try to find by exact task match
    if (exp.domain === 'dialogue') {
      const rows = this.stmtSelectAll?.all() as any[] || [];
      const existingRow = rows.find((r: any) => r.domain === 'dialogue' && r.task === exp.task);
      if (existingRow) {
        // Return existing ID without changing counter
        this.cache.clear();
        return existingRow.id;
      }
    }

    // No similar found or explicit ID provided - insert new
    const consecutiveSuccesses = isPermanent ? 3 : 0;
    
    this.stmtInsert?.run(
      id, exp.task, exp.outcome, exp.content, exp.domain, exp.error_type || 'none',
      exp.confidence, consecutiveSuccesses, isSkill, exp.user_input || null,
      JSON.stringify(exp.metadata || {}), expiresAt, embBlob, language
    );

    if (this.hnswEnabled && this.initialized) {
      await this.hnsw.addPoint(id, Array.from(embedding));
    }

    this.cache.clear();
    this.persist();

    return id;
  }

  async recordFeedback(expId: string, success: boolean): Promise<{ consecutive: number; promoted: boolean }> {
    await this.ensureInitialized();

    const stmt = this.stmtGetById;
    if (!stmt) throw new Error('Prepared statement not initialized');
    const row = stmt.get(expId) as any;
    if (!row) throw new Error(`Experience ${expId} not found`);

    let promoted = false;
    let consecutive = row.consecutive_successes || 0;

    console.log(`[ReasoningBank] recordFeedback START: expId=${expId}, current consecutive=${consecutive}, success=${success}`);

    if (success) {
      // Increment by 1 ONLY - use atomic SQL
      this.stmtUpdateExperience?.run(expId); // SQL does: consecutive_successes + 1
      
      // Get updated value
      const updatedRow = stmt.get(expId) as any;
      consecutive = updatedRow.consecutive_successes || 0;
      console.log(`[ReasoningBank] recordFeedback after update: consecutive=${consecutive}`);
      
      if (consecutive >= 3 && !updatedRow.is_skill) {
        promoted = true;
        this.stmtUpdateSkill?.run(expId); // SQL does: consecutive_successes + 1 and set is_skill = 1
        // Get final value after promotion
        const finalRow = stmt.get(expId) as any;
        consecutive = finalRow.consecutive_successes || 0;
        console.log(`[ReasoningBank] recordFeedback after promotion: consecutive=${consecutive}`);
      }
    } else {
      this.stmtUpdateExperience?.run(expId); // SQL does: consecutive_successes = 0
      consecutive = 0;
    }

    this.cache.clear();
    this.persist();
    console.log(`[ReasoningBank] recordFeedback END: returning consecutive=${consecutive}`);
    return { consecutive, promoted };
  }

  async recommendWithWarnings(userInput: string, options: { k?: number; threshold?: number; language?: string } = {}): Promise<{
    warnings: ErrorWarning[];
    strategy: string;
    enrichedPrompt: string;
  }> {
    await this.ensureInitialized();

    const { k = 5, threshold = 0.4 } = options;

    console.log(`[ReasoningBank] recommendWithWarnings: userInput="${userInput}", threshold=${threshold}`);

    const errors = await this.retrieve(userInput, { k, only_skills: false });
    const warnings: ErrorWarning[] = [];

    console.log(`[ReasoningBank] recommendWithWarnings: retrieved ${errors.length} experiences`);

    // Check retrieved experiences for failures
    for (const exp of errors) {
      console.log(`[ReasoningBank] recommendWithWarnings: checking exp id=${exp.experience.id}, outcome=${exp.experience.outcome}, similarity=${exp.similarity}`);
      if (exp.experience.outcome === 'failure' && exp.similarity > threshold) {
        console.log(`[ReasoningBank] recommendWithWarnings: FOUND FAILURE! error_type=${exp.experience.error_type}`);
        warnings.push({
          error_type: exp.experience.error_type,
          description: '',
          advice: this.getAdviceForError(exp.experience.error_type as ErrorType),
          trigger_example: '',
          confidence: exp.similarity,
        });
      }
    }

    // CRITICAL: Also check for EXACT SAME user_input in failed experiences (bypass similarity)
    const allRows = this.stmtSelectAll?.all() as any[] || [];
    const exactMatchFailures = allRows.filter((r: any) =>
      r.user_input === userInput &&
      r.outcome === 'failure' &&
      !warnings.some(w => w.error_type === r.error_type)
    );

    for (const row of exactMatchFailures) {
      console.log(`[ReasoningBank] Found EXACT MATCH failure for user_input: ${userInput}, error: ${row.error_type}`);
      warnings.push({
        error_type: row.error_type,
        description: '',
        advice: this.getAdviceForError(row.error_type as ErrorType),
        trigger_example: '',
        confidence: 1.0, // Exact match = maximum confidence
      });
    }

    const strategy = warnings.length > 0
      ? warnings.map(w => w.advice).join('\n')
      : 'Нет предупреждений';

    const enrichedPrompt = `User input: ${userInput}\n\nWarnings:\n${warnings.map(w => `- ${w.error_type}: ${w.advice}`).join('\n')}`;

    return { warnings, strategy, enrichedPrompt };
  }

  async getStats() {
    await this.ensureInitialized();

    const total = this.stmtSelectCount?.get() as any;
    const allRows = this.stmtSelectAll?.all() as any[] || [];

    const skills = allRows.filter((r: any) => r.is_skill).length;
    const byOutcome = allRows.reduce((acc: Record<string, number>, r: any) => {
      if (r.outcome) acc[r.outcome] = (acc[r.outcome] || 0) + 1;
      return acc;
    }, {});
    const byError = allRows.reduce((acc: Record<string, number>, r: any) => {
      if (r.error_type && r.error_type !== 'none') acc[r.error_type] = (acc[r.error_type] || 0) + 1;
      return acc;
    }, {});
    const withUserInput = allRows.filter((r: any) => r.user_input).length;

    return {
      totalExperiences: total?.c || 0,
      skills,
      byOutcome,
      byErrorType: byError,
      withUserInput,
      byLanguage: {},
    };
  }

  async getToolsByDomain(domain: string): Promise<Array<{
    tool_id: string;
    name: string;
    content: string;
    score: number;
    tool_metadata: any;
  }>> {
    await this.ensureInitialized();

    const rows = this.db.prepare('SELECT * FROM rb_experiences WHERE domain = ?').all(domain) as any[];

    return rows.map(row => {
      const metadata = JSON.parse(row.metadata || '{}');
      return {
        tool_id: row.id,
        name: row.task || 'Unknown Tool',
        content: row.content,
        score: 1.0,
        tool_metadata: metadata.tool || metadata,
      };
    }).filter(t => t.tool_metadata && t.tool_metadata.type);
  }

  async updateDialogueOutcome(id: string, outcome: 'success' | 'failure', errorType?: string): Promise<void> {
    await this.ensureInitialized();
    const metadataUpdate = `json_set(metadata, '$.pending', 'false')`;

    if (outcome === 'success') {
      this.db.prepare(`UPDATE rb_experiences SET outcome = 'success', metadata = ${metadataUpdate} WHERE id = ? AND domain = 'dialogue'`).run(id);
    } else {
      const errorUpdate = errorType ? `error_type = '${errorType}', ` : '';
      this.db.prepare(`UPDATE rb_experiences SET outcome = 'failure', ${errorUpdate}metadata = ${metadataUpdate} WHERE id = ? AND domain = 'dialogue'`).run(id);
    }

    this.persist();
  }

  async learnFromFeedback(errorType: ErrorType, userInput: string, agentResponse: string, description?: string): Promise<{ added: boolean }> {
    await this.ensureInitialized();

    const id = `error-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const content = description || `Ошибка типа "${errorType}" при обработке запроса "${userInput}". Ответ: ${agentResponse}`;

    await this.recordExperience({
      id,
      task: `Learn from ${errorType}`,
      outcome: 'failure',
      content,
      domain: 'knowledge',
      error_type: errorType,
      confidence: 0.8,
    });

    return { added: true };
  }

  async recommendTools(query: string, options: { limit?: number; minScore?: number; filterByDomain?: string } = {}): Promise<Array<{
    tool_id: string;
    name: string;
    content: string;
    score: number;
    tool_metadata: any;
  }>> {
    await this.ensureInitialized();

    const { limit = 5, minScore = 0.3, filterByDomain = 'tool' } = options;

    const experiences = await this.retrieve(query, {
      k: limit,
      domain: filterByDomain,
      only_skills: false,
    });

    return experiences
      .filter(exp => exp.score >= minScore)
      .map(exp => {
        const metadata = exp.experience.metadata || {};
        const toolData = metadata.tool || null;

        return {
          tool_id: exp.experience.id,
          name: exp.experience.task || 'Unknown Tool',
          content: exp.experience.content,
          score: exp.score,
          tool_metadata: toolData,
        };
      })
      .filter(tool => tool.tool_metadata !== null);
  }

  async cleanupExpired(): Promise<{ deleted: number }> {
    await this.ensureInitialized();

    const result = this.stmtDeleteExpired?.run();
    const deleted = result?.changes || 0;

    if (deleted > 0) {
      this.cache.clear();
      await this.rebuildHNSWIndex();
      this.hnsw.save();
    }

    return { deleted };
  }

  async rebuildIndex(): Promise<void> {
    await this.ensureInitialized();
    await this.rebuildHNSWIndex();
    this.hnsw.save();
  }

  async close() {
    try {
      this.persist();
    } catch (e) {
      console.error('[ReasoningBank] Failed to save database:', e);
    }

    // Clear prepared statements references
    this.stmtGetById = undefined;
    this.stmtUpdateExperience = undefined;
    this.stmtUpdateSkill = undefined;
    this.stmtInsert = undefined;
    this.stmtDeleteExpired = undefined;
    this.stmtSelectAll = undefined;
    this.stmtSelectCount = undefined;

    if (this.hnswEnabled) {
      await this.hnsw.close();
    }

    this.db.close();
  }

  // ===== Private helpers =====

  private async findSimilarExisting(text: string, domain: string, language: string): Promise<string | null> {
    const embedding = this.getEmbedding(text);
    const rows = this.stmtSelectAll?.all() as any[] || [];
    const threshold = domain === 'dialogue' ? 0.7 : 0.85;

    let bestSimilarity = 0;
    let bestId: string | null = null;

    for (const row of rows) {
      if (row.domain !== domain) continue;
      if (!row.embedding) continue;

      const rowEmbedding = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
      const sim = cosineSimilarity(embedding, rowEmbedding);
      if (sim > bestSimilarity && sim > threshold) {
        bestSimilarity = sim;
        bestId = row.id;
      }
    }

    return bestId;
  }

  private async rebuildHNSWIndex(): Promise<void> {
    if (!this.hnswEnabled) return;

    const rows = this.stmtSelectAll?.all() as any[] || [];
    const data = rows
      .filter(row => row.embedding && row.id)
      .map(row => {
        const embedding = Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4));
        return { id: row.id, vector: embedding };
      });

    await this.hnsw.rebuild(data);
  }

  private persist(): void {
    if (this.saveTimer) return;

    this.saveTimer = setTimeout(() => {
      try {
        // better-sqlite3 auto-saves, no need to export
        console.log('[ReasoningBank] Database auto-saved');
      } catch (e) {
        console.error('[ReasoningBank] Failed to persist:', e);
      }
      this.saveTimer = undefined;
    }, 1000);
  }

  private getAdviceForError(errorType: ErrorType): string {
    const adviceMap: Record<ErrorType, string> = {
      'эхолалия': 'Не повторяй фразу пользователя. Дай содержательный ответ.',
      'парафазия': 'Проверяй термины перед использованием.',
      'контаминация': 'Отвечай на один вопрос за раз.',
      'галлюцинация': 'Если не знаешь — скажи прямо.',
      'none': 'Проверь корректность ответа.',
    };
    return adviceMap[errorType] || 'Проверь корректность ответа.';
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
      user_input: row.user_input,
      metadata: JSON.parse(row.metadata || '{}'),
      created_at: row.created_at,
      expires_at: row.expires_at,
      language: row.language,
    };
  }
}
