import { createHash } from 'crypto';
import { XMLParser } from 'fast-xml-parser';
import * as path from 'path';
import pLimit from 'p-limit';
import { OllamaClient } from './OllamaClient.js';
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
  private llmClient?: OllamaClient;

  constructor(rb: ReasoningBankSemantic, storage: ConfigStorage, fsReader: SafeFileSystemReader, llmClient?: OllamaClient) {
    this.rb = rb;
    this.storage = storage!;
    this.fsReader = fsReader;
    this.llmClient = llmClient;
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
          if (errors.length <= 3) console.log(`[ConfigLoader] ERROR: ${filePath}: ${err.message}`);
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
    const attrType = meta['@_type'];
    const typeKey = attrType || Object.keys(meta).find(k => k !== '@_type' && k !== '@_uuid');
    if (!typeKey) return;

    const obj = attrType ? meta : meta[typeKey];
    if (!obj) return;

    const objectType = `1C.${typeKey}`;
    const uuid = obj['@_uuid'] || meta['@_uuid'] || '';
    const props = obj.Properties || {};

    const getProp = (name: string): string => {
      // Format 1: <Name>value</Name>
      const direct = props[name];
      if (typeof direct === 'string') return direct;
      if (direct && typeof direct === 'object') return direct['#text'] || '';
      // Format 2: <Property Name="Name">value</Property> (real 1C export)
      if (Array.isArray(props.Property)) {
        const found = props.Property.find((p: any) => p['@_Name'] === name);
        if (found) return found['#text'] || '';
      }
      if (props.Property && typeof props.Property === 'object' && !Array.isArray(props.Property)) {
        if (props.Property['@_Name'] === name) return props.Property['#text'] || '';
      }
      return '';
    };

    const name = getProp('Name');
    if (!name) {
      console.log(`[ConfigLoader] Skipping ${filePath}: no Name in properties (typeKey=${typeKey})`);
      return;
    }

    const synonym = getProp('Synonym');
    const parentDir = path.dirname(filePath);

    // Try to read BSL module files from Ext subdirectory and Forms
    let moduleText = getProp('Module') || '';
    const extDir = parentDir + '/Ext';
    const bslFiles = ['ObjectModule.bsl', 'ManagerModule.bsl', 'Module.bsl', 'RecordSetModule.bsl'];
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

    // Also look for Form BSL modules: <parentDir>/Forms/*/Ext/Form/Module.bsl
    const objDir = parentDir;
    try {
      const formsDir = objDir + '/Forms';
      const formEntries = await this.fsReader.readDirectory(formsDir);
      for (const entry of formEntries) {
        if (!entry.isDirectory) continue;
        try {
          const formBsl = formsDir + '/' + entry.name + '/Ext/Form/Module.bsl';
          const bslContent = await this.fsReader.readFile(formBsl);
          if (bslContent.trim()) {
            moduleText += (moduleText ? '\n\n' : '') + `// Form: ${entry.name}\n` + bslContent;
          }
        } catch {
          // no form module, skip
        }
      }
    } catch {
      // no Forms dir, skip
    }

    if (moduleText) {
      console.log(`[ConfigLoader] Loaded module for ${name} (${moduleText.length} chars)`);
    }
    console.log(`[ConfigLoader] Saving ${objectType}.${name} to RB (domain=config-code)`);

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

    // Compute Ollama embedding for semantic search
    let ollamaEmbedding: Buffer | undefined;
    if (this.llmClient && moduleText) {
      try {
        const emb = await this.llmClient.getEmbedding(contentForEmbedding);
        if (emb.length > 0) {
          ollamaEmbedding = Buffer.from(new Float32Array(emb).buffer);
        }
      } catch (err: any) {
        console.log(`[ConfigLoader] Ollama embedding unavailable for ${name}: ${err.message}`);
      }
    }

    const record: ConfigObjectRecord = {
      id: rbId,
      objectType,
      name,
      synonym: synonym || '',
      moduleFull: moduleText,
      filePath,
      sizeBytes: Buffer.byteLength(moduleText, 'utf8'),
      hash,
      ollamaEmbedding,
    };
    await this.storage.saveObject(record);
  }
}
