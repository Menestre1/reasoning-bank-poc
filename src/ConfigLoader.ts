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

    const objectType = meta['@_type'] || 'Unknown';
    const uuid = meta['@_uuid'] || '';
    const props = meta.Properties?.Property || [];
    
    const getProp = (name: string): string => {
      if (Array.isArray(props)) {
        const prop = props.find((p: any) => p['@_Name'] === name);
        return prop?.['#text'] || '';
      } else {
        return props['@_Name'] === name ? (props['#text'] || '') : '';
      }
    };

    const name = getProp('Name');
    if (!name) return;

    const synonym = getProp('Synonym');
    let moduleText = getProp('Module') || '';

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
