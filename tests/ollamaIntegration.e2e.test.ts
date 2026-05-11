import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { ReasoningBankSemantic } from '../src/ReasoningBankSemantic.js';
import { ConfigStorage } from '../src/ConfigStorage.js';
import { ConfigLoader } from '../src/ConfigLoader.js';
import { SafeFileSystemReader } from '../src/SafeFileSystemReader.js';
import { OllamaClient } from '../src/OllamaClient.js';
import * as path from 'path';

const TEST_DB = './test_ollama_e2e.db';
const CONFIG_V2 = path.resolve(__dirname, '..', 'test_config_v2');
const CONFIG_FULL = path.resolve(__dirname, '..', 'test_config', 'ВыгрузкаЗагрузкаДанныхXMLАдаптивная');

let ollamaAvailable = false;

async function isOllamaAvailable(): Promise<boolean> {
  try {
    const client = new OllamaClient({ baseUrl: 'http://127.0.0.1:11434', model: 'nomic-embed-text' });
    const emb = await client.getEmbedding('test');
    return emb.length > 0;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  ollamaAvailable = await isOllamaAvailable();
}, 30000);

afterAll(() => {
  [TEST_DB, TEST_DB.replace(/\.db$/, '_hnsw.json')].forEach(f => {
    try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
  });
});

describe('Ollama E2E Integration', () => {
  let rb: ReasoningBankSemantic;
  let storage: ConfigStorage;

  beforeEach(() => {
    if (!ollamaAvailable || !existsSync(CONFIG_V2)) return;
    [TEST_DB, TEST_DB.replace(/\.db$/, '_hnsw.json')].forEach(f => {
      try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    });
    rb = new ReasoningBankSemantic({ dbPath: TEST_DB, hnswEnabled: false });
    storage = new ConfigStorage(TEST_DB);
  });

  afterEach(() => {
    if (!rb) return;
    try { storage.close(); } catch { /* ignore */ }
    try { rb.close().catch(() => {}); } catch { /* ignore */ }
  });

  it('should load real config with Ollama embeddings and find by FTS', async () => {
    if (!ollamaAvailable) return;
    await rb.ensureInitialized();
    const fsReader = new SafeFileSystemReader([path.resolve(__dirname, '..')]);
    const ollama = new OllamaClient({ baseUrl: 'http://127.0.0.1:11434', model: 'nomic-embed-text' });
    const loader = new ConfigLoader(rb, storage, fsReader, ollama);

    const result = await loader.loadDirectory(CONFIG_V2);
    expect(result.processed).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);

    const count = await storage.getObjectCount();
    expect(count).toBeGreaterThan(0);
    expect(count).toBe(2);

    const allObjects = await storage.getAllObjects();
    expect(allObjects.map(o => o.name)).toContain('Products');
    expect(allObjects.map(o => o.name)).toContain('Orders');

    const ftsResults = await storage.searchByFTS('НачатьТранзакцию');
    expect(ftsResults.length).toBeGreaterThan(0);
    expect(ftsResults[0].name).toBe('Products');
  }, 60000);

  it('should return semantic search results with real Ollama embeddings', async () => {
    if (!ollamaAvailable) return;
    await rb.ensureInitialized();
    const fsReader = new SafeFileSystemReader([path.resolve(__dirname, '..')]);
    const ollama = new OllamaClient({ baseUrl: 'http://127.0.0.1:11434', model: 'nomic-embed-text' });
    const loader = new ConfigLoader(rb, storage, fsReader, ollama);

    await loader.loadDirectory(CONFIG_V2);

    const queryEmb = await ollama.getEmbedding('1C transaction start, begin transaction, journal log');
    expect(queryEmb.length).toBe(768);

    const results = await storage.findSimilarModulesOllama(new Float32Array(queryEmb), 5, 0.0);
    expect(results.length).toBeGreaterThan(0);
    expect(['Products', 'Orders']).toContain(results[0].name);
    expect(results[0].similarity).toBeGreaterThan(0.3);
  }, 60000);

  it('should get full module text from inline Module property', async () => {
    if (!ollamaAvailable) return;
    await rb.ensureInitialized();
    const fsReader = new SafeFileSystemReader([path.resolve(__dirname, '..')]);
    const ollama = new OllamaClient({ baseUrl: 'http://127.0.0.1:11434', model: 'nomic-embed-text' });
    const loader = new ConfigLoader(rb, storage, fsReader, ollama);

    await loader.loadDirectory(CONFIG_V2);

    const text = await storage.getFullModuleTextForObject('Orders');
    expect(text).not.toBeNull();
    expect(text).toContain('ПередЗаписью');
    expect(text).toContain('Проведение');
  }, 60000);

  it('should load full processing config with ObjectModule.bsl and Forms', async () => {
    if (!ollamaAvailable || !existsSync(CONFIG_FULL)) return;
    await rb.ensureInitialized();
    const fsReader = new SafeFileSystemReader([path.resolve(__dirname, '..', 'test_config')]);
    const ollama = new OllamaClient({ baseUrl: 'http://127.0.0.1:11434', model: 'nomic-embed-text' });
    const loader = new ConfigLoader(rb, storage, fsReader, ollama);

    const result = await loader.loadDirectory(CONFIG_FULL);
    expect(result.processed).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);

    const allObjects = await storage.getAllObjects();
    const processing = allObjects.find(o => o.name === 'ВыгрузкаЗагрузкаДанныхXMLАдаптивная');
    expect(processing).toBeDefined();
    expect(processing!.object_type).toBe('1C.ExternalDataProcessor');

    const text = await storage.getFullModuleTextForObject('ВыгрузкаЗагрузкаДанныхXMLАдаптивная');
    expect(text).not.toBeNull();
    expect(text!.length).toBeGreaterThan(100000);
    expect(text).toContain('ObjectModule.bsl');
    expect(text).toContain('Form:');
  }, 60000);

  it('should search processing code semantically with real Ollama embeddings', async () => {
    if (!ollamaAvailable || !existsSync(CONFIG_FULL)) return;
    await rb.ensureInitialized();
    const fsReader = new SafeFileSystemReader([path.resolve(__dirname, '..', 'test_config')]);
    const ollama = new OllamaClient({ baseUrl: 'http://127.0.0.1:11434', model: 'nomic-embed-text' });
    const loader = new ConfigLoader(rb, storage, fsReader, ollama);

    await loader.loadDirectory(CONFIG_FULL);

    const queryEmb = await ollama.getEmbedding('Выгрузка данных XML, обмен между конфигурациями');
    expect(queryEmb.length).toBe(768);

    const results = await storage.findSimilarModulesOllama(new Float32Array(queryEmb), 5, 0.0);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].similarity).toBeGreaterThan(0.3);
  }, 60000);
});
