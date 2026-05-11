/**
 * LRUCache — простой LRU-кэш для результатов поиска
 * Ключ: hash-строка запроса + фильтров
 * Значение: результат retrieve() с TTL
 */

export interface LRUCacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class LRUCache<T> {
  private cache = new Map<string, LRUCacheEntry<T>>();
  private maxSize: number;
  private ttlMs: number;
  private hits = 0;
  private misses = 0;

  constructor(options: { maxSize?: number; ttlMs?: number } = {}) {
    this.maxSize = options.maxSize || 256;
    this.ttlMs = options.ttlMs || 60_000; // 60 сек по умолчанию
  }

  private hashKey(key: string): string {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = ((h << 5) - h + key.charCodeAt(i)) | 0;
    }
    return String(h >>> 0);
  }

  get(key: string): T | null {
    const hash = this.hashKey(key);
    const entry = this.cache.get(hash);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(hash);
      this.misses++;
      return null;
    }

    this.hits++;
    // LRU: перемещаем в конец (most recently used)
    this.cache.delete(hash);
    this.cache.set(hash, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    const hash = this.hashKey(key);

    // Если ключ уже существует, удаляем старую запись
    if (this.cache.has(hash)) {
      this.cache.delete(hash);
    }

    // Evict LRU entry если достигли лимита
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(hash, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  getStats(): { hits: number; misses: number; size: number; maxSize: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }
}
