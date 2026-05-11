import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import Database from 'better-sqlite3';
import { ReasoningBankSemantic } from '../src/ReasoningBankSemantic.js';

const TEST_DB = './test_rb_semantic.db';

describe('ReasoningBankSemantic', () => {
  let rb: ReasoningBankSemantic;

  beforeEach(async () => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    rb = new ReasoningBankSemantic({ dbPath: TEST_DB, hnswEnabled: false });
    await rb.ensureInitialized();
  });

  afterEach(async () => {
    try { await rb.close(); } catch { /* ignore */ }
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    const hnswFile = TEST_DB.replace(/\.db$/, '_hnsw.json');
    if (existsSync(hnswFile)) unlinkSync(hnswFile);
  });

  const makeExp = (overrides = {}) => ({
    id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    task: 'test task',
    outcome: 'success' as const,
    content: 'test content for embedding similarity calculation',
    domain: 'test-domain',
    error_type: 'none' as const,
    confidence: 0.8,
    ...overrides,
  });

  it('should record and retrieve experiences', async () => {
    const id = await rb.recordExperience(makeExp({ task: 'my task', content: 'unique content here' }));
    const results = await rb.retrieve('my task', { k: 5, domain: 'test-domain' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].experience.id).toBe(id);
  });

  it('should INSERT OR IGNORE duplicate ids', async () => {
    const exp = makeExp({ task: 'duplicate test', content: 'duplicate content' });
    const id1 = await rb.recordExperience(exp);
    const id2 = await rb.recordExperience({ ...exp, id: id1 });
    expect(id1).toBe(id2);
    const results = await rb.retrieve('duplicate test', { domain: 'test-domain' });
    const matching = results.filter(r => r.experience.id === id1);
    expect(matching).toHaveLength(1);
  });

  it('should filter by domain', async () => {
    await rb.recordExperience(makeExp({ id: 'dom-a', task: 'domain A task', domain: 'alpha' }));
    await rb.recordExperience(makeExp({ id: 'dom-b', task: 'domain B task', domain: 'beta' }));
    const alphaResults = await rb.retrieve('task', { domain: 'alpha' });
    expect(alphaResults.every(r => r.experience.domain === 'alpha')).toBe(true);
    const betaResults = await rb.retrieve('task', { domain: 'beta' });
    expect(betaResults.every(r => r.experience.domain === 'beta')).toBe(true);
  });

  it('should retrieve config-code domain experiences', async () => {
    await rb.recordExperience(makeExp({
      id: 'cfg-1', task: '1C.Catalog.Товары',
      content: 'Процедура ОбработкаПроведения() КонецПроцедуры',
      domain: 'config-code',
    }));
    const results = await rb.retrieve('ОбработкаПроведения', { domain: 'config-code', k: 5 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].experience.domain).toBe('config-code');
  });

  it('should return empty for non-matching domain', async () => {
    await rb.recordExperience(makeExp({ id: 'no-match', domain: 'skills' }));
    const results = await rb.retrieve('test', { domain: 'nonexistent' });
    expect(results).toHaveLength(0);
  });

  it('should only retrieve skills when only_skills is true', async () => {
    await rb.recordExperience(makeExp({ id: 'skill-1', outcome: 'success', confidence: 0.9 }));
    await rb.recordExperience(makeExp({ id: 'non-skill-1', outcome: 'success', confidence: 0.3 }));
    const skills = await rb.retrieve('test', { only_skills: true });
    expect(skills.filter(r => r.experience.is_skill).length).toBe(skills.length);
  });

  it('should rank by score descending', async () => {
    await rb.recordExperience(makeExp({ id: 'rank-high', task: 'very relevant task', confidence: 0.9 }));
    await rb.recordExperience(makeExp({ id: 'rank-low', task: 'barely related', confidence: 0.1 }));
    const results = await rb.retrieve('very relevant task', { k: 5 });
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
  });

  it('should record feedback and promote to skill', async () => {
    const id = await rb.recordExperience(makeExp({
      outcome: 'success', confidence: 0.5, consecutive_successes: 0,
    }));
    for (let i = 0; i < 3; i++) {
      await rb.recordFeedback(id, true);
    }
    const stats = await rb.getStats();
    expect(stats.skills).toBeGreaterThanOrEqual(1);
  });

  it('should reset consecutive successes on failure feedback', async () => {
    const id = await rb.recordExperience(makeExp({ outcome: 'success', confidence: 0.5 }));
    await rb.recordFeedback(id, true);
    await rb.recordFeedback(id, false);
    const results = await rb.retrieve('test', { k: 10 });
    const match = results.find(r => r.experience.id === id);
    expect(match?.experience.consecutive_successes).toBe(0);
  });

  it('should cleanup expired entries', async () => {
    const id = await rb.recordExperience(makeExp({
      id: 'expired-test',
      language: 'general',
    }));
    const directDb = new Database(TEST_DB);
    directDb.prepare("UPDATE rb_experiences SET expires_at = datetime('now', '-1 day') WHERE id = ?").run(id);
    directDb.close();
    const result = await rb.cleanupExpired();
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    const found = await rb.retrieve('test', { k: 10 });
    expect(found.some(r => r.experience.id === id)).toBe(false);
  });

  it('should clear by domain', async () => {
    await rb.recordExperience(makeExp({ id: 'clear-a', domain: 'temp-domain' }));
    await rb.recordExperience(makeExp({ id: 'clear-b', domain: 'other-domain' }));
    const cleared = await rb.clearByDomain('temp-domain');
    expect(cleared.deleted).toBe(1);
    const remaining = await rb.retrieve('test', { domain: 'other-domain' });
    expect(remaining.some(r => r.experience.id === 'clear-b')).toBe(true);
  });
});
