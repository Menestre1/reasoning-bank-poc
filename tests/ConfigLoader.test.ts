import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { ReasoningBankSemantic } from '../src/ReasoningBankSemantic.js';
import { ConfigStorage } from '../src/ConfigStorage.js';
import { ConfigLoader } from '../src/ConfigLoader.js';
import { SafeFileSystemReader } from '../src/SafeFileSystemReader.js';
import { OllamaClient } from '../src/OllamaClient.js';

const TEST_DB = './test_config_loader.db';

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDObject" xmlns:app="http://v8.1c.ru/8.3/MDObject" xmlns:config="http://v8.1c.ru/8.3/Config" xmlns:md="http://v8.1c.ru/8.3/MDObject" xmlns:rm="http://v8.1c.ru/8.3/MDObject" xmlns:rrd="http://v8.1c.ru/8.3/MDObject" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <md:Catalog>
    <Properties>
      <Name>Товары</Name>
      <Synonym>Товары и услуги</Synonym>
    </Properties>
  </md:Catalog>
</MetaDataObject>`;

const XML_WITH_MODULE = `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject>
  <Document>
    <Properties>
      <Name>РеализацияТоваров</Name>
      <Synonym>Реализация</Synonym>
      <Module>Процедура ПередЗаписью() КонецПроцедуры</Module>
    </Properties>
  </Document>
</MetaDataObject>`;

describe('ConfigLoader', () => {
  let rb: ReasoningBankSemantic;
  let storage: ConfigStorage;
  let loader: ConfigLoader;
  let mockFsReader: any;
  let mockOllama: OllamaClient;

  beforeEach(async () => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);

    rb = new ReasoningBankSemantic({ dbPath: TEST_DB, hnswEnabled: false });
    await rb.ensureInitialized();

    storage = new ConfigStorage(TEST_DB);

    mockFsReader = {
      walkXmlFiles: vi.fn().mockResolvedValue(['/fake/Catalog.Something.xml']),
      readFile: vi.fn().mockImplementation((path: string) => {
        if (path.includes('Something.xml')) return Promise.resolve(SAMPLE_XML);
        throw new Error('ENOENT: ' + path);
      }),
      readDirectory: vi.fn().mockRejectedValue(new Error('no forms dir')),
      ensureAllowed: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(false),
    };

    mockOllama = new OllamaClient({
      baseUrl: 'http://test:11434', model: 'nomic-embed-text',
    });
  });

  afterEach(async () => {
    try { storage.close(); } catch { /* ignore */ }
    try { await rb.close(); } catch { /* ignore */ }
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    const hnswFile = TEST_DB.replace(/\.db$/, '_hnsw.json');
    if (existsSync(hnswFile)) unlinkSync(hnswFile);
  });

  it('should parse XML, load module, and save to storage', async () => {
    loader = new ConfigLoader(rb, storage, mockFsReader as SafeFileSystemReader);
    const result = await loader.loadDirectory('/fake', 1);
    expect(result.processed).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(await storage.getObjectCount()).toBe(1);
    const samples = await storage.getSampleNames(5);
    expect(samples).toContain('Товары');
  });

  it('should compute Ollama embedding when llmClient provided', async () => {
    const mockEmbedding = Array.from({ length: 768 }, (_, i) => i / 768);
    vi.spyOn(mockOllama, 'getEmbedding').mockResolvedValue(mockEmbedding);

    loader = new ConfigLoader(rb, storage, mockFsReader as SafeFileSystemReader, mockOllama);
    const result = await loader.loadDirectory('/fake', 1);
    expect(result.processed).toBe(1);

    const objects = await storage.getAllObjects();
    expect(objects).toHaveLength(1);
  });

  it('should handle Ollama embedding failure gracefully', async () => {
    vi.spyOn(mockOllama, 'getEmbedding').mockRejectedValue(new Error('Ollama down'));

    loader = new ConfigLoader(rb, storage, mockFsReader as SafeFileSystemReader, mockOllama);
    const result = await loader.loadDirectory('/fake', 1);
    expect(result.processed).toBe(1);
    expect(await storage.getObjectCount()).toBe(1);
  });

  it('should load module from Ext/ObjectModule.bsl', async () => {
    const bslCode = 'Процедура ПриСозданииОбъекта() КонецПроцедуры';
    mockFsReader.readFile = vi.fn().mockImplementation((path: string) => {
      if (path.includes('Something.xml')) return Promise.resolve(SAMPLE_XML);
      if (path.includes('ObjectModule.bsl')) return Promise.resolve(bslCode);
      throw new Error('ENOENT: ' + path);
    });
    mockFsReader.readDirectory = vi.fn().mockRejectedValue(new Error('no forms'));

    loader = new ConfigLoader(rb, storage, mockFsReader as SafeFileSystemReader);
    await loader.loadDirectory('/fake', 1);

    const text = await storage.getFullModuleTextForObject('Товары');
    expect(text).toContain('ПриСозданииОбъекта');
  });

  it('should load module from Forms subdirectory', async () => {
    const formBsl = 'Процедура КомандаФормы1() КонецПроцедуры';
    mockFsReader.readFile = vi.fn().mockImplementation((path: string) => {
      if (path.includes('Something.xml')) return Promise.resolve(SAMPLE_XML);
      if (path.includes('Module.bsl')) return Promise.resolve(formBsl);
      throw new Error('ENOENT: ' + path);
    });
    mockFsReader.readDirectory = vi.fn().mockResolvedValue([
      { name: 'ФормаСписка', isDirectory: true, fullPath: '/fake/Catalog.Something/Forms/ФормаСписка' },
    ]);

    loader = new ConfigLoader(rb, storage, mockFsReader as SafeFileSystemReader);
    await loader.loadDirectory('/fake', 1);

    const text = await storage.getFullModuleTextForObject('Товары');
    expect(text).toContain('КомандаФормы1');
  });

  it('should handle XML with Module property in properties', async () => {
    mockFsReader.readFile = vi.fn().mockImplementation((path: string) => {
      if (path.includes('Something.xml')) return Promise.resolve(XML_WITH_MODULE);
      throw new Error('ENOENT: ' + path);
    });

    loader = new ConfigLoader(rb, storage, mockFsReader as SafeFileSystemReader);
    await loader.loadDirectory('/fake', 1);

    const text = await storage.getFullModuleTextForObject('РеализацияТоваров');
    expect(text).toContain('ПередЗаписью');
  });

  it('should handle empty XML gracefully (no objects saved)', async () => {
    mockFsReader.readFile = vi.fn().mockResolvedValue('<?xml version="1.0"?><Root></Root>');
    loader = new ConfigLoader(rb, storage, mockFsReader as SafeFileSystemReader);
    const result = await loader.loadDirectory('/fake', 1);
    expect(result.processed).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(await storage.getObjectCount()).toBe(0);
  });

  it('should report read errors', async () => {
    mockFsReader.readFile = vi.fn().mockRejectedValue(new Error('ENOENT'));
    mockFsReader.walkXmlFiles = vi.fn().mockResolvedValue(['/fake/broken.xml']);
    loader = new ConfigLoader(rb, storage, mockFsReader as SafeFileSystemReader);
    const result = await loader.loadDirectory('/fake', 1);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it('should process multiple files', async () => {
    mockFsReader.walkXmlFiles = vi.fn().mockResolvedValue([
      '/fake/Catalog.A.xml',
      '/fake/Document.B.xml',
    ]);
    let callCount = 0;
    mockFsReader.readFile = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(SAMPLE_XML);
      return Promise.resolve(XML_WITH_MODULE);
    });

    loader = new ConfigLoader(rb, storage, mockFsReader as SafeFileSystemReader);
    const result = await loader.loadDirectory('/fake', 2);
    expect(result.processed).toBe(2);
    expect(await storage.getObjectCount()).toBe(2);
  });

  it('should record config-code domain in RB', async () => {
    loader = new ConfigLoader(rb, storage, mockFsReader as SafeFileSystemReader);
    await loader.loadDirectory('/fake', 1);

    const rbResults = await rb.retrieve('Товары', { domain: 'config-code', k: 5 });
    expect(rbResults.length).toBeGreaterThanOrEqual(1);
    expect(rbResults[0].experience.domain).toBe('config-code');
  });

  it('should parse <Property Name="X"> XML format (real 1C export)', async () => {
    const PROPERTY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject>
  <Catalog>
    <Properties>
      <Property Name="Name">РеальнаяНоменклатура</Property>
      <Property Name="Synonym">Номенклатура</Property>
      <Property Name="Module">Процедура ПриЗаписи() КонецПроцедуры</Property>
    </Properties>
  </Catalog>
</MetaDataObject>`;
    mockFsReader.walkXmlFiles = vi.fn().mockResolvedValue(['/export/Catalogs/Номенклатура/Catalog.xml']);
    mockFsReader.readFile = vi.fn().mockImplementation((p: string) => {
      if (p.includes('Catalog.xml')) return Promise.resolve(PROPERTY_XML);
      if (p.includes('ObjectModule.bsl')) return Promise.resolve('Процедура ОбъектныйМодуль() КонецПроцедуры');
      if (p.includes('Module.bsl')) return Promise.resolve('Процедура ФормМодуль() КонецПроцедуры');
      throw new Error('ENOENT: ' + p);
    });
    mockFsReader.readDirectory = vi.fn().mockImplementation((p: string) => {
      if (p.includes('Forms')) return Promise.resolve([
        { name: 'ФормаСписка', isDirectory: true, fullPath: '/export/Catalogs/Номенклатура/Forms/ФормаСписка' },
      ]);
      throw new Error('ENOENT: ' + p);
    });

    loader = new ConfigLoader(rb, storage, mockFsReader as SafeFileSystemReader);
    const result = await loader.loadDirectory('/export', 1);
    expect(result.processed).toBe(1);
    expect(await storage.getObjectCount()).toBe(1);

    const fullText = await storage.getFullModuleTextForObject('РеальнаяНоменклатура');
    expect(fullText).toContain('Процедура ПриЗаписи()');
    expect(fullText).toContain('ОбъектныйМодуль');
    expect(fullText).toContain('ФормМодуль');
  });

  it('should load module from Ext/ using correct path (path.dirname)', async () => {
    const BSL_CODE = 'Процедура СерверныйМодуль() КонецПроцедуры';
    mockFsReader.readFile = vi.fn().mockImplementation((p: string) => {
      if (p.includes('Document.xml')) return Promise.resolve(`<?xml version="1.0"?>
<MetaDataObject><Document><Properties>
  <Property Name="Name">Заказ</Property>
  <Property Name="Module">Процедура ВстроенныйМодуль() КонецПроцедуры</Property>
</Properties></Document></MetaDataObject>`);
      if (p.includes('ObjectModule.bsl')) return Promise.resolve(BSL_CODE);
      throw new Error('ENOENT: ' + p);
    });
    mockFsReader.walkXmlFiles = vi.fn().mockResolvedValue(['/export/Documents/Заказ/Document.xml']);
    mockFsReader.readDirectory = vi.fn().mockRejectedValue(new Error('no forms'));

    loader = new ConfigLoader(rb, storage, mockFsReader as SafeFileSystemReader);
    await loader.loadDirectory('/export', 1);

    const text = await storage.getFullModuleTextForObject('Заказ');
    expect(text).toContain('СерверныйМодуль');
    expect(text).toContain('ВстроенныйМодуль');
  });
});
