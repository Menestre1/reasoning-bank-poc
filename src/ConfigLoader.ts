import { createHash } from 'crypto';
import { XMLParser } from 'fast-xml-parser';
import pLimit from 'p-limit';
import { ReasoningBankSemantic } from './ReasoningBankSemantic.js';
import { ConfigStorage, type ConfigObjectRecord } from './ConfigStorage.js';
import { SafeFileSystemReader } from './SafeFileSystemReader.js';

export interface LoadConfigResult {
  totalFiles: number;
  processed: number;
  errors: string[];
  durationMs: number;
}

export class ConfigLoader {
  private rb: ReasoningBankSemantic;
  private storage: ConfigStorage;
  private fsReader: SafeFileSystemReader;
  private parser: XMLParser;

  constructor(rb: ReasoningBankSemantic, storage: ConfigStorage, fsReader: SafeFileSystemReader) {
    this.rb = rb;
    this.storage = storage!;
    this.fsReader = fsReader;
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
    });
  }

  async loadDirectory(rootPath: string, concurrency = 10): Promise<LoadConfigResult> {
    const start = Date.now();
    const xmlFiles = await this.fsReader.walkXmlFiles(rootPath);
    const totalFiles = xmlFiles.length;
    let processed = 0;
    const errors: string[] = [];

    const limit = pLimit(concurrency);

    const tasks = xmlFiles.map(filePath =>
      limit(async () => {
        try {
          await this.processFile(filePath, rootPath);
          processed++;
          if (processed % 100 === 0) {
            console.log(`[ConfigLoader] Progress: ${processed}/${totalFiles}`);
          }
        } catch (err: any) {
          errors.push(`${filePath}: ${err.message}`);
        }
      })
    );

    await Promise.all(tasks);
    const durationMs = Date.now() - start;
    console.log(`[ConfigLoader] Completed. Processed ${processed} files, ${errors.length} errors in ${durationMs}ms`);
    return { totalFiles, processed, errors, durationMs };
  }

  private async processFile(filePath: string, rootPath: string): Promise<void> {
    const content = await this.fsReader.readFile(filePath);
    const parsed = this.parser.parse(content);
    const meta = parsed?.MetaDataObject;
    if (!meta) return;

    // Find the object-type child (Catalog, Document, etc.)
    const typeKey = Object.keys(meta).find(k => k !== '@_type' && k !== '@_uuid');
    const obj = typeKey ? meta[typeKey] : null;
    if (!obj) return;

    const objectType = `1C.${typeKey}`;
    const uuid = obj['@_uuid'] || meta['@_uuid'] || '';
    const props = obj.Properties || {};

    const getProp = (name: string): string => {
      const val = props[name];
      if (typeof val === 'string') return val;
      if (val && typeof val === 'object') return val['#text'] || '';
      return '';
    };

    const name = getProp('Name');
    if (!name) {
      console.log(`[ConfigLoader] Skipping ${filePath}: no Name in properties (keys=${Object.keys(props).join(',')})`);
      return;
    }

    const synonym = getProp('Synonym');
    let moduleText = getProp('Module') || '';

    // Try to read BSL module files from Ext subdirectory
    const extDir = filePath.replace(/\.xml$/i, '') + '/Ext';
    const bslFiles = ['ObjectModule.bsl', 'ManagerModule.bsl', 'Module.bsl', 'RecordSetModule.bsl'];
    if (!moduleText) {
      for (const bslName of bslFiles) {
        try {
          const bslPath = extDir + '/' + bslName;
          const bslContent = await this.fsReader.readFile(bslPath);
          if (bslContent.trim()) {
            moduleText += (moduleText ? '\n\n' : '') + `// ${bslName}\n` + bslContent;
          }
        } catch {
          // file not found, skip
        }
      }
      if (moduleText) {
        console.log(`[ConfigLoader] Loaded module from Ext/ for ${name} (${moduleText.length} chars)`);
      }
    }

    const id = `1c_${objectType}_${uuid || name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const contentForEmbedding = moduleText.slice(0, 2000);
    const hash = createHash('sha256').update(moduleText).digest('hex');

    const rbId = await this.rb.recordExperience({
      id,
      task: `${objectType}.${name}`,
      outcome: 'success',
      content: contentForEmbedding,
      domain: 'config-code',
      error_type: 'none',
      confidence: 0.9,
       metadata: {
         objectType,
         fullPath: filePath,
         sizeBytes: Buffer.byteLength(moduleText, 'utf8'),
         hash,
         uuid,
         language: '1С (BSL)',
       },
    });

    const record: ConfigObjectRecord = {
      id: rbId,
      objectType,
      name,
      synonym: synonym || '',
      moduleFull: moduleText,
      filePath,
      sizeBytes: Buffer.byteLength(moduleText, 'utf8'),
      hash,
    };
    await this.storage.saveObject(record);
  }
}
