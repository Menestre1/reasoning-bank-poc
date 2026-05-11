import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigStorage } from '../src/ConfigStorage.js';
import { unlinkSync, existsSync } from 'fs';

const TEST_DB = './test_config_storage.db';

describe('ConfigStorage', () => {
  let storage: ConfigStorage;

  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    storage = new ConfigStorage(TEST_DB);
  });

  afterEach(() => {
    storage.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  const makeEmbedding = (values: number[]): Buffer => {
    return Buffer.from(new Float32Array(values).buffer);
  };

  it('should save and count objects', async () => {
    await storage.saveObject({
      id: '1', objectType: '1C.Catalog', name: 'TestCatalog',
      moduleFull: 'Procedure Test() EndProcedure', filePath: '/test.xml',
      sizeBytes: 100, hash: 'abc', ollamaEmbedding: undefined,
    });
    expect(await storage.getObjectCount()).toBe(1);
  });

  it('should find similar modules by cosine similarity', async () => {
    const emb1 = makeEmbedding([0.1, 0.2, 0.3, 0.4, 0.5]);
    const emb2 = makeEmbedding([0.9, 0.8, 0.7, 0.6, 0.5]);
    const emb3 = makeEmbedding([0.5, 0.5, 0.5, 0.5, 0.5]);

    await storage.saveObject({
      id: 'o1', objectType: '1C.Catalog', name: 'Catalog1',
      moduleFull: 'Процедура Тест1() КонецПроцедуры', filePath: '/c1.xml',
      sizeBytes: 50, hash: 'h1', ollamaEmbedding: emb1,
    });
    await storage.saveObject({
      id: 'o2', objectType: '1C.Document', name: 'Doc2',
      moduleFull: 'Процедура Тест2() КонецПроцедуры', filePath: '/d2.xml',
      sizeBytes: 50, hash: 'h2', ollamaEmbedding: emb2,
    });
    await storage.saveObject({
      id: 'o3', objectType: '1C.Report', name: 'Report3',
      moduleFull: 'Процедура Тест3() КонецПроцедуры', filePath: '/r3.xml',
      sizeBytes: 50, hash: 'h3', ollamaEmbedding: emb3,
    });

    const query = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
    const results = await storage.findSimilarModulesOllama(query, 5, 0.9);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('Catalog1');
    expect(results[0].similarity).toBeGreaterThan(0.99);
  });

  it('should respect threshold in semantic search', async () => {
    const emb1 = makeEmbedding([0.1, 0.2, 0.3, 0.4, 0.5]);
    const emb2 = makeEmbedding([0.9, 0.8, 0.7, 0.6, 0.5]);

    await storage.saveObject({
      id: 'a1', objectType: '1C.Catalog', name: 'Alpha',
      moduleFull: 'A', filePath: '/a.xml',
      sizeBytes: 10, hash: 'ha', ollamaEmbedding: emb1,
    });
    await storage.saveObject({
      id: 'a2', objectType: '1C.Document', name: 'Beta',
      moduleFull: 'B', filePath: '/b.xml',
      sizeBytes: 10, hash: 'hb', ollamaEmbedding: emb2,
    });

    const query = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
    const highThreshold = await storage.findSimilarModulesOllama(query, 5, 0.99);
    expect(highThreshold).toHaveLength(1);
    expect(highThreshold[0].name).toBe('Alpha');

    const lowThreshold = await storage.findSimilarModulesOllama(query, 5, 0.0);
    expect(lowThreshold).toHaveLength(2);
  });

  it('should respect limit in semantic search', async () => {
    for (let i = 0; i < 5; i++) {
      await storage.saveObject({
        id: `l${i}`, objectType: '1C.Catalog', name: `Obj${i}`,
        moduleFull: `module ${i}`, filePath: `/o${i}.xml`,
        sizeBytes: 10, hash: `h${i}`,
        ollamaEmbedding: makeEmbedding([0.1, 0.2, 0.3, 0.4, 0.5]),
      });
    }
    const query = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
    const results = await storage.findSimilarModulesOllama(query, 2, 0.0);
    expect(results).toHaveLength(2);
  });

  it('should skip objects without embedding', async () => {
    await storage.saveObject({
      id: 'no-emb', objectType: '1C.Catalog', name: 'NoEmb',
      moduleFull: 'code', filePath: '/n.xml',
      sizeBytes: 10, hash: 'hn', ollamaEmbedding: undefined,
    });
    const query = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
    const results = await storage.findSimilarModulesOllama(query, 5, 0.0);
    expect(results).toHaveLength(0);
  });

  it('should search by FTS', async () => {
    await storage.saveObject({
      id: 'f1', objectType: '1C.Catalog', name: 'Товары',
      moduleFull: 'Процедура ВыгрузитьТовары() КонецПроцедуры', filePath: '/f1.xml',
      sizeBytes: 50, hash: 'hf1',
    });
    const results = await storage.searchByFTS('Товары');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('Товары');
  });

  it('should fallback to LIKE when FTS fails', async () => {
    await storage.saveObject({
      id: 'like1', objectType: '1C.Document', name: 'Документы',
      moduleFull: 'Процедура ПроведениеДокумента() КонецПроцедуры', filePath: '/like1.xml',
      sizeBytes: 50, hash: 'hl1',
    });
    const results = await storage.searchByFTS('Проведение');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('should return snippets from FTS', async () => {
    await storage.saveObject({
      id: 'snip1', objectType: '1C.Catalog', name: 'Справочник',
      moduleFull: 'Процедура ОбработкаПроверкиЗаполнения() КонецПроцедуры',
      filePath: '/snip1.xml', sizeBytes: 60, hash: 'hs1',
    });
    const results = await storage.searchByFTS('ОбработкаПроверкиЗаполнения');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].snippet).toContain('ОбработкаПроверкиЗаполнения');
  });

  it('should get full module text', async () => {
    await storage.saveObject({
      id: 'full1', objectType: '1C.Catalog', name: 'FullModule',
      moduleFull: 'Длинный текст модуля с множеством строк\nИ ещё одна строка',
      filePath: '/full.xml', sizeBytes: 60, hash: 'hfull',
    });
    const text = await storage.getFullModuleTextForObject('FullModule');
    expect(text).toContain('Длинный текст модуля');
    expect(text).toContain('ещё одна строка');
  });

  it('should return null for missing module text', async () => {
    const text = await storage.getFullModuleTextForObject('NonExistent');
    expect(text).toBeNull();
  });

  it('should get sample names', async () => {
    await storage.saveObject({
      id: 's1', objectType: '1C.Catalog', name: 'Sample1',
      moduleFull: 'a', filePath: '/s1.xml', sizeBytes: 10, hash: 'hs1',
    });
    await storage.saveObject({
      id: 's2', objectType: '1C.Document', name: 'Sample2',
      moduleFull: 'b', filePath: '/s2.xml', sizeBytes: 10, hash: 'hs2',
    });
    const names = await storage.getSampleNames(5);
    expect(names).toContain('Sample1');
    expect(names).toContain('Sample2');
    expect(names.length).toBeLessThanOrEqual(5);
  });

  it('should return all objects', async () => {
    await storage.saveObject({
      id: 'all1', objectType: '1C.Catalog', name: 'AllOne',
      moduleFull: 'x', filePath: '/x.xml', sizeBytes: 5, hash: 'hx',
    });
    const all = await storage.getAllObjects();
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all[0]).toHaveProperty('id');
    expect(all[0]).toHaveProperty('name');
    expect(all[0]).toHaveProperty('object_type');
  });

  it('should clear all objects and FTS index', async () => {
    await storage.saveObject({
      id: 'c1', objectType: '1C.Catalog', name: 'ToClear',
      moduleFull: 'code', filePath: '/c.xml', sizeBytes: 10, hash: 'hc',
    });
    expect(await storage.getObjectCount()).toBe(1);
    await storage.clearAll();
    expect(await storage.getObjectCount()).toBe(0);
  });

  it('should return search stats', async () => {
    const stats = storage.getSearchStats();
    expect(stats).toHaveProperty('ftsQueries');
    expect(stats).toHaveProperty('likeQueries');
    expect(stats).toHaveProperty('totalQueries');
  });
});
