import { readFileSync } from 'fs';
import { PerformanceStorage, type MeasurementRecord } from './PerformanceStorage.js';

export interface LoadMeasurementsResult {
  totalFiles: number;
  loaded: number;
  errors: string[];
  durationMs: number;
}

export class PerformanceLoader {
  private storage: PerformanceStorage;

  constructor(storage: PerformanceStorage) {
    this.storage = storage;
  }

  async loadDirectory(dirPath: string): Promise<LoadMeasurementsResult> {
    const start = Date.now();
    const { readdirSync, statSync } = await import('fs');
    const files: string[] = [];

    const scanDir = (dir: string) => {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = `${dir}/${entry}`;
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.endsWith('.json')) {
          files.push(fullPath);
        }
      }
    };

    scanDir(dirPath);

    const totalFiles = files.length;
    let loaded = 0;
    const errors: string[] = [];

    for (const file of files) {
      try {
        const content = readFileSync(file, 'utf8');
        const data = JSON.parse(content);

        if (!data.measurements || !Array.isArray(data.measurements)) {
          errors.push(`${file}: No measurements array found`);
          continue;
        }

        for (const m of data.measurements) {
          const record: MeasurementRecord = {
            timestamp: data.timestamp || new Date().toISOString(),
            objectName: m.object || '',
            methodName: m.method || null,
            durationMs: m.duration_ms || 0,
            callCount: m.call_count || 0,
            environment: data.environment || '',
            metadataJson: JSON.stringify(m.metadata || {}),
          };

          if (record.objectName) {
            await this.storage.saveMeasurement(record);
            loaded++;
          }
        }
      } catch (err: any) {
        errors.push(`${file}: ${err.message}`);
      }
    }

    const durationMs = Date.now() - start;
    console.log(`[PerformanceLoader] Completed. Loaded ${loaded} measurements from ${totalFiles} files, ${errors.length} errors in ${durationMs}ms`);

    return { totalFiles, loaded, errors, durationMs };
  }
}
