import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { PatientKnowledgeBase } from '../src/PatientKnowledgeBase.js';

const TEST_DB = './test_next_pk.db';

describe('/next command contract', () => {
  let kb: PatientKnowledgeBase;

  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    kb = new PatientKnowledgeBase(TEST_DB);
  });

  afterEach(() => {
    kb.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  it('should clear all code for the profile', async () => {
    await kb.saveCode('lir', 'code block 1');
    await kb.saveCode('lir', 'code block 2');
    expect(kb.countByProfile('lir')).toBe(2);

    kb.clearProfile('lir');
    expect(kb.countByProfile('lir')).toBe(0);
  });

  it('should not affect other profiles', async () => {
    await kb.saveCode('patientA', 'code A');
    await kb.saveCode('patientB', 'code B');

    kb.clearProfile('patientA');
    expect(kb.countByProfile('patientA')).toBe(0);
    expect(kb.countByProfile('patientB')).toBe(1);
  });

  it('should allow saving code after clear', async () => {
    kb.clearProfile('lir');
    await kb.saveCode('lir', 'new code after clear');
    expect(kb.countByProfile('lir')).toBe(1);
    expect((await kb.findRecentCode('lir', 5))[0].content).toBe('new code after clear');
  });
});
