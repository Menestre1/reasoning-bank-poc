/**
 * HNSWBackend — адаптер hnsw (pure TS) для ReasoningBankSemantic
 * Заменяет линейный O(N) поиск на O(log N) приближённый поиск.
 * Персистентность через JSON-сериализацию (toJSON/fromJSON).
 *
 * NOTE: hnsw требует числовые ID, поэтому ведём маппинг string ↔ number.
 */

import { HNSW } from 'hnsw';
import * as fs from 'fs';
import * as path from 'path';

export interface HNSWSearchResult {
  id: string;
  score: number;
}

export interface HNSWBackendConfig {
  dimension: number;
  indexFilePath?: string;
  M?: number;
  efConstruction?: number;
  efSearch?: number;
}

export class HNSWBackend {
  private index: HNSW | null = null;
  private config: Required<Omit<HNSWBackendConfig, 'indexFilePath'>> & { indexFilePath: string };
  private idToNum = new Map<string, number>();
  private numToId = new Map<number, string>();
  private nextNum = 0;

  constructor(config: HNSWBackendConfig) {
    this.config = {
      dimension: config.dimension,
      indexFilePath: config.indexFilePath || './memory/hnsw_index.json',
      M: config.M || 16,
      efConstruction: config.efConstruction || 200,
      efSearch: config.efSearch || 50,
    };
  }

  get count(): number {
    return this.idToNum.size;
  }

  /**
   * Инициализировать индекс: загрузить с диска или создать новый.
   */
  async initialize(): Promise<void> {
    const indexPath = this.config.indexFilePath;

    if (fs.existsSync(indexPath)) {
      try {
        const json = fs.readFileSync(indexPath, 'utf-8');
        this.index = HNSW.fromJSON(JSON.parse(json));

        // Восстанавливаем маппинг ID из узлов индекса
        this.idToNum.clear();
        this.numToId.clear();
        this.nextNum = 0;

        // Восстанавливаем nextNum из IDs узлов
        for (const [, node] of (this.index as any).nodes) {
          const numId = node.id as number;
          this.numToId.set(numId, String(numId));
          this.idToNum.set(String(numId), numId);
          if (numId >= this.nextNum) this.nextNum = numId + 1;
        }
        return;
      } catch (e) {
        console.warn('[HNSW] Failed to load index from disk, building fresh:', (e as Error).message);
      }
    }

    this.index = new HNSW(
      this.config.M,
      this.config.efConstruction,
      this.config.dimension,
      'cosine',
      this.config.efSearch,
    );
    this.idToNum.clear();
    this.numToId.clear();
    this.nextNum = 0;
  }

  private getOrCreateNumId(stringId: string): number {
    if (this.idToNum.has(stringId)) {
      return this.idToNum.get(stringId)!;
    }
    const num = this.nextNum++;
    this.idToNum.set(stringId, num);
    this.numToId.set(num, stringId);
    return num;
  }

  /**
   * Построить индекс из массива векторов (первичное заполнение).
   */
  async buildFromData(data: Array<{ id: string; vector: number[] }>): Promise<void> {
    if (!this.index) {
      this.index = new HNSW(
        this.config.M,
        this.config.efConstruction,
        this.config.dimension,
        'cosine',
        this.config.efSearch,
      );
    }

    // Маппинг string ID → numeric ID
    const numericData = data.map(d => ({
      id: this.getOrCreateNumId(d.id),
      vector: d.vector,
    }));

    await this.index.buildIndex(numericData, {
      onProgress: (current, total) => {
        if (current % 500 === 0 || current === total) {
          console.log(`[HNSW] Building index: ${current}/${total}`);
        }
      },
      progressInterval: 500,
    });
  }

  /**
   * Добавить одну точку в индекс.
   */
  async addPoint(id: string, vector: number[]): Promise<void> {
    if (!this.index) throw new Error('HNSW index not initialized');
    const numId = this.getOrCreateNumId(id);
    await this.index.addPoint(numId, vector);
  }

  /**
   * Поиск k ближайших соседей.
   * @returns массив { id, score } отсортированный по score (по убыванию)
   */
  search(query: number[], k: number, efSearch?: number): HNSWSearchResult[] {
    if (!this.index) throw new Error('HNSW index not initialized');
    if (this.count === 0) return [];

    const results = this.index.searchKNN(query, k, { efSearch: efSearch || this.config.efSearch });
    return results
      .map(r => ({
        id: this.numToId.get(r.id) || String(r.id),
        score: r.score,
      }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Сохранить индекс на диск (JSON).
   */
  save(): void {
    if (!this.index) return;
    const indexPath = this.config.indexFilePath;
    const dir = path.dirname(indexPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const json = JSON.stringify(this.index.toJSON());
    fs.writeFileSync(indexPath, json, 'utf-8');
  }

  /**
   * Перестроить индекс из данных (используется после массовых изменений).
   */
  async rebuild(data: Array<{ id: string; vector: number[] }>): Promise<void> {
    this.idToNum.clear();
    this.numToId.clear();
    this.nextNum = 0;

    this.index = new HNSW(
      this.config.M,
      this.config.efConstruction,
      this.config.dimension,
      'cosine',
      this.config.efSearch,
    );

    if (data.length > 0) {
      const numericData = data.map(d => ({
        id: this.getOrCreateNumId(d.id),
        vector: d.vector,
      }));
      await this.index.buildIndex(numericData);
    }
  }

  /**
   * Закрыть (сохранить и освободить).
   */
  async close(): Promise<void> {
    this.save();
    this.index = null;
    this.idToNum.clear();
    this.numToId.clear();
    this.nextNum = 0;
  }
}
