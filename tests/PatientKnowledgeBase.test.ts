import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { PatientKnowledgeBase } from '../src/PatientKnowledgeBase.js';

const TEST_DB = './test_patient_kb.db';

describe('PatientKnowledgeBase', () => {
  let kb: PatientKnowledgeBase;

  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    kb = new PatientKnowledgeBase(TEST_DB);
  });

  afterEach(() => {
    kb.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  it('should save and find recent code', async () => {
    await kb.saveCode('patient1', 'console.log("hello")', 'javascript');
    await kb.saveCode('patient1', 'function foo() {}', 'javascript');

    const recent = await kb.findRecentCode('patient1', 5);
    expect(recent).toHaveLength(2);
    expect(recent.map(r => r.content)).toContain('console.log("hello")');
    expect(recent.map(r => r.content)).toContain('function foo() {}');
    expect(recent[0].language).toBe('javascript');
  });

  it('should deduplicate by content hash', async () => {
    await kb.saveCode('patient1', 'const x = 1;');
    await kb.saveCode('patient1', 'const x = 1;');

    const recent = await kb.findRecentCode('patient1', 5);
    expect(recent).toHaveLength(1);
  });

  it('should not mix patients', async () => {
    await kb.saveCode('patient1', 'code for p1');
    await kb.saveCode('patient2', 'code for p2');

    expect(await kb.findRecentCode('patient1', 5)).toHaveLength(1);
    expect(await kb.findRecentCode('patient2', 5)).toHaveLength(1);
  });

  it('should clear profile', async () => {
    await kb.saveCode('patient1', 'some code');
    await kb.saveCode('patient1', 'more code');
    expect(kb.countByProfile('patient1')).toBe(2);

    kb.clearProfile('patient1');
    expect(kb.countByProfile('patient1')).toBe(0);
  });

  it('should search code by keywords', async () => {
    await kb.saveCode('patient1', 'function connectToDatabase() { return db; }');
    await kb.saveCode('patient1', 'const httpServer = createServer();');
    await kb.saveCode('patient1', 'function handleRequest(req, res) {}');

    const results = await kb.searchCode('patient1', 'database', 5);
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('connectToDatabase');
  });

  it('should return empty for short query terms', async () => {
    await kb.saveCode('patient1', 'function foo() {}');
    const results = await kb.searchCode('patient1', 'a', 5);
    expect(results).toHaveLength(0);
  });

  it('should return empty for profile with no code', async () => {
    const results = await kb.searchCode('nonexistent', 'database', 5);
    expect(results).toHaveLength(0);
  });
});
