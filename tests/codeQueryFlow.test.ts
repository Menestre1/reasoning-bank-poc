import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { LirAgent } from '../src/LirAgent.js';

const TEST_DB = './test_code_query_flow.db';

describe('isCodeQuery', () => {
  let agent: LirAgent;

  beforeEach(() => {
    for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
      try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    }
    agent = new LirAgent({ dbPath: TEST_DB, systemPrompt: 'Test' });
  });

  afterEach(async () => {
    try { await (agent as any).close(); } catch { /* ignore */ }
    for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
      try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    }
  });

  it('detects Russian code keywords', () => {
    const fn = (agent as any).isCodeQuery.bind(agent);
    expect(fn('проанализируй код обработки')).toBe(true);
    expect(fn('найди модуль')).toBe(true);
    expect(fn('исправь ошибку в функции')).toBe(true);
    expect(fn('создай обработку')).toBe(true);
  });

  it('detects English code keywords', () => {
    const fn = (agent as any).isCodeQuery.bind(agent);
    expect(fn('analyze the module function')).toBe(true);
    expect(fn('fix this procedure error')).toBe(true);
    expect(fn('create a new module')).toBe(true);
    expect(fn('refactor implementation')).toBe(true);
  });

  it('rejects non-code queries', () => {
    const fn = (agent as any).isCodeQuery.bind(agent);
    expect(fn('hello world')).toBe(false);
    expect(fn('как дела?')).toBe(false);
    expect(fn('расскажи анекдот')).toBe(false);
    expect(fn('какая погода?')).toBe(false);
    expect(fn('')).toBe(false);
    expect(fn('привет')).toBe(false);
    expect(fn('что такое экзистенциализм?')).toBe(false);
  });

  it('detects 1C-specific keywords', () => {
    const fn = (agent as any).isCodeQuery.bind(agent);
    expect(fn('проанализируй алгоритм')).toBe(true);
    expect(fn('найди справочник')).toBe(true);
    expect(fn('создай документ')).toBe(true);
    expect(fn('проверь запрос')).toBe(true);
  });

  it('detects "типовой" keyword', () => {
    const fn = (agent as any).isCodeQuery.bind(agent);
    expect(fn('найди типовой шаблон')).toBe(true);
  });

  it('detects new keywords: отбор, фильтр, exception, xml', () => {
    const fn = (agent as any).isCodeQuery.bind(agent);
    expect(fn('настрой отбор')).toBe(true);
    expect(fn('примени фильтр')).toBe(true);
    expect(fn('handle exception')).toBe(true);
    expect(fn('разобрать xml')).toBe(true);
  });

  it('detects выгрузк/загрузк keywords', () => {
    const fn = (agent as any).isCodeQuery.bind(agent);
    expect(fn('выгрузка данных')).toBe(true);
    expect(fn('загрузка из файла')).toBe(true);
  });
});

describe('autoSearchEnabled flag', () => {
  let agent: LirAgent;

  beforeEach(() => {
    for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
      try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    }
    agent = new LirAgent({ dbPath: TEST_DB, systemPrompt: 'Test' });
  });

  afterEach(async () => {
    try { await (agent as any).close(); } catch { /* ignore */ }
    for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
      try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    }
  });

  it('starts enabled by default', () => {
    expect((agent as any).session.autoSearchEnabled).toBe(true);
  });

  it('toggles off with /auto-search off', async () => {
    const result = await agent.processMessage('/auto-search off');
    expect(result.response).toContain('отключён');
    expect((agent as any).session.autoSearchEnabled).toBe(false);
  });

  it('toggles on with /auto-search on', async () => {
    (agent as any).session.autoSearchEnabled = false;
    const result = await agent.processMessage('/auto-search on');
    expect(result.response).toContain('включён');
    expect((agent as any).session.autoSearchEnabled).toBe(true);
  });

  it('shows usage with /auto-search alone', async () => {
    const result = await agent.processMessage('/auto-search');
    expect(result.response).toContain('Использование');
  });
});
